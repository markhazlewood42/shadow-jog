/**
 * Art pipeline (scripts/art/pipeline): stage A part map, stage B masks, stage C classes, walk metrics, region-blank scorer.
 * Every hard line has a positive test on the given frame and a fail-path test: a mutated input must fail the named line.
 * The given frame comes from the committed walk zip (spritefusion-tests/rook-overworld-walk.zip), frame 4.
 * Pinned numbers were measured on the given; where a test can, it checks them a second way (raw pixels, not the pipeline code).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Img } from '../scripts/art/pixkit/index.mjs';
import {
  AXIS,
  bandRange,
  FACINGS,
  HEAD_ALONE,
  PART_NAMES,
  TARGET_JSON,
  blankBoxImage,
  blankRegion,
  buildMasks,
  buildPartMap,
  checkRight,
  checkWalk,
  classify,
  classifyAll,
  deriveBoxes,
  givenHeadAlone,
  hairWing,
  headAloneWidth,
  holes,
  labelsOf,
  dominantRect,
  largestPartRect,
  loadGiven,
  loadIdleFrames,
  loadWalkFrames,
  motifRules,
  maskAt,
  maskCount,
  maskFromRows,
  maskRows,
  measureWalk,
  motifFailures,
  motifOf,
  newMask,
  partMapFromRows,
  partRows,
  rampLockViolations,
  rightFromIdle,
  readTarget,
  rowExtent,
  scoreRegion,
  sheathBand,
  solidCandidate,
  SOURCES,
  validateMask,
  validatePartMap,
  walkRecord,
} from '../scripts/art/pipeline/index.mjs';
import type { Mask, PartMap } from '../scripts/art/pipeline/index.mjs';

// ---- helpers: copies and mutations of images, part maps and masks ----
const clone = (img: Img): Img => ({ w: img.w, h: img.h, data: new Uint8Array(img.data) });
const hexAt = (img: Img, x: number, y: number): string | null => {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return null;
  const i = (y * img.w + x) * 4;
  if (img.data[i + 3] === 0) return null;
  return `#${[0, 1, 2].map((k) => (img.data[i + k] ?? 0).toString(16).padStart(2, '0')).join('')}`;
};
const setHex = (img: Img, x: number, y: number, hex: string | null) => {
  const i = (y * img.w + x) * 4;
  if (hex === null) img.data.set([0, 0, 0, 0], i);
  else img.data.set([1, 3, 5].map((k) => Number.parseInt(hex.slice(k, k + 2), 16)).concat(255), i);
};
/** Move the cells of a rectangle by (dx, dy). Vacated cells become transparent. */
function moveRect(img: Img, x0: number, y0: number, x1: number, y1: number, dx: number, dy: number): Img {
  const out = clone(img);
  const keep: [number, number, string | null][] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) keep.push([x, y, hexAt(img, x, y)]);
  for (const [x, y] of keep) setHex(out, x, y, null);
  for (const [x, y, c] of keep) if (c && x + dx >= 0 && x + dx < img.w && y + dy >= 0 && y + dy < img.h) setHex(out, x + dx, y + dy, c);
  return out;
}
const clonePm = (pm: PartMap): PartMap => ({ w: pm.w, h: pm.h, parts: Object.fromEntries(Object.entries(pm.parts).map(([k, v]) => [k, [...v]])) });
const cellOf = (x: number, y: number) => y * 32 + x;
const removeCell = (pm: PartMap, part: string, i: number): PartMap => {
  const m = clonePm(pm);
  m.parts[part] = (m.parts[part] ?? []).filter((c) => c !== i);
  return m;
};
const names = (r: { violations: { name: string }[] }) => [...new Set(r.violations.map((v) => v.name))].sort();
const cloneMask = (m: Mask): Mask => ({ w: m.w, h: m.h, cells: new Uint8Array(m.cells) });
const setMask = (m: Mask, x: number, y: number, v: number) => {
  m.cells[y * m.w + x] = v;
};
const opaqueCount = (img: Img) => {
  let n = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] === 255) n++;
  return n;
};
/** T computed straight from RGBA: 4-adjacent pairs inside the set with different colors, per cell. Independent of the pipeline's measure(). */
function tOf(img: Img, cells: number[]): number {
  const set = new Set(cells);
  let pairs = 0;
  for (const i of cells) {
    const x = i % 32;
    for (const j of [x < 31 ? i + 1 : -1, i + 32]) {
      if (j < 0 || !set.has(j)) continue;
      if (hexAt(img, i % 32, Math.floor(i / 32)) !== hexAt(img, j % 32, Math.floor(j / 32))) pairs++;
    }
  }
  return pairs / cells.length;
}

type Rect = { x0: number; y0: number; x1: number; y1: number };
const NEAR_BLACK: string[] = readTarget().nearBlack;
/** One candidate box edit: recolor a frame cell. */
type Edit = [number, number, string];
/**
 * T, S, D and orphans of a box, straight from RGBA on a frame (no pipeline code).
 * T and S count inside the box. D and orphans look at the neighbors in the whole frame.
 */
function regionMetrics(frame: Img, b: Rect) {
  const cells: [number, number][] = [];
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) if (hexAt(frame, x, y) !== null) cells.push([x, y]);
  const inBox = (x: number, y: number) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
  let pairs = 0;
  let interior = 0;
  let interiorNb = 0;
  let orphans = 0;
  for (const [x, y] of cells) {
    const c = hexAt(frame, x, y);
    for (const [dx, dy] of [[1, 0], [0, 1]] as const) if (inBox(x + dx, y + dy) && hexAt(frame, x + dx, y + dy) !== null && hexAt(frame, x + dx, y + dy) !== c) pairs++;
    const n4 = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).every(([dx, dy]) => hexAt(frame, x + dx, y + dy) !== null);
    if (n4) {
      interior++;
      if (NEAR_BLACK.includes(c ?? '')) interiorNb++;
    }
    let same = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && hexAt(frame, x + dx, y + dy) === c) same = true;
    if (!same) orphans++;
  }
  // components of equal color (4-connected) inside the box with 1 or 2 cells
  const seen = new Set<string>();
  let small = 0;
  for (const [x, y] of cells) {
    if (seen.has(`${x},${y}`)) continue;
    const c = hexAt(frame, x, y);
    const stack: [number, number][] = [[x, y]];
    seen.add(`${x},${y}`);
    let size = 0;
    while (stack.length) {
      const [cx, cy] = stack.pop() as [number, number];
      size++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!inBox(nx, ny) || seen.has(`${nx},${ny}`) || hexAt(frame, nx, ny) !== c) continue;
        seen.add(`${nx},${ny}`);
        stack.push([nx, ny]);
      }
    }
    if (size <= 2) small++;
  }
  return { n: cells.length, T: pairs / cells.length, S: small / cells.length, D: interior ? interiorNb / interior : 0, orphans };
}
/** The given with the first k edits applied, as a 32x32 frame. */
function withEdits(img: Img, edits: Edit[]): Img {
  const out = clone(img);
  for (const [x, y, c] of edits) setHex(out, x, y, c);
  return out;
}
const boxImage = (frame: Img, b: Rect): Img => {
  const w = b.x1 - b.x0 + 1;
  const h = b.y1 - b.y0 + 1;
  const out: Img = { w, h, data: new Uint8Array(w * h * 4) };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setHex(out, x, y, hexAt(frame, b.x0 + x, b.y0 + y));
  return out;
};

const given = loadGiven();
const pm = buildPartMap(given);
const target = readTarget();
const pipe = target.pipeline ?? {};

describe('stage A: part map (every opaque pixel in exactly one part)', () => {
  it('the given has 432 opaque pixels, 13 parts, and every opaque pixel sits in exactly one part', () => {
    expect(opaqueCount(given)).toBe(432);
    expect(PART_NAMES).toHaveLength(13);
    const labels = labelsOf(pm);
    let held = 0;
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const l = labels[cellOf(x, y)] ?? [];
        const opaque = hexAt(given, x, y) !== null;
        expect(l.length).toBe(opaque ? 1 : 0);
        held += l.length;
      }
    expect(held).toBe(432);
    expect(validatePartMap(given, pm)).toEqual({ ok: true, violations: [] });
  });

  it('part cell counts are pinned', () => {
    const counts = Object.fromEntries(Object.entries(pm.parts).map(([k, v]) => [k, v.length]));
    expect(counts).toEqual({ hair: 79, skin: 33, lenses: 27, beard: 10, coat: 106, sleeves: 61, zipper: 30, hands: 26, legs: 15, boots: 17, sheath: 20, guard: 4, wrap: 4 });
  });

  it('the stored map in target.json is the same map and passes validation', () => {
    const stored = partMapFromRows(pipe.partMap.rows as string[]);
    expect(validatePartMap(given, stored).violations).toEqual([]);
    expect(partRows(pm)).toEqual(pipe.partMap.rows);
  });

  it('the katana pieces are where the target.json katana note says: sheath, guard and wrap left of the head', () => {
    // note: sheath #846042, guard and pommel #af8e46, wrap #352418, pixels (6,6) to (11,9)
    const at = (x: number, y: number) => labelsOf(pm)[cellOf(x, y)]?.[0];
    expect(at(6, 6)).toBe('guard'); // #af8e46
    expect(hexAt(given, 6, 6)).toBe('#af8e46');
    expect(at(7, 7)).toBe('sheath'); // #846042
    expect(hexAt(given, 7, 7)).toBe('#846042');
    expect(at(6, 7)).toBe('wrap'); // #352418
    expect(hexAt(given, 6, 7)).toBe('#352418');
  });

  it('FAIL unassigned: an opaque pixel taken out of its part is named', () => {
    const r = validatePartMap(given, removeCell(pm, 'coat', cellOf(15, 20)));
    expect(names(r)).toEqual(['unassigned']);
    expect(r.violations[0]).toMatchObject({ x: 15, y: 20 });
  });

  it('FAIL multi-assigned: a pixel in two parts is named', () => {
    const m = clonePm(pm);
    m.parts.sleeves?.push(cellOf(15, 20)); // already in coat
    const r = validatePartMap(given, m);
    expect(names(r)).toContain('multi-assigned');
  });

  it('FAIL label-on-transparent: a part that holds a transparent pixel is named', () => {
    const m = clonePm(pm);
    m.parts.coat?.push(cellOf(0, 0));
    expect(names(validatePartMap(given, m))).toEqual(['label-on-transparent']);
  });

  it('FAIL ramp-lock and rule-mismatch: an olive coat pixel moved to the hair part', () => {
    const m = removeCell(pm, 'coat', cellOf(15, 20));
    m.parts.hair?.push(cellOf(15, 20));
    const r = validatePartMap(given, m);
    expect(names(r)).toEqual(['ramp-lock', 'rule-mismatch']);
    expect(rampLockViolations(given, m)).toEqual([{ name: 'ramp-lock', part: 'hair', x: 15, y: 20, letter: 'n' }]);
  });

  it('FAIL rule-mismatch only: a coat pixel moved to sleeves (same ramp) passes the ramp lock but not the rules', () => {
    const m = removeCell(pm, 'coat', cellOf(15, 20));
    m.parts.sleeves?.push(cellOf(15, 20));
    expect(names(validatePartMap(given, m))).toEqual(['rule-mismatch']);
    expect(rampLockViolations(given, m)).toEqual([]);
  });

  it('FAIL unknown-part: a part name outside the 13 is named', () => {
    const m = clonePm(pm);
    m.parts.cape = [];
    expect(names(validatePartMap(given, m))).toEqual(['unknown-part']);
  });

  it('FAIL ramp-lock: a hair pixel recolored with a coat color fails the lock of its part', () => {
    const img = clone(given);
    setHex(img, 17, 2, '#6f7945'); // hair cell, olive coat color
    const r = validatePartMap(img, buildPartMap(img));
    expect(names(r)).toEqual(['ramp-lock']);
    expect(r.violations[0]).toMatchObject({ part: 'hair', x: 17, y: 2 });
  });

  it('FAIL unassigned: an opaque pixel in a place no rule covers (outside every box) is left unassigned', () => {
    const img = clone(given);
    setHex(img, 2, 8, '#030102'); // left of the hilt box, above the coat: no rule holds it
    const r = validatePartMap(img, buildPartMap(img));
    expect(names(r)).toEqual(['unassigned']);
    expect(r.violations[0]).toMatchObject({ x: 2, y: 8 });
  });
});

describe('stage A: motif numbers per part', () => {
  const motif = motifOf(given, pm);

  it('T of the hair and coat parts measures the same from raw pixels', () => {
    expect(tOf(given, pm.parts.hair ?? [])).toBeCloseTo(motif.hair?.T ?? -1, 3);
    expect(tOf(given, pm.parts.coat ?? [])).toBeCloseTo(motif.coat?.T ?? -1, 3);
    expect(motif.hair?.T).toBeGreaterThan(1); // hair is a texture, about 1.06 color changes per pixel
    expect(motif.hair?.runs?.max).toBeLessThanOrEqual(4);
  });

  it('the stored numbers in target.json re-measure within 5 percent for every part', () => {
    expect(motifFailures(pipe.partMotif.parts, motif)).toEqual([]);
  });

  it('pinned hair motif: 79 cells, T 1.0633, S 0.3797, orphans 2, letters p m t a', () => {
    expect(motif.hair).toMatchObject({ cells: 79, T: 1.0633, S: 0.3797, orphans: 2 });
    expect(Object.keys(motif.hair?.letters ?? {}).sort()).toEqual(['a', 'm', 'p', 't']);
  });

  it('FAIL motif-T and motif-S: a hair part painted one color does not re-measure to the stored numbers', () => {
    const flat = clone(given);
    for (const i of pm.parts.hair ?? []) setHex(flat, i % 32, Math.floor(i / 32), '#6b7075');
    const f = motifFailures(pipe.partMotif.parts, motifOf(flat, pm));
    const hair = f.filter((v) => v.part === 'hair').map((v) => v.name);
    expect(hair).toContain('motif-T');
    expect(hair).toContain('motif-S');
    expect(motifOf(flat, pm).hair?.T).toBeLessThan(0.8 * (motif.hair?.T ?? 0)); // the plan's 0.8x floor
  });

  it('FAIL motif-cells: a part with a different cell count is named', () => {
    const f = motifFailures({ hair: { cells: 80 } }, { hair: { cells: 79 } });
    expect(f).toEqual([{ name: 'motif-cells', part: 'hair', stored: 80, fresh: 79 }]);
  });

  it('the 5 percent line is a line: 4 percent passes, 6 percent fails', () => {
    const base = { cells: 10, T: 1, S: 1, D: 1, orphans: 10 };
    expect(motifFailures({ p: base }, { p: { ...base, T: 1.04 } })).toEqual([]);
    expect(motifFailures({ p: base }, { p: { ...base, T: 1.06 } }).map((v) => v.name)).toEqual(['motif-T']);
  });

  it('the 5 percent edge on real images: re-painting hair cells one by one, the T line fails exactly when T is more than 5 percent from the stored value', () => {
    const hairCells = pm.parts.hair ?? [];
    const stored = pipe.partMotif.parts.hair.T as number;
    let passes = 0;
    let fails = 0;
    let nearPass = 0;
    let nearFail = 0;
    const img = clone(given);
    for (const i of hairCells) {
      setHex(img, i % 32, Math.floor(i / 32), '#6b7075'); // flatten one more hair cell
      const t = tOf(img, hairCells); // T of the hair part from raw pixels
      const rel = Math.abs(t - stored) / stored;
      if (Math.abs(rel - 0.05) < 1e-9) continue;
      const failed = motifFailures(pipe.partMotif.parts, motifOf(img, pm)).some((v) => v.part === 'hair' && v.name === 'motif-T');
      expect(failed).toBe(rel > 0.05);
      if (failed) fails++;
      else passes++;
      if (rel > 0.04 && rel <= 0.05) nearPass++;
      if (rel > 0.05 && rel < 0.07) nearFail++;
    }
    expect(passes).toBeGreaterThan(0);
    expect(fails).toBeGreaterThan(0);
    expect(nearPass + nearFail).toBeGreaterThan(0); // the sweep has steps next to the edge, so a wider or narrower line is caught
  });

  it('hair runs: the longest horizontal run of one color is 4 (raw pixels), not the plan value 3; the rule data stores 4', () => {
    const set = new Set(pm.parts.hair);
    let longest = 0;
    for (let y = 0; y < 32; y++) {
      let run = 0;
      let prev: string | null = null;
      for (let x = 0; x < 32; x++) {
        const inHair = set.has(y * 32 + x);
        const c = inHair ? hexAt(given, x, y) : null;
        run = c !== null && c === prev ? run + 1 : c !== null ? 1 : 0;
        prev = c;
        longest = Math.max(longest, run);
      }
    }
    expect(longest).toBe(4);
    const rules = motifRules(motif);
    expect(rules.hair?.maxRun).toBe(4);
    expect(rules.hair?.letters).toBe('ampt');
    expect(pipe.partMotif.rules.hair.maxRun).toBe(4);
    expect(pipe.partMotif.planDisagreement).toContain('at most 3');
  });

  it('rules come from the cells that remain: blanking the hair wing removes exactly its hair cells from the hair numbers', () => {
    const box = deriveBoxes(given, pm).hairWing;
    const inside = (pm.parts.hair ?? []).filter((i) => i % 32 >= box.x0 && i % 32 <= box.x1 && Math.floor(i / 32) >= box.y0 && Math.floor(i / 32) <= box.y1).length;
    expect(inside).toBe(45);
    const m = motifOf(given, pm, { blank: box });
    expect(m.hair?.cells).toBe(79 - 45);
    expect(m.hair?.T).not.toBe(motif.hair?.T);
    // and the blanked cells are really blank for the measure: tOf on the blanked image over the remaining cells matches
    const rest = (pm.parts.hair ?? []).filter((i) => !(i % 32 >= box.x0 && i % 32 <= box.x1 && Math.floor(i / 32) >= box.y0 && Math.floor(i / 32) <= box.y1));
    expect(tOf(blankBoxImage(given, box), rest)).toBeCloseTo(m.hair?.T ?? -1, 3);
  });
});

describe('stage B: masks (height 31, bottom row 30, head alone 12 to 15, no hole)', () => {
  const masks = buildMasks(given, pm);
  const all: [string, Mask][] = [['down', masks.down], ['up', masks.up], ['up-right', masks.upRight]];
  const right = masks.right as Mask;

  it('the given head alone measures 14 px at x11 to 24 (plan: 13 to 14, x11 to 24)', () => {
    const h = givenHeadAlone(pm);
    expect(h.width).toBe(14);
    expect(h.at).toMatchObject({ x0: 11, x1: 24 });
    // the same number from raw pixels: opaque x extent of row 5 (the widest head row)
    const xs = [...Array(32).keys()].filter((x) => hexAt(given, x, 5) !== null && x >= 11);
    expect(Math.min(...xs)).toBe(11);
    expect(Math.max(...xs)).toBe(24);
  });

  it('the battle idle sheet is in the repo, so the right proxy is built (not stubbed)', () => {
    expect(loadIdleFrames()).toHaveLength(8);
    expect(masks.right).not.toBeNull();
  });

  it.each(all)('%s passes every hard line: height 31, bottom row 30, head alone 12 to 15, no hole', (_name, m) => {
    const r = validateMask(m);
    expect(r.violations).toEqual([]);
    expect([r.height, r.bottomRow]).toEqual([31, 30]);
    expect(r.headAlone).toBeGreaterThanOrEqual(HEAD_ALONE[0]);
    expect(r.headAlone).toBeLessThanOrEqual(HEAD_ALONE[1]);
  });

  it('pinned: cells and head alone per mask', () => {
    expect(all.map(([n, m]) => [n, maskCount(m), headAloneWidth(m)])).toEqual([['down', 416, 14], ['up', 416, 14], ['up-right', 384, 13]]);
  });

  it('right: the raw battle-idle proxy breaks 4 named lines (head alone 19, shoulder, hem and feet widths); nothing is clamped to hide them', () => {
    const c = masks.rightCheck;
    expect(c?.ok).toBe(false);
    expect(c?.violations.map((v) => v.name)).toEqual(['head-alone', 'landmark-shoulder', 'landmark-hem', 'landmark-feet']);
    expect([c?.height, c?.bottomRow, c?.headAlone]).toEqual([31, 30, 19]);
    expect(maskCount(right)).toBe(501);
    expect(pipe.masks.rightCheck).toEqual({ ok: false, failures: ['head-alone', 'landmark-shoulder', 'landmark-hem', 'landmark-feet'], headAlone: 19 });
  });

  it('the stored masks in target.json equal the rebuilt masks', () => {
    expect(pipe.masks.rows.down).toEqual(maskRows(masks.down));
    expect(pipe.masks.rows.up).toEqual(maskRows(masks.up));
    expect(pipe.masks.rows['up-right']).toEqual(maskRows(masks.upRight));
    expect(pipe.masks.rows.right).toEqual(maskRows(right));
    expect(validateMask(maskFromRows(pipe.masks.rows.down as string[])).ok).toBe(true);
  });

  it('down is symmetric about the axis between columns 17 and 18, and has no sheath or hilt cell', () => {
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) expect(maskAt(masks.down, x, y)).toBe(maskAt(masks.down, AXIS - x, y));
    for (let y = 0; y < 32; y++) for (let x = 0; x <= 6; x++) expect(maskAt(masks.down, x, y)).toBe(0); // the hilt is at x5 to 10 on rows 5 to 12
    expect(hexAt(given, 6, 6)).not.toBeNull(); // the given does have a pixel there
  });

  it('up-right is the given minus the sheath (28 cells) and the hair wing (20 cells): 432 - 28 - 20 = 384', () => {
    expect(maskCount(masks.upRight)).toBe(432 - 28 - 20);
    expect(maskAt(masks.upRight, 6, 6)).toBe(0);
    expect(maskAt(masks.upRight, 12, 5)).toBe(0); // a hair-wing cell
    expect(hairWing(given, pm)).toHaveLength(20);
  });

  it('the up sheath band is a straight 2 px diagonal from (12,14) to (22,24), 22 cells, all inside the up mask', () => {
    const band = sheathBand();
    expect(band).toHaveLength(22);
    for (let y = 14; y <= 24; y++) {
      const row = band.filter(([, by]) => by === y).map(([bx]) => bx).sort((a, b) => a - b);
      expect(row).toEqual([12 + (y - 14), 13 + (y - 14)]);
    }
    for (const [x, y] of band) expect(maskAt(masks.up, x, y)).toBe(1);
    expect(masks.upBand).toEqual(band);
  });

  /**
   * A synthetic battle-idle frame (79x68) whose reduced rows have the widths in w[0..30].
   * The reduction is 31/68, so a source pixel (sx, sy) lands in reduced cell (floor(sx*31/68), floor(sy*31/68)); a cell is opaque while its column is under the row width.
   */
  const idleWith = (w: number[]): Img => {
    const f: Img = { w: 79, h: 68, data: new Uint8Array(79 * 68 * 4) };
    for (let sy = 0; sy < 68; sy++)
      for (let sx = 0; sx < 79; sx++) {
        const ty = Math.min(30, Math.floor((sy * 31) / 68));
        const tx = Math.floor((sx * 31) / 68);
        if (tx < (w[ty] ?? 0)) setHex(f, sx, sy, '#6b7075');
      }
    return f;
  };
  const downWidths = Array.from({ length: 31 }, (_, y) => rowExtent(masks.down, y)?.width ?? 0);

  it('a proxy shaped like the down body passes every right line (so the failures below are not vacuous)', () => {
    const r = rightFromIdle(idleWith(downWidths), masks.down);
    expect(r.check.violations).toEqual([]);
    expect([r.check.height, r.check.bottomRow]).toEqual([31, 30]);
    expect(r.check.headAlone).toBeGreaterThanOrEqual(12);
    expect(r.check.headAlone).toBeLessThanOrEqual(15);
  });

  it('FAIL empty-row: a proxy with row 20 empty is refused by name, not given a 1 px row', () => {
    const w = [...downWidths];
    w[20] = 0;
    const r = rightFromIdle(idleWith(w), masks.down);
    expect(r.check.violations.map((v) => v.name)).toEqual(['empty-row']);
    expect(rowExtent(r.mask, 20)).toBeNull();
  });

  it('FAIL head-alone: a proxy with a 20 px head (rows 3 to 8) is refused by name, not capped to 15', () => {
    const w = [...downWidths];
    for (let y = 3; y <= 8; y++) w[y] = 20;
    const r = rightFromIdle(idleWith(w), masks.down);
    expect(r.check.violations.map((v) => v.name)).toContain('head-alone');
    expect(r.check.headAlone).toBeGreaterThan(15);
  });

  it('FAIL height and bottom-row: a proxy whose last row is empty ends on row 29', () => {
    const w = [...downWidths];
    w[30] = 0;
    const r = rightFromIdle(idleWith(w), masks.down);
    expect(r.check.violations.map((v) => v.name).sort()).toEqual(['bottom-row', 'height']);
  });

  it('FAIL landmark-shoulder: a proxy 4 px wider than the down body at row 14 is named; 2 px wider passes', () => {
    const wide = (d: number) => {
      const w = [...downWidths];
      w[14] = (w[14] ?? 0) + d;
      return rightFromIdle(idleWith(w), masks.down).check.violations.map((v) => v.name);
    };
    expect(wide(4)).toEqual(['landmark-shoulder']);
    expect(wide(0)).toEqual([]);
  });

  it('checkRight on the stored right mask reports the same four failures', () => {
    expect(checkRight(right, masks.down).violations.map((v) => v.name)).toEqual(['head-alone', 'landmark-shoulder', 'landmark-hem', 'landmark-feet']);
  });

  it('FAIL height: a mask with the top row removed has height 30', () => {
    const m = cloneMask(masks.down);
    for (let x = 0; x < 32; x++) setMask(m, x, 0, 0);
    const r = validateMask(m);
    expect(names(r)).toEqual(['height']);
    expect(r.height).toBe(30);
  });

  it('FAIL height: a mask with a row added below is 32 tall', () => {
    const m = cloneMask(masks.down);
    for (let x = 15; x <= 20; x++) setMask(m, x, 31, 1);
    expect(names(validateMask(m))).toContain('height');
  });

  it('FAIL bottom-row: the same 31 rows moved down one row end on row 31', () => {
    const m = newMask();
    for (let y = 0; y < 31; y++) for (let x = 0; x < 32; x++) setMask(m, x, y + 1, maskAt(masks.down, x, y));
    const r = validateMask(m);
    expect(r.height).toBe(31);
    expect(names(r)).toEqual(['bottom-row']);
    expect(r.bottomRow).toBe(31);
  });

  it('FAIL hole: one interior cell cleared is a hole', () => {
    const m = cloneMask(masks.down);
    setMask(m, 17, 18, 0);
    const r = validateMask(m);
    expect(names(r)).toEqual(['hole']);
    expect(holes(m)).toEqual([[17, 18]]);
  });

  it('a notch open to the outside is not a hole', () => {
    const m = cloneMask(masks.down);
    setMask(m, 8, 18, 0); // left edge cell of row 18
    expect(holes(m)).toEqual([]);
  });

  it('FAIL head-alone: a head 20 px wide (rows 3 and 4 widened to x8 to 27) is named', () => {
    const m = cloneMask(masks.down);
    for (const y of [3, 4]) for (let x = 8; x <= 27; x++) setMask(m, x, y, 1);
    const r = validateMask(m);
    expect(names(r)).toEqual(['head-alone']);
    expect(r.headAlone).toBe(20);
  });

  it('head alone: 15 px passes and 16 px fails, 12 px passes and 11 px fails', () => {
    // every head row (0 to 12) is set to the same width w, centered, so the widest head row is exactly w
    const wide = (w: number) => {
      const m = cloneMask(masks.down);
      for (let y = 0; y <= 12; y++) {
        for (let x = 0; x < 32; x++) setMask(m, x, y, 0);
        const lo = 18 - Math.ceil(w / 2);
        for (let x = lo; x < lo + w; x++) setMask(m, x, y, 1);
      }
      return m;
    };
    expect(headAloneWidth(wide(15))).toBe(15);
    expect(names(validateMask(wide(15)))).toEqual([]);
    expect(names(validateMask(wide(16)))).toEqual(['head-alone']);
    expect(names(validateMask(wide(12)))).toEqual([]);
    expect(names(validateMask(wide(11)))).toEqual(['head-alone']);
  });

  it('FAIL empty: a mask with no cell is named', () => {
    expect(names(validateMask(newMask()))).toEqual(['empty']);
  });

  it('rowExtent reads the row span of a mask row', () => {
    expect(rowExtent(masks.down, 0)).toEqual({ lo: 16, hi: 19, width: 4 });
    expect(rowExtent(masks.down, 31)).toBeNull();
  });
});

describe('stage C: copy, transform, invent', () => {
  const { masks, result } = classifyAll(given, pm);
  const classAt = (facing: string, x: number, y: number) => result[facing]?.cells[cellOf(x, y)];

  it('every mask cell has exactly one class, and no class sits outside the mask', () => {
    const by: Record<string, Mask> = { down: masks.down, up: masks.up, 'up-right': masks.upRight, right: masks.right as Mask };
    for (const f of FACINGS) {
      const r = result[f];
      const mask = by[f] as Mask;
      expect(r).not.toBeNull();
      let n = 0;
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          const c = r?.cells[cellOf(x, y)];
          expect(c !== null && c !== undefined).toBe(maskAt(mask, x, y) === 1);
          if (c) n++;
        }
      expect(n).toBe(maskCount(mask));
      expect((r?.counts.copy ?? 0) + (r?.counts.transform ?? 0) + (r?.counts.invent ?? 0)).toBe(n);
    }
  });

  it('pinned counts and invented share per facing (plan estimates: down 15, up 55, up-right 45, right 70 percent)', () => {
    const rows = FACINGS.map((f) => [f, result[f]?.counts.copy, result[f]?.counts.transform, result[f]?.counts.invent, Math.round(1000 * (result[f]?.share ?? 0)) / 10]);
    expect(rows).toEqual([['down', 194, 194, 28, 6.7], ['up', 21, 43, 352, 84.6], ['up-right', 44, 87, 253, 65.9], ['right', 0, 0, 501, 100]]);
    expect(pipe.classes.facings.up.invent).toBe(352);
  });

  it('down: the right half copies the given, the left half is its mirror, the face is not invented', () => {
    expect(classAt('down', 21, 8)).toBe('copy'); // an orange lens cell of the given
    expect(classAt('down', 14, 8)).toBe('transform'); // its mirror, x 35 - 21
    expect(classAt('down', 13, 6)).toBe('transform'); // a hair-wing position: never copied, filled by the mirror
    expect(classAt('down', 11, 3)).toBe('invent'); // the mirror source (24, 3) is transparent in the given
  });

  it('up: only legs, boots and the hem row come from the given; hair, coat, sleeves, hands and the face are invent', () => {
    expect(classAt('up', 21, 8)).toBe('invent'); // lens
    expect(classAt('up', 17, 2)).toBe('invent'); // crown hair: the back of the hair is invent
    expect(classAt('up', 20, 1)).toBe('invent'); // crown hair, right half
    expect(classAt('up', 22, 22)).toBe('invent'); // coat above the hem row: the back of the coat is invent
    expect(classAt('up', 24, 18)).toBe('invent'); // sleeve
    expect(classAt('up', 27, 22)).toBe('invent'); // hand
    expect(classAt('up', 20, 25)).toBe('copy'); // hem row
    expect(classAt('up', 19, 29)).toBe('copy'); // boots
    expect(classAt('up', 19, 26)).toBe('copy'); // legs
    expect(classAt('up', 16, 29)).toBe('transform'); // mirror of (19, 29)
    expect(classAt('up', 12, 14)).toBe('transform'); // band start, a coat cell that would otherwise be invented
    expect(classAt('up', 23, 24)).toBe('transform'); // band end
  });

  it('up: no cell of a hair, skin, lens, sleeve or hand part is copy or transform by position unless it is on the band', () => {
    const labels = labelsOf(pm);
    const band = new Set(masks.upBand.map(([x, y]) => cellOf(x, y)));
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const part = labels[cellOf(x, y)]?.[0];
        const c = classAt('up', x, y);
        if (c && c !== 'invent' && !band.has(cellOf(x, y)) && x >= 18) expect(['legs', 'boots', 'coat']).toContain(part);
        if (c === 'copy' && part === 'coat') expect(y).toBe(25);
      }
  });

  it('up-right: legs, boots and hem copy, sleeves and hands are the arm patch (transform, not copy), hair and face are invent', () => {
    expect(classAt('up-right', 17, 28)).toBe('copy'); // boots
    expect(classAt('up-right', 20, 25)).toBe('copy'); // hem
    expect(classAt('up-right', 10, 18)).toBe('transform'); // sleeve
    expect(classAt('up-right', 8, 22)).toBe('transform'); // hand
    expect(classAt('up-right', 17, 2)).toBe('invent'); // crown hair
    expect(classAt('up-right', 21, 8)).toBe('invent'); // lens
    expect(classAt('up-right', 15, 20)).toBe('invent'); // coat
    const copyParts = new Set<string | undefined>();
    const labels = labelsOf(pm);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (classAt('up-right', x, y) === 'copy') copyParts.add(labels[cellOf(x, y)]?.[0]);
    expect([...copyParts].sort()).toEqual(['boots', 'coat', 'legs']);
  });

  it('right (a side view): nothing is copied, boots included', () => {
    expect(classAt('right', 17, 30)).toBe('invent');
    expect(result.right?.counts.copy).toBe(0);
    expect(result.right?.counts.transform).toBe(0);
  });

  it('SOURCES: the table itself (an edit to it changes the pinned counts above)', () => {
    expect(SOURCES.up?.('hair', 2)).toBeNull();
    expect(SOURCES.up?.('coat', 22)).toBeNull();
    expect(SOURCES.up?.('coat', 25)).toBe('copy');
    expect(SOURCES['up-right']?.('sleeves', 18)).toBe('transform');
    expect(SOURCES.right?.('boots', 30)).toBeNull();
  });

  it('a facing outside the four throws', () => {
    expect(() => classify('left', masks.down, given, pm)).toThrow('unknown facing left');
  });

  it('FAIL: classifying a mask that gains a hilt cell gives that cell an invent class, never a copy of the sheath', () => {
    const m = cloneMask(masks.down);
    setMask(m, 6, 6, 1); // the given has a guard pixel here, but a sheath is never a source
    expect(classify('down', m, given, pm).cells[cellOf(6, 6)]).toBe('invent');
  });
});

describe('walk metrics on the given sheet', () => {
  const frames = loadWalkFrames();
  const rec = pipe.walk;
  const lensRow = (f: Img): number => {
    for (let y = 0; y < 14; y++) for (let x = 0; x < 32; x++) if (['#935416', '#db9332'].includes(hexAt(f, x, y) ?? '')) return y;
    return -1;
  };

  it('the sheet has 8 frames and frame 4 is the given', () => {
    expect(frames).toHaveLength(8);
    expect(Array.from(frames[4]?.data ?? [])).toEqual(Array.from(given.data));
  });

  it('bottom-row sequence is 30 on all 8 frames', () => {
    expect(measureWalk(frames).bottomRow).toEqual([30, 30, 30, 30, 30, 30, 30, 30]);
  });

  it('head-bob row sequence is 8 9 8 7 8 9 8 7, the same from raw lens pixels', () => {
    expect(measureWalk(frames).headBobRow).toEqual([8, 9, 8, 7, 8, 9, 8, 7]);
    expect(frames.map(lensRow)).toEqual([8, 9, 8, 7, 8, 9, 8, 7]);
    expect(measureWalk(frames).topRow).toEqual([0, 1, 0, 0, 0, 1, 0, 0]);
  });

  it('planted foot per frame and its shift are pinned, and no planted foot moves more than 1 px', () => {
    const m = measureWalk(frames);
    expect(m.planted.map((p) => p.foot)).toEqual(['LR', 'L', 'LR', 'L', 'R', 'R', 'LR', 'L']);
    expect(m.planted.map((p) => [p.dL, p.dR])).toEqual([[-1, 1], [0, -1], [1, -1], [1, -2], [2, 0], [-1, 0], [-1, 1], [-1, 2]]);
    expect(m.maxPlantedShift).toBe(1);
    expect(m.footEdges.map((e) => `${e?.L}-${e?.R}`)).toEqual(['11-24', '11-23', '12-22', '13-20', '15-20', '14-20', '13-21', '12-23']);
  });

  it('the stored record in target.json matches and the given passes the walk pass line against it', () => {
    expect(walkRecord(frames).bottomRow).toEqual(rec.bottomRow);
    expect(rec.headBobRow).toEqual([8, 9, 8, 7, 8, 9, 8, 7]);
    const r = checkWalk(frames, rec);
    expect(r.lines.map((l) => [l.name, l.pass])).toEqual([['bottom-row', true], ['planted-foot', true], ['bob', true]]);
  });

  it('FAIL planted-foot: the planted left foot of frame 1 moved 3 px right fails by name and nothing else', () => {
    const f = frames.map(clone);
    f[1] = moveRect(f[1] as Img, 0, 28, 16, 30, 3, 0); // frame 1: left foot is x11 to 16, rows 28 to 30
    const r = checkWalk(f, rec);
    expect(r.lines.filter((l) => !l.pass).map((l) => l.name)).toEqual(['planted-foot']);
    expect(measureWalk(f).footEdges[1]?.L).toBe(14);
  });

  it('planted-foot line: a 1 px move passes and a 2 px move fails', () => {
    const run = (dx: number) => {
      const f = frames.map(clone);
      f[1] = moveRect(f[1] as Img, 0, 28, 16, 30, dx, 0);
      return checkWalk(f, rec).lines.find((l) => l.name === 'planted-foot')?.pass;
    };
    // frame 1 left foot edge is 11; planted L means frame 0 to 1 dL is 0 for the given. A shift of dx gives dL = dx, and frame 2 then gives 12 - (11 + dx).
    expect(run(1)).toBe(true);
    expect(run(2)).toBe(false);
  });

  it('FAIL bottom-row: a frame moved up 3 rows fails, 2 rows is inside the tolerance (and then bob fails instead)', () => {
    const up = (dy: number) => {
      const f = frames.map(clone);
      f[3] = moveRect(f[3] as Img, 0, 0, 31, 31, 0, -dy);
      return checkWalk(f, rec);
    };
    expect(up(3).lines.find((l) => l.name === 'bottom-row')?.pass).toBe(false);
    expect(up(2).lines.find((l) => l.name === 'bottom-row')?.pass).toBe(true);
    expect(up(2).lines.find((l) => l.name === 'bob')?.pass).toBe(false);
  });

  it('FAIL bob: the head of frame 2 moved down 1 row changes the bob sequence and only that line fails', () => {
    const f = frames.map(clone);
    f[2] = moveRect(f[2] as Img, 0, 0, 31, 24, 0, 1); // head and torso down 1, legs stay
    const r = checkWalk(f, rec);
    expect(measureWalk(f).headBobRow[2]).toBe(9);
    expect(r.lines.find((l) => l.name === 'bob')?.pass).toBe(false);
    expect(r.lines.find((l) => l.name === 'bottom-row')?.pass).toBe(true);
  });

  it('FAIL: a sheet with 7 frames fails the line that counts frames', () => {
    const r = checkWalk(frames.slice(0, 7), rec);
    expect(r.ok).toBe(false);
  });
});

describe('region-blank scorer (plan 6a)', () => {
  const boxes = deriveBoxes(given, pm);
  const wing = boxes.hairWing;
  const coat = boxes.coat;
  /** The first coat box (all coat, 40 cells): the given measures S = 0 and orphans = 0 there, so it is the fixture for the zero-reference rule. */
  const flatCoat: Rect = { x0: 13, y0: 18, x1: 17, y1: 25 };
  const crop = boxImage;
  const pass = (r: { rows: { name: string; pass: boolean }[] }, n: string) => r.rows.find((x) => x.name === n)?.pass;

  it('names the hair-wing box x11..17 y0..10 (67 opaque cells) and the coat box x13..17 y11..25 (75 opaque cells)', () => {
    expect([wing.x0, wing.y0, wing.x1, wing.y1, wing.opaque, wing.cells]).toEqual([11, 0, 17, 10, 67, 77]);
    expect([coat.x0, coat.y0, coat.x1, coat.y1, coat.opaque, coat.cells]).toEqual([13, 11, 17, 25, 75, 75]);
    expect([wing.partCells, coat.partCells]).toEqual([45, 67]);
    expect(pipe.regions.boxes.hairWing).toEqual(wing);
    expect(pipe.regions.boxes.coat).toEqual(coat);
  });

  it('hair box: the bounding box of the hair cells left of the axis, hair-dominant, with texture (S and orphans above 0)', () => {
    const left = (pm.parts.hair ?? []).filter((i) => i % 32 <= 17);
    const xs = left.map((i) => i % 32);
    const ys = left.map((i) => Math.floor(i / 32));
    expect([wing.x0, wing.x1, wing.y0, wing.y1]).toEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]);
    expect(wing.partCells / wing.opaque).toBeGreaterThan(0.6);
    const m = regionMetrics(given, wing);
    expect(m.n).toBe(67);
    expect(m.S).toBeGreaterThan(0);
    expect(m.orphans).toBeGreaterThan(0);
    // the 20 hair-wing cells of the masks are inside it
    expect(hairWing(given, pm).every((i) => i % 32 >= wing.x0 && i % 32 <= wing.x1 && Math.floor(i / 32) >= wing.y0 && Math.floor(i / 32) <= wing.y1)).toBe(true);
  });

  it('coat box: fully opaque, at least 85 percent coat part, 60 to 120 cells, S and orphans above 0, and no larger rectangle qualifies', () => {
    const own = new Set(pm.parts.coat);
    const share = (b: Rect) => {
      let n = 0;
      let c = 0;
      for (let y = b.y0; y <= b.y1; y++)
        for (let x = b.x0; x <= b.x1; x++) {
          if (hexAt(given, x, y) === null) return null;
          n++;
          if (own.has(cellOf(x, y))) c++;
        }
      return { n, share: c / n };
    };
    const s0 = share(coat);
    expect(s0?.n).toBe(75);
    expect(s0?.share ?? 0).toBeGreaterThanOrEqual(0.85);
    const m = regionMetrics(given, coat);
    expect(m.S).toBeGreaterThan(0);
    expect(m.orphans).toBeGreaterThan(0);
    for (let y0 = 0; y0 < 32; y0++)
      for (let x0 = 0; x0 < 32; x0++)
        for (let y1 = y0; y1 < 32; y1++)
          for (let x1 = x0; x1 < 32; x1++) {
            const b = { x0, y0, x1, y1 };
            const area = (y1 - y0 + 1) * (x1 - x0 + 1);
            if (area <= 75 || area > 120) continue;
            const sh = share(b);
            if (!sh || sh.share < 0.85) continue;
            const mm = regionMetrics(given, b);
            expect(mm.S === 0 || mm.orphans === 0).toBe(true); // a bigger rectangle that qualified on share is out because it has no texture or no orphan
          }
    expect(dominantRect(given, pm, 'coat')).toMatchObject({ area: 75, x0: 13, y0: 11, x1: 17, y1: 25 });
    expect(largestPartRect(pm, 'coat')?.area).toBe(40); // the all-coat rectangle is smaller, which is why the box is not all-coat
  });

  it('blanking clears every cell inside the box and leaves every cell outside', () => {
    const b = blankRegion(given, wing);
    expect(opaqueCount(b)).toBe(432 - 67);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const inside = x >= wing.x0 && x <= wing.x1 && y >= wing.y0 && y <= wing.y1;
        expect(hexAt(b, x, y)).toBe(inside ? null : hexAt(given, x, y));
      }
  });

  it('one cell off by one ramp step: exact 76 of 77 cells (66 of 67 opaque), tolerant 100, bands still pass', () => {
    const cand = crop(given, wing);
    // (16,5) is skin 'r' #c38260 in the given; the next step up in the skin ramp is 'u' #d19c77
    expect(hexAt(cand, 16 - wing.x0, 5 - wing.y0)).toBe('#c38260');
    setHex(cand, 16 - wing.x0, 5 - wing.y0, '#d19c77');
    const r = scoreRegion(cand, given, wing);
    expect(r.rows.find((x) => x.name === 'exact')?.value).toBe(98.7);
    expect(r.rows.find((x) => x.name === 'tolerant')?.value).toBe(100);
    expect(r.exactOpaque).toEqual({ hit: 66, of: 67 });
    expect(r.failed).toEqual([]);
  });

  it('the given region as the candidate passes every row (sanity: exact 100)', () => {
    for (const b of [wing, coat]) {
      const r = scoreRegion(given, given, b);
      expect(r.ok).toBe(true);
      expect(r.rows.find((x) => x.name === 'exact')?.value).toBe(100);
    }
  });

  it('FAIL exact: a candidate shifted 1 px sideways loses the exact line but is judged only inside the box', () => {
    const cand = crop(moveRect(given, 0, 0, 31, 31, 1, 0), wing);
    const r = scoreRegion(cand, given, wing);
    expect(r.failed).toContain('exact');
  });

  it('FAIL everything: a blank candidate fails exact, tolerant, T, S, D and orphans in both boxes', () => {
    for (const b of [wing, coat]) {
      const r = scoreRegion({ w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1, data: new Uint8Array((b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1) * 4) }, given, b);
      expect(r.failed).toEqual(['exact', 'tolerant', 'T', 'S', 'D', 'orphans']);
    }
  });

  it('FAIL T and S: a one-color candidate (flattened texture) fails the 0.8x floors in the hair box', () => {
    const r = scoreRegion(solidCandidate(given, wing, 'm'), given, wing);
    expect(r.failed).toContain('T');
    expect(r.failed).toContain('S');
    const ref = regionMetrics(given, wing);
    expect(r.cand.T).toBeLessThan(0.8 * ref.T);
    expect(r.cand.S).toBeLessThan(0.8 * ref.S);
  });

  it('T floor is a line: 15 changes (0.375) pass, 10 changes (0.25) fail, reference 0.35, floor 0.28', () => {
    // the first coat box is 5 wide and 8 tall: every row boundary between two flat color stripes is 5 changes
    const stripes = (rowsPerStripe: number[]) => {
      const cand = crop(given, flatCoat);
      let y = 0;
      rowsPerStripe.forEach((n, k) => {
        for (let j = 0; j < n; j++, y++) for (let x = 0; x < cand.w; x++) setHex(cand, x, y, k % 2 ? '#454c29' : '#6f7945');
      });
      return scoreRegion(cand, given, flatCoat);
    };
    const ok = stripes([2, 2, 2, 2]); // 3 boundaries
    const low = stripes([3, 3, 2]); // 2 boundaries
    expect(regionMetrics(given, flatCoat).T).toBeCloseTo(0.35, 2);
    expect(ok.cand.T).toBeCloseTo(15 / 40, 3);
    expect(low.cand.T).toBeCloseTo(10 / 40, 3);
    expect(pass(ok, 'T')).toBe(true);
    expect(pass(low, 'T')).toBe(false);
  });

  // ---- band edges on real mutated images (plan section 4, written here as literals on purpose) ----
  const PLAN = { T: [0.8, 1.2], S: [0.8, 1.3], orphans: [0.7, 1.5], D: 0.08 } as const;
  type Counts = { pass: number; below: number; above: number };
  /** Apply the edits one by one. At every step the pipeline's row must equal the band decided from raw-pixel metrics. */
  function sweep(box: Rect, edits: Edit[], metrics: ('T' | 'S' | 'orphans' | 'D')[]) {
    const ref = regionMetrics(given, box);
    const counts: Record<string, Counts> = Object.fromEntries(metrics.map((m) => [m, { pass: 0, below: 0, above: 0 }]));
    for (let k = 0; k <= edits.length; k++) {
      const frame = withEdits(given, edits.slice(0, k));
      const res = scoreRegion(boxImage(frame, box), given, box);
      const m = regionMetrics(frame, box);
      for (const name of metrics) {
        const value = m[name];
        const [lo, hi] = name === 'D' ? [ref.D - PLAN.D, ref.D + PLAN.D] : [PLAN[name][0] * ref[name], PLAN[name][1] * ref[name]];
        if (Math.abs(value - lo) < 1e-9 || Math.abs(value - hi) < 1e-9) continue; // exactly on an edge: skip, floats
        const want = value >= lo && value <= hi;
        expect(pass(res, name), `${name} at step ${k}: value ${value}, band ${lo} to ${hi}`).toBe(want);
        const c = counts[name] as Counts;
        if (want) c.pass++;
        else if (value < lo) c.below++;
        else c.above++;
      }
    }
    return counts;
  }
  const opaqueCells = (b: Rect): [number, number][] => {
    const out: [number, number][] = [];
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) if (hexAt(given, x, y) !== null) out.push([x, y]);
    return out;
  };
  const dominant = (b: Rect): string => {
    const n = new Map<string, number>();
    for (const [x, y] of opaqueCells(b)) n.set(hexAt(given, x, y) as string, (n.get(hexAt(given, x, y) as string) ?? 0) + 1);
    return [...n.entries()].sort((a, c) => c[1] - a[1])[0]?.[0] as string;
  };
  /** Cells that match no 8-neighbor (the given's orphans in the box), each recolored to the color of a 4-neighbor. */
  const orphanEdits = (b: Rect): Edit[] => {
    const out: Edit[] = [];
    for (const [x, y] of opaqueCells(b)) {
      const c = hexAt(given, x, y);
      let same = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && hexAt(given, x + dx, y + dy) === c) same = true;
      if (same) continue;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const n = hexAt(given, x + dx, y + dy);
        if (n !== null && x + dx >= b.x0 && x + dx <= b.x1 && y + dy >= b.y0 && y + dy <= b.y1) {
          out.push([x, y, n]);
          break;
        }
      }
    }
    return out;
  };
  /** Near-black 4-connected components inside the box, smallest first, each given its own color that is not near-black. */
  const darkEdits = (b: Rect): Edit[][] => {
    const seen = new Set<string>();
    const comps: [number, number][][] = [];
    for (const [x, y] of opaqueCells(b)) {
      const c = hexAt(given, x, y) as string;
      if (seen.has(`${x},${y}`) || !NEAR_BLACK.includes(c)) continue;
      const stack: [number, number][] = [[x, y]];
      const cells: [number, number][] = [];
      seen.add(`${x},${y}`);
      while (stack.length) {
        const [cx, cy] = stack.pop() as [number, number];
        cells.push([cx, cy]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < b.x0 || nx > b.x1 || ny < b.y0 || ny > b.y1 || seen.has(`${nx},${ny}`) || hexAt(given, nx, ny) !== c) continue;
          seen.add(`${nx},${ny}`);
          stack.push([nx, ny]);
        }
      }
      comps.push(cells);
    }
    comps.sort((a, c) => a.length - c.length);
    return comps.map((cells, k) => cells.map(([x, y]): Edit => [x, y, `#80${(k + 1).toString(16).padStart(2, '0')}80`]));
  };

  it.each([['hair box', wing], ['coat box', coat]] as [string, Rect][])('%s, flattening cell by cell: T floor and S floor and orphans floor agree with raw pixels at every step', (_n, box) => {
    const dom = dominant(box);
    const edits = opaqueCells(box).map(([x, y]): Edit => [x, y, dom]);
    const c = sweep(box, edits, ['T', 'S', 'orphans']);
    for (const m of ['T', 'S', 'orphans']) {
      expect((c[m] as Counts).pass, `${m} has passing steps`).toBeGreaterThan(0);
      expect((c[m] as Counts).below, `${m} has steps below the floor`).toBeGreaterThan(0);
    }
  });

  it.each([['hair box', wing], ['coat box', coat]] as [string, Rect][])('%s, speckling cell by cell: T ceiling and S ceiling and orphans ceiling agree with raw pixels at every step', (_n, box) => {
    const edits = opaqueCells(box)
      .filter(([x, y]) => (x + y) % 2 === 0)
      .map(([x, y], i): Edit => [x, y, i % 2 ? '#935416' : '#c38260']);
    const c = sweep(box, edits, ['T', 'S', 'orphans']);
    for (const m of ['T', 'S', 'orphans']) {
      expect((c[m] as Counts).pass, `${m} has passing steps`).toBeGreaterThan(0);
      expect((c[m] as Counts).above, `${m} has steps above the ceiling`).toBeGreaterThan(0);
    }
  });

  it.each([['hair box', wing], ['coat box', coat]] as [string, Rect][])('%s, merging the orphans one by one: the orphans floor (0.7x) agrees with raw pixels at every step', (_n, box) => {
    const edits = orphanEdits(box);
    expect(edits.length).toBe(3); // the box has 3 orphans, floor 2.1: 3 passes, 2, 1 and 0 fail
    const c = sweep(box, edits, ['orphans', 'T', 'S']);
    expect((c.orphans as Counts).pass).toBeGreaterThan(0);
    expect((c.orphans as Counts).below).toBe(3);
  });

  it('orphans ceiling: 4 orphans pass and 5 fail in the hair box (ref 3, ceiling 4.5), by adding single isolated cells one at a time', () => {
    // one lone cell recolored to a color that no 8-neighbor has makes exactly one more orphan when its neighbors are not orphans themselves
    const cells: Edit[] = [[11, 3, '#db9332'], [14, 6, '#db9332'], [13, 2, '#db9332'], [15, 4, '#db9332'], [12, 6, '#db9332']];
    const counts: number[] = [];
    const passes: boolean[] = [];
    for (let k = 1; k <= cells.length; k++) {
      const frame = withEdits(given, cells.slice(0, k));
      counts.push(regionMetrics(frame, wing).orphans);
      passes.push(pass(scoreRegion(boxImage(frame, wing), given, wing), 'orphans') as boolean);
    }
    expect(counts.some((c) => c === 5)).toBe(true);
    for (const [i, c] of counts.entries()) expect(passes[i]).toBe(c >= 2.1 && c <= 4.5);
    expect(passes.some((p) => !p)).toBe(true);
    expect(passes.some((p) => p)).toBe(true);
  });

  it.each([['hair box', wing], ['coat box', coat]] as [string, Rect][])('%s, D alone: giving near-black components new colors keeps T and S exactly and moves only D, which fails once it is more than 0.08 off', (_n, box) => {
    const steps = darkEdits(box);
    const ref = regionMetrics(given, box);
    let applied: Edit[] = [];
    const seenD: { d: number; ok: boolean }[] = [];
    for (let k = 0; k <= steps.length; k++) {
      if (k > 0) applied = applied.concat(steps[k - 1] as Edit[]);
      const frame = withEdits(given, applied);
      const res = scoreRegion(boxImage(frame, box), given, box);
      const m = regionMetrics(frame, box);
      // T and S are unchanged: a color relabel of whole components cannot change them
      expect(m.T).toBeCloseTo(ref.T, 9);
      expect(m.S).toBeCloseTo(ref.S, 9);
      expect(pass(res, 'T')).toBe(true);
      expect(pass(res, 'S')).toBe(true);
      const diff = Math.abs(m.D - ref.D);
      if (Math.abs(diff - 0.08) < 1e-9) continue;
      expect(pass(res, 'D'), `D ${m.D} against ref ${ref.D}`).toBe(diff <= 0.08);
      seenD.push({ d: m.D, ok: diff <= 0.08 });
    }
    expect(seenD.some((s) => s.ok)).toBe(true);
    expect(seenD.some((s) => !s.ok)).toBe(true);
  });

  it('D pass case: a candidate with one near-black color swapped for another near-black color has the same D and passes it', () => {
    const cand = crop(given, wing);
    for (let y = 0; y < cand.h; y++) for (let x = 0; x < cand.w; x++) if (hexAt(cand, x, y) === '#030102') setHex(cand, x, y, '#290827');
    const r = scoreRegion(cand, given, wing);
    expect(regionMetrics(withEdits(given, []), wing).D).toBeCloseTo(r.ref.D, 9);
    expect(pass(r, 'D')).toBe(true);
    expect(pass(r, 'T')).toBe(true);
    expect(pass(r, 'S')).toBe(true);
  });

  it('FAIL D only: every near-black color relabeled to a non-near-black color keeps T, S and orphans and fails D by name', () => {
    const cand = crop(given, wing);
    for (let y = 0; y < cand.h; y++) for (let x = 0; x < cand.w; x++) if (hexAt(cand, x, y) === '#030102') setHex(cand, x, y, '#802080');
    const r = scoreRegion(cand, given, wing);
    expect(r.cand.D).toBeLessThan(r.ref.D - 0.08);
    expect(pass(r, 'D')).toBe(false);
    expect(pass(r, 'T')).toBe(true);
    expect(pass(r, 'S')).toBe(true);
    expect(pass(r, 'orphans')).toBe(true);
  });

  it('FAIL T (upper band) and orphans: a checkerboard candidate is too busy', () => {
    const cand = crop(given, coat);
    for (let y = 0; y < cand.h; y++) for (let x = 0; x < cand.w; x++) setHex(cand, x, y, (x + y) % 2 ? '#6f7945' : '#454c29');
    const r = scoreRegion(cand, given, coat);
    expect(r.cand.T).toBeGreaterThan(1.2 * r.ref.T);
    expect(r.failed).toContain('T');
  });

  // ---- a reference of 0: absolute range 0 to one unit ----
  it('zero reference: S and orphans have reference 0 in the first coat box; the band is 0 to one unit (1/opaque for S, 1 for orphans)', () => {
    const ref = regionMetrics(given, flatCoat);
    expect([ref.S, ref.orphans, ref.n]).toEqual([0, 0, 40]);
    expect(bandRange(0, [0.8, 1.3], 1 / 40)).toEqual([0, 1 / 40]);
    expect(bandRange(0, [0.7, 1.5], 1)).toEqual([0, 1]);
    expect(bandRange(0.4, [0.8, 1.3], 1 / 40)).toEqual([0.8 * 0.4, 1.3 * 0.4]);
    const island = (cells: [number, number][]) => {
      const cand = crop(given, flatCoat);
      for (const [x, y] of cells) setHex(cand, x - flatCoat.x0, y - flatCoat.y0, '#db9332'); // orange: no coat neighbor has it
      return { r: scoreRegion(cand, given, flatCoat), m: regionMetrics(withEdits(given, cells.map(([x, y]): Edit => [x, y, '#db9332'])), flatCoat) };
    };
    const one = island([[15, 20]]);
    expect([one.m.S, one.m.orphans]).toEqual([1 / 40, 1]);
    expect(pass(one.r, 'S')).toBe(true); // one island: inside the 0 to 1 unit band
    expect(pass(one.r, 'orphans')).toBe(true);
    const two = island([[15, 20], [17, 23]]);
    expect([two.m.S, two.m.orphans]).toEqual([2 / 40, 2]);
    expect(pass(two.r, 'S')).toBe(false); // two islands: over the unit
    expect(pass(two.r, 'orphans')).toBe(false);
  });

  it('scoring looks inside the box only: a change outside the box in a 32x32 candidate changes nothing', () => {
    const a = clone(given);
    const b = clone(given);
    setHex(b, 28, 2, '#030102');
    setHex(b, 5, 29, '#9ea5a8');
    expect(JSON.stringify(scoreRegion(b, given, coat))).toBe(JSON.stringify(scoreRegion(a, given, coat)));
  });

  it('a candidate of the wrong size is refused', () => {
    expect(() => scoreRegion({ w: 4, h: 4, data: new Uint8Array(64) }, given, wing)).toThrow('candidate is 4x4');
  });

  it('blankBoxImage is the image the writers see (box gone, 365 opaque left)', () => {
    expect(opaqueCount(blankBoxImage(given, wing))).toBe(365);
  });
});

describe('sources and target.json', () => {
  it('target.json keeps its existing keys and gains pipeline.{partMap, partMotif, masks, classes, walk, regions}', () => {
    expect(target.givenFrame).toBe(4);
    expect(target.given.bodyHeight).toBe(31);
    expect(target.given.headWidth).toBe(19);
    expect(Object.keys(pipe).sort()).toEqual(['classes', 'masks', 'partMap', 'partMotif', 'regions', 'walk']);
  });

  it('the idle sheet gives frame 0 of 79x68', () => {
    const f = loadIdleFrames()?.[0];
    expect([f?.w, f?.h]).toEqual([79, 68]);
  });
});

describe('CLIs: each stage runs and writes only into the out folder', () => {
  const script = (n: string) => fileURLToPath(new URL(`../scripts/art/pipeline/${n}.mjs`, import.meta.url));
  // masks exits 1 on purpose: the raw right proxy breaks named lines (see the stage B tests). The other four exit 0.
  it.each(['decompose', 'masks', 'classify', 'walk', 'region'])('node scripts/art/pipeline/%s.mjs runs, names its result and leaves target.json alone', (stage) => {
    const out = mkdtempSync(join(tmpdir(), 'rook-pipeline-'));
    const before = readFileSync(TARGET_JSON, 'utf8');
    try {
      const r = spawnSync(process.execPath, [script(stage), '--out', out], { encoding: 'utf8', env: { ...process.env, ROOK_PIPELINE_OUT: out } });
      expect(r.status).toBe(stage === 'masks' ? 1 : 0);
      if (stage === 'masks') expect(r.stdout).toContain('right     FAIL head-alone,landmark-shoulder,landmark-hem,landmark-feet');
      expect(r.stdout.length).toBeGreaterThan(20);
      expect(existsSync(join(out, stage === 'decompose' ? 'parts.json' : stage === 'masks' ? 'masks.json' : stage === 'classify' ? 'classify.json' : stage === 'walk' ? 'walk.json' : 'regions.json'))).toBe(true);
      expect(readFileSync(TARGET_JSON, 'utf8')).toBe(before);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60000);
});
