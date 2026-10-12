// The `live` key (design.md sections 4.3 and 11.1): what the local reporter writes to Upstash Redis and `/api/live` hands to the page.
// This file is the contract between the reporter (step 5) and the hosted page (step 4). It is pure, so both can import it.
//
// The reporter sends an allow-list of fields and nothing else: titles, names and counts. Never message text, never file bodies. The page
// reads the value with `parseLive`, which refuses anything that is not this shape, so a change on the reporter side shows as an error and
// never as wrong rows.

/** One Claude Code session on the machine of the reporter. `title` is transcript text: a page shows it as text. */
export type LiveSessionRow = {
  id: string;
  title: string;
  /** The git branch of the session ("" when it has none). The Workstreams view joins sessions to workstreams by this name. */
  branch: string;
  /** The name of the folder of its working directory, never the full path. */
  folder: string;
  /** `working`: the process is busy. `waiting`: it is idle and waits for Mark. */
  state: 'working' | 'waiting';
  /** When the process started (an ISO time), or null. */
  startedAt: string | null;
  /** Counts of the agents of the session, with their names. Names are descriptions that the agents were given, not message text. */
  agents: { running: number; done: number; names: string[] };
};

/** One checkout (the main folder or a worktree) on the machine of the reporter. */
export type LiveWorktree = {
  /** The folder of the checkout. */
  path: string;
  /** The branch that is checked out, or null for a detached HEAD. */
  branch: string | null;
  /** How many files differ from the last commit (changed, new or removed). */
  dirty: number;
};

/** The whole value of the key `live`. */
export type LiveState = {
  /** When the reporter wrote it (an ISO time). The page marks the rows stale when this is older than 150 s. */
  writtenAt: string;
  sessions: LiveSessionRow[];
  worktrees: LiveWorktree[];
};

export type ParsedLive = { ok: true; live: LiveState } | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

function sessionRow(value: unknown, index: number): LiveSessionRow | string {
  const where = `sessions[${index}]`;
  if (!isRecord(value)) return `${where} is not an object`;
  const { id, title, branch, folder, state, startedAt, agents } = value;
  if (typeof id !== 'string' || id === '') return `${where}.id must be a non-empty text`;
  if (typeof title !== 'string') return `${where}.title must be a text`;
  if (typeof branch !== 'string') return `${where}.branch must be a text`;
  if (typeof folder !== 'string') return `${where}.folder must be a text`;
  if (state !== 'working' && state !== 'waiting') return `${where}.state must be "working" or "waiting"`;
  if (!(startedAt === null || typeof startedAt === 'string')) return `${where}.startedAt must be a text or null`;
  if (!isRecord(agents) || !isCount(agents.running) || !isCount(agents.done)) return `${where}.agents must have whole-number counts "running" and "done"`;
  const names = agents.names ?? [];
  if (!(Array.isArray(names) && names.every((name) => typeof name === 'string'))) return `${where}.agents.names must be a list of texts`;
  return { id, title, branch, folder, state, startedAt, agents: { running: agents.running, done: agents.done, names: names as string[] } };
}

function worktreeRow(value: unknown, index: number): LiveWorktree | string {
  const where = `worktrees[${index}]`;
  if (!isRecord(value)) return `${where} is not an object`;
  const { path, branch, dirty } = value;
  if (typeof path !== 'string' || path === '') return `${where}.path must be a non-empty text`;
  if (!(branch === null || typeof branch === 'string')) return `${where}.branch must be a text or null`;
  if (!isCount(dirty)) return `${where}.dirty must be a whole number`;
  return { path, branch, dirty };
}

/**
 * Reads the `live` value of `/api/live`. It never throws. A value of the wrong shape gives `{ ok: false, reason }` with the first problem found, so the page can say what is wrong.
 * Fields that the contract does not name are ignored (a newer reporter may send more).
 */
export function parseLive(value: unknown): ParsedLive {
  if (!isRecord(value)) return { ok: false, reason: 'the live value is not an object' };
  if (typeof value.writtenAt !== 'string' || Number.isNaN(Date.parse(value.writtenAt))) return { ok: false, reason: 'writtenAt must be a time' };
  if (!Array.isArray(value.sessions)) return { ok: false, reason: 'sessions must be a list' };
  if (!Array.isArray(value.worktrees)) return { ok: false, reason: 'worktrees must be a list' };

  const sessions: LiveSessionRow[] = [];
  for (const [index, raw] of value.sessions.entries()) {
    const row = sessionRow(raw, index);
    if (typeof row === 'string') return { ok: false, reason: row };
    sessions.push(row);
  }
  const worktrees: LiveWorktree[] = [];
  for (const [index, raw] of value.worktrees.entries()) {
    const row = worktreeRow(raw, index);
    if (typeof row === 'string') return { ok: false, reason: row };
    worktrees.push(row);
  }
  return { ok: true, live: { writtenAt: value.writtenAt, sessions, worktrees } };
}
