/**
 * The import rules of the engine (docs/engine/README.md section 4, tooling-and-testing.md section 9).
 * Biome's `noRestrictedImports` (biome.json) catches the library rules while you type; this scan is
 * the second, independent check that runs in `npm test`:
 *
 *  1. `pixi.js` is imported only under src/sje/render and src/sje/display. Game code never imports it.
 *  2. `three` is imported nowhere yet (it arrives with the lazy 3D chunk, M1b).
 *  3. Dependencies point DOWN the levels: core 0, render 1, display 2, runtime 3, facade 4.
 *  4. Game code reaches the engine only through the facade, `src/sje/index.ts`. The one exception
 *     is the old engine's `game.ts`, which takes `W` and `H` from `src/sje/core/size.ts` (M0).
 *  5. The new engine never imports the old one.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'node_modules') files(p, out);
    } else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(p);
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
const isPixi = (spec: string) => spec === 'pixi.js' || spec.startsWith('pixi.js/');
const isThree = (spec: string) => spec === 'three' || spec.startsWith('three/');

describe('library imports', () => {
  it('pixi.js is imported only under src/sje/render and src/sje/display (and not by game code, tests, e2e or scripts)', () => {
    const bad = all.filter((e) => isPixi(e.spec) && !/^src\/sje\/(render|display)\//.test(e.file));
    expect(bad.map((e) => `${e.file} imports ${e.spec}`)).toEqual([]);
    // And the scan is alive: it does see the legitimate imports.
    expect(all.some((e) => isPixi(e.spec) && e.file.startsWith('src/sje/display/'))).toBe(true);
    expect(all.some((e) => isPixi(e.spec) && e.file.startsWith('src/sje/render/'))).toBe(true);
  });

  it('three is not imported anywhere yet (it arrives with the lazy 3D chunk in M1b: src/sje/three and src/hack3d)', () => {
    const bad = all.filter((e) => isThree(e.spec));
    expect(bad.map((e) => `${e.file} imports ${e.spec}`)).toEqual([]);
  });

  it('the scan really finds imports (guards against a regex that silently matches nothing)', () => {
    expect(importsOf("import { A } from 'a';\nimport 'b';\nexport * from 'c';\nconst x = import('d');\nimport {\n  E,\n} from 'e';")).toEqual(['a', 'c', 'e', 'b', 'd']);
    expect(all.length).toBeGreaterThan(100);
  });

  it('pixi.js and three are pinned to the exact versions of the design (no ^ or ~)', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.['pixi.js']).toBe('8.22.0');
    expect(pkg.dependencies?.three).toBe('0.186.1');
  });
});

describe('levels: dependencies point down', () => {
  /** The level of a repo-relative path inside src/sje (with or without .ts), or null. */
  const level = (path: string): number | null => {
    const p = path.replace(/\.ts$/, '');
    if (p === 'src/sje/index') return 4;
    const m = /^src\/sje\/(core|render|display|runtime|three)\//.exec(p);
    return m ? { core: 0, render: 1, display: 2, runtime: 3, three: 5 }[m[1] as 'core'] : null;
  };
  const sje = edges(['src/sje']);

  it('no file under src/sje imports anything above its own level, or outside src/sje', () => {
    const problems: string[] = [];
    for (const e of sje) {
      if (!e.target) continue;
      const own = level(e.file);
      if (!e.target.startsWith('src/sje')) {
        problems.push(`${e.file} imports outside the engine: ${e.spec}`);
        continue;
      }
      const target = level(e.target);
      if (own !== null && target !== null && target > own) problems.push(`${e.file} (level ${own}) imports ${e.spec} (level ${target})`);
    }
    expect(problems).toEqual([]);
  });

  it('level 0 (core) imports nothing at all: no Pixi, no other level', () => {
    const bad = sje.filter((e) => e.file.startsWith('src/sje/core/') && e.spec !== '').filter((e) => !(e.target?.startsWith('src/sje/core/') ?? false));
    expect(bad.map((e) => `${e.file} imports ${e.spec}`)).toEqual([]);
  });

  it('level 1 (render) imports only core; level 2 (display) only core and render', () => {
    const render = sje.filter((e) => e.file.startsWith('src/sje/render/') && e.target).filter((e) => !/^src\/sje\/(core|render)\//.test(e.target ?? ''));
    expect(render.map((e) => `${e.file} imports ${e.spec}`)).toEqual([]);
    const display = sje.filter((e) => e.file.startsWith('src/sje/display/') && e.target).filter((e) => !/^src\/sje\/(core|render|display)\//.test(e.target ?? ''));
    expect(display.map((e) => `${e.file} imports ${e.spec}`)).toEqual([]);
  });
});

describe('who may import the engine', () => {
  const toEngine = (e: Edge) => e.target !== null && (e.target === 'src/sje' || e.target.startsWith('src/sje/'));

  it('game code, the lab and the tests that are not engine tests import only the facade, src/sje/index.ts', () => {
    const outside = all.filter((e) => toEngine(e) && !e.file.startsWith('src/sje/') && !e.file.startsWith('tests/') && !e.file.startsWith('e2e/'));
    const notFacade = outside.filter((e) => e.target !== 'src/sje' && e.target !== 'src/sje/index');
    // The ONE old-engine change allowed by M0: game.ts takes W and H from the size module.
    expect(notFacade.map((e) => `${e.file} -> ${e.target}`)).toEqual(['src/engine/game.ts -> src/sje/core/size']);
  });

  it('in the shipped game, only src/engine/game.ts touches the engine (the lab page is dev-only)', () => {
    const shippedUsers = all.filter((e) => toEngine(e) && e.file.startsWith('src/') && !e.file.startsWith('src/sje/') && !e.file.startsWith('src/sje-lab/'));
    expect([...new Set(shippedUsers.map((e) => e.file))]).toEqual(['src/engine/game.ts']);
  });

  it('nothing in the lab or the shipped game is reachable from index.html (the lab page is not a build input)', () => {
    const config = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
    expect(config).not.toMatch(/sjelab/);
    expect(readFileSync(join(ROOT, 'index.html'), 'utf8')).not.toMatch(/sjelab|sje-lab/);
  });
});
