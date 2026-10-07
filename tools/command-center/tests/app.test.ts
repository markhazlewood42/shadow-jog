import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { compose } from '../src/server/compose';
import { PACKAGE_DIR, getFrom, makeApp, makeTestConfig, noopRunner, ownHost } from './helpers';

describe('the address rules', () => {
  it('a foreign Host gets 403 and localhost:<port> or 127.0.0.1:<port> gets 200, with the port from config (the E2E server uses 3010)', async () => {
    for (const port of [3009, 3010]) {
      const config = makeTestConfig({ port });
      const { app } = makeApp({ config });
      const otherPort = port === 3009 ? 3010 : 3009;

      // Its own two addresses, with the port from the config, are answered (the case of the name does not matter).
      for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `LOCALHOST:${port}`]) {
        for (const path of ['/api/health', '/']) {
          const res = await getFrom(app, path, config, { host });
          expect(res.status, `${host} ${path}`).toBe(200);
        }
      }

      // Any other Host is refused on every kind of path: DNS rebinding sends the victim's browser
      // to the attacker's own name, and that name arrives in this header.
      const foreign = [
        'evil.example',
        `evil.example:${port}`,
        'localhost',
        `localhost:${otherPort}`,
        `127.0.0.1:${otherPort}`,
        `[::1]:${port}`,
        `0.0.0.0:${port}`,
        `localhost.evil.example:${port}`,
        `localhost:${port}.evil.example`,
        `localhost:${port}@evil.example`,
        '',
      ];
      for (const host of foreign) {
        for (const path of ['/api/health', '/api/events', '/', '/docs/engine/decisions', '/assets/app.js']) {
          const res = await getFrom(app, path, config, { host });
          expect(res.status, `[${host}] ${path}`).toBe(403);
          expect(await res.json()).toMatchObject({ ok: false, error: { code: 'forbidden-host' } });
        }
      }

      // No Host header at all is refused as well.
      const bare = await app.request('/api/health');
      expect(bare.status).toBe(403);
    }
  });

  it('a non-GET method gets 405, except POST /api/decisions/<n>/answer', async () => {
    const { app, deps } = makeApp();
    const host = ownHost(deps.config);

    const methods = ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'PROPFIND'];
    for (const method of methods) {
      for (const path of ['/api/health', '/', '/api/events', '/assets/app.js', '/api/decisions', '/api/decisions/12']) {
        const res = await app.request(path, { method, headers: { host } });
        expect(res.status, `${method} ${path}`).toBe(405);
        expect(res.headers.get('allow'), `${method} ${path}`).toBe('GET');
      }
    }
    const body = await (await app.request('/api/health', { method: 'DELETE', headers: { host } })).json();
    expect(body).toMatchObject({ ok: false, error: { code: 'method-not-allowed' } });

    // The one write route is let through to the router. (Until the decisions task adds the route
    // it answers 404; what matters here is that the method gate does not turn it away.)
    const answer = await app.request('/api/decisions/12/answer', { method: 'POST', headers: { host } });
    expect(answer.status).not.toBe(405);

    // Only that exact path is let through: another number format, another verb, a longer path.
    for (const path of ['/api/decisions/abc/answer', '/api/decisions/12/answer/', '/api/decisions/12/answers', '/api/decisions//answer', '/api/decisions/12/answer/x']) {
      const res = await app.request(path, { method: 'POST', headers: { host } });
      expect(res.status, `POST ${path}`).toBe(405);
    }
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const res = await app.request('/api/decisions/12/answer', { method, headers: { host } });
      expect(res.status, `${method} on the answer path`).toBe(405);
    }
  });

  it('adds the security headers to every answer, the refusals included', async () => {
    const { app, deps } = makeApp();
    const host = ownHost(deps.config);
    const answers = [
      await app.request('/api/health', { headers: { host } }),
      await app.request('/api/health', { headers: { host: 'evil.example' } }), // 403
      await app.request('/api/health', { method: 'POST', headers: { host } }), // 405
      await app.request('/api/nothing', { headers: { host } }), // 404
    ];
    expect(answers.map((r) => r.status)).toEqual([200, 403, 405, 404]);
    for (const res of answers) {
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      const csp = res.headers.get('content-security-policy') ?? '';
      // The page token is in the HTML, so a script the page did not ship must never run.
      expect(csp).toContain("default-src 'self'");
      expect(csp).toMatch(/script-src 'self'(?:;|$)/);
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'none'");
    }
    expect(answers[0]?.headers.get('cache-control')).toBe('no-store');
  });
});

describe('the API', () => {
  it('health returns name, version, gameUrl, githubRepo and links from the config', async () => {
    const config = makeTestConfig({
      gameUrl: 'http://localhost:4001',
      githubRepo: 'owner/name',
      links: [
        { label: 'One', url: 'http://localhost:4001/one' },
        { label: 'Two', url: 'https://example.test/two' },
      ],
    });
    const { app } = makeApp({ config, version: '1.2.3', startedAt: '2026-01-02T03:04:05.000Z' });
    const res = await getFrom(app, '/api/health', config);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({
      ok: true,
      name: 'Shadow Jog Command Center',
      version: '1.2.3',
      startedAt: '2026-01-02T03:04:05.000Z',
      gameUrl: 'http://localhost:4001',
      githubRepo: 'owner/name',
      links: [
        { label: 'One', url: 'http://localhost:4001/one' },
        { label: 'Two', url: 'https://example.test/two' },
      ],
    });
  });

  it('compose reads the version from package.json and stamps the start time', async () => {
    const config = makeTestConfig();
    const before = Date.now();
    const { app } = compose({ config, runner: noopRunner, webRoot: join(PACKAGE_DIR, 'src', 'web') });
    const health = (await (await getFrom(app, '/api/health', config)).json()) as { version: string; startedAt: string };
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')) as { version: string };
    expect(health.version).toBe(pkg.version);
    expect(Date.parse(health.startedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(health.startedAt)).toBeLessThanOrEqual(Date.now());
  });

  it('answers an unknown API path and an unknown server path with a JSON 404, not with the page', async () => {
    const { app, deps } = makeApp();
    for (const path of ['/api/nothing', '/api', '/api/', '/files/abc/x.png', '/assets/missing.js']) {
      const res = await getFrom(app, path, deps.config);
      expect(res.status, path).toBe(404);
      expect(res.headers.get('content-type'), path).toContain('application/json');
      expect(await res.json(), path).toMatchObject({ ok: false, error: { code: 'not-found' } });
    }
  });
});

describe('the page', () => {
  it('serves index.html for the root and for every page route, with this start’s token in <meta name="cc-token">', async () => {
    const { app, deps } = makeApp({ token: 'Tok_en-1234567890abcdefghijklmnopqrstuvwxyz' });
    for (const path of ['/', '/docs', '/docs/engine/decisions', '/docs/PHASE-0.2', '/decisions/12', '/agents', '/anything/else']) {
      const res = await getFrom(app, path, deps.config);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type'), path).toContain('text/html');
      expect(res.headers.get('cache-control'), path).toBe('no-store');
      const html = await res.text();
      expect(html, path).toContain('<meta name="cc-token" content="Tok_en-1234567890abcdefghijklmnopqrstuvwxyz">');
      expect(html, path).toContain('<title>Shadow Jog Command Center</title>');
    }
  });

  it('says the page is not built when there is no index.html, and still serves the API', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'cc-empty-web-'));
    try {
      const { app, deps } = makeApp({ webRoot: empty });
      const res = await getFrom(app, '/', deps.config);
      expect(res.status).toBe(503);
      expect(await res.text()).toContain('npm run cc');
      expect((await getFrom(app, '/api/health', deps.config)).status).toBe(200);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('turns an index.html without the token tag into a visible error, not a page that silently has no token', async () => {
    const broken = mkdtempSync(join(tmpdir(), 'cc-no-token-web-'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      writeFileSync(join(broken, 'index.html'), '<!doctype html><title>x</title><div id="root"></div>');
      const { app, deps } = makeApp({ webRoot: broken });
      const res = await getFrom(app, '/', deps.config);
      expect(res.status).toBe(500);
      expect(await res.json()).toMatchObject({ ok: false, error: { code: 'internal-error' } });
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
      rmSync(broken, { recursive: true, force: true });
    }
  });

  describe('built assets', () => {
    const web = mkdtempSync(join(tmpdir(), 'cc-assets-web-'));
    mkdirSync(join(web, 'assets'));
    writeFileSync(join(web, 'index.html'), '<meta name="cc-token" content=""><title>x</title>');
    writeFileSync(join(web, 'assets', 'index-abc123.js'), 'console.log(1);');
    writeFileSync(join(web, 'assets', 'index-abc123.css'), 'a{b:c}');
    writeFileSync(join(web, 'assets', 'geist-latin-wght-normal-xyz.woff2'), 'font');
    writeFileSync(join(web, 'assets', '.hidden'), 'secret');
    mkdirSync(join(web, 'assets', 'folder'));
    writeFileSync(join(web, 'secret.txt'), 'outside assets');
    afterAll(() => rmSync(web, { recursive: true, force: true }));

    it('serves a file of assets/ with its type and a long cache time', async () => {
      const { app, deps } = makeApp({ webRoot: web });
      const js = await getFrom(app, '/assets/index-abc123.js', deps.config);
      expect(js.status).toBe(200);
      expect(js.headers.get('content-type')).toContain('text/javascript');
      expect(js.headers.get('cache-control')).toContain('immutable');
      expect(await js.text()).toBe('console.log(1);');
      const css = await getFrom(app, '/assets/index-abc123.css', deps.config);
      expect(css.headers.get('content-type')).toContain('text/css');
      const font = await getFrom(app, '/assets/geist-latin-wght-normal-xyz.woff2', deps.config);
      expect(font.headers.get('content-type')).toBe('font/woff2');
    });

    it('answers 404 for an unknown name, a folder, a hidden file and every way to climb out of assets/', async () => {
      const { app, deps } = makeApp({ webRoot: web });
      // A plain ".." segment is folded away by the URL parser before a request reaches the router,
      // so these are the ways that can reach the handler: encoded separators, hidden names, folders, sub-paths.
      const paths = [
        '/assets/nope.js',
        '/assets/folder',
        '/assets/.hidden',
        '/assets/..%2Fsecret.txt',
        '/assets/%2e%2e%2Fsecret.txt',
        '/assets/..%5Csecret.txt',
        '/assets/sub/index-abc123.js',
        '/assets/',
      ];
      for (const path of paths) {
        const res = await getFrom(app, path, deps.config);
        expect(res.status, path).toBe(404);
        expect(await res.text(), path).not.toContain('outside assets');
      }
    });
  });
});
