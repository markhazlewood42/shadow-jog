/**
 * Path B (scripts/art/v2/pathb): 2D construction sheets per facing, the fallback if the 3D proxy cannot fit.
 * Every check has a fail-path test: a mutated sheet or data must fail the named check. The se sheet is scored against the given part map and the numbers are reported, not gated.
 * The given frame comes from the committed walk zip (frame 4). No reference facing is read anywhere.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { run } from '../scripts/art/v2/pathb/cli.mjs';
import type { PathBData, Sheet } from '../scripts/art/v2/pathb/index.mjs';
import {
  FACINGS,
  LEVEL,
  buildAll,
  buildCard,
  buildSheet,
  cardText,
  checkBottomRow,
  checkConnected,
  checkDistinct,
  checkEyes,
  checkFolds,
  checkGuideRows,
  checkHeadAlone,
  checkHeight,
  checkLight,
  checkMirrorAgree,
  checkOutline,
  checkPartAreas,
  digest,
  fitReport,
  givenLabels,
  lightMap,
  loadData,
  measure,
  mirrorSheet,
  outlineMap,
  sharesByBox,
} from '../scripts/art/v2/pathb/index.mjs';

const data = loadData();
const given = givenLabels();
/** A deep copy of the data with one facing's boxes changed. */
function mutate(facing: string, fn: (boxes: PathBData['facings'][string]['boxes']) => PathBData['facings'][string]['boxes']): PathBData {
  const d = structuredClone(data);
  const f = d.facings[facing];
  if (!f) throw new Error(`no facing ${facing}`);
  f.boxes = fn(f.boxes);
  return d;
}
const sheetOf = (d: PathBData, facing: string): Sheet => buildSheet(d, facing);
const tmp: string[] = [];
afterAll(() => {
  for (const t of tmp) rmSync(t, { recursive: true, force: true });
});

describe('the given, measured a second way', () => {
  it('has the numbers the plan quotes (height 31, bottom 30, head alone 14, shoulder 14, hip 25)', () => {
    const m = measure(given, data);
    expect({ height: m.height, bottom: m.bottom, headAlone: m.headAlone, shoulder: m.shoulder, hip: m.hip }).toEqual({ height: 31, bottom: 30, headAlone: 14, shoulder: 14, hip: 25 });
    expect(Object.values(m.areas).reduce((a, b) => a + b, 0)).toBe(432); // opaque cells of the given (learnings, measurement facts)
  });
});

describe('template checks on s and n (plan v2, section 7)', () => {
  const all = buildAll(data, given);
  for (const f of ['s', 'n']) {
    it(`${f}: every template check passes`, () => {
      const failed = all.facings[f]?.checks.filter((c) => !c.ok).map((c) => `${c.name} ${JSON.stringify(c.value)}`);
      expect(failed).toEqual([]);
    });
    it(`${f}: height 31, bottom row 30, head alone 13 to 15, shoulder and hip within 1 of the given`, () => {
      const m = measure(all.facings[f]?.sheet.labels ?? [], data);
      expect(m.height).toBeGreaterThanOrEqual(30);
      expect(m.height).toBeLessThanOrEqual(32);
      expect(m.bottom).toBe(30);
      expect(m.headAlone).toBeGreaterThanOrEqual(13);
      expect(m.headAlone).toBeLessThanOrEqual(15);
      expect(Math.abs(m.shoulder - 14)).toBeLessThanOrEqual(1);
      expect(Math.abs(m.hip - 25)).toBeLessThanOrEqual(1);
    });
  }
  it('s agrees with the mirror of sw, and every facing differs from every other and its flip', () => {
    for (const c of all.setChecks) expect(c, c.name).toMatchObject({ ok: true });
  });
  it('e and ne are built too; their misses are reported by the CLI, not hidden', () => {
    expect(Object.keys(all.facings)).toEqual(FACINGS);
    expect(Object.keys(all.mirrors).sort()).toEqual(['nw', 'sw', 'w']);
  });
});

describe('fail paths: each check fails on a mutated sheet', () => {
  it('height: a sheet with the hair dome cut to row 3 is too short', () => {
    const d = mutate('s', (b) => b.map((x) => (x.shape === 'dome' ? { ...x, y: [3, 3] } : x)));
    expect(checkHeight(d, sheetOf(d, 's')).ok).toBe(false);
    expect(checkHeight(data, sheetOf(data, 's')).ok).toBe(true);
  });
  it('bottomRow: boots cut to row 28', () => {
    const d = mutate('n', (b) => b.filter((x) => x.use !== 'legsBootsFront').concat([{ part: 'legs', y: [26, 27], x: [14, 21] }, { part: 'boots', y: [28, 28], x: [15, 20] }]));
    expect(checkBottomRow(d, sheetOf(d, 'n')).ok).toBe(false);
  });
  it('headAlone: a head box 18 wide and one 7 wide both fail', () => {
    const wide = mutate('s', (b) => [...b, { part: 'hair', y: [4, 4], x: ['head-9', 'head+8'] }]);
    const narrow = mutate('s', (b) => b.map((x) => (x.part === 'hair' ? { ...x, x: ['head-3', 'head+3'] } : x)).filter((x) => !(x.part === 'hair' && x.y?.[0] === 5)));
    expect(checkHeadAlone(wide, sheetOf(wide, 's')).ok).toBe(false);
    expect(checkHeadAlone(narrow, sheetOf(narrow, 's')).ok).toBe(false);
  });
  it('guideRows: sleeves moved down 3 rows move the shoulder row; coat cut at row 21 moves the hip row', () => {
    const low = mutate('s', (b) => b.map((x) => (x.use === 'armsFront' ? { use: 'armsLow' } : x)));
    low.blocks.armsLow = (data.blocks.armsFront ?? []).map((x) => (x.part === 'sleeves' && x.y ? { ...x, y: [(x.y[0] as number) + 3, (x.y[1] as number) + 3] } : x));
    const r = checkGuideRows(low, sheetOf(low, 's'), given);
    expect(r.ok).toBe(false);
    expect((r.value as { shoulder: number }).shoulder).toBe(17);
    const hip = mutate('s', (b) => b.filter((x) => !(x.part === 'coat' && x.y?.[0] === 25)).map((x) => (x.y?.[0] === 15 && (x.part === 'coat' || x.part === 'zipper') ? { ...x, y: [15, 21] } : x)));
    const rh = checkGuideRows(hip, sheetOf(hip, 's'), given);
    expect(rh.ok).toBe(false);
    expect((rh.value as { hip: number }).hip).toBeLessThan(24);
  });
  it('partAreas: dropping the coat, or a face on the back view, fails', () => {
    const nocoat = mutate('s', (b) => b.filter((x) => x.part !== 'coat'));
    expect(checkPartAreas(nocoat, sheetOf(nocoat, 's'), given).ok).toBe(false);
    const face = mutate('n', (b) => [...b, { part: 'skin', y: [5, 12], x: ['head-5', 'head+5'] }]);
    const r = checkPartAreas(face, sheetOf(face, 'n'), given);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.value)).toContain('skin');
  });
  it('connected: a floating hand cell fails', () => {
    const d = mutate('s', (b) => [...b, { part: 'hands', y: [31, 31], x: [0, 0] }]);
    expect(checkConnected(d, sheetOf(d, 's')).ok).toBe(false);
    expect(checkConnected(data, sheetOf(data, 's')).ok).toBe(true);
  });
  it('eyes: lenses on the back view fail, a front view without lenses fails, eyes at the head center on se fail the offset', () => {
    const n = mutate('n', (b) => [...b, { part: 'lenses', y: [8, 8], x: ['head-3', 'head+3'] }]);
    expect(checkEyes(n, sheetOf(n, 'n')).ok).toBe(false);
    const s = mutate('s', (b) => b.filter((x) => x.part !== 'lenses'));
    expect(checkEyes(s, sheetOf(s, 's')).ok).toBe(false);
    const se = structuredClone(data);
    const f = se.facings.se;
    if (!f) throw new Error('no se');
    f.faceAxis = 17.5;
    const r = checkEyes(se, sheetOf(se, 'se'));
    expect(r.ok).toBe(false);
    expect(checkEyes(data, sheetOf(data, 'se')).ok).toBe(true);
  });
  it('folds: three strokes on the coat panel fail the two-per-panel line', () => {
    const d = structuredClone(data);
    d.character.folds.coat = [...(d.character.folds.coat ?? []), { support: 'shoulder+4', dir: [0, 1], len: 2 }];
    const sheet = sheetOf(d, 's');
    const r = checkFolds(d, sheet, buildCard(d, sheet));
    expect(r.ok).toBe(false);
    expect(r.value).toBe(3);
  });
  it('folds: a stroke that leaves its panel fails', () => {
    const sheet = sheetOf(data, 's');
    const card = buildCard(data, sheet);
    const bad = { ...card, folds: card.folds.map((s, i) => (i === 0 ? { ...s, cells: [[0, 0]] } : s)) };
    expect(checkFolds(data, sheet, bad).ok).toBe(false);
  });
  it('light: a flipped light map (lit side on the right) and a level on a transparent cell fail', () => {
    const sheet = sheetOf(data, 'se');
    const light = lightMap(data, sheet);
    expect(checkLight(data, sheet, light).ok).toBe(true);
    const flipped = new Uint8Array(light.length);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) flipped[y * 32 + x] = light[y * 32 + (31 - x)] ?? 0;
    expect(checkLight(data, sheet, flipped).ok).toBe(false);
    const stray = new Uint8Array(light);
    stray[0] = LEVEL.lit;
    expect(checkLight(data, sheet, stray).ok).toBe(false);
  });
  it('outline: a missing edge cell and an interior cell marked as silhouette fail', () => {
    const sheet = sheetOf(data, 's');
    const out = outlineMap(data, sheet);
    expect(checkOutline(data, sheet, out).ok).toBe(true);
    const i = out.findIndex((v) => v === 1);
    const missing = new Uint8Array(out);
    missing[i] = 0;
    expect(checkOutline(data, sheet, missing).ok).toBe(false);
    const extra = new Uint8Array(out);
    extra[16 * 32 + 17] = 1; // the middle of the coat
    expect(checkOutline(data, sheet, extra).ok).toBe(false);
  });
  it('mirrorAgree: n in the place of s fails the area agreement with the mirror of sw', () => {
    const all = buildAll(data, given);
    expect(checkMirrorAgree(data, all.facings.s?.sheet as Sheet, all.facings.se?.sheet as Sheet).ok).toBe(true);
    const r = checkMirrorAgree(data, all.facings.n?.sheet as Sheet, all.facings.se?.sheet as Sheet);
    expect(r.ok).toBe(false);
  });
  it('distinct: a facing that equals another facing, or its flip, fails', () => {
    const all = buildAll(data, given);
    const sheets = Object.fromEntries(FACINGS.map((f) => [f, all.facings[f]?.sheet as Sheet]));
    expect(checkDistinct(data, sheets).ok).toBe(true);
    expect(checkDistinct(data, { ...sheets, ne: sheets.n as Sheet }).ok).toBe(false);
    // se is the flip of sw: a set that holds se and its flip fails
    expect(checkDistinct(data, { se: sheets.se as Sheet, sw: mirrorSheet(sheets.se as Sheet, 'sw') }).ok).toBe(false);
  });
});

describe('the sheet is a construction, not a copy', () => {
  it('boxes paint in list order and every cell has one part', () => {
    const sheet = sheetOf(data, 'se');
    const total = Object.values(sheet.parts).reduce((a, p) => a + p.length, 0);
    expect(total).toBe(sheet.labels.filter(Boolean).length);
    expect(new Set(Object.values(sheet.parts).flat()).size).toBe(total);
  });
  it('an unknown anchor, an unknown block and an unknown part throw', () => {
    expect(() => sheetOf(mutate('s', (b) => [...b, { part: 'hair', y: [0, 0], x: ['nowhere', 'head']}]), 's')).toThrow(/unknown anchor/);
    expect(() => sheetOf(mutate('s', (b) => [...b, { use: 'nope' }]), 's')).toThrow(/unknown block/);
    expect(() => sheetOf(mutate('s', (b) => [...b, { part: 'tail', y: [0, 0], x: [1, 2] }]), 's')).toThrow(/not in character.parts/);
  });
  it('the face axis sits 2 toward the turn on se (x19.5, head center x17.5), 0 on s, and the card says so', () => {
    const se = buildCard(data, sheetOf(data, 'se'));
    expect([se.headCenterCol, se.faceAxisCol, se.yaw]).toEqual([17.5, 19.5, 45]);
    const n = buildCard(data, sheetOf(data, 'n'));
    expect(n.eyes).toBe('no face');
    expect(cardText(n)).toContain('eye cells: no face');
    expect(buildCard(data, sheetOf(data, 's')).faceAxisCol).toBe(17.5);
  });
  it('the card holds the light vector, at most 2 folds per panel and the item cells', () => {
    for (const f of FACINGS) {
      const card = buildCard(data, sheetOf(data, f));
      expect(card.lightVector).toEqual(data.character.light.vector);
      const per: Record<string, number> = {};
      for (const s of card.folds) per[s.panel] = (per[s.panel] ?? 0) + 1;
      expect(Math.max(0, ...Object.values(per))).toBeLessThanOrEqual(2);
      expect(card.item.cells.length).toBeGreaterThan(10);
      for (const s of card.folds) expect(s.start).toEqual(s.cells[0]);
    }
  });
  it('the item is on the left in s, se and e and on the right in n and ne; a mirror asks for a redraw', () => {
    const side = (f: string) => buildCard(data, sheetOf(data, f)).item.side;
    expect([side('s'), side('se'), side('e'), side('ne'), side('n')]).toEqual(['left', 'left', 'left', 'right', 'right']);
    expect(buildCard(data, mirrorSheet(sheetOf(data, 'se'), 'sw')).item.side).toContain('redraw');
  });
  it('the light map has the 3 levels on every facing, lit on the top left', () => {
    for (const f of FACINGS) {
      const sheet = sheetOf(data, f);
      const light = lightMap(data, sheet);
      const levels = new Set(light.filter((v) => v > 0));
      expect([...levels].sort()).toEqual([1, 2, 3]);
    }
    const sheet = sheetOf(data, 's');
    const light = lightMap(data, sheet);
    const hair = sheet.parts.hair ?? [];
    const lit = hair.filter((i) => light[i] === LEVEL.lit);
    const meanX = lit.reduce((s, i) => s + (i % 32), 0) / lit.length;
    const meanY = lit.reduce((s, i) => s + Math.floor(i / 32), 0) / lit.length;
    const allX = hair.reduce((s, i) => s + (i % 32), 0) / hair.length;
    const allY = hair.reduce((s, i) => s + Math.floor(i / 32), 0) / hair.length;
    expect(meanX).toBeLessThan(allX);
    expect(meanY).toBeLessThan(allY);
  });
  it('mirrors keep the guide rows and flip x about the line between cells 17 and 18', () => {
    const se = sheetOf(data, 'se');
    const sw = mirrorSheet(se, 'sw');
    expect(measure(sw.labels, data).height).toBe(measure(se.labels, data).height);
    expect(sw.anchors.face).toBe(15.5);
    expect(sw.labels[8 * 32 + 15]).toBe(se.labels[8 * 32 + 20]);
  });
});

describe('se sheet against the given (reported numbers, not a gate)', () => {
  const fit = fitReport(data, sheetOf(data, 'se'), given);
  it('reports part mIoU, silhouette IoU and landmark distances (snapshot of the numbers in the report)', () => {
    // Regression snapshot of a hand fit to the given. It measures how well boxes express the given, not how well they generalize.
    expect(fit.partMIoU).toBeCloseTo(0.918, 2);
    expect(fit.minPartIoU).toBeCloseTo(0.667, 2);
    expect(fit.silhouetteIoU).toBeCloseTo(0.949, 2);
    expect(fit.maxLandmarkDist).toBeCloseTo(0.83, 1);
    expect(Object.keys(fit.perPart)).toHaveLength(13);
  });
  it('can fail: a head 3 columns off scores lower and moves the landmarks', () => {
    const d = structuredClone(data);
    const f = d.facings.se;
    if (!f) throw new Error('no se');
    f.faceAxis = 22.5;
    f.headCenter = 20.5;
    const worse = fitReport(d, sheetOf(d, 'se'), given);
    expect(worse.partMIoU).toBeLessThan(fit.partMIoU - 0.05);
    expect(worse.maxLandmarkDist).toBeGreaterThan(fit.maxLandmarkDist + 1);
  });
  it('an empty sheet scores 0 and a given-equal part map scores 1', () => {
    const empty = { ...sheetOf(data, 'se'), labels: Array(1024).fill(null) as (string | null)[] };
    expect(fitReport(data, empty as unknown as Sheet, given).partMIoU).toBe(0);
    const same = { ...sheetOf(data, 'se'), labels: given };
    expect(fitReport(data, same as unknown as Sheet, given).partMIoU).toBe(1);
  });
});

describe('S3 by part box: copy, transform and invent shares', () => {
  const all = buildAll(data, given);
  it('shares add to 1 on every facing and se copies most of the given', () => {
    for (const [name, s] of Object.entries(all.shares)) {
      expect(s.share.copy + s.share.transform + s.share.invent, name).toBeCloseTo(1, 9);
      expect(s.copy + s.transform + s.invent).toBe(s.total);
    }
    expect(all.shares.se?.share.copy).toBeGreaterThan(0.9);
  });
  it('a mirror is mostly transform, not copy', () => {
    expect(all.shares.sw?.share.transform).toBeGreaterThan(0.8);
  });
  it('with nothing to copy from, everything is invent', () => {
    const empty = Array(1024).fill(null) as (string | null)[];
    const s = sharesByBox(data, sheetOf(data, 'n'), [{ name: 'none', labels: empty }]);
    expect(s.share.invent).toBe(1);
  });
  it('the n facing invents more than s, and the shares are not the v1 estimates (they are measured)', () => {
    expect(all.shares.n?.share.invent).toBeGreaterThan(all.shares.s?.share.invent ?? 1);
  });
});

describe('determinism, previews and isolation', () => {
  it('two builds give the same digest, and the CLI writes byte-identical PNGs twice', () => {
    expect(digest(buildAll(data, given))).toBe(digest(buildAll(loadData(), givenLabels())));
    const a = mkdtempSync(join(tmpdir(), 'pathb-a-'));
    const b = mkdtempSync(join(tmpdir(), 'pathb-b-'));
    tmp.push(a, b);
    run({ out: a, quiet: true });
    run({ out: b, quiet: true });
    const files = readdirSync(a).sort();
    expect(files).toEqual(readdirSync(b).sort());
    expect(files.filter((f) => f.endsWith('.png'))).toHaveLength(16);
    for (const f of files) expect(readFileSync(join(a, f)).equals(readFileSync(join(b, f))), f).toBe(true);
  });
  it('no path B file names the grader-only reference folder', () => {
    const dir = join(__dirname, '../scripts/art/v2/pathb');
    const banned = ['rook-8d', '-ref'].join('');
    for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f), 'utf8').includes(banned), f).toBe(false);
  });
  it('the data file is the only place with Rook numbers: a new data file with one facing builds with the same code', () => {
    const d = structuredClone(data);
    d.facings = { se: d.facings.se as PathBData['facings'][string] };
    expect(measure(sheetOf(d, 'se').labels, d).height).toBe(31);
  });
});
