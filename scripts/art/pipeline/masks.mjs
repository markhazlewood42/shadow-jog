// Stage B: the silhouette target (mask) per facing, derived from the given frame.
//   node scripts/art/pipeline/masks.mjs [--out dir] [--write-target]
// A mask is { w, h, cells: Uint8Array(w*h) } with 1 = opaque. Hard lines (validateMask): height 31, bottom row 30, head alone 12 to 15, no hole.
//   down      the given minus sheath and hair wing, made symmetric about the axis between columns 17 and 18 (x <-> 35 - x, union)
//   up        the same mask, plus a sheath band rule (a 2 px diagonal, reported as upBand cells)
//   up-right  the given minus sheath and hair wing
//   right     a proxy: the battle idle reduced to height 31 (area average, 50 percent alpha) gives the row thickness, clamped to the given's row widths
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isOpaque } from '../metrics.mjs';
import { newImage, writePng, zoomGrid } from '../headtest/lib.mjs';
import { HEAD_PARTS, SHEATH_PARTS, buildPartMap, hairWing, labelsOf, validatePartMap } from './decompose.mjs';
import { OUT_DIR, ensureDir, loadGiven, loadIdleFrames, writeTargetKey } from './given.mjs';

export const N = 32;
export const AXIS = 35; // mirror: x <-> 35 - x
export const HEIGHT = 31;
export const BOTTOM_ROW = 30;
export const HEAD_LAST_ROW = 12; // head rows are y 0 to 12
export const HEAD_ALONE = [12, 15];
export const SHEATH_BAND = { from: [12, 14], to: [22, 24], thickness: 2 };
export const LANDMARKS = { head: 5, shoulder: 14, hem: 25, feet: 29 };

export const newMask = () => ({ w: N, h: N, cells: new Uint8Array(N * N) });
export const maskAt = (m, x, y) => (x < 0 || y < 0 || x >= m.w || y >= m.h ? 0 : (m.cells[y * m.w + x] ?? 0));
export const maskCount = (m) => m.cells.reduce((s, v) => s + v, 0);
export const maskRows = (m) => Array.from({ length: m.h }, (_, y) => Array.from({ length: m.w }, (_, x) => (maskAt(m, x, y) ? '#' : '.')).join(''));
export function maskFromRows(rows) {
  const m = { w: rows[0]?.length ?? 0, h: rows.length, cells: new Uint8Array((rows[0]?.length ?? 0) * rows.length) };
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === '#') m.cells[y * m.w + x] = 1; }));
  return m;
}
const cloneMask = (m) => ({ w: m.w, h: m.h, cells: new Uint8Array(m.cells) });

/** Row extent { lo, hi } of a mask row, or null. */
export function rowExtent(m, y) {
  let lo = -1;
  let hi = -1;
  for (let x = 0; x < m.w; x++)
    if (maskAt(m, x, y)) {
      if (lo < 0) lo = x;
      hi = x;
    }
  return lo < 0 ? null : { lo, hi, width: hi - lo + 1 };
}
/** Bounding box height and bottom row. */
export function maskBox(m) {
  let y0 = -1;
  let y1 = -1;
  for (let y = 0; y < m.h; y++) if (rowExtent(m, y)) { if (y0 < 0) y0 = y; y1 = y; }
  return y0 < 0 ? null : { y0, y1, height: y1 - y0 + 1 };
}
/** Head alone: the widest row extent over rows 0 to 12. The hilt and sheath are not in a mask, so this is the head. */
export function headAloneWidth(m) {
  let best = 0;
  for (let y = 0; y <= HEAD_LAST_ROW; y++) best = Math.max(best, rowExtent(m, y)?.width ?? 0);
  return best;
}
/** Transparent cells that no 4-neighbor path of transparent cells connects to the border. */
export function holes(m) {
  const seen = new Uint8Array(m.w * m.h);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= m.w || y >= m.h || seen[y * m.w + x] || maskAt(m, x, y)) return;
    seen[y * m.w + x] = 1;
    stack.push([x, y]);
  };
  for (let i = 0; i < m.w; i++) { push(i, 0); push(i, m.h - 1); }
  for (let j = 0; j < m.h; j++) { push(0, j); push(m.w - 1, j); }
  while (stack.length) {
    const [x, y] = stack.pop();
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  const out = [];
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (!maskAt(m, x, y) && !seen[y * m.w + x]) out.push([x, y]);
  return out;
}

/**
 * The hard lines of stage B. Each violation has a name: empty, height, bottom-row, head-alone, hole.
 * @returns {{ ok: boolean, violations: object[], height: number, bottomRow: number, headAlone: number }}
 */
export function validateMask(m) {
  const v = [];
  const box = maskBox(m);
  if (!box) return { ok: false, violations: [{ name: 'empty' }], height: 0, bottomRow: -1, headAlone: 0 };
  if (box.height !== HEIGHT) v.push({ name: 'height', value: box.height, need: HEIGHT });
  if (box.y1 !== BOTTOM_ROW) v.push({ name: 'bottom-row', value: box.y1, need: BOTTOM_ROW });
  const head = headAloneWidth(m);
  if (head < HEAD_ALONE[0] || head > HEAD_ALONE[1]) v.push({ name: 'head-alone', value: head, need: HEAD_ALONE });
  const h = holes(m);
  if (h.length) v.push({ name: 'hole', cells: h });
  return { ok: v.length === 0, violations: v, height: box.height, bottomRow: box.y1, headAlone: head };
}

// ---- builders ----
/** Cells of the given that may seed a mask: opaque, not in a sheath part, not in the hair wing. */
export function maskSource(img, pm) {
  const labels = labelsOf(pm);
  const wing = new Set(hairWing(img, pm));
  const m = newMask();
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (!isOpaque(img, x, y)) continue;
      const names = labels[y * N + x] ?? [];
      if (names.some((n) => SHEATH_PARTS.includes(n)) || wing.has(y * N + x)) continue;
      m.cells[y * N + x] = 1;
    }
  return m;
}
/** Union with the mirror image about the axis between columns 17 and 18. */
export function symmetrize(m) {
  const out = newMask();
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (maskAt(m, x, y) || maskAt(m, AXIS - x, y)) out.cells[y * m.w + x] = 1;
  return out;
}
export const buildDown = (img, pm) => symmetrize(maskSource(img, pm));
export const buildUpRight = (img, pm) => maskSource(img, pm);
/** The sheath band of the up facing: a 2 px wide diagonal from the shoulder cell to the hem cell. Returns [[x, y], ...]. */
export function sheathBand({ from, to, thickness } = SHEATH_BAND) {
  const cells = [];
  const steps = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
  for (let s = 0; s <= steps; s++) {
    const x = Math.round(from[0] + ((to[0] - from[0]) * s) / steps);
    const y = Math.round(from[1] + ((to[1] - from[1]) * s) / steps);
    for (let t = 0; t < thickness; t++) cells.push([x + t, y]);
  }
  return cells;
}
export const buildUp = (img, pm) => buildDown(img, pm);

/**
 * The right proxy. The battle idle (79x68, facing right) is reduced to height 31 by area average, with a 50 percent alpha threshold.
 * Its opaque cell count per row is the row width; each row is a solid span centered on the axis. Nothing is clamped or forced:
 * the raw proxy is checked by checkRight() and every broken line is a named failure (the blade is in the count, so a real idle can fail).
 * Returns null when the battle idle sheet is not in the repo, else { mask, check }.
 */
export function buildRight(downMask) {
  const idle = loadIdleFrames();
  if (!idle) return null;
  return rightFromIdle(idle[0], downMask);
}
export function reduceAlpha(img, targetH = HEIGHT) {
  const s = targetH / img.h;
  const tw = Math.ceil(img.w * s);
  const out = { w: tw, h: targetH, cover: new Float32Array(tw * targetH) };
  for (let ty = 0; ty < targetH; ty++)
    for (let tx = 0; tx < tw; tx++) {
      const y0 = ty / s, y1 = (ty + 1) / s, x0 = tx / s, x1 = (tx + 1) / s;
      let sum = 0, area = 0;
      for (let sy = Math.floor(y0); sy < Math.min(img.h, Math.ceil(y1)); sy++)
        for (let sx = Math.floor(x0); sx < Math.min(img.w, Math.ceil(x1)); sx++) {
          const wgt = (Math.min(sx + 1, x1) - Math.max(sx, x0)) * (Math.min(sy + 1, y1) - Math.max(sy, y0));
          if (wgt <= 0) continue;
          area += wgt;
          sum += wgt * (img.data[(sy * img.w + sx) * 4 + 3] / 255);
        }
      out.cover[ty * tw + tx] = area ? sum / area : 0;
    }
  return out;
}
export function rightFromIdle(idleFrame, downMask) {
  const red = reduceAlpha(idleFrame);
  const m = newMask();
  for (let y = 0; y < HEIGHT; y++) {
    let w = 0;
    for (let x = 0; x < red.w; x++) if ((red.cover[y * red.w + x] ?? 0) >= 0.5) w++;
    w = Math.min(w, N);
    const lo = AXIS / 2 + 0.5 - Math.ceil(w / 2);
    for (let x = lo; x < lo + w; x++) m.cells[y * N + x] = 1;
  }
  return { mask: m, check: checkRight(m, downMask) };
}
/**
 * The hard lines on a right proxy mask, plus the proxy-only lines. Violation names: the validateMask names (empty, height, bottom-row, head-alone, hole),
 * empty-row (a row inside the body with no cell), landmark-head, landmark-shoulder, landmark-hem, landmark-feet (row width more than 2 px from the down mask).
 */
export function checkRight(mask, downMask) {
  const r = validateMask(mask);
  const violations = [...r.violations];
  const box = maskBox(mask);
  if (box) for (let y = box.y0; y <= box.y1; y++) if (!rowExtent(mask, y)) violations.push({ name: 'empty-row', y });
  for (const [k, row] of Object.entries(landmarkReport(mask, downMask))) if (!row.within2) violations.push({ name: `landmark-${k}`, ...row });
  return { ok: violations.length === 0, violations, height: r.height, bottomRow: r.bottomRow, headAlone: r.headAlone };
}
/** The head-alone value of the given itself, from the part map: widest row extent over the head parts (hair, face skin, lenses, beard). */
export function givenHeadAlone(pm) {
  const rows = new Map();
  for (const n of HEAD_PARTS)
    for (const i of pm.parts[n] ?? []) {
      const y = Math.floor(i / pm.w), x = i % pm.w;
      const r = rows.get(y) ?? [x, x];
      rows.set(y, [Math.min(r[0], x), Math.max(r[1], x)]);
    }
  let best = 0, at = null;
  for (const [y, [lo, hi]] of rows) if (hi - lo + 1 > best) { best = hi - lo + 1; at = { y, x0: lo, x1: hi }; }
  return { width: best, at };
}
/** Row width landmarks of the right mask against the down mask (the given's body, sheath and wing removed, mirrored): the +-2 band. */
export function landmarkReport(mask, downMask) {
  const src = downMask;
  return Object.fromEntries(Object.entries(LANDMARKS).map(([k, y]) => {
    const a = rowExtent(mask, y)?.width ?? 0, b = rowExtent(src, y)?.width ?? 0;
    return [k, { y, mask: a, given: b, within2: Math.abs(a - b) <= 2 }];
  }));
}

/** All four masks plus the up band. right and rightCheck are null when the battle idle is missing; rightCheck lists the named failures of the raw proxy. */
export function buildMasks(img, pm = buildPartMap(img)) {
  const down = buildDown(img, pm);
  const right = buildRight(down);
  return { down, up: buildUp(img, pm), upRight: buildUpRight(img, pm), right: right?.mask ?? null, rightCheck: right?.check ?? null, upBand: sheathBand() };
}

export function renderMask(m, band = []) {
  const set = new Set(band.map(([x, y]) => `${x},${y}`));
  return zoomGrid(newImage(m.w, m.h), {
    k: 32, originX: 0, originY: 0,
    flat: (x, y) => (set.has(`${x},${y}`) ? [240, 190, 60, 255] : maskAt(m, x, y) ? [70, 80, 110, 255] : null),
  });
}

// ---- CLI ----
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const out = a.includes('--out') ? a[a.indexOf('--out') + 1] : OUT_DIR;
  const img = loadGiven();
  const pm = buildPartMap(img);
  const v = validatePartMap(img, pm);
  if (!v.ok) { console.error('part map invalid; run decompose.mjs'); process.exit(1); }
  const masks = buildMasks(img, pm);
  const gh = givenHeadAlone(pm);
  console.log(`given head alone (head parts): ${gh.width} px at row ${gh.at?.y}, x${gh.at?.x0} to ${gh.at?.x1}`);
  ensureDir(out);
  let bad = 0;
  const stored = {};
  for (const [name, m] of Object.entries({ down: masks.down, up: masks.up, 'up-right': masks.upRight, right: masks.right })) {
    if (!m) { console.log(`${name}: STUB. The battle idle sheet is not in the repo (TODO: build the right proxy when public/art/crew/rook/idle exists).`); continue; }
    const r = name === 'right' && masks.rightCheck ? masks.rightCheck : validateMask(m);
    if (!r.ok) bad++;
    console.log(`${name.padEnd(9)} ${r.ok ? 'PASS' : `FAIL ${r.violations.map((x) => x.name).join(',')}`}  cells ${maskCount(m)}  height ${r.height}  bottom row ${r.bottomRow}  head alone ${r.headAlone}`);
    writePng(renderMask(m, name === 'up' ? masks.upBand : []), `${out}/mask-${name}-32x.png`);
    stored[name] = maskRows(m);
  }
  if (masks.right) console.log(`right landmarks vs down mask (+-2): ${JSON.stringify(landmarkReport(masks.right, masks.down))}`);
  console.log(`up sheath band: ${masks.upBand.length} cells, ${JSON.stringify(SHEATH_BAND)}`);
  writeFileSync(`${out}/masks.json`, `${JSON.stringify({ masks: stored, upBand: masks.upBand }, null, 2)}\n`);
  if (a.includes('--write-target')) {
    writeTargetKey('masks', {
      note: 'Stage B silhouette masks, 32 rows of # (opaque) and . (transparent). Hard lines: height 31, bottom row 30, head alone 12 to 15 (rows 0 to 12), no hole. right is the raw battle-idle proxy, unclamped; rightCheck names the lines it breaks. Written by masks.mjs --write-target.',
      axis: 'mirror x <-> 35 - x (between columns 17 and 18)',
      rows: stored,
      rightCheck: masks.rightCheck ? { ok: masks.rightCheck.ok, failures: masks.rightCheck.violations.map((x) => x.name), headAlone: masks.rightCheck.headAlone } : null,
      upSheathBand: { rule: SHEATH_BAND, cells: masks.upBand.map(([x, y]) => `${x},${y}`) },
      givenHeadAlone: gh,
    });
    console.log('wrote target.json pipeline.masks');
  }
  process.exit(bad ? 1 : 0);
}
