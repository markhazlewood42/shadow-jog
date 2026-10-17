// The grade command (plan v2 section 4): one candidate facing, one verdict.
//   node scripts/art/v2/grade/grade.mjs <candidate.png | grid.txt> --facing <s|n|ne|nw|sw|e|w|se>
//        [--set a.png,b.png,...]   the other facings of the set (PA-08 and the distinct-facing line). Name each as name=path, or just a path
//        [--anchor name=path ...]  anchors (round 8 facing, rig v2 facing, code painter): the candidate must beat each one
//        [--template t.png]        the proxy template silhouette (needed for e and w: BF1 against the template)
//        [--parts rows.txt]        the candidate part map as rows of part codes (a template); default is the automatic labeler
//        [--sheath left|right]     the expected sheath side (PA-21 becomes a gate)
//        [--json]
// The verdict has three tiers (consult C2 C4, Amendment 2): (a) style lines against the GIVEN, (b) reference-free structure lines,
// (c) the reference measures against the matching Sprite Fusion reference, as report lines that never gate.
// It measures distance to the target only. It never reads an earlier round, a round number or an earlier score (PA-CM-01).
// Exit code 0 when style and structure pass, 1 otherwise, 2 for a usage error. When fewer than 3 style lines separate, the verdict says Mark gates style by eye.
// A gating style line that could not be measured (S-RAMP without template labels, S-FLAT-GROUP with no large enough group) is "not measured": the style tier does not pass.
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { HEX_OF, LETTERS } from '../../headtest/lib.mjs';
import { readPng, unhex } from '../../pixkit/png.mjs';
import { align } from './align.mjs';
import { pack } from './color.mjs';
import { checkHardLines, hasFail, loadGates, loadSpec } from './hardlines.mjs';
import { N, flipH, flipLabels, setPixel, toCanvas } from './image.mjs';
import { LINE_META, STYLE_LINE_IDS, linePasses, styleValues } from './style.mjs';
import { loadFacingChecks, structureLines } from './structure.mjs';
import { measureAgainst } from './measures.mjs';
import { autoLabel, landmarksOf, rowsToLabels } from './parts.mjs';
import { makeTarget } from './calibrate.mjs';
import { REF_FACINGS, loadReference } from './refs/labels.mjs';

/** Read a candidate: a PNG, or a letter grid (palette letters a to v and '.', optional "NN|" row labels, 32 columns). */
export function loadCandidate(path) {
  if (/\.png$/i.test(path)) return readPng(path);
  const rows = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((l) => /^\s*(?:\d+\s*\|)?([.a-v]+)\s*$/.exec(l)?.[1])
    .filter(Boolean);
  if (!rows.length) throw new Error(`${path}: no grid rows (letters a to v and '.')`);
  const w = Math.max(...rows.map((r) => r.length));
  const img = { w, h: rows.length, data: new Uint8Array(w * rows.length * 4) };
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) if (r[x] !== '.' && LETTERS.includes(r[x])) setPixel(img, x, y, pack(...unhex(HEX_OF[r[x]])));
  });
  return img;
}

/** Candidate parts from a text file of part-code rows. */
export function loadParts(path) {
  const rows = readFileSync(path, 'utf8').split(/\r?\n/).map((l) => l.replace(/^\s*\d+\s*\|/, '').trimEnd()).filter((l) => l.length && /^[.A-Za-z]+$/.test(l));
  const labels = rowsToLabels(rows.map((r) => r.padEnd(N, '.')));
  const out = new Array(N * N).fill(null);
  for (let y = 0; y < Math.min(rows.length, N); y++) for (let x = 0; x < N; x++) out[y * N + x] = labels[y * N + x] ?? null;
  return out;
}

const gateOf = (m) => (m.calibrated !== null && m.calibrated !== undefined ? m.calibrated : m.start);
const passes = (m, v) => (m.dir === 'min' ? v >= gateOf(m) - 1e-9 : v <= gateOf(m) + 1e-9);
const margin = (m, v) => {
  const g = gateOf(m);
  const scale = m.dir === 'min' ? Math.max(1e-6, 1 - g) : Math.max(1e-6, g);
  const d = m.dir === 'min' ? (v - g) / scale : (g - v) / scale;
  return Math.max(-1, Math.min(1, d));
};

/** Gate the measures of one candidate. Returns { rows, gating, reportOnly, pass, passCount, composite }. */
export function gateMeasures(measures, gates) {
  const rows = [];
  for (const [key, m] of Object.entries(gates.targetMeasures)) {
    const v = measures[key];
    const role = m.role ?? 'gate'; // not calibrated yet: the start line gates
    rows.push({ key, name: m.name, dir: m.dir, value: v, gate: gateOf(m), role, calibrated: m.role !== null, pass: passes(m, v) });
  }
  const gating = rows.filter((r) => r.role === 'gate');
  const passCount = gating.filter((r) => r.pass).length;
  const composite = gating.length ? gating.reduce((s, r) => s + margin(gates.targetMeasures[r.key], r.value), 0) / gating.length : 0;
  return { rows, gating: gating.map((r) => r.key), pass: gating.every((r) => r.pass), passCount, gatingCount: gating.length, composite };
}

/** Landmark check for a facing with no reference (e, w): y of the head and feet points against s and ne, within 0.1 x height of at least one of them. */
export function noReferencePck(candLabels, alpha = 0.1) {
  const lm = landmarksOf(candLabels, N, N);
  const names = ['crown', 'chin', 'hem'];
  const refLm = REF_FACINGS.filter((f) => f === 's' || f === 'ne').map((f) => landmarksOf(loadReference(f).labels, 32, 32));
  const H = 31;
  const dist = {};
  let hit = 0;
  for (const n of names) {
    const ys = refLm.map((l) => l[n]?.[1]).filter((y) => y !== undefined);
    const y = lm[n]?.[1];
    const d = y === undefined || !ys.length ? Number.POSITIVE_INFINITY : Math.min(...ys.map((r) => Math.abs(r - y)));
    dist[n] = d;
    if (d <= alpha * H) hit++;
  }
  return { pck: hit / names.length, dist };
}

export const STRUCTURE_HARD_IDS = ['HL-HEIGHT', 'HL-BOTTOM', 'HL-HEAD', 'HL-SHOULDER', 'HL-HIP', 'HL-FACE', 'HL-DISTINCT', 'PA-21'];
/** Lines of the hard-line checker that the style tier keeps next to the S-lines: the color count and the shared palette across the set. */
const isStyleExtra = (i) => (i.id === 'PA-01' && /color count/.test(i.name)) || (i.id === 'PA-08' && /another facing/.test(i.name));

/**
 * The style tier (consult C2 C4): lines against the given, read from gates.style. A line gates when its role is gate: it separated the calibration
 * population (basis "separates"), or it is a line of the spike GO list (basis "go-hard-line"). Only the separating lines count toward the
 * "at least minGating" rule: if fewer than gates.style.minGating lines separate, Mark gates style by eye.
 * A line that could not be measured has the status "not measured". A gating line that is not measured makes the tier not pass.
 * opts.rampLabels: part labels for S-RAMP when the candidate has no template labels (the calibration uses the automatic labeler this way).
 */
export function styleTier(img, { spec, gates, labels = null, template = false, hardItems = [], rampLabels = null }) {
  const sg = gates.style;
  if (!sg) throw new Error('gates.json has no style section: run `node scripts/art/v2/grade/style-calibrate.mjs --write-gates`');
  const v = styleValues(img, { spec, labels, template, flatMinCells: sg.flatMinCells, bands: sg.bands, rampLabels });
  const rows = STYLE_LINE_IDS.map((id) => {
    const cfg = sg.lines[id];
    const meta = LINE_META[id];
    const value = v.values[id];
    const notMeasured = value === null || value === undefined;
    const pass = notMeasured ? false : linePasses(meta, cfg, value);
    return { id, name: meta.name, rule: meta.rule, value, detail: v.detail[id] ?? '', dir: meta.dir, limit: meta.dir === 'band' ? [cfg.lo, cfg.hi] : cfg.limit, role: cfg.role, basis: cfg.basis ?? null, separates: cfg.separates, pinned: cfg.pinned, status: notMeasured ? 'not measured' : pass ? 'pass' : 'fail' };
  });
  const extra = hardItems.filter(isStyleExtra);
  const gatingRows = rows.filter((r) => r.role === 'gate');
  const separating = rows.filter((r) => r.separates).map((r) => r.id);
  const notMeasured = gatingRows.filter((r) => r.status === 'not measured').map((r) => r.id);
  const pass = gatingRows.every((r) => r.status === 'pass') && !hasFail(extra);
  return { rows, extra, gating: gatingRows.map((r) => r.id), separating, minGating: sg.minGating, markGatesByEye: separating.length < sg.minGating, notMeasured, pass, labelSource: v.labelSource };
}

/** The reference measures against their start or calibrated values, and their mean margin over all of them (a report: no reference measure gates). */
function referenceRows(measures, gates) {
  const g = gateMeasures(measures, gates);
  const composite = g.rows.length ? g.rows.reduce((sum, r) => sum + margin(gates.targetMeasures[r.key], r.value), 0) / g.rows.length : 0;
  return { rows: g.rows, composite };
}

/** The given as a naive candidate for a facing: mirrored for the left-hand facings. */
function naiveGiven(spec, facing) {
  const mirror = ['sw', 'nw', 'w'].includes(facing);
  return mirror ? { img: flipH(spec.given), labels: flipLabels(spec.givenLabels, N, N) } : { img: spec.given, labels: spec.givenLabels };
}

/**
 * The structure tier (consult C2 C4): the Amendment 1 rows from the hard-line checker plus the reference-free lines of structure.mjs.
 * hard is the result of checkHardLines for the same candidate. It reads no reference. Also the swap-rate tool uses it.
 */
export function structureTier(cand, { facing, spec, hard, labels = null, template = null, gates, checks, idle }) {
  const structItems = [...hard.items.filter((i) => STRUCTURE_HARD_IDS.includes(i.id)), ...structureLines(cand, { facing, spec, labels, checks: checks ?? loadFacingChecks(), idle })];
  if (template && (facing === 'e' || facing === 'w')) {
    const need = gates.noReference.bf1Template;
    const bf1 = align(cand, { img: toCanvas(template, N), labels: null }, { anchor: 'none' }).bf1;
    structItems.push({ id: 'ST-TEMPLATE', name: `BF1 against the layout template at least ${need}`, status: bf1 >= need ? 'pass' : 'fail', value: bf1.toFixed(3), detail: 'the template is the layout (code), not a reference' });
  }
  const c = checks ?? loadFacingChecks();
  return { items: structItems, report: hard.items.filter((i) => i.id === 'PA-06'), unchecked: c.uncheckedRules ?? [], pass: !hasFail(structItems) };
}

/**
 * Grade one candidate. opts: { facing, spec, gates, set, anchors: [{ name, img }], template (image), labels, sheathSide, name, checks, idle }.
 * Returns the verdict: { style, structure, reference, pass, notes, styleByEye }. The reference tier is report only and never gates (Amendment 2 Q1).
 */
export function grade(candRaw, opts) {
  const spec = opts.spec ?? loadSpec();
  const gates = opts.gates ?? loadGates();
  const facing = opts.facing;
  const cand = toCanvas(candRaw, N);
  const labels = opts.labels ?? autoLabel(cand);
  const hard = checkHardLines(cand, { facing, spec, gates, labels: opts.labels ?? null, template: Boolean(opts.labels), set: opts.set, name: opts.name ?? facing, sheathSide: opts.sheathSide });
  const verdict = { facing, labelSource: hard.labelSource, notes: ['Distance to the target only. No earlier round, score or verdict was read (PA-CM-01).'] };

  // (a) style, against the given
  verdict.style = styleTier(cand, { spec, gates, labels: opts.labels ?? null, template: Boolean(opts.labels), hardItems: hard.items, rampLabels: opts.rampLabels ?? null });

  // (b) structure, reference-free
  verdict.structure = structureTier(cand, { facing, spec, hard, labels: opts.labels ?? null, template: opts.template ?? null, gates, checks: opts.checks, idle: opts.idle });

  // (c) references: report only
  if (REF_FACINGS.includes(facing) || facing === 'se') {
    const target = facing === 'se' ? { img: spec.given, labels: spec.givenLabels } : makeTarget(loadReference(facing), spec.nearBlack);
    const m = measureAgainst(cand, target, { candLabels: labels });
    const g = referenceRows(m.measures, gates);
    const nv = naiveGiven(spec, facing);
    const nm = measureAgainst(nv.img, target, { candLabels: nv.labels });
    const gain = Object.fromEntries(['partMiou', 'colorMatch', 'valueR'].map((k) => [k, m.measures[k] - nm.measures[k]]));
    verdict.reference = {
      mode: 'reference',
      transform: m.transform,
      measures: m.measures,
      rows: g.rows,
      composite: g.composite,
      naive: { partMiou: nm.measures.partMiou, colorMatch: nm.measures.colorMatch, valueR: nm.measures.valueR },
      gain,
      parts: m.detail.part,
      pckMissing: m.detail.pckMissing,
    };
    verdict.reference.anchors = (opts.anchors ?? []).map((a) => {
      const am = measureAgainst(toCanvas(a.img, N), target, { candLabels: a.labels ?? null });
      const ag = referenceRows(am.measures, gates);
      return { name: a.name, composite: ag.composite, beaten: g.composite > ag.composite };
    });
  } else {
    // e and w have no reference. PCK against s and ne reads references, so it is a report line.
    const p = noReferencePck(labels);
    verdict.reference = { mode: 'none', pckVsSAndNe: p.pck, pckDist: p.dist, anchors: [], note: 'e and w have no reference. A G2 same-character pick against the given, and Mark, also gate.' };
  }
  verdict.reference.note = verdict.reference.note ?? 'Report only: no reference measure gates (Amendment 2 Q1).';

  // the tool verdict
  verdict.pass = verdict.style.pass && verdict.structure.pass;
  verdict.styleByEye = verdict.style.markGatesByEye;
  if (verdict.styleByEye) verdict.notes.push(`Mark gates style by eye: only ${verdict.style.separating.length} style lines separate the calibration population (the plan needs ${verdict.style.minGating}).`);
  if (verdict.style.notMeasured.length) verdict.notes.push(`Not measured: ${verdict.style.notMeasured.join(', ')}. A gating style line that is not measured makes the style tier not pass. Pass --parts (template labels) to measure S-RAMP.`);
  if (verdict.structure.unchecked.length) verdict.notes.push(`Unchecked R2 rules (structure.facingRules is built in step 3, not in this kit): ${verdict.structure.unchecked.map((u) => `${u.id} ${u.what}`).join('; ')}. A tool pass is not a complete structure check.`);
  if (facing === 'e' || facing === 'w') verdict.notes.push('e and w gate on ST-SIDE (guide rows against the battle idle) plus Mark. There is no BF1 gate: Amendment 2 replaced the Target gates line that held it.');
  if (hard.labelSource === 'auto') verdict.notes.push('The part labels are automatic (no template given, pass --parts): the ramp lock, eye, hand, item, lit-side and guide-row checks are only as good as the labeler.');
  verdict.notes.push("The blind facing-ID grader (9 of 10 on calibration) and Mark's template look also gate structure. The tool does not run them.");
  return verdict;
}

const num = (v) => (typeof v === 'number' ? Number(v.toFixed(3)) : v);

export function formatVerdict(v) {
  const head = v.pass ? (v.styleByEye ? 'PASS (style by eye: Mark)' : 'PASS') : 'FAIL';
  const L = [`facing ${v.facing}: ${head} (style ${v.style.pass ? 'pass' : 'FAIL'}, structure ${v.structure.pass ? 'pass' : 'FAIL'}; reference measures are report only)`, `labels: ${v.labelSource}`];
  L.push(`style (against the given): ${v.style.gating.length} lines gate, ${v.style.separating.length} separate${v.styleByEye ? ': MARK GATES STYLE BY EYE' : ''}`);
  for (const r of v.style.rows) if (r.status === 'not measured') L.push(`  NOT MEASURED ${r.id} ${r.name}${r.detail ? ` (${r.detail})` : ''}${r.role === 'gate' ? ' [gating: the style tier does not pass]' : ' [report line]'}`);
  for (const r of v.style.rows) if (r.status === 'fail') L.push(`  FAIL ${r.id} ${r.name}: ${num(r.value)} (${r.dir === 'band' ? `inside ${r.limit.join(' to ')}` : `${r.dir === 'min' ? 'at least' : 'at most'} ${r.limit}`})${r.detail ? ` ${r.detail}` : ''}${r.role === 'gate' ? '' : ' [report line]'}`);
  for (const i of v.style.extra) if (i.status === 'fail') L.push(`  FAIL ${i.id} ${i.name}: ${i.value}`);
  L.push('structure (no reference):');
  for (const i of v.structure.items) if (i.status === 'fail') L.push(`  FAIL ${i.id} ${i.name}: ${i.value}${i.detail ? ` (${i.detail})` : ''}`);
  for (const u of v.structure.unchecked) L.push(`  unchecked ${u.id}: ${u.what}`);
  const rf = v.reference;
  if (rf.mode === 'reference') {
    L.push(`reference (report only): alignment scale ${rf.transform.s}, shift ${rf.transform.dx},${rf.transform.dy}; part mIoU gain over the naive given ${rf.gain.partMiou >= 0 ? '+' : ''}${rf.gain.partMiou.toFixed(3)}`);
    for (const r of rf.rows) L.push(`  report ${r.name}: ${r.value.toFixed(3)} (${r.dir === 'min' ? 'at least' : 'at most'} ${r.gate}${r.calibrated ? '' : ', start value'}; ${r.pass ? 'meets' : 'misses'} it)`);
    for (const a of rf.anchors) L.push(`  anchor ${a.name}: ${a.beaten ? 'beaten' : 'NOT beaten'} (report: anchor composite ${a.composite.toFixed(2)})`);
  } else L.push(`reference (report only): none for this facing; PCK against s and ne ${rf.pckVsSAndNe.toFixed(2)}`);
  for (const n of v.notes.slice(1)) L.push(`note: ${n}`);
  return L.join('\n');
}

function main() {
  const a = process.argv.slice(2);
  const opt = (n) => (a.includes(n) ? a[a.indexOf(n) + 1] : null);
  const all = (n) => a.flatMap((x, i) => (x === n ? [a[i + 1]] : []));
  const file = a[0] && !a[0].startsWith('--') ? a[0] : null;
  const facing = opt('--facing');
  if (!file || !existsSync(file) || !facing) {
    console.error('usage: node scripts/art/v2/grade/grade.mjs <candidate.png|grid.txt> --facing <s|n|ne|nw|sw|e|w|se> [--set a.png,b.png] [--anchor name=path ...] [--template t.png] [--parts rows.txt] [--sheath left|right] [--json]');
    process.exit(2);
  }
  try {
    const nameAndPath = (s) => (s.includes('=') ? s.split('=') : [s.replace(/^.*[\\/]/, '').replace(/\.png$/i, ''), s]);
    const set = (opt('--set') ?? '').split(',').filter(Boolean).map((s) => {
      const [name, p] = nameAndPath(s);
      return { name, img: loadCandidate(p) };
    });
    const anchors = all('--anchor').map((s) => {
      const [name, p] = nameAndPath(s);
      return { name, img: loadCandidate(p) };
    });
    const v = grade(loadCandidate(file), {
      facing,
      set: set.length ? set : undefined,
      anchors,
      template: opt('--template') ? readPng(opt('--template')) : null,
      labels: opt('--parts') ? loadParts(opt('--parts')) : null,
      sheathSide: opt('--sheath'),
    });
    if (a.includes('--json')) console.log(JSON.stringify(v, null, 2));
    else console.log(formatVerdict(v));
    process.exit(v.pass ? 0 : 1);
  } catch (e) {
    console.error(`grade: ${e.message}`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

