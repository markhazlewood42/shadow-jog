import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { PACKAGE_DIR } from './helpers';

// The bundling proof for the Vercel functions (design.md section 11.3, step 3). esbuild (already in node_modules, as a dependency of tsx and vite) bundles each
// api file the way a Node function is bundled: every import is followed, node built-ins stay external. The test then reads the list of files that went in.
// It proves that the functions can bundle code from src/ and that nothing of the local server gets in. It does not prove how Vercel itself bundles (that is the first deploy).

const ENTRIES = [
  { name: 'snapshot', file: 'api/snapshot.ts' },
  { name: 'docs', file: 'api/docs/[...path].ts' },
  { name: 'live', file: 'api/live.ts' },
];

/** Packages and server modules that must never be in a function. */
const FORBIDDEN_PACKAGES = ['hono', '@hono', 'chokidar', 'minisearch', 'markdown-it', 'open', 'tsx', 'react', 'react-dom', 'react-router', 'vite'];
const FORBIDDEN_FILES = ['src/server/hub.ts', 'src/server/runner.ts', 'src/server/config.ts', 'src/server/app.ts', 'src/server/main.ts', 'src/server/compose.ts', 'src/server/docs/index.ts'];

async function bundle(file: string) {
  const result = await build({
    entryPoints: [join(PACKAGE_DIR, file)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  const inputs = Object.keys(result.metafile.inputs).map((input) => input.split('\\').join('/'));
  const code = result.outputFiles.map((output) => output.text).join('\n');
  // The packages that went in: the name after the last node_modules/ (scoped names keep the scope).
  const packages = new Set(
    inputs.flatMap((input) => {
      const match = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(input);
      return match?.[1] === undefined ? [] : [match[1]];
    }),
  );
  return { inputs, code, packages };
}

describe('bundling the functions with esbuild', () => {
  for (const { name, file } of ENTRIES) {
    it(`${file} bundles, with no local-server package or module in it`, async () => {
      const { inputs, code, packages } = await bundle(file);
      expect(code.length).toBeGreaterThan(500);
      expect(code).toContain('fetch');
      for (const forbidden of FORBIDDEN_PACKAGES) expect(packages.has(forbidden), `${name} bundles the package ${forbidden}`).toBe(false);
      for (const forbidden of FORBIDDEN_FILES) expect(inputs.some((input) => input.endsWith(forbidden)), `${name} bundles ${forbidden}`).toBe(false);
      // No import of those packages is left in the output either (an external import would fail at run time on Vercel).
      for (const forbidden of FORBIDDEN_PACKAGES) expect(code).not.toMatch(new RegExp(`(?:from|import|require\\()\\s*["']${forbidden}(?:["'/])`));
    });
  }

  it('snapshot.ts really bundles code from src/ (the adapter, its parsers and the shared validators)', async () => {
    const { inputs } = await bundle('api/snapshot.ts');
    for (const wanted of ['src/github-api/fetch.ts', 'src/github-api/parse.ts', 'src/shared/workstream.ts', 'src/server/decisions/parse.ts', 'src/server/github/github.ts', 'src/hosted/snapshot.ts', 'src/hosted/errors.ts']) {
      expect(
        inputs.some((input) => input.endsWith(wanted)),
        wanted,
      ).toBe(true);
    }
  });

  it('bundles the shared code from src/hosted/ into every function, and api/ holds only the three function files', async () => {
    for (const { file } of ENTRIES) expect((await bundle(file)).inputs.some((input) => input.endsWith('src/hosted/http.ts')), file).toBe(true);
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(dir, entry.name));
        else found.push(relative(PACKAGE_DIR, join(dir, entry.name)).split(sep).join('/'));
      }
    };
    walk(join(PACKAGE_DIR, 'api'));
    expect(found.sort()).toEqual(['api/docs/[...path].ts', 'api/live.ts', 'api/snapshot.ts']);
  });

  it('would notice a forbidden package (negative control: the docs index of the local server pulls in hono, minisearch and chokidar)', async () => {
    const { packages } = await bundle('src/server/docs/index.ts');
    for (const expected of ['hono', 'minisearch', 'chokidar']) expect(packages.has(expected), expected).toBe(true);
  });
});
