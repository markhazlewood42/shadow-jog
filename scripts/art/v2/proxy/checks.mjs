// Template checks (plan section 7, "before any writer runs; no reference used"). They run on a rendered template against the given only.
//   structure hard lines   height 31 +-1, bottom row 30, head alone 13 to 15 (and within 1 of the given), shoulder row and hip row within 1 of the given
//   part areas             each part group within +-30 percent of the given (groups below). Per-label ratios are reported as info.
//   symmetry               a facing that is its own mirror (s, n) matches its x-mirror on every non-item cell
//   sw mirror              the mirror of the sw template matches the se template on every non-item cell (S8 makes sw, w, nw by mirror)
//   no face                n: no lens cell. Skin cells are reported (neck skin is allowed).
// A line is { name, ok, value, expect, detail }. The checks never read a reference.
import { PART_NAMES } from '../../pipeline/decompose.mjs';
import { givenLabels } from './fit.mjs';
import { AREA_GROUPS, AREA_TOLERANCE, labelAgreement, labelMeasures } from './measures.mjs';
import { axisSumOf, mirrorCells, renderTemplate } from './render.mjs';

export { AREA_GROUPS, AREA_TOLERANCE, labelAgreement, labelMeasures };
const r4 = (v) => Math.round(v * 10000) / 10000;

const line = (name, ok, value, expect, detail = '', gate = true) => ({ name, ok, value, expect, detail, gate });

/**
 * Run the template checks for one facing. given = { img?, pm }. Returns { facing, ok, lines, info }.
 * opts.symmetryLine = IoU line for the mirror checks (default 0.9).
 */
export function templateChecks(spec, pm, facing, { symmetryLine = 0.9, t = renderTemplate(spec, { facing }) } = {}) {
  const gm = labelMeasures(givenLabels(pm));
  const m = labelMeasures(t.label);
  const lines = [];
  lines.push(line('height', Math.abs(m.height - 31) <= 1, m.height, '31 +-1'));
  lines.push(line('bottom-row', m.bottom === 30, m.bottom, 30));
  lines.push(line('head-alone', m.headAlone >= 13 && m.headAlone <= 15 && Math.abs(m.headAlone - gm.headAlone) <= 1, m.headAlone, `13 to 15, within 1 of the given (${gm.headAlone})`));
  lines.push(line('shoulder-row', m.shoulder !== null && Math.abs(m.shoulder - gm.shoulder) <= 1, m.shoulder, `within 1 of the given (${gm.shoulder})`));
  lines.push(line('hip-row', m.hip !== null && Math.abs(m.hip - gm.hip) <= 1, m.hip, `within 1 of the given (${gm.hip})`));
  const info = { labelRatios: {}, groupRatios: {}, measures: m, given: gm };
  for (const n of PART_NAMES) if (gm.areas[n] || m.areas[n]) info.labelRatios[n] = { template: m.areas[n], given: gm.areas[n], ratio: gm.areas[n] ? r4(m.areas[n] / gm.areas[n]) : null };
  for (const [name, labels] of Object.entries(AREA_GROUPS)) {
    const ga = labels.reduce((s, l) => s + gm.areas[l], 0);
    const ta = labels.reduce((s, l) => s + m.areas[l], 0);
    const ratio = ga ? ta / ga : null;
    info.groupRatios[name] = { template: ta, given: ga, ratio: ratio === null ? null : r4(ratio) };
    // A carried item is occluded differently at each facing, so its area is reported but never gates.
    if (ga) lines.push(line(`area-${name}`, Math.abs(ratio - 1) <= AREA_TOLERANCE, r4(ratio), `1 +-${AREA_TOLERANCE} (given ${ga} cells, template ${ta})`, name === 'item' ? 'info only: not a gate' : '', name !== 'item'));
  }
  const sum = axisSumOf(spec);
  if (facing === 's' || facing === 'n') {
    const iou = labelAgreement(t.label, mirrorCells(t.label, sum));
    lines.push(line('symmetric', iou >= symmetryLine, iou, `>= ${symmetryLine} against its own x-mirror, item parts left out`));
  }
  if (facing === 's') {
    const sw = renderTemplate(spec, { facing: 'sw' });
    const se = renderTemplate(spec, { facing: 'se' });
    const mirrorSwSe = labelAgreement(mirrorCells(sw.label, sum), se.label);
    lines.push(line('sw-mirror-matches-se', mirrorSwSe >= symmetryLine, mirrorSwSe, `>= ${symmetryLine}: the mirror of sw must equal se, item parts left out`));
    info.sMirrorSw = { note: 's against the mirror of sw, read literally (they differ by 45 degrees, so this is expected to be low)', agreement: labelAgreement(t.label, mirrorCells(sw.label, sum)) };
  }
  if (facing === 'n') {
    const eyes = t.label.filter((l) => l === 'lenses').length;
    lines.push(line('no-face', eyes === 0, eyes, '0 lens cells'));
    info.skinCells = t.label.filter((l) => l === 'skin').length;
  }
  return { facing, ok: lines.filter((l) => l.gate).every((l) => l.ok), lines, info };
}

export function formatChecks(r) {
  const out = [`template checks, facing ${r.facing}: ${r.ok ? 'PASS' : 'FAIL'}`];
  for (const l of r.lines) out.push(`  ${l.ok ? 'PASS' : l.gate ? 'FAIL' : 'info'}  ${l.name.padEnd(16)} ${String(l.value).padStart(7)}  (${l.expect})${l.detail ? ` ${l.detail}` : ''}`);
  out.push(`  per-label area ratios (info): ${Object.entries(r.info.labelRatios).map(([n, v]) => `${n} ${v.template}/${v.given}`).join(', ')}`);
  if (r.info.sMirrorSw) out.push(`  s against mirror(sw), literal (info): ${r.info.sMirrorSw.agreement}`);
  if (r.info.skinCells !== undefined) out.push(`  skin cells at n (info, neck skin is allowed): ${r.info.skinCells}`);
  return out.join('\n');
}
