import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Exec, RunResult } from '../src/server/runner';

// A fake `gh` for the end-to-end tests. The end-to-end server (e2e/server.ts) puts it under the
// real runner, so no test ever talks to GitHub, and the runner's allow-list still applies.
//
// Two processes use it: the server (which runs the fake) and the Playwright test (which sets
// its mode and reads what it was asked). They meet in three files in a folder under the OS temp
// folder:
//
//   gh-mode.json    what the fake does now. A test writes it with setGhMode(); the fake reads
//                   it at every call, so a mode can change in the middle of a test.
//   gh-calls.jsonl  one line for every call the fake got. A test reads it with readGhCalls().
//   gh-issues.json  the issues of the fake repository, and the labels that it has. A test writes it
//                   with setGhIssues() and reads it back with readGhIssues(). The fake answers the
//                   reads of the decision inbox from it (`issue list`, `issue view` and the events of
//                   an issue), and applies the three writes of an answer to it (a comment, the label
//                   swap and the close), so the next read shows what the write did, as GitHub does.
//
// A test imports setGhMode, setGhIssues, readGhIssues, readGhCalls, clearGhCalls and resetGh. Only the server calls createFakeGh.

/** The folder the end-to-end server and its tests share. */
export const E2E_DIR = join(tmpdir(), 'cc-e2e');

const MODE_FILE = 'gh-mode.json';
const CALLS_FILE = 'gh-calls.jsonl';
const ISSUES_FILE = 'gh-issues.json';

/** The account that the fake is signed in as: the one that writes a comment, sets a label and closes an issue. It is Mark's login, as on his machine. */
export const FAKE_VIEWER = 'markhazlewood42';

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
   * number: "pr list", "run list", "issue view", "issue view 7", "auth status", "api events", "api events 7",
   * "issue comment". The key with the number wins over the one without. A reply sets any of
   * code (default 0), stdout and stderr (default empty; the default of "run list" is one run that passed, see cannedRun).
   */
  replies?: Record<string, GhReply>;
};

/** One call the fake got, as the server's runner made it (so `args` holds the pinned --repo). */
export type GhCall = { at: string; args: string[]; cwd: string; mode: GhModeName; code: number };

type Json = Record<string, unknown>;

/**
 * An issue of the fake repository, as `gh issue view --json` prints it (a field that a test does not need can be left out),
 * and with the events of the issue: what `gh api repos/<repo>/issues/<n>/events` prints. The fake never prints `events`
 * in an issue, and a write adds the events that GitHub would add.
 */
export type FakeIssue = {
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'CLOSED';
  labels: { name: string; [field: string]: unknown }[];
  author: { login: string; [field: string]: unknown };
  body: string;
  comments: Json[];
  createdAt: string;
  updatedAt?: string;
  events: Json[];
};

/** What the issue file holds: the labels that the repository has (the label swap of an answer needs `decided` and `decision`; leave it out for a repository that has every label), and the issues. */
export type GhIssueStore = { labels?: string[]; issues: FakeIssue[] };

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

/** Back to the start: the ok mode with no set replies, no issues, and no recorded calls. */
export function resetGh(dir: string = E2E_DIR): void {
  rmSync(join(dir, MODE_FILE), { force: true });
  rmSync(join(dir, ISSUES_FILE), { force: true });
  clearGhCalls(dir);
}

/** Writes a file so that a reader never sees half of it: to a side file first, and then moved into place. */
function writeWhole(target: string, text: string): void {
  const side = `${target}.${process.pid}.tmp`;
  writeFileSync(side, text);
  try {
    renameSync(side, target);
  } catch {
    writeFileSync(target, text);
    rmSync(side, { force: true });
  }
}

/** Puts these issues (and the labels of the repository) into the fake repository. The reads of the fake answer from them from now on. */
export function setGhIssues(store: GhIssueStore, dir: string = E2E_DIR): void {
  mkdirSync(dir, { recursive: true });
  writeWhole(join(dir, ISSUES_FILE), JSON.stringify(store));
}

/** The issues of the fake repository as they are now (after the writes that it got), or null when a test never set any. */
export function readGhIssues(dir: string = E2E_DIR): GhIssueStore | null {
  return readStore(dir);
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

/** The issue or pull request number of a call: the first plain number that is not the value of an option (so "--limit 30" is not one). */
function numberOf(args: string[]): string | undefined {
  return args.slice(2).find((arg, i) => /^\d+$/.test(arg) && !(args[i + 1] ?? '').startsWith('-'));
}

/** The reply keys of a call, the most specific first. See GhMode.replies. */
function replyKeys(args: string[]): string[] {
  const [group, verb] = args;
  if (group === 'api') {
    const number = args[1]?.match(/\/issues\/(\d+)\/events$/)?.[1];
    return number ? [`api events ${number}`, 'api events'] : ['api events'];
  }
  if (group === 'auth') return ['auth status'];
  const number = numberOf(args);
  const base = `${group} ${verb}`;
  return number ? [`${base} ${number}`, base] : [base];
}

// ---- the issue store ----

/** Reads the issue file. No file means that no test set any issues (null). A file that cannot be used is an error, never an empty answer. */
function readStore(dir: string): GhIssueStore | null {
  const file = join(dir, ISSUES_FILE);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${file} is not valid JSON, so the fake gh does not know what its issues are.`);
  }
  const store = parsed as Partial<GhIssueStore> | null;
  if (typeof store !== 'object' || store === null || !Array.isArray(store.issues)) {
    throw new Error(`${file} must hold { "issues": [ ... ] } and, if it needs to, "labels": [ ... ].`);
  }
  return store as GhIssueStore;
}

/** The values that follow a flag, in order (`--label a --label b` gives ["a", "b"]). */
function valuesOf(args: string[], flag: string): string[] {
  return args.flatMap((arg, i) => (arg === flag && args[i + 1] !== undefined ? [args[i + 1] as string] : []));
}

/** What gh prints for an issue that is not there. */
const notFound = (number: string | undefined): RunResult => ({
  code: 1,
  stdout: '',
  stderr: `GraphQL: Could not resolve to an issue or pull request with the number of ${number ?? '(none)'}. (repository.issue)`,
});

/** The time as GitHub writes it: whole seconds, in UTC. */
const timeNow = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

/** `gh issue list --json comments` prints the first 100 comments of each issue and no more (checked on a real issue with 149). `gh issue view` prints them all. */
const LIST_COMMENT_LIMIT = 100;

/**
 * An issue as `gh ... --json <fields>` prints it: only the fields that were asked for (all of them when none was), and never the events.
 * `commentLimit` cuts the comments to the first so many, as gh does for a list.
 */
function printedIssue(issue: FakeIssue, fields: string[], commentLimit = Number.POSITIVE_INFINITY): Json {
  const { events: _events, ...everything } = issue;
  const all = { ...everything, comments: everything.comments.slice(0, commentLimit) };
  if (fields.length === 0) return all;
  return Object.fromEntries(fields.flatMap((field) => (field in all ? [[field, (all as Json)[field]]] : [])));
}

function storeList(store: GhIssueStore, args: string[]): RunResult {
  const wanted = valuesOf(args, '--label').map((label) => label.toLowerCase());
  // `--author` keeps the issues of one account (the search of GitHub does not tell logins apart by case). It comes before the limit, as in GitHub's own search.
  const author = valuesOf(args, '--author')[0]?.toLowerCase();
  const state = (valuesOf(args, '--state')[0] ?? 'open').toLowerCase();
  const limit = Number(valuesOf(args, '--limit')[0] ?? 30);
  const fields = (valuesOf(args, '--json')[0] ?? '').split(',').filter((field) => field !== '');
  const found = store.issues
    .filter((issue) => author === undefined || issue.author.login.toLowerCase() === author)
    .filter((issue) => (state === 'all' || issue.state.toLowerCase() === state) && wanted.every((label) => issue.labels.some((have) => have.name.toLowerCase() === label)))
    .sort((a, b) => b.number - a.number)
    .slice(0, limit);
  return { code: 0, stdout: JSON.stringify(found.map((issue) => printedIssue(issue, fields, LIST_COMMENT_LIMIT))), stderr: '' };
}

/** `gh api repos/<repo>/issues/<n>/events`: the events of an issue. With --paginate --slurp gh prints a list of pages, and the fake has one page. */
function storeEvents(store: GhIssueStore, args: string[]): RunResult {
  const number = args[1]?.match(/^repos\/[^/]+\/[^/]+\/issues\/(\d+)\/events$/)?.[1];
  const issue = store.issues.find((candidate) => String(candidate.number) === number);
  if (issue === undefined) {
    // The API answers a missing issue with this body, and gh prints it, and then says "Not Found" on stderr with exit code 1.
    return { code: 1, stdout: '{"message":"Not Found","status":"404"}', stderr: 'gh: Not Found (HTTP 404)' };
  }
  return { code: 0, stdout: JSON.stringify(args.includes('--slurp') ? [issue.events] : issue.events), stderr: '' };
}

/** The label with this name as it is on the issues of the store (its color and words), or a plain one. */
function labelNamed(store: GhIssueStore, name: string): FakeIssue['labels'][number] {
  return store.issues.flatMap((issue) => issue.labels).find((label) => label.name.toLowerCase() === name.toLowerCase()) ?? { name, color: 'ededed' };
}

/** One of the three writes of an answer, applied to the issue. It leaves the events that GitHub leaves, with the signed-in account as the actor. */
function storeWrite(dir: string, store: GhIssueStore, verb: GhWriteStep, args: string[]): RunResult {
  const number = numberOf(args);
  const issue = store.issues.find((candidate) => String(candidate.number) === number);
  if (issue === undefined) return notFound(number);
  const at = timeNow();
  const event = (name: string, label?: { name: string; [field: string]: unknown }): Json => ({
    id: 9_000_000_000 + issue.events.length + 1,
    actor: { login: FAKE_VIEWER, type: 'User' },
    event: name,
    created_at: at,
    ...(label === undefined ? {} : { label: { name: label.name, color: label.color } }),
  });
  let stdout = issue.url;

  if (verb === 'comment') {
    const id = `IC_fake_${issue.comments.length + 1}`;
    stdout = `${issue.url}#issuecomment-${id}`;
    issue.comments.push({
      id,
      author: { login: FAKE_VIEWER },
      authorAssociation: 'OWNER',
      body: valuesOf(args, '--body')[0] ?? '',
      createdAt: at,
      includesCreatedEdit: false,
      isMinimized: false,
      minimizedReason: '',
      reactionGroups: [],
      url: stdout,
      viewerDidAuthor: true,
    });
  } else if (verb === 'edit') {
    const add = valuesOf(args, '--add-label');
    const remove = valuesOf(args, '--remove-label');
    // gh looks every name up among the labels of the repository first, and stops at one that is not there, with nothing changed.
    const known = store.labels?.map((label) => label.toLowerCase());
    const missing = known === undefined ? undefined : [...add, ...remove].find((name) => !known.includes(name.toLowerCase()));
    if (missing !== undefined) return { code: 1, stdout: '', stderr: `failed to update ${issue.url}: '${missing}' not found` };
    for (const name of add) {
      if (!issue.labels.some((have) => have.name.toLowerCase() === name.toLowerCase())) {
        const label = labelNamed(store, name);
        issue.labels.push(label);
        issue.events.push(event('labeled', label));
      }
    }
    for (const name of remove) {
      const position = issue.labels.findIndex((have) => have.name.toLowerCase() === name.toLowerCase());
      if (position !== -1) {
        const [label] = issue.labels.splice(position, 1);
        issue.events.push(event('unlabeled', label));
      }
    }
  } else if (issue.state === 'CLOSED') {
    return { code: 0, stdout: `! Issue #${issue.number} (${issue.title}) is already closed`, stderr: '' };
  } else {
    issue.state = 'CLOSED';
    issue.events.push(event('closed'));
    stdout = `✓ Closed issue #${issue.number} (${issue.title})`;
  }

  issue.updatedAt = at;
  writeWhole(join(dir, ISSUES_FILE), JSON.stringify(store));
  return { code: 0, stdout, stderr: '' };
}

/**
 * The answer of the issue store to a call, or null when the call is not one that the store answers (or no test set any
 * issues). The store answers the reads of the decision inbox, and the three writes of an answer.
 */
function storeReply(dir: string, args: string[]): RunResult | null {
  const store = readStore(dir);
  if (store === null) return null;
  const [group, verb] = args;
  if (group === 'api') return storeEvents(store, args);
  if (group !== 'issue') return null;
  if (verb === 'list') return storeList(store, args);
  if (verb === 'view') {
    const number = numberOf(args);
    const issue = store.issues.find((candidate) => String(candidate.number) === number);
    return issue === undefined ? notFound(number) : { code: 0, stdout: JSON.stringify(printedIssue(issue, (valuesOf(args, '--json')[0] ?? '').split(',').filter((field) => field !== ''))), stderr: '' };
  }
  if (verb === 'comment' || verb === 'edit' || verb === 'close') return storeWrite(dir, store, verb, args);
  return null;
}

/**
 * What `gh run list --workflow ci.yml --branch main --limit 1 --json status,conclusion,url,createdAt` prints in the fake world when a test has set no reply: the one newest run of main,
 * finished and passed, at a fixed time. Its address is in the repository that the runner pinned with `--repo`. A test that wants another run, or none, sets the reply "run list".
 */
function cannedRun(args: string[]): string {
  const at = args.indexOf('--repo');
  const repo = (at === -1 ? undefined : args[at + 1]) ?? 'fixture-owner/fixture-repo';
  return JSON.stringify([{ status: 'completed', conclusion: 'success', url: `https://github.com/${repo}/actions/runs/9001`, createdAt: '2026-10-06T10:00:00Z' }]);
}

const SIGNED_OUT_STATUS = 'You are not logged into any GitHub hosts. To log in, run: gh auth login';
const SIGNED_OUT_OTHER = 'gh: To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.';
const WRITE_FAILURES: Record<GhWriteStep, string> = {
  comment: 'failed to create the comment: HTTP 502: Bad Gateway',
  edit: 'failed to change the labels: HTTP 502: Bad Gateway',
  close: 'failed to close the issue: HTTP 502: Bad Gateway',
};

function answer(mode: GhMode, args: string[], timeoutMs: number, dir: string): RunResult {
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
      return okReply(mode, args, dir);
    }
  }
}

function okReply(mode: GhMode, args: string[], dir: string): RunResult {
  // A reply that a test set wins. Then the issue store, when a test set issues. Then the canned run of `run list`, and for any other read empty data.
  for (const key of replyKeys(args)) {
    const reply = mode.replies?.[key];
    if (reply) return { code: reply.code ?? 0, stdout: reply.stdout ?? '', stderr: reply.stderr ?? '' };
  }
  const stored = storeReply(dir, args);
  if (stored !== null) return stored;
  const [group, verb] = args;
  if (group === 'auth') return { code: 0, stdout: 'github.com\n  Logged in to github.com account fixture-user', stderr: '' };
  if (group === 'run' && verb === 'list') return { code: 0, stdout: cannedRun(args), stderr: '' };
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
    const result = answer(mode, args, o.timeoutMs, dir);
    mkdirSync(dir, { recursive: true });
    const call: GhCall = { at: new Date().toISOString(), args, cwd: o.cwd, mode: mode.mode, code: result.code };
    appendFileSync(join(dir, CALLS_FILE), `${JSON.stringify(call)}\n`);
    return result;
  };
}
