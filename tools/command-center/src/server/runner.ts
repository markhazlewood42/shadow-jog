import { execFile } from 'node:child_process';
import type { ExecFileException } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Config, isInside } from './config';

// The runner is the only way the server starts a program. Everything the command center learns
// from git and GitHub, and its one write (Mark's answer to a decision), goes through it. It runs
// only the commands on a fixed list, so a bug (or a prompt-injected agent) that builds a wrong
// command line cannot push, merge, delete or reach another repository: the call is refused
// before any process starts.

export type RunResult = { code: number; stdout: string; stderr: string };

export type Runner = (cmd: 'git' | 'gh', args: string[], o?: { cwd?: string; timeoutMs?: number }) => Promise<RunResult>;

/**
 * Starts one program and gives back what it did. This is the part under the checks. The runner
 * takes it as a parameter so a test can watch the commands that would start, and the end-to-end
 * server can put a fake `gh` here.
 */
export type Exec = (cmd: 'git' | 'gh', args: string[], o: { cwd: string; timeoutMs: number }) => Promise<RunResult>;

/** A call the runner did not make because it is not on the list. This is a bug in the caller, so it throws. */
export class RunnerRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunnerRefusal';
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
/** A decision note is short, and a Windows command line cannot hold much more than 30,000 characters. */
const MAX_COMMENT_CHARS = 10_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

// ---- the list ----

/** What a check says: the arguments to run, or why the call is refused. */
type Checked = { args: string[] } | { refused: string };
const accept = (args: string[]): Checked => ({ args });
const refuse = (refused: string): Checked => ({ refused });

const isNumber = (value: string | undefined): value is string => value !== undefined && /^\d+$/.test(value);
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((item, i) => item === b[i]);

/** git: log, for-each-ref, show, rev-parse and worktree list. Nothing else. */
const GIT_READ_COMMANDS = new Set(['log', 'for-each-ref', 'show', 'rev-parse']);

function checkGit(args: string[]): Checked {
  const [command, second] = args;
  if (command === undefined) return refuse('no command given');
  // An option in front of the command (git -c core.pager=..., git -C, --git-dir) changes how git
  // runs, and `-c` can make it start any program. The command must come first.
  if (command.startsWith('-')) return refuse(`${command} before the command could change how git runs`);
  const isWorktreeList = command === 'worktree' && second === 'list';
  if (!GIT_READ_COMMANDS.has(command) && !isWorktreeList) return refuse(`git ${command} is not one of the read commands on the list`);

  for (const arg of args.slice(1)) {
    if (arg === '--') break; // after this come file names, not options
    // `--output=<file>` makes git log and git show write to a file. Git also accepts a unique start of
    // an option name (--out), so every start of "output" is refused, not only the whole word.
    const name = arg.startsWith('--') ? (arg.slice(2).split('=')[0] ?? '') : '';
    if (name !== '' && 'output'.startsWith(name)) return refuse('--output would write a file');
  }
  return accept(args);
}

/**
 * Takes the --repo option out of the arguments. gh pr and gh issue are pinned to the configured
 * repository, so the runner adds that option itself, and a caller may pass it only with the same
 * value. gh accepts --repo X, --repo=X, -R X and -RX, so all four are read.
 */
function takeRepo(repo: string, args: readonly string[]): { rest: string[] } | { refused: string } {
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    let value: string | undefined;
    if (arg === '--repo' || arg === '-R') {
      value = args[++i];
      if (value === undefined) return { refused: `${arg} needs a value` };
    } else if (arg.startsWith('--repo=')) {
      value = arg.slice('--repo='.length);
    } else if (arg.startsWith('-R') && arg.length > 2) {
      value = arg.slice(2);
    } else {
      rest.push(arg);
      continue;
    }
    if (value !== repo) return { refused: `--repo must be ${repo}` };
  }
  return { rest };
}

/** gh pr list, pr view, issue list and issue view: reads, pinned to the repository. `rest` is what follows the first two words. */
function checkGhRead(repo: string, group: 'pr' | 'issue', verb: 'list' | 'view', rest: string[]): Checked {
  const taken = takeRepo(repo, rest);
  if ('refused' in taken) return refuse(taken.refused);
  const [first] = taken.rest;
  if (verb === 'view') {
    // Only a plain number: a URL or a branch name in this place could point at another repository.
    if (!isNumber(first)) return refuse(`gh ${group} view takes a plain number first`);
  } else if (first !== undefined && !first.startsWith('-')) {
    return refuse(`gh ${group} list takes no argument that is not an option`);
  }
  if (taken.rest.some((arg) => arg === '--web' || arg === '-w')) return refuse('--web would open a browser');
  return accept([group, verb, '--repo', repo, ...taken.rest]);
}

/** Options of gh api that only change how a read is made, and the options among them that take a value. */
const API_FLAGS = new Set(['--paginate', '--slurp']);
const API_VALUE_FLAGS = new Set(['--jq', '-q', '--cache']);

/** gh api: one read, the events of one issue of the configured repository, with read-only options. */
function checkGhApi(repo: string, args: string[]): Checked {
  const [, endpoint, ...options] = args;
  const wanted = `repos/${repo}/issues/`;
  const number = endpoint?.startsWith(wanted) && endpoint.endsWith('/events') ? endpoint.slice(wanted.length, -'/events'.length) : undefined;
  if (!isNumber(number)) return refuse(`gh api may only read ${wanted}<number>/events`);

  // gh api turns into a write when given a field (-f, -F), a body (--input) or another method (-X). So only the options on a short list pass.
  for (let i = 0; i < options.length; i++) {
    const option = options[i] as string;
    const name = option.split('=')[0] as string;
    if (API_FLAGS.has(option)) continue;
    if (API_VALUE_FLAGS.has(name)) {
      if (!option.includes('=')) i += 1; // the value is the next argument
      continue;
    }
    return refuse(`the gh api option ${name} is not on the list (read-only options only)`);
  }
  return accept(args);
}

/** The three writes. Each is one exact shape, because a write is the one thing that must not drift. */
function checkGhComment(repo: string, args: string[]): Checked {
  // gh issue comment <number> --body <text>
  const [, , number, flag, body] = args;
  if (args.length !== 5 || !isNumber(number) || flag !== '--body' || body === undefined) {
    return refuse('a comment is exactly: issue comment <number> --body <text>');
  }
  if (body.trim() === '') return refuse('a comment needs text');
  if (body.length > MAX_COMMENT_CHARS) return refuse(`a comment is at most ${MAX_COMMENT_CHARS} characters`);
  return accept(['issue', 'comment', '--repo', repo, number, '--body', body]);
}

function checkGhEdit(repo: string, args: string[]): Checked {
  // gh issue edit <number> with the label swap decision -> decided, and nothing else
  const [, , number, ...flags] = args;
  const add = ['--add-label', 'decided'];
  const remove = ['--remove-label', 'decision'];
  if (!isNumber(number) || !(sameList(flags, [...add, ...remove]) || sameList(flags, [...remove, ...add]))) {
    return refuse('an edit is exactly: issue edit <number> --add-label decided --remove-label decision');
  }
  return accept(['issue', 'edit', '--repo', repo, number, ...flags]);
}

function checkGhClose(repo: string, args: string[]): Checked {
  // gh issue close <number>
  const [, , number] = args;
  if (args.length !== 3 || !isNumber(number)) return refuse('a close is exactly: issue close <number>');
  return accept(['issue', 'close', '--repo', repo, number]);
}

function checkGh(config: Config, args: string[]): Checked {
  const [group, verb] = args;
  const repo = config.githubRepo;
  if (group === 'auth' && verb === 'status') {
    // Any option would be a risk (--show-token prints the token), and there is no use for one.
    return args.length === 2 ? accept(args) : refuse('gh auth status takes no options');
  }
  if (group === 'api') return checkGhApi(repo, args);
  if ((group === 'pr' || group === 'issue') && (verb === 'list' || verb === 'view')) return checkGhRead(repo, group, verb, args.slice(2));
  if (group === 'issue' && verb === 'comment') return checkGhComment(repo, args);
  if (group === 'issue' && verb === 'edit') return checkGhEdit(repo, args);
  if (group === 'issue' && verb === 'close') return checkGhClose(repo, args);
  return refuse(`gh ${[group, verb].filter(Boolean).join(' ') || '(nothing)'} is not on the list`);
}

function check(config: Config, cmd: string, args: unknown): Checked {
  if (cmd !== 'git' && cmd !== 'gh') return refuse('only git and gh can be run');
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) {
    return refuse('every argument must be text without a null character');
  }
  return cmd === 'git' ? checkGit(args as string[]) : checkGh(config, args as string[]);
}

// ---- the runner ----

/**
 * Names a call in a refusal message: the program and its command words ("gh issue edit"), never
 * the rest of the arguments, because those can hold a comment's text.
 */
function describeCall(cmd: string, args: unknown): string {
  const first = Array.isArray(args) ? args.slice(0, cmd === 'gh' ? 2 : 1) : [];
  const words = first.filter((arg): arg is string => typeof arg === 'string' && !arg.startsWith('-'));
  return [cmd, ...words].join(' ');
}

/**
 * The runner for this config.
 *
 * It refuses (by throwing a RunnerRefusal) any call that is not on the list, or whose working
 * folder is outside `config.roots`. For gh pr and gh issue it adds `--repo <githubRepo>` itself.
 * A program that starts and fails is not a refusal: it comes back as a result with its exit code.
 * Two cases get a code of their own, so a caller can tell them from a failure of the command:
 * 127 means the program is not installed, and 124 means it did not finish within `timeoutMs`.
 */
export function createRunner(config: Config, exec: Exec = execProcess): Runner {
  return async (cmd, args, o = {}) => {
    const refusal = (reason: string) => new RunnerRefusal(`${describeCall(cmd, args)} refused: ${reason}`);

    const checked = check(config, cmd, args);
    if ('refused' in checked) throw refusal(checked.refused);

    const cwd = resolve(o.cwd ?? config.repoRoot);
    if (!config.roots.some((root) => isInside(root, cwd))) throw refusal('the working folder is outside the allowed roots');

    const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
      throw refusal(`the time limit must be a whole number of milliseconds from 1 to ${MAX_TIMEOUT_MS}`);
    }

    return exec(cmd, checked.args, { cwd, timeoutMs });
  };
}

/** Settings that stop git and gh from waiting for a person: there is nobody at the keyboard. */
const QUIET_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  GH_PROMPT_DISABLED: '1',
  GH_NO_UPDATE_NOTIFIER: '1',
  NO_COLOR: '1',
  // Let a read-only git command skip the optional index lock, so it never gets in the way of Mark's own git.
  GIT_OPTIONAL_LOCKS: '0',
};

/**
 * Starts a program (`git` or `gh` here, found through PATH) and waits for it. It starts the real
 * program, never a .cmd shim and never through a shell, so the arguments are not re-read by a
 * shell and nothing in them can be taken for a command. It always gives a result:
 *
 * - the exit code, stdout and stderr, when the program ran;
 * - code 127 when the program is not installed;
 * - code 124 when it ran past `timeoutMs` and was stopped;
 * - code 1, with a message that says so, when the working folder does not exist.
 */
export function execProcess(file: string, args: string[], o: { cwd: string; timeoutMs: number }): Promise<RunResult> {
  return new Promise((done) => {
    const child = execFile(
      file,
      args,
      { cwd: o.cwd, timeout: o.timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true, encoding: 'utf8', env: { ...process.env, ...QUIET_ENV } },
      (error, stdout, stderr) => done(error ? describeFailure(file, o, error, stdout, stderr) : { code: 0, stdout, stderr }),
    );
    // Nobody types into the program: closing its input means one that waits for input ends instead of hanging.
    child.stdin?.end();
  });
}

function describeFailure(file: string, o: { cwd: string; timeoutMs: number }, error: ExecFileException, stdout: string, stderr: string): RunResult {
  if (error.code === 'ENOENT') {
    // Node reports a working folder that does not exist in the same way as a program that is not installed.
    if (!existsSync(o.cwd)) return { code: 1, stdout: '', stderr: `${file}: the working folder does not exist (${o.cwd})` };
    return { code: 127, stdout: '', stderr: `${file}: command not found` };
  }
  if (typeof error.code === 'number') return { code: error.code, stdout, stderr }; // it ran and exited with this code
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return { code: 1, stdout, stderr: `${file}: its output was larger than ${MAX_OUTPUT_BYTES} bytes` };
  if (error.killed) return { code: 124, stdout, stderr: `${file}: timed out after ${o.timeoutMs} ms` };
  return { code: 1, stdout, stderr: stderr || error.message };
}
