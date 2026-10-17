// Path B CLI: build the sheets, run the checks, write previews and cards.
//   node scripts/art/v2/pathb/cli.mjs [--out dir] [--json file]
// Default out: docs/spikes/rook-turnaround/pathb-previews. Prints the checks, the se fit and the shares.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cardText } from './card.mjs';
import { buildAll, digest } from './index.mjs';
import { lightMapImage, partMapImage, writePreview } from './render.mjs';
import { loadData } from './sheet.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '../../../..');
export const DEFAULT_OUT = `${REPO}/docs/spikes/rook-turnaround/pathb-previews`;
const pct = (v) => `${(v * 100).toFixed(1)}%`;

export function run({ out = DEFAULT_OUT, json = null, quiet = false } = {}) {
  const data = loadData();
  const all = buildAll(data);
  const say = (s) => !quiet && console.log(s);
  mkdirSync(out, { recursive: true });
  const cards = {};
  for (const [name, o] of Object.entries({ ...all.facings, ...all.mirrors })) {
    writePreview(partMapImage(data, o.sheet), `${out}/${name}-partmap.png`);
    writePreview(lightMapImage(data, o.sheet, o.light), `${out}/${name}-lightmap.png`);
    cards[name] = { card: o.card, text: cardText(o.card) };
  }
  writeFileSync(`${out}/cards.json`, `${JSON.stringify(Object.fromEntries(Object.entries(cards).map(([k, v]) => [k, v.card])), null, 1)}\n`);
  writeFileSync(`${out}/cards.txt`, Object.entries(cards).map(([k, v]) => `==== ${k}\n${v.text}`).join('\n'));
  say(`digest ${digest(all)}`);
  for (const [name, o] of Object.entries(all.facings)) say(`${name}: ${o.checks.map((c) => `${c.name} ${c.ok ? 'ok' : 'FAIL'} (${JSON.stringify(c.value)})`).join('; ')}`);
  for (const c of all.setChecks) say(`set ${c.name}: ${c.ok ? 'ok' : 'FAIL'} ${JSON.stringify(c.value)}`);
  const f = all.fit;
  say(`se fit: part mIoU ${f.partMIoU.toFixed(3)}, min part ${f.minPartIoU.toFixed(3)}, silhouette IoU ${f.silhouetteIoU.toFixed(3)}, max landmark distance ${f.maxLandmarkDist.toFixed(2)} px`);
  for (const [k, v] of Object.entries(f.landmarkDist)) say(`  ${k}: ${v === null ? 'n/a' : v.toFixed(2)}`);
  for (const [name, s] of Object.entries(all.shares)) say(`shares ${name}: copy ${pct(s.share.copy)} transform ${pct(s.share.transform)} invent ${pct(s.share.invent)} (${s.total} cells)`);
  if (json) writeFileSync(json, `${JSON.stringify({ digest: digest(all), fit: f, setChecks: all.setChecks, checks: Object.fromEntries(Object.entries(all.facings).map(([k, o]) => [k, o.checks])), shares: Object.fromEntries(Object.entries(all.shares).map(([k, s]) => [k, { total: s.total, copy: s.copy, transform: s.transform, invent: s.invent, perPart: s.perPart }])) }, null, 1)}\n`);
  return all;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (k) => {
    const i = process.argv.indexOf(k);
    return i >= 0 ? process.argv[i + 1] : null;
  };
  run({ out: arg('--out') ?? DEFAULT_OUT, json: arg('--json') });
}
