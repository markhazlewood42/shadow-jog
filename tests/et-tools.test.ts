/**
 * ET pass line 2 (docs/engine/et-brief.md section 4): no old engine in tool code.
 *
 * The old engine was `src/engine/{game,display,postfx,moments}.ts` and `LegacyScene` / `LegacyShape` (the adapter that ran an old-style scene). M8d deleted all of it. What stays is ONE
 * check (it replaces the seven exemption lists of M8c and ET): no tool file reaches a deleted path. This test builds the closure of VALUE imports of every tool file; for each file in
 * it, EVERY import (static, type-only, dynamic `import()`) is resolved by its path, with no need for the file to exist, and the test fails when one points at a deleted path. A
 * type-only import is checked as well: the file is gone, so the import would not compile either. A dynamic `import()` is not followed, but its target is checked.
 *
 * Tool files: every file under `src/dev` (the DEV menu, the FX lab, the animation editor, art review, art swap, the viewers, the stage editor, Battle Test and its glue),
 * and `src/devroutes.ts`, `src/sje-lab/stagelab.ts` and `lab.ts`.
 *
 * The trailer is deleted, not ported (decision 3, issue #84): its files must not exist and no reference may stay in `src`, `scripts` or `docs/DEVELOPING.md`.
 *
 * The scan has controls: a fixture graph with a forbidden edge must fail, and a graph without one must pass. The control that matters most was run on the real tree when M8d removed
 * the lists: a tool file given a dynamic import of a deleted path turned this test red, and the edit was reverted.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

/** The files of the old engine that no tool may reach. They do not exist: the paths are built, so a search for the old names finds no string here. */
const DELETED = ['game', 'display', 'postfx', 'moments'].map((n) => `src/engine/${n}.ts`);
/** The classes of the legacy adapter. The pattern is built from parts for the same reason. */
const LEGACY_NAMES = new RegExp(`\\bLegacy(${['Scene', 'Shape', 'GameSurface'].join('|')})\\b`);

interface Source {
  read(file: string): string | null;
}

/** Repo-relative path with forward slashes. */
const slash = (p: string): string => p.split(sep).join('/');

/** The text without comments (a mention of a deleted name in a comment is not a use). */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

interface Imp {
  spec: string;
  /** True when the compiler erases the statement (`import type`, or every name is `type X`). */
  typeOnly: boolean;
}

/** The static imports and re-exports of a file, and its dynamic `import()` targets. */
function importsOf(text: string): { statics: Imp[]; dynamics: string[] } {
  const src = code(text);
  const statics: Imp[] = [];
  for (const m of src.matchAll(/^[ \t]*(?:import|export)\s+([^;'"]*?)\bfrom\s*['"]([^'"]+)['"]/gm)) {
    const clause = (m[1] ?? '').trim();
    const named = /^\{([^}]*)\}$/.exec(clause);
    const typeOnly = clause.startsWith('type ') || (named !== null && (named[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith('type ')));
    statics.push({ spec: m[2] ?? '', typeOnly });
  }
  for (const m of src.matchAll(/^[ \t]*import\s*['"]([^'"]+)['"]/gm)) statics.push({ spec: m[1] ?? '', typeOnly: false });
  const dynamics = [...src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] ?? '');
  return { statics, dynamics };
}

/** The repo path (with `.ts`) that a relative `spec` written in `from` points at, whether or not the file exists. Null for a package. */
function pathOf(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = slash(relative(ROOT, resolve(dirname(join(ROOT, from)), spec)));
  return /\.(ts|mjs|js)$/.test(base) ? base : `${base}.ts`;
}

/** The repo file a relative `spec` written in `from` points at, or null (a package, or a file that does not exist). */
function resolveSpec(src: Source, from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = slash(relative(ROOT, resolve(dirname(join(ROOT, from)), spec)));
  for (const c of [`${base}.ts`, `${base}/index.ts`, base]) if (/\.(ts|mjs|js)$/.test(c) && src.read(c) !== null) return c;
  return null;
}

/** Every file one tool entry pulls in by value (static imports, followed). */
function closureOf(src: Source, entry: string): Set<string> {
  const files = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    const text = src.read(file);
    if (text === null) continue;
    for (const s of importsOf(text).statics) {
      if (s.typeOnly) continue;
      const t = resolveSpec(src, file, s.spec);
      if (t) queue.push(t);
    }
  }
  return files;
}

/** The problems of one tool entry. Pure, so a control can run it on a made-up graph. */
function problemsOf(src: Source, entry: string): string[] {
  const out = new Set<string>();
  for (const f of closureOf(src, entry)) {
    const text = src.read(f);
    if (text === null) continue;
    const { statics, dynamics } = importsOf(text);
    for (const spec of [...statics.map((s) => s.spec), ...dynamics]) {
      const p = pathOf(f, spec);
      if (p !== null && DELETED.includes(p)) out.add(`${entry} reaches ${p}`);
    }
    // The classes of the legacy adapter, named in code (the engine's own files are not scanned: the facade re-exports the adapter until it goes).
    if (!f.startsWith('src/sje/') && LEGACY_NAMES.test(code(text))) out.add(`${entry}: ${f} names a legacy adapter class`);
  }
  return [...out].sort();
}

const disk: Source = {
  read(file) {
    const p = join(ROOT, file);
    return existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null;
  },
};

function filesUnder(dir: string, out: string[] = []): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) filesUnder(rel, out);
    else if (/\.ts$/.test(name)) out.push(rel);
  }
  return out;
}

/** Every tool file that exists now. A stage editor or Battle Test file is checked as soon as it exists (src/dev/stageedit/, src/dev/*). */
const ENTRIES = [...filesUnder('src/dev'), 'src/devroutes.ts', 'src/sje-lab/stagelab.ts', 'src/sje-lab/lab.ts'].sort();

describe('ET pass line 2: no tool reaches a deleted path of the old engine', () => {
  it('the scan sees the tools of the brief', () => {
    for (const named of ['src/dev/devmenu.ts', 'src/dev/fxlab.ts', 'src/dev/rigedit.ts', 'src/dev/artreview.ts', 'src/dev/artswap.ts', 'src/dev/fieldshow.ts', 'src/devroutes.ts', 'src/sje-lab/stagelab.ts', 'src/sje-lab/lab.ts', 'src/dev/stageedit/stageedit.ts', 'src/dev/stageedit/battletest.ts', 'src/dev/stageedit/battledialog.ts', 'src/dev/stageedit/battleglue.ts']) {
      expect(ENTRIES, named).toContain(named);
    }
  });

  it.each(ENTRIES)('%s reaches no deleted file of the old engine and names no legacy adapter class', (entry) => {
    expect(problemsOf(disk, entry)).toEqual([]);
  });

  it('the five viewers are tool files under src/dev/viewers, on a scene of the new engine', () => {
    const viewers = ['mapview', 'chartest', 'portraittest', 'bestiarytest', 'fonttest'];
    for (const v of viewers) {
      expect(existsSync(join(ROOT, `src/dev/viewers/${v}.ts`)), `src/dev/viewers/${v}.ts`).toBe(true);
      expect(existsSync(join(ROOT, `src/scenes/${v}.ts`)), `src/scenes/${v}.ts is moved, not copied`).toBe(false);
    }
  });

  it('the Battle Stage Editor (stageedit.html) runs on the new engine: its page loads its entry, the entry reaches the stage scene and the engine, and no file of its closure is Phaser or the old engine', () => {
    expect(readFileSync(join(ROOT, 'stageedit.html'), 'utf8')).toContain('/src/dev/stageedit/stageedit.ts');
    const files = closureOf(disk, 'src/dev/stageedit/stageedit.ts');
    expect(files.has('src/dev/stageedit/host.ts')).toBe(true);
    expect(files.has('src/battlestage/stagescene.ts')).toBe(true);
    expect(files.size).toBeGreaterThan(20);
    expect(problemsOf(disk, 'src/dev/stageedit/stageedit.ts')).toEqual([]);
    // No editor file imports Phaser (it is gone from the project).
    for (const f of filesUnder('src/dev/stageedit')) expect(code(readFileSync(join(ROOT, f), 'utf8')), f).not.toMatch(/from\s*['"]phaser['"]/);
  });

  it('Battle Test loads its glue module (which holds the game scene) with a dynamic import() only, so the editor chunk does not hold the battle scene', () => {
    const files = closureOf(disk, 'src/dev/stageedit/battletest.ts');
    expect(problemsOf(disk, 'src/dev/stageedit/battletest.ts')).toEqual([]);
    expect(problemsOf(disk, 'src/dev/stageedit/battledialog.ts')).toEqual([]);
    expect(problemsOf(disk, 'src/dev/stageedit/battleglue.ts')).toEqual([]);
    expect(files.has('src/dev/stageedit/battleglue.ts')).toBe(false);
    expect(files.has('src/scenes/battle.ts')).toBe(false);
    const dyn = importsOf(readFileSync(join(ROOT, 'src/dev/stageedit/battletest.ts'), 'utf8')).dynamics;
    expect(dyn.map((d) => pathOf('src/dev/stageedit/battletest.ts', d))).toEqual(['src/dev/stageedit/battleglue.ts']);
    // The glue runs the game's own scene on the sje `Game`: it takes `game.fx` from the engine, and imports no deleted file.
    const glue = code(readFileSync(join(ROOT, 'src/dev/stageedit/battleglue.ts'), 'utf8'));
    expect(glue).toContain("from '../../scenes/battle'");
    expect(glue).toContain('game.fx');
  });

  it('the FX lab is a Scene of the new engine, not a legacy shape', () => {
    const lab = readFileSync(join(ROOT, 'src/dev/fxlab.ts'), 'utf8');
    expect(code(lab)).toMatch(/class FxLabScene extends (CanvasViewScene|Scene)\b/);
    expect(code(lab)).not.toMatch(LEGACY_NAMES);
  });

  it('the build files and the art scripts name no path under src/engine (pass line 3)', () => {
    expect(readFileSync(join(ROOT, 'vite.config.ts'), 'utf8')).not.toMatch(/src\/engine/);
    for (const f of readdirSync(join(ROOT, 'scripts/pixellab')).filter((n) => n.endsWith('.mjs'))) {
      expect(readFileSync(join(ROOT, 'scripts/pixellab', f), 'utf8'), f).not.toMatch(/\/src\/engine\//);
    }
  });

  // ---- controls: the scan can fail ----
  const made = (files: Record<string, string>): Source => ({ read: (f) => files[f] ?? null });
  const old = (name: string): string => `src/engine/${name}.ts`;
  const spec = (name: string, up = '..'): string => `${up}/engine/${name}`;

  it('control: a tool that imports a deleted file statically fails', () => {
    const g = made({ 'src/dev/a.ts': `import { postfx } from '${spec('postfx')}';\nexport const x = postfx;` });
    expect(problemsOf(g, 'src/dev/a.ts')).toEqual([`src/dev/a.ts reaches ${old('postfx')}`]);
  });

  it('control: a tool that loads a deleted file with a dynamic import() fails (the file does not need to exist)', () => {
    const g = made({ 'src/dev/a.ts': `export const load = () => import('${spec('moments')}');` });
    expect(problemsOf(g, 'src/dev/a.ts')).toEqual([`src/dev/a.ts reaches ${old('moments')}`]);
    // And from a file in a sub folder of the tools.
    const h = made({ 'src/dev/stageedit/b.ts': `export const load = () => import('${spec('display', '../..')}');` });
    expect(problemsOf(h, 'src/dev/stageedit/b.ts')).toEqual([`src/dev/stageedit/b.ts reaches ${old('display')}`]);
  });

  it('control: a forbidden edge two files down fails (a tool reached a deleted file through a game file)', () => {
    const g = made({
      'src/dev/a.ts': "import { spell } from '../scenes/kit/gpufx';\nexport { spell };",
      'src/scenes/kit/gpufx.ts': `import { playMoment } from '${spec('moments', '../..')}';\nexport const spell = playMoment;`,
    });
    expect(problemsOf(g, 'src/dev/a.ts')).toEqual([`src/dev/a.ts reaches ${old('moments')}`]);
  });

  it('control: a type-only import of a deleted file fails too, and a clean import passes', () => {
    expect(problemsOf(made({ 'src/dev/a.ts': `import type { Game } from '${spec('game')}';` }), 'src/dev/a.ts')).toEqual([`src/dev/a.ts reaches ${old('game')}`]);
    expect(problemsOf(made({ 'src/dev/a.ts': `import { type Game, Scene } from '${spec('game')}';` }), 'src/dev/a.ts')).toEqual([`src/dev/a.ts reaches ${old('game')}`]);
    expect(problemsOf(made({ 'src/dev/a.ts': `export { Game } from '${spec('game')}';` }), 'src/dev/a.ts')).toEqual([`src/dev/a.ts reaches ${old('game')}`]);
    expect(problemsOf(made({ 'src/dev/a.ts': `import type { Game } from '../sje';\nimport { shake } from '${spec('shake')}';` }), 'src/dev/a.ts')).toEqual([]);
  });

  it('control: a legacy adapter class named in code fails, named in a comment passes', () => {
    const shape = `Legacy${'Shape'}`;
    const scene = `Legacy${'Scene'}`;
    expect(problemsOf(made({ 'src/dev/a.ts': `export class L implements ${shape}<void> {}` }), 'src/dev/a.ts')).toEqual(['src/dev/a.ts: src/dev/a.ts names a legacy adapter class']);
    expect(problemsOf(made({ 'src/dev/a.ts': `// was a ${scene}\n/* ${shape} */\nexport const x = 1;` }), 'src/dev/a.ts')).toEqual([]);
  });

  it('control: the scan reads the disk (the FX lab has a closure of more than one file)', () => {
    expect(closureOf(disk, 'src/dev/fxlab.ts').size).toBeGreaterThan(5);
  });
});


describe('ET decision 3: the trailer is deleted (issue #84 tracks its re-creation on the new engine)', () => {
  it('src/dev/trailer.ts and scripts/trailer.mjs do not exist', () => {
    expect(existsSync(join(ROOT, 'src/dev/trailer.ts'))).toBe(false);
    expect(existsSync(join(ROOT, 'scripts/trailer.mjs'))).toBe(false);
  });

  it('no reference to the trailer stays in src, scripts or docs/DEVELOPING.md', () => {
    const hits: string[] = [];
    const scan = (dir: string): void => {
      for (const name of readdirSync(join(ROOT, dir))) {
        const rel = `${dir}/${name}`;
        if (statSync(join(ROOT, rel)).isDirectory()) scan(rel);
        else if (/\.(ts|mjs|js|json|html|md)$/.test(name) && /trailer/i.test(readFileSync(join(ROOT, rel), 'utf8'))) hits.push(rel);
      }
    };
    scan('src');
    scan('scripts');
    if (/trailer/i.test(readFileSync(join(ROOT, 'docs/DEVELOPING.md'), 'utf8'))) hits.push('docs/DEVELOPING.md');
    expect(hits).toEqual([]);
  });

  it('control: the scan finds the word where it is', () => {
    expect(/trailer/i.test('The Trailer recorder')).toBe(true);
    expect(/trailer/i.test('window.__SJ__.trailer()')).toBe(true);
  });
});
