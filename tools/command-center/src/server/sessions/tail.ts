import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isMissing } from '../fs-errors';
import { isLine, promptOf, queuedPromptTitle, timeOf } from './parse';

// The bounded file reader of the sessions module. Claude Code keeps every session as one text file
// with a JSON object on each line, and a long session is hundreds of megabytes. The newest lines are
// at the end, so the module reads a window at the end of the file (and 16 KB at the start, for the
// time the session began and its first prompt), and never the whole file. Every read of a session file goes through
// this file, so "how much does it read" has one answer, and the tests can watch it.
//
// The module only ever opens a file to read it (the flag is always 'r').

/** The first window at the end of a file: 64 KB. Almost every file ends with a whole line inside it. */
export const TAIL_START_BYTES = 64 * 1024;

/** The window never grows past this: 4 MB. A 300 MB file costs at most this much, and a line that is longer is never read. */
export const TAIL_MAX_BYTES = 4 * 1024 * 1024;

/** How much of the start of a file is read, to find the time of its first line and its first prompt: 16 KB. */
export const HEAD_MAX_BYTES = 16 * 1024;

const NEWLINE = 0x0a;

export type TailOptions = {
  /** The size of the first window, in bytes. 64 KB when this is not set. */
  startBytes?: number;
  /** The most that the window may grow to, in bytes. 4 MB when this is not set. */
  maxBytes?: number;
  /**
   * What the caller is looking for. The window doubles until one of the lines in it satisfies this,
   * or the cap is reached, or the start of the file is. Without it, any whole line will do.
   */
  until?: (line: unknown) => boolean;
};

export type TailResult = {
  /** The whole lines of the window that are JSON, oldest first. A value is whatever JSON holds: the parsers decide which of them they know. */
  lines: unknown[];
  /** How many bytes were read from the file. It never exceeds `maxBytes`. */
  bytesRead: number;
  /** True when the read ended because a line satisfied `until` or the window reached the start of the file, and false when it ended at the cap. */
  complete: boolean;
};

/**
 * Reads `length` bytes at `position`. A file can end sooner than it was said to (it can be cut short
 * while it is read), so the buffer that comes back may be shorter than `length`.
 */
async function readRange(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(buffer, filled, length - filled, position + filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return filled === length ? buffer : buffer.subarray(0, filled);
}

/** The JSON in one line of text, or `undefined` when the text is empty or is not JSON (a half-written line is the usual case). `undefined` is never JSON's own value, so a line that holds `null` is told apart. */
function parseLine(text: string): unknown {
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The whole lines in a window. `startsInsideFile` says that the window does not begin at the start of
 * the file, so its first line is only the end of a line that began before it: that line is skipped.
 * (A window that happens to begin exactly at a line start loses that one good line. The reader cannot
 * tell, and one line is a cheap price for never reading half of one.)
 *
 * The last line is a whole line when it ends with a newline, or when it has no newline yet and is
 * still complete JSON. A line that the writer has half written is never valid JSON (an object needs
 * its closing brace), so it fails to parse and is dropped, the same as any other text that is not JSON.
 */
function linesOf(window: Buffer, startsInsideFile: boolean): unknown[] {
  const lines: unknown[] = [];
  let start = 0;
  let first = true;
  for (;;) {
    const end = window.indexOf(NEWLINE, start);
    const stop = end === -1 ? window.length : end;
    if (!(first && startsInsideFile)) {
      const value = parseLine(window.toString('utf8', start, stop));
      if (value !== undefined) lines.push(value);
    }
    first = false;
    if (end === -1) return lines;
    start = end + 1;
  }
}

/**
 * Reads the lines at the end of a file. It starts with a window of `startBytes` and doubles it until
 * a line satisfies `until`, or it has reached `maxBytes`, or the start of the file. Each pass reads only
 * the new part in front of the window, so no byte is read twice.
 *
 * It never throws for what is in the file (half a line, a line that is not JSON, an unknown kind of
 * line, a line longer than the cap): those lines are left out. It does throw for a file that cannot
 * be opened or read, because that is the caller's to report.
 */
export async function readTail(file: string, options: TailOptions = {}): Promise<TailResult> {
  const maxBytes = Math.max(1, options.maxBytes ?? TAIL_MAX_BYTES);
  const startBytes = Math.min(Math.max(1, options.startBytes ?? TAIL_START_BYTES), maxBytes);
  const until = options.until ?? (() => true);

  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    let window: Buffer = Buffer.alloc(0);
    let target = Math.min(startBytes, size);
    for (;;) {
      const wanted = target - window.length;
      const front = await readRange(handle, size - target, wanted);
      window = Buffer.concat([front, window]);

      const atStart = target === size;
      const lines = linesOf(window, !atStart);
      const found = lines.some(until);
      // A short read means that the file shrank while it was read: what is in hand is all there is to see.
      if (found || atStart || target >= maxBytes || front.length < wanted) {
        return { lines, bytesRead: window.length, complete: found || atStart };
      }
      target = Math.min(target * 2, maxBytes, size);
    }
  } finally {
    await handle.close();
  }
}

/** The text of a time field in the piece of a line that the head window cut. */
const CUT_LINE_TIME = /"timestamp"\s*:\s*"([^"\\]+)"/;

/**
 * The start of a queued prompt in the piece of a line that the head window cut: a `queue-operation` line that is an
 * `enqueue`, and its `content` (the prompt) up to where the piece ends. The keys are in the order that Claude Code
 * writes them (`type`, `operation`, `timestamp`, `sessionId`, `content`), so a line in another order gives no prompt.
 * Group 1 is the text of the content as the file has it, with its JSON escapes.
 */
const CUT_QUEUED_PROMPT = /^\{\s*"type"\s*:\s*"queue-operation"\s*,\s*"operation"\s*:\s*"enqueue"\s*,.*?"content"\s*:\s*"((?:[^"\\]|\\.)*)/s;

/**
 * The text that the start of a JSON string holds: its escapes read, and an escape that the cut left half (a lone
 * backslash, or `\u` with fewer than four digits) dropped. Null when the text is not valid JSON string text.
 */
function decodeCutString(raw: string): string | null {
  let end = raw.length;
  for (let i = 0; i < raw.length; ) {
    if (raw[i] !== '\\') {
      i += 1;
      continue;
    }
    const length = raw[i + 1] === 'u' ? 6 : 2;
    if (i + length > raw.length) {
      end = i;
      break;
    }
    i += length;
  }
  try {
    return JSON.parse(`"${raw.slice(0, end)}"`) as string;
  } catch {
    return null;
  }
}

/** The title of a queued prompt in the piece of a line that the head window cut, or null. */
function cutLinePrompt(cut: string): string | null {
  const raw = CUT_QUEUED_PROMPT.exec(cut)?.[1];
  const text = raw === undefined ? null : decodeCutString(raw);
  return text === null ? null : queuedPromptTitle(text);
}

/** What the start of a file says: when it began, and the first line of the first prompt of Mark (the title of a session that has none). */
export type HeadFacts = { timestamp: string | null; prompt: string | null };

/**
 * Reads the first 16 KB of a file once, and gives the time of its first line that has one and the title that its first
 * prompt gives (see `promptOf`: a prompt of Mark's in a `user` line, or queued as most real files begin). Null for each that
 * the 16 KB do not hold.
 *
 * Many session files begin with one very long line: a `queue-operation` that holds the whole first prompt, which can be
 * larger than 16 KB. That line cannot be read as JSON from a window that cuts it, but it names its time and begins its
 * prompt before the long text, so both are read from the piece that is there. This holds for the piece of any line that the
 * window cuts, which is always the last. A long line of another kind (an agent's prompt is a `user` line) names its time after
 * its text, and says who wrote it after its text too, so it gives neither.
 */
export async function readHead(file: string): Promise<HeadFacts> {
  const handle = await open(file, 'r');
  let head: Buffer;
  try {
    head = await readRange(handle, 0, HEAD_MAX_BYTES);
  } finally {
    await handle.close();
  }

  // A window shorter than 16 KB is the whole file: its last line has no newline after it, but it is whole.
  const wholeFile = head.length < HEAD_MAX_BYTES;
  const segments = head.toString('utf8').split('\n');
  const last = segments.pop() ?? '';
  const lines = wholeFile && last !== '' ? [...segments, last] : segments;
  // The piece of a line that the window cut: it is what is after the last newline, unless the file ended inside the window.
  const cut = wholeFile ? '' : last;

  let timestamp: string | null = null;
  let prompt: string | null = null;
  for (const text of lines) {
    const line = parseLine(text);
    timestamp ??= timeOf(line);
    prompt ??= promptOf(line);
    if (timestamp !== null && prompt !== null) break;
  }
  if (cut.trimStart().startsWith('{')) {
    if (timestamp === null) {
      const text = CUT_LINE_TIME.exec(cut)?.[1];
      if (text !== undefined && !Number.isNaN(Date.parse(text))) timestamp = text;
    }
    prompt ??= cutLinePrompt(cut);
  }
  return { timestamp, prompt };
}

/** The time of the first line of a file that has one, from the first 16 KB (see `readHead`). Null when the first 16 KB hold none. */
export async function readFirstTimestamp(file: string): Promise<string | null> {
  return (await readHead(file)).timestamp;
}

/**
 * Reads a small JSON file (an agent's `.meta.json`, a session's `custom-title.json`) and gives the
 * object in it. Null when the file is not there, is larger than `maxBytes`, is not JSON, or is JSON
 * that is not an object. Any other failure to read it is thrown.
 */
export async function readSmallJson(file: string, maxBytes = 64 * 1024): Promise<Record<string, unknown> | null> {
  let handle: FileHandle;
  try {
    handle = await open(file, 'r');
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  try {
    const { size } = await handle.stat();
    if (size > maxBytes) return null;
    const value = parseLine((await readRange(handle, 0, size)).toString('utf8'));
    return isLine(value) ? value : null;
  } finally {
    await handle.close();
  }
}
