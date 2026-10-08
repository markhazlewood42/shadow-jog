import { closeSync, ftruncateSync, mkdtempSync, openSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGE_WINDOW_BYTES } from '../src/server/agents/tree';
import { type World, PID, RUN, SA, SB, SC, SD, SE, WHOLE_FOLDER, MIXED_FOLDER, agentCall, agentFile, copyAgentFixtures, jsonl, loadAgents, nodeOf, sendMessage, sessionFile, sessionOf, setAge, writeAged } from './agents-helpers';
import { INSIDE, at, toolResult, userPrompt } from './sessions-helpers';

// What the agents module reads from disk. Like the tests of the sessions module (tests/sessions-reads.test.ts), this wraps `open`, `readdir` and `stat`
// of node:fs/promises, so it sees every byte that the module reads and every folder that it lists and every file that it looks at. They prove four
// promises: the module starts from the process list and never lists a folder of sessions; it opens no file of a session whose process is gone; it
// reads a bounded end of a file and a file again only when it changed; and it opens only files named `<digits>.json` in the folder of the process list.

const spy = vi.hoisted(() => ({
  opens: [] as { path: string; bytes: number }[],
  listed: [] as string[],
  looked: [] as string[],
  /** The flag of every call of `open`: the second argument, or undefined when there is none. */
  flags: [] as unknown[],
  /** Paths that cannot be opened: the error code that opening them gives (a locked file is EBUSY). */
  failures: new Map<string, string>(),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      spy.flags.push(args[1]);
      const failure = spy.failures.get(String(args[0]));
      if (failure !== undefined) throw Object.assign(new Error(`${failure}: a simulated failure`), { code: failure });
      const handle = await actual.open(...args);
      const entry = { path: String(args[0]), bytes: 0 };
      spy.opens.push(entry);
      const read = handle.read.bind(handle) as unknown as (...readArgs: unknown[]) => Promise<{ bytesRead: number }>;
      (handle as unknown as { read: unknown }).read = async (...readArgs: unknown[]) => {
        const result = await read(...readArgs);
        entry.bytes += result.bytesRead;
        return result;
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

const parent = mkdtempSync(join(tmpdir(), 'cc-agents-reads-'));
afterAll(() => rmSync(parent, { recursive: true, force: true }));

const forgetWhatWasSpiedOn = () => {
  spy.opens.length = 0;
  spy.flags.length = 0;
  spy.listed.length = 0;
  spy.looked.length = 0;
  spy.failures.clear();
};
beforeEach(forgetWhatWasSpiedOn);

const MEGABYTE = 1024 * 1024;

/** The paths that were opened, once each. */
const openedPaths = () => [...new Set(spy.opens.map((entry) => entry.path))];
/** How often a path was opened. */
const timesOpened = (path: string) => spy.opens.filter((entry) => entry.path === path).length;
/** Whether a path, or something below it, was opened, listed or looked at. */
const touched = (needle: string) => [...spy.opens.map((entry) => entry.path), ...spy.listed, ...spy.looked].some((path) => path.includes(needle));

describe('what is read', () => {
  it('a closed session is not read', async () => {
    // F has a session file and no process file at all: it ended long ago, and Claude Code removed its process file.
    const SF = 'ffffffff-0000-4000-8000-00000000000f';
    const prepared = copyAgentFixtures(parent);
    writeAged(sessionFile(prepared, WHOLE_FOLDER, SF), jsonl([userPrompt('LEAK-title-of-a-session-that-ended', { time: at(-7200), cwd: INSIDE }), toolResult('x', { time: at(-7100), cwd: INSIDE })]), 30);
    writeAged(agentFile(prepared, WHOLE_FOLDER, SF, 'ff01'), jsonl([userPrompt('LEAK-agent-of-a-session-that-ended', { time: at(-7150), cwd: INSIDE })]), 30);

    const { data, world } = await loadAgents({ world: prepared });
    // C's process is gone (its file is still in the process list), and F has no process. The module never lists, looks at or opens anything of those
    // sessions: not their files, not their folders.
    expect(data.sessions.map((session) => session.id)).toEqual([SB, SA]);
    expect(touched(SC)).toBe(false);
    expect(touched(SF)).toBe(false);
    expect(JSON.stringify(data)).not.toContain('LEAK-');
    expect(touched(`${PID.C}.json`)).toBe(true); // the process file itself is read: that is how the module learns that the process is gone
    // The sessions of the live processes were read (D and E too: their files say that one is a script's and the other works elsewhere).
    for (const [folder, id] of [[WHOLE_FOLDER, SA], [MIXED_FOLDER, SB], [WHOLE_FOLDER, SD], [MIXED_FOLDER, SE]] as const) {
      expect(openedPaths(), id).toContain(sessionFile(world, folder, id));
    }
  });

  it('the module starts from the process list: it lists no folder of sessions and no session of a hidden script, and opens no file that is not named <digits>.json in the process folder', async () => {
    const { world } = await loadAgents({ parent });
    // The folders of sessions are never listed (only the folders of the live sessions, below them): there is no scan of all session files.
    expect(spy.listed).not.toContain(join(world.projects, WHOLE_FOLDER));
    expect(spy.listed).not.toContain(join(world.projects, MIXED_FOLDER));
    // A script's session costs the read of its own file and nothing more: its agents are not listed. Neither is the folder of a session that works elsewhere.
    expect(touched(join(SD, 'subagents'))).toBe(false);
    expect(touched(join(SE, 'subagents'))).toBe(false);
    // The process folder: listed, and of the files in it only `<digits>.json` was opened. The key file (it holds a token) never was.
    expect(spy.listed).toContain(world.sessions);
    const inProcessFolder = openedPaths().filter((path) => dirname(path) === world.sessions);
    expect(inProcessFolder.length).toBeGreaterThan(0);
    for (const path of inProcessFolder) expect(path).toMatch(/[\\/]\d+\.json$/);
    expect(touched('.key')).toBe(false);
  });

  it('a file that did not change is not read again, and one that changed is', async () => {
    const { source, world } = await loadAgents({ parent });
    const files = {
      session: sessionFile(world, WHOLE_FOLDER, SA),
      aa01: agentFile(world, WHOLE_FOLDER, SA, 'aa01'),
      aa04: agentFile(world, WHOLE_FOLDER, SA, 'aa04'),
      journal: join(world.projects, WHOLE_FOLDER, SA, 'subagents', 'workflows', RUN, 'journal.jsonl'),
    };
    expect(timesOpened(files.session)).toBeGreaterThan(0);
    forgetWhatWasSpiedOn();

    // Nothing changed: the process files are read again (that is how a change of status is seen) and no session, agent or journal file is.
    await source.get(true);
    expect(openedPaths().filter((path) => path.endsWith('.jsonl') || path.endsWith('.meta.json') || path.endsWith('custom-title.json'))).toEqual([]);

    // One agent file is written to. Only that file is read again (its end, its start, and its calls and messages): nothing else changed.
    writeAged(files.aa04, jsonl([userPrompt('LEAK-aa04-prompt', { time: at(-600), cwd: INSIDE }), toolResult('x', { time: at(-5), cwd: INSIDE }), toolResult('y', { time: at(-4), cwd: INSIDE })]), 4);
    forgetWhatWasSpiedOn();
    await source.get(true);
    expect(openedPaths().filter((path) => path.endsWith('.jsonl'))).toEqual([files.aa04]);
    expect(timesOpened(files.aa04)).toBe(3); // its end, its start, and its calls and messages
    expect(timesOpened(files.aa01)).toBe(0);
    expect(timesOpened(files.session)).toBe(0);
    expect(timesOpened(files.journal)).toBe(0);
  });

  it('the files of a session are read at their end only: a session file of 300 MB costs one window', async () => {
    const world = copyAgentFixtures(parent);
    const file = sessionFile(world, WHOLE_FOLDER, SA);
    // A file of 300 MB with a few real lines at its start and at its end, and zero bytes in between. The file is made with a hole, which the file
    // system does not write out, so it takes no time and no disk. A reader that went through the middle would read zeros, and a lot of them.
    const head = jsonl([userPrompt('ALLOWED-first-prompt-of-session-a', { time: at(-3600), cwd: INSIDE }), agentCall('toolu_A01', { time: at(-3500), cwd: INSIDE }), sendMessage('aa01', 'toolu_old', { time: at(-3400), cwd: INSIDE })]);
    const tail = `\n${jsonl([sendMessage('aa01', 'toolu_new', { time: at(-100), cwd: INSIDE }), toolResult('x', { time: at(-60), cwd: INSIDE })])}`;
    const size = 300 * MEGABYTE;
    const fd = openSync(file, 'w');
    try {
      ftruncateSync(fd, size);
      writeSync(fd, head, 0, 'utf8');
      writeSync(fd, tail, size - Buffer.byteLength(tail));
    } finally {
      closeSync(fd);
    }
    setAge(file, 30);
    forgetWhatWasSpiedOn();

    const { data } = await loadAgents({ world });
    // The message window is 1 MiB; the facts read the first window of the end (64 KB, doubled until a line of the conversation is in it) and 16 KB of the start.
    // Everything the module read of this file is a small number of megabytes, and nothing like 300.
    const read = spy.opens.filter((entry) => entry.path === file).reduce((sum, entry) => sum + entry.bytes, 0);
    expect(read).toBeGreaterThan(0);
    expect(read).toBeLessThan(MESSAGE_WINDOW_BYTES + 256 * 1024);
    // What the window holds is counted: the call at the end of the file, and not the one at its start. The count says so.
    expect(nodeOf(sessionOf(data, SA), 'aa01').messages).toEqual({ count: 1, approximate: true });
  });

  it('the agent files are scanned only when a call is missing from the file of the session', async () => {
    // A world without the agents that are started by other agents or by nobody: every call is in the file of the session.
    const plain = copyAgentFixtures(parent);
    for (const id of ['aa03', 'aa04']) {
      rmSync(agentFile(plain, WHOLE_FOLDER, SA, id));
      rmSync(join(dirname(agentFile(plain, WHOLE_FOLDER, SA, id)), `agent-${id}.meta.json`));
    }
    forgetWhatWasSpiedOn();
    await loadAgents({ world: plain });
    const aa01 = agentFile(plain, WHOLE_FOLDER, SA, 'aa01');
    const aa02 = agentFile(plain, WHOLE_FOLDER, SA, 'aa02');
    // Each agent file was opened twice: for its end and for its start. Nothing else read it.
    expect(timesOpened(aa01)).toBe(2);
    expect(timesOpened(aa02)).toBe(2);

    // With the nested agent, the call of aa03 is not in the file of the session, so the files of the agents are scanned for it: one more read of each.
    const nested = copyAgentFixtures(parent);
    forgetWhatWasSpiedOn();
    await loadAgents({ world: nested });
    expect(timesOpened(agentFile(nested, WHOLE_FOLDER, SA, 'aa01'))).toBe(3);
  });
});

describe('what cannot be read', () => {
  it('an agent, a journal or a meta file that cannot be read does not take the session away: the module goes on without it, and says so once', async () => {
    const complaints = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const world = copyAgentFixtures(parent);
      const dir = join(world.projects, WHOLE_FOLDER, SA, 'subagents');
      spy.failures.set(join(dir, 'agent-aa01.jsonl'), 'EBUSY');
      spy.failures.set(join(dir, 'agent-aa02.meta.json'), 'EACCES');
      spy.failures.set(join(dir, 'workflows', RUN, 'journal.jsonl'), 'EBUSY');

      const { data, source } = await loadAgents({ world });
      const a = sessionOf(data, SA);
      // aa01 could not be read: it is not known to have ended, and its file is fresh, so it runs. It has no start from its file (the time the file was made is used).
      expect(nodeOf(a, 'aa01')).toMatchObject({ state: 'running', endedAt: null, label: 'ALLOWED-explore-the-engine' });
      // aa02 has no meta file that can be read: no description, no model.
      expect(nodeOf(a, 'aa02')).toMatchObject({ label: 'Agent aa02', model: null });
      // The journal cannot be read, so the run is not known to be done or to have started anything. It is still a node, with no progress to show.
      expect(nodeOf(a, RUN).progress).toEqual({ phase: null, done: 0, started: 0 });
      expect(data.sessions.map((session) => session.id)).toEqual([SB, SA]);

      // The console said so, once for each file, and not again at the next look.
      expect(complaints).toHaveBeenCalledTimes(3);
      await source.get(true);
      expect(complaints).toHaveBeenCalledTimes(3);
      const said = complaints.mock.calls.map((call) => String(call[0]));
      expect(said.some((line) => line.includes('agent-aa01.jsonl') && line.includes('EBUSY'))).toBe(true);
      expect(said.join('\n')).not.toContain('LEAK-');
    } finally {
      complaints.mockRestore();
    }
  });

  it('a session file that cannot be read leaves that session out of the look, and the others stay', async () => {
    const complaints = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const world = copyAgentFixtures(parent);
      spy.failures.set(sessionFile(world, WHOLE_FOLDER, SA), 'EBUSY');
      const { data } = await loadAgents({ world });
      expect(data.sessions.map((session) => session.id)).toEqual([SB]);
      expect(complaints).toHaveBeenCalledTimes(1);
    } finally {
      complaints.mockRestore();
    }
  });

  it('a process file that cannot be opened is skipped, and the other processes are still listed', async () => {
    const world = copyAgentFixtures(parent);
    spy.failures.set(join(world.sessions, `${PID.A}.json`), 'EBUSY');
    const { data } = await loadAgents({ world });
    expect(data.source).toBe('process-list');
    expect(data.sessions.map((session) => session.id)).toEqual([SB]);
  });

  it('a process folder that cannot be listed is the file-age fallback, and the console says so once', async () => {
    const complaints = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const world: World = copyAgentFixtures(parent);
      // A path with a character that no file system takes cannot be listed: not a missing folder, an unreadable one.
      const { data, source } = await loadAgents({ world, claude: { sessionsRoot: join(world.root, 'bad\0folder') } });
      expect(data.source).toBe('file-age');
      expect(complaints).toHaveBeenCalledTimes(1);
      expect(String(complaints.mock.calls[0]?.[0])).toContain('unreadable');
      await source.get(true);
      expect(complaints).toHaveBeenCalledTimes(1);
    } finally {
      complaints.mockRestore();
    }
  });

  it('every open is for reading: the module passes no flag, or r', async () => {
    await loadAgents({ parent });
    expect(spy.flags.length).toBeGreaterThan(0);
    for (const flag of spy.flags) expect([undefined, 'r']).toContain(flag);
  });
});
