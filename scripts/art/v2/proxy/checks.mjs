// Template checks (plan section 7, "before any writer runs; no reference used"). They run on a rendered template against the given only.
//   structure hard lines   height, bottom row, head alone (and within a tolerance of the given), shoulder row and hip row within 1 of the given. The numbers come from spec.structure.
//   part areas             each part group within +-30 percent of the given (groups below). Per-label ratios are reported as info.
//   symmetry               a facing that is its own mirror (s, n) matches its x-mirror on every non-item cell
//   sw mirror              the mirror of the sw template matches the se template on every non-item cell (S8 makes sw, w, nw by mirror)
//   s agrees mirror(sw)    the plan's own wording (section 7): the s template against the mirror of the sw template. The plan gives no number, so the line is info
//                          unless opts.sMirrorSwLine is set. The mirror of sw is se, which is 45 degrees from s, so a low value is expected.
//   e side landmarks       the e template (90 degrees) is NOT compared with the given (45 degrees). It is compared with the battle idle (the design reference for the side
//                          view) on the head, shoulder, hem and feet rows only: opaque cells per row, within spec.structure.sideBand.
//   no face                n: no lens cell. Skin cells are reported (neck skin is allowed).
// A line is { name, ok, value, expect, detail }. The checks never read a reference.
import { PART_NAMES } from '../../pipeline/decompose.mjs';
import { loadIdleFrames } from '../../pipeline/given.mjs';
import { reduceAlpha } from '../../pipeline/masks.mjs';
import { givenLabels } from './fit.mjs';
import { AREA_GROUPS, AREA_TOLERANCE, labelAgreement, labelMeasures } from './measures.mjs';
import { axisSumOf, mirrorCells, renderTemplate } from './render.mjs';
import { SIZE, structureOf } from './spec.mjs';

export { AREA_GROUPS, AREA_TOLERANCE, labelAgreement, labelMeasures };
const r4 = (v) => Math.round(v * 10000) / 10000;

const line = (name, ok, value, expect, detail = '', gate = true) => ({ name, ok, value, expect, detail, gate });

/**
 * Opaque cells per row of an image reduced to the template height (area average, 50 percent alpha), for the rows asked. Pure; used for the battle idle.
 * img = { w, h, data: RGBA bytes }. Returns { rows: { name: count }, width }.
 */
export function reducedRowCounts(img, rowsByName, targetH) {
  const red = reduceAlpha(img, targetH);
  const rows = {};
  for (const [name, y] of Object.entries(rowsByName)) {
    let w = 0;
    for (let x = 0; x < red.w; x++) if ((red.cover[y * red.w + x] ?? 0) >= 0.5) w++;
    rows[name] = w;
  }
  return { rows, width: red.w };
}

/**
 * The e landmark check: the side template against the battle idle on the head, shoulder, hem and feet rows only. One line per row,
 * ok when the template's opaque cells in that row are within `sideBand` of the idle's. Rows and band come from spec.structure (sideRows, sideBand).
 * idleFrame = one RGBA frame of the battle idle. Throws when the spec has no sideRows (no default).
 */
export function sideLandmarkLines(spec, t, idleFrame) {
  const st = structureOf(spec);
  if (!st.sideRows || !Number.isFinite(st.sideBand)) throw new Error('spec.structure needs sideRows and sideBand for the side landmark check');
  const idle = reducedRowCounts(idleFrame, st.sideRows, st.height);
  return Object.entries(st.sideRows).map(([name, y]) => {
    let tw = 0;
    for (let x = 0; x < SIZE; x++) if (t.id[y * SIZE + x] !== null) tw++;
    const d = Math.abs(tw - idle.rows[name]);
    return line(`side-${name}-row`, d <= st.sideBand, tw, `within ${st.sideBand} of the battle idle (${idle.rows[name]} cells at row ${y})`);
  });
}

/**
 * Run the template checks for one facing. given = { img?, pm }. Returns { facing, ok, lines, info }.
 * opts.symmetryLine = IoU line for the mirror checks (default 0.9). opts.sMirrorSwLine = pass line for the literal s-against-mirror(sw) check (default none: the plan gives no number).
 * opts.idleFrame = the battle idle frame for the e check (default: frame 0 of the committed sheet; a missing sheet throws).
 */
export function templateChecks(spec, pm, facing, { symmetryLine = 0.9, sMirrorSwLine = null, idleFrame = undefined, t = renderTemplate(spec, { facing }) } = {}) {
  const st = structureOf(spec);
  if (facing === 'e') {
    // The side view has no reference in the given (the given is 45 degrees). Plan section 7: landmark rows against the battle idle, nothing else.
    const frame = idleFrame ?? loadIdleFrames()?.[0];
    if (!frame) throw new Error('the battle idle sheet is missing (public/art/crew/rook/idle/spritesheet.png): the e check cannot run');
    const sideLines = sideLandmarkLines(spec, t, frame);
    return { facing, ok: sideLines.every((l) => l.ok), lines: sideLines, info: { labelRatios: {}, groupRatios: {}, measures: labelMeasures(t.label), given: null } };
  }
  const gm = labelMeasures(givenLabels(pm));
  const m = labelMeasures(t.label);
  const lines = [];
  lines.push(line('height', Math.abs(m.height - st.height) <= st.heightTol, m.height, `${st.height} +-${st.heightTol}`));
  lines.push(line('bottom-row', m.bottom === st.bottomRow, m.bottom, st.bottomRow));
  lines.push(line('head-alone', m.headAlone >= st.headAlone[0] && m.headAlone <= st.headAlone[1] && Math.abs(m.headAlone - gm.headAlone) <= st.headAloneTol, m.headAlone, `${st.headAlone[0]} to ${st.headAlone[1]}, within ${st.headAloneTol} of the given (${gm.headAlone})`));
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
    // The plan's own wording, read literally. The mirror of sw is se, 45 degrees from s, so a low value is expected and the plan gives no number.
    const literal = labelAgreement(t.label, mirrorCells(sw.label, sum));
    info.sMirrorSw = { note: 's against the mirror of sw, read literally', agreement: literal, line: sMirrorSwLine };
    lines.push(line('s-agrees-mirror-sw', sMirrorSwLine === null ? true : literal >= sMirrorSwLine, literal, sMirrorSwLine === null ? 'the plan gives no number' : `>= ${sMirrorSwLine}`, sMirrorSwLine === null ? 'info only: not a gate' : '', sMirrorSwLine !== null));
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
  if (Object.keys(r.info.labelRatios).length) out.push(`  per-label area ratios (info): ${Object.entries(r.info.labelRatios).map(([n, v]) => `${n} ${v.template}/${v.given}`).join(', ')}`);
  if (r.info.skinCells !== undefined) out.push(`  skin cells at n (info, neck skin is allowed): ${r.info.skinCells}`);
  return out.join('\n');
}
