import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACKAGE_DIR } from './helpers';

// The Vercel functions (step 3 of the plan) bundle src/github-api and everything it imports. This test walks the value-import graph of the adapter
// and fails if it reaches a module that reads files, starts a process, serves HTTP, or belongs to the local server's wiring. `import type` lines are
// erased by the compiler, so they are not edges. A text scan is enough: the imports of this package are plain static lines.

/** The imports that do not belong in a Vercel function: the file system, processes, the web server, the watcher, and the local server's own wiring. */
const FORBIDDEN_PACKAGES = [/^node:fs(\/|$)/, /^fs(\/|$)/, /^node:child_process$/, /^child_process$/, /^hono(\/|$)/, /^@hono\//, /^chokidar$/, /^minisearch$/, /^markdown-it$/, /^open$/, /^tsx(\/|$)/];
const FORBIDDEN_FILES = ['src/server/hub.ts', 'src/server/runner.ts', 'src/server/config.ts', 'src/server/docs/index.ts', 'src/server/app.ts', 'src/server/main.ts', 'src/server/compose.ts'];

/** `import ... from 'x'` and `export ... from 'x'` that are not type-only, plus `import 'x'`. An inline `import { type A }` counts as a value import (the safe reading). */
const VALUE_IMPORT = /(?:^|\n)[ \t]*(?:import|export)[ \t]+(?!type[ \t{])(?:([^'";]*?)[ \t\n]*from[ \t\n]*)?['"]([^'"]+)['"]/g;

function resolveFile(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(candidate)) return candidate;
  return null;
}

/** Every file and package reached from `entry` through value imports. */
function walk(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(VALUE_IMPORT)) {
      const specifier = match[2] as string;
      if (specifier.startsWith('.')) {
        const target = resolveFile(file, specifier);
        if (target === null) throw new Error(`${relative(PACKAGE_DIR, file)} imports ${specifier}, which does not resolve to a file`);
        queue.push(target);
      } else {
        packages.add(specifier);
      }
    }
  }
  return { files, packages };
}

function violations(entry: string): string[] {
  const { files, packages } = walk(entry);
  const rel = [...files].map((file) => relative(PACKAGE_DIR, file).split(sep).join('/'));
  return [...packages.values()].filter((name) => FORBIDDEN_PACKAGES.some((pattern) => pattern.test(name))).concat(rel.filter((file) => FORBIDDEN_FILES.includes(file)));
}

describe('the value-import graph of the GitHub API adapter', () => {
  it('reaches no file system, process, web server, hub, runner, config or docs index module', () => {
    const entry = join(PACKAGE_DIR, 'src', 'github-api', 'index.ts');
    const { files } = walk(entry);
    const rel = [...files].map((file) => relative(PACKAGE_DIR, file).split(sep).join('/'));
    // The walk really covers the shared parsers (a walk that stopped at the entry would pass for the wrong reason).
    expect(rel).toEqual(expect.arrayContaining(['src/github-api/fetch.ts', 'src/github-api/parse.ts', 'src/server/github/github.ts', 'src/server/github/ci.ts', 'src/server/decisions/parse.ts', 'src/shared/workstream.ts']));
    expect(violations(entry)).toEqual([]);
  });

  it('would catch a module that does (negative control)', () => {
    // The docs index reads files, uses hono and the watcher, and imports the config. (Its hub and runner imports are type-only, so they are no edges.)
    const found = violations(join(PACKAGE_DIR, 'src', 'server', 'docs', 'index.ts'));
    expect(found).toEqual(expect.arrayContaining(['node:fs', 'hono/utils/mime', 'minisearch', 'src/server/config.ts']));
  });
});
