// score.mjs (orchestrator only, never copied to writer-in). Score a candidate head against the given frame.
// Usage: node score.mjs <candidate.png|grid.txt> [--given path] [--json] [--mode head|frame|both]
//        node score.mjs --baselines [--given path] [--round8 path] [--json]
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  clusterStats, colorAt, colorsOf, edgePixels, isOpaque, luminance, orphans, smallRegionsPosterized,
} from '../metrics.mjs';
import {
  BOX, FAMILIES, FAMILY_NAMES, FAMILY_OF_LETTER, HEX_OF, crop, gridToImage, letterAt, newImage, paletteJson, parseGrid,
  px, readPng, setPx,
} from './lib.mjs';

export const R3 = 'C:/Users/markh/AppData/Local/Temp/rook-step3';
export const GIVEN = `${R3}/input/given.png`;
export const ROUND8_DOWN = `${R3}/round-8/facings/down.png`;
const NB = paletteJson.nearBlack.map((h) => h.toLowerCase());

// ---- loading ----
export function loadImage(path) {
  if (/\.png$/i.test(path)) return readPng(path);
  return gridToImage(parseGrid(readFileSync(path, 'utf8')));
}
export function toBox(img) {
  if (img.w === BOX.w && img.h === BOX.h) return img;
  if (img.w === 32 && img.h === 32) return crop(img, BOX.x, BOX.y, BOX.w, BOX.h);
  throw new Error(`image is ${img.w}x${img.h}: need 16x14 or 32x32`);
}
export function toFrame(img) {
  if (img.w === 32 && img.h === 32) return img;
  if (img.w === BOX.w && img.h === BOX.h) {
    const f = newImage(32, 32);
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) setPx(f, BOX.x + x, BOX.y + y, px(img, x, y));
    return f;
  }
  throw new Error(`image is ${img.w}x${img.h}: need 16x14 or 32x32`);
}

// ---- measures ----
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const step4 = (rgb) => Math.min(3, Math.floor(luminance(rgb) / 64));
const rgbAt = (img, x, y) => [...px(img, x, y)].slice(0, 3);
export function measure(img, comp = img, off = [0, 0]) {
  let opaque = 0, pairs = 0, interior = 0, interiorNB = 0;
  const nbSet = new Set(NB);
  const hist = [0, 0, 0, 0];
  const fam = Object.fromEntries(FAMILY_NAMES.map((f) => [f, 0]));
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      if (!isOpaque(img, x, y)) continue;
      opaque++;
      const c = colorAt(img, x, y);
      hist[step4(rgbAt(img, x, y))]++;
      const l = letterAt(img, x, y);
      if (l !== '?' && l !== '.') fam[FAMILY_OF_LETTER[l]]++;
      for (const [dx, dy] of [[1, 0], [0, 1]])
        if (isOpaque(img, x + dx, y + dy) && colorAt(img, x + dx, y + dy) !== c) pairs++;
      if (N4.every(([dx, dy]) => isOpaque(comp, off[0] + x + dx, off[1] + y + dy))) {
        interior++;
        if (nbSet.has(c)) interiorNB++;
      }
    }
  const cs = clusterStats(img);
  const inBox = ([x, y]) => x >= off[0] && y >= off[1] && x < off[0] + img.w && y < off[1] + img.h;
  const edgePx = edgePixels(comp).filter(inBox);
  const edgeNBn = edgePx.filter(([x, y]) => nbSet.has(colorAt(comp, x, y))).length;
  const o = opaque || 1;
  return {
    opaque,
    colors: colorsOf(img).length,
    T: pairs / o,
    pairs,
    S: cs.small / o,
    smallComps: cs.small,
    comps: cs.regions,
    largestComp: cs.max,
    orphans: orphans(comp).filter(inBox).length,
    D: interior ? interiorNB / interior : 0,
    interior,
    edgeNB: edgePx.length ? edgeNBn / edgePx.length : 1,
    posterSmall: smallRegionsPosterized(img),
    hist: hist.map((h) => h / o),
    ramps: Object.fromEntries(FAMILY_NAMES.map((f) => [f, fam[f] / o])),
  };
}

const shiftImg = (img, dx, dy) => {
  const out = newImage(img.w, img.h);
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const sx = x - dx, sy = y - dy;
      if (sx >= 0 && sy >= 0 && sx < img.w && sy < img.h) setPx(out, x, y, px(img, sx, sy));
    }
  return out;
};
const sameCell = (a, b, x, y) => {
  const la = letterAt(a, x, y), lb = letterAt(b, x, y);
  return la === lb && la !== '?';
};
const famIdx = (l) => FAMILIES[FAMILY_OF_LETTER[l]].indexOf(l);
const tolCell = (a, b, x, y) => {
  const la = letterAt(a, x, y), lb = letterAt(b, x, y);
  if (la === '.' || lb === '.') return la === lb;
  if (la === '?' || lb === '?') return false;
  return FAMILY_OF_LETTER[la] === FAMILY_OF_LETTER[lb] && Math.abs(famIdx(la) - famIdx(lb)) <= 1;
};
const share = (a, b, fn) => {
  let n = 0;
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) if (fn(a, b, x, y)) n++;
  return { n, total: a.w * a.h, pct: (100 * n) / (a.w * a.h) };
};
export function matches(cand, ref) {
  const exact0 = share(cand, ref, sameCell);
  let best = { ...exact0, shift: [0, 0] };
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const s = share(shiftImg(cand, dx, dy), ref, sameCell);
      if (s.n > best.n) best = { ...s, shift: [dx, dy] };
    }
  const tol = share(cand, ref, tolCell);
  let iu = 0, un = 0;
  for (let y = 0; y < ref.h; y++)
    for (let x = 0; x < ref.w; x++) {
      const a = isOpaque(cand, x, y), b = isOpaque(ref, x, y);
      if (a && b) iu++;
      if (a || b) un++;
    }
  return { exact: exact0, exactShift: best, tolerant: tol, iou: un ? iu / un : 1 };
}

// ---- bands and report ----
const rng = (v, lo, hi) => v >= lo && v <= hi;
/**
 * cand and ref are same-size images (box or frame). In head mode the neighbor rules of edge, interior and orphans look
 * outside the box into the given frame (the candidate box is pasted into a copy of the given frame), as the plan's
 * numbers do. T, S, colors, histogram and ramps use box cells only.
 */
export function evaluate(cand, ref, mode, givenFrame = null) {
  let mc = measure(cand), rc = measure(ref);
  if (mode === 'head' && givenFrame) {
    const comp = toFrame(givenFrame);
    const candComp = newImage(32, 32);
    candComp.data.set(comp.data);
    for (let y = 0; y < BOX.h; y++) for (let x = 0; x < BOX.w; x++) setPx(candComp, BOX.x + x, BOX.y + y, px(cand, x, y));
    mc = measure(cand, candComp, [BOX.x, BOX.y]);
    rc = measure(ref, comp, [BOX.x, BOX.y]);
  }
  const m = mc, r = rc, mt = matches(cand, ref);
  const head = mode === 'head';
  const tsLo = [0.8, 0.7], tsHi = [1.2, 1.3]; // T 0.8x to 1.2x, S 0.7x to 1.3x of the reference, in both modes
  const rampTol = head ? 0.06 : 0.12;
  const l1 = m.hist.reduce((s, v, i) => s + Math.abs(v - r.hist[i]), 0);
  const rampDiff = Object.fromEntries(FAMILY_NAMES.map((f) => [f, m.ramps[f] - r.ramps[f]]));
  const rows = [];
  const add = (name, value, band, pass, extra = '') => rows.push({ name, value, band, pass, extra });
  add('opaque', m.opaque, `ref ${r.opaque}`, null);
  add('T color changes/opaque', +m.T.toFixed(3), `${(tsLo[0] * r.T).toFixed(2)} to ${(tsHi[0] * r.T).toFixed(2)} (ref ${r.T.toFixed(2)})`, rng(m.T, tsLo[0] * r.T, tsHi[0] * r.T), `${m.pairs} changes`);
  add('S 1-2px comps/opaque', +m.S.toFixed(3), `${(tsLo[1] * r.S).toFixed(2)} to ${(tsHi[1] * r.S).toFixed(2)} (ref ${r.S.toFixed(2)}, ${r.smallComps} of ${r.comps})`, rng(m.S, tsLo[1] * r.S, tsHi[1] * r.S), `${m.smallComps} of ${m.comps} comps, largest ${m.largestComp}`);
  add('S posterized small regions', m.posterSmall, `${(tsLo[1] * r.posterSmall).toFixed(0)} to ${(tsHi[1] * r.posterSmall).toFixed(0)} (ref ${r.posterSmall})`, rng(m.posterSmall, tsLo[1] * r.posterSmall, tsHi[1] * r.posterSmall));
  add('orphans', m.orphans, `${(0.5 * r.orphans).toFixed(1)} to ${(1.5 * r.orphans).toFixed(1)} (ref ${r.orphans})`, rng(m.orphans, 0.5 * r.orphans, 1.5 * r.orphans));
  add('D interior near-black', +m.D.toFixed(3), `${(r.D - 0.08).toFixed(2)} to ${(r.D + 0.08).toFixed(2)} (ref ${r.D.toFixed(2)})`, Math.abs(m.D - r.D) <= 0.08, `interior ${m.interior}`);
  add('edge near-black', +m.edgeNB.toFixed(3), '>= 0.93', m.edgeNB >= 0.93);
  add('colors used', m.colors, `${r.colors - 3} to ${r.colors + 2} (ref ${r.colors})`, rng(m.colors, r.colors - 3, r.colors + 2));
  add('value hist L1', +l1.toFixed(3), '<= 0.15', l1 <= 0.15, `hist ${m.hist.map((v) => v.toFixed(2)).join(' / ')}, ref ${r.hist.map((v) => v.toFixed(2)).join(' / ')}`);
  add('ramp shares', FAMILY_NAMES.map((f) => `${f} ${m.ramps[f].toFixed(2)}`).join(', '), `each within ${rampTol} of ref`, FAMILY_NAMES.every((f) => Math.abs(rampDiff[f]) <= rampTol), `ref ${FAMILY_NAMES.map((f) => r.ramps[f].toFixed(2)).join(' / ')}`);
  add('silhouette IoU', +mt.iou.toFixed(3), '>= 0.90', mt.iou >= 0.9);
  add('exact match %, no shift', +mt.exact.pct.toFixed(1), 'pass >= 85, weak 65-84', mt.exact.pct >= 85, `${mt.exact.n} of ${mt.exact.total}`);
  add('exact match %, best +-1 shift', +mt.exactShift.pct.toFixed(1), 'reported', null, `shift ${mt.exactShift.shift.join(',')}`);
  add('ramp-tolerant match %', +mt.tolerant.pct.toFixed(1), 'pass >= 93', mt.tolerant.pct >= 93, `${mt.tolerant.n} of ${mt.tolerant.total}`);
  return { mode, measures: m, ref: r, matches: mt, rows };
}
export function format(ev, title = '') {
  const lines = [`== ${title ? `${title} ` : ''}${ev.mode.toUpperCase()} MODE ==`];
  for (const r of ev.rows) {
    const tag = r.pass === null ? '    ' : r.pass ? 'PASS' : 'FAIL';
    lines.push(`${tag}  ${r.name}: ${r.value}   [band ${r.band}]${r.extra ? `  (${r.extra})` : ''}`);
  }
  return lines.join('\n');
}
/** Score a candidate image against the given frame in a mode ('head' or 'frame'). */
export function scoreImage(candImg, givenImg, mode) {
  return mode === 'head'
    ? evaluate(toBox(candImg), toBox(givenImg), 'head', givenImg)
    : evaluate(toFrame(candImg), toFrame(givenImg), 'frame');
}
const compact = (ev) => ({
  exact: +ev.matches.exact.pct.toFixed(1), exactShift: +ev.matches.exactShift.pct.toFixed(1), tolerant: +ev.matches.tolerant.pct.toFixed(1),
  T: +ev.measures.T.toFixed(2), S: +ev.measures.S.toFixed(2), orphans: ev.measures.orphans, D: +ev.measures.D.toFixed(2), colors: ev.measures.colors,
});

// ---- baselines ----
export function flatten(img) {
  const out = newImage(img.w, img.h);
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const l = letterAt(img, x, y);
      if (l === '.' || l === '?') continue;
      const fam = FAMILIES[FAMILY_OF_LETTER[l]];
      const h = HEX_OF[fam[Math.floor(fam.length / 2)]];
      setPx(out, x, y, [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)).concat(255));
    }
  return out;
}
/** Verdict lines (head mode): the flattened-baseline check and PASS / VIABLE / FAIL on exact and ramp-tolerant match. Features and grader picks are outside the script. */
export function verdictOf(candImg, givenImg) {
  const ev = scoreImage(candImg, givenImg, 'head');
  const ref = toBox(givenImg);
  const flat = evaluate(flatten(ref), ref, 'head', givenImg).matches.exact.pct;
  const ex = ev.matches.exact.pct, tol = ev.matches.tolerant.pct;
  const beatsFlat = ex >= flat + 30;
  const verdict = ex >= 85 && tol >= 93 ? 'PASS' : ex >= 65 ? 'VIABLE' : 'FAIL';
  return {
    flattenedExact: +flat.toFixed(1), exact: +ex.toFixed(1), tolerant: +tol.toFixed(1), beatsFlattenedBy30: beatsFlat, verdict,
    lines: [
      `${beatsFlat ? 'PASS' : 'FAIL'}  beats flattened baseline by 30 points: exact ${ex.toFixed(1)} vs flattened ${flat.toFixed(1)} (needs >= ${(flat + 30).toFixed(1)})`,
      `VERDICT ${verdict}  (exact ${ex.toFixed(1)}, ramp-tolerant ${tol.toFixed(1)}; PASS needs exact >= 85 and tolerant >= 93, VIABLE exact 65 to 84, FAIL under 65; must features and grader picks are judged outside this script)`,
    ],
  };
}

export function baselines(givenImg, round8Path) {
  const ref = toBox(givenImg);
  const sets = {
    'all-transparent box': newImage(BOX.w, BOX.h),
    'given head, every family flattened to its middle color': flatten(ref),
    'round 8 down head (box crop)': toBox(readPng(round8Path)),
  };
  return Object.fromEntries(Object.entries(sets).map(([k, img]) => [k, evaluate(img, ref, 'head', givenImg)]));
}

// ---- CLI ----
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
  const json = a.includes('--json');
  const givenImg = readPng(opt('--given', GIVEN));
  if (a.includes('--baselines')) {
    const b = baselines(givenImg, opt('--round8', ROUND8_DOWN));
    if (json) console.log(JSON.stringify(Object.fromEntries(Object.entries(b).map(([k, v]) => [k, { ...compact(v), rows: v.rows }])), null, 2));
    else for (const [k, v] of Object.entries(b)) console.log(`${format(v, k)}\n`);
    process.exit(0);
  }
  const path = a.find((x, i) => !x.startsWith('--') && !['--given', '--mode', '--round8'].includes(a[i - 1]));
  if (!path) {
    console.error('usage: node score.mjs <candidate.png|grid.txt> [--given path] [--mode head|frame|both] [--json] | --baselines');
    process.exit(2);
  }
  const cand = loadImage(path);
  const mode = opt('--mode', 'both');
  const evs = (mode === 'both' ? ['head', 'frame'] : [mode]).map((m) => scoreImage(cand, givenImg, m));
  const vd = verdictOf(cand, givenImg);
  if (json) console.log(JSON.stringify({ ...Object.fromEntries(evs.map((e) => [e.mode, { measures: e.measures, ref: e.ref, matches: e.matches, rows: e.rows }])), verdict: { ...vd, lines: undefined } }, null, 2));
  else console.log(`${evs.map((e) => format(e)).join('\n\n')}\n\n${vd.lines.join('\n')}`);
}
