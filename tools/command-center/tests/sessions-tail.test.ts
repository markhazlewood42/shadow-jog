import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { HEAD_MAX_BYTES, TAIL_MAX_BYTES, TAIL_START_BYTES, readFirstTimestamp, readSmallJson, readTail } from '../src/server/sessions/tail';
import { jsonl, lineOfSize, numberedLines } from './sessions-helpers';

// The bounded reader of the sessions module. A session file can be 300 MB, so the module never reads
// a file whole: it reads a window at the end (and 16 KB at the start), and these tests check where
// that window starts, how it grows, and what it does with a line that is cut or too long.

const dir = mkdtempSync(join(tmpdir(), 'cc-tail-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let counter = 0;
/** Writes a file with this content in the test folder and returns its path. */
function file(content: string | Buffer): string {
  const path = join(dir, `file-${counter++}.jsonl`);
  writeFileSync(path, content);
  return path;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

describe('the limits', () => {
  it('start at 64 KB at the end of a file, stop at 4 MB, and read 16 KB at its start', () => {
    expect(TAIL_START_BYTES).toBe(64 * 1024);
    expect(TAIL_MAX_BYTES).toBe(4 * 1024 * 1024);
    expect(HEAD_MAX_BYTES).toBe(16 * 1024);
  });
});

describe('readTail', () => {
  it('tail: a half-written last line is dropped', async () => {
    // The writer is in the middle of a line: no closing brace, no newline. It is not a line yet.
    const half = await readTail(file('{"n":1}\n{"n":2}\n{"n":3,"text":"half wri'));
    expect(half.lines).toEqual([{ n: 1 }, { n: 2 }]);
    expect(half.complete).toBe(true);

    // A cut line that has its newline is dropped as well: it cannot be read as JSON.
    expect((await readTail(file('{"n":1}\n{"n":2,"te\n'))).lines).toEqual([{ n: 1 }]);
    // A last line that is whole but has no newline yet is a line.
    expect((await readTail(file('{"n":1}\n{"n":2}'))).lines).toEqual([{ n: 1 }, { n: 2 }]);
    // And with its newline, the same lines.
    expect((await readTail(file('{"n":1}\n{"n":2}\n'))).lines).toEqual([{ n: 1 }, { n: 2 }]);

    // In a file that is longer than the window, both ends are cut: the window starts inside a line
    // and the writer is inside the last one. The lines in between are whole and in order.
    const long = await readTail(file(`${numberedLines(3000)}{"n":3000,"text":"half wri`), { startBytes: 4096 });
    const numbers = long.lines.map((line) => (isObject(line) ? line.n : null));
    expect(numbers.length).toBeGreaterThan(30);
    expect(numbers[0]).toBeGreaterThan(2000); // the first line of the window was cut, so it is not there
    expect(numbers.at(-1)).toBe(2999); // the half line is not there, the whole one before it is
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => (numbers[0] as number) + i)); // no gaps
    expect(long.complete).toBe(true); // it found lines, which is all that was asked
  });

  it('tail: a line larger than the first window grows the window up to the cap', async () => {
    // 1.2 MB of small lines, then one line of 300 KB. The first window (64 KB) lies inside that line, so it holds no whole line.
    const big = lineOfSize(300 * 1024, { big: true });
    const path = file(`${numberedLines(12_000)}${big}\n`);
    const result = await readTail(path);
    expect(result.lines.at(-1)).toMatchObject({ big: true });
    expect(result.complete).toBe(true);
    // The window doubled from 64 KB until the line fitted (64, 128, 256, 512 KB), and no byte was read twice.
    expect(result.bytesRead).toBe(512 * 1024);

    // With a cap smaller than the line, the window stops at the cap and the answer says it is not complete.
    const capped = await readTail(path, { maxBytes: 256 * 1024 });
    expect(capped.lines).toEqual([]);
    expect(capped.bytesRead).toBe(256 * 1024);
    expect(capped.complete).toBe(false);

    // The real cap is 4 MB: a last line of 5 MB is never read whole, and nothing throws.
    const huge = await readTail(file(`${numberedLines(100)}${lineOfSize(5 * 1024 * 1024)}\n`));
    expect(huge.lines).toEqual([]);
    expect(huge.bytesRead).toBe(TAIL_MAX_BYTES);
    expect(huge.complete).toBe(false);
  });

  it('reads a file that is shorter than the first window once, and all of it', async () => {
    const content = '{"n":1}\n{"n":2}\n';
    const result = await readTail(file(content));
    expect(result).toEqual({ lines: [{ n: 1 }, { n: 2 }], bytesRead: Buffer.byteLength(content), complete: true });
    expect(await readTail(file(''))).toEqual({ lines: [], bytesRead: 0, complete: true });
  });

  it('a window that starts inside a line drops that first part, and never invents a line from it', async () => {
    // Each line is 11 bytes (`{"n":1000}` and a newline). A 30-byte window starts in the middle of the third line from the end.
    const content = Array.from({ length: 10 }, (_, i) => `{"n":${1000 + i}}\n`).join('');
    const result = await readTail(file(content), { startBytes: 30, until: () => false, maxBytes: 30 });
    expect(result.lines).toEqual([{ n: 1008 }, { n: 1009 }]);
    expect(result.bytesRead).toBe(30);
    expect(result.complete).toBe(false);
  });

  it('grows until a line satisfies `until`, and stops at the first window that has one', async () => {
    const hasCwd = (line: unknown) => isObject(line) && 'cwd' in line;
    // 300 KB of lines, then a line with a cwd, then 150 KB of lines that have none (the end of an idle session is like this).
    const path = file(`${numberedLines(3000)}{"type":"user","cwd":"/fixture/repo"}\n${numberedLines(1500)}`);
    const result = await readTail(path, { until: hasCwd });
    expect(result.lines.some(hasCwd)).toBe(true);
    expect(result.complete).toBe(true);
    // 64 KB and 128 KB do not reach it, 256 KB does. Nothing was read past that.
    expect(result.bytesRead).toBe(256 * 1024);

    // When a line in the first window satisfies it, the window does not grow.
    const near = await readTail(file(`${numberedLines(2200)}{"type":"user","cwd":"/fixture/repo"}\n`), { until: hasCwd });
    expect(near.bytesRead).toBe(TAIL_START_BYTES);
  });

  it('when no line ever satisfies `until`, it reads back to the start of a small file, and to the cap of a big one', async () => {
    const never = () => false;
    const small = await readTail(file(numberedLines(1000)), { until: never }); // 100 KB
    expect(small.complete).toBe(true);
    expect(small.lines).toHaveLength(1000);

    const big = await readTail(file(numberedLines(60_000)), { until: never }); // 6 MB
    expect(big.complete).toBe(false);
    expect(big.bytesRead).toBe(TAIL_MAX_BYTES);
  });

  it('unknown line types, text that is not JSON, and JSON that is not an object never make it throw', async () => {
    const path = file('this is not json\n{"type":"from-the-future","x":1}\n42\n"text"\nnull\n[1,2]\n\n   \n{"type":"user"}\n');
    const result = await readTail(path);
    // Every line that is JSON is handed on as it is (the parsers decide what they know); the text that is not JSON is skipped.
    expect(result.lines).toEqual([{ type: 'from-the-future', x: 1 }, 42, 'text', null, [1, 2], { type: 'user' }]);
  });

  it('reads CRLF line ends and characters of more than one byte', async () => {
    const result = await readTail(file('{"n":1,"light":"🟢"}\r\n{"n":2,"text":"ä ö ü"}\r\n'));
    expect(result.lines).toEqual([
      { n: 1, light: '🟢' },
      { n: 2, text: 'ä ö ü' },
    ]);
  });

  it('a file that is not there is an error for the caller, not a silent empty answer', async () => {
    await expect(readTail(join(dir, 'missing.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('readFirstTimestamp', () => {
  it('reads the time of the first line that has one', async () => {
    const path = file(jsonl([{ type: 'custom-title', customTitle: 'x' }, { type: 'user', timestamp: '2026-10-05T10:00:00.000Z' }, { type: 'user', timestamp: '2026-10-05T11:00:00.000Z' }]));
    expect(await readFirstTimestamp(path)).toBe('2026-10-05T10:00:00.000Z');
  });

  it('gives the time of a first line that is too long to read whole, when the time comes before the long text', async () => {
    // As the first line of many real session files: a queue-operation line that holds the whole first prompt. Its time is before the text.
    const first = `{"type":"queue-operation","operation":"enqueue","timestamp":"2026-10-05T09:00:00.000Z","sessionId":"s","content":"${'x'.repeat(100 * 1024)}"}\n`;
    const path = file(first + jsonl([{ type: 'user', timestamp: '2026-10-05T09:01:00.000Z' }]));
    expect(await readFirstTimestamp(path)).toBe('2026-10-05T09:00:00.000Z');
  });

  it('gives null when a first line that is too long has its time after the long text', async () => {
    const first = `{"type":"user","message":{"content":"${'x'.repeat(100 * 1024)}"},"timestamp":"2026-10-05T09:00:00.000Z"}\n`;
    expect(await readFirstTimestamp(file(first + jsonl([{ type: 'user', timestamp: '2026-10-05T09:01:00.000Z' }])))).toBeNull();
  });

  it('reads no more than 16 KB: a time that comes later in the file is not looked for', async () => {
    const lines = Array.from({ length: 20 }, () => `${lineOfSize(1024, { type: 'mode' })}\n`).join(''); // 20 KB without a time
    expect(await readFirstTimestamp(file(`${lines}${jsonl([{ type: 'user', timestamp: '2026-10-05T09:00:00.000Z' }])}`))).toBeNull();
    // The same time inside the first 16 KB is found.
    const early = Array.from({ length: 5 }, () => `${lineOfSize(1024, { type: 'mode' })}\n`).join('');
    expect(await readFirstTimestamp(file(`${early}${jsonl([{ type: 'user', timestamp: '2026-10-05T09:00:00.000Z' }])}`))).toBe('2026-10-05T09:00:00.000Z');
  });

  it('skips a value that is not a time, and gives null for a file with no time or no content', async () => {
    expect(await readFirstTimestamp(file(jsonl([{ type: 'user', timestamp: 'yesterday' }, { type: 'user', timestamp: '2026-10-05T09:00:00.000Z' }])))).toBe('2026-10-05T09:00:00.000Z');
    expect(await readFirstTimestamp(file(jsonl([{ type: 'mode' }, { type: 'last-prompt' }])))).toBeNull();
    expect(await readFirstTimestamp(file(''))).toBeNull();
    expect(await readFirstTimestamp(file('not json at all\n'))).toBeNull();
  });
});

describe('readSmallJson', () => {
  it('reads a small JSON file that holds an object', async () => {
    expect(await readSmallJson(file('{"customTitle":"A title"}'))).toEqual({ customTitle: 'A title' });
  });

  it('gives null for a file that is missing, is not JSON, is not an object, or is larger than the limit', async () => {
    expect(await readSmallJson(join(dir, 'nothing-here.json'))).toBeNull();
    expect(await readSmallJson(file('{"cut":'))).toBeNull();
    expect(await readSmallJson(file('[1,2]'))).toBeNull();
    expect(await readSmallJson(file('"text"'))).toBeNull();
    expect(await readSmallJson(file(JSON.stringify({ pad: 'x'.repeat(200) })), 100)).toBeNull();
  });
});
