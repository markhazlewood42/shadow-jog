// Bundle budget: run after `vite build`. Fails if the shipped JavaScript outgrows its budget, so
// the bundle size is a gate, not a number someone has to remember to re-check.
//   node scripts/bundle-budget.mjs
//
// Three classes of JavaScript are reported (docs/spikes/engine-platform.md, exit criterion 1):
//   1. THE SHIPPED GAME (dist/assets): the largest chunk and the total gzip, with the budgets below.
//      It also checks that NO engine code is in it: not Pixi, not Three. The new engine is on the lab page
//      only until milestone M6, and the 3D mode until M7. A game bundle that grew a Pixi or Three marker
//      would be a download the design said the player does not pay yet.
//   2. THE LAZY 3D CHUNK (Three.js + src/sje/three + src/hack3d). It is NOT in dist/: only the lab page loads
//      it, on the first hack. It is built here from sjelab.html (scripts/labchunks.mjs) and reported with its
//      own budget, so its growth is a number that is checked, not remembered.
//   3. THE ENGINE CHUNKS of the lab page (Pixi + src/sje + the lab): reported, with a budget on the total a
//      browser downloads to boot the lab (what the first load of the new engine will cost).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { buildLabChunks } from './labchunks.mjs';

/**
 * Largest single chunk, raw bytes; and all JavaScript, gzipped (what a player downloads).
 * Re-set 2026-09-29, when the battle system moved to its own lazily loaded chunk: the boot chunk
 * went from 558 kB to 452 kB, so its cap drops to 480 kB (it gates the first download). The
 * total grows with content (it was 186 kB of 190 before the split, 188 kB after); it now sits
 * 12 kB above the measured size, to catch an unplanned jump rather than every new line of story.
 * Total re-set to 212 kB the same evening, for the planned work on Mark's first playthrough notes
 * (Hex's deck scene and art, the shop's equip and sell-all, the damage-type symbols, the terrain
 * relief pass, the chest glow, finer creature art): measured 200 kB, with the deck scene split
 * into its own chunk so the boot chunk stays under its cap.
 * Re-set to 224 kB on 2026-09-30 for playthrough 2 (the level-up panel, the jingle, the valve
 * sounds, the equip screen) and the GPU effects layer Mark asked for (the WebGL presenter and its
 * shaders, the particle simulation and emitter presets, about 4 kB): measured 213.7 kB.
 * Re-set to 236 kB the night of 2026-09-30 (Mark): rig v2 (characters, enemies and portraits drawn
 * and animated in code from traced frames, their data loaded as JSON) and the battle skeleton
 * filled the 224; measured 224.9 kB, with room for the rest of the rig and the effects pass.
 */
const CHUNK_MAX = 480 * 1000;
const GZIP_TOTAL_MAX = 236 * 1000;

/**
 * The lazy 3D chunk, gzip. Set 2026-10-04 (step B2 of the engine-platform spike) from the measured size, 144.6 kB
 * (Three.js with named imports, the 3D facade, the test hacking scene), plus about 10%. The design expected
 * 145 to 177 kB. It loads on the first hack, never at boot. Re-set on purpose when the real hacking mode grows it.
 */
const LAZY_3D_GZIP_MAX = 160 * 1000;
/**
 * What the lab page downloads to boot (the entry and every chunk it needs at once, gzip): Pixi, the engine and the lab,
 * not the 3D chunk. Measured 164.1 kB in step B2 (it was 150.7 kB in B0, before filters, masks and the 3D view). Cap at about +10%.
 */
const LAB_BOOT_GZIP_MAX = 180 * 1000;

/** Strings that exist only in the engine libraries. Found in dist/, they mean the engine reached the shipped game. */
const ENGINE_MARKERS = [
  ['Three.js', 'WebGL 1 is not supported since r163'],
  ['Pixi', 'PixiJS Warning'],
];

const dir = 'dist/assets';
const js = readdirSync(dir).filter((f) => f.endsWith('.js'));
if (!js.length) {
  console.error(`bundle budget: no JavaScript in ${dir} (run vite build first)`);
  process.exit(1);
}
let gz = 0;
let fail = false;
console.log('1. the shipped game (dist/assets)');
for (const f of js) {
  const p = join(dir, f);
  const text = readFileSync(p);
  const raw = statSync(p).size;
  const z = gzipSync(text).length;
  gz += z;
  const over = raw > CHUNK_MAX;
  fail ||= over;
  console.log(`  ${f.padEnd(32)} ${(raw / 1000).toFixed(1).padStart(7)} kB  gzip ${(z / 1000).toFixed(1).padStart(6)} kB${over ? '  OVER' : ''}`);
  for (const [name, marker] of ENGINE_MARKERS) {
    if (text.includes(marker)) {
      console.error(`  ${f} CONTAINS ${name} (found "${marker}"): the engine must not be in the shipped game yet`);
      fail = true;
    }
  }
}
console.log(`  total gzip ${(gz / 1000).toFixed(1)} kB (budget ${GZIP_TOTAL_MAX / 1000} kB); largest chunk budget ${CHUNK_MAX / 1000} kB; no Three.js and no Pixi in it`);
if (gz > GZIP_TOTAL_MAX) fail = true;

// Classes 2 and 3: built from the lab page, into a temporary folder (never dist/).
console.log('2 and 3. the lab page (not shipped): the lazy 3D chunk, and what the lab downloads to boot');
const lab = await buildLabChunks();
const lazy3d = lab.filter((c) => c.cls === 'lazy-3d');
const boot = lab.filter((c) => c.cls !== 'lazy-3d' && c.fileName !== undefined && !/browserAll|webworkerAll/.test(c.fileName));
for (const c of lab) {
  const skipped = /browserAll|webworkerAll/.test(c.fileName) ? '  (built, never requested: skipExtensionImports)' : '';
  console.log(`  ${c.cls.padEnd(8)} ${c.fileName.padEnd(30)} ${(c.raw / 1000).toFixed(1).padStart(7)} kB  gzip ${(c.gzip / 1000).toFixed(1).padStart(6)} kB${skipped}`);
}
if (lazy3d.length !== 1) {
  console.error(`  expected exactly one lazy 3D chunk (Three.js), found ${lazy3d.length}: the 3D mode must stay behind ONE import()`);
  fail = true;
}
const lazyGz = lazy3d.reduce((n, c) => n + c.gzip, 0);
const lazyRaw = lazy3d.reduce((n, c) => n + c.raw, 0);
const bootGz = boot.reduce((n, c) => n + c.gzip, 0);
console.log(`  lazy 3D chunk: ${(lazyRaw / 1000).toFixed(1)} kB raw, ${(lazyGz / 1000).toFixed(1)} kB gzip (budget ${LAZY_3D_GZIP_MAX / 1000} kB); loads on the first hack only`);
console.log(`  lab boot: ${(bootGz / 1000).toFixed(1)} kB gzip (budget ${LAB_BOOT_GZIP_MAX / 1000} kB)`);
if (lazyGz > LAZY_3D_GZIP_MAX) {
  console.error('  the lazy 3D chunk is over its budget');
  fail = true;
}
if (bootGz > LAB_BOOT_GZIP_MAX) {
  console.error('  the lab boot download is over its budget');
  fail = true;
}
// Three must be in the lazy chunk ONLY: no other chunk of the lab page holds any of it.
const leaked = lab.filter((c) => c.cls !== 'lazy-3d' && c.threeBytes > 0);
if (leaked.length) {
  console.error(`  Three.js leaked outside the lazy 3D chunk: ${leaked.map((c) => c.fileName).join(', ')}`);
  fail = true;
}

if (fail) {
  console.error('bundle budget exceeded');
  process.exit(1);
}
