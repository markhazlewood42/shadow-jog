import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocPath } from '../src/hosted/doc-path';
import { readGithubToken, readUpstash } from '../src/hosted/env';
import { mapAdapterError } from '../src/hosted/errors';
import { CACHE, errorResponse, jsonResponse, methodNotAllowed } from '../src/hosted/http';
import { changedFromDiffStatus, decide, exitCodeOf } from '../scripts/vercel-ignore.mjs';
import { PACKAGE_DIR } from './helpers';
import { RO_TOKEN, RW_TOKEN, TOKEN, UPSTASH_URL, request } from './vercel-helpers';

// The pure helpers of the Vercel functions (src/hosted), the allow-list for doc paths, the ignore script's decision and vercel.json.

describe('env', () => {
  it('reads the GitHub token, and treats empty or blank as missing', () => {
    expect(readGithubToken({ GITHUB_TOKEN: TOKEN })).toBe(TOKEN);
    expect(readGithubToken({ GITHUB_TOKEN: '  ' })).toBeNull();
    expect(readGithubToken({})).toBeNull();
  });

  it('reads the Upstash URL and the read-only token', () => {
    expect(readUpstash({ KV_REST_API_URL: UPSTASH_URL, KV_REST_API_READ_ONLY_TOKEN: RO_TOKEN })).toEqual({ ok: true, url: UPSTASH_URL, token: RO_TOKEN });
  });

  it.each([
    ['no URL', { KV_REST_API_READ_ONLY_TOKEN: RO_TOKEN }, 'not-configured'],
    ['no token', { KV_REST_API_URL: UPSTASH_URL }, 'not-configured'],
    ['an http URL', { KV_REST_API_URL: 'http://example-store.upstash.io', KV_REST_API_READ_ONLY_TOKEN: RO_TOKEN }, 'misconfigured'],
    ['a URL that is not a URL', { KV_REST_API_URL: 'nope', KV_REST_API_READ_ONLY_TOKEN: RO_TOKEN }, 'misconfigured'],
    ['the read-write variable', { KV_REST_API_URL: UPSTASH_URL, KV_REST_API_READ_ONLY_TOKEN: RO_TOKEN, KV_REST_API_TOKEN: RW_TOKEN }, 'misconfigured'],
    ['the read-write variable, empty', { KV_REST_API_URL: UPSTASH_URL, KV_REST_API_READ_ONLY_TOKEN: RO_TOKEN, KV_REST_API_TOKEN: '' }, 'misconfigured'],
    ['UPSTASH_REDIS_REST_TOKEN', { KV_REST_API_URL: UPSTASH_URL, KV_REST_API_READ_ONLY_TOKEN: RO_TOKEN, UPSTASH_REDIS_REST_TOKEN: RW_TOKEN }, 'misconfigured'],
    ['UPSTASH_REDIS_REST_TOKEN, empty', { KV_REST_API_URL: UPSTASH_URL, KV_REST_API_READ_ONLY_TOKEN: RO_TOKEN, UPSTASH_REDIS_REST_TOKEN: '' }, 'misconfigured'],
  ])('refuses %s', (_name, env, reason) => {
    const result = readUpstash(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(reason);
  });

  it('names the variable that tripped the read-write guard, never its value', () => {
    for (const name of ['KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN']) {
      const result = readUpstash({ KV_REST_API_URL: UPSTASH_URL, KV_REST_API_READ_ONLY_TOKEN: RO_TOKEN, [name]: RW_TOKEN });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).toContain(name);
      expect(JSON.stringify(result)).not.toContain(RW_TOKEN);
    }
  });

  it('does not trip the read-write guard on the read-only variable or a similar name', () => {
    expect(readUpstash({ KV_REST_API_URL: UPSTASH_URL, KV_REST_API_READ_ONLY_TOKEN: RO_TOKEN }).ok).toBe(true);
    expect(readUpstash({ KV_REST_API_URL: UPSTASH_URL, KV_REST_API_READ_ONLY_TOKEN: RO_TOKEN, UPSTASH_REDIS_REST_READ_ONLY_TOKEN: RO_TOKEN }).ok).toBe(true);
  });
});

describe('http', () => {
  it('sets the JSON, cache and nosniff headers', () => {
    const response = jsonResponse({ a: 1 }, 200, CACHE.snapshot);
    expect(response.headers.get('Cache-Control')).toBe('s-maxage=15, stale-while-revalidate');
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('never caches an error', async () => {
    const response = errorResponse(502, 'x', 'y');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'x', kind: 'y' });
  });

  it('allows GET and HEAD only', () => {
    expect(methodNotAllowed(request('/api/live'))).toBeNull();
    expect(methodNotAllowed(request('/api/live', { method: 'HEAD' }))).toBeNull();
    expect(methodNotAllowed(request('/api/live', { method: 'POST', body: 'x' }))?.status).toBe(405);
    expect(methodNotAllowed(request('/api/live', { method: 'DELETE' }))?.headers.get('Allow')).toBe('GET, HEAD');
  });
});

describe('error mapping', () => {
  it.each([
    [{ code: 'rate-limited' as const, retryAfter: 42 }, 503, 'rate-limited', 42],
    [{ code: 'rate-limited' as const }, 503, 'rate-limited', 60],
    [{ code: 'rate-limited' as const, retryAfter: 0 }, 503, 'rate-limited', 1],
    [{ code: 'rate-limited' as const, retryAfter: 99999 }, 503, 'rate-limited', 3600],
    [{ code: 'rate-limited' as const, retryAfter: 1.2 }, 503, 'rate-limited', 2],
    [{ code: 'unauthorized' as const }, 502, 'unauthorized', undefined],
    [{ code: 'network' as const }, 504, 'network', undefined],
    [{ code: 'http-error' as const }, 502, 'http-error', undefined],
    [{ code: 'bad-response' as const }, 502, 'bad-response', undefined],
    [{ code: 'graphql-error' as const }, 502, 'graphql-error', undefined],
  ])('maps %j', (error, status, kind, retryAfter) => {
    const map = mapAdapterError(error);
    expect(map.status).toBe(status);
    expect(map.kind).toBe(kind);
    expect(map.retryAfter).toBe(retryAfter);
  });
});

describe('the allow-list for doc paths', () => {
  it.each([
    ['/api/docs/docs/GDD.md', 'docs/GDD.md', 'markdown'],
    ['/api/docs/docs/engine/decisions.md', 'docs/engine/decisions.md', 'markdown'],
    ['/api/docs/docs/engine/diagrams/engine-frame.png', 'docs/engine/diagrams/engine-frame.png', 'png'],
    ['/api/docs/docs/diagrams/battle-round.png', 'docs/diagrams/battle-round.png', 'png'],
    ['/api/docs/docs/roadmap/roadmap.svg', 'docs/roadmap/roadmap.svg', 'svg'],
    ['/api/docs/status.md', 'status.md', 'markdown'],
    ['/api/docs/CHANGELOG.md', 'CHANGELOG.md', 'markdown'],
    ['/api/docs/README.md', 'README.md', 'markdown'],
    ['/api/docs/CLAUDE.md', 'CLAUDE.md', 'markdown'],
    ['/api/docs/docs/workstreams/workstream-contract.md', 'docs/workstreams/workstream-contract.md', 'markdown'],
  ])('accepts %s', (pathname, path, type) => {
    expect(parseDocPath(pathname)).toEqual({ ok: true, path, type });
  });

  // Each hostile path, the answer it must get, and why.
  const HOSTILE: [string, 400 | 404, string][] = [
    ['/api/docs/../CLAUDE.md', 400, 'dot segments'],
    ['/api/docs/docs/../../CLAUDE.md', 400, 'dot segments'],
    ['/api/docs/docs/./GDD.md', 400, 'dot segment'],
    ['/api/docs/..', 400, 'only dots'],
    ['/api/docs/%2e%2e/CLAUDE.md', 400, 'encoded dots'],
    ['/api/docs/%2E%2E/CLAUDE.md', 400, 'encoded dots, upper case'],
    ['/api/docs/docs/%2e%2e/%2e%2e/CLAUDE.md', 400, 'encoded dots deep'],
    ['/api/docs/docs%2fGDD.md', 400, 'encoded slash'],
    ['/api/docs/docs%2FGDD.md', 400, 'encoded slash, upper case'],
    ['/api/docs/docs%5cGDD.md', 400, 'encoded backslash'],
    ['/api/docs/docs\\GDD.md', 400, 'backslash'],
    ['/api/docs/docs\\..\\CLAUDE.md', 400, 'backslash traversal'],
    ['/api/docs/docs/GDD.md%00.png', 400, 'encoded null byte before an allowed extension'],
    ['/api/docs/docs/GDD.md\0.png', 400, 'null byte'],
    ['/api/docs/docs/GDD.md%00', 400, 'trailing encoded null byte'],
    ['/api/docs/%252e%252e/CLAUDE.md', 400, 'double encoding'],
    ['/api/docs/docs/GDD%2emd', 400, 'encoded dot in the extension'],
    ['/api/docs//etc/passwd', 400, 'absolute path'],
    ['/api/docs//CLAUDE.md', 400, 'double slash'],
    ['/api/docs/C:/Windows/win.ini', 400, 'drive letter'],
    ['/api/docs/docs/', 400, 'trailing slash'],
    ['/api/docs/docs//GDD.md', 400, 'empty part'],
    ['/api/docs/', 400, 'empty path'],
    ['/api/docs', 400, 'no path at all'],
    ['/api/docs/docs/.hidden.md', 400, 'hidden file'],
    ['/api/docs/.env', 400, 'hidden file at the root'],
    ['/api/docs/docs/.git/config', 400, 'hidden folder'],
    ['/api/docs/docs/a b.md', 400, 'a space'],
    ['/api/docs/docs/GDD.md%20', 400, 'encoded space'],
    ['/api/docs/docs/GDD.md?ref=other', 400, 'a question mark inside the path text'],
    ['/api/docs/docs/GDD.md#x', 400, 'a hash inside the path text'],
    ['/api/docs/docs/a..b.md', 400, 'two dots in a name'],
    ['/api/other/docs/GDD.md', 400, 'wrong prefix'],
    ['/api/docs/package.json', 404, 'a root file that is not markdown'],
    ['/api/docs/.github/workflows/ci.yml', 400, 'hidden folder, yaml'],
    ['/api/docs/src/engine/game.ts', 404, 'source code'],
    ['/api/docs/tools/command-center/README.md', 404, 'markdown outside docs/'],
    ['/api/docs/knowledge/index.md', 404, 'markdown outside docs/ (folder)'],
    ['/api/docs/node_modules/x/README.md', 404, 'markdown outside docs/ (node_modules)'],
    ['/api/docs/docs/GDD.txt', 404, 'wrong extension'],
    ['/api/docs/docs/art.gif', 404, 'gif is not in the list'],
    ['/api/docs/docs/page.html', 404, 'html is not in the list'],
    ['/api/docs/docs/photo.jpg', 404, 'jpg is not in the list'],
    ['/api/docs/docs/GDD.MD', 404, 'upper-case extension'],
    ['/api/docs/status.png', 404, 'png at the root'],
    ['/api/docs/public/art/crew/a.png', 404, 'png outside docs/'],
    ['/api/docs/Docs/GDD.md', 404, 'folder name with other case'],
    ['/api/docs/docs', 404, 'a bare folder name'],
  ];

  it.each(HOSTILE)('refuses %s with %i (%s)', (pathname, status) => {
    const result = parseDocPath(pathname);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(status);
  });

  it('serves svg only under docs/, and no other picture or script type', () => {
    for (const pathname of ['/api/docs/logo.svg', '/api/docs/public/art/a.svg', '/api/docs/docs/a.svgz', '/api/docs/docs/a.gif', '/api/docs/docs/a.jpg', '/api/docs/docs/a.html', '/api/docs/docs/a.js']) {
      expect(parseDocPath(pathname), pathname).toMatchObject({ ok: false, status: 404 });
    }
    expect(parseDocPath('/api/docs/docs/../a.svg')).toMatchObject({ ok: false, status: 400 });
    expect(parseDocPath('/api/docs/docs/%2e%2e/a.svg')).toMatchObject({ ok: false, status: 400 });
  });

  it('reaches only a path that is a plain relative path under the repo (every accepted path has no dot, no empty part)', () => {
    for (const path of ['docs/a.md', 'docs/a/b/c.md', 'x.md', 'docs/a/b.png']) {
      const result = parseDocPath(`/api/docs/${path}`);
      expect(result.ok && result.path).toBe(path);
    }
  });
});

describe('the ignore decision (scripts/vercel-ignore.mjs)', () => {
  it.each([
    ['main with a change', { branch: 'main', changed: true }, true],
    ['main with no change', { branch: 'main', changed: false }, false],
    ['main with an unknown change builds, to be safe', { branch: 'main', changed: null }, true],
    ['a feature branch with a change', { branch: 'vercel-functions', changed: true }, false],
    ['a feature branch with no change', { branch: 'vercel-functions', changed: false }, false],
    ['a branch that only contains the word main', { branch: 'main-fix', changed: true }, false],
    ['another case of main', { branch: 'Main', changed: true }, false],
    ['a missing branch', { branch: undefined, changed: true }, false],
    ['an empty branch', { branch: '', changed: true }, false],
  ])('%s', (_name, input, build) => {
    const decision = decide(input);
    expect(decision.build).toBe(build);
    // Vercel: exit 0 skips the build, exit 1 runs it.
    expect(exitCodeOf(decision)).toBe(build ? 1 : 0);
    expect(decision.reason.length).toBeGreaterThan(0);
  });

  it('reads the exit status of git diff --quiet: 0 same, 1 changed, anything else unknown', () => {
    expect(changedFromDiffStatus(0)).toBe(false);
    expect(changedFromDiffStatus(1)).toBe(true);
    expect(changedFromDiffStatus(128)).toBeNull();
    expect(changedFromDiffStatus(null)).toBeNull();
  });
});

describe('vercel.json', () => {
  const text = readFileSync(join(PACKAGE_DIR, 'vercel.json'), 'utf8');
  const config = JSON.parse(text) as {
    framework: string;
    buildCommand: string;
    outputDirectory: string;
    ignoreCommand: string;
    git: { deploymentEnabled: Record<string, boolean> };
    functions: Record<string, { maxDuration: number } | undefined>;
    rewrites: { source: string; destination: string }[];
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };

  it('builds the page with vite into the folder that the vite config writes', () => {
    expect(config.framework).toBe('vite');
    expect(config.outputDirectory).toBe('dist');
    expect(readFileSync(join(PACKAGE_DIR, 'vite.config.ts'), 'utf8')).toContain("join(import.meta.dirname, 'dist')");
  });

  it('deploys only from main: no other branch makes a deployment (the Hobby plan allows 100 a day across all projects)', () => {
    expect(config.git.deploymentEnabled).toEqual({ '**': false, main: true });
  });

  it('runs the ignore script, which exists', () => {
    expect(config.ignoreCommand).toBe('node scripts/vercel-ignore.mjs');
    expect(existsSync(join(PACKAGE_DIR, 'scripts', 'vercel-ignore.mjs'))).toBe(true);
  });

  it('builds only the page: the function files are committed, because Vercel finds functions before the build', () => {
    // VITE_HOSTED=1 builds the hosted page (src/web/hosted): it polls /api/snapshot and /api/live. Without it the page would look for the local server, which Vercel does not run.
    expect(config.buildCommand).toBe('VITE_HOSTED=1 vite build');
    expect(existsSync(join(PACKAGE_DIR, 'scripts', 'build-functions.mjs'))).toBe(true);
  });

  it('sets maxDuration 30 for the committed function files in api/, whose sources are in functions/', () => {
    // The sources are in functions/ (a folder Vercel does not look at). api/ holds the files that scripts/build-functions.mjs writes, and they are tracked by git.
    for (const name of ['snapshot', 'live', 'docs']) expect(existsSync(join(PACKAGE_DIR, 'functions', `${name}.ts`)), name).toBe(true);
    expect(Object.keys(config.functions)).toEqual(['api/*.js']);
    expect(config.functions['api/*.js']?.maxDuration).toBe(30);
    for (const name of ['snapshot', 'live', 'docs']) expect(existsSync(join(PACKAGE_DIR, 'api', `${name}.js`)), name).toBe(true);
    // The pattern of vercel.json must match real files in the uploaded source, so the files must not be git-ignored.
    expect(readFileSync(join(PACKAGE_DIR, '..', '..', '.gitignore'), 'utf8')).not.toMatch(/command-center\/api|api\/\*\.js/);
  });

  it('rewrites /api/docs/<path> to the docs function with the path as a query parameter, before the page rewrite', () => {
    expect(config.rewrites).toHaveLength(2);
    expect(config.rewrites[0]).toEqual({ source: '/api/docs/:path*', destination: '/api/docs?path=:path*' });
    expect(config.rewrites[1]?.destination).toBe('/index.html');
  });

  it('sends no /api path to the page, and every other path to it', () => {
    const rule = config.rewrites.find((candidate) => candidate.destination === '/index.html');
    expect(rule).toBeDefined();
    // The source is a path-to-regexp pattern with one regex group. As a plain regex it is the same text.
    const regex = new RegExp(`^${rule?.source}$`);
    for (const api of ['/api', '/api/', '/api/snapshot', '/api/live', '/api/docs', '/api/docs/docs/GDD.md', '/api/answer', '/api/anything/else']) expect(regex.test(api), api).toBe(false);
    for (const page of ['/', '/docs', '/docs/engine/decisions', '/workstreams', '/apis', '/apidocs/x']) expect(regex.test(page), page).toBe(true);
  });

  // The hosted page loads its script, styles, fonts and data from its own origin only (it links to github.com but loads nothing from there), and it is not meant to be framed.
  it('sets a Content-Security-Policy on every path: own origin only, no inline script, and no framing', () => {
    const rule = config.headers.find((candidate) => candidate.source === '/(.*)');
    const csp = rule?.headers.find((header) => header.key === 'Content-Security-Policy')?.value ?? '';
    const directives = new Map(csp.split(';').map((part) => part.trim().split(/\s+/)).map(([name, ...values]) => [name, values.join(' ')]));
    expect(directives.get('frame-ancestors')).toBe("'none'");
    expect(directives.get('default-src')).toBe("'self'");
    expect(directives.get('script-src')).toBe("'self'");
    expect(directives.get('connect-src')).toBe("'self'");
    expect(directives.get('font-src')).toBe("'self'");
    expect(directives.get('object-src')).toBe("'none'");
    expect(directives.get('base-uri')).toBe("'none'");
    expect(directives.get('form-action')).toBe("'none'");
    // Inline styles are allowed (React and the UI library set style attributes), inline scripts and eval never.
    expect(directives.get('style-src')).toBe("'self' 'unsafe-inline'");
    expect(csp).not.toMatch(/unsafe-eval|https?:|\*/);
  });

  it('holds no secret and no environment values', () => {
    expect(Object.keys(config)).not.toContain('env');
    expect(Object.keys(config)).not.toContain('build');
    for (const secret of [TOKEN, RO_TOKEN, RW_TOKEN]) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/ghp_|github_pat_|Bearer |upstash\.io/i);
  });
});
