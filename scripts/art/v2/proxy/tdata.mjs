// Template data: the JSON a writer kit and Level T need. Part ids per cell, light level, outline, ramps, locked cells.
// It holds no pixel of the given except the letters of the locked copy cells and the soft transform cells, which come from the classifier.
import { createHash } from 'node:crypto';
import { PARTS } from '../../pipeline/decompose.mjs';
import { partIds, resolveSpec } from './spec.mjs';

export const TEMPLATE_FORMAT = 'proxy-template/1';

/** Hash of the template geometry (part per cell, level, outline). The rebuild command compares it with the spec. */
export const templateHash = (td) => createHash('sha1').update(JSON.stringify([td.ids, td.idx, td.level, td.outline])).digest('hex').slice(0, 12);

/**
 * Serializable template. cls (optional) is the S3 classification: { cells: [{ cls, letter?, src? }] } with letters for copy and transform cells.
 * locked = copy cells (the writer may not change them). soft = transform cells (pre-filled, the writer may change them).
 */
export function templateData(rawSpec, t, cls = null) {
  const spec = resolveSpec(rawSpec);
  const ids = partIds(spec);
  const idx = t.id.map((id) => (id === null ? -1 : ids.indexOf(id)));
  const td = {
    format: TEMPLATE_FORMAT, facing: t.facing, yaw: t.yaw, size: t.w, name: spec.name,
    ids, idx, level: Array.from(t.level), outline: Array.from(t.outline),
    ramps: Object.fromEntries(ids.map((id) => [id, spec.parts[id].ramp])),
    labels: Object.fromEntries(ids.map((id) => [id, spec.parts[id].label])),
    codes: Object.fromEntries(Object.entries(PARTS).map(([n, p]) => [n, p.code])),
    locked: {}, soft: {},
  };
  if (cls)
    cls.cells.forEach((c, k) => {
      if (!c || !c.letter) return;
      if (c.cls === 'copy') td.locked[k] = c.letter;
      else if (c.cls === 'transform') td.soft[k] = c.letter;
    });
  td.hash = templateHash(td);
  return td;
}
