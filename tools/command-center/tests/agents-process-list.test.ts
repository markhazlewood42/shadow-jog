import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { processIsAlive, readProcessList } from '../src/server/agents/process-list';

// The process list: the folder where Claude Code keeps one `<pid>.json` for each running process. The reader keeps four keys of a file and
// nothing else, and it never throws for what it finds there. The pid check is injected, so no test needs a real process. Everything below is
// made up: the ids are made up, and so are the sentinel values that stand for the keys that must never leave the server.

const parent = mkdtempSync(join(tmpdir(), 'cc-process-list-'));
afterAll(() => rmSync(parent, { recursive: true, force: true }));

let folders = 0;
/** A new empty folder for one test. */
function freshFolder(): string {
  const folder = join(parent, `list-${folders++}`);
  mkdirSync(folder, { recursive: true });
  return folder;
}

/** The text of a process file as Claude Code writes it: four keys that the reader uses and some that it must leave alone. */
function processFile(pid: number, sessionId: string, status: string, startedAt: number | string = 1_790_000_000_000): string {
  return JSON.stringify({
    pid,
    sessionId,
    cwd: '/fixture/repo',
    startedAt,
    procStart: '134000000000000000',
    version: '0.0.0-fixture',
    kind: 'interactive',
    entrypoint: 'claude-desktop',
    messagingSocketPath: 'SENTINEL-SOCKET-PATH',
    name: 'SENTINEL-NAME',
    status,
    bridgeSessionId: 'SENTINEL-BRIDGE-ID',
  });
}

const write = (folder: string, name: string, text: string) => writeFileSync(join(folder, name), text);

const S1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const S2 = 'bbbbbbbb-0000-4000-8000-000000000002';
const S3 = 'cccccccc-0000-4000-8000-000000000003';

describe('the process list', () => {
  it('C1: a process file that is torn once is read again and counted', async () => {
    const folder = freshFolder();
    write(folder, '7710021.json', '{"pid": 7710021, "sessionId": "'); // half written, as Claude rewrites it
    // The pause between the two reads is injected: it is where Claude finishes the write.
    const pause = vi.fn(async () => write(folder, '7710021.json', processFile(7710021, S1, 'busy')));

    const list = await readProcessList(folder, () => true, pause);

    expect(pause).toHaveBeenCalledTimes(1);
    expect(list).toEqual({ ok: true, entries: [{ sessionId: S1, startedAtMs: 1_790_000_000_000, status: 'busy' }] });
  });

  it('C1: a process file that stays broken is skipped after one retry', async () => {
    const folder = freshFolder();
    write(folder, '7710022.json', ''); // empty, and it stays empty
    write(folder, '7710023.json', processFile(7710023, S2, 'idle'));
    const pause = vi.fn(async () => {});

    const list = await readProcessList(folder, () => true, pause);

    // One retry for the broken file, none for the good one. The good one is kept and the broken one is skipped.
    expect(pause).toHaveBeenCalledTimes(1);
    expect(list).toEqual({ ok: true, entries: [{ sessionId: S2, startedAtMs: 1_790_000_000_000, status: 'idle' }] });
  });

  it('process list reads valid files and drops a dead pid', async () => {
    const folder = freshFolder();
    write(folder, '7710011.json', processFile(7710011, S1, 'busy', 1_790_000_000_000));
    write(folder, '7710012.json', processFile(7710012, S2, 'idle', 1_790_000_100_000));
    write(folder, '7710013.json', processFile(7710013, S3, 'busy')); // the process is gone, and its file stayed
    const alive = vi.fn((pid: number) => pid !== 7710013);

    const list = await readProcessList(folder, alive);

    // Only the live ones, with the session id, the start (as milliseconds) and the status. The pid is not in an entry, and neither is any other key.
    expect(list).toEqual({
      ok: true,
      entries: [
        { sessionId: S1, startedAtMs: 1_790_000_000_000, status: 'busy' },
        { sessionId: S2, startedAtMs: 1_790_000_100_000, status: 'idle' },
      ],
    });
    // The injected check decided: it was asked about each pid, once.
    expect(alive.mock.calls.map((call) => call[0]).sort()).toEqual([7710011, 7710012, 7710013]);
    for (const entry of list.ok ? list.entries : []) expect(Object.keys(entry).sort()).toEqual(['sessionId', 'startedAtMs', 'status']);
  });

  it('process list survives a malformed file, an unknown shape and a missing folder', async () => {
    const folder = freshFolder();
    write(folder, '7710021.json', processFile(7710021, S1, 'busy')); // the one good file
    write(folder, '7710022.json', '{ this is not json'); // malformed
    write(folder, '7710023.json', ''); // empty: a file that is being written
    write(folder, '7710024.json', '[]'); // JSON, and not an object
    write(folder, '7710025.json', 'null');
    write(folder, '7710026.json', '{"hello":"world"}'); // an object of an unknown shape
    write(folder, '7710027.json', JSON.stringify({ pid: 7710027, sessionId: '../../outside/session', status: 'busy', startedAt: 1 })); // a session id that is a path
    write(folder, '7710028.json', JSON.stringify({ pid: 7710028, sessionId: 'a b', status: 'busy', startedAt: 1 })); // not a file name
    write(folder, '7710029.json', JSON.stringify({ pid: 0, sessionId: S2, status: 'busy', startedAt: 1 })); // pid 0 would be a whole process group
    write(folder, '7710030.json', JSON.stringify({ pid: -7710030, sessionId: S2, status: 'busy', startedAt: 1 }));
    write(folder, '7710031.json', JSON.stringify({ pid: 12.5, sessionId: S2, status: 'busy', startedAt: 1 }));
    write(folder, '7710032.json', JSON.stringify({ pid: '7710032', sessionId: S2, status: 'busy', startedAt: 1 })); // a pid as text
    write(folder, '7710033.json', JSON.stringify({ pid: 7710033, sessionId: S2, status: 'sleeping', startedAt: 1 })); // a status that this does not know
    write(folder, '7710034.json', JSON.stringify({ pid: 7710034, status: 'busy', startedAt: 1 })); // no session id
    write(folder, '7710035.json', `{"pad":"${'x'.repeat(70_000)}","pid":7710035,"sessionId":"${S2}","status":"busy"}`); // far bigger than a process file
    mkdirSync(join(folder, '7710036.json')); // a folder with the name of a file
    // Files that are not process files, whatever is in them: a key file (it holds a secret), a backup, a note.
    const looksValid = processFile(7710040, 'must-never-be-read', 'busy');
    write(folder, `7710040.${'f'.repeat(64)}.key`, looksValid);
    write(folder, '7710041.json.bak', looksValid);
    write(folder, 'notes.txt', looksValid);
    write(folder, 'x7710042.json', looksValid);
    const alive = vi.fn(() => true);

    const list = await readProcessList(folder, alive);

    expect(list).toEqual({ ok: true, entries: [{ sessionId: S1, startedAtMs: 1_790_000_000_000, status: 'busy' }] });
    // The check ran for the good file only: not for pid 0 or a negative one (the system would read them as groups of processes), and not for a bad shape.
    expect(alive.mock.calls).toEqual([[7710021]]);

    // A missing folder, and a path that is a file and not a folder, are "no process list". Neither throws.
    expect(await readProcessList(join(parent, 'there-is-no-such-folder'), alive)).toEqual({ ok: false, reason: 'missing', code: 'ENOENT' });
    write(parent, 'a-file-not-a-folder', 'x');
    expect(await readProcessList(join(parent, 'a-file-not-a-folder'), alive)).toMatchObject({ ok: false, reason: 'missing' });

    // A folder with no process in it is a list with none: Claude Code runs nowhere. (Names that are not `<digits>.json` do not count.)
    const empty = freshFolder();
    write(empty, 'notes.txt', looksValid);
    expect(await readProcessList(empty, alive)).toEqual({ ok: true, entries: [] });

    // A folder where files are named like process files and none has the shape: Claude Code may have changed the format, and the list cannot be trusted.
    const changed = freshFolder();
    write(changed, '7710050.json', JSON.stringify({ id: 'a', state: 'busy' }));
    write(changed, '7710051.json', '{ broken');
    expect(await readProcessList(changed, alive)).toEqual({ ok: false, reason: 'unknown-format' });

    // A file of the right shape for a process that is gone is still the right shape: the list is readable, and says that nothing runs.
    const stale = freshFolder();
    write(stale, '7710060.json', processFile(7710060, S1, 'busy'));
    expect(await readProcessList(stale, () => false)).toEqual({ ok: true, entries: [] });
  });

  it('reads the start time as milliseconds, and as null when the file does not say', async () => {
    const folder = freshFolder();
    write(folder, '7710071.json', processFile(7710071, S1, 'busy', 1_790_000_000_123));
    write(folder, '7710072.json', processFile(7710072, S2, 'busy', 'yesterday')); // not a number
    write(folder, '7710073.json', JSON.stringify({ pid: 7710073, sessionId: S3, status: 'idle', startedAt: 1e20 })); // not a time
    const list = await readProcessList(folder, () => true);
    expect(list).toEqual({
      ok: true,
      entries: [
        { sessionId: S1, startedAtMs: 1_790_000_000_123, status: 'busy' },
        { sessionId: S2, startedAtMs: null, status: 'busy' },
        { sessionId: S3, startedAtMs: null, status: 'idle' },
      ],
    });
  });

  it('two live processes of one session give one entry: busy when one of them is busy, and the earliest start', async () => {
    const folder = freshFolder();
    write(folder, '7710081.json', processFile(7710081, S1, 'idle', 1_790_000_000_000));
    write(folder, '7710082.json', processFile(7710082, S1, 'busy', 1_790_000_500_000)); // a resumed session that works
    write(folder, '7710083.json', processFile(7710083, S2, 'idle', 1_790_000_900_000));
    write(folder, '7710084.json', processFile(7710084, S2, 'idle', 1_790_000_100_000)); // both idle: idle, and the earlier start
    const list = await readProcessList(folder, () => true);
    expect(list).toEqual({
      ok: true,
      entries: [
        { sessionId: S1, startedAtMs: 1_790_000_000_000, status: 'busy' },
        { sessionId: S2, startedAtMs: 1_790_000_100_000, status: 'idle' },
      ],
    });
  });
});

describe('the default pid check', () => {
  afterEach(() => vi.restoreAllMocks());

  it('asks the system with signal 0, which sends nothing: the program itself is alive', () => {
    expect(processIsAlive(process.pid)).toBe(true);
  });

  it('EPERM means alive and ESRCH means dead, and any other answer is not alive', () => {
    const kill = vi.spyOn(process, 'kill');
    const answer = (code: string | null) =>
      kill.mockImplementationOnce(() => {
        if (code === null) return true;
        throw Object.assign(new Error(`simulated ${code}`), { code });
      });
    answer('EPERM');
    expect(processIsAlive(4242)).toBe(true); // the process exists, and belongs to another account
    answer('ESRCH');
    expect(processIsAlive(4242)).toBe(false); // there is no such process
    answer('EINVAL');
    expect(processIsAlive(4242)).toBe(false);
    answer(null);
    expect(processIsAlive(4242)).toBe(true);
    // Always signal 0: the check must never stop a process.
    expect(kill.mock.calls).toEqual([
      [4242, 0],
      [4242, 0],
      [4242, 0],
      [4242, 0],
    ]);
  });

  it('readProcessList uses it when no check is given', async () => {
    const folder = freshFolder();
    write(folder, `${process.pid}.json`, processFile(process.pid, S1, 'busy'));
    write(folder, '7710091.json', processFile(7710091, S2, 'busy'));
    const kill = vi.spyOn(process, 'kill').mockImplementation(((pid: number) => {
      if (pid === process.pid) return true;
      throw Object.assign(new Error('simulated ESRCH'), { code: 'ESRCH' });
    }) as typeof process.kill);
    const list = await readProcessList(folder);
    expect(list).toEqual({ ok: true, entries: [{ sessionId: S1, startedAtMs: 1_790_000_000_000, status: 'busy' }] });
    expect(kill.mock.calls.every((call) => call[1] === 0)).toBe(true);
  });
});
