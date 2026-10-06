// Shared helpers for the tests of the sessions module (tail, parse, discover, sessions, route). This
// file has no tests of its own. Everything here is synthetic: the lines are written in the shape of
// Claude Code's session files, but they hold made-up words, made-up ids and made-up folders.
import { cpSync, mkdirSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Config } from '../src/server/config';
import { PACKAGE_DIR, makeTestConfig } from './helpers';

/** The moment that the tests treat as "now": the sessions module takes its clock as a parameter. */
export const NOW = Date.parse('2026-10-06T12:00:00.000Z');

/** A time `seconds` after NOW (a negative number is before it), as an ISO text. */
export function at(seconds: number): string {
  return new Date(NOW + seconds * 1000).toISOString();
}

// ---- the project folders of the tests ----
// The cwd of a line is a text. These folders are never made on disk: `isInside` compares paths as
// text, so a root that does not exist works as well as one that does.

export const ROOT = resolve('/fixture/repo');
export const ROOT_PHASER = resolve('/fixture/repo-phaser');
/** A working folder inside the first root (a subfolder, as a session that works in tools/ has). */
export const INSIDE = '/fixture/repo/tools/example';
/** A working folder that only shares a name prefix with a root: it is outside, which a "starts with" would get wrong. */
export const PREFIX_ONLY = '/fixture/repo-old';
/** A working folder that has nothing to do with the roots. */
export const OUTSIDE = '/fixture/elsewhere/project';

// ---- lines ----

export type Line = Record<string, unknown>;

/** What every line of the conversation (user, assistant, attachment, system) carries besides its own fields. */
export type Base = {
  /** The time of the line, as an ISO text. */
  time?: string;
  /** The working folder. `null` leaves the field out, as a line that has none. */
  cwd?: string | null;
  branch?: string;
  /** How the session was started (`claude-desktop`, `cli`, `sdk-py` ...). Left out of the line when it is not given, as in the older files. */
  entrypoint?: string;
};

function base(type: string, o: Base): Line {
  const line: Line = { type, timestamp: o.time ?? at(0), sessionId: 'fixture-session', gitBranch: o.branch ?? 'fixture-branch' };
  if (o.cwd !== null) line.cwd = o.cwd ?? INSIDE;
  if (o.entrypoint !== undefined) line.entrypoint = o.entrypoint;
  return line;
}

/** A prompt that Mark typed. `extra` adds or replaces fields (for example `isMeta` or `origin`). */
export function userPrompt(text: string, o: Base = {}, extra: Line = {}): Line {
  return { ...base('user', o), message: { role: 'user', content: text }, ...extra };
}

/** The result of a tool call: a user line that holds a tool_result block. */
export function toolResult(text: string, o: Base = {}): Line {
  return {
    ...base('user', o),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_fixture', content: text }] },
    toolUseResult: { text },
  };
}

/** A message from a background task that finished (a user line whose origin is `task-notification`). */
export function taskNotification(text: string, o: Base = {}): Line {
  return { ...base('user', o), message: { role: 'user', content: text }, origin: { kind: 'task-notification' } };
}

/** An assistant line with one text block. `stop` is the stop_reason of its message (`end_turn` unless a test says other). */
export function assistantText(text: string, o: Base & { stop?: string | null } = {}): Line {
  return { ...base('assistant', o), message: { role: 'assistant', stop_reason: o.stop === undefined ? 'end_turn' : o.stop, content: [{ type: 'text', text }] } };
}

/** An assistant line with one tool_use block: the reply is not over, it waits for the tool. */
export function assistantToolUse(name: string, input: Line, o: Base = {}): Line {
  return {
    ...base('assistant', o),
    message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_fixture', name, input }] },
  };
}

export function attachment(text: string, o: Base = {}): Line {
  return { ...base('attachment', o), attachment: { type: 'hook_success', content: text } };
}

export function systemLine(o: Base = {}, extra: Line = {}): Line {
  return { ...base('system', o), subtype: 'turn_duration', durationMs: 1000, ...extra };
}

// The lines that a session writes at its end and has no working folder: they must never hide a cwd.
export const lastPrompt = (text = 'a prompt'): Line => ({ type: 'last-prompt', sessionId: 'fixture-session', lastPrompt: text });
export const costState = (): Line => ({ type: 'cost-state', sessionId: 'fixture-session', totalCostUSD: 1.5 });
export const modeLine = (): Line => ({ type: 'mode', sessionId: 'fixture-session', mode: 'normal' });
export const customTitle = (title: string): Line => ({ type: 'custom-title', sessionId: 'fixture-session', customTitle: title });
export const agentName = (name: string): Line => ({ type: 'agent-name', sessionId: 'fixture-session', agentName: name });
export const prLink = (number: number, repository: string, time = at(0)): Line => ({
  type: 'pr-link',
  sessionId: 'fixture-session',
  prNumber: number,
  prUrl: `https://github.com/${repository}/pull/${number}`,
  prRepository: repository,
  timestamp: time,
});

/** A box as Mark's replies write it, behind a status light and a short status line. */
export function box(items: string[], o: { light?: string; heading?: string } = {}): string {
  const light = o.light ?? '🟡';
  const heading = o.heading ?? '### 👉 Your move';
  return [`${light} The work is done.`, '', '---', heading, ...items.map((item) => `- [ ] ${item}`)].join('\n');
}

/** Lines as the text of a session file: one JSON object on each line, and a newline after the last. */
export function jsonl(lines: readonly unknown[]): string {
  return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
}

/** One line of JSON (no newline) that is exactly `bytes` long: `extra` fields, and a "pad" field of x to fill up. */
export function lineOfSize(bytes: number, extra: Record<string, unknown> = {}): string {
  const empty = JSON.stringify({ ...extra, pad: '' });
  return JSON.stringify({ ...extra, pad: 'x'.repeat(bytes - Buffer.byteLength(empty)) });
}

/** `count` lines of 100 bytes each, numbered by `n` from `from`, with a newline after each (101 bytes for a line). */
export function numberedLines(count: number, from = 0): string {
  return Array.from({ length: count }, (_, i) => `${lineOfSize(100, { n: from + i })}\n`).join('');
}

// ---- files ----

/** Writes a file (and the folders above it), and sets its time of last write to `ageSeconds` before NOW. */
export function writeAged(file: string, content: string | Buffer, ageSeconds = 60): string {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  setAge(file, ageSeconds);
  return file;
}

export function setAge(file: string, ageSeconds: number): void {
  const time = new Date(NOW - ageSeconds * 1000);
  utimesSync(file, time, time);
}

/** The synthetic Claude folders that are committed with the tool (fixtures/claude/projects). */
export const CLAUDE_FIXTURES = join(PACKAGE_DIR, 'fixtures', 'claude', 'projects');

/**
 * Copies the committed fixtures into `dest` and sets the time of last write of every file to one
 * minute before NOW, because a checkout gives every file the time of the checkout. `ages` sets other
 * ages (in seconds before NOW), by the path of the file inside the fixtures, with forward slashes.
 */
export function copyClaudeFixtures(dest: string, ages: Record<string, number> = {}): string {
  cpSync(CLAUDE_FIXTURES, dest, { recursive: true });
  const walk = (folder: string, prefix: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path, name);
      else setAge(path, ages[name] ?? 60);
    }
  };
  walk(dest, '');
  return dest;
}

/** The names of the two folders of the fixtures: one that is all Shadow Jog's, and one that mixes projects. */
export const WHOLE_FOLDER = 'fixture-shadow-jog';
export const MIXED_FOLDER = 'fixture-home-base';

/** A config for the sessions tests: the two fixture roots, the fixture folders, and the Claude folder `projectsRoot`. */
export function sessionsConfig(projectsRoot: string, claude: Partial<Config['claude']> = {}): Config {
  const config = makeTestConfig();
  return {
    ...config,
    roots: [ROOT, ROOT_PHASER],
    claude: { ...config.claude, projectsRoot, folders: [WHOLE_FOLDER], cwdMatchFolders: [MIXED_FOLDER], ...claude },
  };
}
