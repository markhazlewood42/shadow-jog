// The grade command (plan v2 section 4): one candidate facing, one verdict.
//   node scripts/art/v2/grade/grade.mjs <candidate.png | grid.txt> --facing <s|n|ne|nw|sw|e|w|se>
//        [--set a.png,b.png,...]   the other facings of the set (PA-08 and the distinct-facing line). Name each as name=path, or just a path
//        [--anchor name=path ...]  anchors (round 8 facing, rig v2 facing, code painter): the candidate must beat each one
//        [--template t.png]        the proxy template silhouette (needed for e and w: BF1 against the template)
//        [--parts rows.txt]        the candidate part map as rows of part codes (a template); default is the automatic labeler
//        [--sheath left|right]     the expected sheath side (PA-21 becomes a gate)
//        [--json]
// The verdict has three parts: the hard lines, the target measures against the matching Sprite Fusion reference, and the anchors.
// It measures distance to the target only. It never reads an earlier round, a round number or an earlier score (PA-CM-01).
// Exit code 0 when every part passes, 1 otherwise, 2 for a usage error.
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { HEX_OF, LETTERS } from '../../headtest/lib.mjs';
import { readPng, unhex } from '../../pixkit/png.mjs';
import { align } from './align.mjs';
import { pack } from './color.mjs';
import { checkHardLines, loadGates, loadSpec } from './hardlines.mjs';
import { N, setPixel, toCanvas } from './image.mjs';
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

/**
 * Grade one candidate. opts: { facing, spec, gates, set, anchors: [{ name, img }], template (image), labels, sheathSide }.
 * Returns the verdict object.
 */
export function grade(candRaw, opts) {
  const spec = opts.spec ?? loadSpec();
  const gates = opts.gates ?? loadGates();
  const facing = opts.facing;
  const cand = toCanvas(candRaw, N);
  const labels = opts.labels ?? autoLabel(cand);
  const hard = checkHardLines(cand, { facing, spec, gates, labels: opts.labels ?? null, template: Boolean(opts.labels), set: opts.set, name: opts.name ?? facing, sheathSide: opts.sheathSide });
  const verdict = { facing, hardLines: { pass: hard.pass, items: hard.items }, labelSource: hard.labelSource, notes: ['Distance to the target only. No earlier round, score or verdict was read (PA-CM-01).'] };

  if (REF_FACINGS.includes(facing) || facing === 'se') {
    const target = facing === 'se' ? { img: spec.given, labels: spec.givenLabels } : makeTarget(loadReference(facing), spec.nearBlack);
    const m = measureAgainst(cand, target, { candLabels: labels });
    const g = gateMeasures(m.measures, gates);
    verdict.target = { mode: 'reference', transform: m.transform, measures: m.measures, ...g, detail: { pckMissing: m.detail.pckMissing, parts: m.detail.part } };
    verdict.anchors = (opts.anchors ?? []).map((a) => {
      const am = measureAgainst(toCanvas(a.img, N), target, { candLabels: a.labels ?? null });
      const ag = gateMeasures(am.measures, gates);
      return { name: a.name, composite: ag.composite, passCount: ag.passCount, pass: ag.pass, beaten: g.composite > ag.composite && g.passCount >= ag.passCount };
    });
    verdict.targetPass = g.pass;
  } else {
    // e and w: hard lines, BF1 against the proxy template, landmark PCK against s and ne.
    const need = gates.noReference.bf1Template;
    let bf1 = null;
    if (opts.template) bf1 = align(cand, { img: toCanvas(opts.template, N), labels: null }, { anchor: 'none' }).bf1;
    const p = noReferencePck(labels);
    const tpl = opts.template ? bf1 >= need : false;
    verdict.target = { mode: 'no-reference', bf1Template: bf1, bf1Need: need, pckVsSAndNe: p.pck, pckDist: p.dist, pass: tpl && p.pck === 1, note: 'e and w have no reference. A G2 same-character pick against the given, and Mark, also gate.' };
    verdict.anchors = [];
    verdict.targetPass = verdict.target.pass;
    if (!opts.template) verdict.notes.push('No template silhouette was given, so BF1 against the template cannot pass.');
  }
  verdict.anchorsPass = verdict.anchors.every((a) => a.beaten);
  verdict.pass = hard.pass && verdict.targetPass && verdict.anchorsPass;
  return verdict;
}

export function formatVerdict(v) {
  const L = [`facing ${v.facing}: ${v.pass ? 'PASS' : 'FAIL'} (hard lines ${v.hardLines.pass ? 'pass' : 'FAIL'}, target ${v.targetPass ? 'pass' : 'FAIL'}, anchors ${v.anchorsPass ? 'beaten' : 'NOT beaten'})`, `labels: ${v.labelSource}`];
  for (const i of v.hardLines.items) if (i.status === 'fail') L.push(`  FAIL ${i.id} ${i.name}: ${i.value}${i.detail ? ` (${i.detail})` : ''}`);
  if (v.target.mode === 'reference') {
    L.push(`  alignment: scale ${v.target.transform.s}, shift ${v.target.transform.dx},${v.target.transform.dy}`);
    for (const r of v.target.rows) L.push(`  ${r.role === 'gate' ? (r.pass ? 'pass  ' : 'FAIL  ') : 'report'} ${r.name}: ${r.value.toFixed(3)} (${r.dir === 'min' ? 'at least' : 'at most'} ${r.gate}${r.calibrated ? '' : ', start value, not calibrated'})`);
  } else L.push(`  no reference: BF1 vs template ${v.target.bf1Template === null ? 'n/a' : v.target.bf1Template.toFixed(3)} (need ${v.target.bf1Need}), PCK vs s and ne ${v.target.pckVsSAndNe.toFixed(2)}`);
  for (const a of v.anchors) L.push(`  anchor ${a.name}: ${a.beaten ? 'beaten' : 'NOT beaten'} (anchor composite ${a.composite.toFixed(2)}, ${a.passCount} gates passed)`);
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

