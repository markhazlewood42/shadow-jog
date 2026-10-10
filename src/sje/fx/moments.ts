/**
 * Playing one layer of a moment on any `FxState`: the engine side of `playMoment` (src/engine/moments.ts is the old path's copy and calls `postfx`).
 * `FxSystem.playMoment` uses this, so a moment plays on an effects system with no scene (the editor contract, m2-brief.md section 2, point 9e).
 * The same layer kinds and the same math as the old file: `weight` scales the layers marked `weighted`, `angle` turns the ones marked `aim`.
 */
import type { FxData, MomentLayer } from './fxdata';
import type { FxState } from './fxstate';

export interface MomentOpts {
  angle?: number;
  weight?: number;
}

/** Fire one layer of a moment at (x, y), now. */
export function fireLayer(fx: FxState, data: FxData, l: MomentLayer, x: number, y: number, o: MomentOpts): void {
  const px = x + (l.dx ?? 0), py = y + (l.dy ?? 0);
  const w = l.weighted ? (o.weight ?? 1) : 1;
  if (l.emit) {
    const p = data.presets[l.emit];
    if (p) fx.emit(p, px, py, { ...(l.aim && o.angle !== undefined ? { angle: o.angle } : {}), scale: (l.scale ?? 1) * w });
  }
  if (l.shock) fx.shock(px, py, l.shock);
  if (l.aberrate) fx.aberrate(l.aberrate * w, px, py);
  if (l.flare) fx.flare(l.flare * w);
  if (l.haze) fx.haze(px, py, l.haze);
  if (l.glitch) fx.glitch(px, py, { ...l.glitch, strength: (l.glitch.strength ?? 6) * w });
  if (l.dim) fx.dim(l.dim.amount ?? 0.5, l.dim.life ?? 60);
}
