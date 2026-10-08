import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type APIRequestContext, expect, test } from '@playwright/test';
import type { AgentsLive, Panel } from '../src/shared/types';
import { E2E_DIR } from './fake-gh';

// The live agents route (GET /api/agents) on the end-to-end server: the real server, the real pid check, and a fixture config that names a process
// folder, two Claude folders and the fixture repo under the work folder. The tests write made-up process files and session files there and ask the
// route, so they open no browser page. The server's own folder of processes is never the real one (~/.claude/sessions): the e2e config points it
// into the work folder, which the unit tests check.
//
// A process file needs a pid that runs. The test process itself runs, so its pid stands for a live Claude process; the pid of a program that
// has already ended stands for a closed one.

const REPO = join(E2E_DIR, 'repo'); // the one root of the end-to-end config
const PROCESSES = join(E2E_DIR, 'claude-sessions'); // `claude.sessionsRoot` of the end-to-end config
const PROJECTS = join(E2E_DIR, 'claude-projects'); // `claude.projectsRoot`
const WHOLE = join(PROJECTS, 'fixture-shadow-jog'); // `claude.folders`
const ID = (n: number) => `e2e0a000-0000-4000-8000-${String(n).padStart(12, '0')}`;

type Line = Record<string, unknown>;
const time = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();
const user = (text: string, secondsAgo = 30): Line => ({ type: 'user', timestamp: time(secondsAgo), cwd: REPO, gitBranch: 'fixture-branch', sessionId: 'e2e', entrypoint: 'claude-desktop', message: { role: 'user', content: text } });
const call = (id: string, secondsAgo = 25): Line => ({
  type: 'assistant',
  timestamp: time(secondsAgo),
  cwd: REPO,
  gitBranch: 'fixture-branch',
  sessionId: 'e2e',
  entrypoint: 'claude-desktop',
  message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name: 'Agent', input: { description: 'LEAK-e2e-call-description', prompt: 'LEAK-e2e-call-prompt' } }] },
});
const toolResult = (secondsAgo = 5): Line => ({
  type: 'user',
  timestamp: time(secondsAgo),
  cwd: REPO,
  gitBranch: 'fixture-branch',
  sessionId: 'e2e',
  entrypoint: 'claude-desktop',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_e2e', content: 'LEAK-e2e-result' }] },
  toolUseResult: { ok: true },
});

function writeLines(file: string, lines: Line[]): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
}

function writeProcess(pid: number, sessionId: string, status: 'busy' | 'idle', extra: Line = {}): void {
  mkdirSync(PROCESSES, { recursive: true });
  writeFileSync(join(PROCESSES, `${pid}.json`), JSON.stringify({ pid, sessionId, cwd: REPO, startedAt: Date.now() - 120_000, status, name: 'SENTINEL-e2e-name', messagingSocketPath: 'SENTINEL-e2e-socket', ...extra }));
}

/** The pid of a program that has ended: nothing runs under it any more. */
function endedPid(): number {
  const run = spawnSync(process.execPath, ['-e', '0']);
  if (run.pid === undefined || run.pid <= 0) throw new Error('could not start a program to get a pid that has ended');
  return run.pid;
}

async function readAgents(request: APIRequestContext): Promise<Panel<AgentsLive>> {
  const res = await request.get('/api/agents?refresh=1');
  expect(res.status()).toBe(200);
  return (await res.json()) as Panel<AgentsLive>;
}

test.describe('the live agents route', () => {
  test.beforeEach(() => {
    rmSync(PROCESSES, { recursive: true, force: true });
    rmSync(PROJECTS, { recursive: true, force: true });
  });
  test.afterEach(() => {
    rmSync(PROCESSES, { recursive: true, force: true });
    rmSync(PROJECTS, { recursive: true, force: true });
  });

  test('with no process list the route answers from the file ages and says so', async ({ request }) => {
    // The folder of the process list is not there. A session that wrote lately is live by the rule of version 1.
    writeLines(join(WHOLE, `${ID(1)}.jsonl`), [user('E2E title of a session that wrote lately'), toolResult()]);
    const panel = await readAgents(request);
    expect(panel.ok).toBe(true);
    if (!panel.ok) return;
    expect(panel.data.source).toBe('file-age');
    expect(panel.data.sessions.map((session) => [session.id, session.title, session.state])).toEqual([[ID(1), 'E2E title of a session that wrote lately', 'working']]);
    expect(panel.data.hiddenScripts).toBe(0);
  });

  test('a live process shows its session with its agent, and a closed one does not', async ({ request }) => {
    // A runs (this very test process stands for it). B has a process file, and its program has ended.
    writeLines(join(WHOLE, `${ID(2)}.jsonl`), [user('E2E title of the live session'), call('toolu_e2e_1'), toolResult()]);
    writeLines(join(WHOLE, ID(2), 'subagents', 'agent-e2e0a01.jsonl'), [user('LEAK-e2e-agent-prompt', 20), toolResult(3)]);
    writeFileSync(join(WHOLE, ID(2), 'subagents', 'agent-e2e0a01.meta.json'), JSON.stringify({ spawnDepth: 1, agentType: 'general-purpose', description: 'Explore the fixture', model: 'claude-fable-5-1', toolUseId: 'toolu_e2e_1' }));
    writeLines(join(WHOLE, `${ID(3)}.jsonl`), [user('LEAK-e2e-title-of-the-closed-session'), toolResult()]);
    writeProcess(process.pid, ID(2), 'busy');
    writeProcess(endedPid(), ID(3), 'busy');

    const panel = await readAgents(request);
    expect(panel.ok).toBe(true);
    if (!panel.ok) return;
    expect(panel.data.source).toBe('process-list');
    expect(panel.data.sessions).toHaveLength(1);
    const [session] = panel.data.sessions;
    expect(session).toMatchObject({ id: ID(2), title: 'E2E title of the live session', state: 'working', filePath: join(WHOLE, `${ID(2)}.jsonl`) });
    expect(session?.nodes).toEqual([
      expect.objectContaining({ id: 'e2e0a01', parentId: ID(2), kind: 'agent', label: 'Explore the fixture', model: 'fable', state: 'running', endedAt: null, messages: { count: 0, approximate: false } }),
    ]);

    // Nothing of a process file or of a conversation is in the answer, and nothing of the session whose process ended.
    const text = JSON.stringify(panel);
    expect(text).not.toMatch(/SENTINEL|LEAK-e2e|"pid"/);
    expect(text).not.toContain(ID(3));
  });

  test('the status follows the process file, and a process that ends takes its session away', async ({ request }) => {
    writeLines(join(WHOLE, `${ID(4)}.jsonl`), [user('E2E title of a session that changes'), toolResult()]);
    writeProcess(process.pid, ID(4), 'busy');
    const busy = await readAgents(request);
    expect(busy.ok && busy.data.sessions.map((session) => [session.id, session.state])).toEqual([[ID(4), 'working']]);

    writeProcess(process.pid, ID(4), 'idle');
    const idle = await readAgents(request);
    expect(idle.ok && idle.data.sessions.map((session) => [session.id, session.state])).toEqual([[ID(4), 'waiting']]);

    // The program ends: its file stays in the folder, and the session leaves at once.
    rmSync(join(PROCESSES, `${process.pid}.json`));
    writeProcess(endedPid(), ID(4), 'idle');
    const gone = await readAgents(request);
    expect(gone.ok && gone.data).toEqual({ sessions: [], hiddenScripts: 0, source: 'process-list' });
  });

  test('a new live session reaches an open page within 5 seconds through the live event, with no request for it', async () => {
    // The page keeps one event stream open and reloads a panel when its module is named. Here the stream is read directly.
    const events = await fetch('http://127.0.0.1:3010/api/events');
    const reader = (events.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = '';
    const seen = (module: string) => new RegExp(`event: changed\\s+data: [^\\n]*"module":"${module}"`).test(text);
    // One read is kept until it answers: a read that lost a race against the timer would otherwise take a chunk and drop it.
    let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
    const readUntil = async (done: () => boolean, ms: number) => {
      const deadline = Date.now() + ms;
      while (!done() && Date.now() < deadline) {
        pending ??= reader.read();
        const chunk = await Promise.race([pending, new Promise<null>((resolve) => setTimeout(() => resolve(null), 250))]);
        if (chunk === null) continue;
        pending = null;
        if (!chunk.done) text += decoder.decode(chunk.value, { stream: true });
      }
    };
    try {
      await readUntil(() => text.includes('event: hello'), 3000);
      expect(text).toContain('event: hello');
      // The server looks every 3 seconds. Let a look pass, and clear what was said, so the next event is the answer to the change below.
      await readUntil(() => false, 4000);
      text = '';

      writeLines(join(WHOLE, `${ID(5)}.jsonl`), [user('E2E title of a session that just started'), toolResult()]);
      writeProcess(process.pid, ID(5), 'busy');
      const startedAt = Date.now();
      await readUntil(() => seen('agents'), 5000);
      expect(seen('agents'), 'an event for the module agents').toBe(true);
      expect(Date.now() - startedAt).toBeLessThan(5000);
    } finally {
      await reader.cancel();
    }
  });
});
