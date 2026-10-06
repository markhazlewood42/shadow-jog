import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACKAGE_DIR } from './helpers';

// The server may read files but never write one: its one write is a comment on a GitHub issue,
// made through `gh`. This test reads the server's source and fails when it imports a way to
// write, move or delete a file, or a way to start a process outside the runner.

const SERVER_DIR = join(PACKAGE_DIR, 'src', 'server');

/** Names in node:fs (and node:fs/promises) that change the disk. `open` is left out: it reads when it is given the flag "r". */
const FS_WRITERS = new Set([
  'writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream',
  'write', 'writeSync', 'writev', 'writevSync',
  'mkdir', 'mkdirSync', 'mkdtemp', 'mkdtempSync',
  'rm', 'rmSync', 'rmdir', 'rmdirSync', 'unlink', 'unlinkSync',
  'rename', 'renameSync', 'copyFile', 'copyFileSync', 'cp', 'cpSync',
  'truncate', 'truncateSync', 'ftruncate', 'ftruncateSync',
  'symlink', 'symlinkSync', 'link', 'linkSync',
  'chmod', 'chmodSync', 'chown', 'chownSync', 'lchmod', 'lchmodSync', 'lchown', 'lchownSync', 'fchmod', 'fchmodSync', 'fchown', 'fchownSync',
  'utimes', 'utimesSync', 'futimes', 'futimesSync', 'lutimes', 'lutimesSync',
]);

const FS_MODULE = String.raw`(?:node:)?fs(?:\/promises)?`;
const PROCESS_MODULE = String.raw`(?:node:)?(?:child_process|worker_threads|cluster)`;

/** The source without its comments, so a word in a comment is not mistaken for an import. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** What is wrong in one file's imports of the file system. An empty list means nothing. */
function findFsWriteImports(source: string): string[] {
  const code = stripComments(source);
  const problems: string[] = [];
  // import { a, b as c } from 'node:fs'   (also `import type`, which writes nothing)
  // The part between "import" and "from" holds no quote mark, so one match never runs on into the next import.
  for (const match of code.matchAll(new RegExp(String.raw`import\s+(type\s+)?([^;'"]*?)\s+from\s+['"]${FS_MODULE}['"]`, 'g'))) {
    const [, isType, clause = ''] = match;
    if (isType) continue;
    const named = clause.match(/\{([^}]*)\}/)?.[1];
    // A default or namespace import (import fs from, import * as fs from) hides which functions are used.
    if (/^\s*[\w$]+\s*(,|$)/.test(clause) || /\*\s*as\s/.test(clause)) problems.push(`imports the whole fs module (${clause.trim()}): import the functions it reads with by name`);
    for (const part of (named ?? '').split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]?.trim();
      if (name && FS_WRITERS.has(name)) problems.push(`imports ${name}`);
    }
  }
  // import('node:fs') and require('node:fs') hide the names too.
  if (new RegExp(String.raw`(?:import|require)\s*\(\s*['"]${FS_MODULE}['"]`).test(code)) problems.push('loads fs with import() or require()');
  return problems;
}

/** Where a file starts a process or a thread, outside the runner. */
function findProcessImports(source: string): string[] {
  const code = stripComments(source);
  const problems: string[] = [];
  if (new RegExp(String.raw`from\s+['"]${PROCESS_MODULE}['"]`).test(code)) problems.push('imports a way to start a process');
  if (new RegExp(String.raw`(?:import|require)\s*\(\s*['"]${PROCESS_MODULE}['"]`).test(code)) problems.push('loads a way to start a process with import() or require()');
  return problems;
}

/** Every .ts file under a folder, as [path relative to the package, source]. */
function sourcesUnder(dir: string): [string, string][] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => {
      const file = join(entry.parentPath, entry.name);
      return [relative(PACKAGE_DIR, file), readFileSync(file, 'utf8')] as [string, string];
    });
}

describe('the server source', () => {
  it('server source imports no fs write function (scan)', () => {
    const files = sourcesUnder(SERVER_DIR);
    expect(files.length).toBeGreaterThan(5); // the scan really found the server
    const found = files.flatMap(([file, source]) => findFsWriteImports(source).map((problem) => `${file}: ${problem}`));
    expect(found).toEqual([]);
  });

  it('server source starts processes only in runner.ts (scan)', () => {
    const found = sourcesUnder(SERVER_DIR)
      .filter(([file]) => !file.endsWith('runner.ts'))
      .flatMap(([file, source]) => findProcessImports(source).map((problem) => `${file}: ${problem}`));
    expect(found).toEqual([]);
  });

  describe('the scan itself', () => {
    it('flags the ways to write a file', () => {
      expect(findFsWriteImports("import { readFileSync, writeFileSync } from 'node:fs';")).toEqual(['imports writeFileSync']);
      expect(findFsWriteImports("import { rm as remove } from 'fs/promises';")).toEqual(['imports rm']);
      expect(findFsWriteImports("import { type Stats, mkdir } from 'node:fs/promises';")).toEqual(['imports mkdir']);
      expect(findFsWriteImports("import fs from 'node:fs';")).toHaveLength(1);
      expect(findFsWriteImports("import * as fs from 'node:fs';")).toHaveLength(1);
      expect(findFsWriteImports("const fs = await import('node:fs');")).toHaveLength(1);
      expect(findFsWriteImports("const fs = require('fs');")).toHaveLength(1);
    });

    it('lets the read functions through, and ignores comments and type imports', () => {
      expect(findFsWriteImports("import { readFile, readdir, stat, open } from 'node:fs/promises';")).toEqual([]);
      expect(findFsWriteImports("import { existsSync, readFileSync } from 'node:fs';")).toEqual([]);
      expect(findFsWriteImports("import type { Stats } from 'node:fs';")).toEqual([]);
      expect(findFsWriteImports("// import { writeFileSync } from 'node:fs';\nimport { readFileSync } from 'node:fs';")).toEqual([]);
      expect(findFsWriteImports("/* import { rmSync } from 'node:fs'; */")).toEqual([]);
      expect(findFsWriteImports("import { join } from 'node:path';")).toEqual([]);
    });

    it('flags a process import and lets the rest through', () => {
      expect(findProcessImports("import { execFile } from 'node:child_process';")).toHaveLength(1);
      expect(findProcessImports("import cp from 'child_process';")).toHaveLength(1);
      expect(findProcessImports("const cp = await import('node:child_process');")).toHaveLength(1);
      expect(findProcessImports("import { join } from 'node:path';")).toEqual([]);
    });
  });
});
