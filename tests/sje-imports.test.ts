/**
 * The import rules of the engine (docs/engine/README.md section 4, tooling-and-testing.md section 9).
 * Biome's `noRestrictedImports` (biome.json) catches the library rules while you type; this scan is
 * the second, independent check that runs in `npm test`:
 *
 *  1. `pixi.js` is imported only under src/sje/render and src/sje/display. Game code never imports it.
 *  2. `three` is imported only under src/sje/three and src/hack3d (the lazy 3D chunk), and the files
 *     the shipped game loads up front (the door, the result types, the lab shell) never import the
 *     chunk except as a TYPE. The built bundle is checked too (scripts/bundle-budget.mjs).
 *  3. Dependencies point DOWN the levels: core 0, render 1, display 2, runtime 3, facade 4.
 *  4. Game code reaches the engine only through the facade, `src/sje/index.ts` (and, for the lazy 3D
 *     chunk, `src/sje/three/index.ts`). The one exception is the old engine's `game.ts`, which takes
 *     `W` and `H` from `src/sje/core/size.ts` (M0).
 *  6. Raw GL state calls (bindFramebuffer, readPixels, clearColor, pixelStorei, getError...) appear
 *     only in src/sje/render/glhandoff.ts: GlHandoff is the one hand-off point (B2, carry-over f).
 *  5. The new engine never imports the old one.
 *  7. Phaser is imported nowhere (the battle stage was ported off it in step B1), and the battle stage (src/battlestage) is dev-only: nothing the
 *     shipped game loads imports it, and it is not reachable from index.html.
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

  it('three is imported only under src/sje/three and src/hack3d, the lazy 3D chunk', () => {
    const bad = all.filter((e) => isThree(e.spec) && !/^(src\/(sje\/three|hack3d)|tests)\//.test(e.file));
    expect(bad.map((e) => `${e.file} imports ${e.spec}`)).toEqual([]);
    // And the scan is alive: the chunk really does import it.
    expect(all.some((e) => isThree(e.spec) && e.file.startsWith('src/sje/three/'))).toBe(true);
    expect(all.some((e) => isThree(e.spec) && e.file.startsWith('src/hack3d/'))).toBe(true);
  });

  it('the files the shipped game loads up front import the 3D chunk only as a TYPE (so Three stays out of the first download)', () => {
    // door.ts and result.ts are the story side of a hack; the lab shell and the lab's story run on the page at once.
    const upFront = ['src/hack3d/door.ts', 'src/hack3d/result.ts', ...files(join(ROOT, 'src/sje-lab')).map((f) => relative(ROOT, f).split(sep).join('/'))];
    const problems: string[] = [];
    for (const rel of upFront) {
      const text = readFileSync(join(ROOT, rel), 'utf8');
      // Every import statement, with whether it says `type`.
      for (const m of text.matchAll(/^[ \t]*(?:import|export)\s+(type\s+)?[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/gm)) {
        const spec = m[2] ?? '';
        const toChunk = isThree(spec) || /(^|\/)sje\/three(\/|$)/.test(spec) || (rel.startsWith('src/sje-lab/') && /hack3d\/(index|hackscene|look|sim)/.test(spec));
        if (toChunk && !m[1]) problems.push(`${rel} imports ${spec} as a value`);
      }
      // A dynamic import() is checked too. The ONE allowed is the door's own: the lazy boundary.
      for (const m of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const spec = m[1] ?? '';
        if ((isThree(spec) || /sje\/three/.test(spec) || /hack3d/.test(spec)) && !(rel === 'src/hack3d/door.ts' && spec === './index')) problems.push(`${rel} loads ${spec} dynamically`);
      }
    }
    expect(problems).toEqual([]);
    // The door has its lazy boundary (the scan above is not passing because it found nothing).
    expect(readFileSync(join(ROOT, 'src/hack3d/door.ts'), 'utf8')).toMatch(/import\('\.\/index'\)/);
  });

  it('nothing in the shipped game (outside src/sje, src/sje-lab, src/hack3d) imports the hack chunk', () => {
    const bad = all.filter((e) => e.target?.startsWith('src/hack3d') && !/^src\/(sje|sje-lab|hack3d)\//.test(e.file) && !e.file.startsWith('tests/') && !e.file.startsWith('e2e/'));
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

describe('level 5 (src/sje/three, the lazy 3D chunk): what it may import', () => {
  // @deviation from docs/engine/README.md section 4, which says level 5 imports "levels 4 and 1". The code reaches the parts it
  // needs directly: core (size), render (the frame textures), display (View3D, depth), runtime (Scene, GlRenderer). It never
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

  it('game code, the lab and the tests that are not engine tests import only the facade, src/sje/index.ts (the lazy 3D chunk also has src/sje/three/index.ts)', () => {
    const outside = all.filter((e) => toEngine(e) && !e.file.startsWith('src/sje/') && !e.file.startsWith('tests/') && !e.file.startsWith('e2e/'));
    const threeFacade = (e: Edge) => (e.target === 'src/sje/three' || e.target === 'src/sje/three/index') && /^src\/(hack3d|sje-lab)\//.test(e.file);
    const notFacade = outside.filter((e) => e.target !== 'src/sje' && e.target !== 'src/sje/index' && !threeFacade(e));
    // The ONE old-engine change allowed by M0: game.ts takes W and H from the size module.
    expect(notFacade.map((e) => `${e.file} -> ${e.target}`)).toEqual(['src/engine/game.ts -> src/sje/core/size']);
  });

  it('in the shipped game, only src/engine/game.ts touches the engine (the lab pages are dev-only, and src/hack3d and src/battlestage are the not-yet-shipped 3D mode and battle stage)', () => {
    const shippedUsers = all.filter((e) => toEngine(e) && e.file.startsWith('src/') && !e.file.startsWith('src/sje/') && !e.file.startsWith('src/sje-lab/') && !e.file.startsWith('src/hack3d/') && !e.file.startsWith('src/battlestage/'));
    expect([...new Set(shippedUsers.map((e) => e.file))]).toEqual(['src/engine/game.ts']);
  });

  it('nothing in the lab or the shipped game is reachable from index.html (the lab page is not a build input)', () => {
    const config = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
    expect(config).not.toMatch(/sjelab|sjestage/);
    expect(readFileSync(join(ROOT, 'index.html'), 'utf8')).not.toMatch(/sjelab|sje-lab|sjestage|battlestage/);
  });

  it('nothing the shipped game loads imports the battle stage (src/battlestage is used by its lab page and the tests only)', () => {
    const bad = all.filter((e) => e.target?.startsWith('src/battlestage') && !/^(src\/(battlestage|sje-lab)|tests|e2e|scripts)\//.test(e.file));
    expect(bad.map((e) => `${e.file} imports ${e.spec}`)).toEqual([]);
    // And the scan is alive: the lab page does import it.
    expect(all.some((e) => e.target?.startsWith('src/battlestage') && e.file.startsWith('src/sje-lab/'))).toBe(true);
  });
});

describe('Phaser is gone', () => {
  it('no file in src, tests, e2e or scripts imports phaser, and it is not a dependency (the battle stage was ported off it, step B1)', () => {
    expect(all.filter((e) => e.spec === 'phaser' || e.spec.startsWith('phaser/')).map((e) => `${e.file} imports ${e.spec}`)).toEqual([]);
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((n) => /phaser/i.test(n))).toEqual([]);
  });

  it('the stage code that was ported (src/battlestage) imports the engine only through its facade, and Pixi never', () => {
    const stage = edges(['src/battlestage']);
    expect(stage.length).toBeGreaterThan(20);
    const toSje = stage.filter((e) => e.target?.startsWith('src/sje'));
    expect(toSje.length).toBeGreaterThan(0);
    expect(toSje.filter((e) => e.target !== 'src/sje' && e.target !== 'src/sje/index').map((e) => `${e.file} imports ${e.spec}`)).toEqual([]);
    expect(stage.filter((e) => isPixi(e.spec) || isThree(e.spec)).map((e) => `${e.file} imports ${e.spec}`)).toEqual([]);
  });
});

describe('GlHandoff is the one hand-off point for raw GL state', () => {
  // A call that changes (or reads back) GL state, on ANY receiver (`gl.`, `ctx.`, `g.`, `this.context.`...). Round 3 matched only `gl.` and `ctx.`,
  // so `const g = ...; g.readPixels(...)` slipped through. These names exist on GL contexts and nowhere else in this code base (a 2D canvas
  // context has `getImageData`, which is fine). `getExtension` and `getParameter` only ask questions, so they are fine anywhere.
  // (`.readPixels()` with NO arguments is the engine's own Frame3D method, which goes through GlHandoff. Raw GL `readPixels` always has arguments.)
  const RAW_GL = /[.]readPixels[(][^)]|[.](?:bindFramebuffer|clearColor|pixelStorei|getError|bindTexture|viewport|useProgram|bindVertexArray|blendFunc|colorMask|scissor|readBuffer|bindBuffer|bindRenderbuffer|framebufferTexture2D|texImage2D|texSubImage2D)[(]|(?:^|[^A-Za-z0-9_])(?:gl|ctx)[.](?:enable|disable)[(]/;

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

  it('the scan sees a read on ANY receiver (the round 3 gap), and leaves 2D canvas calls alone', () => {
    for (const bad of ['g.readPixels(0, 0, 1, 1)', 'const px = this.context.readPixels(0, 0, 1, 1, f, t, buf)', 'x.bindFramebuffer(a, b)', 'ctx.enable(gl.BLEND)']) expect(bad).toMatch(RAW_GL);
    for (const fine of ['ctx.getImageData(0, 0, 4, 4)', 'ctx.fillRect(0, 0, 1, 1)', 'gl.getExtension("X")', 'filters.enable(true)', 'this.renderer.readRenderTargetPixels(t, 0, 0, 1, 1, b)']) expect(fine).not.toMatch(RAW_GL);
  });
});
