// Builds the engine lab page (sjelab.html) into a temporary folder and describes every chunk: size, gzip size,
// and which CLASS it belongs to. Used by scripts/bundle-budget.mjs and scripts/sjelab-size.mjs.
//
// Why a separate build: the lab page is not a build input of `vite build` (only index.html is), so the engine,
// Pixi and Three never reach dist/. The 3D mode is built only here, until the game itself starts a hack
// (milestone M7). This is how its size is known, and how a test proves the shipped game does not contain it.
//
// The classes (the same words as docs/engine/README.md section 4 and docs/spikes/engine-platform.md):
//   lazy-3d   the lazily loaded 3D chunk: Three.js plus src/sje/three plus src/hack3d. Loaded on the first hack only.
//   engine    Pixi plus the engine (src/sje), and the lab's own code
//   other     anything else (the lab's HTML shell, the old engine's art code that the lab shows)
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');

/** Which of these a chunk's source modules say it is. */
export function classify(modules) {
  const ids = Object.keys(modules).map((id) => id.split('\\').join('/'));
  const has = (re) => ids.some((id) => re.test(id));
  if (has(/node_modules\/three\//)) return 'lazy-3d';
  if (has(/node_modules\/pixi\.js\//)) return 'engine';
  return 'other';
}

/** The bytes of own source (not counting dependencies) that a chunk holds from a folder, after minification. */
function ownBytes(modules, re) {
  return Object.entries(modules)
    .filter(([id]) => re.test(id.split('\\').join('/')))
    .reduce((n, [, m]) => n + m.renderedLength, 0);
}

/**
 * Build the lab page and list its chunks. `entry` is the HTML (default the lab page). Returns
 * `[{ fileName, raw, gzip, cls, threeBytes, pixiBytes, isEntry, isDynamicEntry }]`.
 */
export async function buildLabChunks(entry = join(root, 'sjelab.html')) {
  const work = mkdtempSync(join(tmpdir(), 'sjelab-chunks-'));
  try {
    const outDir = join(work, 'out');
    const result = await build({
      root,
      configFile: false,
      logLevel: 'error',
      build: { outDir, emptyOutDir: true, target: 'es2022', assetsInlineLimit: 0, sourcemap: false, minify: true, rollupOptions: { input: entry }, reportCompressedSize: false },
    });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output ?? []);
    const chunks = [];
    for (const o of outputs) {
      if (o.type !== 'chunk') continue;
      const code = readFileSync(join(outDir, o.fileName));
      chunks.push({
        fileName: o.fileName,
        raw: code.length,
        gzip: gzipSync(code).length,
        cls: classify(o.modules ?? {}),
        threeBytes: ownBytes(o.modules ?? {}, /node_modules\/three\//),
        pixiBytes: ownBytes(o.modules ?? {}, /node_modules\/pixi\.js\//),
        isEntry: o.isEntry,
        isDynamicEntry: o.isDynamicEntry,
      });
    }
    return chunks;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
