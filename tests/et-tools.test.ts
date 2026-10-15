/**
 * ET pass line 2 (docs/engine/et-brief.md section 4): no old engine in tool code.
 *
 * The old engine is `src/engine/{game,display,postfx,moments}.ts` (M8 deletes them), and `LegacyScene` and `LegacyShape` (the adapter that runs an old-style scene). This test
 * builds the closure of VALUE imports of every tool file and fails when the closure holds one of those files, or names one of those two classes. A type-only import
 * (`import type`, or `import { type X }`) is erased by the compiler, so it adds nothing to a bundle and is not followed. A dynamic `import()` of a tool file is not followed, and its
 * target is checked against a short list (see `dynamicProblems`). A dynamic target under `src/sje` is followed.
 *
 * Tool files: every file under `src/dev` (the DEV menu, the FX lab, the animation editor, art review, art swap, the viewers, the stage editor, Battle Test),
 * and `src/sje-lab/stagelab.ts` and `lab.ts`. `src/dev/fieldshow.ts` and `src/devroutes.ts` start game scenes (`FieldScene`, `BattleScene`, `PanelScene`), so only their
 * DIRECT imports are checked: a game scene is M8's. A dynamic `import()` of a file under `src/sje` is followed like a static import.
 *
 * Battle Test's exemption (Mark, 2026-10-13; docs/engine/et-brief.md pass line 2). Decision 2 B runs the game's own `BattleScene` (a native scene since M8c; the exemption list stays until M8d). Battle Test's own
 * files stay engine-free. They may reach old-engine code only through a dynamic `import()` of a file on the named list `BATTLE_TEST_DYNAMIC`: `src/scenes/battle.ts` and ONE glue module
 * (`src/dev/stageedit/battleglue.ts`), which loads the effects data and holds every other game-side line of the test. The glue is not an entry (it is the exemption); a static import of
 * either file from a Battle Test file fails; a dynamic import of any other old-engine file fails; a dynamic import of the two from a file that is not a Battle Test file fails. M8 deletes
 * the list.
 *
 * The trailer is deleted, not ported (decision 3, issue #84): its files must not exist and no reference may stay in `src`, `scripts` or `docs/DEVELOPING.md`.
 *
 * The scan has controls: a fixture graph with a forbidden edge must fail, and a graph without one must pass.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

/** The files of the old engine that no tool may reach. */
const FORBIDDEN = ['src/engine/game.ts', 'src/engine/display.ts', 'src/engine/postfx.ts', 'src/engine/moments.ts'];
/**
 * Game code that boots the game: M8's. A tool may not import it by value or by a dynamic `import()`.
 * Battle Test's boundary (`src/scenes/battle.ts`, `field.ts`, `panels.ts`) waits for Mark's decision: the brief (pass line 2) forbids Battle Test from reaching the old engine,
 * and Mark has not approved an exemption. No current tool entry needs those files, so they are not listed: a tool that reaches them is followed into the old engine and fails.
 */
const GAME_BOUNDARY = ['src/boot.ts', 'src/sje/boot.ts'];
/** Tool files that start game scenes: only their own imports are checked. */
const DIRECT_ONLY = ['src/dev/fieldshow.ts', 'src/devroutes.ts'];
/** Game files a tool may load with a dynamic `import()`. None: no current tool entry needs one. Anything under `src/dev`, `src/sje-lab` and (followed) `src/sje` is also allowed. */
const DYNAMIC_GAME: string[] = [];
/**
 * The named list of pass line 2's Battle Test exemption: the two old-engine files a Battle Test file may load, with a dynamic `import()` only. The glue module is ONE file.
 * M8 removes the list.
 */
const BATTLE_TEST_GLUE = 'src/dev/stageedit/battleglue.ts';
const BATTLE_TEST_DYNAMIC = ['src/scenes/battle.ts', BATTLE_TEST_GLUE];
/** The Battle Test files: the only files that may use the named list. */
const BATTLE_TEST_FILES = ['src/dev/stageedit/battletest.ts', 'src/dev/stageedit/battledialog.ts'];
const isBattleTestFile = (f: string): boolean => BATTLE_TEST_FILES.includes(f);

interface Source {
  read(file: string): string | null;
}

/** Repo-relative path with forward slashes. */
const slash = (p: string): string => p.split(sep).join('/');

/** The text without comments (a mention of `LegacyScene` in a comment is not a use). */
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

/** The repo file a relative `spec` written in `from` points at, or null (a package, or a file that does not exist). */
function resolveSpec(src: Source, from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = slash(relative(ROOT, resolve(dirname(join(ROOT, from)), spec)));
  for (const c of [`${base}.ts`, `${base}/index.ts`, base]) if (/\.(ts|mjs|js)$/.test(c) && src.read(c) !== null) return c;
  return null;
}

const isToolFile = (f: string): boolean => f.startsWith('src/dev/') || f.startsWith('src/sje-lab/') || f === 'src/devroutes.ts';

/** Everything one tool entry pulls in by value: the files, the game files it reaches directly, and the dynamic targets of every file in the closure. */
function closureOf(src: Source, entry: string, directOnly = false): { files: Set<string>; boundary: Set<string>; dynamics: Array<{ file: string; target: string }> } {
  const files = new Set<string>();
  const boundary = new Set<string>();
  const dynamics: Array<{ file: string; target: string }> = [];
  const queue = [entry];
  // Engine files (src/sje) a tool loads with a dynamic import(): these are followed, statics included, so a glue module that reaches the old engine is caught.
  const deep = new Set<string>();
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    const text = src.read(file);
    if (text === null) continue;
    const { statics, dynamics: dyn } = importsOf(text);
    // Only a tool file's own dynamic imports are judged: a game file in the closure loads its own chunks (the 3D mode, the deck) as it always did.
    if (isToolFile(file)) {
      for (const d of dyn) {
        const t = resolveSpec(src, file, d);
        if (!t) continue;
        dynamics.push({ file, target: t });
        if (t.startsWith('src/sje/') && !GAME_BOUNDARY.includes(t) && !directOnly) {
          deep.add(t);
          queue.push(t);
        }
      }
    }
    if (directOnly && file !== entry) continue;
    const followSje = deep.has(file);
    for (const s of statics) {
      if (s.typeOnly) continue;
      const t = resolveSpec(src, file, s.spec);
      if (!t) continue;
      if (GAME_BOUNDARY.includes(t)) {
        boundary.add(t);
        continue; // M8's: not followed
      }
      // The engine itself (src/sje) is checked by tests/sje-imports.test.ts; a tool reaches it through the facade.
      if (t.startsWith('src/sje/')) {
        if (!followSje) continue;
        deep.add(t);
      }
      queue.push(t);
    }
  }
  return { files, boundary, dynamics };
}

/** The problems of one tool entry. Pure, so a control can run it on a made-up graph. */
function problemsOf(src: Source, entry: string): string[] {
  const direct = DIRECT_ONLY.includes(entry);
  const { files, boundary, dynamics } = closureOf(src, entry, direct);
  const out: string[] = [];
  for (const f of files) {
    if (FORBIDDEN.includes(f)) out.push(`${entry} reaches ${f}`);
    // The classes of the legacy adapter, named in code (the engine's own files are not scanned: the facade re-exports the adapter).
    const text = src.read(f);
    if (text !== null && !f.startsWith('src/sje/') && /\bLegacy(Scene|Shape)\b/.test(code(text))) out.push(`${entry}: ${f} names LegacyScene or LegacyShape`);
  }
  if (!direct) for (const b of boundary) out.push(`${entry} imports the game file ${b} by value (load it with a dynamic import())`);
  return [...out, ...dynamicProblems(entry, dynamics)];
}

/** A dynamic import from a tool must load another tool file, the engine glue under `src/sje`, or one of the named game files. */
function dynamicProblems(entry: string, dynamics: Array<{ file: string; target: string }>): string[] {
  const ok = (d: { file: string; target: string }): boolean => {
    const t = d.target;
    if (BATTLE_TEST_DYNAMIC.includes(t)) return isBattleTestFile(d.file);
    return !GAME_BOUNDARY.includes(t) && (t.startsWith('src/dev/') || t.startsWith('src/sje/') || t.startsWith('src/sje-lab/') || DYNAMIC_GAME.includes(t));
  };
  return dynamics.filter((d) => !ok(d)).map((d) => `${entry}: ${d.file} loads ${d.target} with a dynamic import() (not a tool file, the engine glue or a named game file)`);
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
// The Battle Test glue is the exemption itself, so it is not an entry: its old-engine lines are what the named list allows (its callers are checked).
const ENTRIES = [...filesUnder('src/dev').filter((f) => f !== BATTLE_TEST_GLUE), 'src/devroutes.ts', 'src/sje-lab/stagelab.ts', 'src/sje-lab/lab.ts'].sort();

describe('ET pass line 2: no old engine in tool code', () => {
  it('the scan sees the tools of the brief', () => {
    for (const named of ['src/dev/devmenu.ts', 'src/dev/fxlab.ts', 'src/dev/rigedit.ts', 'src/dev/artreview.ts', 'src/dev/artswap.ts', 'src/dev/fieldshow.ts', 'src/devroutes.ts', 'src/sje-lab/stagelab.ts', 'src/sje-lab/lab.ts', 'src/dev/stageedit/stageedit.ts', 'src/dev/stageedit/battletest.ts', 'src/dev/stageedit/battledialog.ts']) {
      expect(ENTRIES, named).toContain(named);
    }
  });

  it.each(ENTRIES)('%s reaches no file of the old engine and names no LegacyScene or LegacyShape', (entry) => {
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
    const { files } = closureOf(disk, 'src/dev/stageedit/stageedit.ts');
    expect(files.has('src/dev/stageedit/host.ts')).toBe(true);
    expect(files.has('src/battlestage/stagescene.ts')).toBe(true);
    expect(files.size).toBeGreaterThan(20);
    expect(problemsOf(disk, 'src/dev/stageedit/stageedit.ts')).toEqual([]);
    // No editor file imports Phaser (it is gone from the project).
    for (const f of filesUnder('src/dev/stageedit')) expect(code(readFileSync(join(ROOT, f), 'utf8')), f).not.toMatch(/from\s*['"]phaser['"]/);
  });

  it('Battle Test: its own files are engine-free, and it loads the named glue module and nothing else of the old engine with a dynamic import()', () => {
    const { files, dynamics, boundary } = closureOf(disk, 'src/dev/stageedit/battletest.ts');
    expect(problemsOf(disk, 'src/dev/stageedit/battletest.ts')).toEqual([]);
    expect(problemsOf(disk, 'src/dev/stageedit/battledialog.ts')).toEqual([]);
    expect(problemsOf(disk, 'src/dev/stageedit/stageedit.ts')).toEqual([]);
    // The glue and the battle scene are loaded, never imported by value.
    expect(files.has(BATTLE_TEST_GLUE)).toBe(false);
    expect(files.has('src/scenes/battle.ts')).toBe(false);
    expect(boundary.size).toBe(0);
    expect(dynamics.filter((d) => d.file === 'src/dev/stageedit/battletest.ts').map((d) => d.target)).toEqual([BATTLE_TEST_GLUE]);
  });

  it('Battle Test: the named list is exactly the battle scene and ONE glue module, and both exist', () => {
    expect(BATTLE_TEST_DYNAMIC).toEqual(['src/scenes/battle.ts', 'src/dev/stageedit/battleglue.ts']);
    for (const f of BATTLE_TEST_DYNAMIC) expect(existsSync(join(ROOT, f)), f).toBe(true);
    // M8c: the battle scene sends its effects to `game.fx`, so no tool file, the glue included, imports `engine/postfx` any more.
    const importsPostfx = /from\s*['"][^'"]*engine\/postfx['"]/;
    const users = filesUnder('src/dev').filter((f) => importsPostfx.test(code(readFileSync(join(ROOT, f), 'utf8'))));
    expect(users).toEqual([]);
    // Control: the scan finds an import of it.
    expect(importsPostfx.test("import { postfx } from '../../engine/postfx';")).toBe(true);
  });

  it('the FX lab is a Scene of the new engine, not a LegacyShape', () => {
    const lab = readFileSync(join(ROOT, 'src/dev/fxlab.ts'), 'utf8');
    expect(code(lab)).toMatch(/class FxLabScene extends (CanvasViewScene|Scene)\b/);
    expect(code(lab)).not.toMatch(/\bLegacyShape\b/);
  });

  it('the build files and the art scripts name no path under src/engine (pass line 3)', () => {
    expect(readFileSync(join(ROOT, 'vite.config.ts'), 'utf8')).not.toMatch(/src\/engine/);
    for (const f of readdirSync(join(ROOT, 'scripts/pixellab')).filter((n) => n.endsWith('.mjs'))) {
      expect(readFileSync(join(ROOT, 'scripts/pixellab', f), 'utf8'), f).not.toMatch(/\/src\/engine\//);
    }
  });

  // ---- controls: the scan can fail ----
  const made = (files: Record<string, string>): Source => ({ read: (f) => files[f] ?? null });

  it('control: a tool that imports postfx directly fails', () => {
    const g = made({ 'src/dev/a.ts': "import { postfx } from '../engine/postfx';\nexport const x = postfx;", 'src/engine/postfx.ts': 'export const postfx = 1;' });
    expect(problemsOf(g, 'src/dev/a.ts')).toEqual(['src/dev/a.ts reaches src/engine/postfx.ts']);
  });

  it('control: a forbidden edge two files down fails (the FX lab reached postfx through gpufx)', () => {
    const g = made({
      'src/dev/a.ts': "import { spell } from '../scenes/kit/gpufx';\nexport { spell };",
      'src/scenes/kit/gpufx.ts': "import { playMoment } from '../../engine/moments';\nexport const spell = playMoment;",
      'src/engine/moments.ts': "import { postfx } from './postfx';\nexport const playMoment = postfx;",
      'src/engine/postfx.ts': 'export const postfx = 1;',
    });
    expect(problemsOf(g, 'src/dev/a.ts')).toEqual(['src/dev/a.ts reaches src/engine/moments.ts', 'src/dev/a.ts reaches src/engine/postfx.ts']);
  });

  it('control: a type-only import of the old engine passes, a value import of the same file fails', () => {
    const base = { 'src/engine/game.ts': 'export class Game {}' };
    expect(problemsOf(made({ ...base, 'src/dev/a.ts': "import type { Game } from '../engine/game';" }), 'src/dev/a.ts')).toEqual([]);
    expect(problemsOf(made({ ...base, 'src/dev/a.ts': "import { type Game } from '../engine/game';" }), 'src/dev/a.ts')).toEqual([]);
    expect(problemsOf(made({ ...base, 'src/dev/a.ts': "import { Game } from '../engine/game';" }), 'src/dev/a.ts')).toEqual(['src/dev/a.ts reaches src/engine/game.ts']);
    expect(problemsOf(made({ ...base, 'src/dev/a.ts': "import { type Game, Scene } from '../engine/game';" }), 'src/dev/a.ts')).toEqual(['src/dev/a.ts reaches src/engine/game.ts']);
    expect(problemsOf(made({ ...base, 'src/dev/a.ts': "export { Game } from '../engine/game';" }), 'src/dev/a.ts')).toEqual(['src/dev/a.ts reaches src/engine/game.ts']);
  });

  it('control: LegacyShape or LegacyScene named in code fails, named in a comment passes', () => {
    expect(problemsOf(made({ 'src/dev/a.ts': 'export class L implements LegacyShape<void> {}' }), 'src/dev/a.ts')).toEqual(['src/dev/a.ts: src/dev/a.ts names LegacyScene or LegacyShape']);
    expect(problemsOf(made({ 'src/dev/a.ts': '// was a LegacyScene\n/* LegacyShape */\nexport const x = 1;' }), 'src/dev/a.ts')).toEqual([]);
  });

  it('control: a tool that imports a game scene by value fails (it is followed into the old engine), a dynamic import of a game file fails too', () => {
    const base = { 'src/scenes/battle.ts': "import { Scene } from '../engine/game';\nexport class BattleScene extends Scene {}", 'src/engine/game.ts': 'export class Scene {}' };
    expect(problemsOf(made({ ...base, 'src/dev/a.ts': "import { BattleScene } from '../scenes/battle';" }), 'src/dev/a.ts')).toEqual(['src/dev/a.ts reaches src/engine/game.ts']);
    expect(problemsOf(made({ ...base, 'src/dev/a.ts': "export const load = () => import('../scenes/battle');" }), 'src/dev/a.ts')).toEqual(["src/dev/a.ts: src/dev/a.ts loads src/scenes/battle.ts with a dynamic import() (not a tool file, the engine glue or a named game file)"]);
  });

  describe('control: the Battle Test exemption has edges', () => {
    const old = {
      'src/scenes/battle.ts': "import { Scene } from '../engine/game';\nexport class BattleScene extends Scene {}",
      'src/scenes/field.ts': "import { Scene } from '../engine/game';\nexport class FieldScene extends Scene {}",
      'src/dev/stageedit/battleglue.ts': "import { BattleScene } from '../../scenes/battle';\nimport { postfx } from '../../engine/postfx';\nexport const g = [BattleScene, postfx];",
      'src/engine/game.ts': 'export class Scene {}',
      'src/engine/postfx.ts': 'export const postfx = 1;',
    };
    const bt = 'src/dev/stageedit/battletest.ts';

    it('a dynamic import of the glue, or of the battle scene, from a Battle Test file passes', () => {
      expect(problemsOf(made({ ...old, [bt]: "export const go = () => import('./battleglue');" }), bt)).toEqual([]);
      expect(problemsOf(made({ ...old, [bt]: "export const go = () => import('../../scenes/battle');" }), bt)).toEqual([]);
    });

    it('a STATIC import of the battle scene or of the glue from a Battle Test file fails', () => {
      expect(problemsOf(made({ ...old, [bt]: "import { BattleScene } from '../../scenes/battle';\nexport const x = BattleScene;" }), bt)).toEqual(['src/dev/stageedit/battletest.ts reaches src/engine/game.ts']);
      expect(problemsOf(made({ ...old, [bt]: "import { g } from './battleglue';\nexport const x = g;" }), bt).sort()).toEqual(['src/dev/stageedit/battletest.ts reaches src/engine/game.ts', 'src/dev/stageedit/battletest.ts reaches src/engine/postfx.ts'].sort());
    });

    it('a dynamic import of ANY OTHER old-engine file from a Battle Test file fails', () => {
      const out = problemsOf(made({ ...old, [bt]: "export const go = () => import('../../scenes/field');" }), bt);
      expect(out).toHaveLength(1);
      expect(out[0]).toContain('src/scenes/field.ts');
    });

    it('the named files are for Battle Test files only: another tool file that loads them fails', () => {
      const out = problemsOf(made({ ...old, 'src/dev/a.ts': "export const go = () => import('../scenes/battle');" }), 'src/dev/a.ts');
      expect(out).toHaveLength(1);
      expect(out[0]).toContain('src/scenes/battle.ts');
      expect(problemsOf(made({ ...old, 'src/dev/a.ts': "export const go = () => import('./stageedit/battleglue');" }), 'src/dev/a.ts')).toHaveLength(1);
    });

    it('the glue itself is the exemption (it reaches the old engine), so it is the only file left out of the entries', () => {
      expect(problemsOf(made(old), BATTLE_TEST_GLUE).length).toBeGreaterThan(0);
      expect(ENTRIES).not.toContain(BATTLE_TEST_GLUE);
    });
  });

  it('control: a tool that dynamically imports a src/sje file that reaches the old engine fails; a clean src/sje file passes; src/sje/boot.ts fails', () => {
    const g = {
      'src/sje/glue.ts': "import { Game } from '../engine/game';\nexport const g = Game;",
      'src/sje/clean.ts': "import { x } from './other';\nexport const c = x;",
      'src/sje/other.ts': 'export const x = 1;',
      'src/sje/boot.ts': "import { Game } from '../engine/game';\nexport const b = Game;",
      'src/engine/game.ts': 'export class Game {}',
    };
    expect(problemsOf(made({ ...g, 'src/dev/a.ts': "export const l = () => import('../sje/glue');" }), 'src/dev/a.ts')).toEqual(['src/dev/a.ts reaches src/engine/game.ts']);
    expect(problemsOf(made({ ...g, 'src/dev/a.ts': "export const l = () => import('../sje/clean');" }), 'src/dev/a.ts')).toEqual([]);
    expect(problemsOf(made({ ...g, 'src/dev/a.ts': "export const l = () => import('../sje/boot');" }), 'src/dev/a.ts')).toHaveLength(1);
  });

  it('control: a DIRECT_ONLY file may start a game scene, but its own old-engine import fails', () => {
    const base = { 'src/scenes/field.ts': "import { Scene } from '../engine/game';\nexport class FieldScene {}", 'src/engine/game.ts': 'export class Scene {}' };
    expect(problemsOf(made({ ...base, 'src/devroutes.ts': "import { FieldScene } from './scenes/field';" }), 'src/devroutes.ts')).toEqual([]);
    expect(problemsOf(made({ ...base, 'src/devroutes.ts': "import { Scene } from './engine/game';" }), 'src/devroutes.ts')).toEqual(['src/devroutes.ts reaches src/engine/game.ts']);
  });

  it('control: the scan reads the disk (the FX lab has a closure of more than one file)', () => {
    expect(closureOf(disk, 'src/dev/fxlab.ts').files.size).toBeGreaterThan(5);
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
