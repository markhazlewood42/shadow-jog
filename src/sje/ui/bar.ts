/**
 * Bar: a filled meter (a health bar, a volume slider's track) as a display object (UI kit, M8a). The old `drawBar` of `src/ui/draw.ts`.
 *
 * It is a `Graphics`: a dark outline one pixel round the track, the empty color, the filled part, and a one-pixel shine on top of the fill. x,y is the
 * track's top-left corner (the outline sits one pixel outside it). `setRatio` changes the fill; nothing is repainted when the number is the same.
 * `barRects` is the plain list of rectangles it paints, so a test (or a tool) can read them without a GPU.
 */
import { parseColor } from '../display/cameraeffects';
import type { DisplayHost } from '../display/gameobject';
import { Graphics } from '../display/graphics';
import { type BarParams, UI, UI_DEFAULTS } from './params';

export interface BarRect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  alpha: number;
}

/** A stretch painted after the fill, from the fill's end to its own ratio: the pale ghost of a hit's damage, or the gained part of a level-up bar (M8c). */
export interface BarGhost {
  ratio: number;
  color: string;
}

/** The rectangles of a bar, in the order they are painted, relative to the track's top-left corner. A ghost adds one more, when it reaches past the fill. */
export function barRects(w: number, h: number, ratio: number, color: string, p: BarParams = UI_DEFAULTS.bar, ghost?: BarGhost | null): BarRect[] {
  const r = Math.max(0, Math.min(1, ratio));
  const out: BarRect[] = [
    { x: -1, y: -1, w: w + 2, h: h + 2, color: UI.outline, alpha: 1 },
    { x: 0, y: 0, w, h, color: p.back, alpha: 1 },
  ];
  const fw = Math.round(w * r);
  if (fw > 0) {
    out.push({ x: 0, y: 0, w: fw, h, color, alpha: 1 });
    out.push({ x: 0, y: 0, w: fw, h: 1, color: '#ffffff', alpha: p.shineAlpha });
  }
  if (ghost) {
    // The old drawLag: from the fill's end (rounded) to the ghost's end (rounded), when that is more than nothing.
    const a = Math.round(w * r);
    const b = Math.round(w * Math.max(0, Math.min(1, ghost.ratio)));
    if (b > a) out.push({ x: a, y: 0, w: b - a, h, color: ghost.color, alpha: 1 });
  }
  return out;
}

export class Bar extends Graphics {
  private _w: number;
  private _h: number;
  private _ratio: number;
  private _color: string;
  private _ghost: BarGhost | null = null;
  private readonly params: BarParams;

  constructor(scene: DisplayHost, x: number, y: number, w: number, h: number, color: string = UI.cyan, ratio = 1, params: Partial<BarParams> = {}) {
    super(scene, x, y);
    this._w = w;
    this._h = h;
    this._ratio = Math.max(0, Math.min(1, ratio));
    this._color = color;
    this.params = { ...UI_DEFAULTS.bar, ...params };
    this.name = 'bar';
    this.paint();
  }

  get ratio(): number {
    return this._ratio;
  }

  /** The fill, 0 to 1 (clamped). */
  setRatio(ratio: number): this {
    const r = Math.max(0, Math.min(1, ratio));
    if (r === this._ratio) return this;
    this._ratio = r;
    this.paint();
    return this;
  }

  /** A ghost stretch from the fill's end to the ghost ratio, or none (null). Nothing is repainted when it is the same as before. */
  setGhost(ghost: BarGhost | null): this {
    const g = this._ghost;
    if (g === ghost || (g && ghost && g.ratio === ghost.ratio && g.color === ghost.color)) return this;
    this._ghost = ghost;
    this.paint();
    return this;
  }

  setColor(color: string): this {
    if (color === this._color) return this;
    this._color = color;
    this.paint();
    return this;
  }

  setSize(w: number, h: number): this {
    if (w === this._w && h === this._h) return this;
    this._w = w;
    this._h = h;
    this.paint();
    return this;
  }

  private paint(): void {
    this.clear();
    for (const r of barRects(this._w, this._h, this._ratio, this._color, this.params, this._ghost)) this.fillStyle(parseColor(r.color), r.alpha).fillRect(r.x, r.y, r.w, r.h);
  }
}
