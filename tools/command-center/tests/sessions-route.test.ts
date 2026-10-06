import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { compose } from '../src/server/compose';
import { createHub } from '../src/server/hub';
import { registerSessionsRoutes } from '../src/server/routes/sessions';
import { createSessionsSource } from '../src/server/sessions/sessions';
import type { Panel, SessionsInfo } from '../src/shared/types';
import { NOW, copyClaudeFixtures, sessionsConfig, writeAged } from './sessions-helpers';
import { PACKAGE_DIR, SseReader, getFrom, makeApp, noopRunner } from './helpers';

// GET /api/sessions: the Panel of the sessions source, over the synthetic Claude folders of the fixtures.
// The sessions source takes its clock as a parameter, so a test sets it to the moment the fixtures were made for.

const parent = mkdtempSync(join(tmpdir(), 'cc-sessions-route-'));
afterAll(() => rmSync(parent, { recursive: true, force: true }));

describe('GET /api/sessions', () => {
  it('answers the Panel of the sessions: the sessions of the fixtures, and how many files were looked at', async () => {
    const config = sessionsConfig(copyClaudeFixtures(join(parent, 'one')));
    const { app } = makeApp({ config });
    registerSessionsRoutes(app, createSessionsSource({ config, hub: createHub(), now: () => NOW }));

    const res = await getFrom(app, '/api/sessions', config);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const panel = (await res.json()) as Panel<SessionsInfo>;
    expect(panel.ok).toBe(true);
    if (!panel.ok) return;
    expect(panel.data.sessions.map((session) => session.id.slice(0, 8))).toEqual(['11111111', '33333333', '44444444', '55555555', '66666666']);
    expect(panel.data).toMatchObject({ scanned: 8, skipped: 3 });
    expect(Number.isNaN(Date.parse(panel.updatedAt))).toBe(false);
  });

  it('a source that failed is still a Panel with status 200 (ok:false, the reason, and the last good list)', async () => {
    // Every file in a format that is not known: the panel says so, and a browser does not log an HTTP error.
    const projects = join(parent, 'broken');
    const config = sessionsConfig(projects, { folders: ['f'], cwdMatchFolders: [] });
    const { app } = makeApp({ config });
    writeAged(join(projects, 'f', 'aaaaaaaa-0000-4000-8000-000000000001.jsonl'), '{"kind":"greeting"}\n{"kind":"reply"}\n');
    registerSessionsRoutes(app, createSessionsSource({ config, hub: createHub(), now: () => NOW }));

    const res = await getFrom(app, '/api/sessions', config);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: 'sessions-unknown-format' }, lastGood: null });
  });

  it('only GET is answered: the server refuses the other methods before the route sees them', async () => {
    const config = sessionsConfig(copyClaudeFixtures(join(parent, 'two')));
    const { app } = makeApp({ config });
    registerSessionsRoutes(app, createSessionsSource({ config, hub: createHub(), now: () => NOW }));
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await app.request('/api/sessions', { method, headers: { host: `localhost:${config.port}` } });
      expect(res.status, method).toBe(405);
    }
  });

  it('takes nothing from the client: no path, no session id, no folder name is read from the request', async () => {
    const config = sessionsConfig(copyClaudeFixtures(join(parent, 'three')));
    const { app } = makeApp({ config });
    registerSessionsRoutes(app, createSessionsSource({ config, hub: createHub(), now: () => NOW }));
    const plain = await (await getFrom(app, '/api/sessions', config)).json();
    // Whatever a request adds to the address, the answer is the same one.
    for (const query of ['?folder=fixture-shadow-jog-old', '?path=../../etc', '?id=77777777-7777-4777-8777-777777777777', '?cwd=/', '?refresh=7']) {
      expect(await (await getFrom(app, `/api/sessions${query}`, config)).json(), query).toEqual(plain);
    }
    // A path under it is not a route.
    for (const path of ['/api/sessions/11111111-1111-4111-8111-111111111111', '/api/sessions/..%2f..', '/api/sessions/agents']) {
      expect((await getFrom(app, path, config)).status, path).toBe(404);
    }
  });
});

describe('the server', () => {
  it('compose mounts the sessions: GET /api/sessions answers on the real app, and its module is started and stopped with the others', async () => {
    const config = sessionsConfig(copyClaudeFixtures(join(parent, 'composed')));
    const composed = compose({ config, runner: noopRunner, webRoot: join(PACKAGE_DIR, 'src', 'web'), now: () => NOW });
    const res = await getFrom(composed.app, '/api/sessions', config);
    expect(res.status).toBe(200);
    const panel = (await res.json()) as Panel<SessionsInfo>;
    expect(panel.ok).toBe(true);
    if (!panel.ok) return;
    expect(panel.data.sessions.map((session) => session.id.slice(0, 8))).toEqual(['11111111', '33333333', '44444444', '55555555', '66666666']);
    expect(panel.data).toMatchObject({ scanned: 8, skipped: 3 });
    await composed.stop();
  });

  it('compose starts the sessions module with the others: its first look reaches the open pages as a change event', async () => {
    const config = sessionsConfig(copyClaudeFixtures(join(parent, 'started')));
    const composed = compose({ config, runner: noopRunner, webRoot: join(PACKAGE_DIR, 'src', 'web'), now: () => NOW });
    const stream = new SseReader((await getFrom(composed.app, '/api/events', config)).body);
    try {
      expect((await stream.next()).event).toBe('hello');
      await composed.start();
      // The other modules publish too (the docs, the status ...). Read until the sessions' own event comes.
      const modules: string[] = [];
      for (let frames = 0; frames < 50 && !modules.includes('sessions'); frames += 1) {
        const frame = await stream.next(5000);
        if (frame.event === 'changed') modules.push((JSON.parse(frame.data) as { module: string }).module);
      }
      expect(modules).toContain('sessions');
    } finally {
      await stream.cancel();
      await composed.stop();
    }
  });
});
