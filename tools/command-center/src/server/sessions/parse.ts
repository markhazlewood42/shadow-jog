import type { SessionState, YourMoveBox } from '../../shared/types';
import { cwdInsideRoots } from './discover';

// The line parser of the sessions module: pure functions that read what the lines of a Claude Code
// session file mean. A line is whatever JSON holds (see tail.ts), and the format is Claude Code's, which
// a later version can change. So none of these functions throws for a line it does not expect: it reads
// past it, and where nothing can be read it says "unknown".

/** A line of a session file: a JSON object. Everything else that a file can hold is not a line that this module reads. */
export type Line = Record<string, unknown>;

export function isLine(value: unknown): value is Line {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The `timestamp` of a line when it is text that is a time, else null. */
export function timeOf(value: unknown): string | null {
  if (!isLine(value)) return null;
  const { timestamp } = value;
  return typeof timestamp === 'string' && !Number.isNaN(Date.parse(timestamp)) ? timestamp : null;
}

// ---- how much text may get out ----
// A session file holds Mark's private conversation. Only a few small things of it go into an answer (a
// title, the lines of a "Your move" box, the description of an agent), and each is cut to a length that a
// page can show, so that one odd line of a file cannot make an answer of any size.

const MAX_TITLE_CHARS = 200;
const MAX_ITEM_CHARS = 500;
const MAX_ITEMS = 20;
const MAX_PHASE_CHARS = 100;

/** The text, or its first `max` characters with "…" at the end. It counts characters, not UTF-16 units, so it never cuts a picture in half. */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  const characters = [...text];
  return characters.length <= max ? text : `${characters.slice(0, max - 1).join('')}…`;
}

// ---- the kinds of line ----

/**
 * The line types that this module knows, from the files of Claude Code 2.1. The first four are the
 * conversation, and they carry a working folder. The others are notes that a session writes about itself,
 * and mostly again at its end. A type that is not here is skipped and counted, so a new Claude Code that
 * adds one changes nothing; a file that holds none of these is in a format that this cannot read.
 */
const KNOWN_LINE_TYPES: ReadonlySet<string> = new Set([
  'user',
  'assistant',
  'attachment',
  'system',
  'custom-title',
  'agent-name',
  'ai-title',
  'pr-link',
  'last-prompt',
  'cost-state',
  'mode',
  'permission-mode',
  'queue-operation',
  'file-history-snapshot',
  'file-history-delta',
  'bridge-session',
  'dev-mods',
  'atis-latch',
]);

/** How many of the lines are of a type that this module knows. Everything else (a new type, text that is not an object) is unknown. */
export function countLineTypes(lines: readonly unknown[]): { known: number; unknown: number } {
  let known = 0;
  for (const line of lines) {
    if (isLine(line) && typeof line.type === 'string' && KNOWN_LINE_TYPES.has(line.type)) known += 1;
  }
  return { known, unknown: lines.length - known };
}

/** A line of the conversation: a reply of the assistant, or a message of the user's side. A message that the tool injected (`isMeta`) is not part of the conversation. */
export function isDecisive(line: unknown): line is Line {
  return isLine(line) && (line.type === 'assistant' || (line.type === 'user' && line.isMeta !== true));
}

// ---- the facts that lines carry ----

/** A line that has a working folder, of any type. (In the files of Claude Code 2.1 only `user`, `assistant`, `attachment` and `system` lines have one.) */
export function hasCwd(line: unknown): line is Line & { cwd: string } {
  return isLine(line) && typeof line.cwd === 'string' && line.cwd !== '';
}

/**
 * A line of the conversation that has a working folder. The module reads back from the end of a session file until
 * one is in its window. A line that has a working folder is not enough: a few big attachments after the last reply (in
 * real files, listings of skills) can fill the first window, and every one of them has a working folder. The window
 * would then hold no reply, and the session would have no state and no "Your move" box.
 */
export function hasConversationCwd(line: unknown): boolean {
  return isDecisive(line) && hasCwd(line);
}

/**
 * The working folder of the newest line that has one. An idle session ends in lines that have none
 * (`last-prompt`, `cost-state`, `mode`), so the newest line is not the one to ask.
 */
export function newestCwd(lines: readonly unknown[]): string | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (hasCwd(line)) return line.cwd;
  }
  return null;
}

/** The git branch named by the newest line that names one. An empty name is a name: the folder is not in a git repo. */
export function newestBranch(lines: readonly unknown[]): string | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (isLine(line) && typeof line.gitBranch === 'string') return line.gitBranch;
  }
  return null;
}

/** The newest text of one kind, trimmed and cut; null when there is none, or when the newest one is empty (the title was cleared). */
function newestText(lines: readonly unknown[], pick: (line: Line) => unknown, max: number): string | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!isLine(line)) continue;
    const value = pick(line);
    if (value === undefined) continue;
    return typeof value === 'string' && value.trim() !== '' ? clipText(value.trim(), max) : null;
  }
  return null;
}

/**
 * The names that a session can have, each from its newest line: the title that Mark gave it (`custom-title`),
 * the name of its agent (`agent-name`), and the slug that Claude Code makes up (the field `slug`). The caller
 * picks the first that is there.
 */
export function readTitles(lines: readonly unknown[]): { custom: string | null; agent: string | null; slug: string | null } {
  return {
    custom: newestText(lines, (line) => (line.type === 'custom-title' ? line.customTitle ?? null : undefined), MAX_TITLE_CHARS),
    agent: newestText(lines, (line) => (line.type === 'agent-name' ? line.agentName ?? null : undefined), MAX_TITLE_CHARS),
    slug: newestText(lines, (line) => (typeof line.slug === 'string' ? line.slug : undefined), MAX_TITLE_CHARS),
  };
}

/** An address that a page may link to: http or https. Anything else (a `javascript:` address) is not. */
function webAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

/**
 * The pull requests of this repository that the session linked (`pr-link` lines), each once, in the order
 * the session first linked them. A link for another repository is ignored (a session can open a pull request
 * anywhere), and so is a link whose number is not a whole number above 0. The address is the file's, when it
 * is a web address, and otherwise the address that GitHub gives that pull request.
 */
export function extractPrs(lines: readonly unknown[], githubRepo: string): { number: number; url: string }[] {
  const found = new Map<number, string>();
  for (const line of lines) {
    if (!isLine(line) || line.type !== 'pr-link') continue;
    // GitHub does not tell two spellings of a name apart, so neither does this.
    if (typeof line.prRepository !== 'string' || line.prRepository.toLowerCase() !== githubRepo.toLowerCase()) continue;
    const number = line.prNumber;
    if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) continue;
    found.set(number, webAddress(line.prUrl) ?? `https://github.com/${githubRepo}/pull/${number}`);
  }
  return [...found].map(([number, url]) => ({ number, url }));
}

// ---- the state of a session ----

/**
 * What the end of the lines says, without the age of the file. `turn-ended`: the last reply (or a tool, or
 * Mark's interrupt) ended the turn, so the session waits for Mark. `in-turn`: work is going on, or was when
 * the file was last written. `unknown`: the lines do not say.
 */
export type Activity = { kind: 'turn-ended' | 'in-turn' | 'unknown'; reason: string };

const UNKNOWN_FORMAT = 'unknown file format';
const NO_CONVERSATION = 'no user or assistant line in the part of the file that was read';

/** The stop reasons that end a turn: the model said it was done, or reached a stop sequence. Any other (a new one included) is not taken for an end. */
const END_STOP_REASONS: ReadonlySet<unknown> = new Set(['end_turn', 'stop_sequence']);

/** What Claude Code writes as a user line when Mark presses Esc. The text goes on (`... for tool use]`). */
const INTERRUPTED = '[Request interrupted by user';

/** The message of a line (`message`), or null. */
function messageOf(line: Line): Line | null {
  return isLine(line.message) ? line.message : null;
}

/** The text blocks of a message, in order. A message whose content is a plain string has that string. */
function textsOf(line: Line): string[] {
  const content = messageOf(line)?.content;
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => (isLine(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []));
}

/** Whether the message of a user line holds the result of a tool call. */
function isToolResult(line: Line): boolean {
  if (line.toolUseResult !== undefined) return true;
  const content = messageOf(line)?.content;
  return Array.isArray(content) && content.some((block) => isLine(block) && block.type === 'tool_result');
}

const isInterrupt = (line: Line): boolean => textsOf(line).some((text) => text.startsWith(INTERRUPTED));

/**
 * What the newest line of the conversation says. Only `user` and `assistant` lines decide: notes, system
 * lines and attachments are written after a reply too (an idle session ends in them) and say nothing about
 * whether the session works.
 */
export function readActivity(lines: readonly unknown[]): Activity {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!isDecisive(line)) continue;

    if (line.type === 'assistant') {
      const stop = messageOf(line)?.stop_reason;
      return END_STOP_REASONS.has(stop)
        ? { kind: 'turn-ended', reason: 'the last reply ended its turn' }
        : { kind: 'in-turn', reason: 'the last reply is not an end of turn' };
    }
    // A user line. A tool that ends the turn (an agent hands its result back) and Mark's interrupt end it; anything else
    // (a tool result, a prompt, a message from a background task) is work that goes on.
    if (line.toolEndsTurn === true) return { kind: 'turn-ended', reason: 'a tool ended the turn' };
    if (isInterrupt(line)) return { kind: 'turn-ended', reason: 'the turn was interrupted' };
    return { kind: 'in-turn', reason: 'a tool result or a prompt came after the last reply' };
  }
  return { kind: 'unknown', reason: countLineTypes(lines).known === 0 ? UNKNOWN_FORMAT : NO_CONVERSATION };
}

/** How old a file may be before a session that works, or one that waits, counts as idle. The config holds the same numbers. */
export type StateLimits = { workingSeconds: number; waitingSeconds: number };

export const DEFAULT_STATE_LIMITS: StateLimits = { workingSeconds: 300, waitingSeconds: 14_400 };

/** "5 minutes", "4 hours": a number of seconds in words, for the reason of an idle session. */
function inWords(seconds: number): string {
  const unit = (count: number, name: string) => `${count} ${name}${count === 1 ? '' : 's'}`;
  if (seconds % 3600 === 0) return unit(seconds / 3600, 'hour');
  if (seconds % 60 === 0) return unit(seconds / 60, 'minute');
  return unit(seconds, 'second');
}

/**
 * The state of a session from what its lines say and when its file was last written. A session that works
 * but has written nothing for `workingSeconds` has stopped (a crash is likelier than a tool call that is silent
 * for that long). A session that waits for Mark keeps waiting for `waitingSeconds`, so its box does not vanish
 * while he is away, and is then idle.
 */
export function applyAge(activity: Activity, mtimeMs: number, nowMs: number, limits: StateLimits = DEFAULT_STATE_LIMITS): { state: SessionState; reason: string } {
  if (activity.kind === 'unknown') return { state: 'unknown', reason: activity.reason };
  // A file time that is a little ahead of the clock (two clocks that differ) gives a negative age, which is below any limit: a file that was just written.
  const ageSeconds = (nowMs - mtimeMs) / 1000;
  const waiting = activity.kind === 'turn-ended';
  const limit = waiting ? limits.waitingSeconds : limits.workingSeconds;
  if (ageSeconds > limit) return { state: 'idle', reason: `no write for more than ${inWords(limit)}` };
  return { state: waiting ? 'waiting' : 'working', reason: activity.reason };
}

/** The state of a session from its lines and the time its file was last written. */
export function classifySession(
  lines: readonly unknown[],
  mtimeMs: number,
  nowMs: number,
  limits: StateLimits = DEFAULT_STATE_LIMITS,
): { state: SessionState; reason: string } {
  return applyAge(readActivity(lines), mtimeMs, nowMs, limits);
}

/** The time of the newest line of the conversation, or null. For an agent, that is when it ended. */
export function lastDecisiveTime(lines: readonly unknown[]): string | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!isDecisive(line)) continue;
    const time = timeOf(line);
    if (time !== null) return time;
  }
  return null;
}

// ---- the "Your move" box ----

/** `### 👉 Your move`, at any heading level, with or without the pointing hand. What follows the words is in group 1. */
const BOX_HEADING = /^\s{0,3}#{1,6}\s*(?:👉\s*)?your move\b(.*)$/iu;

/** What follows the words of a box that has nothing for Mark: `: nothing`, optionally with words after it. */
const SAYS_NOTHING = /^[\s:\-–—(]*nothing\b/i;

/** A list item, with or without a check box. Group 1 is the mark of a ticked box, group 2 the text. */
const LIST_ITEM = /^\s{0,3}(?:[-*+]|\d{1,3}[.)])\s+(?:\[([ xX])\]\s*)?(.*)$/;

/** A line that goes on with the item above it: it is indented. */
const CONTINUATION = /^\s{2,}\S/;

const LIGHTS: readonly (readonly [string, 'green' | 'yellow' | 'red'])[] = [
  ['🟢', 'green'],
  ['🟡', 'yellow'],
  ['🔴', 'red'],
];

/** The status light that a reply starts with: the first character of the text, blank space before it aside. */
function lightOf(text: string): YourMoveBox['light'] {
  const start = text.trimStart();
  return LIGHTS.find(([symbol]) => start.startsWith(symbol))?.[1] ?? null;
}

/**
 * The box at the end of a reply: the last heading of the text (a heading inside a code block is a quoted
 * example, not a box), and the list that follows it. The list ends at the first line that is not an item or
 * the rest of one. Ticked items are done, so they are left out; a box that says "nothing" has no items.
 */
function parseBox(text: string): Pick<YourMoveBox, 'light' | 'items' | 'nothing'> | null {
  const rows = text.split(/\r?\n/);
  let heading = -1;
  let inCode = false;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] ?? '';
    if (/^\s*(```|~~~)/.test(row)) inCode = !inCode;
    else if (!inCode && BOX_HEADING.test(row)) heading = index;
  }
  if (heading === -1) return null;

  const nothing = SAYS_NOTHING.test(BOX_HEADING.exec(rows[heading] ?? '')?.[1] ?? '');
  const entries: { text: string }[] = [];
  if (!nothing) {
    // `open` is what an indented line goes on with: the item above it, or 'skip' when that item is ticked.
    let open: { text: string } | 'skip' | null = null;
    for (const row of rows.slice(heading + 1)) {
      if (row.trim() === '') continue;
      const item = LIST_ITEM.exec(row);
      if (item !== null) {
        if (item[1] !== undefined && item[1] !== ' ') {
          open = 'skip';
        } else {
          open = { text: (item[2] ?? '').trim() };
          entries.push(open);
        }
      } else if (open !== null && CONTINUATION.test(row)) {
        if (open !== 'skip') open.text = `${open.text} ${row.trim()}`;
      } else {
        break;
      }
    }
  }
  const items = entries.map((entry) => entry.text).filter((item) => item !== '');
  return { light: lightOf(text), items: items.slice(0, MAX_ITEMS).map((item) => clipText(item, MAX_ITEM_CHARS)), nothing };
}

/** The text of a reply: its text blocks, in order, as one text. */
function replyText(line: Line): string | null {
  const texts = textsOf(line);
  return texts.length === 0 ? null : texts.join('\n');
}

/**
 * Whether a line is a prompt of Mark's: a user line with his words. A tool result is not. A message that
 * a background task sends when it finishes (`origin.kind` is `task-notification`), a message from another
 * session (`peer`), a line that the tool injected (`isMeta`) and Mark's interrupt (Esc) are not. A line with
 * no origin is a prompt: the files of older Claude Code versions have none.
 */
function isHumanPrompt(line: unknown): boolean {
  if (!isLine(line) || line.type !== 'user' || line.isMeta === true || line.toolEndsTurn === true || messageOf(line) === null) return false;
  const origin = isLine(line.origin) ? line.origin.kind : undefined;
  if (origin !== undefined && origin !== 'human') return false;
  return !isToolResult(line) && !isInterrupt(line);
}

/**
 * The last "Your move" box that the session wrote inside the project. Only a reply whose own working folder
 * is inside one of `roots` counts: a session that works elsewhere for a while writes boxes about other things,
 * and one that began in `home-base` writes some before it ever moves into the repo. The working folder is the
 * one of the reply, not the newest one of the session, which may have moved on.
 *
 * The box of the last reply that has one wins, even when later replies have none (a short status line is not a
 * new box). `answered` is true when a prompt of Mark's came after it.
 */
export function extractYourMove(lines: readonly unknown[], roots: readonly string[]): YourMoveBox | null {
  let found: { box: Pick<YourMoveBox, 'light' | 'items' | 'nothing' | 'at'>; index: number } | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!isLine(line) || line.type !== 'assistant') continue;
    const text = replyText(line);
    const box = text === null ? null : parseBox(text);
    if (box === null) continue;
    // The reply's own working folder: a reply that has none, or has one outside the roots, has no say.
    if (typeof line.cwd !== 'string' || !cwdInsideRoots(line.cwd, roots)) continue;
    found = { box: { ...box, at: timeOf(line) ?? '' }, index };
  }
  if (found === null) return null;
  return { ...found.box, answered: lines.slice(found.index + 1).some(isHumanPrompt) };
}

// ---- the journal of a workflow, and the states of agents and workflows ----

/** What a workflow's `journal.jsonl` says. `known` is how many of its rows are of a kind that this reads. */
export type Journal = {
  /** In the order the journal first names them. */
  phases: { name: string; started: number; done: number }[];
  started: number;
  done: number;
  /** The agents that started and have a result. */
  doneIds: string[];
  known: number;
};

/**
 * Reads the rows of a journal: `launched`, `started` (`agentId`, `phase`) and `result` (`agentId`). A journal
 * has no times and no total, so its progress is the agents done of the agents started, by phase. An agent counts
 * once. A result for an agent whose start is not in the lines (a journal longer than the part that was read)
 * is left out, so no phase ever has more done than started.
 */
export function readJournal(lines: readonly unknown[]): Journal {
  const phaseOf = new Map<string, string>(); // agent id -> phase, in the order the agents started
  const resulted = new Set<string>();
  let known = 0;
  for (const line of lines) {
    if (!isLine(line)) continue;
    if (line.type === 'launched') {
      known += 1;
    } else if (line.type === 'started') {
      known += 1;
      const { agentId, phase } = line;
      if (typeof agentId === 'string' && agentId !== '' && !phaseOf.has(agentId)) {
        phaseOf.set(agentId, typeof phase === 'string' ? clipText(phase, MAX_PHASE_CHARS) : '');
      }
    } else if (line.type === 'result') {
      known += 1;
      if (typeof line.agentId === 'string') resulted.add(line.agentId);
    }
  }

  const phases = new Map<string, { name: string; started: number; done: number }>();
  const doneIds: string[] = [];
  for (const [agentId, name] of phaseOf) {
    const phase = phases.get(name) ?? { name, started: 0, done: 0 };
    phases.set(name, phase);
    phase.started += 1;
    if (resulted.has(agentId)) {
      phase.done += 1;
      doneIds.push(agentId);
    }
  }
  return { phases: [...phases.values()], started: phaseOf.size, done: doneIds.length, doneIds, known };
}

/**
 * The state of a workflow run. `done`: every agent that started has a result. Else `running` while something
 * of the run is being written (`fresh`), else `stopped`. `unknown` when the journal has no row that this reads.
 */
export function workflowStateOf(journal: Journal, fresh: boolean): 'running' | 'done' | 'stopped' | 'unknown' {
  if (journal.known === 0) return 'unknown';
  if (journal.started > 0 && journal.done === journal.started) return 'done';
  return fresh ? 'running' : 'stopped';
}

/**
 * The state of an agent. `done`: it ended (its last line is a hand-back or the end of a turn), or its workflow's
 * journal has its result. Else `running` while its file is fresh, else `stopped`.
 */
export function agentStateOf(facts: { ended: boolean; fresh: boolean; hasResult: boolean }): 'running' | 'done' | 'stopped' {
  if (facts.ended || facts.hasResult) return 'done';
  return facts.fresh ? 'running' : 'stopped';
}
