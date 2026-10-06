import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type APIRequestContext, expect, test } from '@playwright/test';
import type { Panel, SessionsInfo } from '../src/shared/types';
import { E2E_DIR } from './fake-gh';

// The sessions route on the end-to-end server: the real server, with a fixture config that names two Claude
// folders (a whole one and a mixed one) under the work folder, and the fixture repo as its one root. The tests
// write session files there (they are made up, and their times of last write are now), ask the route and read
// the answer, so they open no browser page. The end-to-end server sets the least time between two forced
// refreshes to 0 (see e2e/server.ts), so `?refresh=1` looks again at once.

const REPO = join(E2E_DIR, 'repo'); // the one root of the end-to-end config
const ELSEWHERE = join(E2E_DIR, 'elsewhere'); // a folder that is not inside it
const PROJECTS = join(E2E_DIR, 'claude-projects'); // `claude.projectsRoot` of the end-to-end config
const WHOLE = join(PROJECTS, 'fixture-shadow-jog'); // `claude.folders`
const MIXED = join(PROJECTS, 'fixture-home-base'); // `claude.cwdMatchFolders`
const NOT_NAMED = join(PROJECTS, 'fixture-shadow-jog-old'); // shares the start of a name, and is not named

const ID = (n: number) => `e2e00000-0000-4000-8000-${String(n).padStart(12, '0')}`;

type Line = Record<string, unknown>;
const time = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();
const user = (text: string, cwd: string | null, secondsAgo = 30): Line => ({ type: 'user', timestamp: time(secondsAgo), ...(cwd === null ? {} : { cwd }), gitBranch: 'fixture-branch', sessionId: 'e2e', message: { role: 'user', content: text } });
const reply = (text: string, cwd: string | null, secondsAgo = 20): Line => ({
  type: 'assistant',
  timestamp: time(secondsAgo),
  ...(cwd === null ? {} : { cwd }),
  gitBranch: 'fixture-branch',
  sessionId: 'e2e',
  message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] },
});
const toolResult = (cwd: string, secondsAgo = 5): Line => ({
  ...user('x', cwd, secondsAgo),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_e2e', content: 'LEAK-e2e-tool-result' }] },
  toolUseResult: { ok: true },
});

function writeLines(file: string, lines: Line[]): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
}

async function readSessions(request: APIRequestContext): Promise<Panel<SessionsInfo>> {
  const res = await request.get('/api/sessions?refresh=1');
  expect(res.status()).toBe(200);
  return (await res.json()) as Panel<SessionsInfo>;
}

test.describe('the sessions route', () => {
  test.beforeEach(() => rmSync(PROJECTS, { recursive: true, force: true }));
  test.afterEach(() => rmSync(PROJECTS, { recursive: true, force: true }));

  test('lists a session that works in the repo, with its agent, and no session that works elsewhere', async ({ request }) => {
    const box = '🟡 Two files changed.\n\n---\n### 👉 Your move\n- [ ] Review the diff\n- [ ] Tell me to commit';
    // Neither session has a title of its own, so each is titled by the first line of its first prompt (and nothing else of its prompts).
    writeLines(join(WHOLE, `${ID(1)}.jsonl`), [user('E2E title of the first session\nLEAK-e2e-second-line', REPO), reply(box, REPO)]);
    writeLines(join(WHOLE, ID(1), 'subagents', 'agent-e2e0001.jsonl'), [user('LEAK-e2e-agent-prompt', REPO, 25), reply('LEAK-e2e-agent-reply', REPO, 15)]);
    writeFileSync(join(WHOLE, ID(1), 'subagents', 'agent-e2e0001.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'Explore the fixture', model: 'sonnet' }));
    // The mixed folder keeps a session by its working folder alone.
    writeLines(join(MIXED, `${ID(2)}.jsonl`), [user('E2E title of the home-base session', REPO), reply('Done.', REPO), user('LEAK-e2e-later-prompt', REPO), reply('Done.', REPO)]); // inside the root: kept
    writeLines(join(MIXED, `${ID(3)}.jsonl`), [user('LEAK-e2e-elsewhere', ELSEWHERE), reply('Done.', ELSEWHERE)]); // outside: not Shadow Jog's
    writeLines(join(MIXED, `${ID(4)}.jsonl`), [{ type: 'last-prompt', lastPrompt: 'LEAK-e2e-no-cwd' }, { type: 'mode', mode: 'normal' }]); // no cwd: proves nothing
    // A folder that only shares the start of a name is never read.
    writeLines(join(NOT_NAMED, `${ID(5)}.jsonl`), [user('LEAK-e2e-prefix', REPO), reply('Done.', REPO)]);

    const panel = await readSessions(request);
    expect(panel.ok).toBe(true);
    if (!panel.ok) return;
    expect(panel.data.sessions.map((session) => [session.id, session.matchedBy, session.state]).sort()).toEqual([
      [ID(1), 'folder', 'waiting'],
      [ID(2), 'cwd', 'waiting'],
    ]);
    expect(panel.data).toMatchObject({ scanned: 4, skipped: 2 });

    const session = panel.data.sessions.find((candidate) => candidate.id === ID(1));
    expect(session?.cwd).toBe(REPO);
    expect(session?.title).toBe('E2E title of the first session');
    expect(panel.data.sessions.find((candidate) => candidate.id === ID(2))?.title).toBe('E2E title of the home-base session');
    expect(session?.yourMove).toMatchObject({ light: 'yellow', items: ['Review the diff', 'Tell me to commit'], nothing: false, answered: false });
    expect(session?.agents).toEqual([expect.objectContaining({ id: 'e2e0001', sessionId: ID(1), description: 'Explore the fixture', agentType: 'general-purpose', model: 'sonnet', state: 'done', workflowId: null })]);

    // Nothing of the conversation is in the answer, and nothing of a session that was left out.
    const text = JSON.stringify(panel);
    expect(text).not.toMatch(/LEAK-e2e/);
    for (const left of [ID(3), ID(4), ID(5)]) expect(text).not.toContain(left);
  });

  test('a change in a session file shows at the next look, and a file that is removed takes its session away', async ({ request }) => {
    const file = join(WHOLE, `${ID(1)}.jsonl`);
    writeLines(file, [user('go', REPO), reply('Done.', REPO)]);
    const before = await readSessions(request);
    expect(before.ok && before.data.sessions.map((session) => [session.id, session.state])).toEqual([[ID(1), 'waiting']]);

    // A tool result after the last reply: the session works again.
    appendFileSync(file, `${JSON.stringify(toolResult(REPO))}\n`);
    const during = await readSessions(request);
    expect(during.ok && during.data.sessions.map((session) => [session.id, session.state])).toEqual([[ID(1), 'working']]);

    // It moves out of the repo: it is not Shadow Jog's any more.
    appendFileSync(file, `${JSON.stringify(reply('Now elsewhere.', ELSEWHERE))}\n`);
    const moved = await readSessions(request);
    expect(moved.ok && moved.data).toMatchObject({ sessions: [], scanned: 1, skipped: 1 });

    rmSync(file);
    const gone = await readSessions(request);
    expect(gone.ok && gone.data).toEqual({ sessions: [], scanned: 0, skipped: 0 });
  });

  test('files in a format that is not known make an error panel, which names no text of the files and goes away with them', async ({ request }) => {
    writeLines(join(WHOLE, `${ID(1)}.jsonl`), [{ kind: 'greeting', data: 'LEAK-e2e-new-format' }, { kind: 'reply' }]);
    const broken = await readSessions(request);
    expect(broken.ok).toBe(false);
    if (broken.ok) return;
    expect(broken.error.code).toBe('sessions-unknown-format');
    expect(broken.error.message).toContain('unknown file format');
    expect(JSON.stringify(broken)).not.toContain('LEAK-e2e');
    expect(broken.updatedAt === null || !Number.isNaN(Date.parse(broken.updatedAt))).toBe(true);

    rmSync(join(WHOLE, `${ID(1)}.jsonl`));
    const mended = await readSessions(request);
    expect(mended.ok && mended.data).toEqual({ sessions: [], scanned: 0, skipped: 0 });
  });

  test('only GET is answered, and a request takes no path or id', async ({ request }) => {
    expect((await request.post('/api/sessions')).status()).toBe(405);
    expect((await request.get(`/api/sessions/${ID(1)}`)).status()).toBe(404);
    expect((await request.get('/api/sessions?folder=fixture-shadow-jog-old&path=..')).status()).toBe(200);
  });
});
