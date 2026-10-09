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
 * Re-set to 236 kB the night of 2026-09-30 (Mark): rig v2 (characters, enemies and portraits drawn
 * and animated in code from traced frames, their data loaded as JSON) and the battle skeleton
 * filled the 224; measured 224.9 kB, with room for the rest of the rig and the effects pass.
 * Raised to 238.5 kB on 2026-10-08 (D20 of docs/PIVOT-640.md), by the measured delta only: the total
 * measured 238.413 kB against 236.0, a delta of 2.413 kB, rounded up to the next 0.1 kB (2.5). The cause is the
 * surround art for the maps smaller than the 640x360 view (Mark's Review 3 pick for D7: an edge fill
 * for the nine interiors, a themed surround for the Rustyard and the Dock) and the pop-in table with
 * its curtains and hold (his D17 picks). Round 1 of WP3 kept that code in the dev build only, at
 * 235.9 kB, because nothing chose it yet; it ships now.
 * Raised to 239.5 kB on 2026-10-08 (D20, WP3 round 3), by the measured delta only: the total measured
 * 239.343 kB (239,343 bytes) against 238.413 at the 238.5 alarm, a delta of 0.930 kB, rounded up to the next
 * 0.1 kB (1.0). The causes: `field/overrects.ts` and the field code that lights only the occupied
 * parts of an overhead layer (a performance fix, D15), and the Rustyard's and the Dock's colors and
 * alphas written as named theme records (`YARD`, `DOCK`, `EDGE_FILL` in `fieldkit/surround-art.ts`)
 * instead of inline literals.
 * Raised to 240.0 kB on 2026-10-08 (D20, WP4), by the measured delta only: the total measured 239.837 kB
 * (239,837 bytes) against 239.343 at the 239.5 alarm, a delta of 0.494 kB, rounded up to the next 0.1 kB (0.5).
 * The causes: the UI layout values named in `ui/layout.ts` (the dialog cap, the menu panes, the shop, the
 * Status screen, `rowsFor`), the compact party cards beside Items and Techs, the dev-only review-switch
 * reads, and the Status screen's three ability columns.
 * Raised to 240.7 kB on 2026-10-08 (D20, WP5), by the measured delta only: the total measured 240.517 kB
 * (240,517 bytes) against 239.837 at the 240.0 alarm, a delta of 0.680 kB, rounded up to the next 0.1 kB (0.7).
 * The causes: the title's composition as named data (`scenes/title-layout.ts`), the page offsets and the
 * results-window values in `ui/layout.ts`, the re-authored comic-panel table with its pinned portrait
 * scale, and the dev-only review-switch reads (`?logo=5`, `?portrait=3`). Mark confirms this raise (D20).
 */
const CHUNK_MAX = 480 * 1000;
const GZIP_TOTAL_MAX = 240.7 * 1000;

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
