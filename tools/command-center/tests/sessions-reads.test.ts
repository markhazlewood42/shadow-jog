import { appendFileSync, closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync, statSync, utimesSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHub } from '../src/server/hub';
import { createSessionsSource } from '../src/server/sessions/sessions';
import { readFirstTimestamp, readTail } from '../src/server/sessions/tail';
import { INSIDE, MIXED_FOLDER, NOW, WHOLE_FOLDER, assistantText, at, copyClaudeFixtures, customTitle, jsonl, lastPrompt, lineOfSize, numberedLines, sessionsConfig, setAge, userPrompt, writeAged } from './sessions-helpers';

// What the sessions module reads from disk. The module opens a file only through `open` of
// node:fs/promises (the no-write scan checks that its flag is always 'r'), so a wrapper around `open`
// sees every byte that it reads, and a wrapper around `readdir` and `stat` sees every folder that it lists
// and every file that it looks at. The tests below use that to prove the three promises of the module:
// it reads only a bounded end of a file, it reads a file again only when it changed, and it never goes
// into a folder that the config does not name.

const spy = vi.hoisted(() => ({
  opens: [] as { path: string; bytes: number }[],
  listed: [] as string[],
  looked: [] as string[],
  /** Paths that cannot be opened: the error code that opening them gives (a locked file is EBUSY). */
  failures: new Map<string, string>(),
  /** When set, a read gives at most this many bytes, as a file system may give fewer than were asked for. */
  chunk: null as number | null,
  /** How many files are open now, and the most at one time. */
  live: 0,
  maxLive: 0,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const failure = spy.failures.get(String(args[0]));
      if (failure !== undefined) throw Object.assign(new Error(`${failure}: a simulated failure`), { code: failure });
      const handle = await actual.open(...args);
      const entry = { path: String(args[0]), bytes: 0 };
      spy.opens.push(entry);
      const read = handle.read.bind(handle) as unknown as (...readArgs: unknown[]) => Promise<{ bytesRead: number }>;
      (handle as unknown as { read: unknown }).read = async (...readArgs: unknown[]) => {
        // read(buffer, offset, length, position): a short read is a read that was asked for less.
        if (spy.chunk !== null) readArgs[2] = Math.min(Number(readArgs[2]), spy.chunk);
        const result = await read(...readArgs);
        entry.bytes += result.bytesRead;
        return result;
      };
      const close = handle.close.bind(handle);
      spy.live += 1;
      spy.maxLive = Math.max(spy.maxLive, spy.live);
      (handle as unknown as { close: unknown }).close = async () => {
        spy.live -= 1;
        return close();
      };
      return handle;
    },
    readdir: ((...args: unknown[]) => {
      spy.listed.push(String(args[0]));
      return (actual.readdir as unknown as (...a: unknown[]) => unknown)(...args);
    }) as typeof actual.readdir,
    stat: ((...args: unknown[]) => {
      spy.looked.push(String(args[0]));
      return (actual.stat as unknown as (...a: unknown[]) => unknown)(...args);
    }) as typeof actual.stat,
  };
});

const parent = mkdtempSync(join(tmpdir(), 'cc-reads-'));
afterAll(() => rmSync(parent, { recursive: true, force: true }));

const forgetWhatWasSpiedOn = () => {
  spy.opens.length = 0;
  spy.listed.length = 0;
  spy.looked.length = 0;
  spy.failures.clear();
  spy.chunk = null;
  spy.live = 0;
  spy.maxLive = 0;
};
beforeEach(forgetWhatWasSpiedOn);

const MEGABYTE = 1024 * 1024;
const S1 = '11111111-1111-4111-8111-111111111111';
const S3 = '33333333-3333-4333-8333-333333333333';
const RUN1 = 'wf_00000001-aaa';

/** The paths of the files that were opened, once each. */
const openedPaths = () => [...new Set(spy.opens.map((entry) => entry.path))];

/** The total number of bytes read through the files that were opened since the last reset. */
const bytesRead = () => spy.opens.reduce((sum, entry) => sum + entry.bytes, 0);

async function loadOnce(projects: string) {
  const source = createSessionsSource({ config: sessionsConfig(projects), hub: createHub(), now: () => NOW });
  const panel = await source.get(true);
  if (!panel.ok) throw new Error(`the panel failed: ${panel.error.code}`);
  return panel.data;
}

describe('how much is read', () => {
  const projects = join(parent, 'huge');
  const id = 'dddddddd-0000-4000-8000-000000000001';
  const hugeFile = join(projects, WHOLE_FOLDER, `${id}.jsonl`);

  /**
   * A session file of 300 MB with a few real lines at its start and at its end, and zero bytes in between. The file is made
   * with a hole, which the file system does not write out, so it takes no time and no disk. A reader that went through the middle
   * would read zeros, and a lot of them.
   */
  beforeAll(() => {
    mkdirSync(dirname(hugeFile), { recursive: true });
    const head = jsonl([{ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-10-06T09:00:00.000Z', sessionId: 'big', content: 'LEAK-head' }, userPrompt('LEAK-first-prompt', { time: at(-7200) })]);
    // The newline in front ends the last line of the hole (the zeros), so that the lines of the end start at a line start.
    const tail = `\n${jsonl([assistantText('LEAK-final-reply', { time: at(-90) }), customTitle('ALLOWED-title-of-the-big-session'), lastPrompt()])}`;
    const size = 300 * MEGABYTE;
    const fd = openSync(hugeFile, 'w');
    try {
      ftruncateSync(fd, size);
      writeSync(fd, head, 0, 'utf8');
      writeSync(fd, tail, size - Buffer.byteLength(tail), 'utf8');
    } finally {
      closeSync(fd);
    }
    setAge(hugeFile, 60);
  });

  it('a 300 MB fixture is read in under 1 MB (reader spy)', async () => {
    expect(statSync(hugeFile).size).toBe(300 * MEGABYTE); // the fixture really is 300 MB

    const info = await loadOnce(projects);

    // The module found what is at both ends of the file: the time it began, and the title, the state and the cwd at its end.
    expect(info.sessions).toHaveLength(1);
    expect(info.sessions[0]).toMatchObject({ id, title: 'ALLOWED-title-of-the-big-session', cwd: INSIDE, state: 'waiting', startedAt: '2026-10-06T09:00:00.000Z' });

    // And it read less than 1 MB to do so. By its limits that is the first 16 KB, and one window of 64 KB at the end.
    expect(bytesRead()).toBeLessThan(MEGABYTE);
    const ofTheFile = spy.opens.filter((entry) => entry.path === hugeFile);
    expect(ofTheFile.map((entry) => entry.bytes).sort((a, b) => a - b)).toEqual([16 * 1024, 64 * 1024]);
    expect(spy.opens.some((entry) => entry.bytes > 64 * 1024)).toBe(false);
  });

  it('the reader spy sees every byte: readTail of the huge file reads its window and nothing more', async () => {
    const result = await readTail(hugeFile);
    expect(result.lines).toHaveLength(3);
    expect(result.bytesRead).toBe(64 * 1024);
    expect(spy.opens).toEqual([{ path: hugeFile, bytes: 64 * 1024 }]); // what the reader counted is what the file system was asked for
  });
});

describe('how files are read', () => {
  it('a read that gives less than was asked for is asked again until the window is full', async () => {
    const file = join(parent, 'short-reads.jsonl');
    writeFileSync(file, `{"type":"user","timestamp":"2026-10-06T09:00:00.000Z"}\n${numberedLines(2000)}`);
    const whole = await readTail(file, { until: () => false });
    const firstTime = await readFirstTimestamp(file);
    expect(whole.lines).toHaveLength(2001);

    spy.chunk = 1000; // every read gives 1000 bytes at most
    expect(await readTail(file, { until: () => false })).toEqual(whole);
    expect(await readFirstTimestamp(file)).toBe(firstTime);
    expect(firstTime).toBe('2026-10-06T09:00:00.000Z');
    expect(spy.opens.length).toBeGreaterThan(2); // and it was read, not served from a cache
  });

  it('at most 16 files are read at one time, whatever the number of sessions', async () => {
    const projects = join(parent, 'many');
    for (let n = 0; n < 80; n += 1) {
      writeAged(join(projects, WHOLE_FOLDER, `ffffffff-0000-4000-8000-${String(n).padStart(12, '0')}.jsonl`), jsonl([userPrompt('go'), assistantText('Done.')]));
    }
    forgetWhatWasSpiedOn();
    const info = await loadOnce(projects);
    expect(info.sessions).toHaveLength(80);
    // A session is read at its end and at its start together, so 16 sessions at once are at most 32 open files.
    expect(spy.maxLive).toBeLessThanOrEqual(32);
    expect(spy.maxLive).toBeGreaterThan(8); // they do go side by side
    expect(spy.live).toBe(0); // and every file was closed
  });
});

describe('a window that grows', () => {
  it('reads each byte once: what the file system was asked for is what readTail counts', async () => {
    // 1.2 MB of small lines and a last line of 300 KB: the window doubles from 64 KB to 512 KB before the line fits.
    const file = join(parent, 'grows.jsonl');
    writeFileSync(file, `${numberedLines(12_000)}${lineOfSize(300 * 1024, { big: true })}\n`);
    const result = await readTail(file);
    expect(result.lines.at(-1)).toMatchObject({ big: true });
    expect(result.bytesRead).toBe(512 * 1024);
    // Four passes (64, 128, 256 and 512 KB windows) asked the file system for 512 KB in all, and not for the 960 KB that four whole windows would be.
    expect(spy.opens).toEqual([{ path: file, bytes: 512 * 1024 }]);
  });
});

describe('a file that did not change is not read again', () => {
  /** How many files the first look opens: 8 session files (every recent file of the two folders is read, to find its cwd), 5 agent files and their 5 metas and the journal of the run in S1, S3's custom-title.json, and the agent, its meta and the journal in S6. */
  const FILES_OF_THE_FIRST_LOOK = 8 + 5 + 5 + 1 + 1 + 3;

  it('an unchanged file is not read again', async () => {
    const projects = copyClaudeFixtures(join(parent, 'unchanged'));
    const source = createSessionsSource({ config: sessionsConfig(projects), hub: createHub(), now: () => NOW });

    // The first look reads the files of every session that was kept, and of their agents and workflows.
    expect((await source.get(true)).ok).toBe(true);
    const first = openedPaths();
    expect(first).toHaveLength(FILES_OF_THE_FIRST_LOOK);
    expect(first).toContain(join(projects, WHOLE_FOLDER, `${S1}.jsonl`));
    expect(first).toContain(join(projects, WHOLE_FOLDER, S1, 'subagents', 'workflows', RUN1, 'journal.jsonl'));
    expect(first).toContain(join(projects, WHOLE_FOLDER, S3, 'custom-title.json'));

    // A second look finds every file the same as before, and opens none. It still lists the folders and looks at the files: that is how it knows.
    forgetWhatWasSpiedOn();
    expect((await source.get(true)).ok).toBe(true);
    expect(spy.opens).toEqual([]);
    expect(spy.listed.length).toBeGreaterThan(5);
    expect(spy.looked.length).toBeGreaterThan(FILES_OF_THE_FIRST_LOOK);

    // One session file grows by a line: that file is read again (its end and its start), and no other file is.
    const sessionFile = join(projects, WHOLE_FOLDER, `${S1}.jsonl`);
    appendFileSync(sessionFile, jsonl([userPrompt('and one more thing', { cwd: INSIDE })]));
    setAge(sessionFile, 30);
    forgetWhatWasSpiedOn();
    expect((await source.get(true)).ok).toBe(true);
    expect(openedPaths()).toEqual([sessionFile]);

    // One agent file grows: only that file is read, and not the session file, the other agents or the journal of the run.
    const agentFile = join(projects, WHOLE_FOLDER, S1, 'subagents', 'agent-a0000002.jsonl');
    appendFileSync(agentFile, jsonl([assistantText('now it is done', { cwd: INSIDE })]));
    setAge(agentFile, 20);
    forgetWhatWasSpiedOn();
    const panel = await source.get(true);
    expect(openedPaths()).toEqual([agentFile]);
    // And what was read is in the answer.
    if (!panel.ok) throw new Error('the panel failed');
    expect(panel.data.sessions.find((session) => session.id === S1)?.agents.find((agent) => agent.id === 'a0000002')).toMatchObject({ state: 'done' });

    // A file that is only touched (its time changes, its size does not) is read again too: the time is part of what is compared.
    const journal = join(projects, WHOLE_FOLDER, S1, 'subagents', 'workflows', RUN1, 'journal.jsonl');
    setAge(journal, 45);
    forgetWhatWasSpiedOn();
    await source.get(true);
    expect(openedPaths()).toEqual([journal]);

    // A file that grows but keeps its time of last write (a file system with a coarse clock does this) is read again too: the size is part of what is compared.
    const sameTime = statSync(agentFile).mtime;
    appendFileSync(agentFile, jsonl([assistantText('a second line', { cwd: INSIDE })]));
    utimesSync(agentFile, sameTime, sameTime);
    forgetWhatWasSpiedOn();
    await source.get(true);
    expect(openedPaths()).toEqual([agentFile]);

    // And the next look finds everything the same again.
    forgetWhatWasSpiedOn();
    await source.get(true);
    expect(spy.opens).toEqual([]);
  });

  it('a file is remembered only while it is in the week: when a session ages out it is forgotten, and read again if it comes back', async () => {
    const projects = copyClaudeFixtures(join(parent, 'forget'));
    let nowMs = NOW;
    const source = createSessionsSource({ config: sessionsConfig(projects), hub: createHub(), now: () => nowMs });
    await source.get(true);
    // Eight days later every file is out of the week: nothing is listed and nothing is read.
    nowMs = NOW + 8 * 24 * 3600 * 1000;
    forgetWhatWasSpiedOn();
    const later = await source.get(true);
    expect(later.ok && later.data).toEqual({ sessions: [], scanned: 0, skipped: 0 });
    expect(spy.opens).toEqual([]);
    // Back in the week, the files are read again: the cache did not keep them.
    nowMs = NOW;
    forgetWhatWasSpiedOn();
    await source.get(true);
    expect(openedPaths()).toHaveLength(FILES_OF_THE_FIRST_LOOK);
  });
});

describe('the folders that are read', () => {
  it('no path inside a folder that is not named is listed, looked at or opened', async () => {
    const projects = copyClaudeFixtures(join(parent, 'allowlist'));
    const info = await loadOnce(projects);
    const everything = [...spy.listed, ...spy.looked, ...spy.opens.map((entry) => entry.path)];
    // The named folders were read.
    expect(everything.some((path) => path.startsWith(join(projects, WHOLE_FOLDER)))).toBe(true);
    expect(everything.some((path) => path.startsWith(join(projects, MIXED_FOLDER)))).toBe(true);
    // The folder that only shares the start of a name was not touched, though it holds a session that would be kept if it were read.
    expect(everything.filter((path) => path.includes('fixture-shadow-jog-old') || path.includes('99999999'))).toEqual([]);
    expect(info.sessions.map((session) => session.id)).not.toContain('99999999-9999-4999-8999-999999999999');
    // The folder above the named ones is never listed either: a listing of it is how a prefix match would find its folders.
    expect(spy.listed).not.toContain(projects);
  });
});

describe('a file that cannot be read', () => {
  const S2 = '22222222-2222-4222-8222-222222222222';
  const sessionPath = (projects: string, folder: string, id: string) => join(projects, folder, `${id}.jsonl`);

  it('a session file that cannot be read is skipped and counted, and the other sessions are still listed', async () => {
    const projects = copyClaudeFixtures(join(parent, 'locked-session'));
    spy.failures.set(sessionPath(projects, WHOLE_FOLDER, S3), 'EBUSY');
    const info = await loadOnce(projects);
    expect(info.sessions.map((session) => session.id.slice(0, 8))).toEqual(['11111111', '44444444', '55555555', '66666666']);
    expect(info).toMatchObject({ scanned: 8, skipped: 4 }); // S2, S7 and S8 are outside the project, and S3 could not be read
  });

  it('when no session file can be read the panel is an error that names the error code and no path', async () => {
    const projects = copyClaudeFixtures(join(parent, 'locked-all'));
    for (const folder of [WHOLE_FOLDER, MIXED_FOLDER]) {
      for (const id of [S1, S2, S3, '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666', '77777777-7777-4777-8777-777777777777', '88888888-8888-4888-8888-888888888888']) {
        spy.failures.set(sessionPath(projects, folder, id), 'EBUSY');
      }
    }
    const source = createSessionsSource({ config: sessionsConfig(projects), hub: createHub(), now: () => NOW });
    const panel = await source.get(true);
    expect(panel.ok).toBe(false);
    if (panel.ok) return;
    expect(panel.error.code).toBe('sessions-unreadable');
    expect(panel.error.message).toContain('EBUSY');
    expect(panel.error.message).not.toContain(projects);
  });

  it('an agent, a journal or a title file that cannot be read does not take the session away: the module goes on without it, and says so once', async () => {
    const projects = copyClaudeFixtures(join(parent, 'locked-detail'));
    const complaints = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const agentDir = join(projects, WHOLE_FOLDER, S1, 'subagents');
      spy.failures.set(join(agentDir, 'agent-a0000001.jsonl'), 'EBUSY');
      spy.failures.set(join(agentDir, 'agent-a0000002.meta.json'), 'EACCES');
      spy.failures.set(join(agentDir, 'workflows', RUN1, 'journal.jsonl'), 'EBUSY');
      spy.failures.set(join(projects, WHOLE_FOLDER, S3, 'custom-title.json'), 'EBUSY');

      const source = createSessionsSource({ config: sessionsConfig(projects), hub: createHub(), now: () => NOW });
      const first = await source.get(true);
      if (!first.ok) throw new Error(`the panel failed: ${first.error.code}`);
      const s1 = first.data.sessions.find((session) => session.id === S1);
      // The session is there, with its other agents. The agent that could not be read has no start from its file (the time the file was made is used)
      // and is not known to have ended, so a fresh file means that it runs.
      expect(s1?.agents.map((agent) => agent.id).sort()).toEqual(['a0000001', 'a0000002', 'w0000001', 'w0000002', 'w0000003']);
      expect(s1?.agents.find((agent) => agent.id === 'a0000001')).toMatchObject({ state: 'running', endedAt: null, description: 'ALLOWED-description-explore-the-engine' });
      expect(s1?.agents.find((agent) => agent.id === 'a0000002')).toMatchObject({ description: '', agentType: '' }); // its .meta.json could not be read
      // The run has a journal that could not be read: it says nothing, and the run is unknown (its agents are still listed).
      expect(s1?.workflows[0]).toMatchObject({ id: RUN1, state: 'unknown', started: 0, done: 0, phases: [] });
      expect(s1?.agents.filter((agent) => agent.workflowId === RUN1)).toHaveLength(3);
      // The title file could not be read: the session has no title from it.
      expect(first.data.sessions.find((session) => session.id === S3)?.title).toBe('Session 33333333');

      // The console said so, once for each file, and not again at the next look.
      expect(complaints).toHaveBeenCalledTimes(4);
      await source.get(true);
      expect(complaints).toHaveBeenCalledTimes(4);
      // And the message names the file for the person who runs the server, and holds no text of a session.
      const said = complaints.mock.calls.map((call) => String(call[0]));
      expect(said.some((line) => line.includes('agent-a0000001.jsonl') && line.includes('EBUSY'))).toBe(true);
      expect(said.join('\n')).not.toContain('LEAK-');
    } finally {
      complaints.mockRestore();
    }
  });
});
