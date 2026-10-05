// Measures what the Shadow Jog Engine adds to a page, WITHOUT touching the shipped build.
//   node scripts/sjelab-size.mjs
//
// It builds two things into a temporary folder (never `dist/`) and prints every chunk, raw and gzip:
//   1. the lab page, sjelab.html: the engine, Pixi, the game's own art code and the lab scene;
//      and the battle stage lab page, sjestage.html (step B1): the same, plus the stage code in src/battlestage and its data;
//   2. the engine alone: a tiny entry that imports only `src/sje/index.ts` (the facade), so the
//      number is "Pixi plus the engine", without the art code.
// The shipped game's own sizes are `npm run budget`. The lab page is not a build input of
// `vite build` (only index.html is), so it never reaches `dist/`. This script is how its size is known.
// See docs/spikes/engine-platform.md (exit criterion 1: the growth of every chunk is measured).
// Since step B2 the lab page also has the lazy 3D chunk (Three.js + src/sje/three + src/hack3d), loaded on the first
// hack only. It is listed with the others, marked "contains Three". `npm run budget` gates its size (scripts/bundle-budget.mjs).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const work = mkdtempSync(join(tmpdir(), 'sjelab-size-'));

async function measure(label, input) {
  const outDir = join(work, label);
  const result = await build({
    root,
    configFile: false,
    logLevel: 'error',
    build: { outDir, emptyOutDir: true, target: 'es2022', assetsInlineLimit: 0, sourcemap: false, minify: true, rollupOptions: { input }, reportCompressedSize: false },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output ?? []);
  console.log(`\n${label}`);
  let total = 0;
  let totalRaw = 0;
  for (const o of outputs) {
    if (o.type !== 'chunk') continue;
    const code = readFileSync(join(outDir, o.fileName));
    const gz = gzipSync(code).length;
    total += gz;
    totalRaw += code.length;
    const pixiBytes = Object.entries(o.modules ?? {})
      .filter(([id]) => id.includes('node_modules/pixi.js') || id.includes('node_modules\\pixi.js'))
      .reduce((n, [, m]) => n + m.renderedLength, 0);
    const threeBytes = Object.entries(o.modules ?? {})
      .filter(([id]) => id.includes('node_modules/three') || id.includes('node_modules\\three'))
      .reduce((n, [, m]) => n + m.renderedLength, 0);
    const note = (pixiBytes ? `   contains Pixi (${(pixiBytes / 1000).toFixed(0)} kB of its own source, minified)` : '') + (threeBytes ? `   contains Three (${(threeBytes / 1000).toFixed(0)} kB): the LAZY 3D chunk` : '');
    console.log(`  ${o.fileName.padEnd(34)} ${(code.length / 1000).toFixed(1).padStart(8)} kB   gzip ${(gz / 1000).toFixed(1).padStart(7)} kB${note}`);
  }
  console.log(`  ${'total'.padEnd(34)} ${(totalRaw / 1000).toFixed(1).padStart(8)} kB   gzip ${(total / 1000).toFixed(1).padStart(7)} kB`);
}

try {
  await measure('lab-page', { sjelab: join(root, 'sjelab.html') });
  await measure('stage-lab-page', { sjestage: join(root, 'sjestage.html') });
  // The engine alone: every export is used, so nothing the facade offers is dropped as dead code.
  const entry = join(work, 'engine-entry.js');
  writeFileSync(entry, `import * as sje from ${JSON.stringify(join(root, 'src/sje/index.ts').split('\\').join('/'))};\nwindow.__sje = sje;\n`);
  await measure('engine-alone', { engine: entry });
} finally {
  rmSync(work, { recursive: true, force: true });
}
