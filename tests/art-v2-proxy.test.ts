/**
 * Art pipeline v2, proxy tools (scripts/art/v2/proxy): spec format, renderer, fit report, structure card, S3 reprojection, sample sheets,
 * Level T, writer kit, rebuild, template checks, blanked mode.
 * Every hard line and every check has a fail-path test: a mutated input must fail the named line.
 * The given frame comes from the committed walk zip (frame 4). Pinned numbers were measured on the fitted spec rook.character.json;
 * where a test can, it checks a number a second way (an analytic count, raw pixels), not through the code under test.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Img } from '../scripts/art/pixkit/index.mjs';
import { buildPartMap, loadGiven } from '../scripts/art/pipeline/index.mjs';
import type { PartMap } from '../scripts/art/pipeline/index.mjs';
import { BLANK_BOXES, DEFAULT_SPEC, parseBlank } from '../scripts/art/v2/proxy/cli.mjs';
import {
  AREA_GROUPS,
  FIT_LINES,
  GridError,
  SpecError,
  TemplateMismatch,
  approvedSource,
  axisSumOf,
  buildCard,
  buildKit,
  classifyCells,
  cutSamples,
  faceAxis,
  fitLight,
  fitReport,
  flatCells,
  foldStrokes,
  formatGrid32,
  givenLabels,
  givenSource,
  groupOfLetter,
  guideRows,
  imageToFlat32,
  labelAgreement,
  labelMeasures,
  levelT,
  loadSpec,
  mirrorCells,
  optimizeSpec,
  parseGrid32,
  partIoU,
  previewImage,
  rebuildFacing,
  renderTemplate,
  resolveSpec,
  samplesText,
  specProblems,
  stringifySpec,
  suggestRamps,
  templateChecks,
  templateData,
  tunablePaths,
  validateSpec,
} from '../scripts/art/v2/proxy/index.mjs';
import type { Box, CheckResult, Spec, Template, TemplateData } from '../scripts/art/v2/proxy/index.mjs';

const CLI = fileURLToPath(new URL('../scripts/art/v2/proxy/cli.mjs', import.meta.url));
const N = 32;
const given: Img = loadGiven();
const pm: PartMap = buildPartMap(given);
const spec: Spec = loadSpec(DEFAULT_SPEC);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const mut = (f: (s: Spec) => void): Spec => {
  const c = clone(spec);
  f(c);
  return c;
};
const inBox = (b: Box, k: number) => k % N >= b.x0 && k % N <= b.x1 && Math.floor(k / N) >= b.y0 && Math.floor(k / N) <= b.y1;
const boxCells = (b: Box) => Array.from({ length: N * N }, (_, k) => k).filter((k) => inBox(b, k));
const lineOf = (r: CheckResult, name: string) => r.lines.find((l) => l.name === name);
const failing = (r: CheckResult) => r.lines.filter((l) => l.gate && !l.ok).map((l) => l.name);
const hairWing = BLANK_BOXES.hairWing as Box;

/** Replace every cell of the box with a color taken from another place (palette colors, a fixed pseudo-random pick) or transparent. */
function mutateBox(img: Img, b: Box, seed: number): Img {
  const out: Img = { w: img.w, h: img.h, data: new Uint8Array(img.data) };
  const opaque: number[] = [];
  for (let k = 0; k < N * N; k++) if (img.data[k * 4 + 3] === 255 && !inBox(b, k)) opaque.push(k);
  let s = seed;
  for (const k of boxCells(b)) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    if (s % 5 === 0) out.data.set([0, 0, 0, 0], k * 4);
    else out.data.set(img.data.subarray((opaque[s % opaque.length] as number) * 4, (opaque[s % opaque.length] as number) * 4 + 4), k * 4);
  }
  return out;
}

/** A tiny one-part spec for analytic render tests. Camera straight down (pitch 90): screen x = X, screen y = Z. */
function mini(prim: Spec, extra: (s: Spec) => void = () => {}): Spec {
  const s: Spec = {
    format: 'character-proxy/1', name: 'mini', size: 32, givenFacing: 's',
    camera: { pitchDeg: 90, scale: 1, origin: [16, 16] }, light: { vector: [0, 1, 0], levels: [0.2, 0.6] },
    joints: { root: { parent: null, offset: [0, 0, 0], rot: [0, 0, 0] } },
    parts: { p: { label: 'coat', joint: 'root', prim, ramp: { shadow: 'a', base: 'b', lit: 'c', outline: 'a' } } },
    items: {}, face: { joint: 'root', at: [0, 0, 0] }, landmarks: {}, folds: [],
  };
  extra(s);
  return s;
}
const cellsOf = (t: Template, id?: string) => Array.from({ length: N * N }, (_, k) => k).filter((k) => (id ? t.id[k] === id : t.id[k] !== null));

describe('spec format', () => {
  it('the Rook spec is valid and has the parts the plan lists', () => {
    expect(specProblems(spec)).toEqual([]);
    const r: Spec = resolveSpec(spec);
    const labels = new Set(Object.values(r.parts as Record<string, { label: string }>).map((p) => p.label));
    for (const l of ['hair', 'skin', 'lenses', 'beard', 'coat', 'sleeves', 'zipper', 'hands', 'legs', 'boots', 'sheath', 'guard', 'wrap']) expect(labels.has(l)).toBe(true);
    expect(r.givenFacing).toBe('se');
    expect(Object.keys(r.joints)).toEqual(expect.arrayContaining(['root', 'hips', 'chest', 'head', 'armL', 'armR', 'legL', 'legR']));
    expect(r.items.sheath.side).toBe('-x');
    expect(Object.keys(r.landmarks).length).toBeGreaterThanOrEqual(8);
  });
  it('every prim type is allowed and the four primitives are used by name', () => {
    const types = new Set(Object.values(resolveSpec(spec).parts as Record<string, { prim: { type: string } }>).map((p) => p.prim.type));
    expect([...types].sort()).toEqual(['box', 'capsule', 'ellipsoid']);
  });
  // fail paths: each mutation must produce a problem that names the fault
  const bad: [string, (s: Spec) => void, RegExp][] = [
    ['wrong format', (s) => { s.format = 'x'; }, /format/],
    ['size not 32', (s) => { s.size = 64; }, /size/],
    ['bad given facing', (s) => { s.givenFacing = 'up'; }, /givenFacing/],
    ['pitch out of range', (s) => { s.camera.pitchDeg = 0; }, /pitchDeg/],
    ['zero scale', (s) => { s.camera.scale = 0; }, /scale/],
    ['zero light vector', (s) => { s.light.vector = [0, 0, 0]; }, /light.vector/],
    ['light levels out of order', (s) => { s.light.levels = [0.8, 0.2]; }, /light.levels/],
    ['two roots', (s) => { s.joints.head.parent = null; }, /exactly one root/],
    ['missing parent', (s) => { s.joints.head.parent = 'nowhere'; }, /parent/],
    ['unknown label', (s) => { s.parts.hair.label = 'tail'; }, /label/],
    ['missing joint', (s) => { s.parts.hair.joint = 'nowhere'; }, /joint/],
    ['unknown prim type', (s) => { s.parts.hair.prim.type = 'cone'; }, /prim.type/],
    ['negative size', (s) => { s.parts.hair.prim.size[0] = -1; }, /size/],
    ['degenerate capsule', (s) => { s.parts.scabbard.prim.b = s.parts.scabbard.prim.a; }, /same point/],
    ['ramp letter outside a to v', (s) => { s.parts.hair.ramp.base = 'z'; }, /ramp/],
    ['missing ramp', (s) => { delete s.parts.hair.ramp; }, /ramp/],
    ['mirror chain', (s) => { s.parts.lensFar.mirrorOf = 'lensFar'; }, /mirrorOf/],
    ['mirror of a missing part', (s) => { s.parts.lensFar.mirrorOf = 'nope'; }, /mirrorOf/],
    ['item side', (s) => { s.items.sheath.side = 'left'; }, /side/],
    ['item part missing', (s) => { s.items.sheath.parts.push('nope'); }, /item/],
    ['face missing', (s) => { delete s.face; }, /face/],
    ['landmark part missing', (s) => { s.landmarks.noseBridge.part = 'nope'; }, /landmark/],
    ['landmark outside the frame', (s) => { s.landmarks.noseBridge.given = [40, 2]; }, /given/],
    ['three folds on one part', (s) => { s.folds = [s.folds[0], s.folds[0], s.folds[0]]; }, /more than 2/],
    ['diagonal yaw out of range', (s) => { s.diagonalYaw = 95; }, /diagonalYaw/],
    ['head turn out of range', (s) => { s.diagonalHeadTurn = -5; }, /diagonalHeadTurn/],
  ];
  for (const [name, f, re] of bad)
    it(`rejects: ${name}`, () => {
      const s = mut(f);
      expect(specProblems(s).join(' | ')).toMatch(re);
      expect(() => validateSpec(s)).toThrow(SpecError);
    });
  it('a mirror part derives its primitive from the source (x negated), and the spec stays valid', () => {
    const r: Spec = resolveSpec(spec);
    const a = r.parts.lensNear.prim;
    const b = r.parts.lensFar.prim;
    expect(b.at).toEqual([-a.at[0], a.at[1], a.at[2]]);
    expect(b.size).toEqual(a.size);
    const j = r.joints.armL;
    expect(j.offset[0]).toBeCloseTo(-r.joints.armR.offset[0], 9);
  });
  it('stringifySpec round-trips', () => {
    expect(JSON.parse(stringifySpec(spec))).toEqual(spec);
  });
});

describe('renderer: primitives against analytic counts (camera straight down)', () => {
  it('ellipsoid: cell count equals the count of cell centres inside the ellipse', () => {
    const t = renderTemplate(mini({ type: 'ellipsoid', at: [0, 0, 0], size: [6, 3, 4] }), { facing: 's' });
    let want = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (((x + 0.5 - 16) / 6) ** 2 + ((y + 0.5 - 16) / 4) ** 2 <= 1) want++;
    expect(cellsOf(t).length).toBe(want);
    expect(want).toBeGreaterThan(60);
  });
  it('ellipsoid: the top is lit and the rim is in shadow (light from above)', () => {
    // a sphere of radius 5.6: at the rim cell (centre 5.5 from the middle) the normal points up by 1.05 / 5.6 = 0.19, under the 0.2 shadow line
    const t = renderTemplate(mini({ type: 'ellipsoid', at: [0, 0, 0], size: [5.6, 5.6, 5.6] }), { facing: 's' });
    expect(t.level[16 * N + 16]).toBe(2);
    expect(t.level[16 * N + 21]).toBe(0);
    expect(t.level[16 * N + 20]).toBe(1);
  });
  it('box: a 10 by 6 rectangle, and a quarter turn swaps the sides', () => {
    const s = mini({ type: 'box', at: [0, 0, 0], size: [5, 2, 3] });
    const a = renderTemplate(s, { facing: 's' });
    const b = renderTemplate(s, { facing: 'e' });
    const ext = (t: Template) => {
      const xs = cellsOf(t).map((k) => k % N);
      const ys = cellsOf(t).map((k) => Math.floor(k / N));
      return [Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1];
    };
    expect(cellsOf(a).length).toBe(60);
    expect(ext(a)).toEqual([10, 6]);
    expect(ext(b)).toEqual([6, 10]);
  });
  it('capsule: cells within r of the segment; cylinder: the rectangle only', () => {
    const cap = renderTemplate(mini({ type: 'capsule', a: [-5, 0, 0], b: [5, 0, 0], r: 2 }), { facing: 's' });
    const cyl = renderTemplate(mini({ type: 'cylinder', a: [-5, 0, 0], b: [5, 0, 0], r: 2 }), { facing: 's' });
    let wantCap = 0;
    let wantCyl = 0;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const px = x + 0.5 - 16, pz = y + 0.5 - 16;
        const dx = Math.max(Math.abs(px) - 5, 0);
        if (Math.hypot(dx, pz) <= 2) wantCap++;
        if (Math.abs(px) <= 5 && Math.abs(pz) <= 2) wantCyl++;
      }
    expect(cellsOf(cap).length).toBe(wantCap);
    expect(cellsOf(cyl).length).toBe(wantCyl);
    expect(wantCap).toBeGreaterThan(wantCyl);
  });
  it('the nearest primitive wins', () => {
    const s = mini({ type: 'ellipsoid', at: [0, 0, 0], size: [5, 5, 5] }, (x) => {
      x.parts.q = { label: 'hair', joint: 'root', prim: { type: 'ellipsoid', at: [0, 3, 0], size: [3, 3, 3] }, ramp: x.parts.p.ramp };
    });
    const t = renderTemplate(s, { facing: 's' });
    expect(t.id[16 * N + 16]).toBe('q'); // the small one reaches higher, so it is nearer to the camera
    expect(t.id[16 * N + 21 - 1]).toBe('p');
  });
  it('yaw turns the figure in 45 degree steps: a nose point goes to s, se, e, ne, n, nw, w, sw', () => {
    const s = mini({ type: 'ellipsoid', at: [0, 0, 8], size: [1.2, 1.2, 1.2] });
    const where: Record<string, [number, number]> = {};
    const centre = (t: Template): [number, number] => {
      const c = cellsOf(t);
      return [c.reduce((a, k) => a + (k % N), 0) / c.length + 0.5 - 16, c.reduce((a, k) => a + Math.floor(k / N), 0) / c.length + 0.5 - 16];
    };
    for (const f of ['s', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw']) where[f] = centre(renderTemplate(s, { facing: f }));
    const r2 = Math.SQRT1_2 * 8;
    const want: Record<string, [number, number]> = { s: [0, 8], se: [r2, r2], e: [8, 0], ne: [r2, -r2], n: [0, -8], nw: [-r2, -r2], w: [-8, 0], sw: [-r2, r2] };
    for (const f of Object.keys(want)) {
      expect(Math.abs((where[f] as number[])[0] as number - (want[f] as number[])[0]!)).toBeLessThan(0.8);
      expect(Math.abs((where[f] as number[])[1] as number - (want[f] as number[])[1]!)).toBeLessThan(0.8);
    }
  });
  it('pitch: a vertical bar is foreshortened by cos of the pitch', () => {
    const s = (p: number) => mini({ type: 'box', at: [0, 0, 0], size: [2, 10, 2] }, (x) => { x.camera.pitchDeg = p; x.camera.origin = [16, 20]; });
    const h = (t: Template) => { const ys = cellsOf(t).map((k) => Math.floor(k / N)); return Math.max(...ys) - Math.min(...ys) + 1; };
    const side = h(renderTemplate(s(10), { facing: 's' }));
    const up = h(renderTemplate(s(60), { facing: 's' }));
    expect(side).toBeGreaterThan(up);
    expect(side).toBeGreaterThanOrEqual(19);
  });
  it('a pose adds to the joint rotation and moves only that limb', () => {
    const base = renderTemplate(spec, { facing: 's' });
    const posed = renderTemplate(spec, { facing: 's', pose: { armR: [60, 0, 0] } });
    const head = (t: Template) => cellsOf(t).filter((k) => ['hair', 'skin', 'lenses', 'beard'].includes(t.label[k] as string));
    expect(head(base)).toEqual(head(posed));
    const sl = (t: Template) => cellsOf(t).filter((k) => t.id[k] === 'sleeveNear').join(',');
    expect(sl(base)).not.toEqual(sl(posed));
  });
});

describe('renderer: determinism and the Rook templates', () => {
  it('two renders are identical, field by field', () => {
    const a = renderTemplate(spec, { facing: 'ne' });
    const b = renderTemplate(spec, { facing: 'ne' });
    expect(JSON.stringify([a.id, Array.from(a.level), Array.from(a.outline), Array.from(a.depth)])).toBe(JSON.stringify([b.id, Array.from(b.level), Array.from(b.outline), Array.from(b.depth)]));
  });
  it('outputs are 32 by 32 with no resample: one entry per cell', () => {
    const t = renderTemplate(spec, { facing: 'se' });
    expect(t.w).toBe(32);
    expect(t.h).toBe(32);
    expect(t.id.length).toBe(1024);
    expect(t.level.length).toBe(1024);
    expect(t.outline.length).toBe(1024);
  });
  it('every facing renders, stays inside the frame and has an outline map on every silhouette edge cell', () => {
    for (const f of ['s', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw']) {
      const t = renderTemplate(spec, { facing: f });
      const cells = cellsOf(t);
      expect(cells.length).toBeGreaterThan(250);
      for (const k of cells) {
        const x = k % N, y = Math.floor(k / N);
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const xx = x + (dx as number), yy = y + (dy as number); return xx < 0 || yy < 0 || xx >= N || yy >= N || t.id[yy * N + xx] === null; });
        expect(t.outline[k] > 0 || !edge).toBe(true);
        expect(t.level[k]).toBeGreaterThanOrEqual(0);
      }
    }
  });
  it('s is symmetric about the axis, and the mirror of sw is se, outside the item parts', () => {
    const sum = axisSumOf(spec);
    const s = renderTemplate(spec, { facing: 's' });
    expect(labelAgreement(s.label, mirrorCells(s.label, sum))).toBe(1);
    expect(labelAgreement(mirrorCells(renderTemplate(spec, { facing: 'sw' }).label, sum), renderTemplate(spec, { facing: 'se' }).label)).toBe(1);
  });
  it('mirrorCells: x goes to 35 - x, twice gives the cells back (columns 4 to 31), and 35 is the axis sum for origin x 18', () => {
    const t = renderTemplate(spec, { facing: 'ne' });
    const m = mirrorCells(t.label, 35);
    for (let y = 0; y < N; y++) for (let x = 4; x < N; x++) expect(m[y * N + (35 - x)]).toBe(t.label[y * N + x]);
    const twice = mirrorCells(m, 35);
    for (let y = 0; y < N; y++) for (let x = 4; x < N; x++) expect(twice[y * N + x]).toBe(t.label[y * N + x]);
    expect(axisSumOf(spec)).toBe(35);
  });
  it('the light is one for the whole set: the same direction at every facing', () => {
    // top of the head (hair) faces up, so it is lit at every facing
    for (const f of ['s', 'e', 'n', 'w']) {
      const t = renderTemplate(spec, { facing: f });
      const hairTop = cellsOf(t).filter((k) => t.label[k] === 'hair' && k < 3 * N + N);
      expect(hairTop.length).toBeGreaterThan(5);
      expect(hairTop.some((k) => t.level[k] === 2 || t.level[k] === 1)).toBe(true);
    }
  });
  it('the guide rows of the se template agree with the given part map to within 1 row', () => {
    const g = guideRows(givenLabels(pm));
    const r = guideRows(renderTemplate(spec, { facing: 'se' }).label);
    for (const k of ['head', 'eye', 'shoulder', 'hip', 'hem', 'foot'] as const) expect(Math.abs((r[k] as number) - (g[k] as number))).toBeLessThanOrEqual(1);
    expect(g.foot).toBe(30);
  });
  it('the diagonals use diagonalYaw and the head turn; s, e, n, w do not', () => {
    const d = spec.diagonalYaw as number;
    expect(renderTemplate(spec, { facing: 'se' }).yaw).toBeCloseTo(d, 9);
    expect(renderTemplate(spec, { facing: 'sw' }).yaw).toBeCloseTo(360 - d, 9);
    expect(renderTemplate(spec, { facing: 'ne' }).yaw).toBeCloseTo(180 - d, 9);
    expect(renderTemplate(spec, { facing: 'nw' }).yaw).toBeCloseTo(180 + d, 9);
    expect(renderTemplate(spec, { facing: 'e' }).yaw).toBe(90);
    expect(renderTemplate(spec, { facing: 'se' }).pose.head?.[1]).toBeCloseTo(-(spec.diagonalHeadTurn as number), 9);
    expect(renderTemplate(spec, { facing: 's' }).pose.head).toBeUndefined();
  });
  it('the sheath is drawn on the side the geometry gives: left of the picture at s, right at n', () => {
    const cx = (f: string) => {
      const t = renderTemplate(spec, { facing: f });
      const c = cellsOf(t).filter((k) => ['sheath', 'wrap', 'guard'].includes(t.label[k] as string)).map((k) => k % N);
      return c.reduce((a, b) => a + b, 0) / c.length;
    };
    expect(cx('s')).toBeLessThan(17.5);
    expect(cx('n')).toBeGreaterThan(17.5);
  });
});

describe('fit report (S1)', () => {
  const rep = fitReport(spec, given, pm);
  it('part mIoU is the mean over the labels, recomputed here from raw labels', () => {
    const t = renderTemplate(spec, { facing: 'se' });
    const names = Object.keys(rep.parts);
    let sum = 0;
    for (const n of names) {
      let i = 0, u = 0;
      for (let k = 0; k < N * N; k++) {
        const a = t.label[k] === n;
        const b = (pm.parts[n] ?? []).includes(k);
        if (a && b) i++;
        if (a || b) u++;
      }
      sum += i / u;
      expect(rep.parts[n].iou).toBeCloseTo(i / u, 3);
    }
    expect(rep.mIoU).toBeCloseTo(sum / names.length, 3);
    expect(names.length).toBe(13);
  });
  it('pinned: the fitted spec reaches part mIoU 0.83 or more and every landmark is within 1 px', () => {
    expect(rep.mIoU).toBeGreaterThanOrEqual(0.83);
    expect(rep.silhouetteIoU).toBeGreaterThanOrEqual(0.92);
    expect(rep.pass.landmarks).toBe(true);
    for (const l of Object.values(rep.landmarks) as { px: number }[]) expect(l.px).toBeLessThanOrEqual(FIT_LINES.landmarkPx);
    expect(Object.keys(rep.landmarks).length).toBeGreaterThanOrEqual(8);
  });
  it('the pass flag follows the line: pass.mIoU is mIoU at or over 0.85', () => {
    expect(rep.pass.mIoU).toBe(rep.mIoU >= FIT_LINES.mIoU);
    expect(FIT_LINES.mIoU).toBe(0.85);
  });
  it('fail path: a part moved 6 units drops mIoU and the landmark line fails', () => {
    const bad = mut((s) => { s.parts.hair.prim.at[1] += 6; s.parts.handNear.prim.at[0] -= 6; });
    const r = fitReport(bad, given, pm);
    expect(r.mIoU).toBeLessThan(rep.mIoU - 0.05);
    expect(r.pass.landmarks).toBe(false);
  });
  it('fail path: a missing part scores 0 and is the weakest part', () => {
    const bad = mut((s) => { s.parts.beard.prim.at = [0, -40, 0]; });
    const r = fitReport(bad, given, pm);
    expect(r.parts.beard.iou).toBe(0);
    expect(r.minPart.part).toBe('beard');
  });
  it('partIoU is 1 for identical label lists and 0 for disjoint ones', () => {
    const a = givenLabels(pm);
    const r = partIoU(a, a);
    expect(Object.values(r).every((v) => (v as { iou: number }).iou === 1)).toBe(true);
    const b = a.map((l: string | null) => (l === 'hair' ? 'coat' : l === 'coat' ? 'hair' : l));
    expect((partIoU(a, b).hair as { iou: number }).iou).toBe(0);
  });
  it('light agreement: the fitted light does not agree worse than the best light found by the search', () => {
    const best = fitLight(spec, given, pm);
    expect(best.agreement).toBeGreaterThanOrEqual(rep.light.exact - 0.005);
    expect(best.vector).toHaveLength(3);
  });
  it('the report is deterministic', () => {
    expect(JSON.stringify(fitReport(spec, given, pm))).toBe(JSON.stringify(rep));
  });
});

describe('optimizer: numbers only, deterministic, inside the trust region', () => {
  it('tunable numbers skip mirrored parts, mirrored joints and the sideways move of center parts', () => {
    const paths = tunablePaths(spec).map((p: (string | number)[]) => p.join('.'));
    expect(paths.some((p: string) => p.startsWith('parts.lensFar.'))).toBe(false);
    expect(paths.some((p: string) => p.startsWith('joints.armL.'))).toBe(false);
    expect(paths).toContain('parts.lensNear.prim.at.0');
    expect(paths).not.toContain('parts.face.prim.at.0');
    expect(paths).toContain('parts.face.prim.size.0');
    expect(paths.some((p: string) => p.includes('.rot.'))).toBe(false);
  });
  it('same input and seed give the same spec; the objective does not fall; numbers stay within the trust region of the anchor', () => {
    const start = mut((s) => { s.parts.handNear.prim.at[1] += 2; });
    const run = () => optimizeSpec(start, pm, { steps: [1], maxSweeps: 1, random: { iters: 60, seed: 7, sigma: 0.4 }, paths: tunablePaths(start).filter((p: (string | number)[]) => p[1] === 'handNear'), anchor: spec });
    const a = run();
    const b = run();
    expect(JSON.stringify(a.spec)).toBe(JSON.stringify(b.spec));
    expect(a.after).toBeGreaterThanOrEqual(a.before);
    expect(Math.abs(a.spec.parts.handNear.prim.at[1] - spec.parts.handNear.prim.at[1])).toBeLessThanOrEqual(3.001);
    expect(a.spec.parts.handNear.prim.at[1]).toBeLessThan(start.parts.handNear.prim.at[1]);
  });
  it('blanked mode: the optimizer never reads a box cell', () => {
    const box = hairWing;
    const mutated = mutateBox(given, box, 3);
    const pmB = buildPartMap(mutated);
    const run = (p: PartMap) => optimizeSpec(spec, p, { blank: box, steps: [1], maxSweeps: 1, paths: tunablePaths(spec).filter((q: (string | number)[]) => q[1] === 'hair'), anchor: spec });
    expect(JSON.stringify(run(pm))).toBe(JSON.stringify(run(pmB)));
  });
});

describe('blanked mode (T1): a box cell reaches no output', () => {
  for (const [name, box] of Object.entries(BLANK_BOXES) as [string, Box][]) {
    describe(`box ${name}`, () => {
      const mutated = mutateBox(given, box, 11);
      const pmB = buildPartMap(mutated);
      it('the mutation really changed the box and nothing outside it', () => {
        let inside = 0;
        for (let k = 0; k < N * N; k++) {
          const same = [0, 1, 2, 3].every((i) => given.data[k * 4 + i] === mutated.data[k * 4 + i]);
          if (!same) { expect(inBox(box, k)).toBe(true); inside++; }
        }
        expect(inside).toBeGreaterThan(20);
      });
      it('fit report: scored cells exclude the box, and the report is identical for the true and the mutated given', () => {
        const a = fitReport(spec, given, pm, { blank: box });
        const b = fitReport(spec, mutated, pmB, { blank: box });
        expect(a.scoredCells).toBe(N * N - boxCells(box).length);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        for (const l of Object.values(a.landmarks) as { given: number[] }[]) expect(inBox(box, Math.floor(l.given[1] as number) * N + Math.floor(l.given[0] as number))).toBe(false);
      });
      it('landmarks inside the box are dropped', () => {
        const all = Object.entries(spec.landmarks as Record<string, { given: number[] }>);
        const inside = all.filter(([, l]) => inBox(box, Math.floor(l.given[1] as number) * N + Math.floor(l.given[0] as number))).map(([n]) => n);
        const kept = Object.keys(fitReport(spec, given, pm, { blank: box }).landmarks);
        for (const n of inside) expect(kept).not.toContain(n);
        expect(kept.length + inside.length).toBe(all.length);
      });
      it('light fit is identical for the true and the mutated given', () => {
        expect(JSON.stringify(fitLight(spec, given, pm, { blank: box }))).toBe(JSON.stringify(fitLight(spec, mutated, pmB, { blank: box })));
      });
      it('sample sheets: no cell in the box, and the same text for both givens', () => {
        const cut = cutSamples(spec, given, pm, { blank: box });
        for (const g of Object.values(cut.groups) as Record<string, { x: number; y: number }[]>[]) for (const cells of Object.values(g)) for (const c of cells) expect(inBox(box, c.y * N + c.x)).toBe(false);
        expect(samplesText(cut)).toBe(samplesText(cutSamples(spec, mutated, pmB, { blank: box })));
        expect(JSON.stringify(suggestRamps(given, pm, { blank: box }))).toBe(JSON.stringify(suggestRamps(mutated, pmB, { blank: box })));
      });
      it('S3: every box cell is a paint cell, no source cell lies in the box, and the classes are the same for both givens', () => {
        const t = renderTemplate(spec, { facing: 'se' });
        const a = classifyCells(spec, t, [givenSource(spec, given, pm, { blank: box })], { blank: box });
        const b = classifyCells(spec, t, [givenSource(spec, mutated, pmB, { blank: box })], { blank: box });
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        for (const k of boxCells(box)) if (a.cells[k]) expect(a.cells[k].cls).toBe('invent');
        for (const c of a.cells) if (c?.src) expect(inBox(box, c.src.y * N + c.src.x)).toBe(false);
        const full = classifyCells(spec, t, [givenSource(spec, given, pm)]);
        expect(a.counts.invent).toBeGreaterThan(full.counts.invent);
        // a second source that has a letter in every cell must still not fill a box cell: the target rule holds by itself
        const letters = t.id.map((id: string | null) => (id ? 'n' : '.'));
        const withNeighbor = classifyCells(spec, t, [givenSource(spec, given, pm, { blank: box }), approvedSource(spec, 'se', letters)], { blank: box });
        for (const k of boxCells(box)) if (withNeighbor.cells[k]) expect(withNeighbor.cells[k].cls).toBe('invent');
      });
      it('writer kit: every file is byte-identical for the true and the mutated given, and the copy source holds no box cell', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'v2-blank-'));
        try {
          const ka = buildKit({ spec, facing: 'se', outDir: join(tmp, 'a'), img: given, pm, blank: box });
          const kb = buildKit({ spec, facing: 'se', outDir: join(tmp, 'b'), img: mutated, pm: pmB, blank: box });
          expect(ka.files).toEqual(kb.files);
          for (const f of ka.files) {
            if (f === 'lib.mjs' || f.endsWith('.json') && f === 'package.json') continue;
            expect(readFileSync(join(tmp, 'a', f)).equals(readFileSync(join(tmp, 'b', f))), f).toBe(true);
          }
          const letters = flatCells(parseGrid32(readFileSync(join(tmp, 'a', 'given-letters.txt'), 'utf8')));
          for (const k of boxCells(box)) expect(letters[k]).toBe('.');
          const start = flatCells(parseGrid32(readFileSync(join(tmp, 'a', 'grid-template.txt'), 'utf8')));
          for (const k of boxCells(box)) expect(start[k]).toBe('.');
          const td = JSON.parse(readFileSync(join(tmp, 'a', 'template.json'), 'utf8')) as TemplateData;
          for (const k of Object.keys(td.locked)) expect(inBox(box, Number(k))).toBe(false);
          for (const k of Object.keys(td.soft)) expect(inBox(box, Number(k))).toBe(false);
        } finally {
          rmSync(tmp, { recursive: true, force: true });
        }
      });
    });
  }
  it('--blank parses names and numbers; a wrong value throws', () => {
    expect(parseBlank('hairWing')).toEqual({ x0: 11, y0: 0, x1: 17, y1: 10 });
    expect(parseBlank('coat')).toEqual({ x0: 13, y0: 11, x1: 17, y1: 25 });
    expect(parseBlank('1,2,3,4')).toEqual({ x0: 1, y0: 2, x1: 3, y1: 4 });
    expect(parseBlank(undefined)).toBeNull();
    expect(() => parseBlank('x')).toThrow();
  });
});

describe('structure card (S2)', () => {
  const card = (f: string) => buildCard(spec, renderTemplate(spec, { facing: f }));
  it('se: yaw, head center column 17.5, face axis column near 19.5 (2 to 3 toward the turn), eye cells, light words, guide rows', () => {
    const c = card('se');
    expect(c.fields.headCenter).toBe(17.5);
    expect(Math.abs(c.fields.faceAxis - 19.5)).toBeLessThanOrEqual(1);
    expect(c.fields.faceOffset).toBeGreaterThan(1.5);
    expect(c.fields.faceOffset).toBeLessThan(3.5);
    expect(c.fields.eyeCells.length).toBeGreaterThan(15);
    expect(c.text).toMatch(/face axis column: 20/);
    expect(c.text).toMatch(/light vector: top-right, toward the viewer/);
    expect(c.text).toMatch(/guide rows: head top 0, eye 7/);
    expect(c.text).toMatch(/carried items:\n {2}sheath: carried on the left of the picture at facing s; at this facing it shows left of the figure/);
  });
  it('n: no face, no eye cells, the sheath shows on the right', () => {
    const c = card('n');
    expect(c.fields.faceAxis).toBeNull();
    expect(c.fields.eyeCells).toEqual([]);
    expect(c.text).toMatch(/eye cells: no face/);
    expect(c.text).toMatch(/face axis column: none \(no face/);
    expect(c.text).toMatch(/shows right of the figure/);
  });
  it('s: the face axis is the head center, folds are listed with a start point, a direction and a shadow side', () => {
    const c = card('s');
    expect(c.fields.faceOffset).toBe(0);
    const f = c.fields.folds as { hidden: boolean; start: number[]; dirName: string; shadowSide: string }[];
    expect(f.length).toBeLessThanOrEqual(2);
    expect(f.some((x) => !x.hidden)).toBe(true);
    const shown = f.find((x) => !x.hidden);
    expect(shown?.start).toHaveLength(2);
    expect(shown?.shadowSide).toBe('left'); // the light is at the right, so the shadow side is the left
    expect(c.text).toMatch(/start \(\d+, \d+\), direction/);
  });
  it('part layout rows: every opaque row is listed and the run lengths add up to the cell count', () => {
    const t = renderTemplate(spec, { facing: 'se' });
    const c = card('se');
    const rows = c.text.split('\n').filter((l: string) => /^ {2}\d\d: /.test(l));
    let total = 0;
    for (const r of rows)
      for (const m of r.slice(6).split(' ')) {
        const mm = /^[A-Z](\d+)(?:-(\d+))?$/.exec(m);
        expect(mm, m).not.toBeNull();
        total += Number(mm?.[2] ?? mm?.[1]) - Number(mm?.[1]) + 1;
      }
    expect(total).toBe(cellsOf(t).length);
  });
  it('fold strokes: more than 2 per part is rejected by the spec, a fold that is not on the visible surface is hidden', () => {
    const t = renderTemplate(spec, { facing: 'n' });
    expect((foldStrokes(spec, t) as { hidden: boolean }[]).every((f) => f.hidden)).toBe(true);
    const two = mut((s) => { s.folds = [s.folds[0]]; });
    expect(foldStrokes(two, renderTemplate(two, { facing: 's' }))).toHaveLength(1);
  });
  it('faceAxis: none when the face point is hidden', () => {
    expect(faceAxis(resolveSpec(spec), renderTemplate(spec, { facing: 'n' }))).toBeNull();
    expect(faceAxis(resolveSpec(spec), renderTemplate(spec, { facing: 's' }))?.col).toBeCloseTo(17.5, 1);
  });
});

describe('S3 reprojection', () => {
  const src = givenSource(spec, given, pm);
  const cls = (f: string, sources = [src], blank: Box | null = null) => classifyCells(spec, renderTemplate(spec, { facing: f }), sources, { blank });
  it('the given facing against the given: almost every cell is copy, none is transform', () => {
    const r = cls('se');
    expect(r.counts.transform).toBe(0);
    expect(r.counts.copy / r.total).toBeGreaterThan(0.85);
    for (const [k, c] of r.cells.entries()) if (c?.cls === 'copy') expect(c.letter).toBe(imageToFlat32(given)[k]);
  });
  it('shares per facing: invented share rises as the facing turns away from the given', () => {
    const sh = Object.fromEntries(['se', 's', 'e', 'ne', 'n'].map((f) => [f, cls(f).share])) as Record<string, number>;
    expect(sh.se).toBeLessThan(0.15);
    expect(sh.s).toBeGreaterThan(sh.se as number);
    expect(sh.n).toBeGreaterThan(0.9);
    expect(sh.ne).toBeGreaterThan(0.9);
    expect(sh.s).toBeLessThan(sh.n as number);
  });
  it('the three classes and the reasons add up to the cell count', () => {
    const r = cls('s');
    expect(r.counts.copy + r.counts.transform + r.counts.invent).toBe(r.total);
    expect(Object.values(r.why as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(r.counts.invent);
    expect(r.total).toBe(cellsOf(renderTemplate(spec, { facing: 's' })).length);
  });
  it('transform: a cell with the same part and light that sits in another place is a transform with its source cell', () => {
    const r = cls('s');
    type Cell = { cls: string; src: { x: number; y: number } } | null;
    const tr = (r.cells as Cell[]).map((c, k) => [c, k] as const).filter(([c]) => c?.cls === 'transform');
    expect(tr.length).toBeGreaterThan(30);
    for (const [c, k] of tr) expect(c && (c.src.x !== k % N || c.src.y !== Math.floor(k / N))).toBe(true);
  });
  it('n from se: most cells are hidden in the given (the back is new)', () => {
    const r = cls('n');
    expect(r.why.hidden).toBeGreaterThan(300);
  });
  it('fail path: a source with no letters gives no copy and no transform', () => {
    const empty = { ...src, letters: Array(N * N).fill('.') };
    const r = cls('se', [empty]);
    expect(r.counts.copy + r.counts.transform).toBe(0);
    expect(r.why.unusable).toBe(r.total);
  });
  it('fail path: a part-map label that disagrees makes the source cell unusable', () => {
    const wrong = { ...src, labels: src.labels.map(() => 'coat') };
    const r = cls('se', [wrong]);
    expect(r.counts.copy).toBeLessThan(cls('se').counts.copy / 2);
  });
  it('a light level that differs makes the cell an invent cell (reason level)', () => {
    expect(cls('s').why.level).toBeGreaterThan(50);
    expect(cls('se').why.level ?? 0).toBe(0);
  });
  it('an approved neighbor is a second source: the same facing against its own grid is all copy', () => {
    const t = renderTemplate(spec, { facing: 'e' });
    const letters = t.id.map((id: string | null) => (id ? 'n' : '.'));
    const r = classifyCells(spec, t, [approvedSource(spec, 'e', letters)]);
    expect(r.counts.copy).toBe(r.total);
  });
});

describe('sample sheets', () => {
  const cut = cutSamples(spec, given, pm);
  it('every opaque given cell is in exactly one group, with its own letter', () => {
    const letters = imageToFlat32(given);
    let n = 0;
    const seen = new Set<number>();
    for (const g of Object.values(cut.groups) as Record<string, { x: number; y: number; letter: string }[]>[])
      for (const cells of Object.values(g))
        for (const c of cells) {
          expect(letters[c.y * N + c.x]).toBe(c.letter);
          expect(seen.has(c.y * N + c.x)).toBe(false);
          seen.add(c.y * N + c.x);
          n++;
        }
    expect(n).toBe(Object.values(pm.parts).reduce((a, c) => a + c.length, 0));
    expect(n).toBe(432);
  });
  it('group of a letter follows the ramp: hair m shadow, p base, t lit, a outline', () => {
    expect(groupOfLetter(spec, 'hair', 'm')).toBe('shadow');
    expect(groupOfLetter(spec, 'hair', 'p')).toBe('base');
    expect(groupOfLetter(spec, 'hair', 't')).toBe('lit');
    expect(groupOfLetter(spec, 'hair', 'a')).toBe('outline');
    expect(groupOfLetter(spec, 'hair', 'q')).toBe('other');
  });
  it('the given letters of every part lie inside the part ramp (the spec ramps come from the given)', () => {
    const other = Object.entries(cut.groups).flatMap(([l, g]) => (g as Record<string, unknown[]>).other?.map(() => l) ?? []);
    expect(other).toEqual([]);
  });
  it('suggestRamps reproduces a ramp that covers every letter of the part', () => {
    const r = suggestRamps(given, pm) as Record<string, { shadow: string; base: string; lit: string; outline: string }>;
    const hair = r.hair as { shadow: string; base: string; lit: string; outline: string };
    expect(new Set([...hair.shadow, ...hair.base, ...hair.lit, ...hair.outline])).toEqual(new Set(['a', 'm', 'p', 't']));
  });
  it('the text lists each block with a header and rows', () => {
    const t = samplesText(cut);
    expect(t).toMatch(/## hair lit/);
    expect(t).toMatch(/## zipper base/);
  });
});

/** A grid that has zero Level T conflicts: each cell gets the ramp letter nearest to the template light level; outline cells get an outline letter. */
function validGrid(td: TemplateData): string[] {
  const names = ['shadow', 'base', 'lit'] as const;
  return Array.from({ length: N * N }, (_, k) => {
    const idx = td.idx[k] as number;
    if (idx < 0) return '.';
    const r = td.ramps[td.ids[idx] as string] as Record<string, string>;
    if ((td.outline[k] as number) > 0) return (r.outline as string)[0] as string;
    const want = td.level[k] as number;
    for (const d of [0, 1, 2]) for (const lv of [want - d, want + d]) { const s = r[names[lv] as string]; if (s) return s[0] as string; }
    return (r.base as string)[0] as string;
  });
}

describe('Level T', () => {
  const t = renderTemplate(spec, { facing: 's' });
  const td = templateData(spec, t);
  const ok = validGrid(td);
  const kinds = (g: string[], d = td) => [...new Set(levelT(d, g).conflicts.map((c: { kind: string }) => c.kind))];
  const interior = (label: string, pred: (k: number) => boolean = () => true) =>
    cellsOf(t).find((k) => t.label[k] === label && t.outline[k] === 0 && pred(k) && [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].every(([dx, dy]) => t.label[(Math.floor(k / N) + (dy as number)) * N + (k % N) + (dx as number)] === label)) as number;
  it('a valid grid has zero conflicts', () => {
    expect(levelT(td, ok).conflicts).toEqual([]);
  });
  it('fail: a letter outside the ramp of the part and its neighbors', () => {
    const k = interior('coat');
    const g = [...ok];
    g[k] = 'q';
    expect(kinds(g)).toEqual(['ramp']);
    expect(levelT(td, g).conflicts[0].x).toBe(k % N);
  });
  it('fail: a light level two steps from the template', () => {
    const k = interior('hair', (c) => t.level[c] === 2);
    const g = [...ok];
    g[k] = 'm';
    expect(kinds(g)).toEqual(['light-level']);
    const k0 = interior('hair', (c) => t.level[c] === 0);
    const g2 = [...ok];
    g2[k0] = 't';
    expect(kinds(g2)).toEqual(['light-level']);
  });
  it('fail: a letter far outside the template silhouette', () => {
    const g = [...ok];
    g[0] = 'a';
    expect(kinds(g)).toEqual(['outside-silhouette']);
  });
  it('a letter one cell outside the silhouette is allowed (dilated by 1 px)', () => {
    const k = cellsOf(t).find((c) => t.outline[c] === 1 && t.id[c + 1] === null && c % N < 30) as number;
    const g = [...ok];
    g[k + 1] = 'a';
    expect(levelT(td, g).conflicts).toEqual([]);
  });
  it('fail: an interior template cell left transparent is a hole; an edge cell is only a warning', () => {
    const k = interior('coat');
    const g = [...ok];
    g[k] = '.';
    expect(kinds(g)).toEqual(['hole']);
    const e = cellsOf(t).find((c) => t.outline[c] === 1) as number;
    const g2 = [...ok];
    g2[e] = '.';
    const r = levelT(td, g2);
    expect(r.conflicts).toEqual([]);
    expect(r.warnings.map((w: { kind: string }) => w.kind)).toContain('edge-missing');
  });
  it('fail: a locked copy cell that was changed', () => {
    const k = interior('coat');
    const locked: TemplateData = { ...td, locked: { [k]: ok[k] as string } };
    const g = [...ok];
    g[k] = (ok[k] as string) === 'n' ? 'h' : 'n';
    expect(kinds(g, locked)).toEqual(['locked-changed']);
    expect(kinds(ok, locked)).toEqual([]);
  });
  it('warning: a letter from a neighbor part ramp on a seam cell is allowed with a seam warning', () => {
    const k = cellsOf(t).find((c) => t.label[c] === 'hair' && t.outline[c] === 0 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => t.label[(Math.floor(c / N) + (dy as number)) * N + (c % N) + (dx as number)] === 'skin')) as number;
    const g = [...ok];
    g[k] = 'v';
    const r = levelT(td, g);
    expect(r.conflicts).toEqual([]);
    expect(r.warnings.map((w: { kind: string }) => w.kind)).toContain('seam');
  });
  it('warning: an outline cell painted with a non-outline letter', () => {
    const k = cellsOf(t).find((c) => t.outline[c] === 1 && t.label[c] === 'coat') as number;
    const g = [...ok];
    g[k] = 'n';
    const r = levelT(td, g);
    expect(r.conflicts.filter((c: { kind: string }) => c.kind !== 'light-level')).toEqual([]);
    expect(r.warnings.map((w: { kind: string }) => w.kind)).toContain('outline-missing');
  });
  it('the template data hash changes when the spec changes the template', () => {
    const a = templateData(spec, renderTemplate(spec, { facing: 's' }));
    const b = templateData(mut((s) => { s.parts.hair.prim.size[0] += 1; }), renderTemplate(mut((s) => { s.parts.hair.prim.size[0] += 1; }), { facing: 's' }));
    expect(a.hash).toBe(td.hash);
    expect(b.hash).not.toBe(a.hash);
  });
});

describe('grid text', () => {
  const rows = (n: number, w = 32) => Array.from({ length: n }, (_, y) => `${String(y).padStart(2, '0')}|${'.'.repeat(w)}`).join('\n');
  it('round trip: format then parse gives the same cells', () => {
    const cells = Array.from({ length: N * N }, (_, k) => (k % 7 === 0 ? 'q' : '.'));
    expect(flatCells(parseGrid32(formatGrid32(cells)))).toEqual(cells);
  });
  it('fail: wrong row count, column count, letter and row label', () => {
    expect(() => parseGrid32(rows(31))).toThrow(GridError);
    expect(() => parseGrid32(rows(33))).toThrow(GridError);
    expect(() => parseGrid32(rows(32, 31))).toThrow(/31 columns/);
    expect(() => parseGrid32(rows(32).replace('00|.', '00|w'))).toThrow(/bad letter/);
    expect(() => parseGrid32(rows(32).replace('05|', '06|'))).toThrow(/row label/);
    expect(() => parseGrid32(rows(32).replace('00|.', '00| '))).toThrow(GridError);
  });
  it('comments and blank lines are ignored', () => {
    expect(parseGrid32(`# header\n\n${rows(32)}\n`)).toHaveLength(32);
  });
});

describe('writer kit', () => {
  let dir = '';
  let kit: { files: string[]; td: TemplateData; cls: { counts: { copy: number; transform: number; invent: number } } };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'v2-kit-'));
    kit = buildKit({ spec, facing: 's', outDir: join(dir, 'kit'), img: given, pm });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  it('builds every file the plan lists for a facing', () => {
    for (const f of ['template-32x.png', 'template.txt', 'template.json', 'card.txt', 'given-32x.png', 'given-letters.txt', 'classes-32x.png', 'classes.txt', 'grid-template.txt', 'ramps.txt', 'legend.png', 'README.md', 'render.mjs', 'levelt.mjs', 'grid32.mjs', 'lib.mjs', 'palette.json', 'samples/samples.txt', 'samples/sample-hair.png', 'samples/sample-zipper.png'])
      expect(existsSync(join(dir, 'kit', f)), f).toBe(true);
    expect(kit.files.length).toBeGreaterThan(30);
  });
  it('holds no reference: no file names a hidden folder, and the README names the steps', () => {
    const bad = ['rook-8d-ref', 'rook-6a', 'spritefusion-tests'];
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (n === 'node_modules' ? [] : statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
    for (const f of walk(join(dir, 'kit')))
      if (/\.(txt|md|json|mjs)$/.test(f)) for (const b of bad) expect(readFileSync(f, 'utf8').includes(b), `${f} ${b}`).toBe(false);
    const readme = readFileSync(join(dir, 'kit', 'README.md'), 'utf8');
    expect(readme).toMatch(/Paint the near-black interior lines/);
    expect(readme).toMatch(/Render at least 3 times|Render, read the conflict list/);
  });
  it('the template picture and the text maps agree on the cell count', () => {
    const txt = readFileSync(join(dir, 'kit', 'template.txt'), 'utf8');
    const codeRows = txt.split('\n\n')[0]?.split('\n').filter((l) => /^\d\d\|/.test(l)) ?? [];
    const n = codeRows.join('').replace(/\d\d\|/g, '').replace(/\./g, '').length;
    expect(n).toBe(cellsOf(renderTemplate(spec, { facing: 's' })).length);
  });
  it('grid-template: locked copy cells and soft transform cells are pre-filled, paint cells are dots', () => {
    const g = flatCells(parseGrid32(readFileSync(join(dir, 'kit', 'grid-template.txt'), 'utf8')));
    const filled = g.filter((c: string) => c !== '.').length;
    expect(filled).toBe(kit.cls.counts.copy + kit.cls.counts.transform);
    for (const [k, l] of Object.entries(kit.td.locked)) expect(g[Number(k)]).toBe(l);
  });
  it('the kit render.mjs runs on its own: exit 1 with conflicts on the template, exit 0 on a valid grid, exit 2 on a bad grid', () => {
    const run = (grid: string, base: string) => spawnSync(process.execPath, ['render.mjs', grid, base], { cwd: join(dir, 'kit'), encoding: 'utf8' });
    const a = run('grid-template.txt', 'out-a');
    expect(a.status).toBe(1);
    expect(a.stdout).toMatch(/CONFLICTS \d+/);
    expect(existsSync(join(dir, 'kit', 'out-a-sheet.png'))).toBe(true);
    expect(existsSync(join(dir, 'kit', 'out-a-conflicts.txt'))).toBe(true);
    const valid = validGrid(kit.td);
    for (const [k, l] of Object.entries(kit.td.locked)) valid[Number(k)] = l;
    writeFileSync(join(dir, 'kit', 'valid.txt'), formatGrid32(valid));
    const b = run('valid.txt', 'out-b');
    expect(b.stdout).toMatch(/CONFLICTS 0/);
    expect(b.status).toBe(0);
    writeFileSync(join(dir, 'kit', 'bad.txt'), 'nonsense\n');
    expect(run('bad.txt', 'out-c').status).toBe(2);
    expect(run('missing.txt', 'out-d').status).toBe(2);
  });
  it('a locked cell changed by the writer is reported by the kit render', () => {
    const valid = validGrid(kit.td);
    const keys = Object.keys(kit.td.locked);
    expect(keys.length).toBeGreaterThan(0);
    for (const [k, l] of Object.entries(kit.td.locked)) valid[Number(k)] = l;
    const k0 = Number(keys[0]);
    valid[k0] = valid[k0] === 'n' ? 'h' : 'n';
    writeFileSync(join(dir, 'kit', 'locked.txt'), formatGrid32(valid));
    const r = spawnSync(process.execPath, ['render.mjs', 'locked.txt', 'out-l'], { cwd: join(dir, 'kit'), encoding: 'utf8' });
    expect(r.stdout).toMatch(/locked-changed/);
    expect(r.status).toBe(1);
  });
  it('the kit is deterministic: a second build gives the same bytes', () => {
    buildKit({ spec, facing: 's', outDir: join(dir, 'kit2'), img: given, pm });
    for (const f of kit.files) {
      if (f === 'palette.json' || f === 'lib.mjs') continue;
      expect(readFileSync(join(dir, 'kit', f)).equals(readFileSync(join(dir, 'kit2', f))), f).toBe(true);
    }
  });
  it('a kit with a neighbor facing adds the neighbor picture and letters', () => {
    const t = renderTemplate(spec, { facing: 'se' });
    const flat = t.id.map((id: string | null) => (id ? 'n' : '.'));
    const k2 = buildKit({ spec, facing: 'e', outDir: join(dir, 'kit3'), img: given, pm, neighbors: [{ facing: 'se', flat }] });
    expect(k2.files).toContain('neighbor-se-32x.png');
    expect(k2.files).toContain('neighbor-se-letters.txt');
    expect(k2.cls.counts.copy + k2.cls.counts.transform).toBeGreaterThanOrEqual(kit.cls.counts.copy);
  });
});

describe('rebuild rule', () => {
  const gridFor = (f: string) => {
    const t = renderTemplate(spec, { facing: f });
    const g = validGrid(templateData(spec, t));
    return { t, g };
  };
  it('rebuilds a facing from the spec and a grid: the locked cells win, and the result is deterministic', () => {
    const { g } = gridFor('s');
    const text = formatGrid32(g);
    const a = rebuildFacing({ spec, facing: 's', gridText: text, img: given, pm });
    const b = rebuildFacing({ spec, facing: 's', gridText: text, img: given, pm });
    expect(a.final).toEqual(b.final);
    expect(JSON.stringify(a.td)).toBe(JSON.stringify(b.td));
    const locked = Object.entries(a.td.locked) as [string, string][];
    expect(locked.length).toBeGreaterThan(0);
    for (const [k, l] of locked) expect(a.final[Number(k)]).toBe(l);
    expect(a.lockFixed).toBeGreaterThanOrEqual(0);
  });
  it('a grid that changed a locked cell is repaired by the rebuild, and the repair is counted', () => {
    const { g } = gridFor('s');
    const first = rebuildFacing({ spec, facing: 's', gridText: formatGrid32(g), img: given, pm });
    const [k, l] = Object.entries(first.td.locked)[0] as [string, string];
    const g2 = [...g];
    g2[Number(k)] = l === 'n' ? 'h' : 'n';
    const r = rebuildFacing({ spec, facing: 's', gridText: formatGrid32(g2), img: given, pm });
    expect(r.final[Number(k)]).toBe(l);
    expect(r.lockFixed).toBeGreaterThanOrEqual(1);
  });
  it('fail path: a stored template whose hash differs from the spec template stops the rebuild', () => {
    const { g } = gridFor('s');
    const stale = templateData(spec, renderTemplate(mut((s) => { s.parts.hair.prim.size[0] += 1; }), { facing: 's' }));
    expect(() => rebuildFacing({ spec, facing: 's', gridText: formatGrid32(g), img: given, pm, templateJson: stale })).toThrow(TemplateMismatch);
    const fresh = templateData(spec, renderTemplate(spec, { facing: 's' }));
    expect(() => rebuildFacing({ spec, facing: 's', gridText: formatGrid32(g), img: given, pm, templateJson: fresh })).not.toThrow();
  });
  it('fail path: a bad grid is a GridError', () => {
    expect(() => rebuildFacing({ spec, facing: 's', gridText: 'x', img: given, pm })).toThrow(GridError);
  });
  it('the cli rebuild command: exit 0 on a clean grid, 1 on conflicts, 3 on a template mismatch, 2 on a bad grid; the PNG is the grid', () => {
    const dir = mkdtempSync(join(tmpdir(), 'v2-rebuild-'));
    try {
      const { g } = gridFor('s');
      const first = rebuildFacing({ spec, facing: 's', gridText: formatGrid32(g), img: given, pm });
      writeFileSync(join(dir, 'ok.txt'), formatGrid32(first.final));
      writeFileSync(join(dir, 'conf.txt'), formatGrid32(g.map((c, k) => (k === 0 ? 'a' : c))));
      writeFileSync(join(dir, 'bad.txt'), 'nope');
      writeFileSync(join(dir, 'stale.json'), JSON.stringify({ ...first.td, hash: 'deadbeef0000' }));
      writeFileSync(join(dir, 'fresh.json'), JSON.stringify(first.td));
      const run = (...a: string[]) => spawnSync(process.execPath, [CLI, 'rebuild', '--facing', 's', '--out', join(dir, 'out'), ...a], { encoding: 'utf8' });
      expect(run('--grid', join(dir, 'ok.txt'), '--template', join(dir, 'fresh.json')).status).toBe(0);
      const png = readFileSync(join(dir, 'out', 's.png'));
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(readFileSync(join(dir, 'out', 's.txt'), 'utf8')).toBe(formatGrid32(first.final));
      expect(run('--grid', join(dir, 'conf.txt')).status).toBe(1);
      expect(run('--grid', join(dir, 'ok.txt'), '--template', join(dir, 'stale.json')).status).toBe(3);
      expect(run('--grid', join(dir, 'bad.txt')).status).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('template checks (plan section 7)', () => {
  it('pinned: the Rook s and n templates pass every gated line', () => {
    for (const f of ['s', 'n']) {
      const r = templateChecks(spec, pm, f);
      expect(failing(r), f).toEqual([]);
      expect(r.ok).toBe(true);
      for (const l of ['height', 'bottom-row', 'head-alone', 'shoulder-row', 'hip-row']) expect(lineOf(r, l)?.ok, `${f} ${l}`).toBe(true);
    }
  });
  it('the item area is reported but never gates', () => {
    const l = lineOf(templateChecks(spec, pm, 'n'), 'area-item');
    expect(l?.gate).toBe(false);
  });
  it('the area groups cover every part exactly once', () => {
    const all = Object.values(AREA_GROUPS).flat() as string[];
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(13);
  });
  it('measures: the given has height 31, bottom row 30, head alone 14, shoulder 15, hip 26', () => {
    const m = labelMeasures(givenLabels(pm));
    expect([m.height, m.bottom, m.headAlone, m.shoulder, m.hip]).toEqual([31, 30, 14, 15, 26]);
  });
  // fail paths, one per hard line and per check
  const fails = (f: string, s: Spec) => failing(templateChecks(s, pm, f));
  it('fail: height and bottom row (the figure moved up)', () => {
    const f = fails('s', mut((s) => { s.camera.origin[1] -= 3; }));
    expect(f).toContain('bottom-row');
    expect(f).toContain('height');
  });
  it('fail: head alone (a wide head)', () => {
    expect(fails('s', mut((s) => { s.parts.hair.prim.size[0] = 12; }))).toContain('head-alone');
  });
  it('fail: shoulder row (the arms raised)', () => {
    expect(fails('s', mut((s) => { s.joints.armR.offset[1] += 5; }))).toContain('shoulder-row');
  });
  it('fail: hip row (the hem shortened, the legs show earlier)', () => {
    expect(fails('s', mut((s) => { s.parts.coatHem.prim.size[1] = 0.2; s.parts.coat.prim.at[1] += 3; }))).toContain('hip-row');
  });
  it('fail: part area (thin sleeves)', () => {
    expect(fails('s', mut((s) => { s.parts.sleeveNear.prim.r = 0.8; s.parts.sleeveNear2.prim.r = 0.8; }))).toContain('area-sleeves');
  });
  it('fail: symmetry at s (a head shifted sideways)', () => {
    expect(fails('s', mut((s) => { s.parts.hair.prim.at[0] = 6; }))).toContain('symmetric');
  });
  it('fail: the mirror of sw must equal se (an arm that is not the mirror of the other)', () => {
    const f = fails('s', mut((s) => { delete s.parts.sleeveFar.mirrorOf; s.parts.sleeveFar.prim = { type: 'capsule', a: [0, 0, 0], b: [0, -12, 0], r: 4 }; }));
    expect(f).toContain('sw-mirror-matches-se');
  });
  it('fail: no face at n (a lens on the back of the head)', () => {
    expect(fails('n', mut((s) => { s.parts.lensNear.prim.at = [-2, 0, -9]; }))).toContain('no-face');
  });
  it('labelAgreement: identical lists agree, different ones do not; items are left out', () => {
    const a = givenLabels(pm);
    expect(labelAgreement(a, a)).toBe(1);
    expect(labelAgreement(a, a.map((l: string | null) => (l === 'coat' ? 'hair' : l)))).toBeLessThan(0.8);
    const b = a.map((l: string | null) => (l === 'sheath' ? 'coat' : l));
    expect(labelAgreement(a, b)).toBe(1);
  });
  it('the cli checks command exits 0 when s and n pass, and 1 when a facing fails', () => {
    const ok = spawnSync(process.execPath, [CLI, 'checks', '--facings', 's,n'], { encoding: 'utf8' });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/template checks, facing s: PASS/);
    const dir = mkdtempSync(join(tmpdir(), 'v2-checks-'));
    try {
      writeFileSync(join(dir, 'bad.json'), stringifySpec(mut((s) => { s.parts.hair.prim.size[0] = 12; })));
      const bad = spawnSync(process.execPath, [CLI, 'checks', '--spec', join(dir, 'bad.json'), '--facings', 's'], { encoding: 'utf8' });
      expect(bad.status).toBe(1);
      expect(bad.stdout).toMatch(/FAIL {2}head-alone/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('previews and the cli', () => {
  it('the preview is a part map and a light map side by side at k pixels per cell', () => {
    const t = renderTemplate(spec, { facing: 'se' });
    const img = previewImage(t, 8);
    expect(img.h).toBe(256);
    expect(img.w).toBe(256 * 2 + 8);
  });
  it('cli fit prints the report and exits 1 while a pass line fails; --json is parseable', () => {
    const r = spawnSync(process.execPath, [CLI, 'fit', '--json'], { encoding: 'utf8' });
    const j = JSON.parse(r.stdout) as { mIoU: number; pass: { mIoU: boolean; landmarks: boolean } };
    expect(r.status).toBe(j.pass.mIoU && j.pass.landmarks ? 0 : 1);
    expect(j.mIoU).toBeGreaterThan(0.8);
  });
  it('cli with an unknown command exits 2', () => {
    expect(spawnSync(process.execPath, [CLI, 'nope'], { encoding: 'utf8' }).status).toBe(2);
  });
  it('cli templates writes a picture, a card and the template data for each facing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'v2-templates-'));
    try {
      const r = spawnSync(process.execPath, [CLI, 'templates', '--facings', 's,n', '--out', dir, '--k', '8'], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      for (const f of ['s', 'n']) for (const x of ['template-32x.png', 'card.txt', 'template.json']) expect(existsSync(join(dir, `${f}-${x}`))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
