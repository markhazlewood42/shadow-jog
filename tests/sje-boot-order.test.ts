/**
 * M6 pass line 4, control (rewritten in M8d): the effects data must be loaded into `game.fx` BEFORE `bootGame` runs in `startSje` (src/sje/boot.ts).
 *
 * Until M8d the old `postfx` singleton was routed to `game.fx` first. The singleton is gone, so `boot()` and the scenes call `game.fx` directly. `boot()` registers its ticker
 * (`game.fx.update()`) and starts the first scene. If `game.fx.loadData(FX)` runs after `bootGame`, a moment that plays by name in the first frames finds no data: it is a silent no-op
 * and nothing throws. So the order is pinned here.
 *
 * It reads the source (comments stripped) because `startSje` needs a browser. The check is a pure function, so a made-up source proves the check can fail.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

/** The source with block comments and line comments removed (the header of boot.ts names both calls). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Does the function `startSje` call `game.fx.loadData(` before `bootGame(`, each exactly once? */
function loadedBeforeBoot(src: string): boolean {
  const code = stripComments(src);
  const start = code.indexOf('function startSje');
  if (start < 0) return false;
  const body = code.slice(start);
  const load = [...body.matchAll(/\bgame\.fx\.loadData\(/g)];
  const boot = [...body.matchAll(/\bbootGame\(/g)];
  if (load.length !== 1 || boot.length !== 1) return false;
  return (load[0]?.index ?? Infinity) < (boot[0]?.index ?? -1);
}

const LOAD = 'const problems = game.fx.loadData(FX);';
const BOOT = 'bootGame(game, display);';

describe('startSje loads the effects data into game.fx before bootGame (M6 pass line 4)', () => {
  it('the real src/sje/boot.ts does', () => {
    expect(loadedBeforeBoot(readFileSync(join(ROOT, 'src/sje/boot.ts'), 'utf8'))).toBe(true);
  });

  it('control: the same source with the two calls swapped fails the check', () => {
    const real = readFileSync(join(ROOT, 'src/sje/boot.ts'), 'utf8');
    expect(real).toContain(LOAD);
    expect(real).toContain(BOOT);
    const swapped = real.replace(LOAD, '__LOAD__').replace(BOOT, LOAD).replace('__LOAD__', BOOT);
    expect(swapped).not.toBe(real);
    expect(loadedBeforeBoot(swapped)).toBe(false);
  });

  it('control: a source with no data load at all fails the check', () => {
    const real = readFileSync(join(ROOT, 'src/sje/boot.ts'), 'utf8');
    expect(loadedBeforeBoot(real.replace(LOAD, 'const problems: string[] = [];'))).toBe(false);
  });

  it('control: a call that only appears in a comment does not count', () => {
    expect(loadedBeforeBoot('export async function startSje() {\n  // game.fx.loadData(FX);\n  bootGame(a, b);\n}')).toBe(false);
  });
});
