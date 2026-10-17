// Stage C: classify every mask cell as copy, transform or invent, and report the invented share per facing.
//   node scripts/art/pipeline/classify.mjs [--out dir] [--write-target]
// A source cell is a cell of the given frame that this facing may reuse. SOURCES says how, by part and row: 'copy', 'transform' or null (never a source).
//   mirror facings (down, up): the right half (x >= 18) takes the class SOURCES gives for the same cell; the left half (x <= 17) is the mirror of the right half (transform).
//   one-sided facings (up-right, right): the same cell of the given, with the class SOURCES gives.
//   up: the sheath band cells are transform (a rule, not a picture).
//   everything else is invent. The hair wing and the sheath parts are never a source.
// Back views (plan stage B, walk section): the back of the hair and the back of the coat are invent. Only legs, boots and the hem row (coat row 25) come from the given.
// up-right adds the arm patch: sleeve and hand cells recolored to the back recipe, so they are transform, not copy. right (a side view): nothing is copied.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isOpaque } from '../metrics.mjs';
import { drawText, newImage, writePng, zoomGrid } from '../headtest/lib.mjs';
import { SHEATH_PARTS, buildPartMap, hairWing, labelsOf, validatePartMap } from './decompose.mjs';
import { OUT_DIR, ensureDir, loadGiven, writeTargetKey } from './given.mjs';
import { AXIS, buildMasks, maskAt } from './masks.mjs';

export const HEM_ROW = 25;
const below = (part, y) => part === 'legs' || part === 'boots' || (part === 'coat' && y >= HEM_ROW);
/** How a facing may use the given cell of a part at row y: 'copy', 'transform' or null. */
export const SOURCES = {
  down: () => 'copy',
  up: (part, y) => (below(part, y) ? 'copy' : null),
  'up-right': (part, y) => (below(part, y) ? 'copy' : part === 'sleeves' || part === 'hands' ? 'transform' : null),
  right: () => null,
};
const MIRRORED = { down: true, up: true, 'up-right': false, right: false };
export const FACINGS = ['down', 'up', 'up-right', 'right'];
export const CLASSES = ['copy', 'transform', 'invent'];

/**
 * Classify the cells of one mask. Returns { cells: Array(w*h) of 'copy' | 'transform' | 'invent' | null, counts, share }.
 * share is the invented share of the mask's opaque cells (0 to 1).
 */
export function classify(facing, mask, img, pm, { band = [] } = {}) {
  const labels = labelsOf(pm);
  const wing = new Set(hairWing(img, pm));
  const ok = SOURCES[facing];
  if (!ok) throw new Error(`unknown facing ${facing}`);
  const bandSet = new Set(band.map(([x, y]) => y * mask.w + x));
  /** The class a given cell offers, or null when it is not a source. */
  const usable = (x, y) => {
    if (!isOpaque(img, x, y) || wing.has(y * img.w + x)) return null;
    const names = labels[y * img.w + x] ?? [];
    const p = names[0];
    return names.length === 1 && p && !SHEATH_PARTS.includes(p) ? ok(p, y) : null;
  };
  const cells = Array(mask.w * mask.h).fill(null);
  const counts = { copy: 0, transform: 0, invent: 0 };
  for (let y = 0; y < mask.h; y++)
    for (let x = 0; x < mask.w; x++) {
      if (!maskAt(mask, x, y)) continue;
      let c = 'invent';
      if (bandSet.has(y * mask.w + x)) c = 'transform';
      else if (MIRRORED[facing]) {
        if (x >= AXIS - x) c = usable(x, y) ?? 'invent';
        else c = usable(AXIS - x, y) ? 'transform' : 'invent';
      } else c = usable(x, y) ?? 'invent';
      cells[y * mask.w + x] = c;
      counts[c]++;
    }
  const total = counts.copy + counts.transform + counts.invent;
  return { cells, counts, total, share: total ? counts.invent / total : 0 };
}

export function classifyAll(img, pm = buildPartMap(img)) {
  const m = buildMasks(img, pm);
  const by = { down: m.down, up: m.up, 'up-right': m.upRight, right: m.right };
  const out = {};
  for (const f of FACINGS) {
    const mask = by[f];
    out[f] = mask ? classify(f, mask, img, pm, { band: f === 'up' ? m.upBand : [] }) : null;
  }
  return { masks: m, result: out };
}

const COLORS = { copy: [60, 160, 90, 255], transform: [230, 190, 50, 255], invent: [210, 60, 60, 255] };
export function renderOverlay(mask, cls) {
  return zoomGrid(newImage(mask.w, mask.h), {
    k: 32, originX: 0, originY: 0,
    flat: (x, y) => { const c = cls.cells[y * mask.w + x]; return c ? COLORS[c] : null; },
    after: (out, ml, mt, k) => {
      for (let y = 0; y < mask.h; y++)
        for (let x = 0; x < mask.w; x++) {
          const c = cls.cells[y * mask.w + x];
          if (c) drawText(out, c === 'copy' ? 'C' : c === 'transform' ? 'T' : 'I', ml + x * k + 11, mt + y * k + 13, [15, 15, 20, 255], 2);
        }
    },
  });
}

// ---- CLI ----
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const out = a.includes('--out') ? a[a.indexOf('--out') + 1] : OUT_DIR;
  const img = loadGiven();
  const pm = buildPartMap(img);
  if (!validatePartMap(img, pm).ok) { console.error('part map invalid; run decompose.mjs'); process.exit(1); }
  const { masks, result } = classifyAll(img, pm);
  ensureDir(out);
  const stored = {};
  const by = { down: masks.down, up: masks.up, 'up-right': masks.upRight, right: masks.right };
  for (const f of FACINGS) {
    const r = result[f];
    if (!r) { console.log(`${f}: STUB (no battle idle sheet in the repo)`); continue; }
    console.log(`${f.padEnd(9)} cells ${r.total}  copy ${r.counts.copy}  transform ${r.counts.transform}  invent ${r.counts.invent}  invented share ${(100 * r.share).toFixed(1)} percent`);
    writePng(renderOverlay(by[f], r), `${out}/classify-${f}-32x.png`);
    stored[f] = { ...r.counts, total: r.total, inventedShare: Number(r.share.toFixed(4)) };
  }
  writeFileSync(`${out}/classify.json`, `${JSON.stringify(stored, null, 2)}\n`);
  console.log('plan estimates (not measured): down 15, up 55, up-right 45, right 70 percent');
  if (a.includes('--write-target')) {
    writeTargetKey('classes', { note: 'Stage C: cells per class and invented share per facing, by the SOURCES table in classify.mjs. Written by classify.mjs --write-target.', facings: stored });
    console.log('wrote target.json pipeline.classes');
  }
}
