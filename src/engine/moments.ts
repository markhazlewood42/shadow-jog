/**
 * Playing a moment (engine/fxdata.ts): every layer at the moment's point, each after its delay.
 * `weight` scales the layers marked `weighted` (a heavier blow, a bigger burst); `angle` (degrees)
 * turns the layers marked `aim` the way the blow travelled. A no-op with GPU effects off.
 */
import type { FxData, MomentLayer } from './fxdata';
import { postfx } from './postfx';

export interface MomentOpts {
  angle?: number;
  weight?: number;
}

function fire(fx: FxData, l: MomentLayer, x: number, y: number, o: MomentOpts): void {
  const px = x + (l.dx ?? 0), py = y + (l.dy ?? 0);
  const w = l.weighted ? (o.weight ?? 1) : 1;
  if (l.emit) {
    const p = fx.presets[l.emit];
    if (p) postfx.emit(p, px, py, { ...(l.aim && o.angle !== undefined ? { angle: o.angle } : {}), scale: (l.scale ?? 1) * w });
  }
  if (l.shock) postfx.shock(px, py, l.shock);
  if (l.aberrate) postfx.aberrate(l.aberrate * w, px, py);
  if (l.flare) postfx.flare(l.flare * w);
}

/** Play `name` from `fx` at (x, y), in screen pixels. Unknown names do nothing. */
export function playMoment(fx: FxData, name: string, x: number, y: number, o: MomentOpts = {}): void {
  if (!postfx.active) return;
  const m = fx.moments[name];
  if (!m) return;
  for (const l of m.layers) {
    if (l.delay && l.delay > 0) postfx.later(l.delay, () => fire(fx, l, x, y, o));
    else fire(fx, l, x, y, o);
  }
}
