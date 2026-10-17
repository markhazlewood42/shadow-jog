// Stage S3, rewritten to read templates (plan section 3, "S3 reprojection"). It replaces the part-map and mask classifier of pipeline/classify.mjs.
// For every opaque cell of a target template, take its proxy surface point, move it with its joint into a source view (the given at its
// facing, or an approved neighbor facing), and project it. Then:
//   copy       the point is visible there, in the same part, at the same light level, and the source cell is the same cell (x, y)
//   transform  the same, but the source cell is another cell (a part shift)
//   invent     everything else
// A source cell must also be usable: for the given, its part-map label equals the part's label and it is not in the blank box;
// for an approved neighbor, it holds a letter. The source cell and the target cell must agree on being an outline cell.
// Blanked mode (T1): the box cells of the given are not sources, and every target cell in the box is a paint (invent) cell.
import { inBox } from '../../pipeline/decompose.mjs';
import { givenLabels } from './fit.mjs';
import { apply, matT, matVec, sub } from './math.mjs';
import { project, renderTemplate } from './render.mjs';
import { SIZE, resolveSpec } from './spec.mjs';
import { imageToFlat32 } from './grid32.mjs';

const r4 = (v) => Math.round(v * 10000) / 10000;

/** The given as a source: its letters (box cells blanked), its part-map labels and the proxy render at the given facing. */
export function givenSource(spec, img, pm, { blank = null } = {}) {
  const letters = imageToFlat32(img);
  if (blank) for (let k = 0; k < letters.length; k++) if (inBox(blank, k % SIZE, Math.floor(k / SIZE))) letters[k] = '.';
  return {
    name: 'given', kind: 'given', facing: spec.givenFacing, template: renderTemplate(spec, { facing: spec.givenFacing }),
    letters, labels: givenLabels(pm, blank),
  };
}
/** An approved facing as a source: its template and its approved grid (1024 letters). */
export function approvedSource(spec, facing, flatLetters, name = facing) {
  return { name, kind: 'approved', facing, template: renderTemplate(spec, { facing }), letters: flatLetters, labels: null };
}

/**
 * Classify the opaque cells of a target template. sources are tried in order; the first that matches wins.
 * Returns { cells: Array(1024) of null | { cls, letter?, src? }, counts, total, share } with share = invent / total.
 * opts: { blank, depthTol }
 */
export function classifyCells(rawSpec, target, sources, { blank = null, depthTol = 1.5 } = {}) {
  const spec = resolveSpec(rawSpec);
  const cells = Array(SIZE * SIZE).fill(null);
  const counts = { copy: 0, transform: 0, invent: 0 };
  const why = {};
  for (let k = 0; k < SIZE * SIZE; k++) {
    const id = target.id[k];
    if (id === null) continue;
    const x = k % SIZE, y = Math.floor(k / SIZE);
    let rec = { cls: 'invent', why: 'blank-box' };
    if (!(blank && inBox(blank, x, y))) {
      const part = spec.parts[id];
      const jt = target.joints[part.joint];
      const local = matVec(matT(jt.R), sub(target.point[k], jt.t));
      let why = 'no-source';
      for (const s of sources) {
        const T = s.template;
        const pr = project(spec, apply(T.joints[part.joint], local));
        const cx = Math.floor(pr.x), cy = Math.floor(pr.y);
        if (cx < 0 || cy < 0 || cx >= SIZE || cy >= SIZE) { why = 'out-of-frame'; continue; }
        const sk = cy * SIZE + cx;
        if (T.id[sk] !== id || Math.abs(T.depth[sk] - pr.depth) > depthTol) { why = why === 'level' || why === 'outline' || why === 'unusable' ? why : 'hidden'; continue; }
        if (T.level[sk] !== target.level[k]) { why = 'level'; continue; }
        if ((T.outline[sk] > 0) !== (target.outline[k] > 0)) { why = 'outline'; continue; }
        const letter = s.letters[sk];
        if (!letter || letter === '.' || letter === '?' || (s.kind === 'given' && s.labels[sk] !== part.label)) { why = 'unusable'; continue; }
        rec = { cls: cx === x && cy === y ? 'copy' : 'transform', letter, src: { name: s.name, x: cx, y: cy } };
        break;
      }
      if (rec.cls === 'invent') rec.why = why;
    }
    cells[k] = rec;
    counts[rec.cls]++;
    if (rec.cls === 'invent') why[rec.why] = (why[rec.why] ?? 0) + 1;
  }
  const total = counts.copy + counts.transform + counts.invent;
  return { cells, counts, why, total, share: total ? r4(counts.invent / total) : 0, copyShare: total ? r4(counts.copy / total) : 0, transformShare: total ? r4(counts.transform / total) : 0 };
}

/** One line per facing: cells, copy, transform, invent, shares. */
export function formatShares(rows) {
  return rows
    .map((r) => `${String(r.facing).padEnd(3)} cells ${String(r.total).padStart(3)}  copy ${String(r.counts.copy).padStart(3)}  transform ${String(r.counts.transform).padStart(3)}  invent ${String(r.counts.invent).padStart(3)}  invented share ${(100 * r.share).toFixed(1)} percent  (invent because: ${Object.entries(r.why ?? {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'})`)
    .join('\n');
}
