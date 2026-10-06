import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isMissing } from '../fs-errors';
import { isLine, timeOf } from './parse';

// The bounded file reader of the sessions module. Claude Code keeps every session as one text file
// with a JSON object on each line, and a long session is hundreds of megabytes. The newest lines are
// at the end, so the module reads a window at the end of the file (and a little at the start, for
// the time the session began), and never the whole file. Every read of a session file goes through
// this file, so "how much does it read" has one answer, and the tests can watch it.
//
// The module only ever opens a file to read it (the flag is always 'r').

/** The first window at the end of a file: 64 KB. Almost every file ends with a whole line inside it. */
export const TAIL_START_BYTES = 64 * 1024;

/** The window never grows past this: 4 MB. A 300 MB file costs at most this much, and a line that is longer is never read. */
export const TAIL_MAX_BYTES = 4 * 1024 * 1024;

/** How much of the start of a file is read to find the time of its first line: 16 KB. */
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

/** The text of a time field in a piece of the first line that was cut. */
const CUT_LINE_TIME = /"timestamp"\s*:\s*"([^"\\]+)"/;

/**
 * The time of the first line of a file that has one, from the first 16 KB. It is the time that the
 * session (or agent) began. Null when the first 16 KB hold none.
 *
 * Many session files begin with one very long line: a `queue-operation` that holds the whole first
 * prompt, which can be larger than 16 KB. That line cannot be read as JSON from a window that cuts
 * it, but it names its time before the long text, so the time is read from the piece that is there.
 * A long first line that names its time after the text (an agent's prompt does) gives null.
 */
export async function readFirstTimestamp(file: string): Promise<string | null> {
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
  for (const line of lines) {
    const time = timeOf(parseLine(line));
    if (time !== null) return time;
  }

  // The window is one line that is cut: the first line of the file is longer than it.
  if (!wholeFile && segments.length === 0 && last.trimStart().startsWith('{')) {
    const text = CUT_LINE_TIME.exec(last)?.[1];
    if (text !== undefined && !Number.isNaN(Date.parse(text))) return text;
  }
  return null;
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
