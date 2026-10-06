import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACKAGE_DIR } from './helpers';

// The server may read files but never write one: its one write is a comment on a GitHub issue,
// made through `gh`. These tests read the server's source and fail when it imports a way to
// write, move or delete a file (from node:fs or node:fs/promises), or to start a process outside
// the runner. A scan of text cannot be perfect, so it errs on the side of refusing: a file that
// the scan cannot read with certainty is reported, and the fix is to write it the plain way.

const SERVER_DIR = join(PACKAGE_DIR, 'src', 'server');

/**
 * Every name that node:fs and node:fs/promises export and that changes the disk, or that hands
 * out something that does. `promises` is here because it is the whole node:fs/promises module under
 * one name (`promises.writeFile`). The names of the promise functions are the same as the
 * callback and sync ones, so one list covers `fs`, `fs.promises` and `fs/promises`.
 */
const FS_WRITERS = new Set([
  'promises', 'WriteStream', 'FileWriteStream', 'Utf8Stream', 'createWriteStream',
  'writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'write', 'writeSync', 'writev', 'writevSync',
  'mkdir', 'mkdirSync', 'mkdtemp', 'mkdtempSync', 'mkdtempDisposable', 'mkdtempDisposableSync',
  'rm', 'rmSync', 'rmdir', 'rmdirSync', 'unlink', 'unlinkSync',
  'rename', 'renameSync', 'copyFile', 'copyFileSync', 'cp', 'cpSync',
  'truncate', 'truncateSync', 'ftruncate', 'ftruncateSync', 'fsync', 'fsyncSync', 'fdatasync', 'fdatasyncSync',
  'symlink', 'symlinkSync', 'link', 'linkSync',
  'chmod', 'chmodSync', 'chown', 'chownSync', 'lchmod', 'lchmodSync', 'lchown', 'lchownSync', 'fchmod', 'fchmodSync', 'fchown', 'fchownSync',
  'utimes', 'utimesSync', 'futimes', 'futimesSync', 'lutimes', 'lutimesSync',
]);

/** Every other name they export: reads, watching, closing a file, and the classes and constants that only describe things. */
const FS_READERS = new Set([
  'Dir', 'Dirent', 'FileReadStream', 'ReadStream', 'Stats', 'constants', '_toUnixTimestamp',
  'access', 'accessSync', 'exists', 'existsSync', 'stat', 'statSync', 'lstat', 'lstatSync', 'fstat', 'fstatSync', 'statfs', 'statfsSync',
  'readFile', 'readFileSync', 'read', 'readSync', 'readv', 'readvSync', 'createReadStream', 'openAsBlob',
  'readdir', 'readdirSync', 'opendir', 'opendirSync', 'glob', 'globSync', 'readlink', 'readlinkSync', 'realpath', 'realpathSync',
  'watch', 'watchFile', 'unwatchFile', 'close', 'closeSync',
]);

/** open and openSync read when their flag is "r" and write with any other: the scan checks the flag at every call. */
const FS_OPEN = new Set(['open', 'openSync']);

/** The flags that open a file for reading only ("rs" and "sr" are "r" in synchronous mode). */
const READ_ONLY_FLAG = /^(['"`])(?:r|rs|sr)\1$/;

const FS_SPECIFIER = String.raw`(?:node:)?fs(?:\/promises)?`;
const PROCESS_SPECIFIER = String.raw`(?:node:)?(?:child_process|worker_threads|cluster)`;

/** `import ... from 'fs'` and `export ... from 'fs'` (type-only ones included; the scan skips those). The clause has only names, braces, commas and stars, so one match never runs on into the next statement. */
const STATIC_FS = new RegExp(String.raw`\b(import|export)\s+(type\s+)?([\w$\s,{}*]*?)\s*from\s*['"]${FS_SPECIFIER}['"]`, 'g');

/** The source without its comments, so a word in a comment is not mistaken for code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** The same text with the inside of every string replaced by spaces (same length), so a word in a message is not mistaken for code. */
function maskStrings(code: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < code.length; i++) {
    const c = code[i] as string;
    if (quote === null) {
      if (c === "'" || c === '"' || c === '`') quote = c;
      out += c;
    } else if (c === '\\') {
      out += i + 1 < code.length ? '  ' : ' '; // an escape hides the next character too
      i += 1;
    } else if (c === quote) {
      quote = null;
      out += c;
    } else {
      out += c === '\n' ? '\n' : ' ';
    }
  }
  return out;
}

/** The arguments of the call whose "(" is at `open`, as text, split at the commas that are not inside brackets or strings. */
function callArguments(code: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = open + 1;
  for (let i = open; i < code.length; i++) {
    const c = code[i] as string;
    if (quote !== null) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') {
      quote = c;
    } else if (c === '(' || c === '[' || c === '{') {
      depth += 1;
    } else if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) {
        args.push(code.slice(start, i).trim());
        break;
      }
    } else if (c === ',' && depth === 1) {
      args.push(code.slice(start, i).trim());
      start = i + 1;
    }
  }
  // open() has no argument, and open(file, 'r',) has a comma after the last one: neither has an empty argument.
  while (args.length > 0 && args[args.length - 1] === '') args.pop();
  return args;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What is wrong with one file's use of the file system. An empty list means nothing. */
function findFsWriteImports(source: string): string[] {
  const code = stripComments(source);
  const problems: string[] = [];
  const openNames: string[] = []; // the names that open or openSync have in this file

  for (const match of code.matchAll(STATIC_FS)) {
    const [, keyword, isType, clause = ''] = match;
    if (isType) continue; // a type is erased and writes nothing
    if (keyword === 'export') {
      problems.push(`re-exports fs (${clause.trim()}): the scan cannot see what it hands on`);
      continue;
    }
    // A default or namespace import (import fs from, import * as fs from) hides which functions are used.
    if (/^\s*[\w$]+\s*(,|$)/.test(clause) || /\*\s*as\s/.test(clause)) {
      problems.push(`imports the whole fs module (${clause.trim()}): import the functions it reads with by name`);
    }
    for (const part of (clause.match(/\{([^}]*)\}/)?.[1] ?? '').split(',')) {
      const text = part.trim();
      if (text === '' || text.startsWith('type ')) continue;
      const [name = '', alias = name] = text.split(/\s+as\s+/).map((word) => word.trim());
      if (FS_WRITERS.has(name)) problems.push(`imports ${name}`);
      else if (FS_OPEN.has(name)) openNames.push(alias);
      else if (!FS_READERS.has(name)) problems.push(`imports ${name}, which this scan does not know: add it to FS_READERS or FS_WRITERS`);
    }
  }

  // What is left once the static imports are taken out. Any fs module that is still named here was
  // loaded another way: import(), require(), createRequire(...)(), process.binding().
  const rest = code.replace(STATIC_FS, (statement) => ' '.repeat(statement.length));
  if (new RegExp(String.raw`['"\`]${FS_SPECIFIER}['"\`]`).test(rest)) {
    problems.push('names an fs module outside a static import (import(), require(), createRequire): the scan cannot see what it uses');
  }

  // open and openSync are fine for reading. Every use must be a call whose flag is plainly read-only
  // (no flag at all means "r"). Words inside strings are left out, so a message that says "open" is no use of it.
  const visible = maskStrings(rest);
  for (const name of openNames) {
    for (const use of visible.matchAll(new RegExp(String.raw`(?<![\w$.])${escapeRegExp(name)}(?![\w$])`, 'g'))) {
      const at = use.index + name.length;
      const paren = visible.slice(at).match(/^\s*\(/);
      if (!paren) {
        problems.push(`uses ${name} without calling it, so its flag cannot be checked`);
        continue;
      }
      const flag = callArguments(rest, at + paren[0].length - 1)[1];
      if (flag !== undefined && !READ_ONLY_FLAG.test(flag)) {
        problems.push(`calls ${name} with the flag ${flag}, which is not plainly read-only ('r')`);
      }
    }
  }
  return problems;
}

/** Where a file names a way to start a process or a thread (any import, import(), require() or createRequire). */
function findProcessImports(source: string): string[] {
  const code = stripComments(source);
  return new RegExp(String.raw`['"\`]${PROCESS_SPECIFIER}['"\`]`).test(code) ? ['names a module that starts processes or threads'] : [];
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

  // main.ts opens the browser through the `open` package, which starts the system's launcher. That
  // is the one start outside the runner, it is skipped when CC_NO_OPEN=1 (ruling R6), and it is not
  // an import of a process module, so this scan does not see it.
  it('server source names child_process, worker_threads and cluster only in runner.ts (scan)', () => {
    const found = sourcesUnder(SERVER_DIR)
      .filter(([file]) => !file.endsWith('runner.ts'))
      .flatMap(([file, source]) => findProcessImports(source).map((problem) => `${file}: ${problem}`));
    expect(found).toEqual([]);
  });

  describe('the scan itself', () => {
    it('classifies every name that node:fs and node:fs/promises export, so a new writer cannot get past it', async () => {
      const fs = await import('node:fs');
      const fsPromises = await import('node:fs/promises');
      const exported = new Set([...Object.keys(fs), ...Object.keys(fsPromises)].filter((name) => name !== 'default'));
      const unclassified = [...exported].filter((name) => !FS_WRITERS.has(name) && !FS_READERS.has(name) && !FS_OPEN.has(name));
      expect(unclassified, 'add each of these to FS_READERS or FS_WRITERS').toEqual([]);
      // No name is in two lists, and the lists name nothing that Node does not export (no stale names).
      const lists = [...FS_WRITERS, ...FS_READERS, ...FS_OPEN];
      expect(lists.length).toBe(new Set(lists).size);
      expect(lists.filter((name) => !exported.has(name))).toEqual([]);
    });

    it('flags the ways to write a file', () => {
      expect(findFsWriteImports("import { readFileSync, writeFileSync } from 'node:fs';")).toEqual(['imports writeFileSync']);
      expect(findFsWriteImports("import { rm as remove } from 'fs/promises';")).toEqual(['imports rm']);
      expect(findFsWriteImports("import { type Stats, mkdir } from 'node:fs/promises';")).toEqual(['imports mkdir']);
      expect(findFsWriteImports("import { createWriteStream } from 'node:fs';")).toEqual(['imports createWriteStream']);
      expect(findFsWriteImports("import fs from 'node:fs';")).toHaveLength(1);
      expect(findFsWriteImports("import * as fs from 'node:fs';")).toHaveLength(1);
      expect(findFsWriteImports("import fs, { readFileSync } from 'node:fs';")).toHaveLength(1);
      expect(findFsWriteImports("const fs = await import('node:fs');")).toHaveLength(1);
      expect(findFsWriteImports("const fs = require('fs');")).toHaveLength(1);
    });

    it('flags the write functions of fs.promises, however they are reached', () => {
      // The promises export is the whole of node:fs/promises: promises.writeFile(...), fsp.rm(...).
      expect(findFsWriteImports("import { promises } from 'node:fs';")).toEqual(['imports promises']);
      expect(findFsWriteImports("import { promises as fsp } from 'node:fs';")).toEqual(['imports promises']);
      expect(findFsWriteImports("import { readFile, promises } from 'fs';")).toEqual(['imports promises']);
      // The functions of node:fs/promises, by name.
      for (const name of ['writeFile', 'appendFile', 'mkdir', 'rm', 'rename', 'copyFile', 'cp', 'truncate', 'unlink', 'symlink', 'chmod', 'utimes', 'mkdtemp']) {
        expect(findFsWriteImports(`import { ${name} } from 'node:fs/promises';`), name).toEqual([`imports ${name}`]);
      }
      // Reached through a loader that is not a static import.
      expect(findFsWriteImports("const { writeFile } = await import('node:fs/promises');")).toHaveLength(1);
      expect(findFsWriteImports("const fsp = createRequire(import.meta.url)('node:fs/promises');")).toHaveLength(1);
      expect(findFsWriteImports("const fs = process.binding('fs');")).toHaveLength(1);
      // The write streams, and the classes that hold a file open for writing.
      expect(findFsWriteImports("import { WriteStream } from 'node:fs';")).toEqual(['imports WriteStream']);
      expect(findFsWriteImports("import { Utf8Stream } from 'node:fs';")).toEqual(['imports Utf8Stream']);
    });

    it('flags open() and openSync() with a write flag, or any flag that is not plainly read-only', () => {
      const importOpen = "import { open } from 'node:fs/promises';\n";
      for (const flag of ["'w'", "'a'", "'r+'", "'w+'", "'a+'", "'wx'", '"w"', '`w`', 'flags', 'constants.O_WRONLY', '1', "'r' + 'w'", 'mode === 1 ? "w" : "r"']) {
        const problems = findFsWriteImports(`${importOpen}const handle = await open(file, ${flag});`);
        expect(problems, `open(file, ${flag})`).toHaveLength(1);
        expect(problems[0], `open(file, ${flag})`).toContain('not plainly read-only');
      }
      expect(findFsWriteImports("import { openSync } from 'node:fs';\nconst fd = openSync(file, 'w');")).toHaveLength(1);
      expect(findFsWriteImports("import { openSync } from 'fs';\nconst fd = openSync(file, 'a', 0o644);")).toHaveLength(1);
      // The flag is the second argument whatever the first one looks like.
      expect(findFsWriteImports(`${importOpen}await open(join(dir, 'a,b'), 'w');`)).toHaveLength(1);
      expect(findFsWriteImports(`${importOpen}await open(pick(a, b), 'w');`)).toHaveLength(1);
      // An alias is followed, and so is a call spread over lines.
      expect(findFsWriteImports("import { open as openFile } from 'node:fs/promises';\nawait openFile(file, 'w');")).toHaveLength(1);
      expect(findFsWriteImports(`${importOpen}await open(\n  file,\n  'w',\n);`)).toHaveLength(1);
      // open used as a value cannot be checked, so it is refused.
      expect(findFsWriteImports(`${importOpen}const opener = open;\nawait opener(file, 'w');`)).toHaveLength(1);
      expect(findFsWriteImports(`${importOpen}run(open);`)).toHaveLength(1);
    });

    it('lets open() and openSync() through when the flag is plainly read-only, and lets the read functions through', () => {
      const importOpen = "import { open } from 'node:fs/promises';\n";
      expect(findFsWriteImports(`${importOpen}const handle = await open(file, 'r');`)).toEqual([]);
      expect(findFsWriteImports(`${importOpen}const handle = await open(file);`)).toEqual([]);
      expect(findFsWriteImports(`${importOpen}const handle = await open(file, "r");`)).toEqual([]);
      expect(findFsWriteImports(`${importOpen}const handle = await open(file, 'r',);`)).toEqual([]);
      expect(findFsWriteImports("import { openSync, readSync, closeSync } from 'node:fs';\nconst fd = openSync(file, 'rs');")).toEqual([]);
      // A word in a message is not a use of open, and neither is a method of that name.
      expect(findFsWriteImports(`${importOpen}throw new Error('could not open the file');\nserver.open(port);\nawait open(file, 'r');`)).toEqual([]);
      // Importing it and not using it is harmless.
      expect(findFsWriteImports("import { readFile, readdir, stat, open } from 'node:fs/promises';")).toEqual([]);
      expect(findFsWriteImports("import { existsSync, readFileSync } from 'node:fs';")).toEqual([]);
      expect(findFsWriteImports("import { readFile, readdir, opendir, glob, watch } from 'node:fs/promises';")).toEqual([]);
      expect(findFsWriteImports("import type { Stats } from 'node:fs';")).toEqual([]);
      expect(findFsWriteImports("import { type Dirent, readdirSync } from 'node:fs';")).toEqual([]);
      expect(findFsWriteImports("import { join } from 'node:path';")).toEqual([]);
      // The browser launcher of the npm package called "open" is not fs's open.
      expect(findFsWriteImports("import open from 'open';\nawait open(address);")).toEqual([]);
    });

    it('flags a re-export of fs, and a name it does not know', () => {
      expect(findFsWriteImports("export { writeFile } from 'node:fs/promises';")).toHaveLength(1);
      expect(findFsWriteImports("export * from 'node:fs';")).toHaveLength(1);
      expect(findFsWriteImports("export * as fs from 'fs';")).toHaveLength(1);
      expect(findFsWriteImports("export type { Stats } from 'node:fs';")).toEqual([]);
      // A name that a future Node adds is refused until someone classifies it.
      const unknown = findFsWriteImports("import { somethingNew } from 'node:fs';");
      expect(unknown).toHaveLength(1);
      expect(unknown[0]).toContain('does not know');
    });

    it('ignores comments, and does not run one import into the next', () => {
      expect(findFsWriteImports("// import { writeFileSync } from 'node:fs';\nimport { readFileSync } from 'node:fs';")).toEqual([]);
      expect(findFsWriteImports("/* import { rmSync } from 'node:fs'; */")).toEqual([]);
      expect(findFsWriteImports("import { join } from 'node:path'\nimport { readFileSync } from 'node:fs'\nexport const a = 1")).toEqual([]);
      expect(findFsWriteImports("import { join } from 'node:path'\nimport { rmSync } from 'node:fs'")).toEqual(['imports rmSync']);
    });

    it('flags a process module however it is named, and lets the rest through', () => {
      expect(findProcessImports("import { execFile } from 'node:child_process';")).toHaveLength(1);
      expect(findProcessImports("import cp from 'child_process';")).toHaveLength(1);
      expect(findProcessImports("import { Worker } from 'node:worker_threads';")).toHaveLength(1);
      expect(findProcessImports("import cluster from 'node:cluster';")).toHaveLength(1);
      expect(findProcessImports("const cp = await import('node:child_process');")).toHaveLength(1);
      expect(findProcessImports("const cp = createRequire(import.meta.url)('node:child_process');")).toHaveLength(1);
      expect(findProcessImports("// import { execFile } from 'node:child_process';")).toEqual([]);
      expect(findProcessImports("import { join } from 'node:path';")).toEqual([]);
    });
  });
});
