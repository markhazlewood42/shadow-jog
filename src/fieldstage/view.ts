/**
 * The rules of a map the field stage will show (M5 task 5; docs/engine/m5-brief.md section 5). The types the stage reads (`StageMap`, `FieldStageView`,
 * `FieldStageSource`) live in `src/scenes/fieldkit/fieldseam.ts`, because the field implements them and may not import the stage.
 */
import { TS } from '../field/tiles';
import type { StageMap } from '../scenes/fieldkit/fieldseam';

export type { FieldStageSource, FieldStageView, StageActor, StageChest, StageMap } from '../scenes/fieldkit/fieldseam';

const COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Check a map before the stage shows it (`loadMap` runs this first, like `checkStageConfig` for the battle stage). Returns one line for each problem; an empty list means
 * the map is fine. A layer of the wrong size or a light that cannot be painted would show up as a half-drawn field, so they are refused before anything is torn down.
 */
export function checkStageMap(m: StageMap): string[] {
  const bad: string[] = [];
  if (!m.def.id) bad.push('the map has no id');
  if (!Number.isInteger(m.w) || !Number.isInteger(m.h) || m.w < 1 || m.h < 1) bad.push(`the map size ${String(m.w)}x${String(m.h)} tiles is not a whole size of at least 1x1`);
  const pw = m.w * TS;
  const ph = m.h * TS;
  for (const name of ['ground', 'emit', 'over', 'overEmit'] as const) {
    const c = m[name] as HTMLCanvasElement | undefined;
    if (!c) bad.push(`the ${name} layer is missing`);
    else if (c.width !== pw || c.height !== ph) bad.push(`the ${name} layer is ${c.width}x${c.height} but the map is ${pw}x${ph} pixels`);
  }
  if (!COLOR.test(m.def.ambient)) bad.push(`the ambient color "${m.def.ambient}" is not #rgb or #rrggbb`);
  m.lights.forEach((l, i) => {
    if (![l.x, l.y, l.r, l.i].every(Number.isFinite)) bad.push(`light ${i} has a number that is not finite`);
    else if (l.r <= 0) bad.push(`light ${i} has a radius of ${l.r}, which must be above 0`);
    else if (l.i < 0) bad.push(`light ${i} has an intensity of ${l.i}, which must be 0 or more`);
    if (!COLOR.test(l.color)) bad.push(`light ${i} has the color "${l.color}", which is not #rgb or #rrggbb`);
  });
  if (m.hasOver) {
    m.overRects.forEach((r, i) => {
      if (r.w < 1 || r.h < 1 || r.x < 0 || r.y < 0 || r.x + r.w > pw || r.y + r.h > ph) bad.push(`over rectangle ${i} (${r.x},${r.y} ${r.w}x${r.h}) is not inside the ${pw}x${ph} map`);
    });
  }
  m.sprites.forEach((s, i) => {
    if (![s.x, s.y, s.baseY].every(Number.isFinite)) bad.push(`sprite ${i} has a position that is not finite`);
    if (s.canvas.width < 1 || s.canvas.height < 1) bad.push(`sprite ${i} has no picture`);
  });
  return bad;
}
