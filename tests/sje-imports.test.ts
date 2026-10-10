/**
 * The import rules of the engine (docs/engine/README.md section 4, tooling-and-testing.md section 9).
 * Biome's `noRestrictedImports` (biome.json) catches the library rules while you type; this scan is
 * the second, independent check that runs in `npm test`:
 *
 *  1. `pixi.js` is imported only under src/sje/render, src/sje/display and src/sje/fx (the effects, M2), plus the lab (src/sje-lab)
 *     and the unit tests, which test Pixi directly. Game code never imports it.
 *  2. `three` is imported only under src/sje/three and src/hack3d (the lazy 3D chunk), plus the lab and
 *     the tests. In the lab only `threelab.ts` imports it, and the lab's other files load that file
 *     through a dynamic `import()`, so the lab's first download holds no Three (the real game will do
 *     the same through the door in src/hack3d/door.ts, M7). The built bundle is checked too
 *     (scripts/bundle-budget.mjs).
 *  3. Dependencies point DOWN the levels: core 0, render 1, display 2, fx 2.5 (the effects), runtime 3, facade 4, three 5.
 *  4. Game code reaches the engine only through the facade, `src/sje/index.ts`. The exceptions are the old engine's
 *     files, which take `W` and `H` from `src/sje/core/size.ts` (M0), the `Rng` re-export (`src/engine/rng.ts`, M1), the
 *     type-only `implements GameApi` line (M1), and `src/main.ts`, which loads `src/sje/boot.ts` with a dynamic import (M1).
 *  5. Raw GL state calls (bindFramebuffer, readPixels, clearColor, pixelStorei, getError...) appear
 *     only in src/sje/render/glhandoff.ts: GlHandoff is the one hand-off point.
 *  6. The new engine never imports the old one. M1 allows exactly two seams, both checked below: `src/sje/boot.ts` (the glue that joins
 *     the new `Game` to the game's own boot; only `src/main.ts` may import it, and only with a dynamic `import()`) and TYPE-ONLY imports of
 *     the old `Input` in three runtime files (`game.ts`, `gameapi.ts`, `input.ts`).
 *  7. Phaser is imported nowhere.
 *  8. (M3) The battle stage, `src/battlestage`, is game code that runs ON the engine: it takes the engine from the facade only, holds no Pixi or Three,
 *     and only the lab, the engine's boot glue and the tests import it. The game font moved into the engine (`src/sje/display/font.ts`); the old path re-exports it.
 *  9. (M5) The field stage, `src/fieldstage`, follows rule 8. The field scene reaches it only through `src/scenes/fieldkit/fieldseam.ts`, which holds types and a provider slot.
 *
 * Differences from the spike's copy (`spike/engine-platform:tests/sje-imports.test.ts`): M0 has no
 * runtime beyond `glrenderer.ts`, no `src/hack3d` and no battle stage, so those parts of the scan
 * come with their milestones (M1, M3, M7).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * Every source file under `dir`, except `src/sje/interfaces.check.ts`: that file is the generated, types-only mirror of the design sketches
 * (scripts/sync-interface-check.mjs). It names Three and GL calls in its comments and signatures, and imports nothing that runs.
 */
function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'node_modules') files(p, out);
    } else if (/\.(ts|tsx|mjs|js)$/.test(name) && name !== 'interfaces.check.ts') out.push(p);
  }
  return out;
}

/** Every module name a file imports: static, side-effect, re-export and dynamic forms. */
function importsOf(text: string): string[] {
  const found: string[] = [];
  const patterns = [
    /^[ \t]*(?:import|export)\b[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/gm, // import x from 'm' / export * from 'm' (any number of lines)
    /^[ \t]*import\s*['"]([^'"]+)['"]/gm, // import 'm'
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g, // import('m')
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) for (const m of text.matchAll(re)) if (m[1]) found.push(m[1]);
  return found;
}

interface Edge {
  file: string; // repo-relative, forward slashes
  spec: string;
  /** For a relative import: the repo-relative path it points at (no extension). Otherwise null. */
  target: string | null;
}

function edges(dirs: string[]): Edge[] {
  const out: Edge[] = [];
  for (const d of dirs) {
    for (const f of files(join(ROOT, d))) {
      const rel = relative(ROOT, f).split(sep).join('/');
      for (const spec of importsOf(readFileSync(f, 'utf8'))) {
        const target = spec.startsWith('.') ? relative(ROOT, resolve(dirname(f), spec)).split(sep).join('/') : null;
        out.push({ file: rel, spec, target });
      }
    }
  }
  return out;
}

const all = edges(['src', 'tests', 'e2e', 'scripts']);

/** Is every import of `spec` in `text` an `import type`? (A type-only import is erased: it adds no code to any bundle.) */
function onlyTypeImports(text: string, spec: string): boolean {
  const escaped = spec.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const re = new RegExp(`^[ \\t]*(?:import|export)\\s+(type\\s+)?[^;'"]*?\\bfrom\\s*['"]${escaped}['"]`, 'gm');
  const found = [...text.matchAll(re)];
  return found.length > 0 && found.every((m) => m[1] !== undefined);
}

/** The runtime files that may name the old engine, and the one old file each may name: a TYPE only (M1 tasks 6 and 8). */
const OLD_ENGINE_TYPES: Readonly<Record<string, readonly string[]>> = {
  'src/sje/runtime/game.ts': ['src/engine/input'],
  'src/sje/runtime/gameapi.ts': ['src/engine/input'],
  'src/sje/runtime/input.ts': ['src/engine/input'],
};

/**
 * Every import in `src/sje` that leaves `src/sje` and is not allowed. `read` gives a file's text. Pure, so a test can run it on made-up
 * edges (the negative control below).
 */
function leavingTheEngine(edgeList: Edge[], read: (file: string) => string): string[] {
  const problems: string[] = [];
  for (const e of edgeList) {
    if (!e.target || e.target.startsWith('src/sje')) continue;
    // The glue file joins the two engines: it may import anything.
    if (e.file === 'src/sje/boot.ts') continue;
    const allowed = OLD_ENGINE_TYPES[e.file];
    if (allowed?.includes(e.target) && onlyTypeImports(read(e.file), e.spec)) continue;
    problems.push(`${e.file} imports outside the engine: ${e.spec}`);
  }
  return problems;
}
const isPixi = (spec: string) => spec === 'pixi.js' || spec.startsWith('pixi.js/');
const isThree = (spec: string) => spec === 'three' || spec.startsWith('three/');

describe('library imports', () => {
  it('pixi.js is imported only under src/sje/render, src/sje/display and src/sje/fx, the lab and the tests (not by game code, e2e or scripts)', () => {
    const bad = all.filter((e) => isPixi(e.spec) && !/^(src\/sje\/(render|display|fx)|src\/sje-lab|tests)\//.test(e.file));
    expect(bad.map((e) => `${e.file} imports ${e.spec}`)).toEqual([]);
    // And the scan is alive: it does see the legitimate imports.
    expect(all.some((e) => isPixi(e.spec) && e.file.startsWith('src/sje/display/'))).toBe(true);
    expect(all.some((e) => isPixi(e.spec) && e.file.startsWith('src/sje/render/'))).toBe(true);
    expect(all.some((e) => isPixi(e.spec) && e.file.startsWith('src/sje/fx/'))).toBe(true);
  });

  it('three is imported only under src/sje/three, src/hack3d, the lab and the tests', () => {
    const bad = all.filter((e) => isThree(e.spec) && !/^(src\/(sje\/three|hack3d|sje-lab)|tests)\//.test(e.file));
    expect(bad.map((e) => `${e.file} imports ${e.spec}`)).toEqual([]);
    // And the scan is alive: the chunk really does import it.
    expect(all.some((e) => isThree(e.spec) && e.file.startsWith('src/sje/three/'))).toBe(true);
  });

  it('in the lab only threelab.ts and cubescene.ts (the cube scene it loads) import Three or the 3D chunk as a value, and the rest of the lab loads them dynamically (so the first download holds no Three)', () => {
    const problems: string[] = [];
    for (const f of files(join(ROOT, 'src/sje-lab'))) {
      const rel = relative(ROOT, f).split(sep).join('/');
      if (rel === 'src/sje-lab/threelab.ts' || rel === 'src/sje-lab/cubescene.ts') continue;
      const text = readFileSync(f, 'utf8');
      // Every static import or re-export statement, with whether it says `type`.
      for (const m of text.matchAll(/^[ \t]*(?:import|export)\s+(type\s+)?[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/gm)) {
        const spec = m[2] ?? '';
        const toChunk = isThree(spec) || /(^|\/)sje\/three(\/|$)/.test(spec) || /(^|\/)(threelab|cubescene)$/.test(spec);
        if (toChunk && !m[1]) problems.push(`${rel} imports ${spec} as a value`);
      }
    }
    expect(problems).toEqual([]);
    // The lazy boundary exists (the scan is not passing because it found nothing).
    expect(readFileSync(join(ROOT, 'src/sje-lab/hook.ts'), 'utf8')).toMatch(/import\('\.\/threelab'\)/);
    // The cube scene is reached only through threelab.ts (which is itself loaded lazily), and it is the 3D scene M1b proves.
    const importers = files(join(ROOT, 'src')).filter((f) => /from\s*['"]\.\/cubescene['"]/.test(readFileSync(f, 'utf8')));
    expect(importers.map((f) => relative(ROOT, f).split(sep).join('/'))).toEqual(['src/sje-lab/threelab.ts']);
  });

  it('nothing in the shipped game (outside src/sje, src/sje-lab, src/hack3d) imports Pixi, Three or the lab', () => {
    const bad = all.filter((e) => e.file.startsWith('src/') && !/^src\/(sje|sje-lab|hack3d)\//.test(e.file) && (isPixi(e.spec) || isThree(e.spec) || /sje-lab|hack3d/.test(e.spec)));
    expect(bad.map((e) => `${e.file} imports ${e.spec}`)).toEqual([]);
  });

  it('the scan really finds imports (guards against a regex that silently matches nothing)', () => {
    expect(importsOf("import { A } from 'a';\nimport 'b';\nexport * from 'c';\nconst x = import('d');\nimport {\n  E,\n} from 'e';")).toEqual(['a', 'c', 'e', 'b', 'd']);
    expect(all.length).toBeGreaterThan(100);
  });

  it('pixi.js and three are pinned to the exact versions of the design (no ^ or ~)', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(pkg.dependencies?.['pixi.js']).toBe('8.22.0');
    expect(pkg.dependencies?.three).toBe('0.186.1');
    // Three ships no types; the DefinitelyTyped package for the same release is pinned exactly too.
    expect(pkg.devDependencies?.['@types/three']).toBe('0.186.0');
  });
});

describe('levels: dependencies point down', () => {
  /** The level of a repo-relative path inside src/sje (with or without .ts), or null. */
  const level = (path: string): number | null => {
    const p = path.replace(/\.ts$/, '');
    if (p === 'src/sje/index') return 4;
    const m = /^src\/sje\/(core|render|display|fx|runtime|three)\//.exec(p);
    return m ? { core: 0, render: 1, display: 2, fx: 2.5, runtime: 3, three: 5 }[m[1] as 'core'] : null;
  };
  const sje = edges(['src/sje']);

  it('no file under src/sje imports anything above its own level, or outside src/sje (the new engine never imports the old one)', () => {
    const problems: string[] = [];
    for (const e of sje) {
      if (!e.target || !e.target.startsWith('src/sje')) continue;
      const own = level(e.file);
      const target = level(e.target);
      if (own !== null && target !== null && target > own) problems.push(`${e.file} (level ${own}) imports ${e.spec} (level ${target})`);
    }
    expect(problems).toEqual([]);
    // Leaving src/sje is allowed only at the two M1 seams (see the file comment, rule 6).
    expect(leavingTheEngine(sje, (f) => readFileSync(join(ROOT, f), 'utf8'))).toEqual([]);
  });

  it('the seam check is alive: a value import of the old engine, a type import in a file that is not on the list, and a second old file all fail', () => {
    const edge = (file: string, spec: string, target: string): Edge => ({ file, spec, target });
    const typeOnly = "import type { Input } from '../../engine/input';";
    const value = "import { Input } from '../../engine/input';";
    // Allowed: the listed file, the listed target, type only.
    expect(leavingTheEngine([edge('src/sje/runtime/game.ts', '../../engine/input', 'src/engine/input')], () => typeOnly)).toEqual([]);
    // A value import of the same file: it would put old engine code in the new chunk.
    expect(leavingTheEngine([edge('src/sje/runtime/game.ts', '../../engine/input', 'src/engine/input')], () => value)).toHaveLength(1);
    // Another runtime file with the same type import is not on the list.
    expect(leavingTheEngine([edge('src/sje/runtime/legacyscene.ts', '../../engine/input', 'src/engine/input')], () => typeOnly)).toHaveLength(1);
    // The listed file naming a second old file.
    expect(leavingTheEngine([edge('src/sje/runtime/game.ts', '../../engine/errors', 'src/engine/errors')], () => "import type { X } from '../../engine/errors';")).toHaveLength(1);
    // `import type` is told apart from a value import that merely says `type` inside the braces.
    expect(onlyTypeImports("import { type Input } from '../../engine/input';", '../../engine/input')).toBe(false);
    expect(onlyTypeImports(typeOnly, '../../engine/input')).toBe(true);
  });

  it('level 0 (core) imports nothing at all: no Pixi, no other level', () => {
    const bad = sje.filter((e) => e.file.startsWith('src/sje/core/')).filter((e) => !(e.target?.startsWith('src/sje/core/') ?? false));
    expect(bad.map((e) => `${e.file} imports ${e.spec}`)).toEqual([]);
  });

  it('level 1 (render) imports only core; level 2 (display) only core and render', () => {
    const render = sje.filter((e) => e.file.startsWith('src/sje/render/') && e.target).filter((e) => !/^src\/sje\/(core|render)\//.test(e.target ?? ''));
    expect(render.map((e) => `${e.file} imports ${e.spec}`)).toEqual([]);
    const display = sje.filter((e) => e.file.startsWith('src/sje/display/') && e.target).filter((e) => !/^src\/sje\/(core|render|display)\//.test(e.target ?? ''));
    expect(display.map((e) => `${e.file} imports ${e.spec}`)).toEqual([]);
  });
});

describe('level 2.5 (src/sje/fx, the effects): what it may import', () => {
  it('imports only core, render, display and itself (never the runtime: the runtime owns it), and no Three', () => {
    const fx = edges(['src/sje/fx']);
    const bad = fx.filter((e) => e.target !== null).filter((e) => !/^src\/sje\/(core|render|display|fx)(\/|$)/.test(e.target ?? ''));
    expect(bad.map((e) => `${e.file} imports ${e.spec}`)).toEqual([]);
    expect(fx.filter((e) => isThree(e.spec)).map((e) => e.file)).toEqual([]);
    // The scan is alive: the effects really do import display and render.
    expect(fx.some((e) => e.target?.startsWith('src/sje/display/'))).toBe(true);
    expect(fx.some((e) => e.target?.startsWith('src/sje/render/'))).toBe(true);
  });

  it('the two plain files the OLD engine shares (the effects state and the particle simulation) hold no Pixi, no GL and no import of the effects drawing', () => {
    for (const f of ['src/sje/fx/fxstate.ts', 'src/sje/fx/particles.ts', 'src/sje/fx/fxdata.ts']) {
      const specs = importsOf(readFileSync(join(ROOT, f), 'utf8'));
      expect(specs.filter((s) => isPixi(s) || isThree(s)), f).toEqual([]);
      expect(specs.filter((s) => s.startsWith('.') && !/^\.\.?\/(core\/size|particles|fxstate|fxdata)$/.test(s)), f).toEqual([]);
    }
  });
});

describe('level 5 (src/sje/three, the lazy 3D chunk): what it may import', () => {
  // @deviation from docs/engine/README.md section 4, which says level 5 imports "levels 4 and 1". The code reaches the parts it
  // needs directly: core (size), render (the frame textures), display (View3D, depth), runtime (GlRenderer, and Scene from M1b). It never
  // imports the facade, because the facade is not needed and the 3D chunk is loaded lazily. Drift item 23 in docs/spikes/engine-platform.md.
  const three = edges(['src/sje/three']);

  it('imports engine levels 0 to 3 and Three, and nothing else: not the facade, not the game, not the hack scene, not the lab', () => {
    const bad = three.filter((e) => e.target !== null).filter((e) => !/^src\/sje\/(core|render|display|runtime|three)(\/|$)/.test(e.target ?? ''));
    expect(bad.map((e) => `${e.file} imports ${e.spec}`)).toEqual([]);
  });

  it('nothing at levels 0 to 4 imports the 3D chunk (the lazy chunk points down, never up)', () => {
    const up = edges(['src/sje']).filter((e) => !e.file.startsWith('src/sje/three/') && /^src\/sje\/three(\/|$)/.test(e.target ?? ''));
    expect(up.map((e) => `${e.file} imports ${e.spec}`)).toEqual([]);
  });
});

describe('who may import the engine', () => {
  const toEngine = (e: Edge) => e.target !== null && (e.target === 'src/sje' || e.target.startsWith('src/sje/'));
  const outsideEngine = (e: Edge) => toEngine(e) && e.file.startsWith('src/') && !e.file.startsWith('src/sje/') && !e.file.startsWith('src/hack3d/') && !e.file.startsWith('src/battlestage/') && !e.file.startsWith('src/fieldstage/');

  it('the lab imports only the facade, src/sje/index.ts, and the 3D door, src/sje/three/index.ts (plus one named probe)', () => {
    const lab = all.filter((e) => toEngine(e) && e.file.startsWith('src/sje-lab/'));
    const notFacade = lab.filter((e) => e.target !== 'src/sje' && e.target !== 'src/sje/index' && e.target !== 'src/sje/three' && e.target !== 'src/sje/three/index');
    expect(notFacade.map((e) => `${e.file} -> ${e.target}`)).toEqual([]);
  });

  // A static `import ... from './sje/boot'` (the door must be dynamic, or the engine and Pixi land in the entry chunk).
  const STATIC_DOOR = /^[ \t]*import\b[^(]*\bfrom\s*['"]\.\/sje\/boot['"]/m;

  it('the shipped game reaches the engine through nine files only: the size module, the Rng module, the game font (M3), the effects state, the effects data checks, the particle simulation and the GL names module (all plain code: no Pixi, no Three), a types-only file, and the boot door', () => {
    const shipped = all.filter((e) => outsideEngine(e) && !e.file.startsWith('src/sje-lab/'));
    expect([...new Set(shipped.map((e) => e.target))].sort()).toEqual(['src/sje/boot', 'src/sje/core/rng', 'src/sje/core/size', 'src/sje/display/font', 'src/sje/fx/fxdata', 'src/sje/fx/fxstate', 'src/sje/fx/particles', 'src/sje/render/glcontext', 'src/sje/runtime/gameapi']);
    // M2: the old PostFx extends the shared state, the old particle module re-exports the shared simulation, the old presenter takes SOFTWARE_GL from the GL module.
    expect([...new Set(shipped.filter((e) => e.target === 'src/sje/fx/fxstate').map((e) => e.file))]).toEqual(['src/engine/postfx.ts']);
    expect(shipped.filter((e) => e.target === 'src/sje/fx/fxdata').map((e) => e.file)).toEqual(['src/engine/fxdata.ts']);
    expect(shipped.filter((e) => e.target === 'src/sje/fx/particles').map((e) => e.file)).toEqual(['src/engine/particles.ts']);
    expect(shipped.filter((e) => e.target === 'src/sje/render/glcontext').map((e) => e.file)).toEqual(['src/engine/gl/presenter.ts']);
    // glcontext.ts has no import at all, so nothing of Pixi follows it into the old bundle.
    expect(importsOf(readFileSync(join(ROOT, 'src/sje/render/glcontext.ts'), 'utf8'))).toEqual([]);
    // M3: the game font lives in the engine; the old path re-exports it, and the font's one import is the plain assert helper (no Pixi follows it).
    expect(shipped.filter((e) => e.target === 'src/sje/display/font').map((e) => e.file)).toEqual(['src/engine/font.ts']);
    expect(importsOf(readFileSync(join(ROOT, 'src/sje/display/font.ts'), 'utf8'))).toEqual(['../core/assert']);
    // M0 moved every W and H import of the old game to the size module: dozens of files.
    expect(new Set(shipped.filter((e) => e.target === 'src/sje/core/size').map((e) => e.file)).size).toBeGreaterThan(30);
    // The Rng module is reached through the old path's re-export only: no old file changed its import.
    expect(shipped.filter((e) => e.target === 'src/sje/core/rng').map((e) => e.file)).toEqual(['src/engine/rng.ts']);
    // The types file is erased: its one importer says `import type`, so nothing of it reaches the shipped game.
    expect(shipped.filter((e) => e.target === 'src/sje/runtime/gameapi').map((e) => e.file)).toEqual(['src/engine/game.ts']);
    expect(onlyTypeImports(readFileSync(join(ROOT, 'src/engine/game.ts'), 'utf8'), '../sje/runtime/gameapi')).toBe(true);
    // The boot door: only main.ts, and only through a dynamic import(), so the engine and Pixi are a chunk of their own that the default path never fetches.
    expect(shipped.filter((e) => e.target === 'src/sje/boot').map((e) => e.file)).toEqual(['src/main.ts']);
    const main = readFileSync(join(ROOT, 'src/main.ts'), 'utf8');
    expect(main).toMatch(/import\(\s*['"]\.\/sje\/boot['"]\s*\)/);
    expect(main).not.toMatch(STATIC_DOOR);
  });

  it('the door check is alive: a static import of the door is told apart from the dynamic one', () => {
    expect("import { startSje } from './sje/boot';").toMatch(STATIC_DOOR);
    expect("void import('./sje/boot').then(go);").not.toMatch(STATIC_DOOR);
  });

  it('the lab page is not linked from index.html, and vite.config.ts names it only in the `mode === lab` branch', () => {
    const config = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
    // Every code line that names the lab page is a `mode === 'lab'` line (a comment may mention it).
    const named = config.split('\n').filter((l) => /sjelab/.test(l) && !/^\s*(\/\/|\*)/.test(l));
    expect(named.length).toBeGreaterThan(0);
    for (const l of named) expect(l).toMatch(/mode === 'lab'/);
    expect(readFileSync(join(ROOT, 'index.html'), 'utf8')).not.toMatch(/sjelab|sje-lab/);
  });
});

describe('the battle stage (src/battlestage, M3)', () => {
  // The stage is game code that runs ON the engine: it takes the engine from the facade only, and it is not part of the shipped game's default path.
  // Nothing outside it, the lab, the tests and the engine's boot glue may import it (the boot glue loads it behind the flag, M3 task 11).
  const toEngine = (e: Edge) => e.target !== null && (e.target === 'src/sje' || e.target.startsWith('src/sje/'));

  it('imports the engine through the facade, src/sje/index.ts, and never a deeper file', () => {
    const stage = all.filter((e) => e.file.startsWith('src/battlestage/') && toEngine(e));
    expect(stage.filter((e) => e.target !== 'src/sje' && e.target !== 'src/sje/index').map((e) => `${e.file} -> ${e.target}`)).toEqual([]);
    // The scan is alive: the stage really does import the facade.
    expect(stage.length).toBeGreaterThan(0);
  });

  it('is imported only by itself, the lab, the engine boot glue and the tests (not by the default path of the game)', () => {
    const into = all.filter((e) => e.target !== null && (e.target === 'src/battlestage' || e.target.startsWith('src/battlestage/')) && !e.file.startsWith('src/battlestage/'));
    expect(into.filter((e) => !/^(src\/sje-lab\/|src\/sje\/boot\.ts$|tests\/|e2e\/|scripts\/)/.test(e.file)).map((e) => `${e.file} imports ${e.spec}`)).toEqual([]);
  });

  it('holds no Pixi and no Three (they come through the facade)', () => {
    expect(all.filter((e) => e.file.startsWith('src/battlestage/') && (isPixi(e.spec) || isThree(e.spec))).map((e) => `${e.file} imports ${e.spec}`)).toEqual([]);
  });
});

describe('the field stage (src/fieldstage, M5)', () => {
  // Same rules as the battle stage: game code that runs ON the engine, through the facade only, no Pixi and no Three, and not part of the default path. The field
  // scene reaches it only through the seam (`src/scenes/fieldkit/fieldseam.ts`), which holds the types, never the stage's code.
  const toEngine = (e: Edge) => e.target !== null && (e.target === 'src/sje' || e.target.startsWith('src/sje/'));

  it('imports the engine through the facade, src/sje/index.ts, and never a deeper file', () => {
    const stage = all.filter((e) => e.file.startsWith('src/fieldstage/') && toEngine(e));
    expect(stage.filter((e) => e.target !== 'src/sje' && e.target !== 'src/sje/index').map((e) => `${e.file} -> ${e.target}`)).toEqual([]);
    expect(stage.length).toBeGreaterThan(0);
  });

  it('is imported only by itself, the lab, the engine boot glue and the tests (not by the field scene or the default path of the game)', () => {
    const into = all.filter((e) => e.target !== null && (e.target === 'src/fieldstage' || e.target.startsWith('src/fieldstage/')) && !e.file.startsWith('src/fieldstage/'));
    expect(into.filter((e) => !/^(src\/sje-lab\/|src\/sje\/boot\.ts$|tests\/|e2e\/|scripts\/)/.test(e.file)).map((e) => `${e.file} imports ${e.spec}`)).toEqual([]);
  });

  it('holds no Pixi and no Three (they come through the facade)', () => {
    expect(all.filter((e) => e.file.startsWith('src/fieldstage/') && (isPixi(e.spec) || isThree(e.spec))).map((e) => `${e.file} imports ${e.spec}`)).toEqual([]);
  });

  it('the seam (src/scenes/fieldkit/fieldseam.ts) imports no engine file and no stage code: it holds types and the provider slot only', () => {
    const seam = all.filter((e) => e.file === 'src/scenes/fieldkit/fieldseam.ts');
    expect(seam.filter((e) => toEngine(e) || (e.target ?? '').startsWith('src/fieldstage')).map((e) => `${e.file} imports ${e.spec}`)).toEqual([]);
  });
});

describe('Phaser is gone', () => {
  it('no file in src, tests, e2e or scripts imports phaser, and it is not a dependency', () => {
    expect(all.filter((e) => e.spec === 'phaser' || e.spec.startsWith('phaser/')).map((e) => `${e.file} imports ${e.spec}`)).toEqual([]);
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((n) => /phaser/i.test(n))).toEqual([]);
  });
});

describe('GlHandoff is the one hand-off point for raw GL state', () => {
  // A call that changes (or reads back) GL state, on ANY receiver (`gl.`, `ctx.`, `g.`, `this.context.`...). These names exist on GL contexts and
  // nowhere else in this code base (a 2D canvas context has `getImageData`, which is fine). `getExtension` and `getParameter` only ask questions, so they
  // are fine anywhere. (`.readPixels()` with NO arguments is the engine's own Frame3D method, which goes through GlHandoff. Raw GL `readPixels` always
  // has at least four arguments, x, y, width and height; `TextureManager.readPixels(key, frame?)` of M3 has one or two, and is not GL.) A NAMED CARVE-OUT: the GPU timer queries in src/sje-lab/profile.ts (`createQuery`, `beginQuery`, `endQuery`, `getQueryParameter`) are
  // raw GL on purpose. They are a measuring tool of the lab, they read and change no state of the picture, and none of their names is in the list below.
  const RAW_GL = /[.]readPixels[(][^)]*,[^)]*,[^)]*,|[.](?:bindFramebuffer|clearColor|pixelStorei|getError|bindTexture|viewport|useProgram|bindVertexArray|blendFunc|colorMask|scissor|readBuffer|bindBuffer|bindRenderbuffer|framebufferTexture2D|texImage2D|texSubImage2D)[(]|(?:^|[^A-Za-z0-9_])(?:gl|ctx)[.](?:enable|disable)[(]/;

  it('only src/sje/render/glhandoff.ts calls them (not Pixi glue, not Three glue, not the lab hook)', () => {
    const bad: string[] = [];
    for (const f of files(join(ROOT, 'src'))) {
      const rel = relative(ROOT, f).split(sep).join('/');
      if (rel === 'src/sje/render/glhandoff.ts') continue;
      // The old engine has its own GL presenter; it is not part of the new engine's rule.
      if (!/^src\/(sje|sje-lab|hack3d)\//.test(rel)) continue;
      const text = readFileSync(f, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (RAW_GL.test(line) && !/^\s*(\/\/|\*)/.test(line)) bad.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('the scan is alive: glhandoff.ts itself does contain such calls', () => {
    expect(readFileSync(join(ROOT, 'src/sje/render/glhandoff.ts'), 'utf8')).toMatch(RAW_GL);
  });

  it('the scan sees a read on ANY receiver, and leaves 2D canvas calls alone', () => {
    for (const bad of ['g.readPixels(0, 0, 1, 1)', 'const px = this.context.readPixels(0, 0, 1, 1, f, t, buf)', 'x.bindFramebuffer(a, b)', 'ctx.enable(gl.BLEND)']) expect(bad).toMatch(RAW_GL);
    for (const fine of ['ctx.getImageData(0, 0, 4, 4)', 'ctx.fillRect(0, 0, 1, 1)', 'gl.getExtension("X")', 'filters.enable(true)', 'this.renderer.readRenderTargetPixels(t, 0, 0, 1, 1, b)', 'game.textures.readPixels(key)', 'textures.readPixels(key, 3)']) expect(fine).not.toMatch(RAW_GL);
  });
});
