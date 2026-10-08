import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createAgentsSource } from '../src/server/agents/module';
import { compose } from '../src/server/compose';
import { createHub } from '../src/server/hub';
import { registerAgentsRoutes } from '../src/server/routes/agents';
import type { AgentsLive, Panel } from '../src/shared/types';
import { NOW, PID, SA, SB, agentsConfig, aliveSet, copyAgentFixtures, setStatus } from './agents-helpers';
import { PACKAGE_DIR, SseReader, getFrom, makeApp, noopRunner } from './helpers';

// GET /api/agents: the Panel of the agents source, over the synthetic fixture world (tests/fixtures/claude). The source takes its clock and its pid
// check as parameters, so a test sets them to the moment the fixtures were made for and to the processes that the world says run.

const parent = mkdtempSync(join(tmpdir(), 'cc-agents-route-'));
afterAll(() => rmSync(parent, { recursive: true, force: true }));

/** The app with the route over a fresh copy of the world. */
function appOver(world = copyAgentFixtures(parent)) {
  const config = agentsConfig(world);
  const { app } = makeApp({ config });
  const alive = aliveSet();
  const source = createAgentsSource({ config, hub: createHub(), now: () => NOW, isAlive: (pid) => alive.has(pid) });
  registerAgentsRoutes(app, source, { minGapMs: 0 });
  return { app, config, world, alive, source };
}

describe('GET /api/agents', () => {
  it('GET /api/agents returns a panel', async () => {
    const { app, config } = appOver();
    const res = await getFrom(app, '/api/agents', config);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const panel = (await res.json()) as Panel<AgentsLive>;
    expect(panel.ok).toBe(true);
    if (!panel.ok) return;
    // The live sessions of the world, in order of start, and the one hidden script.
    expect(panel.data.source).toBe('process-list');
    expect(panel.data.hiddenScripts).toBe(1);
    expect(panel.data.sessions.map((session) => [session.id, session.state])).toEqual([
      [SB, 'waiting'],
      [SA, 'working'],
    ]);
    expect(panel.data.sessions.find((session) => session.id === SA)?.nodes.map((node) => node.id)).toEqual(['aa01', 'aa02', 'aa03', 'aa04', 'wf_00000001-fix']);
    expect(Number.isNaN(Date.parse(panel.updatedAt))).toBe(false);
    // Nothing of a process file is in the text of the answer.
    expect(JSON.stringify(panel)).not.toMatch(/SENTINEL|LEAK-|"pid"/);
  });

  it('a source that failed is still a Panel with status 200 (ok:false, the reason, and the last good list)', async () => {
    const world = copyAgentFixtures(parent);
    const config = agentsConfig(world);
    const { app } = makeApp({ config });
    let broken = false;
    const source = createAgentsSource({
      config,
      hub: createHub(),
      now: () => {
        if (broken) throw new Error('a made-up failure');
        return NOW;
      },
      isAlive: (pid) => aliveSet().has(pid),
    });
    registerAgentsRoutes(app, source, { minGapMs: 0 });
    expect(((await (await getFrom(app, '/api/agents', config)).json()) as Panel<AgentsLive>).ok).toBe(true);

    // A request after a failure answers the failed panel, a browser does not log an HTTP error, and the last list is still there.
    broken = true;
    const res = await getFrom(app, '/api/agents?refresh=1', config);
    expect(res.status).toBe(200);
    const panel = (await res.json()) as Panel<AgentsLive>;
    expect(panel).toMatchObject({ ok: false, error: { code: 'agents-failed' } });
    if (panel.ok) return;
    expect(panel.lastGood?.data.sessions).toHaveLength(2);
  });

  it('only GET is answered: the server refuses the other methods before the route sees them', async () => {
    const { app, config } = appOver();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await app.request('/api/agents', { method, headers: { host: `localhost:${config.port}` } });
      expect(res.status, method).toBe(405);
    }
  });

  it('takes nothing from the client: no path, no session id, no process id is read from the request', async () => {
    const { app, config } = appOver();
    const plain = await (await getFrom(app, '/api/agents', config)).json();
    // Whatever a request adds to the address, the answer is the same one.
    for (const query of ['?folder=fixture-shadow-jog-old', '?path=../../etc', '?id=cccccccc-0000-4000-8000-00000000000c', '?pid=7701003', '?sessionsRoot=/', '?refresh=7']) {
      expect(await (await getFrom(app, `/api/agents${query}`, config)).json(), query).toEqual(plain);
    }
    // A path under it is not a route.
    for (const path of ['/api/agents/aaaaaaaa-0000-4000-8000-00000000000a', '/api/agents/..%2f..', '/api/agents/7701001']) {
      expect((await getFrom(app, path, config)).status, path).toBe(404);
    }
    // Another host name is refused like for every route.
    expect((await getFrom(app, '/api/agents', config, { host: 'example.test' })).status).toBe(403);
  });

  it('?refresh=1 looks again, so a change of status shows at once', async () => {
    const { app, config, world } = appOver();
    const first = (await (await getFrom(app, '/api/agents', config)).json()) as Panel<AgentsLive>;
    setStatus(world, PID.B, 'busy');
    // Without the parameter the answer is the last look; with it, the source looks again.
    const stale = (await (await getFrom(app, '/api/agents', config)).json()) as Panel<AgentsLive>;
    expect(stale.ok && stale.data.sessions[0]?.state).toBe('waiting');
    const fresh = (await (await getFrom(app, '/api/agents?refresh=1', config)).json()) as Panel<AgentsLive>;
    expect(first.ok && first.data.sessions[0]?.state).toBe('waiting');
    expect(fresh.ok && fresh.data.sessions[0]?.state).toBe('working');
  });
});

describe('the server', () => {
  it('compose mounts the agents: GET /api/agents answers on the real app, and its module is started and stopped with the others', async () => {
    const world = copyAgentFixtures(parent);
    const config = agentsConfig(world);
    const composed = compose({ config, runner: noopRunner, webRoot: join(PACKAGE_DIR, 'src', 'web'), now: () => NOW, isAlive: (pid) => aliveSet().has(pid) });
    const res = await getFrom(composed.app, '/api/agents', config);
    expect(res.status).toBe(200);
    const panel = (await res.json()) as Panel<AgentsLive>;
    expect(panel.ok && panel.data.sessions.map((session) => session.id)).toEqual([SB, SA]);
    await composed.stop();
  });

  it('compose starts the agents module with the others: its first look reaches the open pages as a change event', async () => {
    const world = copyAgentFixtures(parent);
    const config = agentsConfig(world);
    const composed = compose({ config, runner: noopRunner, webRoot: join(PACKAGE_DIR, 'src', 'web'), now: () => NOW, isAlive: (pid) => aliveSet().has(pid) });
    const stream = new SseReader((await getFrom(composed.app, '/api/events', config)).body);
    try {
      expect((await stream.next()).event).toBe('hello');
      await composed.start();
      // The other modules publish too (the docs, the status ...). Read until the event of the agents comes.
      const modules: string[] = [];
      for (let frames = 0; frames < 50 && !modules.includes('agents'); frames += 1) {
        const frame = await stream.next(5000);
        if (frame.event === 'changed') modules.push((JSON.parse(frame.data) as { module: string }).module);
      }
      expect(modules).toContain('agents');
    } finally {
      await stream.cancel();
      await composed.stop();
    }
  });
});
