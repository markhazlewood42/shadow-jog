// Calibration set and runner (plan v2 section 4, R3 section 5). Grader-only: it reads the Sprite Fusion references.
//   node scripts/art/v2/grade/calibrate.mjs [--write-gates] [--out <report.md>] [--json <file>] [--t1 <dir>]
// Groups:
//   pass-near    each reference as a candidate (walk palette, near-black outline, 31 px): as it is, shifted 1 px, rescaled to 30 and 32 px,
//                and with 5 percent of its interior cells moved one ramp step
//   pass-real    the walk frames against the given (same character, same facing, another pose). A slot for T1 outputs: --t1 <dir> reads
//                <facing>.png files and adds them (T1 outputs judged same-style by G1 and G2, once they exist)
//   fail-near    the adjacent reference facing (45 and 90 degrees), the round 8 facings, the rig v2 facings (PA-CM-01 is round 8)
//   fail-far     Hex walk frame 0, Sable walk frame 0, and an egg-shaped blob
//   info         the mirror of the given against sw, the mirror of ne against nw: reported, in no group
// For every measure: worst pass value, best fail value, whether they separate, and the gate in the middle. At least 4 measures must separate.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { crop, newImage, readPng, unhex } from '../../pixkit/png.mjs';
import { REPO, loadWalkFrames, unzipEntry } from '../../pipeline/given.mjs';
import { GATES_PATH, cellDiff, checkHardLines, loadGates, loadSpec } from './hardlines.mjs';
import { N, cloneImg, flipH, flipLabels, opaqueAt, packedAt, placeScaled, quantizeTo, recolorOutline, setPixel } from './image.mjs';
import { measureAgainst } from './measures.mjs';
import { REF_FACINGS, loadReference } from './refs/labels.mjs';
import { pack } from './color.mjs';

const R8 = 'C:/Users/markh/AppData/Local/Temp/rook-step3/round-8/facings';
const RIG_FIELD = `${REPO}/public/art/rig/field.json`;

// ---------------------------------------------------------------- building blocks

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedOf = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

/** A reference as the grader's target: the outline recolored to the near-black rule (plan v2 section 4). */
export function makeTarget(ref, nearBlack) {
  return { img: recolorOutline(ref.img, nearBlack).img, labels: ref.labels, landmarks: ref.landmarks };
}

/** A reference as a candidate: outline recolored, walk palette, resized to height h on the bottom row 30. */
export function candidateFromRef(ref, spec, { h = 31, dx = 0, dy = 0 } = {}) {
  const q = quantizeTo(recolorOutline(ref.img, spec.nearBlack).img, spec.palette);
  const placed = placeScaled(q, ref.labels, { s: h, dx, dy, anchor: 'bbox', target: { x0: 8, y0: 0, x1: 23, y1: 30 } });
  return { img: placed.img, labels: placed.labels };
}

/** Move 5 percent of the interior cells one step along their ramp (palette.json ramps, dark to light). */
export function recolorStep(img, ramps, seedText, share = 0.05) {
  const rnd = mulberry32(seedOf(seedText));
  const ramp = new Map();
  for (const list of Object.values(ramps))
    list.forEach((hex, i) => {
      const [r, g, b] = unhex(hex);
      ramp.set(pack(r, g, b), { list, i });
    });
  const out = cloneImg(img);
  const cells = [];
  for (let y = 1; y < N - 1; y++)
    for (let x = 1; x < N - 1; x++) {
      if (!opaqueAt(img, x, y)) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !opaqueAt(img, x + dx, y + dy))) continue; // interior only
      const r = ramp.get(packedAt(img, x, y));
      if (r && r.list.length > 1) cells.push([x, y, r]);
    }
  const n = Math.max(1, Math.round(cells.length * share));
  for (let k = 0; k < n && cells.length; k++) {
    const j = Math.floor(rnd() * cells.length);
    const [x, y, r] = cells.splice(j, 1)[0];
    const step = r.i === 0 ? 1 : r.i === r.list.length - 1 ? -1 : rnd() < 0.5 ? -1 : 1;
    const [R, G, B] = unhex(r.list[r.i + step]);
    setPixel(out, x, y, pack(R, G, B));
  }
  return out;
}

/** An egg-shaped blob: 18 wide, 31 tall, flat coat green with a near-black outline. */
export function blobImage(spec) {
  const img = newImage(N, N);
  const fill = pack(...unhex(spec.palette.find((c) => c === '#61693c') ?? spec.palette[9]));
  const line = pack(...unhex(spec.nearBlack[0]));
  const cx = 15.5;
  const cy = 15;
  for (let y = 0; y < 31; y++)
    for (let x = 0; x < N; x++) {
      const rx = 9 + 0.0 * (y - cy);
      const ry = 15.7;
      const inside = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
      if (inside) setPixel(img, x, y, fill);
    }
  const edge = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (opaqueAt(img, x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !opaqueAt(img, x + dx, y + dy))) edge.push([x, y]);
  for (const [x, y] of edge) setPixel(img, x, y, line);
  return img;
}

function sheetFrame(zip, index) {
  const png = PNG.sync.read(unzipEntry(`${REPO}/spritefusion-tests/${zip}.zip`, 'spritesheet.png'));
  const sheet = { w: png.width, h: png.height, data: new Uint8Array(png.data) };
  const per = Math.floor(sheet.w / 32);
  return crop(sheet, (index % per) * 32, Math.floor(index / per) * 32, 32, 32);
}

const CH = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Render a rig v2 facing (public/art/rig/field.json) into 32x32 on the bottom row 30, like scripts/art/render-rig.mjs. */
export function rigFacing(facing) {
  const t = JSON.parse(readFileSync(RIG_FIELD, 'utf8')).rook[facing];
  const img = newImage(N, N);
  const left = Math.floor((N - t.w) / 2);
  const top = 30 - t.feet;
  for (let y = 0; y < t.h; y++)
    for (let x = 0; x < t.w; x++) {
      const ch = (t.rows[y] ?? '')[x] ?? '.';
      if (ch === '.') continue;
      const hex = t.pal[CH.indexOf(ch)];
      const X = left + x;
      const Y = top + y;
      if (hex && X >= 0 && Y >= 0 && X < N && Y < N) setPixel(img, X, Y, pack(...unhex(hex)));
    }
  return img;
}

/** Adjacent facings of the ring s, se, e, ne, n, nw, w, sw (45 degrees apart). The refs exist for s, n, ne, nw, sw, and se is the given. */
const NEAR = {
  s: ['sw', 'se'],
  n: ['ne', 'nw'],
  ne: ['n', 'nw', 'se'],
  nw: ['n', 'ne', 'sw'],
  sw: ['s', 'nw', 'se'],
};

// ---------------------------------------------------------------- the set

/**
 * Build the calibration items. Each item: { id, group, target, facing, cand, labels, labelSource, groupsOnly, note, exempt }.
 * facing is the facing name the hard lines see. exempt lists hard-line ids that this variant breaks by construction.
 * labels: the candidate part labels. An item made from a reference carries that reference's hand labels (what a template would give),
 * and an item with unknown parts (another character, a blob, an older round, a walk frame) uses the automatic labeler (labels null).
 * groupsOnly: measure only these part groups (the walk frames, part by part: limbs move between frames, so only head and torso count).
 */
export function buildCalibrationItems({ spec = loadSpec(), t1Dir = null } = {}) {
  const ramps = JSON.parse(readFileSync(`${dirname(GATES_PATH)}/../../headtest/palette.json`, 'utf8')).ramps;
  const refs = Object.fromEntries(REF_FACINGS.map((f) => [f, loadReference(f)]));
  const items = [];
  const add = (it) => items.push({ labels: null, groupsOnly: null, exempt: [], hardLines: true, ...it, labelSource: it.labels ? 'reference labels' : 'auto' });
  const from = (f, o) => candidateFromRef(refs[f], spec, o);

  // pass-near
  for (const f of REF_FACINGS) {
    const base = from(f);
    const mk = (id, c, note, extra = {}) => add({ id: `${f}:${id}`, group: 'pass-near', target: f, facing: f, cand: c.img, labels: c.labels, note, ...extra });
    mk('as-is', base, 'reference as candidate');
    mk('shift+1x', from(f, { dx: 1 }), 'shifted 1 px right');
    mk('shift-1x', from(f, { dx: -1 }), 'shifted 1 px left');
    mk('shift-1y', from(f, { dy: -1 }), 'shifted 1 px up (measure only: it breaks the bottom-row line by construction)', { hardLines: false });
    mk('scale30', from(f, { h: 30 }), 'rescaled to 30 px (measure only: a smaller head and rows by construction)', { hardLines: false });
    mk('scale32', from(f, { h: 32 }), 'rescaled to 32 px (measure only)', { hardLines: false });
    mk('recolor5', { img: recolorStep(base.img, ramps, `${f}:recolor5`), labels: base.labels }, '5 percent of interior cells moved one ramp step');
  }

  // pass-real: walk frames against the given, part by part (head and torso)
  const walk = loadWalkFrames();
  walk.forEach((fr, k) => {
    if (k === 4) return;
    add({ id: `walk${k}:vs-given`, group: 'pass-real', target: 'se', facing: 'se', cand: fr, groupsOnly: ['hair', 'face', 'torso'], note: `walk frame ${k} against the given (frame 4), head and torso only` });
    add({ id: `walk${k}:vs-given-full`, group: 'info', target: 'se', facing: 'se', cand: fr, note: `walk frame ${k} against the given, all parts (pose differences included)` });
  });
  if (t1Dir && existsSync(t1Dir)) {
    for (const f of [...REF_FACINGS, 'se'])
      if (existsSync(`${t1Dir}/${f}.png`)) add({ id: `t1:${f}`, group: 'pass-real', target: f, facing: f, cand: readPng(`${t1Dir}/${f}.png`), note: 'T1 output judged same-style' });
  }

  // fail-near: adjacent facing, with its own labels
  const asCand = { se: { img: spec.given, labels: spec.givenLabels } };
  for (const f of REF_FACINGS) asCand[f] = from(f);
  for (const [t, others] of Object.entries(NEAR))
    for (const o of others) add({ id: `${t}<-${o}`, group: 'fail-near', target: t, facing: t, cand: asCand[o].img, labels: asCand[o].labels, note: `adjacent facing ${o} as candidate for ${t}` });
  // round 8 (PA-CM-01) and rig v2
  for (const [file, t] of [['down', 's'], ['up', 'n'], ['up-right', 'ne']]) {
    const p = `${R8}/${file}.png`;
    if (existsSync(p)) add({ id: `${t}<-round8-${file}`, group: 'fail-near', target: t, facing: t, cand: readPng(p), note: `round 8 ${file} (the PA-CM-01 miss: graders passed it, Mark said not close)` });
  }
  if (existsSync(RIG_FIELD)) {
    add({ id: 's<-rig-down', group: 'fail-near', target: 's', facing: 's', cand: rigFacing('down'), note: 'rig v2 down' });
    add({ id: 'n<-rig-up', group: 'fail-near', target: 'n', facing: 'n', cand: rigFacing('up'), note: 'rig v2 up' });
  }

  // fail-far
  const hex0 = sheetFrame('hex-overworld-walk', 0);
  const sable0 = sheetFrame('sable-overworld-walk', 0);
  const blob = blobImage(spec);
  for (const f of REF_FACINGS) {
    add({ id: `${f}<-hex0`, group: 'fail-far', target: f, facing: f, cand: hex0, note: 'Hex walk frame 0, another character' });
    add({ id: `${f}<-sable0`, group: 'fail-far', target: f, facing: f, cand: sable0, note: 'Sable walk frame 0, another character' });
    add({ id: `${f}<-blob`, group: 'fail-far', target: f, facing: f, cand: blob, note: 'egg-shaped blob' });
  }

  // info
  add({ id: 'sw<-flip(given)', group: 'info', target: 'sw', facing: 'sw', cand: flipH(spec.given), labels: flipLabels(spec.givenLabels, N, N), note: 'the plan makes sw by mirroring se: the mirrored given against the sw reference' });
  add({ id: 'nw<-flip(ne)', group: 'info', target: 'nw', facing: 'nw', cand: flipH(asCand.ne.img), labels: flipLabels(asCand.ne.labels, N, N), note: 'the plan makes nw by mirroring ne' });
  return items;
}

/** The target for a facing name: a reference with the outline recolored, or the given with its part labels. */
export function targetsFor(spec) {
  const out = { se: { img: spec.given, labels: spec.givenLabels } };
  for (const f of REF_FACINGS) out[f] = makeTarget(loadReference(f), spec.nearBlack);
  return out;
}

// ---------------------------------------------------------------- distinct N

/** The distinct-facing line: N from the reference set. */
export function distinctCalibration(spec = loadSpec()) {
  const cands = { se: spec.given };
  for (const f of REF_FACINGS) cands[f] = candidateFromRef(loadReference(f), spec).img;
  const names = Object.keys(cands);
  const partner = (a, b) => [a, b].sort().join('|') === 'se|sw' || [a, b].sort().join('|') === 'ne|nw';
  const pairs = [];
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i];
      const b = names[j];
      pairs.push({ a, b, kind: 'plain', cells: cellDiff(cands[a], cands[b]) });
      if (!partner(a, b)) pairs.push({ a, b: `flip(${b})`, kind: 'flip', cells: cellDiff(cands[a], flipH(cands[b])) });
    }
  const min = pairs.reduce((m, p) => (p.cells < m.cells ? p : m), pairs[0]);
  return { n: Math.floor(min.cells / 2), min, pairs, note: 'N = half of the smallest cell difference between two facings of the reference set, each against the other and against its flip. The mirror partners se/sw and ne/nw are not compared against each other flipped' };
}

// ---------------------------------------------------------------- the runner

const MEASURES = (gates) => Object.entries(gates.targetMeasures).map(([key, m]) => ({ key, ...m }));

function separation(m, rows) {
  const pass = rows.filter((r) => r.group === 'pass-near' || r.group === 'pass-real');
  const fail = rows.filter((r) => r.group === 'fail-near' || r.group === 'fail-far');
  const better = (a, b) => (m.dir === 'min' ? a > b : a < b);
  const worst = (list) => list.reduce((w, r) => (better(w.v, r.v) ? r : w), list[0]);
  const best = (list) => list.reduce((w, r) => (better(r.v, w.v) ? r : w), list[0]);
  const val = (r) => ({ id: r.id, group: r.group, v: r.measures[m.key] });
  const P = pass.map(val);
  const F = fail.map(val);
  const passWorst = worst(P);
  const failBest = best(F);
  const nearOnly = P.filter((p) => p.group === 'pass-near');
  const realOnly = P.filter((p) => p.group === 'pass-real');
  const sepAll = better(passWorst.v, failBest.v);
  const worstNear = worst(nearOnly);
  const sepNear = better(worstNear.v, failBest.v);
  let ordered = 0;
  let total = 0;
  for (const p of P) for (const f of F) {
    total++;
    if (better(p.v, f.v)) ordered++;
  }
  const finite = (x) => (Number.isFinite(x) ? x : m.dir === 'min' ? -1e9 : 1e9);
  const gate = sepAll ? (finite(passWorst.v) + finite(failBest.v)) / 2 : null;
  return { key: m.key, name: m.name, dir: m.dir, start: m.start, passWorst, failBest, worstNear, worstReal: realOnly.length ? worst(realOnly) : null, separates: sepAll, separatesNearOnly: sepNear, pairAccuracy: total ? ordered / total : 0, gate, margin: Math.abs(passWorst.v - failBest.v) };
}

/** Run the whole calibration. Returns { rows, table, gating, hardLines, distinct, info }. */
export function runCalibration({ spec = loadSpec(), gates = loadGates(), t1Dir = null, autoLabels = false, log = () => {} } = {}) {
  const items = buildCalibrationItems({ spec, t1Dir });
  if (autoLabels) for (const it of items) it.labels = null; // sensitivity run: every candidate is labeled by the automatic labeler
  const targets = targetsFor(spec);
  const distinct = distinctCalibration(spec);
  const gatesWithN = { ...gates, hardLines: { ...gates.hardLines, distinctN: distinct.n } };
  const rows = [];
  for (const it of items) {
    const r = measureAgainst(it.cand, targets[it.target], { candLabels: it.labels, groupsOnly: it.groupsOnly });
    rows.push({ ...it, ...r });
    log(`${it.group.padEnd(9)} ${it.id.padEnd(22)} bf1 ${r.measures.bf1.toFixed(2)} mIoU ${r.measures.partMiou.toFixed(2)} cm ${r.measures.colorMatch.toFixed(2)}`);
  }
  const scored = rows.filter((r) => r.group !== 'info');
  const table = MEASURES(gates).map((m) => separation(m, scored));
  const gating = table.filter((t) => t.separates).map((t) => t.key);

  // Hard lines on every item. A line that fails a should-pass item is flagged.
  const set = [{ name: 'se', img: spec.given }, ...REF_FACINGS.map((f) => ({ name: f, img: candidateFromRef(loadReference(f), spec).img }))];
  const runLines = (g) => {
    const out = [];
    for (const it of items) {
      if (it.hardLines === false) continue;
      const res = checkHardLines(it.cand, { facing: it.facing, spec, gates: g, exempt: it.exempt, labels: it.groupsOnly ? null : it.labels, set: it.group === 'pass-near' ? set.filter((s) => s.name !== it.target) : undefined, name: it.target });
      out.push({ id: it.id, group: it.group, pass: res.pass, failed: res.items.filter((i) => i.status === 'fail').map((i) => `${i.id} ${i.name}`), items: res.items, metrics: res.metrics });
    }
    return out;
  };
  const lineRows = runLines(gatesWithN);
  const lineIds = [...new Set(lineRows.flatMap((r) => r.items.map((i) => `${i.id}|${i.name.replace(/\d+(\.\d+)?/g, '#')}`)))].sort();
  const hardLines = lineIds.map((key) => {
    const [id] = key.split('|');
    const hit = (r) => r.items.some((i) => `${i.id}|${i.name.replace(/\d+(\.\d+)?/g, '#')}` === key && i.status === 'fail');
    const passFail = lineRows.filter((r) => (r.group === 'pass-near' || r.group === 'pass-real') && hit(r));
    const failCaught = lineRows.filter((r) => (r.group === 'fail-near' || r.group === 'fail-far') && hit(r));
    return { line: key.split('|')[1], id, failsShouldPass: passFail.map((r) => r.id), catchesShouldFail: failCaught.length, shouldFailTotal: lineRows.filter((r) => r.group === 'fail-near' || r.group === 'fail-far').length };
  });
  const metricRows = metricCalibration(lineRows);
  // The same lines with the proposed re-set applied: how many should-pass items pass, how many should-fail items are still caught.
  const reset = resetOf(metricRows, gatesWithN.hardLines);
  const lineRowsReset = runLines({ ...gatesWithN, hardLines: { ...gatesWithN.hardLines, reset, useReset: true } });
  return { rows, table, gating, hardLines, lineRows, lineRowsReset, reset, distinct, items, metricRows };
}

/** The re-set values of the lines that failed should-pass items (gates.json hardLines.reset). */
export function resetOf(metricRows, HL) {
  const prop = (name) => metricRows.find((m) => m.name === name)?.proposed ?? null;
  return {
    orphanFactor: prop('PA-04 orphans / given') ?? HL.countFactor,
    widthTol: Object.fromEntries(Object.keys(HL.widthTol).map((k) => [k, prop('PA-06 box width deviation') ?? HL.widthTol[k]])),
    headWidthTol: prop('PA-07 head width deviation') ?? 1,
    flatteningFloor: prop('HL-FLAT lowest part ratio') ?? HL.flatteningFloor,
  };
}

/**
 * The numeric hard lines against the calibration set. For each: the current limit, the worst should-pass value, the best should-fail value,
 * and a re-set proposal when a should-pass item breaks the limit (the worst should-pass value, widened to a round number).
 */
export function metricCalibration(lineRows) {
  const names = Object.keys(lineRows[0].metrics);
  const out = [];
  for (const name of names) {
    const get = (r) => r.metrics[name];
    const any = get(lineRows[0]);
    const dir = any.dir;
    const better = (a, b) => (dir === 'min' ? a > b : a < b);
    const pass = lineRows.filter((r) => (r.group === 'pass-near' || r.group === 'pass-real') && Number.isFinite(get(r).value) && get(r).limit !== null);
    const fail = lineRows.filter((r) => (r.group === 'fail-near' || r.group === 'fail-far') && Number.isFinite(get(r).value) && get(r).limit !== null);
    if (!pass.length) continue;
    const worst = pass.reduce((w, r) => (better(w.v, get(r).value) ? { id: r.id, v: get(r).value } : w), { id: pass[0].id, v: get(pass[0]).value });
    const best = fail.length ? fail.reduce((w, r) => (better(get(r).value, w.v) ? { id: r.id, v: get(r).value } : w), { id: fail[0].id, v: get(fail[0]).value }) : null;
    const limit = any.limit;
    const breaks = pass.filter((r) => (dir === 'min' ? get(r).value < get(r).limit - 1e-9 : get(r).value > get(r).limit + 1e-9));
    const step = dir === 'min' ? Math.floor(worst.v * 20) / 20 : Math.ceil(worst.v * 20) / 20;
    const proposed = breaks.length ? (name.includes('deviation') ? Math.ceil(worst.v) : step) : null;
    const caught = proposed === null ? null : fail.filter((r) => (dir === 'min' ? get(r).value < proposed : get(r).value > proposed)).length;
    out.push({ name, dir, limit, passBreaking: breaks.length, passTotal: pass.length, worstPass: worst, bestFail: best, proposed, failCaughtAfterReset: caught, failTotal: fail.length });
  }
  return out;
}

// ---------------------------------------------------------------- report

const f2 = (v) => (Number.isFinite(v) ? v.toFixed(3) : String(v));

export function formatReport(res, gates, { date = new Date().toISOString().slice(0, 10), auto = null } = {}) {
  const L = [];
  const count = (g) => res.rows.filter((r) => r.group === g).length;
  L.push(`# Rook v2 grade: calibration report (${date})`, '');
  L.push('Grader-only data. Built by `node scripts/art/v2/grade/calibrate.mjs`. Plan v2 section 4, R3 section 5.', '');
  L.push(`Items: pass-near ${count('pass-near')}, pass-real ${count('pass-real')}, fail-near ${count('fail-near')}, fail-far ${count('fail-far')}, info ${count('info')}. Candidate labels come from the automatic labeler (parts.mjs), target labels from the hand labels (refs/).`, '');
  L.push(`**Measures that separate the groups: ${res.gating.length} of ${res.table.length}. Pass line: at least ${gates.passMeasures}. ${res.gating.length >= gates.passMeasures ? 'PASS.' : 'FAIL: fewer than 4 measures can gate, so Mark gates each facing (plan section 4).'}**`, '');
  L.push('A gate is the middle between the worst should-pass value and the best should-fail value. A measure that does not separate is a report line.', '');
  L.push('How the groups were made: the near copies and the adjacent-facing items carry the hand labels of their reference (what a proxy template would give a candidate). The walk frames (the realistic pass group) are measured part by part, head and torso only, after the alignment on the whole figure, with the automatic labeler. Round 8, rig v2, Hex, Sable and the blob use the automatic labeler. The T1 outputs are not here yet: pass --t1 <dir> with <facing>.png files to add them to the realistic pass group.', '');
  L.push('| Measure | Dir | Start | Worst pass (item) | Best fail (item) | Separates | Near copies only | Pair accuracy | Proposed gate | Role |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const t of res.table)
    L.push(`| ${t.name} | ${t.dir} | ${t.start} | ${f2(t.passWorst.v)} (${t.passWorst.id}) | ${f2(t.failBest.v)} (${t.failBest.id}) | ${t.separates ? 'yes' : 'no'} | ${t.separatesNearOnly ? 'yes' : 'no'} | ${(t.pairAccuracy * 100).toFixed(1)}% | ${t.gate === null ? 'none' : f2(t.gate)} | ${t.separates ? 'gate' : 'report'} |`);
  const sep = res.table.filter((t) => t.separates);
  const notSep = res.table.filter((t) => !t.separates);
  L.push('', '### Reading the table', '');
  for (const t of sep) L.push(`- ${t.name}: gates. Worst pass ${f2(t.passWorst.v)} (${t.passWorst.id}), best fail ${f2(t.failBest.v)} (${t.failBest.id}), a margin of ${f2(t.margin)}. ${t.margin < 0.05 ? 'The margin is thin: a few more realistic items can close it.' : ''}`);
  for (const t of notSep) L.push(`- ${t.name}: report line. The best should-fail item ${t.failBest.id} (${f2(t.failBest.v)}) is at least as good as the worst should-pass item ${t.passWorst.id} (${f2(t.passWorst.v)}).`);
  if (auto) {
    L.push('', `Label sensitivity: when every candidate is labeled by the automatic labeler (no hand labels for the near copies and adjacent facings), ${auto.gating.length} measures separate (${auto.gating.join(', ') || 'none'}). The numbers above assume template-quality labels on the candidate. Without a template, expect the part-based measures (part mIoU, smallest part, PCK, texture) to be noisier.`);
  }
  L.push('', '## Hard lines on the calibration set', '', `Distinct-facing line: N = ${res.distinct.n}. ${res.distinct.note}. Smallest pair: ${res.distinct.min.a} against ${res.distinct.min.b}, ${res.distinct.min.cells} cells.`, '');
  L.push('A line that fails a should-pass item is re-set before round 1 (plan section 4). Each facing is checked against the given-based lines of target.json; the reference facings are not walk frames, so some given-based lines fail them.', '', '| Line | Fails should-pass items | Catches should-fail items |', '|---|---|---|');
  for (const h of res.hardLines) L.push(`| ${h.id} ${h.line} | ${h.failsShouldPass.length ? h.failsShouldPass.join(', ') : 'none'} | ${h.catchesShouldFail} of ${h.shouldFailTotal} |`);
  const caught = res.lineRows.filter((r) => (r.group === 'fail-near' || r.group === 'fail-far') && !r.pass).length;
  const failItems = res.lineRows.filter((r) => r.group === 'fail-near' || r.group === 'fail-far').length;
  const sp = (rows) => rows.filter((r) => r.group === 'pass-near' || r.group === 'pass-real');
  const sf = (rows) => rows.filter((r) => r.group === 'fail-near' || r.group === 'fail-far');
  L.push('', `With the plan's lines, the hard lines together fail ${caught} of ${failItems} should-fail items and also fail ${sp(res.lineRows).filter((r) => !r.pass).length} of ${sp(res.lineRows).length} should-pass items. With the proposed re-set applied they fail ${sf(res.lineRowsReset).filter((r) => !r.pass).length} of ${sf(res.lineRowsReset).length} should-fail items and ${sp(res.lineRowsReset).filter((r) => !r.pass).length} of ${sp(res.lineRowsReset).length} should-pass items.`, '');
  const stillFail = sp(res.lineRowsReset).filter((r) => !r.pass);
  if (stillFail.length) L.push('Should-pass items that still fail a line after the re-set: ' + stillFail.map((r) => `${r.id} (${r.failed.join('; ')})`).join(', '), '');
  L.push('', '### Numeric hard lines: limit, worst should-pass value, and the re-set that keeps every should-pass item', '', 'The re-set values are in gates.json (hardLines.reset). They apply only when hardLines.useReset is true. The orphan and small-region lines (1.25x) are lines of the spike exit criteria, so re-setting them is for Mark.', '', '| Line | Limit | Should-pass items over the limit | Worst should-pass (item) | Best should-fail (item) | Proposed re-set | Should-fail items still caught |', '|---|---|---|---|---|---|---|');
  for (const m of res.metricRows)
    L.push(`| ${m.name} | ${m.dir === 'min' ? 'at least' : 'at most'} ${f2(m.limit)} | ${m.passBreaking} of ${m.passTotal} | ${f2(m.worstPass.v)} (${m.worstPass.id}) | ${m.bestFail ? `${f2(m.bestFail.v)} (${m.bestFail.id})` : 'n/a'} | ${m.proposed === null ? 'none needed' : f2(m.proposed)} | ${m.failCaughtAfterReset === null ? 'n/a' : `${m.failCaughtAfterReset} of ${m.failTotal}`} |`);
  L.push('', '## Items', '', '| Item | Group | Align s,dx,dy | BF1 | mIoU | min part | chamfer | p95 | value r | color | EMD | PCK | head PCK | texture | hard lines |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of res.rows) {
    const m = r.measures;
    const hl = res.lineRows.find((x) => x.id === r.id);
    L.push(`| ${r.id} | ${r.group} | ${r.transform.s},${r.transform.dx},${r.transform.dy} | ${f2(m.bf1)} | ${f2(m.partMiou)} | ${f2(m.partMin)} | ${f2(m.chamferMean)} | ${f2(m.chamferP95)} | ${f2(m.valueR)} | ${f2(m.colorMatch)} | ${f2(m.paletteEmd)} | ${f2(m.pck)} | ${f2(m.pckHead)} | ${f2(m.textureMax)} | ${hl?.pass ? 'pass' : `fail: ${hl?.failed.length}`} |`);
  }
  return `${L.join('\n')}\n`;
}

/** Write the calibrated gates into gates.json. */
export function writeGates(res, gates, { date = new Date().toISOString().slice(0, 10), path = GATES_PATH } = {}) {
  const g = JSON.parse(JSON.stringify(gates));
  for (const t of res.table) {
    g.targetMeasures[t.key].calibrated = t.gate === null ? null : Number(t.gate.toFixed(4));
    g.targetMeasures[t.key].role = t.separates ? 'gate' : 'report';
    g.targetMeasures[t.key].worstPass = Number(t.passWorst.v.toFixed(4));
    g.targetMeasures[t.key].bestFail = Number(t.failBest.v.toFixed(4));
  }
  g.hardLines.distinctN = res.distinct.n;
  g.hardLines.calibrated = Object.fromEntries(res.metricRows.filter((m) => m.proposed !== null).map((m) => [m.name, { limit: m.limit, proposedReset: m.proposed, shouldPassOver: m.passBreaking, shouldFailStillCaught: m.failCaughtAfterReset }]));
  g.hardLines.reset = res.reset;
  g.hardLines.useReset = g.hardLines.useReset ?? false;
  g.calibratedOn = date;
  g.calibration = { gating: res.gating, gatingCount: res.gating.length, passLine: g.passMeasures, items: Object.fromEntries(['pass-near', 'pass-real', 'fail-near', 'fail-far', 'info'].map((k) => [k, res.rows.filter((r) => r.group === k).length])) };
  writeFileSync(path, `${JSON.stringify(g, null, 2)}\n`);
  return g;
}

function main() {
  const a = process.argv.slice(2);
  const opt = (n, d = null) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
  const gates = loadGates();
  const res = runCalibration({ gates, t1Dir: opt('--t1'), log: a.includes('--verbose') ? console.log : () => {} });
  const auto = runCalibration({ gates, t1Dir: opt('--t1'), autoLabels: true });
  const report = formatReport(res, gates, { auto });
  const out = opt('--out');
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, report);
    console.log(`report: ${out}`);
  } else console.log(report);
  if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify({ table: res.table, gating: res.gating, hardLines: res.hardLines, distinct: res.distinct }, null, 2));
  if (a.includes('--write-gates')) {
    writeGates(res, gates);
    console.log(`gates written: ${GATES_PATH}`);
  }
  console.log(`gating measures: ${res.gating.length} (${res.gating.join(', ')})`);
  process.exit(res.gating.length >= gates.passMeasures ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

