// Controls for scripts/bundle-budget.mjs: the gate must fail when it has no data, not pass on it.
// Each case writes a tiny fake game build and lab build in a temp folder and runs the script there.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = resolve(__dirname, '../scripts/bundle-budget.mjs');
const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

type Chunk = { file: string; modules: string[] | null; isEntry?: boolean; imports?: string[]; dynamicImports?: string[] };

function writeBuild(dir: string, chunks: Chunk[]): void {
  mkdirSync(join(dir, '.vite'), { recursive: true });
  mkdirSync(join(dir, 'assets'), { recursive: true });
  const manifest: Record<string, unknown> = {};
  for (const c of chunks) {
    writeFileSync(join(dir, c.file), `// ${c.file}\n`);
    if (c.modules) writeFileSync(join(dir, `${c.file}.map`), JSON.stringify({ sources: c.modules }));
    manifest[c.file] = { file: c.file, isEntry: c.isEntry, imports: c.imports, dynamicImports: c.dynamicImports };
  }
  writeFileSync(join(dir, '.vite', 'manifest.json'), JSON.stringify(manifest));
}

/** A game with a boot chunk and one lazy chunk; a lab with a boot chunk, a lazy 2D chunk and a lazy 3D chunk. */
function run(bootModules: string[] | null): { code: number | null; out: string } {
  const root = mkdtempSync(join(tmpdir(), 'sj-budget-'));
  made.push(root);
  writeFileSync(join(root, 'vite.config.ts'), 'export default {};\n');
  mkdirSync(join(root, 'src/sje'), { recursive: true });
  mkdirSync(join(root, 'src/sje-lab'), { recursive: true });
  writeBuild(join(root, 'dist'), [
    { file: 'assets/index.js', modules: bootModules, isEntry: true, dynamicImports: ['assets/battle.js'] },
    { file: 'assets/battle.js', modules: ['../../src/battle/index.ts'] },
  ]);
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
});
