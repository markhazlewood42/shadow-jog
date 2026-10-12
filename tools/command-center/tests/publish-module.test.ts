import { describe, expect, it } from 'vitest';
import type { AgentsLive, Panel, SessionInfo, SessionsInfo } from '../src/shared/types';
import { GIT_STATUS, createRunner } from '../src/server/runner';
import { Secret } from '../src/server/publish/secret';
import { createReporterModule } from '../src/server/publish/module';
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
      sessions: [{ id: 's1', title: 'Build the reporter', branch: 'reporter', folder: 'shadow-jog', state: 'waiting', startedAt: '2026-10-12T08:00:00.000Z', agents: { running: 1, done: 0, names: ['Check the diff'] } }],
      worktrees: [{ path: 'C:/work/shadow-jog', branch: 'reporter', dirty: 1 }],
    });
    expect(stored[0]).not.toContain('SECRET');
    expect(stored[0]).not.toContain('.claude');
    expect(stored[0]).not.toContain('markh');
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
