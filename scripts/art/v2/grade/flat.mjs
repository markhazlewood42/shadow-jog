// Texture density and the flattening lines (plan v2 section 4 Flattening; consult C2 C5): per part group of at least N cells, and over the whole figure.
// Shared by the hard-line checker (HL-FLAT) and the style tier (S-FLAT-GROUP, S-FLAT-WHOLE, S-DENS-BAND).
import { de00Packed } from './color.mjs';
import { N, opaqueAt, packedAt } from './image.mjs';
import { GROUP_NAMES, autoLabel, toGroups } from './parts.mjs';
import { TEXTURE_STEP } from './measures.mjs';

/** Texture density over one cell mask: color changes (dE00 at or above the step) to the right and lower neighbor inside the mask, per cell. */
export function maskDensity(img, inMask, step = TEXTURE_STEP) {
  let cells = 0;
  let changes = 0;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (!inMask(x, y)) continue;
      cells++;
      const p = packedAt(img, x, y);
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const X = x + dx;
        const Y = y + dy;
        if (X < N && Y < N && inMask(X, Y) && de00Packed(p, packedAt(img, X, Y)) >= step) changes++;
      }
    }
  return { cells, density: cells ? changes / cells : 0 };
}
/** Texture density of the whole figure (every opaque cell). */
export const wholeDensity = (img) => maskDensity(img, (x, y) => opaqueAt(img, x, y));
/** Texture density per part group. */
export function groupDensity(img, labels) {
  const groups = toGroups(labels);
  return Object.fromEntries(GROUP_NAMES.map((g) => [g, maskDensity(img, (x, y) => groups[y * N + x] === g)]));
}

const isTemplate = (labelSource) => labelSource === 'template' || labelSource === 'given labels';
/** The part labels a style check should compare the given with: the same labeler class as the candidate's. */
export const givenLabelsFor = (spec, labelSource) => (isTemplate(labelSource) ? spec.givenLabels : autoLabel(spec.given));

/** The densities of the given for the labeler class of the candidate (cached on the spec object). */
export function givenDensity(spec, labelSource) {
  const key = isTemplate(labelSource) ? 'template' : 'auto';
  spec._dens ??= {};
  spec._dens[key] ??= { groups: groupDensity(spec.given, givenLabelsFor(spec, labelSource)), whole: wholeDensity(spec.given) };
  return spec._dens[key];
}

/**
 * The flattening lines of one candidate against the given.
 * Returns { groups: { name: { cand, given, ratio } } (only the groups with at least minCells in both), lowest, whole, wholeCand, wholeGiven, densities }.
 */
export function flattening(img, labels, spec, labelSource, minCells) {
  const dc = groupDensity(img, labels);
  const dg = givenDensity(spec, labelSource);
  const groups = {};
  let lowest = Number.POSITIVE_INFINITY;
  for (const g of GROUP_NAMES) {
    if (dc[g].cells < minCells || dg.groups[g].cells < minCells || dg.groups[g].density <= 0) continue;
    const ratio = dc[g].density / dg.groups[g].density;
    groups[g] = { cand: dc[g].density, given: dg.groups[g].density, ratio };
    lowest = Math.min(lowest, ratio);
  }
  const wc = wholeDensity(img);
  return { groups, lowest: Number.isFinite(lowest) ? lowest : null, whole: dg.whole.density > 0 ? wc.density / dg.whole.density : null, wholeCand: wc.density, wholeGiven: dg.whole.density, densities: dc };
}
