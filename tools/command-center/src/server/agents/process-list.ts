import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isMissing } from '../fs-errors';
import { codeOf } from '../sessions/reader';
import { readSmallJson } from '../sessions/tail';

// The process list of Claude Code: a folder (`~/.claude/sessions`) that holds one small `<pid>.json` for each Claude process that
// runs. The agents module starts from it, because "a session is active while its process runs" is a fact there and a guess from file
// ages anywhere else.
//
// The folder is an internal one of Claude Code, so its format can change with an update, and it also holds secrets: next to each
// `<pid>.json` there is a `<pid>.<hash>.key` file with a token. So this reader:
// - lists the folder and opens only the files named `<digits>.json`, never anything else;
// - keeps four keys of a file (the session id, the pid, the start time and busy or idle). Every other key (the working folder, the
//   name, the socket path, the bridge id ...) is dropped here, and the pid is dropped as soon as the process is known to be alive,
//   so nothing past this file can leak what it never had;
// - never throws for what it finds: a file that is malformed, of an unknown shape or not readable is skipped.

/** One Claude process that is alive, as far as this module needs to know. The pid is not in it. */
export type ProcessEntry = {
  /** The session that the process runs. It is a file name (`<id>.jsonl`), so it has been checked to hold no path. */
  sessionId: string;
  /** When the process started, in milliseconds since 1970, or null when the file does not say. */
  startedAtMs: number | null;
  /** `busy`: the session works. `idle`: it waits for Mark. */
  status: 'busy' | 'idle';
};

/**
 * The reading of the folder. `ok: false` means that the list cannot be used, and the module falls back to the file ages:
 * - `missing`: there is no such folder (an older Claude Code, or a machine that never ran one);
 * - `unreadable`: the folder is there and cannot be listed (`code` says why);
 * - `unknown-format`: the folder holds files named like process files and none has the expected shape, which is what an update that
 *   renames a key looks like. An empty folder is not that: it is a list that says nothing runs.
 */
export type ProcessList = { ok: true; entries: ProcessEntry[] } | { ok: false; reason: 'missing' | 'unreadable' | 'unknown-format'; code?: string };

/** Says whether a process with this id runs. Injected, so the tests need no real process. */
export type IsAlive = (pid: number) => boolean;

/**
 * Whether a process runs, by signal 0. Signal 0 sends nothing: the system only checks that the process exists. (It is not a kill: no
 * other signal is ever sent from here.) `EPERM` means that the process exists and belongs to another account, so it is alive;
 * `ESRCH` means that there is no such process. Any other answer is not taken for "alive".
 */
export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return codeOf(error) === 'EPERM';
  }
}

/** The name of a process file: the pid and `.json`. The `.key` files and every other name never match. */
const PROCESS_FILE = /^\d+\.json$/;

/** The characters of a session file name (the same ones as discover.ts allows), so an id from a file cannot reach another folder. */
const SESSION_ID = /^[\w-]{1,128}$/;

type Shaped = { pid: number; entry: ProcessEntry };

/** The four keys of a process file when they have the expected shape, else null. Everything else in the file is left where it is. */
function shapeOf(json: Record<string, unknown>): Shaped | null {
  const { sessionId, pid, startedAt, status } = json;
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return null;
  // A pid is a positive whole number. 0 and the negative ones are not processes: signal 0 to them goes to a whole group of processes.
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) return null;
  if (status !== 'busy' && status !== 'idle') return null;
  // A start time that is not a time is no reason to lose a session that runs: it is left out and the session has no start.
  const startedAtMs = typeof startedAt === 'number' && startedAt > 0 && !Number.isNaN(new Date(startedAt).getTime()) ? startedAt : null;
  return { pid, entry: { sessionId, startedAtMs, status } };
}

/** The older of two start times; a time beats null. */
const earlier = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.min(a, b));

/**
 * The Claude processes that run, from the files in `folder`. Each file is read once, and a process is kept when `isAlive` says so. Two
 * processes can run one session (a session that was resumed while the first one still runs): they give one entry, which is busy when
 * either is busy and began when the first one did. The entries come in the order of the pids.
 */
export async function readProcessList(folder: string, isAlive: IsAlive = processIsAlive): Promise<ProcessList> {
  let names: string[];
  try {
    // Only regular files: a folder, or a link, with the name of a process file is not one.
    names = (await readdir(folder, { withFileTypes: true })).filter((entry) => entry.isFile() && PROCESS_FILE.test(entry.name)).map((entry) => entry.name);
  } catch (error) {
    return { ok: false, reason: isMissing(error) ? 'missing' : 'unreadable', code: codeOf(error) };
  }
  names.sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));

  const bySession = new Map<string, ProcessEntry>();
  let shaped = 0;
  for (const name of names) {
    // `readSmallJson` gives null for a file that is empty, too big (64 KB: a process file has a few hundred bytes), not JSON or not an object. It throws
    // for a file that cannot be opened (locked, or no rights). Both mean "skip it"; the files are read one by one, so a big folder cannot open them all at once.
    let json: Record<string, unknown> | null = null;
    try {
      json = await readSmallJson(join(folder, name));
    } catch {
      continue;
    }
    const found = json === null ? null : shapeOf(json);
    if (found === null) continue;
    shaped += 1;

    let alive = false;
    try {
      alive = isAlive(found.pid);
    } catch {
      // A check that fails says nothing, and "not alive" is the safe answer: the session is left out, not invented.
    }
    if (!alive) continue;

    const same = bySession.get(found.entry.sessionId);
    bySession.set(
      found.entry.sessionId,
      same === undefined ? found.entry : { sessionId: same.sessionId, startedAtMs: earlier(same.startedAtMs, found.entry.startedAtMs), status: same.status === 'busy' || found.entry.status === 'busy' ? 'busy' : 'idle' },
    );
  }

  if (names.length > 0 && shaped === 0) return { ok: false, reason: 'unknown-format' };
  return { ok: true, entries: [...bySession.values()] };
}
