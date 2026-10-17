// The structure card (plan stage S2): the text fields a writer reads for one facing. Every field comes from the spec and the rendered template.
// Fields: yaw, head center column, face axis column, eye cells (or "no face"), light vector, guide rows, part layout per row,
// outline rule, fold strokes (start point and direction, shadow side, at most 2 per panel), carried item cells.
// Columns are cell coordinates: a cell x covers x to x+1, so "17.5" lies between columns 17 and 18.
import { HEAD_PARTS, PARTS } from '../../pipeline/decompose.mjs';
import { apply, dot, norm } from './math.mjs';
import { cameraBasis, guideRows, project } from './render.mjs';
import { SIZE, resolveSpec } from './spec.mjs';

const r1 = (v) => Math.round(v * 10) / 10;
const cellsOf = (t, labels) => {
  const out = [];
  t.label.forEach((l, k) => { if (l && labels.includes(l)) out.push([k % SIZE, Math.floor(k / SIZE)]); });
  return out;
};
/** Runs of the same label in one row: [{ label, x0, x1 }]. */
export function rowRuns(t, y) {
  const runs = [];
  for (let x = 0; x < SIZE; x++) {
    const l = t.label[y * SIZE + x];
    if (!l) continue;
    const last = runs[runs.length - 1];
    if (last && last.label === l && last.x1 === x - 1) last.x1 = x;
    else runs.push({ label: l, x0: x, x1: x });
  }
  return runs;
}
const rangeText = (a, b) => (a === b ? `${a}` : `${a}-${b}`);
/** Compress cells to text per row: "row 8: 14-23". */
const cellsText = (cells) => {
  const byRow = new Map();
  for (const [x, y] of cells) (byRow.get(y) ?? byRow.set(y, []).get(y)).push(x);
  return [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([y, xs]) => {
    xs.sort((a, b) => a - b);
    const parts = [];
    let s = xs[0], p = xs[0];
    for (const x of xs.slice(1)) { if (x !== p + 1) { parts.push(rangeText(s, p)); s = x; } p = x; }
    parts.push(rangeText(s, p));
    return `row ${y}: x${parts.join(', x')}`;
  });
};

/** Cells on the line between two cells (Bresenham). */
export function lineCells([x0, y0], [x1, y1]) {
  const out = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  for (;;) {
    out.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return out;
}

/** The face axis of a template: { col, row } in cell coordinates, or null when the face point is not visible. */
export function faceAxis(spec, t) {
  const P = apply(t.joints[spec.face.joint], spec.face.at);
  const s = project(spec, P);
  const cx = Math.floor(s.x), cy = Math.floor(s.y);
  if (cx < 0 || cy < 0 || cx >= SIZE || cy >= SIZE) return null;
  const k = cy * SIZE + cx;
  if (!['skin', 'lenses', 'beard'].includes(t.label[k] ?? '') || Math.abs(t.depth[k] - s.depth) > 1.6) return null;
  return { col: r1(s.x - 0.5), row: r1(s.y - 0.5) };
}

const dirName = (dx, dy) => {
  const h = dx === 0 ? '' : dx > 0 ? 'right' : 'left';
  const v = dy === 0 ? '' : dy > 0 ? 'down' : 'up';
  return [v, h].filter(Boolean).join('-') || 'none';
};
/** Fold strokes visible in this template: [{ part, start, dir, cells, shadowSide }]. */
export function foldStrokes(spec, t) {
  const out = [];
  const L = norm(spec.light.vector);
  const shadowSide = L[0] <= 0 ? 'right' : 'left'; // light from the left puts the shadow side on the right of a stroke
  for (const f of spec.folds ?? []) {
    const jw = t.joints[spec.parts[f.part].joint];
    const a = project(spec, apply(jw, f.from)), b = project(spec, apply(jw, f.to));
    const ca = [Math.floor(a.x), Math.floor(a.y)], cb = [Math.floor(b.x), Math.floor(b.y)];
    const hit = (c) => c[0] >= 0 && c[1] >= 0 && c[0] < SIZE && c[1] < SIZE && t.id[c[1] * SIZE + c[0]] === f.part;
    // the start point must lie on the visible surface of its part: same part at its cell and the same depth (a point on the far side of a box is not visible)
    if (!hit(ca) || Math.abs(t.depth[ca[1] * SIZE + ca[0]] - a.depth) > 2.5) { out.push({ part: f.part, hidden: true }); continue; }
    const cells = lineCells(ca, cb).filter((c) => hit(c));
    const sx = Math.sign(cb[0] - ca[0]), sy = Math.sign(cb[1] - ca[1]);
    out.push({ part: f.part, hidden: false, start: ca, dir: [sx, sy], dirName: dirName(sx, sy), cells, shadowSide });
  }
  return out;
}

/** Words for a light vector as the picture shows it. */
export function lightWords(spec) {
  const L = norm(spec.light.vector);
  const { V } = cameraBasis(spec);
  const side = L[0] < -0.15 ? 'left' : L[0] > 0.15 ? 'right' : 'center';
  const up = dot(L, [0, 1, 0]) > 0.3 ? 'top' : 'level';
  const view = dot(L, V) > 0.15 ? 'toward the viewer' : 'away from the viewer';
  return `${up}-${side}, ${view}`;
}

/** Build the card. Returns { fields, text }. */
export function buildCard(rawSpec, t) {
  const spec = resolveSpec(rawSpec);
  const head = cellsOf(t, HEAD_PARTS);
  const hx = head.map((c) => c[0]), hy = head.map((c) => c[1]);
  const headBox = head.length ? { x0: Math.min(...hx), x1: Math.max(...hx), y0: Math.min(...hy), y1: Math.max(...hy) } : null;
  const headCenter = headBox ? (headBox.x0 + headBox.x1) / 2 : null;
  const axis = faceAxis(spec, t);
  const eyes = cellsOf(t, ['lenses']);
  const guides = guideRows(t.label);
  const folds = foldStrokes(spec, t);
  const items = Object.entries(spec.items ?? {}).map(([name, it]) => {
    const labels = [...new Set(it.parts.map((id) => spec.parts[id].label))];
    const byLabel = Object.fromEntries(labels.map((l) => [l, cellsOf(t, [l])]));
    const all = labels.flatMap((l) => byLabel[l]);
    const cx = all.length ? all.reduce((s, c) => s + c[0], 0) / all.length : null;
    return { name, side: it.side, cells: byLabel, picture: cx === null ? 'not visible' : cx < (headCenter ?? 17.5) ? 'left of the figure' : 'right of the figure' };
  });
  const fields = {
    facing: t.facing, yaw: t.yaw, pitchDeg: spec.camera.pitchDeg, light: { vector: spec.light.vector, words: lightWords(spec) },
    headCenter, headBox, faceAxis: axis ? axis.col : null, faceOffset: axis && headCenter !== null ? r1(axis.col - headCenter) : null,
    eyeCells: eyes, guides, folds, items,
  };

  const code = (l) => PARTS[l].code;
  const lines = [];
  lines.push(`STRUCTURE CARD  ${spec.name}  facing ${t.facing}  yaw ${t.yaw} degrees`);
  lines.push(`size 32x32, one cell = 1 px. Camera: orthographic, ${spec.camera.pitchDeg} degrees above the horizon, no resample.`);
  lines.push(`yaw: ${t.yaw} (the figure turns about the vertical axis; 0 = faces the viewer, 90 = faces the right of the picture, 180 = back to the viewer)`);
  lines.push(headBox ? `head center column: ${headCenter} (head cells x${headBox.x0}..${headBox.x1}, rows ${headBox.y0}..${headBox.y1})` : 'head center column: none (no head cells)');
  lines.push(axis ? `face axis column: ${axis.col} (${fields.faceOffset >= 0 ? '+' : ''}${fields.faceOffset} from the head center, ${fields.faceOffset > 0 ? 'toward the right of the picture' : fields.faceOffset < 0 ? 'toward the left of the picture' : 'centered'})` : 'face axis column: none (no face: the face points away from the viewer)');
  lines.push(eyes.length ? `eye cells (lenses): ${cellsText(eyes).join('; ')}` : 'eye cells: no face');
  lines.push(`light vector: ${lightWords(spec)} (x ${spec.light.vector[0]}, y ${spec.light.vector[1]}, z ${spec.light.vector[2]}). One light for every facing. Shadow side of a form is the side away from the light.`);
  lines.push(`guide rows: head top ${guides.head}, eye ${guides.eye ?? 'none'}, shoulder ${guides.shoulder}, hip ${guides.hip}, hem ${guides.hem}, foot ${guides.foot}`);
  lines.push('outline rule: a 1 px near-black line on every silhouette edge cell (outline map value 1). Interior lines (value 2) where a part sits clearly behind its neighbor. Use the outline letters of the part ramp; pick the darker letter on the shadow side, the lighter on the lit side (selout). One flat outline color is a fault.');
  lines.push('fold strokes (at most 2 per panel; a stroke runs from a support point toward the pull, on the shadow side):');
  if (!folds.length) lines.push('  none for this spec');
  for (const f of folds) lines.push(f.hidden ? `  ${f.part}: hidden at this facing` : `  ${f.part}: start (${f.start[0]}, ${f.start[1]}), direction ${f.dirName} (${f.dir[0]}, ${f.dir[1]}), ${f.cells.length} cells, shadow side: ${f.shadowSide} of the stroke`);
  lines.push('carried items:');
  if (!items.length) lines.push('  none');
  for (const it of items) {
    lines.push(`  ${it.name}: carried on the ${it.side === '-x' ? 'left of the picture at facing s' : 'right of the picture at facing s'}; at this facing it shows ${it.picture}`);
    for (const [l, cells] of Object.entries(it.cells)) lines.push(`    ${l} (${code(l)}): ${cells.length ? cellsText(cells).join('; ') : 'not visible'}`);
  }
  lines.push(`part layout per row (codes: ${Object.entries(PARTS).map(([n, p]) => `${p.code} ${n}`).join(', ')}):`);
  for (let y = 0; y < SIZE; y++) {
    const runs = rowRuns(t, y);
    if (runs.length) lines.push(`  ${String(y).padStart(2, '0')}: ${runs.map((r) => `${code(r.label)}${rangeText(r.x0, r.x1)}`).join(' ')}`);
  }
  return { fields, text: `${lines.join('\n')}\n` };
}
