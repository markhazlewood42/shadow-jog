// Bundle budget: run after `vite build`. Fails if the shipped JavaScript outgrows its budget, so
// the bundle size is a gate, not a number someone has to remember to re-check.
//   node scripts/bundle-budget.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/** Largest single chunk, raw bytes; and all JavaScript, gzipped (what a player downloads). */
const CHUNK_MAX = 560 * 1000;
const GZIP_TOTAL_MAX = 190 * 1000;

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
