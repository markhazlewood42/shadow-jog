/**
 * The field camera rule, shared by the scene's own camera (`FieldScene.targetCam`) and the
 * scripted `pan()` (fieldkit/api.ts), so a cutscene pan lands exactly where the camera would rest.
 *
 * The camera's origin is the top-left corner of the view, in map pixels. The camera looks at a
 * focus point (the leader, or a point a script names) and keeps the view inside the map. A map
 * smaller than the view cannot fill it: the map is centered instead, which puts the origin at a
 * negative offset and leaves even margins all round (the field paints its surround there,
 * fieldkit/surround.ts). The rule is pure, so a unit test can check it without a canvas.
 */
import { H, W } from '../../sje/core/size';
import type { CameraBox } from './popins';

/**
 * The camera looks this many pixels above the leader's feet, so the hero stands a little below the
 * middle of the screen and more of the way ahead shows (`FieldScene.targetCam`).
 */
export const LEADER_FOCUS_LIFT = 8;

/**
 * Where the view's top-left corner goes for a focus point (fx, fy) on a map of mw by mh pixels.
 * `box` is a camera limit from the pop-in table (`fieldkit/popins.ts`): a side it names replaces
 * the map's own edge as the end of the camera's range, so it can stop the camera short of the edge
 * or let it go past. Null when the map has no limit.
 */
export function cameraOrigin(fx: number, fy: number, mw: number, mh: number, box: CameraBox | null = null): { x: number; y: number } {
  return { x: axisOrigin(fx, mw, W, box?.minX, box?.maxX), y: axisOrigin(fy, mh, H, box?.minY, box?.maxY) };
}

/** One axis: center a map that is smaller than the view, else keep the view inside the map (or inside the limits). */
function axisOrigin(focus: number, mapSize: number, viewSize: number, minLimit?: number, maxLimit?: number): number {
  if (mapSize <= viewSize) return Math.round((mapSize - viewSize) / 2);
  const lo = minLimit ?? 0, hi = maxLimit ?? mapSize - viewSize;
  return Math.max(lo, Math.min(hi, Math.round(focus - viewSize / 2)));
}
