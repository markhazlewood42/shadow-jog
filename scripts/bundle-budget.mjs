// Bundle budget: run after `vite build`. Fails if the shipped JavaScript outgrows its budget, so
// the bundle size is a gate, not a number someone has to remember to re-check.
//   node scripts/bundle-budget.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

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
 */
const CHUNK_MAX = 480 * 1000;
const GZIP_TOTAL_MAX = 224 * 1000;

const dir = 'dist/assets';
const js = readdirSync(dir).filter((f) => f.endsWith('.js'));
if (!js.length) {
  console.error(`bundle budget: no JavaScript in ${dir} (run vite build first)`);
  process.exit(1);
}
let gz = 0;
let fail = false;
for (const f of js) {
  const p = join(dir, f);
  const raw = statSync(p).size;
  const z = gzipSync(readFileSync(p)).length;
  gz += z;
  const over = raw > CHUNK_MAX;
  fail ||= over;
  console.log(`${f.padEnd(32)} ${(raw / 1000).toFixed(1).padStart(7)} kB  gzip ${(z / 1000).toFixed(1).padStart(6)} kB${over ? '  OVER' : ''}`);
}
console.log(`total gzip ${(gz / 1000).toFixed(1)} kB (budget ${GZIP_TOTAL_MAX / 1000} kB); largest chunk budget ${CHUNK_MAX / 1000} kB`);
if (gz > GZIP_TOTAL_MAX) fail = true;
if (fail) {
  console.error('bundle budget exceeded');
  process.exit(1);
}
