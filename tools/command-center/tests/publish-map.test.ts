import { describe, expect, it } from 'vitest';
import { parseLive } from '../src/shared/live';
import type { LiveSession, SessionInfo } from '../src/shared/types';
import { LIMITS, REDACTED, buildLiveBody, folderName, mapWorktree, redact } from '../src/server/publish/map';

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

describe('redaction of secret-shaped text in titles', () => {
  const titleOf = (title: string) => {
    const session = liveSession();
    session.title = title;
    return (buildLiveBody({ sessions: [session], facts: [], worktrees: [] }).sessions[0] as { title: string }).title;
  };

  it.each([
    ['a GitHub token', 'fix ghp_abcdefghijklmnopqrstuvwxyz0123456789 now', 'ghp_'],
    ['a GitHub OAuth token', 'use gho_16C7e42F292c6912E7710c838347Ae178B4a here', 'gho_16C7'],
    ['a fine-grained GitHub token', 'token github_pat_11ABCDEFG0abcdefghij_klmnopqrstuvwxyz here', 'github_pat_11'],
    ['an sk- key', 'my key sk-proj-AbCdEfGhIjKlMnOp is pasted', 'sk-proj'],
    ['an Anthropic key', 'sk-ant-api03-AbCdEfGhIjKlMnOpQrSt', 'sk-ant'],
    ['a Supabase secret key', 'use sb_secret_AbCdEfGh123456 please', 'sb_secret_'],
    ['a Supabase publishable key', 'and sb_publishable_AbCdEfGh123456 too', 'sb_publishable_'],
    ['a bearer token', 'curl -H "Authorization: Bearer abcDEF123456xyz" url', 'abcDEF123456xyz'],
    ['an AWS access key id', 'AWS id AKIAIOSFODNN7EXAMPLE here', 'AKIAIOSFODNN7EXAMPLE'],
    ['a Slack bot token', 'slack xoxb-1234567890-abcdefghij', 'xoxb-1234567890'],
    ['a Slack user token', 'slack xoxp-1234567890-abcdefghij', 'xoxp-1234567890'],
    ['a JWT', 'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefSIGNATURE in a title', 'eyJhbGci'],
    ['a KEY= assignment', 'run with API_KEY=hunter2hunter2 now', 'hunter2'],
    ['a TOKEN= assignment', 'GITHUB_TOKEN=abc123 npm publish', 'abc123'],
    ['a SECRET= assignment', 'CLIENT_SECRET="my secret value" go', 'my secret value'],
    ['a PASSWORD= assignment', 'PASSWORD=short1 login', 'short1'],
    ['a long mixed run', 'the value Zm9vYmFyMTIzNDU2Nzg5MGFiY2RlZg== is odd', 'Zm9vYmFy'],
  ])('redacts %s', (_label, title, leaked) => {
    const out = titleOf(title);
    expect(out).toContain(REDACTED);
    expect(out).not.toContain(leaked);
  });

  it('keeps the rest of the title around the redacted part', () => {
    expect(titleOf('fix ghp_abcdefghijklmnopqrstuvwxyz0123456789 now')).toBe(`fix ${REDACTED} now`);
  });

  it.each(['Build the reporter', 'Command Center step 5: local reporter (PR #72)', 'fix tools/command-center/src/server/publish/map.ts', 'The 2026-10-12 review of the sk-learn pipeline', 'a-very-long-hyphenated-title-with-no-digits-in-it-at-all'])(
    'leaves a normal title unchanged: %s',
    (title) => {
      expect(titleOf(title)).toBe(title);
      expect(redact(title)).toBe(title);
    },
  );

  it('redacts before the 120-character cut, so the cut cannot leave the start of a token', () => {
    const out = titleOf(`${'a '.repeat(55)}ghp_abcdefghijklmnopqrstuvwxyz0123456789`);
    expect(out).not.toContain('ghp_');
    expect(out.length).toBeLessThanOrEqual(LIMITS.title);
  });

  it('redacts agent names too', () => {
    const session = liveSession();
    session.nodes = [{ id: 'n1', parentId: 'sess-1', kind: 'agent', label: 'check with ghp_abcdefghijklmnopqrstuvwxyz0123456789', model: null, state: 'running', startedAt: null, endedAt: null, filePath: null, messages: { count: 0, approximate: false } } as never];
    const out = buildLiveBody({ sessions: [session], facts: [], worktrees: [] });
    expect((out.sessions[0] as { agents: { names: string[] } }).agents.names[0]).toBe(`check with ${REDACTED}`);
  });
});
