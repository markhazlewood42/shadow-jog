/**
 * The field camera rule, shared by the scene's own camera (`FieldScene.targetCam`) and the
 * scripted `pan()` (fieldkit/api.ts), so a cutscene pan lands exactly where the camera would rest.
 *
 * The camera's origin is the top-left corner of the view, in map pixels. The camera looks at a
 * focus point (the leader, or a point a script names) and keeps the view inside the map. A map
 * smaller than the view cannot fill it: the map is centered instead, which puts the origin at a
 * negative offset and leaves even margins all round (the field paints its void or brick shell
 * there). The rule is pure, so a unit test can check it without a canvas.
 */
import { H, W } from '../../engine/game';

/** Where the view's top-left corner goes for a focus point (fx, fy) on a map of mw by mh pixels. */
export function cameraOrigin(fx: number, fy: number, mw: number, mh: number): { x: number; y: number } {
  return { x: axisOrigin(fx, mw, W), y: axisOrigin(fy, mh, H) };
}

/** One axis: center a map that is smaller than the view, else keep the view inside the map. */
function axisOrigin(focus: number, mapSize: number, viewSize: number): number {
  if (mapSize <= viewSize) return Math.round((mapSize - viewSize) / 2);
  return Math.max(0, Math.min(mapSize - viewSize, Math.round(focus - viewSize / 2)));
}
