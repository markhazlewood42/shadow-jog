/**
 * Proves that the SHIPPED bundle did not change (spike step B3, pass line P1).
 *
 *   node scripts/prod-bytes.mjs [git-ref]      (default ref: HEAD)
 *
 * It builds the game twice, in a scratch folder outside the repo: once from the files of the git
 * ref (`git archive`, read only) and once from the working tree as it is now. Then it compares every
 * file in the two `dist/` folders by SHA-256 (the `.map` source maps are left out: they hold paths).
 * Exit code 0 means the two builds are byte for byte the same.
 *
 * Why outside the repo: vite.config.ts stamps the build with the short git commit, and a folder with
 * no `.git` stamps `nogit`, so both builds carry the same stamp and only a real code change shows.
 * `node_modules` is linked (a Windows "junction"), not copied.
 *
 * Nothing in the repo is changed: no git state, no `dist/`. Scratch folder: `--out <dir>` or the OS temp folder.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const out = outFlag >= 0 ? resolve(args[outFlag + 1] ?? '') : join(tmpdir(), 'sj-prod-bytes');
const ref = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out') ?? 'HEAD';

/** Folders and files the build does not read: left out of the working-tree copy to keep it fast. */
const SKIP = new Set(['node_modules', 'dist', '.git', 'media', 'test-results', 'playtest', 'spritefusion-tests', 'pixellab-tests', 'docs', 'knowledge', 'reviewer-prompts']);

function prepare(name) {
  const dir = join(out, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function build(dir, label) {
  // A junction needs no admin rights on Windows; on other systems it is an ordinary symlink.
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'junction');
  try {
    execFileSync(process.execPath, [join(dir, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    console.error(`${label}: build failed\n${String(e.stdout ?? '')}\n${String(e.stderr ?? '')}`);
    process.exit(2);
  } finally {
    // Remove the link first so nothing that cleans this folder can follow it into the real node_modules.
    unlinkSync(join(dir, 'node_modules'));
  }
}

function hashes(dir) {
  const map = new Map();
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (!name.endsWith('.map')) map.set(relative(join(dir, 'dist'), p).split('\\').join('/'), createHash('sha256').update(readFileSync(p)).digest('hex'));
    }
  };
  walk(join(dir, 'dist'));
  return map;
}

// 1. The ref's files.
const base = prepare('base');
execFileSync('git', ['-C', root, 'archive', '--format=tar', '-o', join(out, 'base.tar'), ref]);
// Relative paths with cwd: GNU tar reads a drive letter (C:) as a remote host name.
execFileSync('tar', ['-xf', '../base.tar'], { cwd: base });
rmSync(join(out, 'base.tar'));
// 2. The working tree.
const work = prepare('work');
for (const name of readdirSync(root)) {
  if (!SKIP.has(name)) cpSync(join(root, name), join(work, name), { recursive: true });
}
if (!existsSync(join(work, 'index.html'))) throw new Error('the working-tree copy has no index.html');

build(base, `ref ${ref}`);
build(work, 'working tree');
const a = hashes(base);
const b = hashes(work);
const names = [...new Set([...a.keys(), ...b.keys()])].sort();
const different = names.filter((n) => a.get(n) !== b.get(n));
console.log(`${ref}: ${a.size} files   working tree: ${b.size} files`);
const entry = names.find((n) => /^assets\/index-.*\.js$/.test(n));
if (entry) console.log(`main chunk: ${entry}  sha256 ${(b.get(entry) ?? 'missing').slice(0, 16)}...`);
if (different.length === 0) {
  console.log(`IDENTICAL: every file has the same SHA-256 (${names.length} files).`);
} else {
  console.log(`DIFFERENT: ${different.length} of ${names.length} files`);
  for (const n of different.slice(0, 20)) console.log(`  ${n}: ${a.get(n)?.slice(0, 12) ?? '(absent)'} -> ${b.get(n)?.slice(0, 12) ?? '(absent)'}`);
  process.exit(1);
}
