// Controls for scripts/bundle-budget.mjs: the gate must fail when it has no data, not pass on it.
// Each case writes a tiny fake game build and lab build in a temp folder and runs the script there.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = resolve(__dirname, '../scripts/bundle-budget.mjs');
const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

type Chunk = { file: string; modules: string[] | null; src?: string; bytes?: number; isEntry?: boolean; imports?: string[]; dynamicImports?: string[] };

function writeBuild(dir: string, chunks: Chunk[]): void {
  mkdirSync(join(dir, '.vite'), { recursive: true });
  mkdirSync(join(dir, 'assets'), { recursive: true });
  const manifest: Record<string, unknown> = {};
  for (const c of chunks) {
    writeFileSync(join(dir, c.file), c.bytes ? randomBytes(c.bytes) : `// ${c.file}
`);
    if (c.modules) writeFileSync(join(dir, `${c.file}.map`), JSON.stringify({ sources: c.modules }));
    manifest[c.file] = { file: c.file, src: c.src, isEntry: c.isEntry, imports: c.imports, dynamicImports: c.dynamicImports };
  }
  writeFileSync(join(dir, '.vite', 'manifest.json'), JSON.stringify(manifest));
}

const ENGINE_CHUNK: Chunk = { file: 'assets/sje.js', modules: ['../../node_modules/pixi.js/lib/index.mjs', '../../src/sje/boot.ts'] };

/**
 * A game with a boot chunk, the `?engine=sje` chunk (M1) and one lazy chunk; a lab with a boot chunk, a lazy 2D chunk and a lazy 3D chunk.
 * `gameChunks` replaces the game's lazy chunks (a control leaves the engine chunk out, or adds a Three chunk).
 */
function run(bootModules: string[] | null, gameChunks: Chunk[] = [ENGINE_CHUNK, { file: 'assets/battle.js', modules: ['../../src/battle/index.ts'] }]): { code: number | null; out: string } {
  const root = mkdtempSync(join(tmpdir(), 'sj-budget-'));
  made.push(root);
  writeFileSync(join(root, 'vite.config.ts'), 'export default {};\n');
  mkdirSync(join(root, 'src/sje'), { recursive: true });
  mkdirSync(join(root, 'src/sje-lab'), { recursive: true });
  writeBuild(join(root, 'dist'), [{ file: 'assets/index.js', modules: bootModules, isEntry: true, dynamicImports: gameChunks.map((c) => c.file) }, ...gameChunks]);
  writeBuild(join(root, 'dist-lab'), [
    { file: 'assets/lab.js', modules: ['../../src/sje-lab/lab.ts'], isEntry: true, dynamicImports: ['assets/pixi.js', 'assets/three.js'] },
    { file: 'assets/pixi.js', modules: ['../../node_modules/pixi.js/lib/index.mjs', '../../src/sje/render/presenter.ts'] },
    { file: 'assets/three.js', modules: ['../../node_modules/three/build/three.module.js'] },
  ]);
  const r = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('bundle-budget.mjs controls', () => {
  it('passes on a clean fake build (so the failures below come from the control)', () => {
    const r = run(['../../src/main.ts']);
    expect(r.out).toContain('bundle budget ok');
    expect(r.code).toBe(0);
  });

  it('fails when the boot chunk has no source map (no data is not a pass)', () => {
    const r = run(null);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/assets\/index\.js \(boot\) has no source map/);
  });

  it('fails when the boot chunk holds a pixi.js module', () => {
    const r = run(['../../node_modules/pixi.js/lib/index.mjs']);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/boot chunk assets\/index\.js holds a pixi\.js module/);
  });

  it('M1: the game may hold Pixi in a lazy chunk (the engine chunk is the pass case above), but the chunk must be there', () => {
    const r = run(['../../src/main.ts'], [{ file: 'assets/battle.js', modules: ['../../src/battle/index.ts'] }]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/no lazy-2d chunk holds both the engine \(src\/sje\) and Pixi/);
  });

  it('M1: a chunk of the game that holds Pixi but not the engine does not count as the engine chunk', () => {
    const r = run(['../../src/main.ts'], [{ file: 'assets/pixi-only.js', modules: ['../../node_modules/pixi.js/lib/index.mjs'] }]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/no lazy-2d chunk holds both the engine/);
  });

  it('M1: Three stays out of the shipped game until M7', () => {
    const r = run(['../../src/main.ts'], [ENGINE_CHUNK, { file: 'assets/three.js', modules: ['../../node_modules/three/build/three.module.js'] }]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/game: chunk assets\/three\.js holds Three/);
  });

  it('M3: a flag-only chunk (src/battlestage/liveopen.ts) has its own report line and does not count toward the game total', () => {
    const live: Chunk = { file: 'assets/liveopen.js', src: 'src/battlestage/liveopen.ts', modules: ['../../src/battlestage/liveopen.ts'] };
    const ok = run(['../../src/main.ts'], [ENGINE_CHUNK, live]);
    expect(ok.code).toBe(0);
    expect(ok.out).toMatch(/flag-only\s+\d/);
    expect(ok.out).toMatch(/game flag-only gzip/);
    // Negative control: an incompressible 410 kB flag-only chunk is over its own cap, but it must not trip the 401 kB game total.
    const big = run(['../../src/main.ts'], [ENGINE_CHUNK, { ...live, bytes: 410_000 }]);
    expect(big.code).toBe(1);
    expect(big.out).toMatch(/game: flag-only gzip \d+ is over/);
    expect(big.out).not.toMatch(/game: total gzip/);
    // The same bytes in a chunk that is not flag-only do trip the total.
    const counted = run(['../../src/main.ts'], [ENGINE_CHUNK, { ...live, src: 'src/battlestage/other.ts', bytes: 410_000 }]);
    expect(counted.out).toMatch(/game: total gzip \d+ is over/);
  });
});
