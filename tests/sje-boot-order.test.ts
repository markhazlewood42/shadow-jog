/**
 * M6 pass line 4, control: `routePostfx` must be applied BEFORE `bootGame` in `startSje` (src/sje/boot.ts).
 *
 * `postfx` is the singleton that scenes, `moments.ts` and `boot()` call. `boot()` registers its ticker (`postfx.update()`) and the first scene against it. If the route is applied
 * after `bootGame`, the first calls reach the old, unrouted object: every effect is a silent no-op and nothing throws. So the order is pinned here.
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

/** Does the function `startSje` call `routePostfx(` before `bootGame(`, each exactly once? */
function routedBeforeBoot(src: string): boolean {
  const code = stripComments(src);
  const start = code.indexOf('function startSje');
  if (start < 0) return false;
  const body = code.slice(start);
  const route = [...body.matchAll(/\broutePostfx\(/g)];
  const boot = [...body.matchAll(/\bbootGame\(/g)];
  if (route.length !== 1 || boot.length !== 1) return false;
  return (route[0]?.index ?? Infinity) < (boot[0]?.index ?? -1);
}

describe('startSje applies routePostfx before bootGame (M6 pass line 4)', () => {
  it('the real src/sje/boot.ts does', () => {
    expect(routedBeforeBoot(readFileSync(join(ROOT, 'src/sje/boot.ts'), 'utf8'))).toBe(true);
  });

  it('control: the same source with the two calls swapped fails the check', () => {
    const real = readFileSync(join(ROOT, 'src/sje/boot.ts'), 'utf8');
    const swapped = real.replace('routePostfx(postfx, () => game.fx);', '__ROUTE__').replace('bootGame(game as unknown as OldGame, display as unknown as OldDisplay);', 'routePostfx(postfx, () => game.fx);').replace('__ROUTE__', 'bootGame(game as unknown as OldGame, display as unknown as OldDisplay);');
    expect(swapped).not.toBe(real);
    expect(routedBeforeBoot(swapped)).toBe(false);
  });

  it('control: a source with no route at all fails the check', () => {
    const real = readFileSync(join(ROOT, 'src/sje/boot.ts'), 'utf8');
    expect(routedBeforeBoot(real.replace('routePostfx(postfx, () => game.fx);', ''))).toBe(false);
  });

  it('control: a call that only appears in a comment does not count', () => {
    expect(routedBeforeBoot('export async function startSje() {\n  // routePostfx(postfx, f);\n  bootGame(a, b);\n}')).toBe(false);
  });
});
