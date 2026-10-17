// The aligned template-against-reference check (consult C2 A1, build B6). A REPORT only: nobody adjusts a spec to it, and it gates nothing.
// Grader-side: it reads the Sprite Fusion reference labels. It never runs from proxy code.
//   node scripts/art/v2/grade/templatecheck.mjs [--proxy-dir <dir>] [--pathb-ref <git ref>] [--scratch <dir>] [--out <report.md>]
// Candidates (part maps, no pixels): the proxy templates (s, n, ne, se from <proxy-dir>/<facing>-template.json; nw = mirror of ne, sw = mirror of se),
// path B (read with `git show <ref>:<path>` into a scratch folder, never checked out; its own mirrors), and the given se used unchanged (mirrored for nw, sw).
// Scoring is plan v2 step 0: the reference is rescaled to 31, 32 or 33 px and shifted by up to 2 px in x and y; the 7-group part mIoU is read at the
// transform with the best BF1 (the plan's pick), and as the best mIoU over the same search (an upper bound, the consult's number).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from '../../pipeline/given.mjs';
import { SCALES, SHIFT, align, boundaryF } from './align.mjs';
import { loadSpec } from './hardlines.mjs';
import { newImage } from '../../pixkit/png.mjs';
import { N, bboxOf, edgeMask, placeScaled } from './image.mjs';
import { partIou } from './measures.mjs';
import { REF_FACINGS, loadReference } from './refs/labels.mjs';
import { toGroups } from './parts.mjs';

export const AXIS_SUM = 35;
export const PATHB_REF = 'origin/spike/rook-path-b';
export const PATHB_FILES = ['scripts/art/v2/pathb/sheet.mjs', 'scripts/art/v2/pathb/rook-pathb.json'];

/** Mirror a label grid about the axis x + x' = axisSum (the proxy and path B axis is 35, not the canvas center). */
export function mirrorAxis(labels, axisSum = AXIS_SUM) {
  const out = new Array(N * N).fill(null);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const m = axisSum - x;
      if (labels[y * N + x] && m >= 0 && m < N) out[y * N + m] = labels[y * N + x];
    }
  return out;
}

/** A proxy template file (t0a/<facing>-template.json) as a label grid of part names. */
export function proxyTemplateLabels(path) {
  const t = JSON.parse(readFileSync(path, 'utf8'));
  return t.idx.map((i) => (i < 0 ? null : t.labels[t.ids[i]] ?? null));
}

/** Path B facing label grids, read with git show into a scratch folder (no checkout). Returns { s, se, e, ne, n, sw, w, nw } or throws. */
export async function pathBLabels({ ref = PATHB_REF, scratch, cwd = REPO } = {}) {
  for (const f of PATHB_FILES) {
    const text = execFileSync('git', ['show', `${ref}:${f}`], { cwd, encoding: 'utf8', maxBuffer: 1 << 26 });
    const to = `${scratch}/${f}`;
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, text);
  }
  const sheet = await import(pathToFileURL(`${scratch}/scripts/art/v2/pathb/sheet.mjs`).href);
  const data = sheet.loadData();
  const out = {};
  const sheets = {};
  for (const f of ['s', 'se', 'e', 'ne', 'n']) {
    sheets[f] = sheet.buildSheet(data, f);
    out[f] = sheets[f].labels;
  }
  for (const [from, to] of Object.entries({ se: 'sw', e: 'w', ne: 'nw' })) out[to] = sheet.mirrorSheet(sheets[from], to).labels;
  return out;
}

const grayFrom = (labels) => {
  const img = newImage(N, N);
  labels.forEach((p, i) => {
    if (p) img.data.set([128, 128, 128, 255], i * 4);
  });
  return img;
};

/**
 * Part mIoU (7 groups) of one candidate part map against one reference, with the plan's step 0 search.
 * Returns { aligned (at the best-BF1 transform), best (best over the search), shiftOnly (best over the shifts at scale 31), transform, bestTransform, shift0 }.
 */
export function alignedPartMiou(candLabels, ref) {
  const cand = grayFrom(candLabels);
  const cg = toGroups(candLabels);
  const a = align(cand, { img: ref.img, labels: ref.labels });
  const aligned = partIou(cg, toGroups(a.ref.labels)).mean;
  let best = { v: -1, t: null };
  let shift0 = null;
  let shiftOnly = -1;
  const cb = bboxOf(cand);
  for (const s of SCALES)
    for (let dy = -SHIFT; dy <= SHIFT; dy++)
      for (let dx = -SHIFT; dx <= SHIFT; dx++) {
        const placed = placeScaled(ref.img, ref.labels, { s, dx, dy, anchor: 'bbox', target: cb });
        const v = partIou(cg, toGroups(placed.labels)).mean;
        if (v > best.v) best = { v, t: { s, dx, dy } };
        if (s === 31 && dx === 0 && dy === 0) shift0 = v;
        if (s === 31) shiftOnly = Math.max(shiftOnly, v);
      }
  return { aligned, best: best.v, shiftOnly, transform: { s: a.s, dx: a.dx, dy: a.dy }, bestTransform: best.t, shift0, bf1: boundaryF(edgeMask(cand), edgeMask(a.ref.img), N, N).f };
}

const FACINGS = REF_FACINGS; // s, n, ne, nw, sw

/** The whole table. sources: { name: { facing: labels } }. Returns { rows: [{ source, facing, aligned, best, shift0 }], gain }. */
export function templateTable(sources) {
  const refs = Object.fromEntries(FACINGS.map((f) => [f, loadReference(f)]));
  const rows = [];
  for (const [source, byFacing] of Object.entries(sources))
    for (const f of FACINGS) {
      if (!byFacing[f]) continue;
      rows.push({ source, facing: f, ...alignedPartMiou(byFacing[f], refs[f]) });
    }
  return { rows };
}

/** The sources of the consult table: path B, the proxy, and the given used unchanged. */
export async function defaultSources({ proxyDir, pathbRef = PATHB_REF, scratch, spec = loadSpec() }) {
  const out = {};
  try {
    out['Path B'] = await pathBLabels({ ref: pathbRef, scratch });
  } catch (e) {
    out['Path B'] = null;
    out.pathBError = e.message;
  }
  const tpl = (f) => proxyTemplateLabels(`${proxyDir}/${f}-template.json`);
  const proxy = { s: tpl('s'), n: tpl('n'), ne: tpl('ne') };
  proxy.nw = mirrorAxis(proxy.ne);
  proxy.sw = mirrorAxis(tpl('se'));
  out.Proxy = proxy;
  const g = spec.givenLabels;
  out['Given se, unchanged'] = { s: g, n: g, ne: g, nw: mirrorAxis(g), sw: mirrorAxis(g) };
  return out;
}

const f3 = (v) => (v === null || v === undefined ? 'n/a' : v.toFixed(3));
export function formatTemplateReport(sources, table, { date = new Date().toISOString().slice(0, 10), proxyDir, pathbRef } = {}) {
  const names = Object.keys(sources).filter((k) => sources[k] && k !== 'pathBError');
  const L = [`# Aligned template-against-reference check (report, ${date})`, '', 'Grader-side report. It gates nothing, and nobody adjusts a spec to it (Clean Rook). 7-group part mIoU (area weighted, sleeves merged into the torso group), reference labels as in `refs/`.', ''];
  L.push(`Candidates: proxy templates from \`${proxyDir}\` (nw = mirror of ne, sw = mirror of se, axis sum ${AXIS_SUM}); path B from \`git show ${pathbRef}:<path>\` (its own mirrors); the given se unchanged (mirrored for nw, sw).`, '');
  L.push('Scoring is plan v2 step 0: the reference is rescaled to 31, 32 or 33 px and shifted by up to 2 px. "Plan pick" is the mIoU at the transform with the best BF1. "Best of search" is the best mIoU over the same 75 transforms (an upper bound, the consult C2 number). "Shift 0" is scale 31 with no shift (the old BR-03 reading).', '');
  const section = (title, key) => {
    L.push(`### ${title}`, '', `| Source | ${FACINGS.join(' | ')} |`, `|---|${FACINGS.map(() => '---').join('|')}|`);
    for (const n of names) L.push(`| ${n} | ${FACINGS.map((f) => f3(table.rows.find((r) => r.source === n && r.facing === f)?.[key])).join(' | ')} |`);
    L.push('');
  };
  section('Best of search (±2 px, scale 31 to 33)', 'best');
  section('Plan pick (best BF1 transform)', 'aligned');
  section('Shift 0, scale 31', 'shift0');
  const naive = 'Given se, unchanged';
  if (names.includes(naive)) {
    L.push('### Gain over the naive given (best of search)', '', `| Source | ${FACINGS.join(' | ')} |`, `|---|${FACINGS.map(() => '---').join('|')}|`);
    for (const n of names.filter((x) => x !== naive)) L.push(`| ${n} | ${FACINGS.map((f) => { const a = table.rows.find((r) => r.source === n && r.facing === f)?.best; const b = table.rows.find((r) => r.source === naive && r.facing === f)?.best; return a === undefined || b === undefined ? 'n/a' : `${a - b >= 0 ? '+' : ''}${(a - b).toFixed(3)}`; }).join(' | ')} |`);
    L.push('');
  }
  L.push('### Best transform per cell (scale, dx, dy)', '', `| Source | ${FACINGS.join(' | ')} |`, `|---|${FACINGS.map(() => '---').join('|')}|`);
  for (const n of names) L.push(`| ${n} | ${FACINGS.map((f) => { const t = table.rows.find((r) => r.source === n && r.facing === f)?.bestTransform; return t ? `${t.s},${t.dx},${t.dy}` : 'n/a'; }).join(' | ')} |`);
  if (sources.pathBError) L.push('', `Path B was not read: ${sources.pathBError}`);
  L.push('', 'Reading: where a facing turns a lot (n, ne, nw) the templates beat the naive given; at s and sw the naive given is a strong baseline (45 degrees from se). The measure has no resolution to tell a right template from a wrong one in the 0.45 to 0.65 band (consult C2 A1, A3), so it stays a report line.');
  return `${L.join('\n')}\n`;
}

async function run() {
  const a = process.argv.slice(2);
  const opt = (n, d = null) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
  const proxyDir = opt('--proxy-dir', 'C:/Users/markh/AppData/Local/Temp/rook-v2/t0a');
  const pathbRef = opt('--pathb-ref', PATHB_REF);
  const scratch = opt('--scratch', 'C:/Users/markh/AppData/Local/Temp/rook-v2/t0-r3/pathb');
  if (!existsSync(proxyDir)) {
    console.error(`templatecheck: no proxy template folder at ${proxyDir}`);
    process.exit(2);
  }
  const sources = await defaultSources({ proxyDir, pathbRef, scratch });
  const table = templateTable(Object.fromEntries(Object.entries(sources).filter(([k, v]) => v && k !== 'pathBError')));
  const report = formatTemplateReport(sources, table, { proxyDir, pathbRef });
  const out = opt('--out');
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, report);
    console.log(`report: ${out}`);
  } else console.log(report);
}

async function main() {
  try {
    await run();
  } catch (e) {
    console.error(`templatecheck: ${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
