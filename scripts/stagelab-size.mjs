// Builds the Phaser stage lab (stagelab.html) on its own and reports what it weighs, for the Phaser
// spike (docs/spikes/phaser-stage.md). Phaser goes in its own chunk so its share shows. It never touches the shipped build: it writes to a scratch
// folder (default: the OS temp folder) and the game's `vite build` still bundles index.html only.
//   node scripts/stagelab-size.mjs [outDir] [page.html]   (page defaults to stagelab.html; use stageedit.html for the editor and Battle Test)
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const outDir = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), 'stagelab-build-'));
const page = process.argv[3] ?? 'stagelab.html';

await build({
  root,
  configFile: false,
  logLevel: 'warn',
  base: './',
  build: { outDir, emptyOutDir: true, target: 'es2022', assetsInlineLimit: 0, sourcemap: false, rollupOptions: { input: resolve(root, page), output: { manualChunks: (id) => (id.includes('node_modules/phaser') ? 'phaser' : undefined) } }, chunkSizeWarningLimit: 4000 },
});

const dir = join(outDir, 'assets');
let total = 0;
let totalGz = 0;
for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
  const bytes = readFileSync(join(dir, f));
  const gz = gzipSync(bytes).length;
  total += statSync(join(dir, f)).size;
  totalGz += gz;
  console.log(`${f.padEnd(34)} ${(bytes.length / 1000).toFixed(1).padStart(8)} kB   gzip ${(gz / 1000).toFixed(1).padStart(7)} kB`);
}
console.log(`${page} total JS ${(total / 1000).toFixed(1)} kB, gzip ${(totalGz / 1000).toFixed(1)} kB  (built to ${outDir})`);
