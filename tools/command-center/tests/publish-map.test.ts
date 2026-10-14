import { describe, expect, it } from 'vitest';
import { parseLive } from '../src/shared/live';
import type { LiveSession, SessionInfo } from '../src/shared/types';
import { LIMITS, REDACTED, buildLiveBody, folderName, mapAsk, mapWorktree, redact } from '../src/server/publish/map';
import type { YourMoveBox } from '../src/shared/types';
import { ASK_MAX_AGE_MS } from '../src/shared/your-move';

// The allow-list mapper: only the named fields leave, in the shape of the contract (src/shared/live.ts).

const NOW_MS = Date.parse('2026-10-12T12:00:00.000Z');
const hoursAgo = (hours: number) => new Date(NOW_MS - hours * 3_600_000).toISOString();

/** The mapper with the clock of the tests. */
const build = (input: Omit<Parameters<typeof buildLiveBody>[0], 'nowMs'>) => buildLiveBody({ ...input, nowMs: NOW_MS });

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
    const out = build({
      sessions: [liveSession()],
      facts: [info()],
      worktrees: [{ path: 'C:/Users/markh/home-base/projects/shadow-jog', branch: 'reporter', dirty: 3, ...({ fileBody: 'SECRET-FILE-BODY' } as object) }],
    });
    expect(Object.keys(out.sessions[0] as object).sort()).toEqual(['agents', 'branch', 'folder', 'id', 'startedAt', 'state', 'title', 'yourMove']);
    expect(Object.keys((out.sessions[0] as { agents: object }).agents).sort()).toEqual(['done', 'items', 'names', 'running']);
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
      agents: {
        running: 1,
        done: 1,
        names: ['Check the diff', 'Read the docs'],
        items: [
          { label: 'Check the diff', state: 'running', model: 'sonnet', startedAt: null, endedAt: null },
          { label: 'Read the docs', state: 'done', model: null, startedAt: null, endedAt: '2026-10-12T08:05:00.000Z' },
        ],
      },
      // The box in the facts above is not a box (a careless copy would have carried its text): no ask leaves.
      yourMove: null,
    });
  });

  it('gives the NAME of the working folder, never its path, for either kind of slash', () => {
    expect(folderName('C:\\Users\\markh\\home-base\\projects\\shadow-jog')).toBe('shadow-jog');
    expect(folderName('/home/mark/shadow-jog/')).toBe('shadow-jog');
    expect(folderName(null)).toBe('');
    expect(folderName('')).toBe('');
  });

  it('uses empty branch and folder when the sessions module has not seen the session yet', () => {
    const out = build({ sessions: [liveSession()], facts: [], worktrees: [] });
    expect(out.sessions[0]).toMatchObject({ branch: '', folder: '' });
  });

  it('puts running agents first in the name list and keeps the list short', () => {
    const many = liveSession();
    many.nodes = Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, parentId: 'sess-1', kind: 'agent', label: `agent ${i}`, model: null, state: i === 39 ? 'running' : 'done', startedAt: null, endedAt: null, filePath: null, messages: { count: 0, approximate: false } }) as never);
    const out = build({ sessions: [many], facts: [], worktrees: [] });
    const agents = (out.sessions[0] as { agents: { running: number; done: number; names: string[] } }).agents;
    expect(agents.names[0]).toBe('agent 39');
    expect(agents.names).toHaveLength(LIMITS.agentNames);
    expect(agents).toMatchObject({ running: 1, done: 39 });
  });

  describe('agent items (approved by Mark 2026-10-14)', () => {
    const node = (i: number, extra: Record<string, unknown> = {}) =>
      ({ id: `n${i}`, parentId: 'sess-1', kind: 'agent', label: `agent ${i}`, model: null, state: 'done', startedAt: null, endedAt: null, filePath: `C:\\x\\agent-${i}.jsonl`, messages: { count: 3, approximate: false }, ...extra }) as never;
    const itemsOf = (nodes: unknown[]) => {
      const session = liveSession();
      session.nodes = nodes as never;
      return build({ sessions: [session], facts: [], worktrees: [] }).sessions[0]?.agents.items;
    };

    it('keeps the running agents first when it must cut at the cap, and keeps the order of the session', () => {
      const nodes = Array.from({ length: 40 }, (_, i) => node(i, { state: i >= 38 ? 'running' : 'done' }));
      const items = itemsOf(nodes);
      expect(items).toHaveLength(LIMITS.agentNames);
      // The two running agents are kept (they come last in the session), with the first 18 done ones, in the order of the session.
      expect(items?.map((item) => item.label)).toEqual([...Array.from({ length: 18 }, (_, i) => `agent ${i}`), 'agent 38', 'agent 39']);
      expect(items?.slice(-2).map((item) => item.state)).toEqual(['running', 'running']);
    });

    it('does not move an item when an agent ends (twins are counted in this order on the page)', () => {
      const twin = (state: string) => node(1, { label: 'same', startedAt: '2026-10-14T08:00:00.000Z', state, endedAt: state === 'done' ? '2026-10-14T08:05:00.000Z' : null });
      const before = itemsOf([twin('running'), twin('running'), node(2, { state: 'running' })]);
      const afterFirstEnds = itemsOf([twin('done'), twin('running'), node(2, { state: 'running' })]);
      expect(before?.map((item) => item.label)).toEqual(['same', 'same', 'agent 2']);
      expect(afterFirstEnds?.map((item) => [item.label, item.state])).toEqual([
        ['same', 'done'],
        ['same', 'running'],
        ['agent 2', 'running'],
      ]);
    });

    it('redacts and cuts the label, and sends the model only as one of the four families (else null)', () => {
      const items = itemsOf([
        node(1, { label: 'check with ghp_abcdefghijklmnopqrstuvwxyz0123456789 now' }),
        node(2, { label: 'long '.repeat(60), model: 'a-very-long-model-name' }),
        node(3, { model: 'fable' }),
      ]);
      expect(items?.[0]?.label).toBe(`check with ${REDACTED} now`);
      expect(items?.[1]?.label.length).toBe(LIMITS.agentName);
      expect(items?.[1]?.model).toBeNull();
      expect(items?.[2]?.model).toBe('fable');
      expect(items?.[0]?.model).toBeNull();
    });

    it('gives null for a model that is not a family, so no prefix of a key, a path or an address leaves (the old cut to 12 characters let them through)', () => {
      const leaks = ['sk-abcdefghijklmnopqrstuvwxyz', 'C:\\Users\\markh\\secret', 'markh@gmail.com', 'Fable', 'claude-fable-5', ''];
      const items = itemsOf(leaks.map((model, i) => node(i, { model })));
      expect(items?.map((item) => item.model)).toEqual(leaks.map(() => null));
      expect(JSON.stringify(items)).not.toMatch(/sk-abcdefghi|C:\\Users|markh@/);
    });

    it('passes each of the four families', () => {
      const items = itemsOf(['opus', 'sonnet', 'haiku', 'fable'].map((model, i) => node(i, { model })));
      expect(items?.map((item) => item.model)).toEqual(['opus', 'sonnet', 'haiku', 'fable']);
    });

    it('sends only the five named keys: no path, no message count, no id, no extra field', () => {
      const items = itemsOf([node(1, { state: 'running', model: 'sonnet', startedAt: '2026-10-12T08:00:00.000Z', lastMessage: 'SECRET RESULT', prompt: 'SECRET PROMPT TEXT' })]);
      expect(Object.keys(items?.[0] as object).sort()).toEqual(['endedAt', 'label', 'model', 'startedAt', 'state']);
      const text = JSON.stringify(items);
      for (const secret of SECRETS) expect(text).not.toContain(secret);
      expect(text).not.toContain('agent-1.jsonl');
    });

    it('leaves a workflow out of the items (it stays in the counts and the names) and turns a bad time into null', () => {
      const body = build({
        sessions: [{ ...liveSession(), nodes: [node(1, { kind: 'workflow', label: 'My flow', state: 'running' }), node(2, { startedAt: 'not a time', endedAt: '2026-10-12T08:05:00.000Z' })] } as never],
        facts: [],
        worktrees: [],
      });
      const agents = body.sessions[0]?.agents;
      expect(agents).toMatchObject({ running: 1, done: 1, names: ['My flow', 'agent 2'] });
      expect(agents?.items).toEqual([{ label: 'agent 2', state: 'done', model: null, startedAt: null, endedAt: '2026-10-12T08:05:00.000Z' }]);
      expect(parseLive({ writtenAt: '2026-10-12T12:00:00.000Z', sessions: body.sessions, worktrees: [] }).ok).toBe(true);
    });
  });

  it('cuts long text from a transcript, and the number of rows', () => {
    const long = liveSession();
    long.title = 'ab '.repeat(2000);
    const out = build({ sessions: Array.from({ length: 80 }, (_, i) => ({ ...long, id: `s${i}` })), facts: [], worktrees: [] });
    expect(out.sessions).toHaveLength(LIMITS.sessions);
    expect((out.sessions[0] as { title: string }).title.length).toBe(LIMITS.title);
  });

  it('maps a worktree with a detached HEAD to branch null and keeps the dirty count a whole number', () => {
    expect(mapWorktree({ path: 'C:/w', branch: null, dirty: 2.7 })).toEqual({ path: 'w', branch: null, dirty: 2 });
  });

  it('F1: a worktree leaves as the NAME of its last folder, never the full path, for either kind of slash', () => {
    expect(mapWorktree({ path: 'C:/Users/markh/home-base/projects/shadow-jog-engine', branch: 'engine', dirty: 0 }).path).toBe('shadow-jog-engine');
    expect(mapWorktree({ path: 'C:\\Users\\markh\\home-base\\projects\\shadow-jog\\', branch: 'main', dirty: 0 }).path).toBe('shadow-jog');
    const out = build({ sessions: [], facts: [], worktrees: [{ path: '/home/mark/secret-layout/shadow-jog', branch: 'main', dirty: 1 }] });
    expect(JSON.stringify(out)).not.toMatch(/markh|home\/mark|secret-layout|Users/);
  });

  it('F1: the path stays non-empty (the contract wants it) when the path has no folder name', () => {
    expect(mapWorktree({ path: 'C:/', branch: null, dirty: 0 }).path).not.toBe('');
    expect(parseLive({ writtenAt: new Date().toISOString(), sessions: [], worktrees: [mapWorktree({ path: '/', branch: null, dirty: 0 })] }).ok).toBe(true);
  });

  it('F1: the branch of a worktree is redacted, and a normal long kebab-case branch still joins by name', () => {
    expect(mapWorktree({ path: 'C:/w', branch: 'fix-ghp_abcdefghijklmnopqrstuvwxyz0123456789', dirty: 0 }).branch).not.toContain('ghp_');
    expect(mapWorktree({ path: 'C:/w', branch: 'API_KEY=hunter2hunter2', dirty: 0 }).branch).toBe(REDACTED);
    // The same name must come out for a session and for its worktree, or the hosted page cannot join them. 36 characters with a digit, and it passes.
    const branch = 'command-center-step-5-local-reporter';
    expect(mapWorktree({ path: 'C:/w', branch, dirty: 0 }).branch).toBe(branch);
    const session = build({ sessions: [liveSession()], facts: [{ ...info(), branch }], worktrees: [] }).sessions[0];
    expect(session?.branch).toBe(branch);
    // A random key as a branch name is redacted.
    expect(mapWorktree({ path: 'C:/w', branch: 'Zm9vYmFyMTIzNDU2Nzg5MGFiY2RlZg', dirty: 0 }).branch).toBe(REDACTED);
  });

  it('gives a value that parseLive accepts', () => {
    const body = build({ sessions: [liveSession()], facts: [info()], worktrees: [{ path: 'C:/w', branch: 'main', dirty: 0 }] });
    expect(parseLive({ writtenAt: new Date().toISOString(), ...body }).ok).toBe(true);
  });
});

describe('redaction of secret-shaped text in titles', () => {
  const titleOf = (title: string) => {
    const session = liveSession();
    session.title = title;
    return (build({ sessions: [session], facts: [], worktrees: [] }).sessions[0] as { title: string }).title;
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

  // F3: forms that the first rules missed.
  it.each([
    ['a password with a colon', 'password: hunter2', 'hunter2'],
    ['a password with a colon, in a sentence', 'login failed, Password: Sup3rS3cret! try again', 'Sup3rS3cret'],
    ['passwd with equals', 'passwd = letmein99', 'letmein99'],
    ['pwd with a colon', 'pwd: opensesame', 'opensesame'],
    ['a secret with a colon', 'secret: abcdefgh', 'abcdefgh'],
    ['a token with a colon', 'token: ghijklmnop', 'ghijklmnop'],
    ['an api key with a space', 'api key: ZZZZZZZZ', 'ZZZZZZZZ'],
    ['an apikey', 'apikey=yyyyyyyy', 'yyyyyyyy'],
    ['"my token is <value>"', 'my token is abcdefghijklmnop', 'abcdefghijklmnop'],
    ['"the password was <value>"', 'the password was correcthorsebattery', 'correcthorse'],
    ['a URL with credentials', 'connect postgres://user:pass@host/db now', 'user:pass'],
    ['an https URL with credentials', 'clone https://mark:s3cr3t@github.com/x/y', 's3cr3t'],
    ['40 letters', 'key abcdefghijklmnopqrstuvwxyzabcdefghijklmn here', 'abcdefghijklmnopqrstuvwxyzabcdefghijklmn'],
    ['40 digits', 'pin 1234567890123456789012345678901234567890 end', '1234567890123456789012345678901234567890'],
    ['32 letters exactly', 'id qwertyuiopasdfghjklzxcvbnmqwerty id', 'qwertyuiopasdfghjklzxcvbnmqwerty'],
    ['a 40-character git hash', 'revert 0123456789abcdef0123456789abcdef01234567 please', '0123456789abcdef0123456789abcdef01234567'],
    ['a base64 key with slashes', 'use aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE3fG5hI7j/kL== ok', 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE3fG5hI7j'],
  ])('F3: redacts %s', (_label, title, leaked) => {
    const out = titleOf(title);
    expect(out).toContain(REDACTED);
    expect(out).not.toContain(leaked);
  });

  it.each([
    'Fix the password reset email',
    'The token refresh is slow',
    'Why does the secret menu open',
    'revert commit abc123def456 (a 12-character hash)',
    'a 31 character run: qwertyuiopasdfghjklzxcvbnmqwert',
    'fix tools/command-center/src/server/publish/map.ts and docs/command-center/design.md',
    'open C:\\Users\\markh\\home-base\\projects\\shadow-jog\\src\\engine\\game.ts',
    'visit https://github.com/markhazlewood42/shadow-jog/pull/72 today',
    'Command Center step 5: local reporter (PR #72)',
  ])('F3: leaves an ordinary title unchanged: %s', (title) => {
    expect(titleOf(title)).toBe(title);
  });

  it('keeps the rest of the title around the redacted part', () => {
    expect(titleOf('fix ghp_abcdefghijklmnopqrstuvwxyz0123456789 now')).toBe(`fix ${REDACTED} now`);
  });

  it.each(['Build the reporter', 'Command Center step 5: local reporter (PR #72)', 'fix tools/command-center/src/server/publish/map.ts', 'The 2026-10-12 review of the sk-learn pipeline', 'a-hyphenated-title-no-digits'])(
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
    const out = build({ sessions: [session], facts: [], worktrees: [] });
    expect((out.sessions[0] as { agents: { names: string[] } }).agents.names[0]).toBe(`check with ${REDACTED}`);
  });
});

// ---- the live ask (your-move-redesign.md section 4, approved by Mark 2026-10-13) ----
// The one place where a few words of a message leave the machine. Per live session: at most 6 lines of the newest "Your move" box, each redacted like a title and cut
// to 160 characters, and only when the box passes the four rules. Nothing else of any message.

function box(extra: Partial<YourMoveBox> = {}): YourMoveBox {
  return { light: 'yellow', items: ['Review the diff'], nothing: false, at: hoursAgo(0.5), answered: false, ...extra };
}

/** The ask that one session sends, for a box. */
function askOfBox(yourMove: YourMoveBox | null) {
  return build({ sessions: [liveSession()], facts: [{ ...info(), yourMove }], worktrees: [] }).sessions[0]?.yourMove;
}

describe('the live ask in the allow-list mapper', () => {
  it('sends the lines of a box that passes the four rules, with the time of the box and nothing else of it', () => {
    const out = askOfBox(box({ light: 'red', items: ['Review the diff', 'Tell me to commit'] }));
    // The light is not sent. Only `at` and `lines`.
    expect(out).toEqual({ at: hoursAgo(0.5), lines: ['Review the diff', 'Tell me to commit'] });
    expect(Object.keys(out as object).sort()).toEqual(['at', 'lines']);
  });

  it('sends at most 6 lines', () => {
    const out = askOfBox(box({ items: Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`) }));
    expect(out?.lines).toEqual(['Line 1', 'Line 2', 'Line 3', 'Line 4', 'Line 5', 'Line 6']);
  });

  it('cuts each line to 160 characters', () => {
    // Words, not one long run: a run of 24 or more letters would be redacted as a key. The lines are 500, 160 and 161 characters, and none ends in a space.
    const words = 'ab '.repeat(200);
    const out = askOfBox(box({ items: [words.slice(0, 500), words.slice(0, 160), words.slice(0, 161)] }));
    expect(out?.lines.map((line) => line.length)).toEqual([160, 160, 160]);
    expect(out?.lines[0]?.endsWith('…')).toBe(true);
    // A line of exactly 160 characters is not cut.
    expect(out?.lines[1]).toBe(words.slice(0, 160));
    expect(out?.lines[2]?.endsWith('…')).toBe(true);
  });

  it('strips markdown the same way as the local list: the lines are plain text', () => {
    expect(askOfBox(box({ items: ['Run `npm test` and read **the** [log](http://example.test/x)'] }))?.lines).toEqual(['Run npm test and read the log']);
  });

  it('runs every line through the same redaction as a title, before the cut', () => {
    const token = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    const out = askOfBox(
      box({
        items: [
          `Use ${token} to push`,
          'Set API_KEY=hunter2hunter2 and rerun',
          'Header: Authorization: Bearer abcDEF123456xyz',
          'password: hunter2',
          'sk-ant-api03-AbCdEfGhIjKlMnOpQrSt is the key',
          `${'a '.repeat(75)}${token}`,
          `a token inside **bold ${token}** marks`,
        ],
      }),
    );
    const text = JSON.stringify(out);
    for (const secret of ['ghp_', 'hunter2', 'abcDEF123456xyz', 'sk-ant', 'abcdefghijklmnopqrstuvwxyz0123456789']) expect(text).not.toContain(secret);
    expect(out?.lines[0]).toBe(`Use ${REDACTED} to push`);
    expect(out?.lines.every((line) => line.length <= 160)).toBe(true);
    // The same function the titles use: the first line equals what `redact` gives.
    expect(redact(`Use ${token} to push`)).toBe(out?.lines[0]);
  });

  it.each([
    ['a Stripe live key', 'Do: sk_live_abcdefghijklmnop', 'sk_live_'],
    ['a Stripe test key', 'Do: sk_test_abcdefghijklmnop', 'sk_test_'],
    ['a Stripe restricted key', 'Do: rk_live_abcdefghijklmnop', 'rk_live_'],
    ['a GitLab token', 'Do: glpat-abcdefghij1234', 'glpat-'],
    ['a secret word, a space and a value', 'Do: password hunter2', 'hunter2'],
    ['a short token after the word token', 'Do: token AXabcDEFghiJKL', 'AXabc'],
    ['a sig query parameter', 'Open https://u@host/?sig=abcdef12345678', 'abcdef12345678'],
    ['a signature query parameter', 'Open https://host/p?x=1&signature=abcdef12345678', 'abcdef12345678'],
    ['a key query parameter', 'Open https://host/p?key=abcdef12345678', 'abcdef12345678'],
    ['an auth query parameter', 'Open https://host/p?auth=abcdef12345678', 'abcdef12345678'],
    ['a code query parameter', 'Open https://host/cb?code=abcdef12345678', 'abcdef12345678'],
    ['an access_token query parameter', 'Open https://host/cb?access_token=abcdef12345678', 'abcdef12345678'],
  ])('F1: the redaction of a box line catches %s, and a title gets the same', (_name, line, secret) => {
    const out = askOfBox(box({ items: [line] }));
    expect(JSON.stringify(out)).not.toContain(secret);
    expect(out?.lines[0]).toContain(REDACTED);
    // Titles use the same function, so the two are in step.
    expect(redact(line)).not.toContain(secret);
  });

  it('F1: a plain sentence with the word key or code in it is not changed', () => {
    expect(askOfBox(box({ items: ['Review the code and the key idea at https://example.test/a?page=2'] }))?.lines).toEqual(['Review the code and the key idea at https://example.test/a?page=2']);
  });

  it('M5: the 160 cut never halves a redaction marker', () => {
    // A secret that starts a little before the cut: the marker would run across character 159, so a plain cut would leave "[redact…".
    for (const pad of [140, 145, 150, 152, 155, 158]) {
      const line = `${'a '.repeat(Math.ceil(pad / 2)).slice(0, pad)}sk-abcdefghijklmnopqrstu and more words after it`;
      const out = askOfBox(box({ items: [line] }))?.lines[0] ?? '';
      expect(out.length, `pad ${pad}`).toBeLessThanOrEqual(160);
      expect(out, `pad ${pad}`).not.toMatch(/\[(?:r|re|red|reda|redac|redact|redacte)?…$/);
      expect(out, `pad ${pad}`).not.toMatch(/\[redact(?!ed\])/);
    }
  });

  it('F2: a box with a time in the future is not sent', () => {
    expect(askOfBox(box({ at: new Date(NOW_MS + 9e9).toISOString() }))).toBeNull();
    expect(askOfBox(box({ at: new Date(NOW_MS + 2 * 60_000).toISOString() }))).toBeNull();
    // A few seconds ahead is two clocks that differ a little, and it is sent.
    expect(askOfBox(box({ at: new Date(NOW_MS + 20_000).toISOString() }))).not.toBeNull();
  });

  it('sends nothing when the box fails a rule: answered, says nothing, older than 12 hours, no time', () => {
    expect(askOfBox(box({ answered: true }))).toBeNull();
    expect(askOfBox(box({ nothing: true, items: [] }))).toBeNull();
    expect(askOfBox(box({ nothing: true, items: ['A line that must not leave'] }))).toBeNull();
    expect(askOfBox(box({ at: hoursAgo(12.1) }))).toBeNull();
    expect(askOfBox(box({ at: '' }))).toBeNull();
    expect(askOfBox(box({ at: hoursAgo(11.9) }))).not.toBeNull();
    expect(ASK_MAX_AGE_MS).toBe(12 * 3_600_000);
    // No box, no facts, and a box with no usable line.
    expect(askOfBox(null)).toBeNull();
    expect(build({ sessions: [liveSession()], facts: [], worktrees: [] }).sessions[0]?.yourMove).toBeNull();
    expect(askOfBox(box({ items: ['   ', ''] }))).toBeNull();
  });

  it('sends nothing else of any message: the allow-list of the session row and of the ask is exact, and no other text of the box or the session gets through', () => {
    const facts = {
      ...info(),
      yourMove: { ...box({ items: ['Review the diff'] }), lastMessage: 'SECRET RESULT', prompt: 'SECRET PROMPT TEXT', text: 'SECRET-FILE-BODY' } as YourMoveBox,
    };
    const out = build({ sessions: [liveSession()], facts: [facts], worktrees: [] });
    const row = out.sessions[0];
    expect(Object.keys(row as object).sort()).toEqual(['agents', 'branch', 'folder', 'id', 'startedAt', 'state', 'title', 'yourMove']);
    expect(Object.keys(row?.yourMove as object).sort()).toEqual(['at', 'lines']);
    const text = JSON.stringify(out);
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    // The one line is the only message text in the whole value.
    expect(text).toContain('Review the diff');
  });

  it('only a live session sends an ask: the mapper is called for the sessions of the process list, so a session with a box that is not in it sends none', () => {
    const out = build({ sessions: [], facts: [{ ...info(), yourMove: box() }], worktrees: [] });
    expect(out.sessions).toEqual([]);
    expect(JSON.stringify(out)).not.toContain('Review the diff');
  });

  it('the value passes parseLive, and parseLive holds even a careless value to the same caps', () => {
    const body = build({ sessions: [liveSession()], facts: [{ ...info(), yourMove: box({ items: ['A', 'B'] }) }], worktrees: [] });
    const parsed = parseLive({ writtenAt: new Date(NOW_MS).toISOString(), ...body });
    expect(parsed.ok && parsed.live.sessions[0]?.yourMove).toEqual({ at: hoursAgo(0.5), lines: ['A', 'B'] });
    expect(mapAsk(undefined, NOW_MS)).toBeNull();
  });
});
