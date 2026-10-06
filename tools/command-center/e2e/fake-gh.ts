import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Exec, RunResult } from '../src/server/runner';

// A fake `gh` for the end-to-end tests. The end-to-end server (e2e/server.ts) puts it under the
// real runner, so no test ever talks to GitHub, and the runner's allow-list still applies.
//
// Two processes use it: the server (which runs the fake) and the Playwright test (which sets
// its mode and reads what it was asked). They meet in two files in a folder under the OS temp
// folder:
//
//   gh-mode.json    what the fake does now. A test writes it with setGhMode(); the fake reads
//                   it at every call, so a mode can change in the middle of a test.
//   gh-calls.jsonl  one line for every call the fake got. A test reads it with readGhCalls().
//
// A test imports setGhMode, readGhCalls, clearGhCalls and resetGh. Only the server calls createFakeGh.

/** The folder the end-to-end server and its tests share. */
export const E2E_DIR = join(tmpdir(), 'cc-e2e');

const MODE_FILE = 'gh-mode.json';
const CALLS_FILE = 'gh-calls.jsonl';

/**
 * What the fake does:
 * - ok: answers like a signed-in gh (a reply from `replies` when the test set one, else empty data).
 * - signed-out: gh is installed but not logged in.
 * - missing: gh is not installed (the runner reports that as code 127).
 * - offline: gh cannot reach GitHub.
 * - timeout: gh ran past its time limit (the runner reports that as code 124).
 * - write-fails: works like ok, except that the write named in `step` fails.
 */
export type GhModeName = 'ok' | 'signed-out' | 'missing' | 'offline' | 'timeout' | 'write-fails';

/** The three writes of a decision answer, in the order the server makes them. */
export type GhWriteStep = 'comment' | 'edit' | 'close';

export type GhReply = { code?: number; stdout?: string; stderr?: string };

export type GhMode = {
  mode: GhModeName;
  /** Which write fails. Required when mode is write-fails. */
  step?: GhWriteStep;
  /**
   * Replies for the ok mode, by key. The key is the command and, if it has one, the issue or PR
   * number: "pr list", "issue view", "issue view 7", "auth status", "api events", "api events 7",
   * "issue comment". The key with the number wins over the one without. A reply sets any of
   * code (default 0), stdout and stderr (default empty).
   */
  replies?: Record<string, GhReply>;
};

/** One call the fake got, as the server's runner made it (so `args` holds the pinned --repo). */
export type GhCall = { at: string; args: string[]; cwd: string; mode: GhModeName; code: number };

const MODES: readonly string[] = ['ok', 'signed-out', 'missing', 'offline', 'timeout', 'write-fails'];
const STEPS: readonly string[] = ['comment', 'edit', 'close'];

// ---- for the tests ----

/** Sets what the fake does from now on. */
export function setGhMode(mode: GhMode, dir: string = E2E_DIR): void {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, MODE_FILE);
  // Written to a side file and moved into place, so the server never reads half a file.
  const side = `${target}.${process.pid}.tmp`;
  writeFileSync(side, JSON.stringify(mode));
  try {
    renameSync(side, target);
  } catch {
    writeFileSync(target, JSON.stringify(mode));
    rmSync(side, { force: true });
  }
}

/** Every call the fake got since the last clear, in order. */
export function readGhCalls(dir: string = E2E_DIR): GhCall[] {
  let text: string;
  try {
    text = readFileSync(join(dir, CALLS_FILE), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as GhCall);
}

/** Forgets the recorded calls. The mode stays. */
export function clearGhCalls(dir: string = E2E_DIR): void {
  rmSync(join(dir, CALLS_FILE), { force: true });
}

/** Back to the start: the ok mode with no set replies, and no recorded calls. */
export function resetGh(dir: string = E2E_DIR): void {
  rmSync(join(dir, MODE_FILE), { force: true });
  clearGhCalls(dir);
}

// ---- for the server ----

/** Reads the mode file. No file means the ok mode. A file that cannot be used is an error, never a silent ok. */
function readMode(dir: string): GhMode {
  const file = join(dir, MODE_FILE);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { mode: 'ok' };
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${file} is not valid JSON, so the fake gh does not know what to do.`);
  }
  const mode = parsed as Partial<GhMode> | null;
  if (typeof mode !== 'object' || mode === null || typeof mode.mode !== 'string' || !MODES.includes(mode.mode)) {
    throw new Error(`${file} must hold { "mode": one of ${MODES.join(', ')} }.`);
  }
  if (mode.mode === 'write-fails' && (typeof mode.step !== 'string' || !STEPS.includes(mode.step))) {
    throw new Error(`${file}: the write-fails mode needs a "step": one of ${STEPS.join(', ')}.`);
  }
  return mode as GhMode;
}

/** Which of the three writes a call is, or null for any other call. */
function writeStepOf(args: string[]): GhWriteStep | null {
  const [group, verb] = args;
  if (group !== 'issue') return null;
  if (verb === 'comment' || verb === 'edit' || verb === 'close') return verb;
  return null;
}

/** The reply keys of a call, the most specific first. See GhMode.replies. */
function replyKeys(args: string[]): string[] {
  const [group, verb] = args;
  if (group === 'api') {
    const number = args[1]?.match(/\/issues\/(\d+)\/events$/)?.[1];
    return number ? [`api events ${number}`, 'api events'] : ['api events'];
  }
  if (group === 'auth') return ['auth status'];
  // The first plain number that is not the value of an option (so "--limit 30" is not an issue number).
  const number = args.slice(2).find((arg, i) => /^\d+$/.test(arg) && !(args[i + 1] ?? '').startsWith('-'));
  const base = `${group} ${verb}`;
  return number ? [`${base} ${number}`, base] : [base];
}

const SIGNED_OUT_STATUS = 'You are not logged into any GitHub hosts. To log in, run: gh auth login';
const SIGNED_OUT_OTHER = 'gh: To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.';
const WRITE_FAILURES: Record<GhWriteStep, string> = {
  comment: 'failed to create the comment: HTTP 502: Bad Gateway',
  edit: 'failed to change the labels: HTTP 502: Bad Gateway',
  close: 'failed to close the issue: HTTP 502: Bad Gateway',
};

function answer(mode: GhMode, args: string[], timeoutMs: number): RunResult {
  const isStatus = args[0] === 'auth' && args[1] === 'status';
  switch (mode.mode) {
    case 'signed-out':
      return isStatus ? { code: 1, stdout: '', stderr: SIGNED_OUT_STATUS } : { code: 4, stdout: '', stderr: SIGNED_OUT_OTHER };
    case 'missing':
      return { code: 127, stdout: '', stderr: 'gh: command not found' };
    case 'offline':
      return { code: 1, stdout: '', stderr: 'error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com' };
    case 'timeout':
      return { code: 124, stdout: '', stderr: `gh: timed out after ${timeoutMs} ms` };
    case 'write-fails':
    case 'ok': {
      const step = writeStepOf(args);
      if (mode.mode === 'write-fails' && step !== null && step === mode.step) return { code: 1, stdout: '', stderr: WRITE_FAILURES[step] };
      return okReply(mode, args);
    }
  }
}

function okReply(mode: GhMode, args: string[]): RunResult {
  for (const key of replyKeys(args)) {
    const reply = mode.replies?.[key];
    if (reply) return { code: reply.code ?? 0, stdout: reply.stdout ?? '', stderr: reply.stderr ?? '' };
  }
  const [group, verb] = args;
  if (group === 'auth') return { code: 0, stdout: 'github.com\n  Logged in to github.com account fixture-user', stderr: '' };
  if (group === 'api' || verb === 'list') return { code: 0, stdout: '[]', stderr: '' };
  if (verb === 'view') return { code: 0, stdout: '{}', stderr: '' };
  return { code: 0, stdout: '', stderr: '' }; // a write
}

/**
 * The fake gh, as an Exec for createRunner. It reads the mode at every call, answers, and records
 * the call. `dir` is the folder that holds the two files (the same one the test uses).
 */
export function createFakeGh(dir: string = E2E_DIR): Exec {
  return async (cmd, args, o) => {
    if (cmd !== 'gh') throw new Error(`the fake gh was started as "${cmd}": route git to the real git`);
    const mode = readMode(dir);
    const result = answer(mode, args, o.timeoutMs);
    mkdirSync(dir, { recursive: true });
    const call: GhCall = { at: new Date().toISOString(), args, cwd: o.cwd, mode: mode.mode, code: result.code };
    appendFileSync(join(dir, CALLS_FILE), `${JSON.stringify(call)}\n`);
    return result;
  };
}
