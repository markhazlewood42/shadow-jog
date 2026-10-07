import { join } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { compose } from '../src/server/compose';
import { createWriteGuard, makeToken } from '../src/server/guard';
import { PACKAGE_DIR, makeTestConfig, noopRunner, ownHost } from './helpers';

const TOKEN = makeToken();
const config = makeTestConfig();
const HOST = ownHost(config);

/** A tiny app with one guarded write route, to test the guard on its own. */
function guardedApp(): Hono {
  const app = new Hono();
  app.post('/write', createWriteGuard(TOKEN), (c) => c.json({ ok: true }));
  return app;
}

/** A POST that passes every check; a test changes the one thing it is about. */
function post(app: Hono, headers: Record<string, string | undefined> = {}): Promise<Response> {
  const all: Record<string, string> = { host: HOST, origin: `http://${HOST}`, 'content-type': 'application/json', 'x-cc-token': TOKEN };
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) delete all[name];
    else all[name] = value;
  }
  return Promise.resolve(app.request('/write', { method: 'POST', headers: all, body: '{}' }));
}

/** The token a page of this app carries in <meta name="cc-token">. */
async function pageToken(): Promise<string> {
  const { app } = compose({ config, runner: noopRunner, webRoot: join(PACKAGE_DIR, 'src', 'web') });
  const res = await app.request('/', { headers: { host: HOST } });
  const html = await res.text();
  const match = html.match(/<meta name="cc-token" content="([^"]*)"/);
  return match?.[1] ?? '';
}

describe('the write guard', () => {
  it('the write guard: a missing or wrong token gets 403, a cross-site Origin gets 403, a non-JSON body gets 415, and the token differs at each start', async () => {
    const app = guardedApp();

    // A request with the right token, the same origin and a JSON body passes.
    expect((await post(app)).status).toBe(200);

    // A missing or wrong token gets 403: no header, an empty one, one of the same length, a longer and a shorter one.
    expect((await post(app, { 'x-cc-token': undefined })).status).toBe(403);
    expect((await post(app, { 'x-cc-token': '' })).status).toBe(403);
    expect((await post(app, { 'x-cc-token': TOKEN.replace(/.$/, TOKEN.endsWith('A') ? 'B' : 'A') })).status).toBe(403);
    expect((await post(app, { 'x-cc-token': `${TOKEN}x` })).status).toBe(403);
    expect((await post(app, { 'x-cc-token': TOKEN.slice(1) })).status).toBe(403);
    const denied = await post(app, { 'x-cc-token': 'wrong' });
    expect(await denied.json()).toMatchObject({ ok: false, error: { code: 'bad-token' } });

    // A cross-site Origin gets 403 even with the right token: another website's page cannot write.
    expect((await post(app, { origin: 'http://evil.example' })).status).toBe(403);
    expect((await post(app, { origin: `http://127.0.0.1:${config.port}` })).status).toBe(403); // not the host the page was opened on
    expect((await post(app, { origin: 'null' })).status).toBe(403); // a sandboxed frame
    expect((await post(app, { origin: `https://${HOST}` })).status).toBe(403); // another scheme
    expect((await post(app, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await post(app, { 'sec-fetch-site': 'same-site' })).status).toBe(403);
    expect((await post(app, { 'sec-fetch-site': 'same-origin' })).status).toBe(200);
    // A request with no Origin at all (a script, not a web page) passes when the token is right.
    expect((await post(app, { origin: undefined })).status).toBe(200);

    // A body that is not JSON gets 415. JSON with a charset is still JSON.
    expect((await post(app, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post(app, { 'content-type': 'application/x-www-form-urlencoded' })).status).toBe(415);
    expect((await post(app, { 'content-type': 'multipart/form-data; boundary=x' })).status).toBe(415);
    expect((await post(app, { 'content-type': undefined })).status).toBe(415);
    expect((await post(app, { 'content-type': 'application/json; charset=utf-8' })).status).toBe(200);
    expect((await post(app, { 'content-type': 'Application/JSON' })).status).toBe(200);

    // The token is checked first: a request that fails on both counts is a 403.
    expect((await post(app, { 'x-cc-token': 'wrong', 'content-type': 'text/plain' })).status).toBe(403);

    // The token differs at each start: two tokens are never equal, and two composed apps put different tokens in their pages.
    const [a, b] = [makeToken(), makeToken()];
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    const [pageA, pageB] = [await pageToken(), await pageToken()];
    expect(pageA).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(pageB).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(pageA).not.toBe(pageB);
  });

  it('does not run the route when the guard refuses', async () => {
    let ran = false;
    const app = new Hono();
    app.post('/write', createWriteGuard(TOKEN), (c) => {
      ran = true;
      return c.json({ ok: true });
    });
    await post(app, { 'x-cc-token': 'wrong' });
    await post(app, { origin: 'http://evil.example' });
    await post(app, { 'content-type': 'text/plain' });
    expect(ran).toBe(false);
    await post(app);
    expect(ran).toBe(true);
  });
});
