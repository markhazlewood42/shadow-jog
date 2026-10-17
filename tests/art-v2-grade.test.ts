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
import { newImage, readPng, writePng } from '../scripts/art/pixkit/index.mjs';
import { blankedGiven, getBox } from '../scripts/art/pipeline/heldout/heldout.mjs';
import { loadGiven, loadWalkFrames } from '../scripts/art/pipeline/index.mjs';
import type { FacingChecks, Gates, Labels, LineItem, Spec, StyleLineData } from '../scripts/art/v2/grade/index.mjs';
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
  FACINGS,
  FACING_IDS,
  LINE_META,
  PATHB_REF,
  SCALE,
  STYLE_LINE_IDS,
  alignedPartMiou,
  bandingPairs,
  buildFacingIdTask,
  calibrationItems,
  GROUP_OF_PART,
  eyeCells,
  flattenParts,
  flipLabels,
  formatStyleReport,
  formatTemplateReport,
  idleSideGuide,
  itemEdge,
  linePasses,
  litMinusShadow,
  loadFacingChecks,
  mirrorAxis,
  pathBLabels,
  proxyTemplateLabels,
  runStyleCalibration,
  scoreFacingId,
  speckle,
  squintClusters,
  structureLines,
  styleTier,
  templateTable,
  writeStyleGates,
  textureDensity,
  toGroups,
  valueStructure,
  writeGates,
  FACING_CLASSES,
  PASS_NEED,
  ROUND8_DIR,
  SWAP_FACINGS,
  buildCalibrationTask,
  buildStyleItems,
  foldersOverlap,
  formatSwapReport,
  handBound,
  swapRates,
} from '../scripts/art/v2/grade/index.mjs';

const GRADE_DIR = 'scripts/art/v2/grade';
const FIXTURES = 'tests/fixtures/art-v2';
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
    const rule = gates.hardLines.faceSkin.ne as { max: number; edgeCols: number };
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
  it('PA-06: the box width is a report line (C5): a box 9 px wider than the given never fails, on any facing', () => {
    const img = clone(spec.given);
    put(img, 0, 15, '#030102');
    put(img, 31, 15, '#030102');
    for (const facing of ['s', 'n', 'ne']) {
      const it = find(run(img, { facing }).items, 'PA-06', /box width/);
      expect(it?.status).toBe('info');
      expect(it?.value).toContain('given 23');
    }
  });
  it('PA-07: the pixlint head width is out of the grade (C5); the head-alone line holds the head instead', () => {
    const img = clone(spec.given);
    put(img, 0, 2, '#030102');
    put(img, 31, 2, '#030102');
    expect(find(run(img, { facing: 's' }).items, 'PA-07', /head width/)).toBeUndefined();
    // a head that is too wide, with template labels: HL-HEAD fails (13 to 15 px)
    const labels = [...spec.givenLabels];
    const wide = clone(spec.given);
    for (let x = 6; x < 12; x++) {
      put(wide, x, 3, '#7f8587');
      labels[3 * 32 + x] = 'hair';
    }
    mustFail(wide, 'HL-HEAD', undefined, { labels, template: true });
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
    expect(res.rows.filter((r) => r.id.includes('round8')).length).toBe(3);
  });
  it('round 8 is a committed fixture: all four facings exist, and a missing file throws instead of dropping items', () => {
    expect(ROUND8_DIR.replace(/\\/g, '/')).toMatch(/tests\/fixtures\/art-v2\/round8$/);
    for (const f of ['down', 'right', 'up', 'up-right']) expect(existsSync(join(ROUND8_DIR, `${f}.png`)), f).toBe(true);
    const nowhere = join(tmp, 'no-round8');
    expect(() => buildCalibrationItems({ spec, round8Dir: nowhere })).toThrow(/round 8 fixture missing/);
    expect(() => buildStyleItems(spec, { round8Dir: nowhere })).toThrow(/round 8 fixture missing/);
  });
  it('has a slot for T1 outputs: <facing>.png files in a folder join the realistic pass group', () => {
    const dir = join(tmp, 't1');
    mkdirSync(dir, { recursive: true });
    writePng(candidateFromRef(loadReference('s'), spec).img, join(dir, 's.png'));
    const items = buildCalibrationItems({ spec, t1Dir: dir });
    const t1 = items.filter((i) => i.id.startsWith('t1:'));
    expect(t1.map((i) => [i.id, i.group])).toEqual([['t1:s', 'pass-real']]);
  });
  it('the reference calibration is kept as a record: reference measures are report lines only (Amendment 2 Q1)', () => {
    expect(res.markGates).toBe(res.gating.length < gates.passMeasures);
    for (const m of Object.values(gates.targetMeasures)) expect(m.role).toBe('report');
    const c = candidateFromRef(loadReference('s'), spec);
    const v = grade(c.img, { facing: 's', labels: c.labels, spec, gates });
    expect(v.reference.rows?.every((r) => r.role === 'report')).toBe(true);
    // Even a gates file that marks every reference measure as a gate does not change the verdict: the reference tier never gates.
    const four = JSON.parse(JSON.stringify(gates)) as Gates;
    for (const m of Object.values(four.targetMeasures)) {
      m.role = 'gate';
      m.start = m.dir === 'min' ? 2 : -1;
      m.calibrated = null;
    }
    expect(grade(c.img, { facing: 's', labels: c.labels, spec, gates: four }).pass).toBe(v.pass);
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
  it('gates.json holds this calibration (the round 8 files are part of the set)', () => {
    expect(gates.calibratedOn).not.toBeNull();
    for (const t of res.table) {
      const g = gates.targetMeasures[t.key] as NonNullable<(typeof gates.targetMeasures)[string]>;
      expect(g.role).toBe('report'); // Amendment 2 Q1: no reference measure gates
      expect(g.separates).toBe(t.separates);
      if (t.separates) expect(g.calibrated).toBeCloseTo(t.gate ?? 0, 3);
    }
    expect(gates.hardLines.distinctN).toBe(distinctCalibration(spec).n);
  });
  it('the hard lines catch the PA-CM-01 miss (the round 8 facings)', () => {
    const miss = res.lineRows.filter((r) => r.id.includes('round8'));
    expect(miss.length).toBe(3);
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
  it('the verdict has three tiers: style and structure decide, the reference tier is a report', () => {
    const c = candidateFromRef(loadReference('s'), spec);
    const v = grade(c.img, { facing: 's', labels: c.labels, spec, gates });
    expect(Object.keys(v).sort()).toEqual(expect.arrayContaining(['style', 'structure', 'reference', 'pass', 'notes', 'styleByEye']));
    expect(v.pass).toBe(v.style.pass && v.structure.pass);
    expect(v.reference.mode).toBe('reference');
    expect(v.reference.gain?.partMiou).toBeTypeOf('number');
    const blob = grade(blobImage(spec), { facing: 's', spec, gates });
    expect(blob.style.pass).toBe(false);
    expect(blob.pass).toBe(false);
    expect(formatVerdict(blob)).toContain('FAIL');
    expect(formatVerdict(blob)).toContain('reference (report only)');
  });
  it('the reference tier never gates: impossible reference lines do not change the verdict, and a good style plus structure passes with a bad reference score', () => {
    const c = candidateFromRef(loadReference('s'), spec);
    const strict = JSON.parse(JSON.stringify(gates)) as Gates;
    for (const m of Object.values(strict.targetMeasures)) {
      m.role = 'gate';
      m.start = m.dir === 'min' ? 5 : -5;
      m.calibrated = m.start;
    }
    expect(grade(c.img, { facing: 's', labels: c.labels, spec, gates: strict }).pass).toBe(grade(c.img, { facing: 's', labels: c.labels, spec, gates }).pass);
    // The given at se passes the style and structure tiers (a true verdict). Under impossible reference gates every reference row misses its line
    // and the verdict must stay true: a verdict that required the reference rows would flip here (the s picture above already fails style, so it cannot show this).
    const v = grade(spec.given, { facing: 'se', labels: spec.givenLabels, spec, gates });
    expect(v.style.pass && v.structure.pass).toBe(true);
    expect(v.pass).toBe(true);
    const impossible = grade(spec.given, { facing: 'se', labels: spec.givenLabels, spec, gates: strict });
    expect(impossible.reference.rows?.length).toBeGreaterThan(5);
    expect(impossible.reference.rows?.every((r) => !r.pass)).toBe(true);
    expect(impossible.pass).toBe(true);
  });
  it('an anchor is a report line: a worse anchor is beaten, a better one is not, and neither changes the verdict', () => {
    const c = candidateFromRef(loadReference('s'), spec);
    const worse = grade(c.img, { facing: 's', labels: c.labels, spec, gates, anchors: [{ name: 'blob', img: blobImage(spec) }] });
    expect(worse.reference.anchors[0]?.beaten).toBe(true);
    const better = grade(blobImage(spec), { facing: 's', spec, gates, anchors: [{ name: 'reference', img: c.img, labels: c.labels }] });
    expect(better.reference.anchors[0]?.beaten).toBe(false);
    expect(grade(blobImage(spec), { facing: 's', spec, gates }).pass).toBe(better.pass);
  });
  it('never reads an earlier round: the verdict has no round field and the notes say so', () => {
    const v = grade(blobImage(spec), { facing: 'n', spec, gates });
    expect(JSON.stringify(v)).not.toMatch(/round\s*\d|previous|earlier score/i);
    expect(v.notes.join(' ')).toContain('PA-CM-01');
  });
  it('without template labels the verdict says its part-based checks use the automatic labeler, and with them it does not', () => {
    const auto = grade(spec.given, { facing: 'se', spec, gates });
    expect(auto.notes.join(' ')).toMatch(/part labels are automatic/);
    expect(grade(spec.given, { facing: 'se', spec, gates, labels: spec.givenLabels }).notes.join(' ')).not.toMatch(/part labels are automatic/);
  });
  it('e and w have no reference: the reference tier is none, the structure tier compares the guide rows with the battle idle', () => {
    const v = grade(spec.given, { facing: 'e', spec, gates });
    expect(v.reference.mode).toBe('none');
    expect(v.structure.items.some((i) => i.id === 'ST-SIDE')).toBe(true);
    expect(v.notes.join(' ')).toContain('facing-ID');
  });
  it('fewer than 3 separating style lines: the verdict says Mark gates style by eye (fail path)', () => {
    const c = candidateFromRef(loadReference('s'), spec);
    const few = JSON.parse(JSON.stringify(gates)) as Gates;
    let keep = 2;
    for (const l of Object.values(few.style.lines) as { separates: boolean }[]) {
      if (l.separates && keep > 0) keep--;
      else l.separates = false;
    }
    const v = grade(c.img, { facing: 's', labels: c.labels, spec, gates: few });
    expect(v.styleByEye).toBe(true);
    expect(v.notes.join(' ')).toMatch(/Mark gates style by eye/);
    expect(formatVerdict(v)).toContain('MARK GATES STYLE BY EYE');
    expect(grade(c.img, { facing: 's', labels: c.labels, spec, gates }).styleByEye).toBe(gates.style.separating.length < gates.style.minGating);
  });
  it('N12: the verdict never prints a bare PASS when style is gated by eye', () => {
    const real = grade(spec.given, { facing: 'se', labels: spec.givenLabels, spec, gates });
    expect(real.pass).toBe(true);
    expect(real.styleByEye).toBe(false);
    expect(formatVerdict(real)).toMatch(/^facing se: PASS \(style /);
    const few = JSON.parse(JSON.stringify(gates)) as Gates;
    for (const l of Object.values(few.style.lines)) l.separates = false;
    const eye = grade(spec.given, { facing: 'se', labels: spec.givenLabels, spec, gates: few });
    expect(eye.pass).toBe(true);
    expect(eye.styleByEye).toBe(true);
    expect(formatVerdict(eye).split('\n')[0]).toMatch(/^facing se: PASS \(style by eye: Mark\) \(style /);
    expect(formatVerdict(eye)).not.toMatch(/^facing se: PASS \(style (pass|FAIL)/);
    const blob = grade(blobImage(spec), { facing: 's', spec, gates: few });
    expect(formatVerdict(blob)).toMatch(/^facing s: FAIL/);
  });
  it('N12: gates.json carries no stale calibration fields, and the types and lint scope are clean', () => {
    const cal = (gates as Record<string, unknown>).calibration as Record<string, unknown>;
    expect(cal).not.toHaveProperty('markGates');
    expect(cal).not.toHaveProperty('gatingCount');
    expect(readFileSync(`${GRADE_DIR}/index.d.mts`, 'utf8')).not.toMatch(/:\s*any\b|<any>|\bany\[\]|as any/);
    expect(readFileSync('tests/art-v2-grade.test.ts', 'utf8')).not.toContain('as unknown' + ' as');
    const biome = JSON.parse(readFileSync('biome.json', 'utf8')) as { files: { includes: string[] } };
    expect(biome.files.includes).toContain('scripts/art/v2/grade/**/*.mjs');
    expect(biome.files.includes).toContain('scripts/art/v2/grade/**/*.mts');
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
    expect(existsSync('scripts/art/v2/proxy'), 'the proxy folder must exist: this test cannot pass on an empty scan').toBe(true);
    walk('scripts/art/v2/proxy');
    expect(existsSync('tests/art-v2-proxy.test.ts')).toBe(true);
    files.push('tests/art-v2-proxy.test.ts');
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) {
      expect(/\.labels\.json$|calibration\.md$|rook-8d-ref/i.test(f), f).toBe(false);
      if (/\.(mjs|ts|json|md|txt)$/.test(f)) expect(readFileSync(f, 'utf8'), f).not.toMatch(/rook-8d-ref|v2\/grade\/refs/);
    }
  });
  it('the grade kit has the N-by-N canvas the measures expect', () => {
    expect(N).toBe(32);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Grade kit round 3 (consult C2 C4, C5; Amendment 2): the style tier, the structure tier, the facing-ID harness and the template check.
// Every new gate line has a fail-path test: a mutated image must fail the named line, and the unmutated one must pass it.
// ---------------------------------------------------------------------------------------------------------------------

describe('style tier (C4): the given and the walk frames pass, and every line has a fail path', () => {
  const sty = (img: Img, o: { labels?: Labels | null; template?: boolean; rampLabels?: Labels | null } = {}) =>
    styleTier(img, { spec, gates, labels: o.labels === undefined ? spec.givenLabels : o.labels, template: o.template ?? o.labels === undefined, rampLabels: o.rampLabels ?? null });
  const row = (t: ReturnType<typeof styleTier>, id: string) => t.rows.find((r) => r.id === id);
  const mustFailLine = (img: Img, id: string, o: { labels?: Labels | null; template?: boolean } = {}) => {
    const t = sty(img, o);
    const r = row(t, id);
    expect(r?.status, `${id}: ${t.rows.filter((x) => x.status === 'fail').map((x) => x.id).join(', ')}`).toBe('fail');
    if (r?.role === 'gate') expect(t.pass).toBe(false);
  };

  it('the given passes every style line with its own labels, and all 8 walk frames pass with the automatic labeler', () => {
    const t = sty(spec.given);
    expect(t.rows.filter((r) => r.status === 'fail').map((r) => r.id)).toEqual([]);
    expect(t.pass).toBe(true);
    for (const [k, fr] of loadWalkFramesForTest().entries()) {
      // the walk frames carry no template, so their ramp lock runs on the automatic labeler (as the calibration does): S-RAMP is then measured
      const w = sty(fr, { labels: null, template: false, rampLabels: autoLabel(fr) });
      expect(w.rows.filter((r) => r.status === 'fail').map((r) => `${r.id}`), `walk frame ${k}`).toEqual([]);
      expect(w.pass).toBe(true);
    }
  });
  it('S-RAMP needs template labels: without them it is "not measured", never a pass, and a gating line that is not measured fails the tier', () => {
    const t = sty(spec.given, { labels: null, template: false });
    expect(row(t, 'S-RAMP')?.status).toBe('not measured');
    expect(row(t, 'S-RAMP')?.role).toBe('gate');
    expect(t.notMeasured).toEqual(['S-RAMP']);
    expect(t.pass).toBe(false);
    expect(row(sty(spec.given), 'S-RAMP')?.status).toBe('pass');
    // the verdict says so
    const v = grade(spec.given, { facing: 'se', spec, gates });
    expect(v.style.pass).toBe(false);
    expect(v.pass).toBe(false);
    expect(v.notes.join(' ')).toMatch(/Not measured: S-RAMP/);
    expect(formatVerdict(v)).toContain('NOT MEASURED S-RAMP');
    // a report-role line that is not measured does not fail the tier
    const g = JSON.parse(JSON.stringify(gates)) as Gates;
    (g.style.lines['S-RAMP'] as { role: string }).role = 'report';
    const r = styleTier(spec.given, { spec, gates: g, labels: null, template: false });
    expect(r.rows.find((x) => x.id === 'S-RAMP')?.status).toBe('not measured');
    expect(r.pass).toBe(true);
  });
  it('S-FLAT-GROUP with no part group of the floor size is "not measured" and fails the tier (never a silent pass)', () => {
    const g = JSON.parse(JSON.stringify(gates)) as Gates;
    g.style.flatMinCells = 500;
    const t = styleTier(spec.given, { spec, gates: g, labels: spec.givenLabels, template: true });
    expect(row(t, 'S-FLAT-GROUP')?.status).toBe('not measured');
    expect(t.notMeasured).toContain('S-FLAT-GROUP');
    expect(t.pass).toBe(false);
  });
  it('N7: S-SMALL gates as a go-hard-line (the spike GO list), not as a separating line, and does not count toward the at-least-3 rule', () => {
    const sm = gates.style.lines['S-SMALL'];
    expect(sm?.role).toBe('gate');
    expect(sm?.basis).toBe('go-hard-line');
    expect(sm?.separates).toBe(false);
    expect(gates.style.separating).not.toContain('S-SMALL');
    const sepByBasis = Object.entries(gates.style.lines).filter(([, l]) => l.basis === 'separates').map(([k]) => k);
    expect(sepByBasis.sort()).toEqual([...gates.style.separating].sort());
    for (const [k, l] of Object.entries(gates.style.lines)) expect(l.role === 'gate' ? l.basis : null, k).toBe(l.role === 'gate' ? (l.separates ? 'separates' : 'go-hard-line') : null);
    // Two separating lines plus the go-hard-line S-SMALL are still fewer than 3: Mark gates style by eye
    const g = JSON.parse(JSON.stringify(gates)) as Gates;
    let keep = 2;
    for (const l of Object.values(g.style.lines)) {
      if (l.separates && keep > 0) keep--;
      else l.separates = false;
    }
    const t = styleTier(spec.given, { spec, gates: g, labels: spec.givenLabels, template: true });
    expect(t.separating.length).toBe(2);
    expect(t.gating).toContain('S-SMALL');
    expect(t.markGatesByEye).toBe(true);
    // with 3 separating lines it gates
    keep = 3;
    const g3 = JSON.parse(JSON.stringify(gates)) as Gates;
    for (const l of Object.values(g3.style.lines)) {
      if (l.separates && keep > 0) keep--;
      else l.separates = false;
    }
    expect(styleTier(spec.given, { spec, gates: g3, labels: spec.givenLabels, template: true }).markGatesByEye).toBe(false);
  });
  it('S-PALETTE: an off-palette color, and a half-transparent cell, fail', () => {
    const a = clone(spec.given);
    put(a, 16, 18, '#123456');
    mustFailLine(a, 'S-PALETTE');
    const b = clone(spec.given);
    b.data[(18 * 32 + 16) * 4 + 3] = 128;
    mustFailLine(b, 'S-PALETTE');
  });
  it('S-RAMP: a skin color inside the coat fails against a template', () => {
    const img = clone(spec.given);
    put(img, 14, 20, '#e4b086');
    mustFailLine(img, 'S-RAMP');
  });
  it('S-OUTLINE: a light outline fails', () => {
    const img = clone(spec.given);
    const e = edgeMask(img);
    let n = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (e[y * 32 + x] && n++ < 10) put(img, x, y, '#9ea5a8');
    mustFailLine(img, 'S-OUTLINE');
  });
  it('S-ORPHAN: 25 isolated pixels fail', () => {
    const img = clone(spec.given);
    for (let k = 0; k < 25; k++) put(img, 12 + (k % 5) * 2, 16 + Math.floor(k / 5) * 2, '#846042');
    mustFailLine(img, 'S-ORPHAN');
  });
  it('S-SMALL: a checkerboard of dark and light fails the squint line', () => {
    const img = clone(spec.given);
    for (let y = 15; y < 25; y++) for (let x = 12; x < 24; x++) put(img, x, y, (x + y) % 2 ? '#353a1d' : '#9ea5a8');
    mustFailLine(img, 'S-SMALL');
  });
  it('S-FLAT-GROUP: a flat head fails the per-group floor', () => {
    const img = clone(spec.given);
    for (let y = 0; y < 11; y++) for (let x = 11; x < 25; x++) if (spec.givenLabels[y * 32 + x] === 'hair') put(img, x, y, '#7f8587');
    mustFailLine(img, 'S-FLAT-GROUP');
  });
  it('S-FLAT-WHOLE: the given with every part flattened to its mean color fails the whole-figure floor', () => {
    mustFailLine(flattenParts(spec.given, spec.givenLabels, spec.palette), 'S-FLAT-WHOLE');
  });
  it('S-DENS-BAND: 10 percent speckle breaks the density band from above, a flat figure from below', () => {
    mustFailLine(speckle(spec.given, spec.palette), 'S-DENS-BAND');
    mustFailLine(flattenParts(spec.given, spec.givenLabels, spec.palette), 'S-DENS-BAND');
  });
  it('S-SQUINT (PA-14): too few value clusters (a blob) and too many (heavy speckle) both fail', () => {
    mustFailLine(blobImage(spec), 'S-SQUINT', { labels: null, template: false });
    mustFailLine(speckle(spec.given, spec.palette, { share: 0.5 }), 'S-SQUINT');
    const sq = gates.style.lines['S-SQUINT'] as Required<StyleLineData>;
    expect(squintClusters(spec.given)).toBeGreaterThanOrEqual(sq.lo);
    expect(squintClusters(spec.given)).toBeLessThanOrEqual(sq.hi);
  });
  it('S-RUNORDER (PA-15, R2 T12): stripes of two colors with aligned ends fail, and bandingPairs counts them', () => {
    const img = clone(spec.given);
    for (let y = 14; y < 22; y++) for (let x = 12; x < 22; x++) put(img, x, y, y % 2 ? '#6f7945' : '#61693c');
    expect(bandingPairs(img)).toBeGreaterThan((gates.style.lines['S-RUNORDER'] as Required<StyleLineData>).limit);
    mustFailLine(img, 'S-RUNORDER');
    expect(bandingPairs(spec.given)).toBeLessThanOrEqual((gates.style.lines['S-RUNORDER'] as Required<StyleLineData>).limit);
  });
  it('the shared palette across the set (PA-08) is a style line: a set that shares under 90 percent fails the tier', () => {
    const lone = newImage(32, 32);
    put(lone, 5, 5, '#030102');
    const hard = checkHardLines(spec.given, { facing: 'se', spec, gates, labels: spec.givenLabels, template: true, set: [{ name: 'lone', img: lone }] });
    const t = styleTier(spec.given, { spec, gates, labels: spec.givenLabels, template: true, hardItems: hard.items });
    expect(t.extra.some((i) => i.id === 'PA-08' && i.status === 'fail')).toBe(true);
    expect(t.pass).toBe(false);
  });
  it('a line that does not gate (role report) cannot fail the tier', () => {
    const g = JSON.parse(JSON.stringify(gates)) as Gates;
    const l = g.style.lines['S-SMALL'] as { role: string; pinned: boolean };
    l.role = 'report';
    const img = clone(spec.given);
    for (let y = 15; y < 25; y++) for (let x = 12; x < 24; x++) put(img, x, y, (x + y) % 2 ? '#353a1d' : '#9ea5a8');
    const t = styleTier(img, { spec, gates: g, labels: spec.givenLabels, template: true });
    expect(t.rows.find((r) => r.id === 'S-SMALL')?.status).toBe('fail');
    expect(t.gating).not.toContain('S-SMALL');
  });
});

function loadWalkFramesForTest(): Img[] {
  return loadWalkFrames() as Img[];
}

describe('hard-line re-sets (C5, B4): every re-set line passes all 8 walk frames', () => {
  it('orphans and PA-09 stay at 1.25x and the walk frames pass them', () => {
    const t = spec.target;
    for (const [k, fr] of loadWalkFramesForTest().entries()) {
      const res = checkHardLines(fr, { facing: 'se', spec, gates, name: `walk${k}` });
      expect(find(res.items, 'PA-04')?.status, `walk ${k} orphans`).toBe('pass');
      expect(find(res.items, 'PA-09')?.status, `walk ${k} small regions`).toBe('pass');
    }
    expect(gates.hardLines.countFactor).toBe(1.25);
    expect(t.given.orphans).toBeGreaterThan(0);
  });
  it('HL-FLAT runs per part group of flatMinCells or more cells and on the whole figure, and passes all 8 walk frames', () => {
    expect(gates.style.flatMinCells).toBe(25); // re-set from the spec's 20 by calibration (walk frame 0 is 0.780 at 20)
    for (const [k, fr] of loadWalkFramesForTest().entries()) {
      const res = checkHardLines(fr, { facing: 'se', spec, gates, name: `walk${k}` });
      expect(find(res.items, 'HL-FLAT')?.status, `walk ${k}`).toBe('pass');
    }
    const flat = flattenParts(spec.given, spec.givenLabels, spec.palette);
    const res = checkHardLines(flat, { facing: 'se', spec, gates, labels: spec.givenLabels, template: true });
    const it = find(res.items, 'HL-FLAT');
    expect(it?.status).toBe('fail');
    expect(it?.value).toContain('whole figure');
  });
  it('the head width and the box width never fail: the head-alone line (13 to 15) and the report line replace them', () => {
    for (const [, fr] of loadWalkFramesForTest().entries()) {
      const res = checkHardLines(fr, { facing: 's', spec, gates });
      expect(find(res.items, 'PA-07', /head width/)).toBeUndefined();
      expect(find(res.items, 'PA-06', /box width/)?.status).toBe('info');
    }
  });
});

describe('style calibration (B2): the walk frames pass, the right fail items are caught', () => {
  let cal: ReturnType<typeof runStyleCalibration>;
  const L = (id: string) => cal.lines[id] as NonNullable<(typeof cal.lines)[string]>;
  beforeAll(() => {
    cal = runStyleCalibration({ spec });
  });
  it('the population: 8 walk frames pass; rig v2, a blob, flattened parts and speckle fail (and round 8 when its files exist)', () => {
    expect(cal.rows.filter((r) => r.group === 'pass').length).toBe(8);
    const failIds = cal.rows.filter((r) => r.group === 'fail').map((r) => r.id);
    for (const id of ['rig-down', 'rig-right', 'rig-up', 'rig-left', 'blob', 'given-flat-parts', 'given-speckle10']) expect(failIds).toContain(id);
    expect(failIds.filter((i) => i.startsWith('round8-')).length).toBe(4);
  });
  it('every walk frame passes every line at its calibrated limit', () => {
    for (const r of cal.rows.filter((x) => x.group === 'pass'))
      for (const id of STYLE_LINE_IDS) expect(linePasses(LINE_META[id] as never, L(id) as never, r.values[id] ?? null), `${r.id} ${id}`).toBe(true);
  });
  it('a line separates only when it passes all 8 walk frames and catches a should-fail item, and gates only when it separates or is pinned', () => {
    for (const id of STYLE_LINE_IDS) {
      const l = L(id);
      if (l.separates) {
        expect(cal.table.find((t) => t.id === id)?.caught.length).toBeGreaterThan(0);
      }
      if (l.role === 'gate') expect(l.separates || l.pinned, id).toBe(true);
      if (!l.separates && !l.pinned) expect(l.role, id).toBe('report');
    }
  });
  it('at least 3 lines separate, so the style tier gates; the flag follows the count', () => {
    expect(cal.separating.length).toBeGreaterThanOrEqual(3);
    expect(cal.markGatesByEye).toBe(cal.separating.length < 3);
    // S-SMALL gates as a go-hard-line: it is in the gating set, never in the separating set, so it does not count
    expect(cal.gating).toContain('S-SMALL');
    expect(cal.separating).not.toContain('S-SMALL');
    expect(L('S-SMALL').basis).toBe('go-hard-line');
    expect(cal.gating.length).toBe(cal.separating.length + 1);
  });
  it('every should-fail item is caught by at least one gating line', () => {
    expect(cal.uncaught).toEqual([]);
  });
  it('B4: the re-set lines pass all 8 walk frames; orphans and PA-09 stay at 1.25x; flattening is 0.8x per group and for the whole figure', () => {
    for (const t of cal.table.filter((x) => x.reset)) expect(typeof t.reset?.to).toBe('number');
    expect(L('S-ORPHAN').limit).toBe(1.25);
    expect(L('S-SMALL').limit).toBe(1.25);
    expect(L('S-FLAT-GROUP').limit).toBe(0.8);
    expect(L('S-FLAT-WHOLE').limit).toBe(0.8);
    expect(cal.floor).toBe(25);
    expect(cal.floor).toBe(gates.style.flatMinCells);
    expect(cal.floorReset).toEqual({ from: 20, to: 25 });
  });
  it('the density band comes from the walk frames: it holds the frames that have the group, and nothing else decides it', () => {
    for (const [g, b] of Object.entries(cal.bands)) {
      expect(b.lo, g).toBeLessThan(b.hi);
      expect(b.frames, g).toBeGreaterThanOrEqual(2);
    }
  });
  it('gates.json holds this calibration (round 8 files are part of the set)', () => {
    expect(gates.style.flatMinCells).toBe(cal.floor);
    for (const id of STYLE_LINE_IDS) {
      const want = L(id);
      const have = gates.style.lines[id] as StyleLineData;
      expect(have.role, id).toBe(want.role);
      expect(have.separates, id).toBe(want.separates);
      if (want.limit !== undefined) expect(have.limit, id).toBeCloseTo(want.limit, 6);
      if (want.lo !== undefined) expect([have.lo, have.hi], id).toEqual([want.lo, want.hi]);
    }
    expect(gates.style.separating).toEqual(cal.separating);
  });
  it('flattenParts gives each part one color (the near-black lines stay), and speckle moves 10 percent of the cells, the same cells for the same seed', () => {
    const flat = flattenParts(spec.given, spec.givenLabels, spec.palette);
    const colors = new Set<number>();
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++)
        if (spec.givenLabels[y * 32 + x] === 'hair' && opaqueAt(flat, x, y) && packedLuma(flat, x, y) >= 60) colors.add(pack(flat.data[(y * 32 + x) * 4] ?? 0, flat.data[(y * 32 + x) * 4 + 1] ?? 0, flat.data[(y * 32 + x) * 4 + 2] ?? 0));
    expect(colors.size).toBe(1);
    const a = speckle(spec.given, spec.palette);
    const b = speckle(spec.given, spec.palette);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    expect(Array.from(speckle(spec.given, spec.palette, { seed: 7 }).data)).not.toEqual(Array.from(a.data));
    const opaque = Array.from({ length: 1024 }, (_, i) => i).filter((i) => (spec.given.data[i * 4 + 3] ?? 0) === 255);
    const changed = opaque.filter((i) => [0, 1, 2].some((k) => a.data[i * 4 + k] !== spec.given.data[i * 4 + k])).length;
    expect(changed).toBe(Math.round(opaque.length * 0.1));
  });
  it('the report names every line, and writeStyleGates keeps the shape', () => {
    const rep = formatStyleReport(cal);
    for (const id of STYLE_LINE_IDS) expect(rep).toContain(id);
    const path = join(tmp, 'gates-style.json');
    const written = writeStyleGates(cal, gates, { path, date: '2000-01-01' }) as Gates;
    expect(Object.keys(written.style.lines)).toEqual(Object.keys(gates.style.lines));
    expect(written.style.calibratedOn).toBe('2000-01-01');
    expect(JSON.parse(readFileSync(path, 'utf8')).style.flatMinCells).toBe(cal.floor);
  });
  it('the style calibration reads no reference: style.mjs, flat.mjs and structure.mjs do not import the reference labels', () => {
    for (const f of ['style.mjs', 'flat.mjs', 'structure.mjs']) expect(readFileSync(`${GRADE_DIR}/${f}`, 'utf8'), f).not.toMatch(/refs\/labels|rook-8d-ref|loadReference/);
  });
});

function packedLuma(img: Img, x: number, y: number): number {
  const i = (y * img.w + x) * 4;
  return 0.299 * (img.data[i] ?? 0) + 0.587 * (img.data[i + 1] ?? 0) + 0.114 * (img.data[i + 2] ?? 0);
}

describe('structure tier (B3): reference-free lines, each with a fail path', () => {
  const lines = (img: Img, facing: string, labels: Labels | null = spec.givenLabels) => structureLines(img, { facing, spec, labels });
  const st = (items: LineItem[], id: string) => items.find((i) => i.id === id);
  const mustFailSt = (img: Img, facing: string, id: string, labels: Labels | null = spec.givenLabels) => {
    const items = lines(img, facing, labels);
    expect(st(items, id)?.status, `${id}: ${items.map((i) => `${i.id} ${i.status} ${i.value}`).join(' | ')}`).toBe('fail');
  };
  const lensCells = (labels: Labels) => {
    const out: number[][] = [];
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (labels[y * 32 + x] === 'lenses') out.push([x, y]);
    return out;
  };

  it('the given passes every structure line at se, and the 8 walk frames pass with the automatic labeler (se)', () => {
    expect(failing(lines(spec.given, 'se'))).toEqual([]);
    for (const [k, fr] of loadWalkFramesForTest().entries()) expect(failing(structureLines(fr, { facing: 'se', spec, labels: null })), `walk ${k}`).toEqual([]);
    const full = grade(spec.given, { facing: 'se', spec, gates, labels: spec.givenLabels });
    expect(failing(full.structure.items)).toEqual([]);
    expect(full.structure.pass).toBe(true);
  });
  it('the Amendment 1 rows, HL-FACE and HL-DISTINCT are structure lines of the verdict', () => {
    const v = grade(spec.given, { facing: 's', spec, gates, labels: spec.givenLabels, set: [{ name: 'ne', img: candidateFromRef(loadReference('ne'), spec).img }] });
    const ids = v.structure.items.map((i) => i.id);
    for (const id of ['HL-HEIGHT', 'HL-BOTTOM', 'HL-HEAD', 'HL-SHOULDER', 'HL-HIP', 'HL-FACE', 'HL-DISTINCT', 'ST-GUIDE', 'ST-EYES', 'ST-HANDS', 'ST-ITEM']) expect(ids, id).toContain(id);
    // the style-only lines are not in the structure tier
    for (const id of ['PA-01', 'PA-03', 'PA-04', 'PA-09', 'HL-FLAT', 'HL-RAMP']) expect(ids, id).not.toContain(id);
    const narrow = clone(spec.given);
    for (let y = 0; y < 13; y++) for (let x = 19; x < 32; x++) clear(narrow, x, y);
    const nv = grade(narrow, { facing: 's', spec, gates });
    expect(nv.structure.items.find((i) => i.id === 'HL-HEAD')?.status).toBe('fail');
    expect(nv.structure.pass).toBe(false);
  });
  it('ST-GUIDE (PA-22): a head top 2 rows low, an eye row 1.5 rows low, and a foot row 2 rows high all fail', () => {
    const top = clone(spec.given);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 32; x++) clear(top, x, y);
    mustFailSt(top, 'se', 'ST-GUIDE');
    expect(st(lines(top, 'se'), 'ST-GUIDE')?.value).toMatch(/headTop 2/);

    const eye = clone(spec.given);
    for (const [x, y] of eyeCells(spec.given, spec.givenLabels)) put(eye, x, y, '#030102');
    for (const x of [17, 18, 21, 22]) put(eye, x, 10, '#db9332');
    mustFailSt(eye, 'se', 'ST-GUIDE');
    expect(st(lines(eye, 'se'), 'ST-GUIDE')?.value).toMatch(/eye/);

    const foot = clone(spec.given);
    for (let y = 28; y < 30; y++) for (let x = 0; x < 32; x++) clear(foot, x, y);
    mustFailSt(foot, 'se', 'ST-GUIDE');
    expect(st(lines(foot, 'se'), 'ST-GUIDE')?.value).toMatch(/foot/);
  });
  it('ST-GUIDE: shoulder and hip rows 3 rows off fail too', () => {
    const sh = clone(spec.given);
    for (let y = 11; y < 14; y++) for (let x = 0; x < 32; x++) clear(sh, x, y);
    mustFailSt(sh, 'se', 'ST-GUIDE');
    const hip = clone(spec.given);
    for (let y = 22; y < 26; y++) for (let x = 0; x < 32; x++) clear(hip, x, y);
    mustFailSt(hip, 'se', 'ST-GUIDE');
  });
  it('ST-EYES (PA-19, R2 T8): eyes on a back view fail, a front view with no eyes fails, an eye 3 px wide fails, two eye rows far apart fail', () => {
    for (const f of ['n', 'ne', 'nw']) mustFailSt(spec.given, f, 'ST-EYES');
    for (const f of ['s', 'se', 'sw']) expect(st(lines(spec.given, f), 'ST-EYES')?.status, f).toBe('pass');
    const none = clone(spec.given);
    for (const [x, y] of eyeCells(spec.given, spec.givenLabels)) put(none, x, y, '#030102');
    mustFailSt(none, 's', 'ST-EYES');
    // no eyes on a back view passes
    expect(st(lines(none, 'n'), 'ST-EYES')?.status).toBe('pass');
    const wide = clone(spec.given);
    put(wide, 19, 8, '#db9332');
    mustFailSt(wide, 's', 'ST-EYES');
    expect(st(lines(wide, 's'), 'ST-EYES')?.detail).toMatch(/3 px wide/);
    // two eyes 1.5 rows apart: the right glint moves from rows 8 and 9 to row 10
    const apart = clone(spec.given);
    for (const [x, y] of eyeCells(spec.given, spec.givenLabels).filter(([x]) => x >= 20)) put(apart, x, y, '#030102');
    for (const x of [21, 22]) put(apart, x, 10, '#db9332');
    mustFailSt(apart, 's', 'ST-EYES');
    expect(lensCells(spec.givenLabels).length).toBeGreaterThan(10);
  });
  it('ST-HANDS (PA-20): a missing hand fails, a 1 px hand fails, and the 3 px upper bound is only a report line', () => {
    const cells: [number, number][] = [];
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (spec.givenLabels[y * 32 + x] === 'hands' && colorClass(spec.given.data[(y * 32 + x) * 4] ?? 0, spec.given.data[(y * 32 + x) * 4 + 1] ?? 0, spec.given.data[(y * 32 + x) * 4 + 2] ?? 0) === 'skin') cells.push([x, y]);
    const hx = cells.map(([x]) => x);
    const mid = (Math.min(...hx) + Math.max(...hx)) / 2;
    const right = cells.filter(([x]) => x > mid);
    expect(right.length).toBeGreaterThan(2);
    const gone = clone(spec.given);
    for (const [x, y] of right) put(gone, x, y, '#454c29');
    mustFailSt(gone, 's', 'ST-HANDS');
    const tiny = clone(spec.given);
    for (const [x, y] of right.slice(1)) put(tiny, x, y, '#454c29');
    mustFailSt(tiny, 's', 'ST-HANDS');
    expect(st(lines(tiny, 's'), 'ST-HANDS')?.detail).toMatch(/too small/);
    expect(st(lines(spec.given, 's'), 'ST-HANDS')?.status).toBe('pass');
    expect(st(lines(spec.given, 's'), 'ST-HANDS-MAX')?.status).toBe('info');
    // the far hand may be partly hidden at a 3/4 back facing
    expect(st(lines(tiny, 'ne'), 'ST-HANDS')?.status).toBe('pass');
  });
  it('ST-HANDS upper bound (N8, orchestrator re-set): the walk-frame maximum plus a quarter; a mitten hand fails, a walk-size hand passes', () => {
    const h = loadFacingChecks().hands;
    const walk = handBound(loadWalkFramesForTest());
    expect(h.maxCells).toBe(walk.bound);
    expect(walk.bound).toBe(walk.max + Math.ceil(0.25 * walk.max));
    expect(walk.max).toBeGreaterThan(h.reportCells); // the pack's 3 px cannot gate this character: its own walk hands reach this size
    for (const [k, fr] of loadWalkFramesForTest().entries()) expect(st(structureLines(fr, { facing: 'se', spec, labels: null }), 'ST-HANDS')?.status, `walk ${k}`).toBe('pass');
    // a mitten: a 4 by 4 block of skin fused to the right hand, labeled as a hand
    const cells: [number, number][] = [];
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (spec.givenLabels[y * 32 + x] === 'hands' && colorClass(spec.given.data[(y * 32 + x) * 4] ?? 0, spec.given.data[(y * 32 + x) * 4 + 1] ?? 0, spec.given.data[(y * 32 + x) * 4 + 2] ?? 0) === 'skin') cells.push([x, y]);
    const mid = (Math.min(...cells.map(([x]) => x)) + Math.max(...cells.map(([x]) => x))) / 2;
    const right = cells.filter(([x]) => x > mid);
    const x0 = Math.min(...right.map(([x]) => x));
    const y0 = Math.min(...right.map(([, y]) => y));
    const mitten = clone(spec.given);
    const labels: Labels = [...spec.givenLabels];
    for (let y = y0; y < y0 + 4; y++)
      for (let x = x0; x < x0 + 4; x++) {
        put(mitten, x, y, '#e4b086');
        labels[y * 32 + x] = 'hands';
      }
    const r = st(lines(mitten, 's', labels), 'ST-HANDS');
    expect(r?.status, r?.value).toBe('fail');
    expect(r?.detail).toMatch(/too large/);
    // the 3 px of PA-20 stays a report line, which counts the clusters over it
    expect(st(lines(spec.given, 's'), 'ST-HANDS-MAX')?.status).toBe('info');
  });
  it('ST-ITEM (N4): the line is re-set to 0.84 from the walk frames and the references; no outline fails, and the boundary is pinned', () => {
    const it = loadFacingChecks().item;
    expect(it.edgeNearBlackMin).toBe(0.84);
    expect(it.reset).toMatchObject({ from: 0.93, to: 0.84 });
    // the old line failed the back reference; the new line passes it
    const n = candidateFromRef(loadReference('n'), spec);
    expect(itemEdge(n.img, n.labels as Labels).share).toBeLessThan(0.93);
    expect(st(lines(n.img, 'n', n.labels as Labels), 'ST-ITEM')?.status).toBe('pass');
    // the item edge cells of the given: 14, all near-black
    const edge: [number, number][] = [];
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        if (!['sheath', 'guard', 'wrap'].includes(spec.givenLabels[y * 32 + x] ?? '') || !opaqueAt(spec.given, x, y)) continue;
        const isEdge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !opaqueAt(spec.given, x + (dx ?? 0), y + (dy ?? 0)));
        if (isEdge && packedLuma(spec.given, x, y) < 60) edge.push([x, y]);
      }
    expect(edge.length).toBe(14);
    const lighten = (k: number) => {
      const img = clone(spec.given);
      for (const [x, y] of edge.slice(0, k)) put(img, x, y, '#9ea5a8');
      return img;
    };
    expect(st(lines(lighten(2), 's'), 'ST-ITEM')?.status, '12 of 14 is 0.857').toBe('pass');
    expect(st(lines(lighten(3), 's'), 'ST-ITEM')?.status, '11 of 14 is 0.786').toBe('fail');
    // an item with no outline at all
    const none = lighten(14);
    expect(itemEdge(none, spec.givenLabels).share).toBe(0);
    mustFailSt(none, 's', 'ST-ITEM');
  });
  it('ST-ITEM (PA-20, R2 T9): an item whose edge cells are not near-black fails, and the given passes', () => {
    const img = clone(spec.given);
    let n = 0;
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        if (!['sheath', 'guard', 'wrap'].includes(spec.givenLabels[y * 32 + x] ?? '') || !opaqueAt(img, x, y)) continue;
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !opaqueAt(img, x + (dx ?? 0), y + (dy ?? 0)));
        if (edge && packedLuma(img, x, y) < 60 && n++ < 6) put(img, x, y, '#9ea5a8');
      }
    expect(n).toBeGreaterThan(5);
    mustFailSt(img, 's', 'ST-ITEM');
    expect(st(lines(spec.given, 's'), 'ST-ITEM')?.status).toBe('pass');
    expect(itemEdge(spec.given, spec.givenLabels).share).toBe(1);
  });
  it('ST-LIT (R2 T10): the mirror of the given without a relight has the other lit side at sw and nw and fails; the same lit side passes', () => {
    const flipped = flipH(spec.given);
    const fl = flipLabels(spec.givenLabels, 32, 32);
    for (const f of ['sw', 'nw']) {
      mustFailSt(flipped, f, 'ST-LIT', fl);
      expect(st(lines(spec.given, f), 'ST-LIT')?.status, `${f} with the lit side of se`).toBe('pass');
    }
    // the line only runs at sw and nw
    expect(st(lines(flipped, 'se', fl), 'ST-LIT')).toBeUndefined();
    expect(st(lines(flipped, 'sw', fl), 'ST-LIT-REPORT')?.status).toBe('info');
    expect(litMinusShadow(spec.given, spec.givenLabels, 'hair')).toBeGreaterThan(0);
    expect(litMinusShadow(flipped, fl, 'hair')).toBeLessThan(0);
  });
  it('ST-LIT (N9): hair and torso gate, each alone; legs are a report line and cannot fail it', () => {
    const ls = loadFacingChecks().litSide;
    expect(ls.groups).toEqual(['hair', 'torso']);
    expect(ls.reportGroups).toEqual(['legs']);
    // The given with one part group set to the other lit side: the right half of its cells dark and the left half light, or the reverse.
    // The rest of the figure is untouched. The lit-minus-shadow luma of that group then has the other sign than at se.
    const forceSign = (group: string, sign: number): Img => {
      const out = clone(spec.given);
      const cells: [number, number][] = [];
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (GROUP_OF_PART[spec.givenLabels[y * 32 + x] ?? ''] === group && opaqueAt(spec.given, x, y)) cells.push([x, y]);
      const xs = cells.map(([x]) => x).sort((p, q) => p - q);
      const med = xs[Math.floor(xs.length / 2)] ?? 0;
      for (const [x, y] of cells) if (x !== med) put(out, x, y, (x > med) === sign > 0 ? '#9ea5a8' : '#353a1d');
      return out;
    };
    for (const group of ['hair', 'torso', 'legs']) {
      const se = litMinusShadow(spec.given, spec.givenLabels, group) ?? 0;
      const img = forceSign(group, -Math.sign(se));
      const now = litMinusShadow(img, spec.givenLabels, group) ?? 0;
      expect(Math.sign(now), `${group} must have the other sign than at se (${now} against ${se})`).toBe(-Math.sign(se));
      for (const f of ['sw', 'nw']) {
        const item = st(lines(img, f), 'ST-LIT');
        if (group === 'legs') {
          expect(item?.status, `legs alone at ${f}`).toBe('pass');
          expect(st(lines(img, f), 'ST-LIT-REPORT')?.value).toMatch(/legs/);
        } else {
          expect(item?.status, `${group} alone at ${f}: ${item?.value}`).toBe('fail');
          expect(item?.detail).toContain(group);
        }
      }
    }
    expect(st(lines(spec.given, 'sw'), 'ST-LIT')?.name).toMatch(/hair and torso; legs report only/);
  });
  it('ST-SIDE (N10): e and w compare head top, first skin row, leg split and foot with the battle idle rows, measured, not row widths', () => {
    const gb = bboxOf(spec.given) as NonNullable<ReturnType<typeof bboxOf>>;
    const idle = idleSideGuide({ top: gb.y0, bottom: gb.y1 }) as NonNullable<ReturnType<typeof idleSideGuide>>;
    expect(idle).not.toBeNull();
    const { headTop, skin, split, foot } = idle;
    if (!headTop || !skin || !split || !foot) throw new Error('the idle guide must have all four rows');
    // measured rows on the canvas: head top and foot are the given's own rows plus the bounce, not 0 and 1 by construction
    expect(foot.min).toBeCloseTo(gb.y1, 5);
    expect(headTop.min).toBeCloseTo(gb.y0, 5);
    expect(headTop.max).toBeGreaterThan(headTop.min); // the idle bounces: the head top row moves
    expect(skin.min).toBeGreaterThan(headTop.max);
    expect(split.min).toBeGreaterThan(skin.max);
    // a figure on rows [head, foot] with a skin row and a leg split
    const body = (head: number, skinRow: number, splitRow: number | null, footRow = foot.min) => {
      const img = newImage(32, 32);
      for (let y = head; y <= footRow; y++) {
        for (let x = 12; x <= 19; x++) {
          if (splitRow !== null && y >= splitRow && x >= 15 && x <= 16) continue;
          put(img, x, y, y === skinRow ? '#e4b086' : '#61693c');
        }
      }
      return img;
    };
    const R = Math.round;
    const sideItem = (img: Img, f = 'e') => st(structureLines(img, { facing: f, spec, labels: null }), 'ST-SIDE');
    const ok = sideItem(body(R(headTop.min), R(skin.min), R(split.min)));
    expect(ok?.status, ok?.detail).toBe('pass');
    for (const f of ['e', 'w']) expect(sideItem(body(R(headTop.min), R(skin.min), R(split.min)), f)?.status).toBe('pass');
    // head top 3 rows low, and a foot row 3 rows high, fail: both rows are measured
    const low = sideItem(body(R(headTop.max) + 3, R(skin.min), R(split.min)));
    expect(low?.status).toBe('fail');
    expect(low?.detail).toMatch(/headTop/);
    const high = sideItem(body(R(headTop.min), R(skin.min), R(split.min), R(foot.min) - 3));
    expect(high?.status).toBe('fail');
    expect(high?.detail).toMatch(/foot/);
    expect(sideItem(body(R(headTop.min), R(skin.min) + 5, R(split.min)))?.status).toBe('fail');
    expect(sideItem(body(R(headTop.min), R(skin.min), R(split.min) - 6))?.status).toBe('fail');
    expect(sideItem(body(R(headTop.min), R(skin.min), null))?.status).toBe('fail');
    // a width change alone does not fail the line (widths are not compared)
    const narrow = body(R(headTop.min), R(skin.min), R(split.min));
    for (let y = 0; y < 31; y++) clear(narrow, 12, y);
    expect(sideItem(narrow)?.status).toBe('pass');
    // the line does not run on other facings, and with no idle it fails (never skips)
    expect(sideItem(body(R(headTop.min), R(skin.min), R(split.min)), 's')).toBeUndefined();
    const none = st(structureLines(body(R(headTop.min), R(skin.min), R(split.min)), { facing: 'e', spec, labels: null, idle: null }), 'ST-SIDE');
    expect(none?.status).toBe('fail');
    expect(none?.value).toBe('not measured');
  });
  it('e and w (N10): the verdict gates on ST-SIDE plus Mark and says there is no BF1 gate; no template is needed', () => {
    const v = grade(spec.given, { facing: 'e', spec, gates });
    expect(v.structure.items.some((i) => i.id === 'ST-SIDE')).toBe(true);
    expect(v.structure.items.some((i) => i.id === 'ST-TEMPLATE')).toBe(false);
    expect(v.notes.join(' ')).toMatch(/gate on ST-SIDE.*plus Mark.*no BF1 gate/);
    expect(grade(spec.given, { facing: 'se', spec, gates }).notes.join(' ')).not.toMatch(/no BF1 gate/);
  });
  it('the verdict lists the R2 rules that have no structure check yet (T3, T4, T6, T15) as unchecked (N11)', () => {
    const v = grade(spec.given, { facing: 'se', spec, gates, labels: spec.givenLabels });
    expect(v.structure.unchecked.map((u) => u.id)).toEqual(['R2 T3', 'R2 T4', 'R2 T6', 'R2 T15']);
    expect(v.notes.join(' ')).toMatch(/Unchecked R2 rules.*T3.*T4.*T6.*T15/);
    const text = formatVerdict(v);
    for (const id of ['T3', 'T4', 'T6', 'T15']) expect(text).toContain(`unchecked R2 ${id}`);
  });
  it('the rule checks catch swapped facings: s, n and 3/4 back references are told apart from the front ones', () => {
    const n = candidateFromRef(loadReference('n'), spec);
    const s = candidateFromRef(loadReference('s'), spec);
    const ne = candidateFromRef(loadReference('ne'), spec);
    expect(grade(s.img, { facing: 's', spec, gates, labels: s.labels }).structure.pass).toBe(true);
    expect(grade(s.img, { facing: 'n', spec, gates, labels: s.labels }).structure.pass).toBe(false);
    expect(grade(n.img, { facing: 's', spec, gates, labels: n.labels }).structure.pass).toBe(false);
    expect(grade(ne.img, { facing: 's', spec, gates, labels: ne.labels }).structure.pass).toBe(false);
    expect(grade(ne.img, { facing: 'ne', spec, gates, labels: ne.labels }).structure.pass).toBe(true);
  });
});

describe('swap line (C6, N3): the 5 references and the given, each graded as each other facing', () => {
  let res: ReturnType<typeof swapRates>;
  const classOf = (f: string) => Object.entries(FACING_CLASSES).find(([, l]) => l.includes(f))?.[0];
  beforeAll(() => {
    res = swapRates({ spec, gates });
  });
  it('grades 6 pictures as the 5 other facings: 30 swaps, and the rate is caught over swaps', () => {
    expect(SWAP_FACINGS).toEqual(['se', ...REF_FACINGS]);
    expect(res.swaps).toBe(30);
    expect(res.rate).toBeCloseTo(res.caught / res.swaps, 10);
    expect(res.cross.swaps + res.within.swaps).toBe(res.swaps);
    expect(res.cross.caught + res.within.caught).toBe(res.caught);
    expect(res.missed.length).toBe(res.swaps - res.caught);
  });
  it('the 90 percent line is not moved; it is recorded as FAILED at the computed rate, with the missed pairs', () => {
    expect(gates.swapLine.need).toBe(0.9);
    expect(res.line).toBe(0.9);
    expect(res.met).toBe((res.rate ?? 0) >= 0.9);
    expect(res.met).toBe(false);
    expect(gates.swapLine.recorded).toMatchObject({ status: res.met ? 'MET' : 'FAILED', swaps: res.swaps, caught: res.caught, missed: res.missed });
    expect(gates.swapLine.recorded.rate).toBeCloseTo(res.rate ?? 0, 3);
    const rep = formatSwapReport(res);
    expect(rep).toContain('FAILED');
    expect(rep).toContain(`${res.caught} of ${res.swaps}`);
    for (const m of res.missed) expect(rep).toContain(m);
  });
  it('every swap between facing classes is caught; the misses sit inside a class, where the blind facing-ID grader decides', () => {
    expect(res.cross.caught).toBe(res.cross.swaps);
    expect(res.cross.rate).toBe(1);
    for (const m of res.missed) {
      const [from, as] = m.split('->');
      expect(classOf(from ?? ''), m).toBe(classOf(as ?? ''));
    }
    expect(res.within.rate).toBeLessThan(1);
  });
  it('the rate can fail: with the eye rules of the back facings removed, fewer swaps are caught', () => {
    const weak = JSON.parse(JSON.stringify(loadFacingChecks())) as ReturnType<typeof loadFacingChecks>;
    for (const f of Object.keys(weak.eyes)) weak.eyes[f] = { clustersMin: 0, clustersMax: 9, rule: 'R2 T8 (test)' };
    const noFace = JSON.parse(JSON.stringify(gates)) as Gates;
    noFace.hardLines.faceSkin = { eyeRows: [5, 10] };
    const r = swapRates({ spec, gates: noFace, checks: weak });
    expect(r.caught).toBeLessThan(res.caught);
  });
  it('rule checks at the own facing: se, s, n, ne, nw pass; sw fails ST-LIT only, recorded as "inconsistent with se light" (not loosened)', () => {
    expect(res.own.filter((o) => !o.pass)).toEqual([{ facing: 'sw', pass: false, failed: ['ST-LIT'] }]);
    expect(gates.swapLine.ownFacingNotes.sw).toMatch(/sw reference inconsistent with se light/);
  });
});

describe('facing-checks.json (B3): every tolerance cites a rule, and no reference is named', () => {
  const checks: FacingChecks = loadFacingChecks();
  const RULE = /(R2 T\d+|R2 section|PA-\d+)/;
  const walkRules = (obj: unknown, inherited: string | null, path: string) => {
    if (obj === null || typeof obj !== 'object') return;
    const o = obj as Record<string, unknown>;
    const own = typeof o.rule === 'string' ? o.rule : inherited;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'number') expect(own, `${path}.${k} has a number but no rule`).toMatch(RULE);
      else if (typeof v === 'object') walkRules(v, own, `${path}.${k}`);
    }
  };
  it('each entry with a number has a rule id of R2 or the pack, here or in its parent', () => {
    for (const [k, v] of Object.entries(checks)) if (k !== 'note') walkRules(v, null, k);
  });
  it('the file does not name a reference folder or label file, and has a tolerance for every facing it checks', () => {
    const text = readFileSync(`${GRADE_DIR}/facing-checks.json`, 'utf8');
    expect(text).not.toMatch(/rook-8d-ref|\.labels\.json|grade\/refs/);
    for (const f of ['s', 'se', 'sw', 'e', 'w', 'n', 'ne', 'nw']) expect((checks.eyes as Record<string, unknown>)[f], f).toBeDefined();
  });
  it('the eye rule for a back facing allows no eye, the front facings allow 1 to 2 clusters on one row', () => {
    const eyes = checks.eyes as Record<string, { clustersMin: number; clustersMax: number; rowSpreadMax?: number }>;
    for (const f of ['n', 'ne', 'nw']) expect(eyes[f]?.clustersMax).toBe(0);
    for (const f of ['s', 'se', 'sw']) {
      expect(eyes[f]?.clustersMin).toBe(1);
      expect(eyes[f]?.clustersMax).toBe(2);
      expect(eyes[f]?.rowSpreadMax).toBe(1);
    }
  });
  it('the proxy code never imports the grade kit', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else files.push(p);
      }
    };
    expect(existsSync('scripts/art/v2/proxy'), 'the proxy folder must exist: this test cannot pass on an empty scan').toBe(true);
    walk('scripts/art/v2/proxy');
    expect(files.length).toBeGreaterThan(3);
    for (const f of files.filter((x) => /\.(mjs|ts|json)$/.test(x))) expect(readFileSync(f, 'utf8'), f).not.toMatch(/v2\/grade|\.\.\/grade\//);
  });
});

describe('facing-ID harness (B5): the task, the key and the scorer (no model runs here)', () => {
  const dir = () => mkdtempSync(join(tmp, 'fid-'));
  let items: ReturnType<typeof calibrationItems>;
  beforeAll(() => {
    items = calibrationItems(spec);
  });
  it('the calibration set has 10 items: the 5 references, the given, flips of the given and of ne, and the flips of s and n', () => {
    expect(items.length).toBe(10);
    expect(items.map((i) => i.facing).sort()).toEqual(['n', 'n', 'ne', 'nw', 'nw', 's', 's', 'se', 'sw', 'sw']);
    expect(items.filter((i) => /flip/.test(i.source)).length).toBe(4);
    expect(items.filter((i) => /^reference/.test(i.source)).length).toBe(5);
  });
  it('writes one picture per item at 8x (the given left, the candidate right) and a prompt, and keeps the key in another folder', () => {
    const task = dir();
    const key = dir();
    const r = buildFacingIdTask(items, { out: task, key, given: spec.given });
    expect(r.items.length).toBe(10);
    const files = readdirSync(task).sort();
    expect(files).toEqual([...r.items.map((i) => i.file), 'prompt.txt'].sort());
    const png = readPng(join(task, 'item-01.png'));
    expect(png.w).toBe(32 * SCALE * 2 + 16);
    expect(png.h).toBe(32 * SCALE);
    expect(existsSync(join(key, 'key.json'))).toBe(true);
    expect(existsSync(join(task, 'key.json'))).toBe(false);
    const prompt = readFileSync(join(task, 'prompt.txt'), 'utf8');
    expect(prompt).not.toMatch(/reference|flip|the given frame|key\.json|answer is/i);
    for (const it of r.items) expect(prompt).toContain(it.id);
    // each item lists 8 options, each facing once
    for (const it of r.items) expect(Object.values(it.letters).sort()).toEqual([...FACING_IDS].sort());
  });
  it('the left half of every picture is the given at 8x, and the picture does not depend on the key (blind)', () => {
    const a = dir();
    const b = dir();
    const relabeled = items.map((i) => ({ ...i, facing: 's', source: 'other' }));
    buildFacingIdTask(items, { out: a, key: dir(), given: spec.given });
    buildFacingIdTask(relabeled, { out: b, key: dir(), given: spec.given });
    for (const f of readdirSync(a)) expect(readFileSync(join(a, f)).equals(readFileSync(join(b, f))), f).toBe(true);
    const pic = readPng(join(a, 'item-01.png'));
    // pixel (x, y) of the given at 8x: the cell color, or the gray ground when the cell is transparent
    for (const [x, y] of [[16, 8], [17, 20], [3, 3]] as const) {
      const g = spec.given.data.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4);
      const p = pic.data.subarray((y * 8 * pic.w + x * 8) * 4, (y * 8 * pic.w + x * 8) * 4 + 4);
      if (g[3] === 255) expect(Array.from(p.subarray(0, 3))).toEqual(Array.from(g.subarray(0, 3)));
      else expect(Array.from(p)).toEqual([122, 122, 122, 255]);
    }
  });
  it('shuffles the option letters and the item order, so neither says anything about the answer', () => {
    const r = buildFacingIdTask(items, { out: dir(), key: dir(), given: spec.given });
    const maps = new Set(r.items.map((i) => JSON.stringify(i.letters)));
    expect(maps.size).toBeGreaterThanOrEqual(8);
    const order = Object.values(r.key.items).map((k) => k.facing);
    expect(order.join(',')).not.toBe(items.map((i) => i.facing).join(','));
    const correct = Object.values(r.key.items).map((k) => k.correct);
    expect(new Set(correct).size).toBeGreaterThanOrEqual(4);
  });
  it('the scorer: all right is 10 of 10 and passes, 9 of 10 passes, 8 of 10 fails, and a missing or unreadable answer is wrong', () => {
    const r = buildCalibrationTask({ out: dir(), key: dir(), given: spec.given });
    expect(r.key.passNeed).toBe(PASS_NEED);
    const ids = Object.keys(r.key.items);
    const perfect = Object.fromEntries(ids.map((id) => [id, r.key.items[id]?.correct ?? '']));
    expect(scoreFacingId(perfect, r.key)).toMatchObject({ correct: 10, total: 10, pass: true });
    const wrong = (n: number) => {
      const a = { ...perfect };
      ids.slice(0, n).forEach((id) => {
        const k = r.key.items[id];
        a[id] = Object.keys(k?.letters ?? {}).find((l) => l !== k?.correct) ?? 'A';
      });
      return a;
    };
    expect(scoreFacingId(wrong(1), r.key)).toMatchObject({ correct: 9, pass: true });
    expect(scoreFacingId(wrong(2), r.key)).toMatchObject({ correct: 8, pass: false });
    const partial = { ...perfect };
    delete partial['item-01'];
    partial['item-02'] = 'not a letter';
    expect(scoreFacingId(partial, r.key)).toMatchObject({ correct: 8, pass: false });
  });
  it('N2: the 9-of-10 need is the calibration set only; a candidate task needs every item right (C6: 2 of 2)', () => {
    const two = [
      { cand: spec.given, facing: 'se', source: 'a' },
      { cand: flipH(spec.given), facing: 'sw', source: 'b' },
    ];
    const r = buildFacingIdTask(two, { out: dir(), key: dir(), given: spec.given });
    expect(r.key.passNeed).toBe(2);
    const right = Object.fromEntries(Object.entries(r.key.items).map(([id, k]) => [id, k.correct]));
    expect(scoreFacingId(right, r.key)).toMatchObject({ correct: 2, total: 2, need: 2, pass: true });
    const [first] = Object.keys(r.key.items);
    const k0 = r.key.items[first ?? ''];
    const oneWrong = { ...right, [first ?? '']: Object.keys(k0?.letters ?? {}).find((l) => l !== k0?.correct) ?? 'A' };
    expect(scoreFacingId(oneWrong, r.key)).toMatchObject({ correct: 1, need: 2, pass: false });
    expect(scoreFacingId({}, r.key).pass).toBe(false);
    // the calibration task keeps 9 of 10, and the need can be set by the caller
    expect(buildCalibrationTask({ out: dir(), key: dir(), given: spec.given }).key.passNeed).toBe(PASS_NEED);
    expect(PASS_NEED).toBe(9);
    expect(scoreFacingId(right, r.key, { need: 3 }).pass).toBe(false);
    // the CLI: a candidate build + all right exits 0, one wrong exits 1
    const png = (n: string, img: Img) => {
      const p = join(tmp, n);
      writePng(img, p);
      return p;
    };
    const task = dir();
    const key = dir();
    const b = spawnSync('node', [`${GRADE_DIR}/facingid.mjs`, 'build', '--cand', `se=${png('c-se.png', spec.given)}`, '--cand', `sw=${png('c-sw.png', flipH(spec.given))}`, '--out', task, '--key', key], { encoding: 'utf8' });
    expect(b.status, b.stderr).toBe(0);
    const keyDoc = JSON.parse(readFileSync(join(key, 'key.json'), 'utf8')) as { passNeed: number; items: Record<string, { correct: string; letters: Record<string, string> }> };
    expect(keyDoc.passNeed).toBe(2);
    const answers = join(tmp, 'cand-answers.json');
    writeFileSync(answers, JSON.stringify(Object.fromEntries(Object.entries(keyDoc.items).map(([id, k]) => [id, k.correct]))));
    expect(spawnSync('node', [`${GRADE_DIR}/facingid.mjs`, 'score', '--answers', answers, '--key', join(key, 'key.json')], { encoding: 'utf8' }).status).toBe(0);
    const bad = Object.fromEntries(Object.entries(keyDoc.items).map(([id, k], i) => [id, i === 0 ? (Object.keys(k.letters).find((l) => l !== k.correct) ?? 'A') : k.correct]));
    writeFileSync(answers, JSON.stringify(bad));
    expect(spawnSync('node', [`${GRADE_DIR}/facingid.mjs`, 'score', '--answers', answers, '--key', join(key, 'key.json')], { encoding: 'utf8' }).status).toBe(1);
  });
  it('N2b: build refuses an out folder and a key folder that are the same, or one inside the other (the key would sit in the task folder)', () => {
    const same = dir();
    expect(foldersOverlap(same, same)).toBe(true);
    expect(foldersOverlap(same, join(same, 'key'))).toBe(true);
    expect(foldersOverlap(join(same, 'task'), same)).toBe(true);
    expect(foldersOverlap(join(same, 'a'), join(same, 'b'))).toBe(false);
    expect(foldersOverlap(`${same}x`, same)).toBe(false); // a shared name prefix is not nesting
    const one = [{ cand: spec.given, facing: 'se', source: 'a' }];
    expect(() => buildFacingIdTask(one, { out: same, key: same, given: spec.given })).toThrow(/separate folders/);
    expect(() => buildFacingIdTask(one, { out: same, key: join(same, 'key'), given: spec.given })).toThrow(/separate folders/);
    expect(() => buildFacingIdTask(one, { out: join(same, 'task'), key: same, given: spec.given })).toThrow(/separate folders/);
    expect(existsSync(join(same, 'key.json'))).toBe(false);
    const cli = spawnSync('node', [`${GRADE_DIR}/facingid.mjs`, 'build', '--calibration', '--out', same, '--key', same], { encoding: 'utf8' });
    expect(cli.status).toBe(2);
    expect(cli.stderr).toMatch(/separate folders/);
  });
  it('the scorer reads a facing id or a direction name as well as a letter', () => {
    const r = buildFacingIdTask(items, { out: dir(), key: dir(), given: spec.given });
    const byName = Object.fromEntries(Object.entries(r.key.items).map(([id, k]) => [id, FACINGS.find((f) => f.id === k.facing)?.name ?? '']));
    expect(scoreFacingId(byName, r.key).correct).toBe(10);
    const byId = Object.fromEntries(Object.entries(r.key.items).map(([id, k]) => [id, k.facing]));
    expect(scoreFacingId(byId, r.key).correct).toBe(10);
    const shortName = Object.fromEntries(Object.entries(r.key.items).map(([id, k]) => [id, (FACINGS.find((f) => f.id === k.facing)?.name ?? '').split(' (')[0] ?? '']));
    expect(scoreFacingId(shortName, r.key).correct).toBe(10);
  });
  it('a calibration item is told apart: the key of the given is se, the flip of the given is sw, the flip of ne is nw', () => {
    const r = buildFacingIdTask(items, { out: dir(), key: dir(), given: spec.given });
    const bySource = (s: string) => Object.values(r.key.items).find((k) => k.source === s)?.facing;
    expect(bySource('the given')).toBe('se');
    expect(bySource('flip of the given')).toBe('sw');
    expect(bySource('flip of reference ne')).toBe('nw');
    expect(bySource('reference n')).toBe('n');
  });
  it('the CLI builds the calibration set and scores an answers file (exit 0 at 9 of 10, 1 below, 2 for a usage error)', () => {
    const task = dir();
    const key = dir();
    const b = spawnSync('node', [`${GRADE_DIR}/facingid.mjs`, 'build', '--calibration', '--out', task, '--key', key], { encoding: 'utf8' });
    expect(b.status, b.stderr).toBe(0);
    const keyDoc = JSON.parse(readFileSync(join(key, 'key.json'), 'utf8')) as { items: Record<string, { correct: string }> };
    const answers = join(tmp, 'answers.json');
    writeFileSync(answers, JSON.stringify(Object.fromEntries(Object.entries(keyDoc.items).map(([id, k]) => [id, k.correct]))));
    expect(spawnSync('node', [`${GRADE_DIR}/facingid.mjs`, 'score', '--answers', answers, '--key', join(key, 'key.json')], { encoding: 'utf8' }).status).toBe(0);
    writeFileSync(answers, JSON.stringify({}));
    expect(spawnSync('node', [`${GRADE_DIR}/facingid.mjs`, 'score', '--answers', answers, '--key', join(key, 'key.json')], { encoding: 'utf8' }).status).toBe(1);
    expect(spawnSync('node', [`${GRADE_DIR}/facingid.mjs`, 'build'], { encoding: 'utf8' }).status).toBe(2);
    expect(spawnSync('node', [`${GRADE_DIR}/facingid.mjs`], { encoding: 'utf8' }).status).toBe(2);
  });
});

describe('aligned template-against-reference check (B6): a report, never a gate', () => {
  const T0A = `${FIXTURES}/t0a`;
  const shiftLabels = (labels: Labels, dx: number): Labels => {
    const out: Labels = new Array(1024).fill(null);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (labels[y * 32 + x] && x + dx >= 0 && x + dx < 32) out[y * 32 + x + dx] = labels[y * 32 + x] ?? null;
    return out;
  };
  it('mirrorAxis mirrors about x + x = 35 and is its own inverse', () => {
    const l: Labels = new Array(1024).fill(null);
    l[5 * 32 + 20] = 'hair';
    const m = mirrorAxis(l);
    expect(m[5 * 32 + 15]).toBe('hair');
    expect(mirrorAxis(m)).toEqual(l);
  });
  it('a reference scored against itself reaches 1, a 1 px shift is absorbed by the search, a wrong facing scores clearly lower', () => {
    const ref = loadReference('s');
    const own = alignedPartMiou(candidateFromRef(ref, spec).labels as Labels, ref);
    expect(own.best).toBeGreaterThan(0.9);
    const shifted = alignedPartMiou(shiftLabels(candidateFromRef(ref, spec).labels as Labels, 1), ref);
    expect(shifted.shiftOnly).toBeGreaterThan(0.85);
    const other = alignedPartMiou(candidateFromRef(loadReference('n'), spec).labels as Labels, ref);
    expect(other.best).toBeLessThan(own.best - 0.2);
  });
  it('the table has a row for each source and facing, with values in 0 to 1, and the plan pick never beats the best of the search', () => {
    const g = spec.givenLabels;
    const table = templateTable({ naive: { s: g, n: g, ne: g, nw: mirrorAxis(g), sw: mirrorAxis(g) } });
    expect(table.rows.map((r) => r.facing)).toEqual(REF_FACINGS);
    for (const r of table.rows) {
      expect(r.best).toBeGreaterThanOrEqual(0);
      expect(r.best).toBeLessThanOrEqual(1);
      expect(r.aligned).toBeLessThanOrEqual(r.best + 1e-9);
      expect(r.shiftOnly).toBeLessThanOrEqual(r.best + 1e-9);
    }
    const rep = formatTemplateReport({ naive: { s: g } }, table, { proxyDir: 'x', pathbRef: PATHB_REF });
    expect(rep).toContain('Best of search');
    expect(rep).toContain('gates nothing');
  });
  it('reads a proxy template file as a label grid of part names (a committed fixture; a missing file fails the test)', () => {
    const s = proxyTemplateLabels(`${T0A}/s-template.json`);
    expect(s.length).toBe(1024);
    expect(s.filter(Boolean).length).toBeGreaterThan(300);
    expect(s.filter((p) => p === 'hair').length).toBeGreaterThan(30);
  });
  it('reads path B with git show into a scratch folder and never checks it out (a throwaway repo built from the committed path B fixture)', async () => {
    const repo = mkdtempSync(join(tmp, 'pathb-repo-'));
    const git = (...args: string[]) => spawnSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' });
    mkdirSync(join(repo, 'scripts/art/v2/pathb'), { recursive: true });
    writeFileSync(join(repo, 'scripts/art/v2/pathb/sheet.mjs'), readFileSync(`${FIXTURES}/pathb/sheet.mjs.fixture`));
    writeFileSync(join(repo, 'scripts/art/v2/pathb/rook-pathb.json'), readFileSync(`${FIXTURES}/pathb/rook-pathb.json`));
    expect(git('init', '-q').status).toBe(0);
    expect(git('add', '.').status).toBe(0);
    expect(git('commit', '-q', '-m', 'path B fixture').status).toBe(0);
    const head = () => spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    const status = () => spawnSync('git', ['status', '--porcelain', '--', 'scripts/art/v2/pathb'], { encoding: 'utf8' }).stdout.trim();
    const before = [head(), status()];
    const scratch = mkdtempSync(join(tmp, 'pathb-'));
    const labels = await pathBLabels({ ref: 'HEAD', scratch, cwd: repo });
    expect(Object.keys(labels).sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
    expect(labels.s?.filter(Boolean).length).toBeGreaterThan(300);
    expect(existsSync(join(scratch, 'scripts/art/v2/pathb/sheet.mjs'))).toBe(true);
    expect([head(), status()]).toEqual(before);
    expect(existsSync('scripts/art/v2/pathb')).toBe(false);
    expect(typeof PATHB_REF).toBe('string');
  });
  it('the CLI exits 2 when the proxy folder is missing, and 1 (with the message) when the run throws', () => {
    expect(spawnSync('node', [`${GRADE_DIR}/templatecheck.mjs`, '--proxy-dir', join(tmp, 'nope')], { encoding: 'utf8' }).status).toBe(2);
    const empty = mkdtempSync(join(tmp, 'empty-proxy-'));
    const r = spawnSync('node', [`${GRADE_DIR}/templatecheck.mjs`, '--proxy-dir', empty, '--pathb-ref', 'no-such-ref', '--scratch', join(tmp, 'scratch-x')], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/templatecheck: /);
  });
});
