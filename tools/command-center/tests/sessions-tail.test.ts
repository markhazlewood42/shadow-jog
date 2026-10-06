import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { HEAD_MAX_BYTES, TAIL_MAX_BYTES, TAIL_START_BYTES, readFirstTimestamp, readHead, readSmallJson, readTail } from '../src/server/sessions/tail';
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

    // The cut piece of a line is dropped even when it would be JSON by itself. A line that is a number is cut to a shorter number:
    // the last 15 bytes of "1111111111", "2222222222" and "3333333333" (a line each) begin with the end of the second line, "222".
    const numbers = await readTail(file('1111111111\n2222222222\n3333333333\n'), { startBytes: 15, until: () => false, maxBytes: 15 });
    expect(numbers.lines).toEqual([3333333333]);
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

describe('readHead', () => {
  const TIME = '2026-10-05T09:00:00.000Z';
  const queued = (content: string, operation = 'enqueue', time = TIME) => JSON.stringify({ type: 'queue-operation', operation, timestamp: time, sessionId: 's', content });
  const user = (content: unknown, extra: Record<string, unknown> = {}, time = TIME) => JSON.stringify({ type: 'user', timestamp: time, message: { role: 'user', content }, ...extra });
  const head = (...lines: string[]) => `${lines.join('\n')}\n`;

  it('gives the time of the first line that has one and the first line of the first prompt, from one read of the first 16 KB', async () => {
    const first = file(head(JSON.stringify({ type: 'custom-title', customTitle: 'x' }), user('Make the widget round\nand blue', {}, '2026-10-05T10:00:00.000Z'), user('A later prompt')));
    expect(await readHead(first)).toEqual({ timestamp: '2026-10-05T10:00:00.000Z', prompt: 'Make the widget round' });
    // The time of readFirstTimestamp is the time of readHead.
    expect(await readFirstTimestamp(first)).toBe('2026-10-05T10:00:00.000Z');
    // A file with no prompt and no time gives both as null, and an empty file too.
    expect(await readHead(file(head(JSON.stringify({ type: 'mode' }))))).toEqual({ timestamp: null, prompt: null });
    expect(await readHead(file(''))).toEqual({ timestamp: null, prompt: null });
  });

  it('the first prompt is the first one of Mark: injected lines, tool results, task notifications, messages of other sessions and interrupts before it are skipped', async () => {
    const path = file(
      head(
        user('injected text', { isMeta: true }),
        JSON.stringify({ type: 'user', timestamp: TIME, message: { role: 'user', content: [{ type: 'tool_result', content: 'output' }] }, toolUseResult: {} }),
        user('a task finished', { origin: { kind: 'task-notification' } }),
        user('from another session', { origin: { kind: 'peer' } }),
        user('[Request interrupted by user]'),
        user('   '), // no words
        user([{ type: 'image', source: {} }]), // a picture and no words
        user('The first real prompt\nwith a second line'),
        user('The second real prompt'),
      ),
    );
    expect((await readHead(path)).prompt).toBe('The first real prompt');
  });

  it('a prompt that was queued is a prompt, and so is the first one in the file, whichever line holds it; a queued task notification is not one', async () => {
    // Most real files begin with the prompt that started the session, queued, and its user line comes after it.
    expect((await readHead(file(head(queued('The queued prompt\nsecond line'), queued('', 'dequeue'), user('The user line of the same prompt'))))).prompt).toBe('The queued prompt');
    // The user line is first here.
    expect((await readHead(file(head(user('The user line first'), queued('A queued prompt after it'))))).prompt).toBe('The user line first');
    // A notification that a background task finished was queued; it is not Mark's prompt.
    expect((await readHead(file(head(queued('<task-notification>a task finished</task-notification>'), queued('The real prompt'))))).prompt).toBe('The real prompt');
    expect((await readHead(file(head(queued('<task-notification>only this</task-notification>'))))).prompt).toBeNull();
  });

  it('a queued prompt on a line that the 16 KB window cuts still gives its first line, and the time of that line', async () => {
    // As in most real files: one first line that is longer than the window, because it holds the whole first prompt.
    const long = (first: string) => queued(`${first}\nthe second line ${'x'.repeat(100 * 1024)}`);
    const path = file(`${long('The first line of a long prompt')}\n${user('A user line far behind it')}\n`);
    expect(await readHead(path)).toEqual({ timestamp: TIME, prompt: 'The first line of a long prompt' });

    // The escapes of JSON in that first line are read: a quote, a backslash, a tab, a letter with an accent and a picture.
    const escaped = file(`${long('Say "hi" to C:\\temp\tthen é and 🟢 now')}\n`);
    expect((await readHead(escaped)).prompt).toBe('Say "hi" to C:\\temp then é and 🟢 now'); // the tab is white space, so it is one space

    // The window cuts the first line itself (a prompt that is one long line): the title is its first 80 characters.
    const oneLine = file(`${queued('One long line '.repeat(5000))}\n`);
    expect((await readHead(oneLine)).prompt).toBe(`${'One long line '.repeat(6).slice(0, 79)}…`);
  });

  it('a window that ends inside an escape of the cut line does not lose the first line: the half escape at the cut is dropped', async () => {
    const prefix = `{"type":"queue-operation","operation":"enqueue","timestamp":"${TIME}","sessionId":"s","content":"`;
    const first = 'The title of the prompt';
    // The escape \u001b has 6 characters. The window ends after 1, 2, 3, 4 or 5 of them.
    for (let kept = 1; kept <= 5; kept += 1) {
      const pad = HEAD_MAX_BYTES - kept - prefix.length - first.length - 2; // 2 for the \n after the first line
      const line = `${prefix}${first}\\n${'x'.repeat(pad)}\\u001b${'y'.repeat(2000)}"}`;
      expect(line.slice(HEAD_MAX_BYTES - kept, HEAD_MAX_BYTES - kept + 6)).toBe('\\u001b'); // the escape starts `kept` characters before the end of the window
      expect((await readHead(file(`${line}\n`))).prompt, `kept ${kept}`).toBe(first);
    }
    // A lone backslash at the cut (the start of an escaped quote) too.
    const pad = HEAD_MAX_BYTES - 1 - prefix.length - first.length - 2;
    expect((await readHead(file(`${prefix}${first}\\n${'x'.repeat(pad)}\\"${'y'.repeat(2000)}"}\n`))).prompt).toBe(first);
  });

  it('a cut line that is not a queued prompt gives no prompt: a user line, a dequeue, a notification, a line that is not JSON', async () => {
    const big = 'x'.repeat(100 * 1024);
    expect((await readHead(file(`${user(`A user line that is cut ${big}`)}\n`))).prompt).toBeNull(); // the markers that say who wrote it come after the text
    expect((await readHead(file(`${queued(`words ${big}`, 'dequeue')}\n`))).prompt).toBeNull();
    expect((await readHead(file(`${queued(`<task-notification>${big}</task-notification>`)}\n`))).prompt).toBeNull();
    expect((await readHead(file(`{"type":"queue-operation","operation":"enqueue" this is not json ${big}\n`))).prompt).toBeNull();
    expect((await readHead(file(`not json at all ${big}\n`))).prompt).toBeNull();
  });

  it('only the first 16 KB are looked at: a prompt behind them is not found', async () => {
    const filler = `${Array.from({ length: 20 }, () => lineOfSize(1024, { type: 'mode' })).join('\n')}\n`; // 20 KB of notes
    expect((await readHead(file(`${filler}${user('A prompt behind 20 KB of notes')}\n`))).prompt).toBeNull();
    const near = `${Array.from({ length: 5 }, () => lineOfSize(1024, { type: 'mode' })).join('\n')}\n`;
    expect((await readHead(file(`${near}${user('A prompt behind 5 KB of notes')}\n`))).prompt).toBe('A prompt behind 5 KB of notes');
  });

  it('the time comes from the piece of a line that the window cut, also when that line is not the first', async () => {
    const cutLine = queued(`words ${'x'.repeat(100 * 1024)}`, 'enqueue', '2026-10-05T08:30:00.000Z');
    // A first line that is whole and has no time, then a long line that names its time before its words.
    const path = file(`${JSON.stringify({ type: 'custom-title', customTitle: 'x' })}\n${cutLine}\n`);
    expect((await readHead(path)).timestamp).toBe('2026-10-05T08:30:00.000Z');
    // A whole line with a time is used before the piece of a cut one.
    const both = file(`${user('hello', {}, '2026-10-05T07:00:00.000Z')}\n${cutLine}\n`);
    expect((await readHead(both)).timestamp).toBe('2026-10-05T07:00:00.000Z');
  });
});
