// Stage A: decompose the given frame into parts, lock each part's ramps, measure each part's motif numbers.
//   node scripts/art/pipeline/decompose.mjs [--out dir] [--write-target]
// A part map is { w, h, parts: { <part>: [cell index, ...] } }, cell index = y * w + x.
// Rules (letter family + region box, first match wins) run first, then overrides.json. Hard line: every opaque pixel is in exactly one part.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isOpaque, orphans } from '../metrics.mjs';
import { FAMILY_OF_LETTER, drawText, letterAt, newImage, px, setPx, writePng, zoomGrid } from '../headtest/lib.mjs';
import { measure } from '../headtest/score.mjs';
import { OUT_DIR, ensureDir, loadGiven, writeTargetKey } from './given.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const loadOverrides = () => JSON.parse(readFileSync(`${here}/overrides.json`, 'utf8')).cells;

/** The 13 parts. code = one letter for the printed map. families = the ramp lock (near-black is always allowed). */
export const PARTS = {
  hair: { code: 'H', families: ['hair'] },
  skin: { code: 'F', families: ['skin', 'hair'] }, // face skin; the cheek shadow uses the warm gray 'o' of the steel ramp
  lenses: { code: 'L', families: ['orange-gold'] },
  beard: { code: 'B', families: ['hair'] },
  coat: { code: 'C', families: ['coat'] },
  sleeves: { code: 'S', families: ['coat'] },
  zipper: { code: 'Z', families: ['hair'] }, // the steel strip between two near-black lines
  hands: { code: 'N', families: ['skin', 'orange-gold'] }, // the right cuff wrap is a brown-amber letter
  legs: { code: 'G', families: [] },
  boots: { code: 'T', families: [] },
  sheath: { code: 'K', families: ['orange-gold', 'hair'] },
  guard: { code: 'U', families: ['orange-gold'] },
  wrap: { code: 'W', families: [] },
};
export const PART_NAMES = Object.keys(PARTS);
export const SHEATH_PARTS = ['sheath', 'guard', 'wrap'];
export const HEAD_PARTS = ['hair', 'skin', 'lenses', 'beard'];
export const SIZE = 32;

const NB = ['near-black'];
const GOLD = ['near-black', 'orange-gold'];
const R = (part, box, fam = null, letters = null) => ({ part, box, fam, letters });
/** Ordered rules. box = [x0, y0, x1, y1] inclusive. fam = allowed letter families, letters = allowed letters (null = any). */
export const RULES = [
  // katana hilt, left of the head
  R('guard', [5, 5, 11, 12], null, 'q'),
  R('wrap', [5, 5, 11, 12], null, 'e'),
  R('sheath', [5, 5, 11, 12], null, 'l'),
  R('sheath', [5, 5, 10, 12]),
  // hands and cuffs
  R('hands', [7, 21, 10, 24]),
  R('hands', [24, 21, 27, 24]),
  // the steel strip down the middle of the coat
  R('zipper', [18, 15, 20, 24]),
  // head: crown first, then skin, goggles, beard, then the hair sides
  R('hair', [0, 0, 31, 4]),
  R('skin', [11, 5, 24, 13], ['skin']),
  R('skin', [12, 9, 16, 12], null, 'o'),
  R('lenses', [17, 7, 23, 7], GOLD),
  R('lenses', [14, 8, 23, 8], GOLD),
  R('lenses', [16, 9, 23, 9], GOLD),
  R('lenses', [17, 10, 22, 10], NB),
  R('beard', [17, 11, 21, 13], null, 'o'),
  R('beard', [17, 13, 21, 13]),
  R('hair', [11, 5, 24, 8], ['hair']),
  R('hair', [11, 5, 15, 10], NB),
  R('hair', [22, 5, 24, 6], NB),
  R('skin', [22, 11, 24, 12], NB),
  R('coat', [11, 11, 16, 12], NB),
  // arms
  R('sleeves', [8, 15, 12, 24]),
  R('sleeves', [23, 15, 26, 20]),
  R('sleeves', [23, 21, 23, 24]),
  // legs and boots
  R('legs', [0, 26, 31, 27]),
  R('boots', [0, 28, 31, 30]),
  // everything left on the torso
  R('coat', [0, 11, 31, 25]),
];

const matchRule = (img, x, y, r) => {
  const [x0, y0, x1, y1] = r.box;
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const l = letterAt(img, x, y);
  if (r.letters && !r.letters.includes(l)) return false;
  if (r.fam && !r.fam.includes(FAMILY_OF_LETTER[l])) return false;
  return true;
};

/** Build the part map from rules, then overrides. A cell no rule or override claims stays unassigned (validatePartMap reports it). */
export function buildPartMap(img, overrides = loadOverrides()) {
  const parts = Object.fromEntries(PART_NAMES.map((p) => [p, []]));
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      if (!isOpaque(img, x, y)) continue;
      const o = overrides[`${x},${y}`];
      const hit = o ? { part: o } : RULES.find((r) => matchRule(img, x, y, r));
      if (hit) parts[hit.part].push(y * img.w + x);
    }
  return { w: img.w, h: img.h, parts };
}

/** Array(w*h) of the part names that hold each cell (an empty list for a cell no part holds). */
export function labelsOf(pm) {
  const out = Array.from({ length: pm.w * pm.h }, () => []);
  for (const [name, cells] of Object.entries(pm.parts)) for (const i of cells) out[i]?.push(name);
  return out;
}
/** The single part of a cell, or null. */
export function partAt(pm, x, y, labels = labelsOf(pm)) {
  const l = labels[y * pm.w + x] ?? [];
  return l.length === 1 ? (l[0] ?? null) : null;
}
export const xyOf = (pm, i) => [i % pm.w, Math.floor(i / pm.w)];

/** Ramp lock violations: a cell whose letter family is neither near-black nor in the part's families. */
export function rampLockViolations(img, pm) {
  const out = [];
  for (const [name, cells] of Object.entries(pm.parts)) {
    const spec = PARTS[name];
    if (!spec) continue;
    for (const i of cells) {
      const [x, y] = xyOf(pm, i);
      const l = letterAt(img, x, y);
      if (l === '.') continue; // a part that holds a transparent cell is reported by label-on-transparent
      const fam = FAMILY_OF_LETTER[l];
      if (fam !== 'near-black' && !spec.families.includes(fam)) out.push({ name: 'ramp-lock', part: name, x, y, letter: l });
    }
  }
  return out;
}

/**
 * Hard line A: every opaque pixel is in exactly one part, in a known part, inside that part's ramp lock, and where the rules and overrides put it.
 * Returns { ok, violations } and each violation has a name: unassigned, multi-assigned, label-on-transparent, unknown-part, ramp-lock, rule-mismatch.
 */
export function validatePartMap(img, pm, { rules = true } = {}) {
  const violations = [];
  for (const name of Object.keys(pm.parts)) if (!PARTS[name]) violations.push({ name: 'unknown-part', part: name });
  const labels = labelsOf(pm);
  const expected = rules ? labelsOf(buildPartMap(img)) : null;
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const names = labels[y * img.w + x] ?? [];
      if (!isOpaque(img, x, y)) {
        if (names.length) violations.push({ name: 'label-on-transparent', x, y, parts: names });
        continue;
      }
      if (names.length === 0) violations.push({ name: 'unassigned', x, y });
      else if (names.length > 1) violations.push({ name: 'multi-assigned', x, y, parts: names });
      else if (expected && expected[y * img.w + x]?.[0] !== names[0]) violations.push({ name: 'rule-mismatch', x, y, part: names[0], expected: expected[y * img.w + x]?.[0] ?? null });
    }
  violations.push(...rampLockViolations(img, pm));
  return { ok: violations.length === 0, violations };
}

// ---- motif numbers ----
/** An image holding only the listed cells of comp. */
export function cellsImage(comp, cells) {
  const out = newImage(comp.w, comp.h);
  for (const i of cells) setPx(out, i % comp.w, Math.floor(i / comp.w), px(comp, i % comp.w, Math.floor(i / comp.w)));
  return out;
}
/**
 * T, S, D, orphans of a set of cells. T and S count only inside the set. D and orphans look at the neighbors in comp (the same rule as the head test box).
 * Reuses headtest/score.mjs measure(), then counts orphans inside the set only (measure counts every orphan of comp).
 */
export function measureCells(comp, cells) {
  const m = measure(cellsImage(comp, cells), comp, [0, 0]);
  const set = new Set(cells);
  return { ...m, orphans: orphans(comp).filter(([x, y]) => set.has(y * comp.w + x)).length };
}
/** Horizontal runs of one letter inside the set: longest run and a histogram { length: count }. */
export function runStats(comp, cells) {
  const set = new Set(cells);
  const hist = {};
  let max = 0;
  for (let y = 0; y < comp.h; y++) {
    let len = 0;
    let prev = '';
    for (let x = 0; x <= comp.w; x++) {
      const inSet = x < comp.w && set.has(y * comp.w + x);
      const l = inSet ? letterAt(comp, x, y) : '';
      if (inSet && l === prev) len++;
      else {
        if (len) {
          hist[len] = (hist[len] ?? 0) + 1;
          max = Math.max(max, len);
        }
        len = inSet ? 1 : 0;
      }
      prev = l;
    }
  }
  return { max, hist };
}
const r4 = (v) => Math.round(v * 10000) / 10000;
export const inBox = (b, x, y) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
export function blankBoxImage(img, b) {
  const out = { w: img.w, h: img.h, data: new Uint8Array(img.data) };
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) setPx(out, x, y, [0, 0, 0, 0]);
  return out;
}
/** Motif numbers per part, measured from the given. With blank = a box, the cells inside the box are blanked first and never counted (6a: rules from the cells that remain). */
export function motifOf(img, pm, { blank = null } = {}) {
  const comp = blank ? blankBoxImage(img, blank) : img;
  const out = {};
  for (const [name, all] of Object.entries(pm.parts)) {
    const cells = blank ? all.filter((i) => !inBox(blank, i % img.w, Math.floor(i / img.w))) : all;
    if (!cells.length) {
      out[name] = { cells: 0 };
      continue;
    }
    const m = measureCells(comp, cells);
    const letters = {};
    for (const i of cells) {
      const l = letterAt(comp, i % comp.w, Math.floor(i / comp.w));
      letters[l] = (letters[l] ?? 0) + 1;
    }
    const fams = [...new Set(Object.keys(letters).map((l) => FAMILY_OF_LETTER[l]))].sort();
    out[name] = {
      cells: cells.length, T: r4(m.T), S: r4(m.S), D: r4(m.D), orphans: m.orphans,
      colors: m.colors, runs: runStats(comp, cells), letters, families: fams,
    };
  }
  return out;
}

/**
 * The motif rule data per part, from the measured numbers: letters used, ramp families, longest horizontal same-letter run (maxRun), and T, S, D, orphans.
 * maxRun is measured, not taken from the plan: the plan writes "runs at most 3" for hair, the given measures 4.
 */
export function motifRules(motif) {
  const out = {};
  for (const [part, m] of Object.entries(motif)) {
    if (!m.cells) continue;
    out[part] = { letters: Object.keys(m.letters ?? {}).sort().join(''), families: m.families, maxRun: m.runs?.max, T: m.T, S: m.S, D: m.D, orphans: m.orphans };
  }
  return out;
}

/** Compare stored motif numbers with a fresh measurement: every T, S, D and orphan count within tol (relative; a stored 0 needs a 0). */
export function motifFailures(stored, fresh, tol = 0.05) {
  const out = [];
  for (const [part, s] of Object.entries(stored)) {
    const f = fresh[part];
    if (!f || f.cells !== s.cells) out.push({ name: 'motif-cells', part, stored: s.cells, fresh: f?.cells ?? null });
    if (!f || !s.cells) continue;
    for (const k of ['T', 'S', 'D', 'orphans']) {
      const a = s[k];
      const b = f[k];
      const bad = a === 0 ? b !== 0 : Math.abs(b - a) > tol * Math.abs(a);
      if (bad) out.push({ name: `motif-${k}`, part, stored: a, fresh: b });
    }
  }
  return out;
}

// ---- derived regions the later stages use ----
/**
 * The hair wing: hair cells on the left of the face, from the first face-skin row down.
 * Rows: from the top row of the skin part. Columns: at least 2 left of the first orange lens cell (lens x 17 gives x <= 15). Derived from the part map, not written by hand.
 */
export function hairWing(img, pm) {
  const skinY0 = Math.min(...pm.parts.skin.map((i) => Math.floor(i / pm.w)));
  const lensX0 = Math.min(...pm.parts.lenses.filter((i) => FAMILY_OF_LETTER[letterAt(img, i % pm.w, Math.floor(i / pm.w))] === 'orange-gold').map((i) => i % pm.w));
  return pm.parts.hair.filter((i) => Math.floor(i / pm.w) >= skinY0 && (i % pm.w) <= lensX0 - 2);
}

/** Part map as rows of one code letter per cell ('.' transparent, '*' a cell in two parts). */
export function partRows(pm) {
  const labels = labelsOf(pm);
  return Array.from({ length: pm.h }, (_, y) =>
    Array.from({ length: pm.w }, (_, x) => {
      const l = labels[y * pm.w + x] ?? [];
      return l.length === 0 ? '.' : l.length === 1 ? (PARTS[l[0] ?? '']?.code ?? '?') : '*';
    }).join(''),
  );
}
export function partMapFromRows(rows) {
  const byCode = Object.fromEntries(Object.entries(PARTS).map(([n, p]) => [p.code, n]));
  const parts = Object.fromEntries(PART_NAMES.map((p) => [p, []]));
  const w = rows[0]?.length ?? 0;
  rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      const n = byCode[c];
      if (n) parts[n]?.push(y * w + x);
    }),
  );
  return { w, h: rows.length, parts };
}

const PART_COLORS = {
  hair: [150, 160, 170], skin: [240, 170, 130], lenses: [235, 150, 30], beard: [120, 120, 130], coat: [110, 140, 60], sleeves: [70, 110, 50],
  zipper: [90, 130, 200], hands: [230, 110, 110], legs: [120, 90, 170], boots: [80, 60, 120], sheath: [170, 120, 60], guard: [240, 210, 70], wrap: [150, 70, 40],
};
export function renderPartMap(pm) {
  const labels = labelsOf(pm);
  const blank = newImage(pm.w, pm.h);
  return zoomGrid(blank, {
    k: 32, originX: 0, originY: 0,
    flat: (x, y) => {
      const l = labels[y * pm.w + x] ?? [];
      const c = l.length === 1 ? PART_COLORS[l[0] ?? ''] : l.length > 1 ? [255, 0, 255] : null;
      return c ? [...c, 255] : null;
    },
    after: (out, ml, mt, k) => {
      for (let y = 0; y < pm.h; y++)
        for (let x = 0; x < pm.w; x++) {
          const l = labels[y * pm.w + x] ?? [];
          if (l.length === 1) drawText(out, PARTS[l[0] ?? '']?.code ?? '?', ml + x * k + 10, mt + y * k + 13, [20, 20, 26, 255], 2);
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
  const v = validatePartMap(img, pm);
  const motif = motifOf(img, pm);
  const opaque = Object.values(pm.parts).reduce((s, c) => s + c.length, 0);
  console.log(`opaque ${opaque}; validate ${v.ok ? 'PASS' : `FAIL ${JSON.stringify(v.violations.slice(0, 5))}`}`);
  for (const [n, m] of Object.entries(motif)) console.log(`${n.padEnd(8)} ${String(m.cells).padStart(3)} cells  T ${m.T}  S ${m.S}  D ${m.D}  orphans ${m.orphans}  maxRun ${m.runs?.max}  families ${m.families?.join('+')}`);
  ensureDir(out);
  writePng(renderPartMap(pm), `${out}/parts-32x.png`);
  writeFileSync(`${out}/parts.json`, `${JSON.stringify({ rows: partRows(pm), motif }, null, 2)}\n`);
  console.log(`wrote ${out}/parts-32x.png and parts.json`);
  if (a.includes('--write-target')) {
    writeTargetKey('partMap', {
      note: 'Stage A part map of the given frame (walk frame 4). One code letter per cell; codes in decompose.mjs PARTS. Written by decompose.mjs --write-target.',
      codes: Object.fromEntries(PART_NAMES.map((n) => [n, PARTS[n]?.code])),
      rows: partRows(pm),
    });
    writeTargetKey('partMotif', {
      note: 'T, S, D, orphans, runs and letters per part, measured from the given. Written by decompose.mjs --write-target.',
      planDisagreement: 'The plan says hair runs are at most 3. The given measures a longest hair run of 4 (rules.hair.maxRun). The measured value is the rule data.',
      parts: motif,
      rules: motifRules(motif),
    });
    console.log('wrote target.json pipeline.partMap and pipeline.partMotif');
  }
  process.exit(v.ok ? 0 : 1);
}
