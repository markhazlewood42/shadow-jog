import { describe, expect, it } from 'vitest';
import { parseLive } from '../src/shared/live';
import type { LiveSession, SessionInfo } from '../src/shared/types';
import { LIMITS, buildLiveBody, folderName, mapWorktree } from '../src/server/publish/map';

// The allow-list mapper: only the named fields leave, in the shape of the contract (src/shared/live.ts).

const SECRETS = ['SECRET PROMPT TEXT', 'SECRET RESULT', 'C:\\Users\\markh\\private-folder', 'SECRET-FILE-BODY', 'ghp_SECRETTOKEN'];

/** A session as the sources really make it, with extra fields that a careless copy would carry along. */
function liveSession(): LiveSession {
  return {
    id: 'sess-1',
    title: 'Build the reporter',
    state: 'working',
    startedAt: '2026-10-12T08:00:00.000Z',
    filePath: 'C:\\Users\\markh\\.claude\\projects\\SECRET-FILE-BODY\\sess-1.jsonl',
    nodes: [
      { id: 'a1', parentId: 'sess-1', kind: 'agent', label: 'Check the diff', model: 'sonnet', state: 'running', startedAt: null, endedAt: null, filePath: 'C:\\x\\agent-a1.jsonl', messages: { count: 2, approximate: false }, lastMessage: 'SECRET RESULT' } as never,
      { id: 'a2', parentId: 'sess-1', kind: 'agent', label: 'Read the docs', model: null, state: 'done', startedAt: null, endedAt: '2026-10-12T08:05:00.000Z', filePath: null, messages: { count: 0, approximate: false } },
    ],
    // Fields no source makes today, but a later change could add:
    prompt: 'SECRET PROMPT TEXT',
    lastReply: 'SECRET RESULT',
    token: 'ghp_SECRETTOKEN',
  } as LiveSession;
}

function info(): Pick<SessionInfo, 'id' | 'branch' | 'cwd'> {
  return { id: 'sess-1', branch: 'reporter', cwd: 'C:\\Users\\markh\\home-base\\projects\\shadow-jog', yourMove: { text: 'SECRET PROMPT TEXT' }, prs: [], title: 'SECRET PROMPT TEXT', lastMessage: 'SECRET RESULT' } as never;
}

describe('the allow-list mapper', () => {
  it('lets through the allowed fields and nothing else, however many extra fields a session carries', () => {
    const out = buildLiveBody({
      sessions: [liveSession()],
      facts: [info()],
      worktrees: [{ path: 'C:/Users/markh/home-base/projects/shadow-jog', branch: 'reporter', dirty: 3, ...({ fileBody: 'SECRET-FILE-BODY' } as object) }],
    });
    expect(Object.keys(out.sessions[0] as object).sort()).toEqual(['agents', 'branch', 'folder', 'id', 'startedAt', 'state', 'title']);
    expect(Object.keys((out.sessions[0] as { agents: object }).agents).sort()).toEqual(['done', 'names', 'running']);
    expect(Object.keys(out.worktrees[0] as object).sort()).toEqual(['branch', 'dirty', 'path']);
    const text = JSON.stringify(out);
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    expect(out.sessions[0]).toEqual({
      id: 'sess-1',
      title: 'Build the reporter',
      branch: 'reporter',
      folder: 'shadow-jog',
      state: 'working',
      startedAt: '2026-10-12T08:00:00.000Z',
      agents: { running: 1, done: 1, names: ['Check the diff', 'Read the docs'] },
    });
  });

  it('gives the NAME of the working folder, never its path, for either kind of slash', () => {
    expect(folderName('C:\\Users\\markh\\home-base\\projects\\shadow-jog')).toBe('shadow-jog');
    expect(folderName('/home/mark/shadow-jog/')).toBe('shadow-jog');
    expect(folderName(null)).toBe('');
    expect(folderName('')).toBe('');
  });

  it('uses empty branch and folder when the sessions module has not seen the session yet', () => {
    const out = buildLiveBody({ sessions: [liveSession()], facts: [], worktrees: [] });
    expect(out.sessions[0]).toMatchObject({ branch: '', folder: '' });
  });

  it('puts running agents first in the name list and keeps the list short', () => {
    const many = liveSession();
    many.nodes = Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, parentId: 'sess-1', kind: 'agent', label: `agent ${i}`, model: null, state: i === 39 ? 'running' : 'done', startedAt: null, endedAt: null, filePath: null, messages: { count: 0, approximate: false } }) as never);
    const out = buildLiveBody({ sessions: [many], facts: [], worktrees: [] });
    const agents = (out.sessions[0] as { agents: { running: number; done: number; names: string[] } }).agents;
    expect(agents.names[0]).toBe('agent 39');
    expect(agents.names).toHaveLength(LIMITS.agentNames);
    expect(agents).toMatchObject({ running: 1, done: 39 });
  });

  it('cuts long text from a transcript, and the number of rows', () => {
    const long = liveSession();
    long.title = 'x'.repeat(5000);
    const out = buildLiveBody({ sessions: Array.from({ length: 80 }, (_, i) => ({ ...long, id: `s${i}` })), facts: [], worktrees: [] });
    expect(out.sessions).toHaveLength(LIMITS.sessions);
    expect((out.sessions[0] as { title: string }).title.length).toBe(LIMITS.title);
  });

  it('maps a worktree with a detached HEAD to branch null and keeps the dirty count a whole number', () => {
    expect(mapWorktree({ path: 'C:/w', branch: null, dirty: 2.7 })).toEqual({ path: 'C:/w', branch: null, dirty: 2 });
  });

  it('gives a value that parseLive accepts', () => {
    const body = buildLiveBody({ sessions: [liveSession()], facts: [info()], worktrees: [{ path: 'C:/w', branch: 'main', dirty: 0 }] });
    expect(parseLive({ writtenAt: new Date().toISOString(), ...body }).ok).toBe(true);
  });
});
