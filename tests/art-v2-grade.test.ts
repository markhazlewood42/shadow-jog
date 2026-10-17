/**
 * Art v2 grade kit (scripts/art/v2/grade): alignment, the target measures, the hard-line checker, reference labels, the calibration set,
 * the kit scan and the grade command. Grader-only code: it reads the Sprite Fusion references in spritefusion-tests/rook-8d-ref/.
 * Every hard line and every gate has a fail-path test: a mutated input must fail the named line.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Img } from '../scripts/art/pixkit/index.mjs';
import { newImage, writePng } from '../scripts/art/pixkit/index.mjs';
import { blankedGiven, getBox } from '../scripts/art/pipeline/heldout/heldout.mjs';
import { loadGiven } from '../scripts/art/pipeline/index.mjs';
import type { Gates, Labels, LineItem, Spec } from '../scripts/art/v2/grade/index.mjs';
import {
  N,
  REF_FACINGS,
  align,
  applyEdits,
  autoLabel,
  blobImage,
  buildCalibrationItems,
  boundaryF,
  bboxOf,
  boxScan,
  candidateFromRef,
  chamfer,
  checkHardLines,
  colorClass,
  colorMatch,
  de00Packed,
  deltaE00,
  distinctCalibration,
  edgeMask,
  EMD_WORST,
  emd,
  faceSkin,
  flipH,
  formatVerdict,
  gateMeasures,
  grade,
  landmarksOf,
  loadGates,
  loadParts,
  loadRefLabels,
  loadReference,
  loadScanReferences,
  loadSpec,
  makeTarget,
  measureAgainst,
  opaqueAt,
  pack,
  paletteEmd,
  partIou,
  pck,
  placeScaled,
  quantizeTo,
  recolorOutline,
  rgbToLab,
  rowsToLabels,
  runCalibration,
  scanImages,
  scanKit,
  setPixel,
  signature,
  S3_TRANSFORMS,
  MATCH_SHARE,
  textureDensity,
  toGroups,
  valueStructure,
  writeGates,
} from '../scripts/art/v2/grade/index.mjs';

const GRADE_DIR = 'scripts/art/v2/grade';
const hasRound8 = existsSync('C:/Users/markh/AppData/Local/Temp/rook-step3/round-8/facings/down.png');
let spec: Spec;
let gates: Gates;
const tmp = mkdtempSync(join(tmpdir(), 'art-v2-grade-'));

const clone = (img: Img): Img => ({ w: img.w, h: img.h, data: new Uint8Array(img.data) });
const hexPack = (h: string) => pack(Number.parseInt(h.slice(1, 3), 16), Number.parseInt(h.slice(3, 5), 16), Number.parseInt(h.slice(5, 7), 16));
const put = (img: Img, x: number, y: number, hex: string) => setPixel(img, x, y, hexPack(hex));
const clear = (img: Img, x: number, y: number) => img.data.fill(0, (y * img.w + x) * 4, (y * img.w + x) * 4 + 4);
const find = (items: LineItem[], id: string, nameRe?: RegExp) => items.find((i) => i.id === id && (!nameRe || nameRe.test(i.name)));
// Skin cells in the checker's own face rows (eye rows 5 to 10 from the top of the figure).
const faceSkinCells = (img: Img): number => faceSkin(img, bboxOf(img) as NonNullable<ReturnType<typeof bboxOf>>, [5, 10]).count;
const failing = (items: LineItem[]) => items.filter((i) => i.status === 'fail').map((i) => `${i.id} ${i.name}`);

beforeAll(() => {
  spec = loadSpec();
  gates = loadGates();
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('color math', () => {
  // Published CIEDE2000 test pairs (Sharma, Wu, Dalal 2005), the first pairs and four of the later ones.
  const pairs: [number[], number[], number][] = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
    [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[50, 2.5, 0], [56, -27, -3], 31.903],
  ];
  it('matches the published CIEDE2000 values', () => {
    for (const [a, b, want] of pairs) expect(deltaE00(a as [number, number, number], b as [number, number, number])).toBeCloseTo(want, 3);
  });
  it('is symmetric, and zero for the same color', () => {
    const a = rgbToLab(200, 120, 40);
    const b = rgbToLab(30, 90, 160);
    expect(deltaE00(a, b)).toBeCloseTo(deltaE00(b, a), 9);
    expect(de00Packed(pack(1, 2, 3), pack(1, 2, 3))).toBe(0);
  });
  it('classifies the Rook palette by family', () => {
    expect(colorClass(0x03, 0x01, 0x02)).toBe('nb');
    expect(colorClass(0x9e, 0xa5, 0xa8)).toBe('gray');
    expect(colorClass(0x61, 0x69, 0x3c)).toBe('olive');
    expect(colorClass(0xe4, 0xb0, 0x86)).toBe('skin');
    expect(colorClass(0xdb, 0x93, 0x32)).toBe('gold');
  });
});

describe('alignment (step 0)', () => {
  // A distinctive synthetic figure on the 32x32 canvas: 28 tall, with a lock of hair, one arm and a foot out to the side.
  const figure = (): Img => {
    const img = newImage(32, 32);
    for (let y = 0; y < 28; y++) for (let x = 10; x < 22; x++) put(img, x, y, '#61693c');
    for (let y = 0; y < 7; y++) for (let x = 6; x < 10; x++) put(img, x, y, '#9ea5a8'); // a lock of hair out to the left
    for (let y = 15; y < 19; y++) for (let x = 22; x < 28; x++) put(img, x, y, '#d19c77'); // an arm out to the right
    for (let y = 24; y < 28; y++) for (let x = 3; x < 10; x++) put(img, x, y, '#16180d'); // a foot out to the left
    return img;
  };
  it('finds a known shift and a known scale (31, shift 1,1)', () => {
    const ref = figure();
    const cand = placeScaled(ref, null, { s: 31, dx: 1, dy: 1, anchor: 'none' }).img;
    const got = align(cand, { img: ref, labels: null }, { anchor: 'none' });
    expect({ s: got.s, dx: got.dx, dy: got.dy }).toEqual({ s: 31, dx: 1, dy: 1 });
    expect(got.bf1).toBeCloseTo(1, 9);
  });
  it('finds a scale of 32 and a shift of -2,0', () => {
    const ref = figure();
    const cand = placeScaled(ref, null, { s: 32, dx: -2, dy: 0, anchor: 'none' }).img;
    const got = align(cand, { img: ref, labels: null }, { anchor: 'none' });
    expect({ s: got.s, dx: got.dx, dy: got.dy }).toEqual({ s: 32, dx: -2, dy: 0 });
    expect(got.bf1).toBeCloseTo(1, 9);
  });
  it('the search range is plus or minus 2 (with the 1 px boundary tolerance): a 5 px move is not matched', () => {
    const ref = figure();
    const cand = placeScaled(ref, null, { s: 31, dx: 5, dy: 1, anchor: 'none' }).img;
    const got = align(cand, { img: ref, labels: null }, { anchor: 'none' });
    expect(Math.abs(got.dx)).toBeLessThanOrEqual(2);
    expect(got.bf1).toBeLessThan(1);
  });
  it('with the box anchor a 2 px shift of the candidate is absorbed: BF1 is 1 and the scale is found', () => {
    const ref = figure();
    const base = placeScaled(ref, null, { s: 31, anchor: 'none' }).img;
    const shifted = placeScaled(ref, null, { s: 31, dx: 2, anchor: 'none' }).img;
    for (const cand of [base, shifted]) {
      const got = align(cand, { img: ref, labels: null });
      expect(got.s).toBe(31);
      expect(got.bf1).toBeCloseTo(1, 9);
    }
  });
  it('refuses an empty image', () => {
    expect(() => align(newImage(32, 32), { img: figure(), labels: null })).toThrow();
  });
});

describe('measures', () => {
  it('BF1 is 1 for the same outline, falls with a 3 px move, and holds for a 1 px move', () => {
    const a = clone(spec.given);
    const e = edgeMask(a);
    expect(boundaryF(e, e, 32, 32).f).toBe(1);
    const moved = flipH(a);
    expect(boundaryF(e, edgeMask(moved), 32, 32).f).toBeLessThan(0.9);
    const shifted1 = placeScaled(a, null, { s: 31, dx: 1, anchor: 'none', size: 32 }).img;
    expect(boundaryF(e, edgeMask(shifted1), 32, 32).f).toBeGreaterThan(0.9);
  });
  it('chamfer is 0 for equal outlines and grows with distance', () => {
    const e = edgeMask(spec.given);
    expect(chamfer(e, e, 32)).toEqual({ mean: 0, p95: 0 });
    const far = placeScaled(spec.given, null, { s: 31, dx: 3, anchor: 'none', size: 32 }).img;
    expect(chamfer(e, edgeMask(far), 32).mean).toBeGreaterThan(0.5);
  });
  it('part IoU: equal groups give 1, a group present in only one image gives 0', () => {
    const a = new Array(1024).fill(null) as (string | null)[];
    const b = new Array(1024).fill(null) as (string | null)[];
    for (let i = 0; i < 40; i++) {
      a[i] = 'hair';
      b[i] = 'hair';
    }
    for (let i = 100; i < 120; i++) a[i] = 'face';
    const r = partIou(a, b);
    expect(r.per.hair?.iou).toBe(1);
    expect(r.per.face?.iou).toBe(0);
    expect(r.min).toBe(0);
  });
  it('value structure r is 1 against itself and low against a flipped figure', () => {
    expect(valueStructure(spec.given, spec.given).r).toBeCloseTo(1, 9);
    expect(valueStructure(spec.given, flipH(spec.given)).r).toBeLessThan(0.95);
  });
  it('color match is 1 against itself', () => {
    expect(colorMatch(spec.given, spec.given).mean).toBe(1);
  });
  it('palette EMD: 0 for the same palette, the dE00 for two single colors', () => {
    expect(paletteEmd(spec.given, spec.given)).toBeCloseTo(0, 6);
    // F7: an image with no opaque cell is the worst case, never a perfect match
    const empty = newImage(32, 32);
    expect(paletteEmd(empty, spec.given)).toBe(EMD_WORST);
    expect(paletteEmd(spec.given, empty)).toBe(EMD_WORST);
    expect(paletteEmd(empty, empty)).toBe(EMD_WORST);
    expect(EMD_WORST).toBeGreaterThan(4); // far over the start line, so the line cannot pass on an empty image
    const a = newImage(32, 32);
    const b = newImage(32, 32);
    for (let i = 0; i < 20; i++) {
      put(a, i, 0, '#db9332');
      put(b, i, 0, '#61693c');
    }
    const want = de00Packed(hexPack('#db9332'), hexPack('#61693c'));
    expect(emd(signature(a), signature(b))).toBeCloseTo(want, 3);
  });
  it('PCK counts a missing point as a miss, and head points use the tighter radius', () => {
    const ref = { crown: [10, 0], lens1: [10, 8], hem: [10, 25] };
    const cand = { crown: [10, 1], lens1: [12, 8] };
    const r = pck(cand, ref, 31);
    expect(r.missing).toEqual(['hem']); // lens1 is 2 px off: inside 0.1 x 31 = 3.1, outside the head radius 0.05 x 31 = 1.55
    expect(r.pckHead).toBeCloseTo(0.5, 6);
    expect(r.pck).toBeCloseTo(2 / 3, 6);
  });
  it('texture density is higher for a noisy part than for a flat one', () => {
    const img = newImage(32, 32);
    const groups = new Array(1024).fill(null) as (string | null)[];
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        put(img, x, y, (x + y) % 2 ? '#353a1d' : '#9ea5a8');
        groups[y * 32 + x] = 'hair';
        put(img, x + 12, y, '#61693c');
        groups[y * 32 + x + 12] = 'torso';
      }
    const d = textureDensity(img, groups);
    expect(d.hair?.density).toBeGreaterThan(1);
    expect(d.torso?.density).toBe(0);
  });
  it('a reference scored against itself passes every gate', () => {
    const c = candidateFromRef(loadReference('s'), spec);
    const target = makeTarget(loadReference('s'), spec.nearBlack);
    const r = measureAgainst(c.img, target, { candLabels: c.labels });
    expect(r.measures.bf1).toBe(1);
    expect(r.measures.partMiou).toBeGreaterThan(0.95);
    expect(gateMeasures(r.measures, gates).pass).toBe(true);
  });
});

describe('outline recolor to the near-black rule', () => {
  it('turns light edge cells near-black and leaves interior cells and dark edge cells alone', () => {
    const ref = loadReference('s').img;
    const edge = edgeMask(ref);
    const { img, changed } = recolorOutline(ref, spec.nearBlack);
    expect(changed).toBeGreaterThan(0);
    for (let y = 0; y < ref.h; y++)
      for (let x = 0; x < ref.w; x++) {
        if (!opaqueAt(ref, x, y)) continue;
        const i = (y * ref.w + x) * 4;
        const lum = 0.299 * (img.data[i] ?? 0) + 0.587 * (img.data[i + 1] ?? 0) + 0.114 * (img.data[i + 2] ?? 0);
        if (edge[y * ref.w + x]) expect(lum).toBeLessThan(60);
        else expect([...img.data.subarray(i, i + 3)]).toEqual([...ref.data.subarray(i, i + 3)]);
      }
  });
  it('is idempotent', () => {
    const once = recolorOutline(loadReference('n').img, spec.nearBlack).img;
    expect(recolorOutline(once, spec.nearBlack).changed).toBe(0);
  });
});

describe('reference labels (grader-only data)', () => {
  it('every opaque cell of every reference has a part, and the record is true', () => {
    for (const f of REF_FACINGS) {
      const { img, labels, file } = loadReference(f);
      for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) expect(Boolean(labels[y * img.w + x])).toBe(opaqueAt(img, x, y));
      // rows = autoRows with the edits applied
      const rec = loadRefLabels(f);
      const rebuilt = applyEdits(rowsToLabels(rec.autoRows), img.w, img.h, rec.edits, img);
      expect(rebuilt).toEqual(labels);
      expect(Object.keys(file).length).toBeGreaterThan(5);
      expect(rec.method.length).toBeGreaterThan(2);
    }
  });
  it('landmarks follow the label grid', () => {
    for (const f of REF_FACINGS) {
      const rec = loadRefLabels(f);
      const lm = landmarksOf(rec.labels, rec.w, rec.h);
      for (const [k, v] of Object.entries(lm)) {
        expect(rec.landmarks[k]?.[0]).toBeCloseTo(v[0] ?? 0, 1);
        expect(rec.landmarks[k]?.[1]).toBeCloseTo(v[1] ?? 0, 1);
      }
    }
  });
  it('n has no face and no lens, and the front facings have both', () => {
    const parts = (f: string) => new Set(loadRefLabels(f).labels.filter(Boolean));
    expect(parts('n').has('lenses')).toBe(false);
    expect(parts('n').has('skin')).toBe(false);
    expect(parts('s').has('lenses')).toBe(true);
    expect(parts('sw').has('lenses')).toBe(true);
  });
  it('the automatic labeler agrees with the truth part map of the given on 90 percent of the cells (7 groups)', () => {
    const truth = toGroups(spec.givenLabels);
    const auto = toGroups(autoLabel(spec.given));
    let ok = 0;
    let n = 0;
    for (let i = 0; i < truth.length; i++)
      if (truth[i]) {
        n++;
        if (truth[i] === auto[i]) ok++;
      }
    expect(ok / n).toBeGreaterThan(0.9);
  });
});

describe('hard-line checker', () => {
  const run = (img: Img, o: Record<string, unknown> = {}) => checkHardLines(img, { facing: 'se', spec, gates, ...o });
  const mustFail = (img: Img, id: string, nameRe: RegExp | undefined, o: Record<string, unknown> = {}) => {
    const res = run(img, o);
    expect(find(res.items, id, nameRe)?.status, `${id} ${nameRe}: ${failing(res.items).join('; ')}`).toBe('fail');
    expect(res.pass).toBe(false);
  };

  it('the given passes every line', () => {
    const res = run(spec.given);
    expect(failing(res.items)).toEqual([]);
    expect(res.pass).toBe(true);
  });
  it('PA-01: an off-palette color fails', () => {
    const img = clone(spec.given);
    put(img, 16, 18, '#123456');
    mustFail(img, 'PA-01', /palette/);
  });
  it('PA-02: a half-transparent pixel fails', () => {
    const img = clone(spec.given);
    img.data[(18 * 32 + 16) * 4 + 3] = 128;
    mustFail(img, 'PA-02', undefined);
  });
  it('PA-03: a light outline fails', () => {
    const img = clone(spec.given);
    const e = edgeMask(img);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (e[y * 32 + x]) put(img, x, y, '#9ea5a8');
    mustFail(img, 'PA-03', /outline/);
  });
  it('HL-HEIGHT: a short figure fails', () => {
    const img = clone(spec.given);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 32; x++) clear(img, x, y);
    mustFail(img, 'HL-HEIGHT', undefined);
  });
  it('HL-BOTTOM: a figure that stands one row high fails', () => {
    const img = placeScaled(spec.given, null, { s: 31, dy: -1, anchor: 'none', size: 32 }).img;
    mustFail(img, 'HL-BOTTOM', undefined);
  });
  it('HL-HEAD: a narrow head fails', () => {
    const img = clone(spec.given);
    for (let y = 0; y < 13; y++) for (let x = 19; x < 32; x++) clear(img, x, y);
    mustFail(img, 'HL-HEAD', undefined);
  });
  it('HL-SHOULDER: a torso that starts 3 rows late fails', () => {
    const img = clone(spec.given);
    for (let y = 11; y < 14; y++) for (let x = 0; x < 32; x++) clear(img, x, y);
    mustFail(img, 'HL-SHOULDER', undefined);
  });
  it('HL-HIP: a torso that ends 4 rows early fails', () => {
    const img = clone(spec.given);
    for (let y = 22; y < 26; y++) for (let x = 0; x < 32; x++) clear(img, x, y);
    mustFail(img, 'HL-HIP', undefined);
  });
  it('HL-FACE: a face on the back view fails, and a front view with no face skin fails', () => {
    mustFail(spec.given, 'HL-FACE', undefined, { facing: 'n' });
    const img = clone(spec.given);
    for (let y = 5; y <= 10; y++) for (let x = 0; x < 32; x++) if (opaqueAt(img, x, y) && colorClass(img.data[(y * 32 + x) * 4] ?? 0, img.data[(y * 32 + x) * 4 + 1] ?? 0, img.data[(y * 32 + x) * 4 + 2] ?? 0) === 'skin') put(img, x, y, '#7f8587');
    mustFail(img, 'HL-FACE', undefined, { facing: 's' });
  });
  it('HL-FACE: ne and nw allow skin only on the near cheek edge (F4: the planted skin stays under the max, so only the edge rule can fail)', () => {
    const rule = (gates.hardLines.faceSkin as unknown as Record<string, { max: number; edgeCols: number }>).ne as { max: number; edgeCols: number };
    for (const facing of ['ne', 'nw']) {
      const cand = candidateFromRef(loadReference(facing), spec) as { img: Img; labels: (string | null)[] };
      const base = run(cand.img, { facing, labels: cand.labels });
      expect(find(base.items, 'HL-FACE')?.status, facing).toBe('pass');
      // Head columns per row, from the labels the checker itself uses (head parts: hair, skin, lenses, beard).
      const head = new Set(['hair', 'skin', 'lenses', 'beard']);
      const span = (y: number) => {
        const xs = [...Array(32).keys()].filter((x) => head.has(cand.labels[y * 32 + x] as string));
        return { lo: Math.min(...xs), hi: Math.max(...xs) };
      };
      const plant = (where: 'middle' | 'edge') => {
        const img = clone(cand.img);
        const cells: number[][] = [];
        const room = Math.min(4, rule.max - faceSkinCells(cand.img)); // stay under the max
        for (let y = 6; y <= 9 && cells.length < room; y++) {
          const { lo, hi } = span(y);
          const xs = where === 'middle' ? [lo + rule.edgeCols + 1, lo + rule.edgeCols + 2] : [lo, lo + 1];
          for (const x of xs) if (cells.length < room && x - lo > (where === 'middle' ? rule.edgeCols : -1) && opaqueAt(img, x, y) && hi - x > (where === 'middle' ? rule.edgeCols : -1)) cells.push([x, y]);
        }
        for (const [x, y] of cells) put(img, x as number, y as number, '#e4b086');
        return img;
      };
      const mid = plant('middle');
      const count = (img: Img) => faceSkinCells(img);
      // The planted image stays under the max, so the max rule cannot be what fails.
      expect(count(mid), `${facing} skin count under the max`).toBeLessThanOrEqual(rule.max);
      expect(count(mid)).toBeGreaterThan(count(cand.img));
      const bad = find(run(mid, { facing, labels: cand.labels }).items, 'HL-FACE');
      expect(bad?.status, facing).toBe('fail');
      expect(bad?.detail, facing).toMatch(/away from the cheek edge/);
      // The same count of skin cells on the cheek edge passes.
      const edge = plant('edge');
      expect(count(edge)).toBeLessThanOrEqual(rule.max);
      expect(find(run(edge, { facing, labels: cand.labels }).items, 'HL-FACE')?.status, `${facing} edge`).toBe('pass');
    }
  });
  it('HL-DISTINCT: a facing that equals another facing, or its flip, fails', () => {
    const g = { ...gates, hardLines: { ...gates.hardLines, distinctN: 20 } };
    const other = candidateFromRef(loadReference('ne'), spec).img;
    const same = run(spec.given, { gates: g, name: 'x', set: [{ name: 'se', img: spec.given }] });
    expect(find(same.items, 'HL-DISTINCT')?.status).toBe('fail');
    const flipped = run(flipH(other), { gates: g, name: 'x', set: [{ name: 'ne', img: other }] });
    expect(find(flipped.items, 'HL-DISTINCT')?.status).toBe('fail');
    const different = run(spec.given, { gates: g, name: 'x', set: [{ name: 'ne', img: other }] });
    expect(find(different.items, 'HL-DISTINCT')?.status).toBe('pass');
  });
  it('HL-DISTINCT is skipped, never passed, until N is calibrated', () => {
    const g = { ...gates, hardLines: { ...gates.hardLines, distinctN: null } };
    expect(find(run(spec.given, { gates: g, set: [{ name: 'se', img: spec.given }], name: 'x' }).items, 'HL-DISTINCT')?.status).toBe('skipped');
  });
  it('PA-06: a box 9 px wider than the given fails for s and n, and the line does not run for ne', () => {
    const img = clone(spec.given);
    put(img, 0, 15, '#030102');
    put(img, 31, 15, '#030102');
    mustFail(img, 'PA-06', /box width/, { facing: 's' });
    expect(find(run(img, { facing: 'ne' }).items, 'PA-06', /box width/)).toBeUndefined();
  });
  it('PA-07: a head with a wide spike fails', () => {
    const img = clone(spec.given);
    put(img, 0, 2, '#030102');
    put(img, 31, 2, '#030102');
    mustFail(img, 'PA-07', /head width/, { facing: 's' });
  });
  it('PA-08: a set whose colors share under 90 percent with the candidate fails', () => {
    const lone = newImage(32, 32);
    put(lone, 5, 5, '#030102');
    mustFail(spec.given, 'PA-08', /another facing/, { set: [{ name: 'lone', img: lone }] });
  });
  it('PA-04: 25 isolated pixels fail the orphan line', () => {
    const img = clone(spec.given);
    for (let k = 0; k < 25; k++) put(img, 12 + (k % 5) * 2, 16 + Math.floor(k / 5) * 2, '#846042');
    mustFail(img, 'PA-04', undefined);
  });
  it('PA-09: a checkerboard of dark and light fails the small-region line', () => {
    const img = clone(spec.given);
    for (let y = 15; y < 25; y++) for (let x = 12; x < 24; x++) put(img, x, y, (x + y) % 2 ? '#353a1d' : '#9ea5a8');
    mustFail(img, 'PA-09', undefined);
  });
  it('PA-21: the expected sheath side is a gate when given', () => {
    expect(find(run(spec.given).items, 'PA-21')?.status).toBe('info');
    mustFail(spec.given, 'PA-21', undefined, { sheathSide: 'right' });
    expect(find(run(spec.given, { sheathSide: 'left' }).items, 'PA-21')?.status).toBe('pass');
  });
  it('HL-RAMP: a skin color inside the coat fails against a template, and the line is skipped without one', () => {
    const labels = spec.givenLabels;
    const img = clone(spec.given);
    put(img, 14, 20, '#e4b086');
    mustFail(img, 'HL-RAMP', undefined, { labels, template: true });
    expect(find(run(img).items, 'HL-RAMP')?.status).toBe('skipped');
    expect(find(run(spec.given, { labels, template: true }).items, 'HL-RAMP')?.status).toBe('pass');
  });
  it('HL-FLAT: a flat head fails the texture floor', () => {
    const img = clone(spec.given);
    const hair = '#7f8587';
    for (let y = 0; y < 11; y++) for (let x = 11; x < 25; x++) if (spec.givenLabels[y * 32 + x] === 'hair') put(img, x, y, hair);
    mustFail(img, 'HL-FLAT', undefined, { labels: spec.givenLabels });
  });
  it('an empty image fails', () => {
    const res = run(newImage(32, 32));
    expect(res.pass).toBe(false);
  });
  it('the calibration re-set applies only when useReset is true', () => {
    const ne = candidateFromRef(loadReference('ne'), spec);
    const strict = run(ne.img, { facing: 'ne', labels: ne.labels });
    const relaxed = run(ne.img, { facing: 'ne', labels: ne.labels, gates: { ...gates, hardLines: { ...gates.hardLines, useReset: true } } });
    expect(failing(strict.items).length).toBeGreaterThan(failing(relaxed.items).length);
  });
});

describe('calibration set and runner', () => {
  let res: ReturnType<typeof runCalibration>;
  beforeAll(() => {
    res = runCalibration({ spec, gates });
  });
  it('has the groups of plan section 4', () => {
    const count = (g: string) => res.rows.filter((r) => r.group === g).length;
    expect(count('pass-near')).toBeGreaterThanOrEqual(30);
    expect(count('pass-real')).toBeGreaterThanOrEqual(7);
    expect(count('fail-near')).toBeGreaterThanOrEqual(13);
    expect(count('fail-far')).toBeGreaterThanOrEqual(15);
    if (hasRound8) expect(res.rows.some((r) => r.id.includes('round8'))).toBe(true);
  });
  it('has a slot for T1 outputs: <facing>.png files in a folder join the realistic pass group', () => {
    const dir = join(tmp, 't1');
    mkdirSync(dir, { recursive: true });
    writePng(candidateFromRef(loadReference('s'), spec).img, join(dir, 's.png'));
    const items = buildCalibrationItems({ spec, t1Dir: dir });
    const t1 = items.filter((i) => i.id.startsWith('t1:'));
    expect(t1.map((i) => [i.id, i.group])).toEqual([['t1:s', 'pass-real']]);
  });
  it('the plan fallback follows the count: fewer than passMeasures gating measures means Mark gates the facing', () => {
    // T0 pass line: at least 4 measures separate. When they do not, plan section 4 hands the facing to Mark. The runner, gates.json and the grade verdict all say so.
    expect(res.markGates).toBe(res.gating.length < gates.passMeasures);
    expect((gates as unknown as { calibration: { markGates: boolean; gatingCount: number } }).calibration.markGates).toBe(res.markGates);
    expect((gates as unknown as { calibration: { markGates: boolean; gatingCount: number } }).calibration.gatingCount).toBe(res.gating.length);
    const c = candidateFromRef(loadReference('s'), spec);
    const v = grade(c.img, { facing: 's', labels: c.labels, spec, gates });
    expect(v.markGates).toBe(res.gating.length < gates.passMeasures);
    if (v.markGates) expect(v.notes.join(' ')).toMatch(/Mark gates this facing/);
    // a gates file with enough gating measures does not hand the facing to Mark
    const four = JSON.parse(JSON.stringify(gates)) as Gates;
    Object.keys(four.targetMeasures).forEach((k, i) => {
      const m = four.targetMeasures[k];
      if (m) m.role = i < 4 ? 'gate' : 'report';
    });
    expect(grade(c.img, { facing: 's', labels: c.labels, spec, gates: four }).markGates).toBe(false);
    four.passMeasures = 5;
    expect(grade(c.img, { facing: 's', labels: c.labels, spec, gates: four }).markGates).toBe(true);
  });
  it('F6: every item in a gating group is scored on all part groups, the groups the gate runs on', () => {
    const scored = res.items.filter((i) => i.group !== 'info');
    expect(scored.filter((i) => i.groupsOnly)).toEqual([]);
    const walk = res.items.filter((i) => /^walk\d+:vs-given$/.test(i.id));
    expect(walk.length).toBe(7);
    for (const w of walk) expect(w.group).toBe('pass-real');
    // the head-and-torso variant is kept as an info item, in no group
    const ht = res.items.filter((i) => /^walk\d+:head-torso$/.test(i.id));
    expect(ht.length).toBe(7);
    for (const h of ht) {
      expect(h.group).toBe('info');
      expect(h.groupsOnly).toEqual(['hair', 'face', 'torso']);
    }
  });
  it('F6: the head-and-torso sensitivity run swaps the two groups, and an unknown scope throws', () => {
    const sens = runCalibration({ spec, gates, walkScope: 'head-torso' });
    expect(sens.items.filter((i) => i.group === 'pass-real' && /^walk\d+:head-torso$/.test(i.id)).length).toBe(7);
    expect(sens.items.filter((i) => i.group === 'pass-real' && /^walk\d+:vs-given$/.test(i.id)).length).toBe(0);
    // the walk frames' worst pass value is higher when only head and torso count, for the part mIoU
    const pm = (r: ReturnType<typeof runCalibration>) => r.table.find((t) => t.key === 'partMiou')?.passWorst.v ?? 0;
    expect(pm(sens)).toBeGreaterThan(pm(res));
    expect(() => runCalibration({ spec, gates, walkScope: 'nope' as never })).toThrow(/walkScope/);
  });
  it('F8: the near copies are rescaled to 31 (the as-is item) and 33, as plan section 4 says, not to 30 and 32', () => {
    const ids = res.items.filter((i) => i.group === 'pass-near').map((i) => i.id.split(':')[1]);
    expect(ids).not.toContain('scale30');
    expect(ids).not.toContain('scale32');
    expect(ids.filter((i) => i === 'scale33').length).toBe(REF_FACINGS.length);
    for (const f of REF_FACINGS) {
      const item = (id: string) => res.items.find((i) => i.id === `${f}:${id}`);
      const ref = loadReference(f);
      // as-is is the 31 px rescale; scale33 is the 33 px rescale. A 33 px figure does not fit the 32 px canvas: the top rows are cut off, which is why it is a measure-only item.
      expect(item('as-is')?.cand.data, `${f} as-is`).toEqual(candidateFromRef(ref, spec, { h: 31 }).img.data);
      expect(item('scale33')?.cand.data, `${f} scale33`).toEqual(candidateFromRef(ref, spec, { h: 33 }).img.data);
      expect(item('scale33')?.cand.data, `${f} 33 differs from 31`).not.toEqual(item('as-is')?.cand.data);
      expect(item('scale33')?.note, f).toMatch(/33 px/);
      expect(item('scale33')?.hardLines, f).toBe(false);
      expect(bboxOf(item('as-is')?.cand as Img)?.h, `${f} as-is height`).toBe(31);
    }
  });
  it('a separating measure has its gate between the worst pass and the best fail', () => {
    for (const t of res.table.filter((r) => r.separates)) {
      const lo = Math.min(t.passWorst.v, t.failBest.v);
      const hi = Math.max(t.passWorst.v, t.failBest.v);
      expect(t.gate).toBeGreaterThanOrEqual(lo);
      expect(t.gate).toBeLessThanOrEqual(hi);
    }
  });
  it.skipIf(!hasRound8)('gates.json holds this calibration (the round 8 files are part of the set)', () => {
    expect(gates.calibratedOn).not.toBeNull();
    for (const t of res.table) {
      const g = gates.targetMeasures[t.key];
      expect(g?.role).toBe(t.separates ? 'gate' : 'report');
      if (t.separates) expect(g?.calibrated).toBeCloseTo(t.gate ?? 0, 3);
    }
    expect(gates.hardLines.distinctN).toBe(distinctCalibration(spec).n);
  });
  it.skipIf(!hasRound8)('the hard lines catch the PA-CM-01 miss (the round 8 facings)', () => {
    const miss = res.lineRows.filter((r) => r.id.includes('round8'));
    for (const r of miss) expect(r.pass).toBe(false);
  });
  it('writes gates in the same shape it read them', () => {
    const path = join(tmp, 'gates.json');
    const written = writeGates(res, gates, { path, date: '2000-01-01' });
    expect(Object.keys(written.targetMeasures)).toEqual(Object.keys(gates.targetMeasures));
    expect(written.calibratedOn).toBe('2000-01-01');
    expect(JSON.parse(readFileSync(path, 'utf8')).hardLines.distinctN).toBe(res.distinct.n);
  });
});

describe('gates (fail path for each target measure)', () => {
  const good: Record<string, number> = { bf1: 1, partMiou: 1, partMin: 1, chamferMean: 0, chamferP95: 0, valueR: 1, colorMatch: 1, paletteEmd: 0, pck: 1, pckHead: 1, textureMax: 0 };
  it('every measure passes at its best and fails just beyond its gate, in the right direction', () => {
    const all = gateMeasures(good as never, gates);
    expect(all.pass).toBe(true);
    for (const [key, m] of Object.entries(gates.targetMeasures)) {
      const gate = m.calibrated ?? m.start;
      const bad = { ...good, [key]: m.dir === 'min' ? gate - 0.01 : gate + 0.01 };
      const r = gateMeasures(bad as never, gates);
      const row = r.rows.find((x) => x.key === key);
      expect(row?.pass, key).toBe(false);
      // The whole verdict fails only when the measure gates.
      expect(r.pass, key).toBe(m.role === 'report');
      const ok = gateMeasures({ ...good, [key]: m.dir === 'min' ? gate + 0.001 : gate - 0.001 } as never, gates);
      expect(ok.rows.find((x) => x.key === key)?.pass, key).toBe(true);
    }
  });
  it('an uncalibrated measure gates at its start value', () => {
    const g = JSON.parse(JSON.stringify(gates)) as Gates;
    const m = g.targetMeasures.bf1;
    if (m) {
      m.role = null;
      m.calibrated = null;
    }
    const r = gateMeasures({ ...good, bf1: 0.5 } as never, g);
    expect(r.pass).toBe(false);
    expect(r.rows.find((x) => x.key === 'bf1')?.calibrated).toBe(false);
  });
});

describe('grade command', () => {
  it('a reference as a candidate passes the target measures; a blob fails them and the verdict', () => {
    const c = candidateFromRef(loadReference('s'), spec);
    const ok = grade(c.img, { facing: 's', labels: c.labels, spec, gates });
    expect(ok.targetPass).toBe(true);
    const blob = grade(blobImage(spec), { facing: 's', spec, gates });
    expect(blob.targetPass).toBe(false);
    expect(blob.pass).toBe(false);
    expect(formatVerdict(blob)).toContain('FAIL');
  });
  it('an anchor that the candidate does not beat fails the verdict, and one it beats does not', () => {
    const c = candidateFromRef(loadReference('s'), spec);
    const worse = grade(c.img, { facing: 's', labels: c.labels, spec, gates, anchors: [{ name: 'blob', img: blobImage(spec) }] });
    expect(worse.anchors[0]?.beaten).toBe(true);
    const better = grade(blobImage(spec), { facing: 's', spec, gates, anchors: [{ name: 'reference', img: c.img, labels: c.labels }] });
    expect(better.anchors[0]?.beaten).toBe(false);
    expect(better.anchorsPass).toBe(false);
  });
  it('never reads an earlier round: the verdict has no round field and the notes say so', () => {
    const v = grade(blobImage(spec), { facing: 'n', spec, gates });
    expect(JSON.stringify(v)).not.toMatch(/round\s*\d|previous|earlier score/i);
    expect(v.notes.join(' ')).toContain('PA-CM-01');
  });
  it('e and w use the no-reference gates: they cannot pass without a template', () => {
    const v = grade(spec.given, { facing: 'e', spec, gates });
    expect(v.target.mode).toBe('no-reference');
    expect(v.targetPass).toBe(false);
  });
  it('the CLI exits 1 for a failing facing, 2 for a usage error, and reads a letter grid', () => {
    const png = join(tmp, 'blob.png');
    writePng(blobImage(spec), png);
    const r = spawnSync('node', [`${GRADE_DIR}/grade.mjs`, png, '--facing', 's'], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('facing s: FAIL');
    expect(spawnSync('node', [`${GRADE_DIR}/grade.mjs`], { encoding: 'utf8' }).status).toBe(2);
    const grid = join(tmp, 'grid.txt');
    writeFileSync(grid, `${Array.from({ length: 32 }, (_, y) => `${String(y).padStart(2, '0')}|${y > 4 && y < 20 ? '.....................bbbbbb.....' : '.'.repeat(32)}`).join('\n')}\n`);
    const g = spawnSync('node', [`${GRADE_DIR}/grade.mjs`, grid, '--facing', 'n', '--json'], { encoding: 'utf8' });
    expect(g.status).toBe(1);
    expect(JSON.parse(g.stdout).facing).toBe('n');
  });
  it('loadParts reads a part map', () => {
    const f = join(tmp, 'parts.txt');
    writeFileSync(f, `${['....HH...', '...HHHH..'].join('\n')}\n`);
    const labels: Labels = loadParts(f);
    expect(labels[4]).toBe('hair');
    expect(labels[0]).toBeNull();
  });
});

describe('kit scan', () => {
  const refs = () => loadScanReferences();
  const cut = (src: Img, x0: number, y0: number, w: number, h: number): Img => {
    const out = newImage(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.data.set(src.data.subarray(((y0 + y) * src.w + x0 + x) * 4, ((y0 + y) * src.w + x0 + x) * 4 + 4), (y * w + x) * 4);
    return out;
  };
  const paste = (dst: Img, src: Img, x0: number, y0: number) => {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) if (src.data[(y * src.w + x) * 4 + 3] === 255) dst.data.set(src.data.subarray((y * src.w + x) * 4, (y * src.w + x) * 4 + 4), ((y0 + y) * dst.w + x0 + x) * 4);
  };

  it('catches a planted reference patch', () => {
    const s = loadReference('s').img;
    const kit = newImage(32, 32);
    paste(kit, cut(s, 10, 0, 12, 12), 4, 4);
    const f = scanImages([{ name: 'plant.png', img: kit }], { refs: refs(), given: spec.given });
    expect(f.length).toBeGreaterThan(0);
    expect(f[0]?.ref).toBe('s');
  });
  it('catches a planted patch shifted, mirrored, and cut from the walk-palette copy of the reference', () => {
    const s = loadReference('ne').img;
    const piece = cut(s, 9, 1, 12, 12);
    const kitA = newImage(32, 32);
    paste(kitA, piece, 17, 9);
    expect(scanImages([{ name: 'shifted', img: kitA }], { refs: refs(), given: spec.given }).length).toBeGreaterThan(0);
    const kitB = newImage(32, 32);
    paste(kitB, flipH(piece), 6, 6);
    const mirrored = scanImages([{ name: 'mirrored', img: kitB }], { refs: refs(), given: spec.given });
    expect(mirrored.length).toBeGreaterThan(0);
    const kitC = newImage(32, 32);
    paste(kitC, cut(quantizeTo(s, spec.palette), 9, 1, 12, 12), 10, 12);
    const q = scanImages([{ name: 'quantized', img: kitC }], { refs: refs(), given: spec.given });
    expect(q.length).toBeGreaterThan(0);
  });
  it('ignores a patch that equals the given at the same place, and at an S3 transform', () => {
    const r = refs();
    expect(scanImages([{ name: 'given', img: spec.given }], { refs: r, given: spec.given })).toEqual([]);
    // the mirror about x = 17.5 (x to 35 - x): the given mirrored
    const mirrored = newImage(32, 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (35 - x >= 0 && 35 - x < 32 && spec.given.data[(y * 32 + (35 - x)) * 4 + 3] === 255) mirrored.data.set(spec.given.data.subarray((y * 32 + (35 - x)) * 4, (y * 32 + (35 - x)) * 4 + 4), (y * 32 + x) * 4);
    expect(scanImages([{ name: 'mirror', img: mirrored }], { refs: r, given: spec.given })).toEqual([]);
    // a part shift of 1 px
    const shifted = placeScaled(spec.given, null, { s: 31, dx: 1, anchor: 'none', size: 32 }).img;
    expect(scanImages([{ name: 'shift', img: shifted }], { refs: r, given: spec.given })).toEqual([]);
  });
  // F5: the tests above use real references, and no real reference patch matches the given, so they pass with or without the ignore rule.
  // These use a synthetic reference that IS the given (and its mirror), so only the ignore rule keeps the kit patch from being a finding.
  describe('F5: the ignore rule and the share floor can fail', () => {
    const givenRefs = () => [
      { name: 'given-as-ref', img: spec.given, mirrored: false },
      { name: 'given-as-ref', img: flipH(spec.given), mirrored: true },
    ];
    // Built here by hand (not with applyTransform), so a change to the transform code or to S3_TRANSFORMS shows.
    const moved = (dx: number, dy: number): Img => {
      const out = newImage(32, 32);
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          const X = x + dx;
          const Y = y + dy;
          if (X >= 0 && Y >= 0 && X < 32 && Y < 32 && spec.given.data[(y * 32 + x) * 4 + 3] === 255) out.data.set(spec.given.data.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4), (Y * 32 + X) * 4);
        }
      return out;
    };
    const mirror35 = (): Img => {
      const out = newImage(32, 32);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (35 - x >= 0 && 35 - x < 32 && spec.given.data[(y * 32 + (35 - x)) * 4 + 3] === 255) out.data.set(spec.given.data.subarray((y * 32 + (35 - x)) * 4, (y * 32 + (35 - x)) * 4 + 4), (y * 32 + x) * 4);
      return out;
    };
    const cases: [string, () => Img][] = [
      ['identity', () => spec.given],
      ['mirror about 17.5', mirror35],
      ['shift x +1', () => moved(1, 0)],
      ['shift x -1', () => moved(-1, 0)],
      ['shift y +1', () => moved(0, 1)],
      ['shift y -1', () => moved(0, -1)],
    ];
    for (const [name, make] of cases) {
      it(`${name}: ignored by the default S3 transforms, and a finding when the ignore rule is off`, () => {
        const img = make();
        expect(scanImages([{ name, img }], { refs: givenRefs(), given: spec.given }), `${name} with the rule`).toEqual([]);
        expect(scanImages([{ name, img }], { refs: givenRefs(), given: spec.given, transforms: [] }).length, `${name} without the rule`).toBeGreaterThan(0);
      });
    }
    it('the default transform list holds exactly these six', () => {
      const keys = (S3_TRANSFORMS as { kind: string; axis?: number; dx?: number; dy?: number }[]).map((t) => `${t.kind}:${t.axis ?? ''}:${t.dx ?? ''}:${t.dy ?? ''}`).sort();
      expect(keys).toEqual(['identity:::', 'mirror:35::', 'shift::-1:0', 'shift::0:-1', 'shift::0:1', 'shift::1:0'].sort());
    });
    it('the share floor: 6 of 64 cells changed (90.6 percent) is found, 7 of 64 (89.1 percent) is not', () => {
      const palette = ['#9ea5a8', '#61693c', '#e4b086', '#16180d'];
      const ref = newImage(8, 8);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) put(ref, x, y, palette[(x + 2 * y) % 4] as string);
      const kitWith = (changed: number) => {
        const kit = clone(ref);
        for (let k = 0; k < changed; k++) put(kit, k, 0, '#030102'); // a color far from all four
        return kit;
      };
      const blank = newImage(8, 8);
      const refs8 = [{ name: 'synthetic', img: ref, mirrored: false }];
      expect(MATCH_SHARE).toBe(0.9);
      expect(scanImages([{ name: 'k6', img: kitWith(6) }], { refs: refs8, given: blank }).length).toBe(1);
      expect(scanImages([{ name: 'k7', img: kitWith(7) }], { refs: refs8, given: blank })).toEqual([]);
      expect(scanImages([{ name: 'k0', img: kitWith(0) }], { refs: refs8, given: blank }).length).toBe(1);
    });
  });
  it('a given patch that is NOT at the same place or a transform is not ignored when it matches a reference', () => {
    // Plant the reference patch on top of the given-equal image: the planted cells must still be found.
    const s = loadReference('s').img;
    const kit = clone(spec.given);
    paste(kit, cut(s, 10, 0, 12, 12), 10, 14);
    expect(scanImages([{ name: 'mixed', img: kit }], { refs: refs(), given: spec.given }).length).toBeGreaterThan(0);
  });
  it('scans a kit folder: PNG at 8x, a text grid, and an unknown file type fails closed', () => {
    const dir = join(tmp, 'kit');
    mkdirSync(dir, { recursive: true });
    const s = loadReference('s').img;
    const plant = newImage(32, 32);
    paste(plant, cut(s, 10, 0, 12, 12), 4, 4);
    const big = newImage(256, 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) big.data.set(plant.data.subarray(((y >> 3) * 32 + (x >> 3)) * 4, ((y >> 3) * 32 + (x >> 3)) * 4 + 4), (y * 256 + x) * 4);
    writePng(big, join(dir, 'sheet-8x.png'));
    const ok = scanKit(dir, { refs: refs(), given: spec.given });
    expect(ok.ok).toBe(false);
    expect(ok.findings[0]?.file).toBe('sheet-8x.png');
    rmSync(join(dir, 'sheet-8x.png'));
    writeFileSync(join(dir, 'notes.bin'), 'x');
    expect(scanKit(dir, { refs: refs(), given: spec.given }).findings[0]?.kind).toBe('unknown-type');
    rmSync(join(dir, 'notes.bin'));
    writePng(spec.given, join(dir, 'given.png'));
    expect(scanKit(dir, { refs: refs(), given: spec.given }).ok).toBe(true);
  });
  it('T1 box scan: a kit file with a 6a box cell fails, a blanked given passes', async () => {
    const dir = join(tmp, 'boxkit');
    mkdirSync(dir, { recursive: true });
    const full = loadGiven();
    writePng(full, join(dir, 'leak.png'));
    const leak = await boxScan(dir, { img: full });
    expect(leak.ok).toBe(false);
    rmSync(join(dir, 'leak.png'));
    const both = (await import('../scripts/art/pipeline/heldout/heldout.mjs')).BOX_NAMES as string[];
    let blank = loadGiven();
    for (const name of both) blank = blankedGiven(blank, getBox(name, full));
    writePng(blank, join(dir, 'blank.png'));
    const clean = await boxScan(dir, { img: full });
    expect(clean.ok).toBe(true);
  });
});

describe('isolation of the grader files', () => {
  it('no grader or reference data sits under scripts/art/v2/proxy, and no file there names it', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else files.push(p);
      }
    };
    if (existsSync('scripts/art/v2/proxy')) walk('scripts/art/v2/proxy');
    if (existsSync('tests/art-v2-proxy.test.ts')) files.push('tests/art-v2-proxy.test.ts');
    for (const f of files) {
      expect(/\.labels\.json$|calibration\.md$|rook-8d-ref/i.test(f), f).toBe(false);
      if (/\.(mjs|ts|json|md|txt)$/.test(f)) expect(readFileSync(f, 'utf8'), f).not.toMatch(/rook-8d-ref|v2\/grade\/refs/);
    }
  });
  it('the grade kit has the N-by-N canvas the measures expect', () => {
    expect(N).toBe(32);
  });
});
