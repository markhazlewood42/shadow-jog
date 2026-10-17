// Style-tier calibration (consult C2 section C4, Amendment 2, build B2 and B4). Grader-side, but it reads no Sprite Fusion reference:
// the population is the walk frames, the older rounds and code-made variants of the given.
//   node scripts/art/v2/grade/style-calibrate.mjs [--write-gates] [--out <report.md>] [--json <file>]
// should pass   the 8 walk frames (the given among them)
// should fail   round 8 (4 facings), rig v2 (4 facings), an egg-shaped blob, the given with each part flattened to its mean color,
//               the given with 10 percent random speckle (fixed seed)
// For every line: worst pass, best fail, how many fail items it catches, and whether it gates. A line gates when it passes all 8 walk frames
// and catches at least one should-fail item (it separates something). The lines of the spike's GO list are pinned: they stay on even when no
// should-fail item breaks them. If fewer than 3 lines gate by separation, the verdict says "Mark gates style by eye".
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readPng } from '../../pixkit/png.mjs';
import { loadWalkFrames } from '../../pipeline/given.mjs';
import { pack } from './color.mjs';
import { GATES_PATH, loadGates, loadSpec } from './hardlines.mjs';
import { N, cloneImg, nearestPacked, opaqueAt, packedAt, packedList, setPixel } from './image.mjs';
import { GROUP_NAMES, autoLabel } from './parts.mjs';
import { blobImage, rigFacing } from './calibrate.mjs';
import { groupDensity } from './flat.mjs';
import { LINE_META, STYLE_LINE_IDS, linePasses, styleValues } from './style.mjs';

/** The group floor of the spec (consult C2 C5: a group of 20 or more cells). */
export const SPEC_MIN_CELLS = 20;
const R8 = 'C:/Users/markh/AppData/Local/Temp/rook-step3/round-8/facings';
const RIG_FIELD_FACINGS = ['down', 'right', 'up', 'left'];

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

/** The given with each part flattened to its mean color (rounded to the nearest walk palette color). Near-black cells (outline, dark lines) are kept. */
export function flattenParts(img, labels, palette) {
  const pal = packedList(palette);
  const out = cloneImg(img);
  const sum = new Map();
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const p = labels[y * N + x];
      if (!p || !opaqueAt(img, x, y)) continue;
      const i = (y * N + x) * 4;
      if (0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2] < 60) continue;
      const s = sum.get(p) ?? { r: 0, g: 0, b: 0, n: 0 };
      s.r += img.data[i];
      s.g += img.data[i + 1];
      s.b += img.data[i + 2];
      s.n++;
      sum.set(p, s);
    }
  const mean = new Map([...sum].map(([p, s]) => [p, nearestPacked(pack(Math.round(s.r / s.n), Math.round(s.g / s.n), Math.round(s.b / s.n)), pal)]));
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const p = labels[y * N + x];
      if (!p || !opaqueAt(img, x, y) || !mean.has(p)) continue;
      const i = (y * N + x) * 4;
      if (0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2] < 60) continue;
      setPixel(out, x, y, mean.get(p));
    }
  return out;
}

/** The given with a share of its opaque cells set to another random walk palette color (fixed seed). */
export function speckle(img, palette, { share = 0.1, seed = 20261017 } = {}) {
  const pal = packedList(palette);
  const rnd = mulberry32(seed);
  const out = cloneImg(img);
  const cells = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (opaqueAt(img, x, y)) cells.push([x, y]);
  const n = Math.round(cells.length * share);
  for (let k = 0; k < n; k++) {
    const [x, y] = cells.splice(Math.floor(rnd() * cells.length), 1)[0];
    const cur = packedAt(img, x, y);
    const others = pal.filter((c) => c !== cur);
    setPixel(out, x, y, others[Math.floor(rnd() * others.length)]);
  }
  return out;
}

/** The calibration items: { id, group: 'pass' | 'fail', kind, cand, labels }. labels null means the automatic labeler (every item, so the labeler class is the same). */
export function buildStyleItems(spec = loadSpec()) {
  const items = [];
  const add = (it) => items.push({ labels: null, rampLabels: null, ...it });
  loadWalkFrames().forEach((fr, k) => add({ id: `walk${k}`, group: 'pass', kind: 'walk frame', cand: fr, rampLabels: autoLabel(fr) }));
  for (const f of ['down', 'right', 'up', 'up-right']) {
    const p = `${R8}/${f}.png`;
    if (existsSync(p)) add({ id: `round8-${f}`, group: 'fail', kind: 'round 8', cand: readPng(p), rampLabels: 'auto' });
  }
  for (const f of RIG_FIELD_FACINGS) add({ id: `rig-${f}`, group: 'fail', kind: 'rig v2', cand: rigFacing(f), rampLabels: 'auto' });
  add({ id: 'blob', group: 'fail', kind: 'blob', cand: blobImage(spec), rampLabels: 'auto' });
  add({ id: 'given-flat-parts', group: 'fail', kind: 'flattened', cand: flattenParts(spec.given, spec.givenLabels, spec.palette), rampLabels: spec.givenLabels });
  add({ id: 'given-speckle10', group: 'fail', kind: 'speckle', cand: speckle(spec.given, spec.palette), rampLabels: spec.givenLabels });
  return items;
}

const r4 = (v) => (v === null || v === undefined ? v : Number(v.toFixed(4)));

/** The part-group density band from the walk frames: [min, max] of each group's density over the frames that have the group at `minCells` or more. */
export function densityBands(walkDens, minCells, pad) {
  const bands = {};
  for (const g of GROUP_NAMES) {
    const ds = walkDens.map((d) => d[g]).filter((d) => d.cells >= minCells).map((d) => d.density);
    if (ds.length < 2) continue;
    const lo = Math.min(...ds);
    const hi = Math.max(...ds);
    bands[g] = { lo: r4(Math.max(0, lo - pad * Math.max(lo, 0.05))), hi: r4(hi + pad * hi), frames: ds.length };
  }
  return bands;
}

/**
 * Run the style calibration. Returns { rows, table, gating, ... } and the lines to store.
 * opts.minCells    the group floor of the flattening and band lines (spec: 20; re-set when a walk frame fails it)
 * opts.pad         how far the walk band widens (a fraction of its edge)
 */
export function runStyleCalibration({ spec = loadSpec(), gates = loadGates(), minCells = null, pad = 0.1, log = () => {} } = {}) {
  const items = buildStyleItems(spec);
  const startMin = SPEC_MIN_CELLS; // the spec value (C5), not the stored one, so a re-run shows the same re-set
  const walk = items.filter((i) => i.group === 'pass');
  const walkLabels = walk.map((i) => autoLabel(i.cand));
  const walkDensAt = (n) => walk.map((i, k) => groupDensity(i.cand, walkLabels[k]));
  const walkDens = walkDensAt(startMin);

  // Floor of the group size: the spec value, or the smallest value (steps of 5) at which every walk frame passes the flattening line at its start ratio.
  const raw = (floor, bands) => items.map((it) => ({ ...it, ...styleValues(it.cand, { spec, labels: it.labels, template: false, flatMinCells: floor, bands, rampLabels: it.rampLabels === 'auto' ? autoLabel(it.cand) : it.rampLabels }) }));
  let floor = minCells ?? startMin;
  let bands = densityBands(walkDens, floor, pad);
  let rows = raw(floor, bands);
  let floorReset = null;
  if (minCells === null) {
    const start = LINE_META['S-FLAT-GROUP'].start;
    let f = startMin;
    for (; f <= 200; f += 5) {
      bands = densityBands(walkDens, f, pad);
      rows = raw(f, bands);
      const bad = rows.filter((r) => r.group === 'pass' && r.values['S-FLAT-GROUP'] !== null && r.values['S-FLAT-GROUP'] < start - 1e-9);
      if (!bad.length) break;
    }
    if (f !== startMin) floorReset = { from: startMin, to: f };
    floor = f;
  }
  bands = densityBands(walkDens, floor, pad);
  rows = raw(floor, bands);
  rows.forEach((r) => log(`${r.group.padEnd(5)} ${r.id.padEnd(18)} ${STYLE_LINE_IDS.map((id) => `${id.slice(2, 8)}=${r.values[id] === null ? '-' : Number(r.values[id]).toFixed(2)}`).join(' ')}`));

  // Place every line.
  const lines = {};
  const table = [];
  for (const id of STYLE_LINE_IDS) {
    const meta = LINE_META[id];
    const passVals = rows.filter((r) => r.group === 'pass').map((r) => r.values[id]).filter((v) => v !== null);
    const failRows = rows.filter((r) => r.group === 'fail').filter((r) => r.values[id] !== null);
    const failVals = failRows.map((r) => r.values[id]);
    let line;
    let reset = null;
    if (meta.dir === 'band') {
      const lo = Math.min(...passVals);
      const hi = Math.max(...passVals);
      line = { lo: Math.floor(lo * (1 - pad)), hi: Math.ceil(hi * (1 + pad)) };
    } else if (!passVals.length) line = { limit: meta.start };
    else if (meta.start === null) {
      // No spec value: the limit is the walk maximum plus a quarter of it (at least 1).
      const mx = Math.max(...passVals);
      line = { limit: mx + Math.max(1, Math.ceil(0.25 * mx)) };
    } else {
      let limit = meta.start;
      const worst = meta.dir === 'min' ? Math.min(...passVals) : Math.max(...passVals);
      const fails = meta.dir === 'min' ? worst < limit - 1e-9 : worst > limit + 1e-9;
      if (fails) {
        // Re-set to the worst walk value, rounded outward to 2 decimals (the line must pass all 8 walk frames).
        limit = meta.dir === 'min' ? Math.floor(worst * 100) / 100 : Math.ceil(worst * 100) / 100;
        reset = { from: meta.start, to: limit };
      }
      line = { limit };
    }
    const worstPass = !passVals.length ? null : meta.dir === 'band' ? { lo: Math.min(...passVals), hi: Math.max(...passVals) } : meta.dir === 'min' ? Math.min(...passVals) : Math.max(...passVals);
    const failPass = failRows.filter((r) => linePasses(meta, line, r.values[id]));
    const caught = failRows.filter((r) => !linePasses(meta, line, r.values[id]));
    const bestFail = !failVals.length ? null : meta.dir === 'band' ? { lo: Math.min(...failVals), hi: Math.max(...failVals) } : meta.dir === 'min' ? Math.max(...failVals) : Math.min(...failVals);
    const walkPass = rows.filter((r) => r.group === 'pass').every((r) => linePasses(meta, line, r.values[id]));
    const ran = passVals.length > 0;
    const separates = ran && walkPass && caught.length > 0;
    const role = separates || (meta.pinned && ran) ? 'gate' : 'report';
    lines[id] = { ...line, role, separates, pinned: Boolean(meta.pinned), worstPass: typeof worstPass === 'object' ? worstPass : r4(worstPass), bestFail: typeof bestFail === 'object' ? bestFail : r4(bestFail), caught: caught.map((r) => r.id), passedFail: failPass.map((r) => r.id), reset, ran };
    table.push({ id, name: meta.name, dir: meta.dir, ...lines[id], failTotal: failRows.length, rule: meta.rule });
  }
  const separating = table.filter((t) => t.separates).map((t) => t.id);
  const gating = table.filter((t) => t.role === 'gate').map((t) => t.id);
  // Which should-fail items does the gating set catch?
  const caughtBy = Object.fromEntries(rows.filter((r) => r.group === 'fail').map((r) => [r.id, gating.filter((id) => !linePasses(LINE_META[id], lines[id], r.values[id]))]));
  return { rows, table, lines, bands, floor, floorReset, separating, gating, caughtBy, uncaught: Object.entries(caughtBy).filter(([, v]) => !v.length).map(([k]) => k), markGatesByEye: separating.length < 3, pad };
}

const f3 = (v) => (v === null || v === undefined ? 'n/a' : typeof v === 'object' ? `${v.lo} to ${v.hi}` : Number.isFinite(v) ? (Math.abs(v) >= 10 ? String(Math.round(v * 100) / 100) : v.toFixed(3)) : String(v));

export function formatStyleReport(res, { date = new Date().toISOString().slice(0, 10) } = {}) {
  const L = [`# Rook v2 grade: style-tier calibration (${date})`, '', 'Grader-side. Built by `node scripts/art/v2/grade/style-calibrate.mjs`. Consult C2 section C4, C5; Amendment 2.', ''];
  L.push(`Population: should pass = ${res.rows.filter((r) => r.group === 'pass').length} walk frames. Should fail = ${res.rows.filter((r) => r.group === 'fail').length} items (round 8 x4, rig v2 x4, blob, the given with parts flattened, the given with 10 percent speckle). Every item is labeled by the automatic labeler, so the labeler class is the same for all.`, '');
  L.push(`Group floor for the flattening and band lines: ${res.floor} cells${res.floorReset ? ` (re-set from ${res.floorReset.from}: at ${res.floorReset.from} cells a walk frame fails the 0.8x floor, because the small leg and hand groups change with the pose)` : ''}. Band padding: ${(res.pad * 100).toFixed(0)} percent of the walk edge.`, '');
  L.push(`**Lines that separate (pass all 8 walk frames, catch at least one should-fail item): ${res.separating.length}. Lines that gate: ${res.gating.length} (${res.gating.join(', ')}). ${res.markGatesByEye ? 'FEWER THAN 3 SEPARATE: Mark gates style by eye.' : 'At least 3 separate: the style tier gates.'}**`, '');
  L.push('| Line | Rule | Limit | Worst walk pass | Best should-fail | Catches | Gate |', '|---|---|---|---|---|---|---|');
  for (const t of res.table) {
    const limit = t.dir === 'band' ? `${t.lo} to ${t.hi}` : `${t.dir === 'min' ? 'at least' : 'at most'} ${f3(t.limit)}${t.reset ? ` (re-set from ${t.reset.from})` : ''}`;
    L.push(`| ${t.id} ${t.name} | ${t.rule} | ${limit} | ${f3(t.worstPass)} | ${f3(t.bestFail)} | ${t.caught.length} of ${t.failTotal} | ${t.role === 'gate' ? (t.separates ? 'gate' : 'gate (pinned)') : 'report'} |`);
  }
  L.push('', `Should-fail items caught by the gating lines: ${Object.entries(res.caughtBy).map(([k, v]) => `${k} (${v.length})`).join(', ')}.`, res.uncaught.length ? `NOT caught by any gating line: ${res.uncaught.join(', ')}.` : 'Every should-fail item is caught by at least one gating line.', '');
  L.push('### Density band per part group (absolute density, from the walk frames)', '', '| Group | Low | High | Walk frames with the group |', '|---|---|---|---|');
  for (const [g, b] of Object.entries(res.bands)) L.push(`| ${g} | ${b.lo} | ${b.hi} | ${b.frames} |`);
  L.push('', '### Items', '', `| Item | Group | ${STYLE_LINE_IDS.join(' | ')} |`, `|---|---|${STYLE_LINE_IDS.map(() => '---').join('|')}|`);
  for (const r of res.rows) {
    const cells = STYLE_LINE_IDS.map((id) => {
      const v = r.values[id];
      const ok = linePasses(LINE_META[id], res.lines[id], v);
      return `${v === null ? 'n/a' : f3(v)}${ok ? '' : ' X'}`;
    });
    L.push(`| ${r.id} | ${r.group} | ${cells.join(' | ')} |`);
  }
  L.push('', 'X marks a value that breaks its line.');
  return `${L.join('\n')}\n`;
}

/** Write the calibrated style section into gates.json. */
export function writeStyleGates(res, gates, { date = new Date().toISOString().slice(0, 10), path = GATES_PATH } = {}) {
  const g = JSON.parse(JSON.stringify(gates));
  g.style = {
    note: 'Style tier (consult C2 C4, Amendment 2). Written by `node scripts/art/v2/grade/style-calibrate.mjs --write-gates`. role gate = the line gates; separates = it passes all 8 walk frames and catches a should-fail item; pinned = a line of the spike GO list that stays on. The verdict says Mark gates style by eye when fewer than minGating lines separate.',
    calibratedOn: date,
    minGating: 3,
    flatMinCells: res.floor,
    bandPad: res.pad,
    markGatesByEye: res.markGatesByEye,
    separating: res.separating,
    bands: res.bands,
    lines: Object.fromEntries(Object.entries(res.lines).map(([k, v]) => [k, v])),
  };
  writeFileSync(path, `${JSON.stringify(g, null, 2)}\n`);
  return g;
}

function main() {
  const a = process.argv.slice(2);
  const opt = (n, d = null) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
  const gates = loadGates();
  const res = runStyleCalibration({ gates, log: a.includes('--verbose') ? console.log : () => {} });
  const report = formatStyleReport(res);
  const out = opt('--out');
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, report);
    console.log(`report: ${out}`);
  } else console.log(report);
  if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify({ table: res.table, bands: res.bands, floor: res.floor, separating: res.separating, gating: res.gating, caughtBy: res.caughtBy }, null, 2));
  if (a.includes('--write-gates')) {
    writeStyleGates(res, gates);
    console.log(`gates written: ${GATES_PATH}`);
  }
  console.log(`style lines gating: ${res.gating.length} (${res.gating.join(', ')}); separating: ${res.separating.length}`);
  process.exit(res.markGatesByEye ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
