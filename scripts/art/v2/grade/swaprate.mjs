// The C6 swap line as code (consult C2 C6: "rule checks pass on the 5 references and fail on swapped facings in at least 90 percent of items").
//   node scripts/art/v2/grade/swaprate.mjs [--out <report.md>]
// The pictures are the 5 Sprite Fusion references (s, n, ne, nw, sw, each at its own facing) and the given (se). Each picture is graded by the structure
// tier as each OTHER facing of those six: 6 x 5 = 30 swaps. A swap is caught when the structure tier fails. The rate is caught / swaps.
// Two more report lines: the cross-class rate (swaps between facing classes) and the within-class rate. The facing classes are the facings
// that share the C1 eye and hand rules; inside a class the structure rules cannot tell the facings apart, and the blind facing-ID grader (9 of 10 on
// calibration) covers that. The 90 percent line is not moved: it is recorded as MET or FAILED with the missed pairs.
// Grader side: it reads the references. The writers' code never imports this file.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { candidateFromRef } from './calibrate.mjs';
import { structureTier } from './grade.mjs';
import { checkHardLines, loadGates, loadSpec } from './hardlines.mjs';
import { loadFacingChecks } from './structure.mjs';
import { REF_FACINGS, loadReference } from './refs/labels.mjs';

/** The six pictures: the given at se and the five references. */
export const SWAP_FACINGS = ['se', ...REF_FACINGS];
/** Facings that share the C1 eye and hand rules (front: one or two eye clusters; back: no eye at all; the hand-count rules overlap inside each class). */
export const FACING_CLASSES = { front: ['s', 'se', 'sw'], back: ['n', 'ne', 'nw'] };
const classOf = (f) => Object.entries(FACING_CLASSES).find(([, list]) => list.includes(f))?.[0];

/** The structure verdict of one picture graded as one facing. */
function structureAs(pic, facing, { spec, gates, checks }) {
  const hard = checkHardLines(pic.img, { facing, spec, gates, labels: pic.labels, template: true, name: facing });
  const t = structureTier(pic.img, { facing, spec, hard, labels: pic.labels, gates, checks });
  return { pass: t.pass, failed: t.items.filter((i) => i.status === 'fail').map((i) => i.id) };
}

const rate = (caught, total) => (total ? caught / total : null);

/** Compute the swap rates. Returns { swaps, caught, rate, cross, within, missed, own, line, met }. */
export function swapRates({ spec = loadSpec(), gates = loadGates(), checks = loadFacingChecks() } = {}) {
  const pics = { se: { img: spec.given, labels: spec.givenLabels } };
  for (const f of REF_FACINGS) pics[f] = candidateFromRef(loadReference(f), spec);
  const ctx = { spec, gates, checks };
  const swaps = [];
  const own = [];
  for (const from of SWAP_FACINGS) {
    const o = structureAs(pics[from], from, ctx);
    own.push({ facing: from, pass: o.pass, failed: o.failed });
    for (const as of SWAP_FACINGS) {
      if (as === from) continue;
      const r = structureAs(pics[from], as, ctx);
      swaps.push({ from, as, caught: !r.pass, failed: r.failed, cross: classOf(from) !== classOf(as) });
    }
  }
  const count = (list) => list.filter((s) => s.caught).length;
  const cross = swaps.filter((s) => s.cross);
  const within = swaps.filter((s) => !s.cross);
  const line = gates.swapLine?.need ?? 0.9;
  const r = rate(count(swaps), swaps.length);
  return {
    swaps: swaps.length,
    caught: count(swaps),
    rate: r,
    cross: { swaps: cross.length, caught: count(cross), rate: rate(count(cross), cross.length) },
    within: { swaps: within.length, caught: count(within), rate: rate(count(within), within.length) },
    missed: swaps.filter((s) => !s.caught).map((s) => `${s.from}->${s.as}`),
    own,
    line,
    met: r !== null && r >= line - 1e-9,
  };
}

const pct = (v) => (v === null ? 'n/a' : `${(v * 100).toFixed(0)} percent`);

export function formatSwapReport(res, { date = new Date().toISOString().slice(0, 10) } = {}) {
  const L = [`# Rook v2 grade: swapped-facing rate (${date})`, '', 'Consult C2 C6. Pictures: the given (se) and the 5 references (s, n, ne, nw, sw). Each is graded by the structure tier as each other facing of the six. A swap is caught when the structure tier fails.', ''];
  L.push(`**Swap rate: ${res.caught} of ${res.swaps} caught = ${pct(res.rate)}. Line: at least ${pct(res.line)}. ${res.met ? 'MET' : 'FAILED'}.**`, '');
  L.push(`Cross-class swaps (between ${Object.keys(FACING_CLASSES).join(' / ')}): ${res.cross.caught} of ${res.cross.swaps} = ${pct(res.cross.rate)}.`);
  L.push(`Within-class swaps (${Object.entries(FACING_CLASSES).map(([k, v]) => `${k} ${v.join(' ')}`).join('; ')}): ${res.within.caught} of ${res.within.swaps} = ${pct(res.within.rate)}. The blind facing-ID grader carries these (s/se/sw and n/ne/nw).`);
  L.push(`Missed swaps (picture->graded as): ${res.missed.join(', ') || 'none'}.`, '');
  L.push('Rule checks at the own facing (the six pictures):');
  for (const o of res.own) L.push(`- ${o.facing}: ${o.pass ? 'pass' : `FAIL ${o.failed.join(', ')}`}`);
  return `${L.join('\n')}\n`;
}

function main() {
  const a = process.argv.slice(2);
  const out = a.includes('--out') ? a[a.indexOf('--out') + 1] : null;
  try {
    const res = swapRates();
    const report = formatSwapReport(res);
    if (out) {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, report);
      console.log(`report: ${out}`);
    } else console.log(report);
    process.exit(res.met ? 0 : 1);
  } catch (e) {
    console.error(`swaprate: ${e.message}`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
