// Material sample sheets (plan section 3, "Material sample sheets cut from the given"): per part and per light level, the given's cells with their letters.
// The writer copies the texture pattern of the sample for the part and the light level of each paint cell.
// Light level of a given cell comes from its letter and the part ramp in the spec. Outline letters are their own group.
// Blanked mode: every cell in the box is left out of every sheet and every text. Nothing in the output depends on a box cell.
import { PART_NAMES } from '../../pipeline/decompose.mjs';
import { drawLower, drawText, letterAt, lumRgb, newImage, paste, rgbOfLetter, setPx, writePng, zoomGrid } from '../../headtest/lib.mjs';
import { givenLabels } from './fit.mjs';
import { SIZE, idsOfLabel } from './spec.mjs';

export const SAMPLE_LEVELS = ['shadow', 'base', 'lit', 'outline', 'other'];

/** Group of one given letter inside a label: 'shadow' | 'base' | 'lit' | 'outline' | 'other'. */
export function groupOfLetter(spec, label, letter) {
  const ids = idsOfLabel(spec, label);
  for (const lv of ['shadow', 'base', 'lit']) if (ids.some((id) => spec.parts[id].ramp[lv].includes(letter))) return lv;
  if (ids.some((id) => spec.parts[id].ramp.outline.includes(letter))) return 'outline';
  return 'other';
}

/**
 * Cut the given. Returns { groups: { label: { shadow: [{x,y,letter}], base, lit, outline, other } }, bbox: { label: {x0,y0,x1,y1} } }.
 * Cells inside the blank box are never read.
 */
export function cutSamples(spec, img, pm, { blank = null } = {}) {
  const labels = givenLabels(pm, blank);
  const groups = {};
  const bbox = {};
  for (let k = 0; k < SIZE * SIZE; k++) {
    const label = labels[k];
    if (!label) continue;
    const x = k % SIZE, y = Math.floor(k / SIZE);
    const letter = letterAt(img, x, y);
    const g = (groups[label] ??= Object.fromEntries(SAMPLE_LEVELS.map((l) => [l, []])));
    g[groupOfLetter(spec, label, letter)].push({ x, y, letter });
    const b = (bbox[label] ??= { x0: x, y0: y, x1: x, y1: y });
    b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y);
  }
  return { groups, bbox };
}

/** The ramp lists a spec author would write, from the given letters of each label: dark to light by luminance, split into thirds by cell count. Outline = near-black letters. */
export function suggestRamps(img, pm, { blank = null } = {}) {
  const labels = givenLabels(pm, blank);
  const count = {};
  for (let k = 0; k < SIZE * SIZE; k++) {
    if (!labels[k]) continue;
    const l = letterAt(img, k % SIZE, Math.floor(k / SIZE));
    (count[labels[k]] ??= {})[l] = ((count[labels[k]] ?? {})[l] ?? 0) + 1;
  }
  const out = {};
  for (const name of PART_NAMES) {
    const c = count[name];
    if (!c) continue;
    const letters = Object.keys(c).sort((a, b) => lumRgb(rgbOfLetter(a)) - lumRgb(rgbOfLetter(b)));
    const outline = letters.filter((l) => lumRgb(rgbOfLetter(l)) < 22);
    const body = letters.filter((l) => !outline.includes(l));
    const total = body.reduce((s, l) => s + c[l], 0);
    const r = { shadow: '', base: '', lit: '', outline: outline.join('') };
    let run = 0;
    for (const l of body) {
      const mid = run + c[l] / 2;
      run += c[l];
      r[mid < total / 3 ? 'shadow' : mid < (2 * total) / 3 ? 'base' : 'lit'] += l;
    }
    out[name] = r;
  }
  return out;
}

/** One sheet per label: a panel per light level, each cell at 32 px with its letter. Returns an image. */
export function sampleSheet(label, group, bb, k = 32) {
  const panels = SAMPLE_LEVELS.filter((lv) => group[lv].length);
  const w = bb.x1 - bb.x0 + 1, h = bb.y1 - bb.y0 + 1;
  const pw = 28 + w * k + 1, ph = 16 + h * k + 1;
  const gap = 12;
  const out = newImage(panels.length * (pw + gap) + gap, ph + 24, [20, 20, 26, 255]);
  panels.forEach((lv, i) => {
    const img = newImage(w, h);
    for (const c of group[lv]) setPx(img, c.x - bb.x0, c.y - bb.y0, [...rgbOfLetter(c.letter), 255]);
    const z = zoomGrid(img, {
      k, originX: bb.x0, originY: bb.y0,
      after: (o, ml, mt, kk) => {
        for (const c of group[lv]) drawLower(o, c.letter, ml + (c.x - bb.x0) * kk + (kk >> 1) - 3, mt + (c.y - bb.y0) * kk + (kk >> 1) - 5, lumRgb(rgbOfLetter(c.letter)) > 110 ? [10, 10, 14, 255] : [240, 240, 245, 255], 2);
      },
    });
    drawText(out, `${label} ${lv} ${group[lv].length}`, gap + i * (pw + gap) + 28, 8, [225, 228, 235, 255], 2);
    paste(out, z, gap + i * (pw + gap), 24);
  });
  return out;
}

/** The same information as text: for each label and level, the letters in the bounding box of the label ('.' elsewhere), rows with absolute numbers. */
export function samplesText({ groups, bbox }) {
  const lines = ['# Material samples cut from the given. One block per part and light level. Rows are frame rows; the header gives frame columns (ones digit).'];
  for (const label of PART_NAMES) {
    const g = groups[label];
    if (!g) continue;
    const bb = bbox[label];
    for (const lv of SAMPLE_LEVELS) {
      if (!g[lv].length) continue;
      const set = new Map(g[lv].map((c) => [`${c.x},${c.y}`, c.letter]));
      lines.push('', `## ${label} ${lv}  (${g[lv].length} cells, columns ${bb.x0} to ${bb.x1}, rows ${bb.y0} to ${bb.y1})`);
      lines.push(`   ${[...Array(bb.x1 - bb.x0 + 1)].map((_, i) => (bb.x0 + i) % 10).join('')}`);
      for (let y = bb.y0; y <= bb.y1; y++) {
        let row = '';
        for (let x = bb.x0; x <= bb.x1; x++) row += set.get(`${x},${y}`) ?? '.';
        lines.push(`${String(y).padStart(2, '0')}|${row}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Write samples.txt and one PNG per label into dir. Returns the list of files. */
export function writeSamples(dir, cut) {
  const files = [];
  for (const label of PART_NAMES) {
    const g = cut.groups[label];
    if (!g) continue;
    writePng(sampleSheet(label, g, cut.bbox[label]), `${dir}/sample-${label}.png`);
    files.push(`sample-${label}.png`);
  }
  return files;
}
