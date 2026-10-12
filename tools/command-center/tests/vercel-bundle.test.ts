import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildFunctions } from '../scripts/build-functions.mjs';
import { PACKAGE_DIR } from './helpers';

// The proof for the Vercel functions (design.md section 11.3, step 3). The first deploy failed with ERR_MODULE_NOT_FOUND: Vercel compiled each api/*.ts on its own,
// and our extensionless relative imports (package.json says "type": "module") did not resolve. So the functions are now built by scripts/build-functions.mjs into
// ONE file each with every import inlined. This test runs that real script into a temp folder and then
//   1. reads the bundles: nothing of the local server in them, no relative import left, only node: built-ins imported;
//   2. IMPORTS each built file in a plain Node ESM process (no vitest, no vite) and calls its default export `fetch`.
// Step 2 is the check that would have caught the failure. It does not prove how Vercel itself runs a function (that is the first deploy).

const NAMES = ['snapshot', 'live', 'docs'] as const;

/** Packages and server modules that must never be in a function. */
const FORBIDDEN_PACKAGES = ['hono', '@hono', 'chokidar', 'minisearch', 'markdown-it', 'open', 'tsx', 'react', 'react-dom', 'react-router', 'vite'];
const FORBIDDEN_FILES = ['src/server/hub.ts', 'src/server/runner.ts', 'src/server/config.ts', 'src/server/app.ts', 'src/server/main.ts', 'src/server/compose.ts', 'src/server/docs/index.ts'];

/**
 * The files that went into a bundle. esbuild writes a comment line `// <path>` above each module it inlines (the paths are relative to the package).
 * A text scan of the output is enough, and it checks the file that is really built, not a second bundling.
 */
const inlinedPaths = (code: string): string[] => [...code.matchAll(/^\/\/ (\S+\.(?:ts|tsx|js|mjs|cjs|json))$/gm)].map((match) => (match[1] as string).split('\\').join('/'));

/** What is wrong with a bundle: a forbidden package or file inlined, a relative import left, or an import of anything that is not a node: built-in. */
function problemsIn(code: string): string[] {
  const problems: string[] = [];
  for (const path of inlinedPaths(code)) {
    for (const name of FORBIDDEN_PACKAGES) if (new RegExp(`node_modules/${name}/`).test(path)) problems.push(`inlines the package ${name} (${path})`);
    for (const file of FORBIDDEN_FILES) if (path.endsWith(file)) problems.push(`inlines ${file}`);
  }
  // Every import statement, static or dynamic, and every require. A relative one would be resolved by Node at run time, from /var/task: that is the failure.
  const specifiers = [...code.matchAll(/(?:\bfrom|\bimport|\brequire)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1] as string);
  for (const specifier of specifiers) {
    if (specifier.startsWith('.')) problems.push(`relative import ${specifier}`);
    else if (!specifier.startsWith('node:')) problems.push(`import of ${specifier}, which is not a node: built-in`);
  }
  return problems;
}

let outDir = '';
const code = (name: string): string => readFileSync(join(outDir, `${name}.js`), 'utf8');

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'cc-functions-'));
  // The folder of the real api/ sits in a package with "type": "module". The temp folder needs the same, or Node reads the .js files as CommonJS.
  writeFileSync(join(outDir, 'package.json'), JSON.stringify({ type: 'module' }));
  await buildFunctions({ outDir });
}, 60_000);

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

describe('the build script', () => {
  it('writes exactly one file for each function', () => {
    expect(readdirSync(outDir).filter((file) => file.endsWith('.js')).sort()).toEqual(['docs.js', 'live.js', 'snapshot.js']);
  });

  it('builds into the folder it is given, and the real api/ folder holds no source file', () => {
    // Sources live in functions/. Vercel treats every file in api/ as a function, so api/ must hold nothing but generated .js files.
    const apiDir = join(PACKAGE_DIR, 'api');
    const files = existsSync(apiDir) ? readdirSync(apiDir, { recursive: true }).map(String) : [];
    expect(files.filter((file) => !file.endsWith('.js'))).toEqual([]);
    for (const name of NAMES) expect(readFileSync(join(PACKAGE_DIR, 'functions', `${name}.ts`), 'utf8')).toContain('export default');
  });
});

describe('the built bundles', () => {
  for (const name of NAMES) {
    it(`${name}.js has no local-server package or module, no relative import, and only node: imports`, () => {
      const text = code(name);
      expect(text.length).toBeGreaterThan(1000);
      expect(problemsIn(text)).toEqual([]);
      // The bundle really holds the code of src/: the shared helpers, and (for the snapshot) the adapter with its parsers.
      expect(inlinedPaths(text).some((path) => path.endsWith('src/hosted/http.ts')), 'src/hosted/http.ts').toBe(true);
    });
  }

  it('snapshot.js holds the adapter, its parsers and the shared validators', () => {
    const paths = inlinedPaths(code('snapshot'));
    for (const wanted of ['src/github-api/fetch.ts', 'src/github-api/parse.ts', 'src/shared/workstream.ts', 'src/server/decisions/parse.ts', 'src/server/github/github.ts', 'src/hosted/snapshot.ts', 'src/hosted/errors.ts']) {
      expect(
        paths.some((path) => path.endsWith(wanted)),
        wanted,
      ).toBe(true);
    }
  });

  it('the checker would notice what it is meant to find (negative controls)', () => {
    expect(problemsIn('// ../../node_modules/hono/dist/hono.js\nexport default 1;')).toEqual(['inlines the package hono (../../node_modules/hono/dist/hono.js)']);
    expect(problemsIn('// src/server/hub.ts\nexport default 1;')).toEqual(['inlines src/server/hub.ts']);
    expect(problemsIn('import { handleDocs } from "../src/hosted/docs";')).toEqual(['relative import ../src/hosted/docs']);
    expect(problemsIn("import x from './a.js';")).toEqual(['relative import ./a.js']);
    expect(problemsIn('const m = await import("./a.js");')).toEqual(['relative import ./a.js']);
    expect(problemsIn('import { app } from "hono";')).toEqual(['import of hono, which is not a node: built-in']);
    expect(problemsIn('import { readFileSync } from "node:fs";')).toEqual([]);
  });

  it('esbuild bundling the docs index of the local server does inline hono, minisearch and chokidar (so the paths in the comments are a real signal)', async () => {
    const result = await build({ entryPoints: [join(PACKAGE_DIR, 'src/server/docs/index.ts')], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
    const problems = problemsIn(result.outputFiles.map((file) => file.text).join('\n'));
    expect(problems.some((problem) => problem.includes('hono'))).toBe(true);
    expect(problems.some((problem) => problem.includes('minisearch'))).toBe(true);
    expect(problems.some((problem) => problem.includes('chokidar'))).toBe(true);
  });
});

/**
 * Imports a file in a plain Node process (ESM, no vitest, no vite, no loader), sets a stub `fetch`, calls `default.fetch(new Request(url))` and prints the status
 * and the body as JSON. The child gets no GITHUB_TOKEN and no KV_ variable unless the test passes them.
 */
function runInNode(file: string, url: string, env: Record<string, string> = {}, stubReply?: { status: number; body: string; contentType: string }): { status: number; body: string } {
  const script = `
    const stub = ${JSON.stringify(stubReply ?? null)};
    if (stub) globalThis.fetch = async () => new Response(stub.body, { status: stub.status, headers: { 'content-type': stub.contentType } });
    const mod = await import(${JSON.stringify(pathToFileURL(file).href)});
    const response = await mod.default.fetch(new Request(${JSON.stringify(url)}));
    console.log(JSON.stringify({ status: response.status, body: await response.text() }));
  `;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  });
  return JSON.parse(output.trim().split('\n').at(-1) as string) as { status: number; body: string };
}

describe('running the built files in plain Node ESM (the check that would have caught the first deploy)', () => {
  const NOT_CONFIGURED = { error: 'not configured', kind: 'not-configured' };

  it('snapshot.js: with no environment it answers 500 not configured', () => {
    const result = runInNode(join(outDir, 'snapshot.js'), 'https://cc.example/api/snapshot');
    expect(result.status).toBe(500);
    expect(JSON.parse(result.body)).toEqual(NOT_CONFIGURED);
  });

  it('live.js: with no environment it answers 500 not configured', () => {
    const result = runInNode(join(outDir, 'live.js'), 'https://cc.example/api/live');
    expect(result.status).toBe(500);
    expect(JSON.parse(result.body)).toEqual(NOT_CONFIGURED);
  });

  it('docs.js: with no environment it answers 500 not configured for a good path, and 400 for a hostile one', () => {
    expect(runInNode(join(outDir, 'docs.js'), 'https://cc.example/api/docs?path=docs/GDD.md').status).toBe(500);
    expect(runInNode(join(outDir, 'docs.js'), 'https://cc.example/api/docs?path=../CLAUDE.md').status).toBe(400);
  });

  it('snapshot.js: runs the bundled adapter against a stub GitHub (an error reply maps to 502)', () => {
    const result = runInNode(join(outDir, 'snapshot.js'), 'https://cc.example/api/snapshot', { GITHUB_TOKEN: 'ghp_stub_not_a_real_token' }, { status: 200, contentType: 'application/json', body: JSON.stringify({ errors: [{ type: 'X', message: 'm' }] }) });
    expect(result.status).toBe(502);
    expect(JSON.parse(result.body)).toEqual({ error: 'GitHub reported an error', kind: 'graphql-error' });
    expect(result.body).not.toContain('ghp_stub_not_a_real_token');
  });

  it('docs.js: serves a doc from a stub GitHub, with the path from the query parameter', () => {
    const result = runInNode(join(outDir, 'docs.js'), 'https://cc.example/api/docs?path=docs/GDD.md', { GITHUB_TOKEN: 'ghp_stub_not_a_real_token' }, { status: 200, contentType: 'application/vnd.github.raw+json; charset=utf-8', body: '# GDD' });
    expect(result).toEqual({ status: 200, body: '# GDD' });
  });

  it('live.js: reads a stub Upstash with the read-only token and computes the reporter state', () => {
    const stored = JSON.stringify({ writtenAt: new Date().toISOString(), sessions: [] });
    const result = runInNode(
      join(outDir, 'live.js'),
      'https://cc.example/api/live',
      { KV_REST_API_URL: 'https://stub.upstash.io', KV_REST_API_READ_ONLY_TOKEN: 'ro_stub_not_a_real_token' },
      { status: 200, contentType: 'application/json', body: JSON.stringify({ result: stored }) },
    );
    expect(result.status).toBe(200);
    expect((JSON.parse(result.body) as { reporter: { state: string } }).reporter.state).toBe('online');
  });

  it('negative control: the TypeScript source, imported in plain Node, fails the way the first deploy failed', () => {
    // functions/snapshot.ts has extensionless relative imports. Node (type stripping) cannot resolve them: ERR_MODULE_NOT_FOUND.
    let message = '';
    try {
      runInNode(join(PACKAGE_DIR, 'functions', 'snapshot.ts'), 'https://cc.example/api/snapshot');
    } catch (error) {
      message = String((error as { stderr?: string }).stderr ?? error);
    }
    expect(message).toContain('ERR_MODULE_NOT_FOUND');
  });
});
