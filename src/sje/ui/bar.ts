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

/** The rectangles of a bar, in the order they are painted, relative to the track's top-left corner. */
export function barRects(w: number, h: number, ratio: number, color: string, p: BarParams = UI_DEFAULTS.bar): BarRect[] {
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
  return out;
}

export class Bar extends Graphics {
  private _w: number;
  private _h: number;
  private _ratio: number;
  private _color: string;
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
    for (const r of barRects(this._w, this._h, this._ratio, this._color, this.params)) this.fillStyle(parseColor(r.color), r.alpha).fillRect(r.x, r.y, r.w, r.h);
  }
}
