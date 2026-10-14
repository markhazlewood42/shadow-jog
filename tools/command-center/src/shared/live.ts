// The `live` key (design.md sections 4.3 and 11.1): what the local reporter writes to Upstash Redis and `/api/live` hands to the page.
// This file is the contract between the reporter (step 5) and the hosted page (step 4). It is pure, so both can import it.
//
// The reporter sends an allow-list of fields and nothing else: titles, names and counts, and, for a live session whose newest "Your move" box
// still waits for Mark, at most 6 lines of that box (each cut to 160 characters and redacted) with the time of the box. Nothing else of any
// message, never file bodies. The page reads the value with `parseLive`, which refuses anything that is not this shape, so a change on the
// reporter side shows as an error and never as wrong rows.

import { ASK_MAX_CHARS, ASK_MAX_LINES, cutLine } from './your-move';

/** The reporter is offline when `writtenAt` is older than this (design.md section 7). The page shows "Reporter offline" and hides every live ask. */
export const LIVE_OFFLINE_AFTER_SECONDS = 150;

/** The caps of the agent boxes of one session. The mapper of the reporter and the validator below both use them, so that they cannot drift apart. */
export const LIVE_ITEM_LIMITS = { items: 20, label: 80 } as const;

/**
 * The only model values that the live contract carries. A model id of Claude holds its family (`claude-fable-5-1`: `fable`); any other value (a key, a path, an address, a name that
 * this page does not know) is not a family, so it is no model (null). A fixed set cannot hold a secret or a path, whatever the redaction rules miss.
 */
export const LIVE_MODEL_FAMILIES: readonly string[] = ['opus', 'sonnet', 'haiku', 'fable'];

/** The model of an agent as the contract allows it: one of the families, else null. The reporter and the reader of the value both use it. */
export const liveModelOf = (value: unknown): string | null => (typeof value === 'string' && LIVE_MODEL_FAMILIES.includes(value) ? value : null);

/**
 * One agent of a live session, for a box on the hosted Agents page (approved by Mark 2026-10-14): its description (redacted and cut like a name), running or done,
 * the model as a family name (`opus`, `sonnet`, `haiku` or `fable`, else null), and its start and end times (ISO times, or null). Nothing else of the agent leaves the machine.
 */
export type LiveAgentItem = { label: string; state: 'running' | 'done'; model: string | null; startedAt: string | null; endedAt: string | null };

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
  agents: { running: number; done: number; names: string[]; /** The agents with their state, model and times, in session order. Missing from an older reporter: then the page draws the names. */ items?: LiveAgentItem[] };
  /**
   * The newest "Your move" box of the session, when it passes the four rules of src/shared/your-move.ts (the session is live, Mark has not answered, the box does not say
   * "nothing", and it is less than 12 hours old), else null. `lines` are plain text, at most 6, each at most 160 characters, redacted like a title. `at` is the time of the
   * reply that wrote the box (an ISO time). This is the one place where a few words of a message leave the machine (your-move-redesign.md section 4).
   */
  yourMove: { at: string; lines: string[] } | null;
};

/** One checkout (the main folder or a worktree) on the machine of the reporter. */
export type LiveWorktree = {
  /** The NAME of the last folder of the checkout, never the full path (the full path shows the user name and the layout of the machine). A label only: the page joins a worktree to its workstream by `branch`. */
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
  const items = itemsOf(agents.items, `${where}.agents.items`);
  if (typeof items === 'string') return items;
  const ask = askOf(value.yourMove, where);
  if (typeof ask === 'string') return ask;
  const counts = { running: agents.running, done: agents.done, names: names as string[] };
  return { id, title, branch, folder, state, startedAt, agents: items === undefined ? counts : { ...counts, items }, yourMove: ask };
}

const isTimeOrNull = (value: unknown): value is string | null => value === null || (typeof value === 'string' && !Number.isNaN(Date.parse(value)));

/**
 * The `agents.items` field of a row. Missing (an older reporter) is fine and gives undefined. A value of the wrong shape refuses the whole value, and so does a list or a text
 * that is over its cap: the reporter cuts them, so a longer one was not written by it. Each item is built again from the fields that the contract names.
 */
function itemsOf(value: unknown, where: string): LiveAgentItem[] | undefined | string {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return `${where} must be a list`;
  if (value.length > LIVE_ITEM_LIMITS.items) return `${where} has more than ${LIVE_ITEM_LIMITS.items} items`;
  const out: LiveAgentItem[] = [];
  for (const [index, raw] of value.entries()) {
    const at = `${where}[${index}]`;
    if (!isRecord(raw)) return `${at} is not an object`;
    const { label, state, model, startedAt, endedAt } = raw;
    if (typeof label !== 'string' || label.length > LIVE_ITEM_LIMITS.label) return `${at}.label must be a text of at most ${LIVE_ITEM_LIMITS.label} characters`;
    if (state !== 'running' && state !== 'done') return `${at}.state must be "running" or "done"`;
    if (!(model === null || typeof model === 'string')) return `${at}.model must be null or a text`;
    if (!isTimeOrNull(startedAt)) return `${at}.startedAt must be a time or null`;
    if (!isTimeOrNull(endedAt)) return `${at}.endedAt must be a time or null`;
    // A model that is not one of the families is read as no model, not as a reason to refuse the whole value: the page never shows it.
    out.push({ label, state, model: liveModelOf(model), startedAt, endedAt });
  }
  return out;
}

/**
 * The `yourMove` field of a row. A missing field (an older reporter) or null is "no ask". A value of the wrong shape is a problem, and the whole value is refused.
 * The caps are applied here too, so that even a reporter with a bug cannot send, or a page show, more than 6 lines of 160 characters: the lines beyond the sixth are
 * dropped and a longer line is cut. An empty line is dropped.
 */
function askOf(value: unknown, where: string): { at: string; lines: string[] } | null | string {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return `${where}.yourMove must be an object or null`;
  const { at, lines } = value;
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return `${where}.yourMove.at must be a time`;
  if (!(Array.isArray(lines) && lines.every((line) => typeof line === 'string'))) return `${where}.yourMove.lines must be a list of texts`;
  // The cut-and-cap (at most 6 lines of 160 characters) repeats on purpose in three places: the mapper of the reporter (src/server/publish/map.ts), here, and the local page
  // (src/server/now/yourMove.ts, plus askItems in src/shared/your-move.ts). Each is a trust boundary of its own and must not rely on the one before it. This one guards
  // the value that comes back from the store, which anyone with the store key could have written.
  const kept = (lines as string[])
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .slice(0, ASK_MAX_LINES)
    .map((line) => cutLine(line, ASK_MAX_CHARS));
  return kept.length === 0 ? null : { at, lines: kept };
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
