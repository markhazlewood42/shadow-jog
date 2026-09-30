// Where the art pass stands: options per category by status, and the balance.
//   node scripts/pixellab/status.mjs [--list] [--review]
//   --list: every option that isn't done, with its error. --review: Mark's picks and notes
//   (media/art-pass/review.json, saved by the review page), asset by asset.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { ROOT, balance } from './lib.mjs';

const dir = `${ROOT}/assets`;
const metas = existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(`${dir}/${d}/meta.json`)).map((d) => JSON.parse(readFileSync(`${dir}/${d}/meta.json`, 'utf8'))) : [];
const by = {};
const open = [];
for (const m of metas)
  for (const o of m.options) {
    const row = (by[m.category] ??= {});
    row[o.status ?? '?'] = (row[o.status ?? '?'] ?? 0) + 1;
    const gaps = Object.entries(o.anims ?? {}).filter(([, a]) => a.missing?.length || !a.frames);
    if (o.status !== 'done' || gaps.length) open.push(`${m.id}/${o.id}: ${o.status}${gaps.length ? ` (anims missing: ${gaps.map(([k]) => k).join(',')})` : ''}${o.error ? ` · ${o.error.slice(0, 160)}` : ''}`);
  }
for (const [cat, row] of Object.entries(by)) console.log(`${cat.padEnd(16)} ${Object.entries(row).map(([k, v]) => `${k} ${v}`).join(', ')}`);
if (process.argv.includes('--list')) for (const l of open) console.log(`  ${l}`);
if (process.argv.includes('--review')) {
  const path = `${ROOT}/review.json`;
  const review = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { assets: {} };
  console.log(`\nreview (saved ${review.saved ?? 'never'}):`);
  for (const m of metas) {
    const r = review.assets?.[m.id];
    if (!r) continue;
    const opts = Object.entries(r.options ?? {}).filter(([, v]) => v.verdict || v.note);
    if (!opts.length && !r.note) continue;
    console.log(`  ${m.id} (${m.title})`);
    for (const [id, v] of opts) console.log(`    ${id}: ${v.verdict ?? '-'}${v.note ? ` · ${v.note}` : ''}`);
    if (r.note) console.log(`    note: ${r.note}`);
  }
}
console.log(`balance ${await balance()}`);
process.exit(0);
