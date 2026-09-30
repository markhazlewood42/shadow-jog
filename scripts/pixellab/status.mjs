// Where the art pass stands: options per category by status, and the balance.
//   node scripts/pixellab/status.mjs [--list]   (--list: every option that isn't done, with its error)
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
console.log(`balance ${await balance()}`);
process.exit(0);
