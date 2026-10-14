import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentsLive, Panel, SessionInfo, SessionsInfo } from '../src/shared/types';
import { GIT_STATUS, type Runner, createRunner } from '../src/server/runner';
import { Secret } from '../src/server/publish/secret';
import { WORKTREE_REFRESH_MS, createReporterModule } from '../src/server/publish/module';
import { countDirty, parseWorktreeList, readWorktrees } from '../src/server/publish/worktrees';
import type { PanelSource } from '../src/server/source';
import { makeTestConfig } from './helpers';
import { TOKEN, fakeHttp, response } from './publish-helpers';

describe('git worktree list', () => {
  const LIST = [
    'worktree C:/work/shadow-jog',
    'HEAD 1111111111111111111111111111111111111111',
    'branch refs/heads/main',
    '',
    'worktree C:/work/shadow-jog-engine',
    'HEAD 2222222222222222222222222222222222222222',
    'branch refs/heads/engine-m6-flip',
    '',
    'worktree C:/work/detached',
    'HEAD 3333333333333333333333333333333333333333',
    'detached',
    '',
    'worktree C:/work/gone',
    'HEAD 4444444444444444444444444444444444444444',
    'branch refs/heads/old',
    'prunable gitdir file points to non-existent location',
    '',
  ].join('\n');

  it('reads the path and branch of each checkout, null for a detached HEAD, and leaves out a prunable one', () => {
    expect(parseWorktreeList(LIST)).toEqual([
      { path: 'C:/work/shadow-jog', branch: 'main' },
      { path: 'C:/work/shadow-jog-engine', branch: 'engine-m6-flip' },
      { path: 'C:/work/detached', branch: null },
    ]);
  });

  it('works with CRLF line ends', () => {
    expect(parseWorktreeList(LIST.replace(/\n/g, '\r\n'))).toHaveLength(3);
  });

  it('counts one dirty file for each status line', () => {
    expect(countDirty(' M a.ts\n?? b.ts\nR  c.ts -> d.ts\n')).toBe(3);
    expect(countDirty('')).toBe(0);
  });

  it('reads the dirty count of each checkout with the exact status read, and leaves out a checkout whose status fails', async () => {
    const calls: { args: string[]; cwd: string }[] = [];
    const skipped: string[] = [];
    const read = await readWorktrees(
      async (args, cwd) => {
        calls.push({ args, cwd });
        if (args[0] === 'worktree') return { code: 0, stdout: LIST, stderr: '' };
        if (cwd === 'C:/work/detached') return { code: 128, stdout: '', stderr: 'fatal' };
        return { code: 0, stdout: cwd === 'C:/work/shadow-jog' ? ' M a\n M b\n' : '', stderr: '' };
      },
      'C:/work/shadow-jog',
      (message) => skipped.push(message),
    );
    expect(read).toEqual({
      ok: true,
      worktrees: [
        { path: 'C:/work/shadow-jog', branch: 'main', dirty: 2 },
        { path: 'C:/work/shadow-jog-engine', branch: 'engine-m6-flip', dirty: 0 },
      ],
    });
    expect(skipped).toHaveLength(1);
    expect(calls.filter((call) => call.args[0] === 'status').every((call) => JSON.stringify(call.args) === JSON.stringify(GIT_STATUS))).toBe(true);
  });

  it('reports a failed list instead of an empty list', async () => {
    const read = await readWorktrees(async () => ({ code: 1, stdout: '', stderr: '' }), 'C:/x');
    expect(read.ok).toBe(false);
  });
});

// ---- the module, end to end with fake sources ----

const sessionsOf = (data: SessionsInfo): PanelSource<SessionsInfo> => ({ get: async (): Promise<Panel<SessionsInfo>> => ({ ok: true, data, updatedAt: 'now' }), start() {}, stop() {} });
const agentsOf = (data: AgentsLive): PanelSource<AgentsLive> => ({ get: async (): Promise<Panel<AgentsLive>> => ({ ok: true, data, updatedAt: 'now' }), start() {}, stop() {} });

describe('the reporter module', () => {
  it('writes the allow-listed state to the store: a session with message text and extra fields leaves nothing but the allowed fields', async () => {
    const config = makeTestConfig();
    const sessionInfo = { id: 's1', branch: 'reporter', cwd: 'C:\\Users\\markh\\home-base\\projects\\shadow-jog', title: 'ignored here', yourMove: { text: 'SECRET MESSAGE TEXT' }, lastMessage: 'SECRET MESSAGE TEXT' } as unknown as SessionInfo;
    const live = {
      sessions: [
        {
          id: 's1',
          title: 'Build the reporter',
          state: 'waiting',
          startedAt: '2026-10-12T08:00:00.000Z',
          filePath: 'C:\\Users\\markh\\.claude\\projects\\p\\s1.jsonl',
          nodes: [{ id: 'a', parentId: 's1', kind: 'agent', label: 'Check the diff', model: 'sonnet', state: 'running', startedAt: null, endedAt: null, filePath: null, messages: { count: 1, approximate: false }, text: 'SECRET MESSAGE TEXT' }],
          prompt: 'SECRET MESSAGE TEXT',
        },
      ],
      hiddenScripts: 0,
      source: 'process-list',
    } as unknown as AgentsLive;

    const stored: string[] = [];
    const net = fakeHttp(response(401));
    const store = fakeHttp(response(200, '{"result":"OK"}'));
    // One fake network for both calls: the first call is the protection check (GET), the others are store writes (POST).
    const http = async (url: string, request: Parameters<typeof net.http>[1]) => {
      if (request.method === 'GET') return net.http(url, request);
      stored.push(request.body as string);
      return store.http(url, request);
    };
    const logs: string[] = [];
    const module = createReporterModule(
      {
        settings: { upstashUrl: 'https://eu-1.upstash.io', token: new Secret(TOKEN), hostedUrl: 'https://cc.example.vercel.app' },
        onExit: () => {},
        http,
        now: () => Date.parse('2026-10-12T09:00:00.000Z'),
        log: (message) => logs.push(message),
        git: async (args) => (args[0] === 'worktree' ? { code: 0, stdout: 'worktree C:/work/shadow-jog\nHEAD aaa\nbranch refs/heads/reporter\n', stderr: '' } : { code: 0, stdout: ' M a\n', stderr: '' }),
      },
      { config, sessions: sessionsOf({ sessions: [sessionInfo], scanned: 1, skipped: 0, hiddenSdk: 0 }), agents: agentsOf(live) },
    );
    module.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    module.stop();

    expect(stored).toHaveLength(1);
    const command = JSON.parse(stored[0] as string) as string[];
    expect(command.slice(0, 2)).toEqual(['SET', 'live']);
    expect(command[0] === 'SET' && command.slice(3)).toEqual(['EX', '600']);
    const value = JSON.parse(command[2] as string);
    expect(value).toEqual({
      writtenAt: '2026-10-12T09:00:00.000Z',
      sessions: [{ id: 's1', title: 'Build the reporter', branch: 'reporter', folder: 'shadow-jog', state: 'waiting', startedAt: '2026-10-12T08:00:00.000Z', agents: { running: 1, done: 0, names: ['Check the diff'] }, yourMove: null }],
      worktrees: [{ path: 'shadow-jog', branch: 'reporter', dirty: 1 }],
    });
    expect(stored[0]).not.toContain('SECRET');
    expect(stored[0]).not.toContain('.claude');
    expect(stored[0]).not.toContain('markh');
    expect(stored[0]).not.toContain('C:/work'); // F1: the full path of a worktree never leaves
    expect(logs.join('\n')).not.toContain(TOKEN);
  });

  it('uses a runner that allows git status only in the exact shape, and a folder of a worktree that git itself listed', async () => {
    const config = makeTestConfig();
    const seen: string[][] = [];
    const runner = createRunner({ ...config, roots: [...config.roots, 'C:/elsewhere/worktree'] }, async (_cmd, args) => {
      seen.push(args);
      return { code: 0, stdout: '', stderr: '' };
    });
    await runner('git', [...GIT_STATUS], { cwd: 'C:/elsewhere/worktree' });
    expect(seen).toEqual([[...GIT_STATUS]]);
    await expect(runner('git', ['status'], { cwd: 'C:/elsewhere/worktree' })).rejects.toThrow();
    await expect(runner('git', [...GIT_STATUS], { cwd: 'C:/not/listed' })).rejects.toThrow();
  });
});

// ---- F2: a failing agents source, F9: one runner for each folder ----

describe('the reporter module: a failing source and the runners', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const okHttp = async (_url: string, request: { method: string }) => (request.method === 'GET' ? response(401) : response(200, '{"result":"OK"}'));
  const liveData = {
    sessions: [{ id: 's1', title: 'Old session', state: 'working', startedAt: '2026-10-12T08:00:00.000Z', filePath: 'x', nodes: [] }],
    hiddenScripts: 0,
    source: 'process-list',
  } as unknown as AgentsLive;
  const emptyLive = { sessions: [], hiddenScripts: 0, source: 'process-list' } as unknown as AgentsLive;
  const noSessions: SessionsInfo = { sessions: [], scanned: 0, skipped: 0, hiddenSdk: 0 };
  const settings = { upstashUrl: 'https://eu-1.upstash.io', token: new Secret(TOKEN), hostedUrl: 'https://cc.example.vercel.app' };
  const git = async (args: string[]) => (args[0] === 'worktree' ? { code: 0, stdout: 'worktree C:/work/shadow-jog\nHEAD aaa\nbranch refs/heads/main\n', stderr: '' } : { code: 0, stdout: '', stderr: '' });
  const setCommands = (posts: string[]) => posts.filter((body) => body.includes('"SET"'));

  it('F2: when the agents source fails, its last good sessions are NOT published as live, and the log says why', async () => {
    const failing: PanelSource<AgentsLive> = {
      get: async (): Promise<Panel<AgentsLive>> => ({ ok: false, error: { code: 'unreadable', message: 'EACCES' }, updatedAt: null, lastGood: { data: liveData, updatedAt: 'then' } }),
      start() {},
      stop() {},
    };
    const posts: string[] = [];
    const logs: string[] = [];
    const module = createReporterModule(
      {
        settings,
        onExit: () => {},
        http: async (url, request) => {
          if (request.method === 'POST') posts.push(request.body as string);
          return okHttp(url, request);
        },
        now: () => Date.parse('2026-10-12T09:00:00.000Z'),
        log: (message) => logs.push(message),
        git,
      },
      { config: makeTestConfig(), sessions: sessionsOf(noSessions), agents: failing },
    );
    module.start();
    await new Promise((resolve) => setTimeout(resolve, 60));
    await module.stop();
    expect(setCommands(posts)).toEqual([]);
    expect(posts.join('')).not.toContain('Old session');
    expect(logs.some((line) => line.includes('agents source does not work'))).toBe(true);
  });

  it('F2: fresh data after a failure is published again, and the log says so', async () => {
    vi.useFakeTimers();
    let failing = true;
    const agents: PanelSource<AgentsLive> = {
      get: async (): Promise<Panel<AgentsLive>> => (failing ? { ok: false, error: { code: 'unreadable', message: 'EACCES' }, updatedAt: null, lastGood: { data: liveData, updatedAt: 'then' } } : { ok: true, data: emptyLive, updatedAt: 'now' }),
      start() {},
      stop() {},
    };
    const posts: string[] = [];
    const logs: string[] = [];
    let clock = Date.parse('2026-10-12T09:00:00.000Z');
    const module = createReporterModule(
      {
        settings,
        onExit: () => {},
        http: async (url, request) => {
          if (request.method === 'POST') posts.push(request.body as string);
          return okHttp(url, request);
        },
        now: () => clock,
        log: (message) => logs.push(message),
        git,
      },
      { config: makeTestConfig(), sessions: sessionsOf(noSessions), agents },
    );
    module.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(setCommands(posts)).toEqual([]);
    failing = false;
    clock += 6000;
    await vi.advanceTimersByTimeAsync(1100);
    expect(setCommands(posts)).toHaveLength(1);
    expect(logs.some((line) => line.includes('agents source works again'))).toBe(true);
    await module.stop();
  });

  it('F9: one runner is made for each folder, however many times the worktrees are read', async () => {
    vi.useFakeTimers();
    const config = makeTestConfig();
    const made: string[][] = [];
    const calls: { cwd: string; args: string[] }[] = [];
    const listing = 'worktree C:/work/a\nHEAD aaa\nbranch refs/heads/a\n\nworktree C:/work/b\nHEAD bbb\nbranch refs/heads/b\n';
    let clock = Date.parse('2026-10-12T09:00:00.000Z');
    const module = createReporterModule(
      {
        settings,
        onExit: () => {},
        http: okHttp,
        now: () => clock,
        log: () => {},
        makeRunner: (forConfig): Runner => {
          made.push(forConfig.roots);
          return async (_cmd, args, options) => {
            calls.push({ cwd: options?.cwd ?? '', args });
            return { code: 0, stdout: args[0] === 'worktree' ? listing : '', stderr: '' };
          };
        },
      },
      { config, sessions: sessionsOf(noSessions), agents: agentsOf(emptyLive) },
    );
    module.start();
    for (let round = 0; round < 4; round++) {
      clock += WORKTREE_REFRESH_MS + 1000; // past the refresh time, so the worktrees are read again
      await vi.advanceTimersByTimeAsync(1000);
    }
    await module.stop();
    const lists = calls.filter((call) => call.args[0] === 'worktree').length;
    const statuses = calls.filter((call) => call.args[0] === 'status').length;
    expect(lists).toBeGreaterThanOrEqual(3); // the worktrees were read several times
    expect(statuses).toBeGreaterThanOrEqual(6);
    // ...and still only one runner for the repo root and one for each of the two worktrees.
    expect(made).toHaveLength(3);
    expect(made.map((roots) => roots.at(-1)).sort()).toEqual([config.repoRoot, 'C:/work/a', 'C:/work/b'].sort());
  });

  it('F9: each runner keeps its allow-list: the roots of the config plus the one folder', async () => {
    const config = makeTestConfig();
    const seen: string[][] = [];
    const module = createReporterModule(
      {
        settings,
        onExit: () => {},
        http: okHttp,
        now: () => Date.parse('2026-10-12T09:00:00.000Z'),
        log: () => {},
        makeRunner: (forConfig): Runner => {
          seen.push(forConfig.roots);
          return async () => ({ code: 0, stdout: '', stderr: '' });
        },
      },
      { config, sessions: sessionsOf(noSessions), agents: agentsOf(emptyLive) },
    );
    module.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await module.stop();
    expect(seen.length).toBeGreaterThan(0);
    for (const roots of seen) expect(roots.slice(0, -1)).toEqual(config.roots);
  });
});

// ---- the live ask, end to end through the module ----

describe('the reporter module: the live ask', () => {
  const NOW = '2026-10-12T09:00:00.000Z';
  const settings = { upstashUrl: 'https://eu-1.upstash.io', token: new Secret(TOKEN), hostedUrl: 'https://cc.example.vercel.app' };
  const git = async (args: string[]) => (args[0] === 'worktree' ? { code: 0, stdout: 'worktree C:/work/shadow-jog\nHEAD aaa\nbranch refs/heads/main\n', stderr: '' } : { code: 0, stdout: '', stderr: '' });
  const live = { sessions: [{ id: 's1', title: 'Build it', state: 'waiting', startedAt: '2026-10-12T08:00:00.000Z', filePath: 'x', nodes: [] }], hiddenScripts: 0, source: 'process-list' } as unknown as AgentsLive;
  const info = (yourMove: object): SessionsInfo =>
    ({ sessions: [{ id: 's1', branch: 'main', cwd: 'C:\\x\\shadow-jog', title: 'ignored', yourMove }], scanned: 1, skipped: 0, hiddenSdk: 0 }) as unknown as SessionsInfo;
  const box = (extra: object = {}) => ({ light: 'yellow', items: ['Look at the picture'], nothing: false, at: '2026-10-12T08:30:00.000Z', answered: false, ...extra });

  /** Runs the module once and returns the `sessions[0].yourMove` of the value that it stored. */
  async function askStored(sessions: PanelSource<SessionsInfo>): Promise<unknown> {
    const stored: string[] = [];
    const module = createReporterModule(
      {
        settings,
        onExit: () => {},
        http: async (_url, request) => {
          if (request.method === 'POST') stored.push(request.body as string);
          return request.method === 'GET' ? response(401) : response(200, '{"result":"OK"}');
        },
        now: () => Date.parse(NOW),
        log: () => {},
        git,
      },
      { config: makeTestConfig(), sessions, agents: agentsOf(live) },
    );
    module.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    module.stop();
    const command = JSON.parse(stored[0] as string) as string[];
    return (JSON.parse(command[2] as string) as { sessions: { yourMove: unknown }[] }).sessions[0]?.yourMove;
  }

  it('sends the lines of a box that waits for Mark', async () => {
    expect(await askStored(sessionsOf(info(box())))).toEqual({ at: '2026-10-12T08:30:00.000Z', lines: ['Look at the picture'] });
  });

  it('sends none for a box that Mark answered, that says nothing, or that is more than 12 hours old', async () => {
    expect(await askStored(sessionsOf(info(box({ answered: true }))))).toBeNull();
    expect(await askStored(sessionsOf(info(box({ nothing: true, items: [] }))))).toBeNull();
    expect(await askStored(sessionsOf(info(box({ at: '2026-10-11T20:00:00.000Z' }))))).toBeNull();
  });

  it('sends none when the sessions read failed, even if its last good data had a box: whether Mark answered is a fact of now', async () => {
    const failing: PanelSource<SessionsInfo> = {
      get: async (): Promise<Panel<SessionsInfo>> => ({ ok: false, error: { code: 'x', message: 'x' }, updatedAt: null, lastGood: { data: info(box()), updatedAt: 'then' } }),
      start() {},
      stop() {},
    };
    expect(await askStored(failing)).toBeNull();
  });
});
