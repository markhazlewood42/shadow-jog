/**
 * NineSlice: the game's window frame as a display object (UI kit, M8a; docs/engine/interfaces.md `NineSlice`, "for window frames").
 * Follows: Phaser `NineSlice` (a frame of nine parts that resizes without stretching its corners) and the old `drawWindow` of `src/ui/draw.ts`.
 *
 * The nine parts here are not cut from a bitmap. They are the pieces `drawWindow` always drew: four corners (the accent brackets), four edges (the
 * outline, the lit frame, the tick marks) and a middle (the dark gradient and the scanlines). `setSize` paints the same pieces for the new size, so the
 * corners keep their size and the edges and the middle grow, which is the nine-slice idea. The numbers are `drawWindow`'s: a test draws both onto a
 * recording canvas and compares every call.
 *
 * x,y is the window's top-left corner, as in `drawWindow(ctx, x, y, w, h)`. The picture reaches a little past the window (the drop shadow to the
 * lower right, the title tab above, the key legend below): `windowBounds` says how far, and the object's origin is set so x,y stays on the corner.
 *
 * @deviation from interfaces.md: it extends `ImageObject` (a painted canvas), not a bare `GameObject`, and its size is `boxW`/`boxH` (`width` and `height`
 * are the picture's size, with the shadow and the tab).
 */
import { drawText, measure } from '../display/font';
import type { DisplayHost } from '../display/gameobject';
import { ImageObject } from '../display/imageobject';
import { OwnedTexture } from './ownedtexture';
import { UI, UI_DEFAULTS, type WindowParams } from './params';

export interface WindowStyle {
  /** The corner brackets and the title tab's color (default cyan). */
  accent?: string | undefined;
  /** A small tab on the top edge. */
  title?: string | undefined;
  /** Body opacity, 0 to 1 (default 0.95). */
  alpha?: number | undefined;
  /** No corner brackets (compact popups). */
  plain?: boolean | undefined;
  /** A small tab on the lower edge, right-aligned: the key reminder on menu screens. */
  footer?: string | undefined;
}

/** How far the picture of a window reaches, relative to the window's top-left corner. */
export interface WindowBounds {
  /** The picture's size. */
  w: number;
  h: number;
  /** Where the window's top-left corner is inside the picture. */
  padL: number;
  padT: number;
}

const TAB_H = 10;

export function windowBounds(w: number, h: number, style: WindowStyle = {}, p: WindowParams = UI_DEFAULTS.window): WindowBounds {
  w = Math.round(w);
  h = Math.round(h);
  let minX = 0;
  let minY = 0;
  let maxX = w + p.shadowOffset;
  let maxY = h + p.shadowOffset;
  if (style.title) {
    // drawTab(ctx, x + 6, y - 5, title): a dark rim one pixel round a tab of measure + 8 by 10.
    const tw = measure(style.title) + 8;
    minX = Math.min(minX, 5);
    minY = Math.min(minY, -5 - 1);
    maxX = Math.max(maxX, 6 + tw + 1);
  }
  if (style.footer) {
    const fw = measure(style.footer) + 8;
    const fx = w - fw - 12;
    const fy = h - 5;
    minX = Math.min(minX, fx - 1);
    maxX = Math.max(maxX, fx + fw + 1);
    maxY = Math.max(maxY, fy - 1 + TAB_H + 2);
  }
  return { w: maxX - minX, h: maxY - minY, padL: 0 - minX, padT: 0 - minY };
}

/** The small label tab that sits on a window's top edge (the old `drawTab`). */
export function paintTab(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, accent: string = UI.cyan): void {
  const w = measure(label) + 8;
  ctx.fillStyle = UI.outline;
  ctx.fillRect(x - 1, y - 1, w + 2, 12);
  ctx.fillStyle = '#12112a';
  ctx.fillRect(x, y, w, 10);
  ctx.fillStyle = accent;
  ctx.fillRect(x, y, 2, 10);
  drawText(ctx, label, x + 5, y + 1, { color: accent });
}

/**
 * Paint the window frame. The same calls, in the same order, with the same numbers, as the old `drawWindow`: the shadow, the gradient body, the
 * scanlines, the outline, the lit frame, the circuit trim and the corner brackets, then the title tab and the key legend.
 */
export function paintWindow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, style: WindowStyle = {}, p: WindowParams = UI_DEFAULTS.window): void {
  x = Math.round(x);
  y = Math.round(y);
  w = Math.round(w);
  h = Math.round(h);
  const accent = style.accent ?? UI.cyan;
  const alpha = style.alpha ?? p.alpha;
  ctx.save();
  // Drop shadow
  ctx.globalAlpha = p.shadowAlpha * alpha;
  ctx.fillStyle = UI.outline;
  ctx.fillRect(x + p.shadowOffset, y + p.shadowOffset, w, h);
  // Body
  ctx.globalAlpha = alpha;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, UI.fillTop);
  g.addColorStop(1, UI.fillBot);
  ctx.fillStyle = g;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  // Scanlines
  ctx.globalAlpha = p.scanAlpha * alpha;
  ctx.fillStyle = '#000';
  for (let yy = y + 3; yy < y + h - 2; yy += 2) ctx.fillRect(x + 2, yy, w - 4, 1);
  ctx.globalAlpha = 1;
  // Outline + frame
  ctx.fillStyle = UI.outline;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);
  ctx.fillStyle = UI.frame;
  ctx.fillRect(x + 1, y + 1, w - 2, 1);
  ctx.fillRect(x + 1, y + h - 2, w - 2, 1);
  ctx.fillRect(x + 1, y + 1, 1, h - 2);
  ctx.fillRect(x + w - 2, y + 1, 1, h - 2);
  ctx.fillStyle = UI.inner;
  ctx.fillRect(x + 2, y + 2, w - 4, 1);
  // Circuit trim, on the frame itself so it never meets the content: solder ticks along the bottom edge, and a lit trace with a node on the top edge's right end.
  if (w >= p.trimMinWidth) {
    ctx.fillStyle = UI.frameLit;
    for (let tx = x + 12; tx < x + w - 12; tx += p.tickStep) ctx.fillRect(tx, y + h - 2, 2, 1);
    ctx.fillStyle = style.plain ? UI.frameLit : accent;
    ctx.fillRect(x + w - 22, y + 1, 8, 1);
    ctx.fillRect(x + w - 13, y + 1, 1, 1);
  }
  if (!style.plain) {
    // Neon corner brackets
    ctx.fillStyle = accent;
    ctx.fillRect(x + 1, y + 1, 7, 1);
    ctx.fillRect(x + 1, y + 1, 1, 5);
    ctx.fillRect(x + w - 8, y + h - 2, 7, 1);
    ctx.fillRect(x + w - 2, y + h - 6, 1, 5);
    ctx.fillStyle = UI.pink;
    ctx.fillRect(x + w - 5, y + 1, 3, 1);
    ctx.fillRect(x + w - 9, y + 1, 2, 1);
  }
  ctx.restore();
  if (style.title) paintTab(ctx, x + 6, y - 5, style.title, accent);
  if (style.footer) {
    const fw = measure(style.footer) + 8;
    const fx = x + w - fw - 12;
    const fy = y + h - 5;
    ctx.fillStyle = UI.outline;
    ctx.fillRect(fx - 1, fy - 1, fw + 2, 12);
    ctx.fillStyle = '#12112a';
    ctx.fillRect(fx, fy, fw, 10);
    drawText(ctx, style.footer, fx + 4, fy + 1, { color: UI.dim });
  }
}

export class NineSlice extends ImageObject {
  private readonly owned: OwnedTexture;
  private readonly params: WindowParams;
  private _boxW: number;
  private _boxH: number;
  private _style: WindowStyle;

  constructor(scene: DisplayHost, x: number, y: number, w: number, h: number, style: WindowStyle = {}, params: Partial<WindowParams> = {}) {
    const p: WindowParams = { ...UI_DEFAULTS.window, ...params };
    const b = windowBounds(w, h, style, p);
    const tex = new OwnedTexture(scene.textures, 'ui-window', b.w, b.h);
    super(scene, x, y, tex.key);
    this.owned = tex;
    this.params = p;
    this._boxW = Math.round(w);
    this._boxH = Math.round(h);
    this._style = { ...style };
    this.name = 'window';
    this.paint(true);
  }

  /** The window's size (the frame, without the shadow and the tabs). */
  get boxW(): number {
    return this._boxW;
  }
  get boxH(): number {
    return this._boxH;
  }
  get style(): Readonly<WindowStyle> {
    return this._style;
  }

  /** Phaser: setSize. Paints the frame again for the new size; the corners keep their size. */
  setSize(w: number, h: number): this {
    this.assertAlive('NineSlice.setSize');
    const rw = Math.round(w);
    const rh = Math.round(h);
    if (rw === this._boxW && rh === this._boxH) return this;
    this._boxW = rw;
    this._boxH = rh;
    this.paint(false);
    return this;
  }

  /** Change some of the style (accent, title, alpha, plain, footer). A key given as `undefined` goes back to its default. */
  setStyle(patch: WindowStyle): this {
    this.assertAlive('NineSlice.setStyle');
    const next: WindowStyle = { ...this._style, ...patch };
    for (const k of Object.keys(next) as (keyof WindowStyle)[]) if (next[k] === undefined) delete next[k];
    const s = this._style;
    if (next.accent === s.accent && next.title === s.title && next.alpha === s.alpha && next.plain === s.plain && next.footer === s.footer) return this;
    this._style = next;
    this.paint(false);
    return this;
  }

  private paint(first: boolean): void {
    const b = windowBounds(this._boxW, this._boxH, this._style, this.params);
    const old = this.owned.resize(b.w, b.h);
    if (old !== null) {
      this.setTexture(this.owned.key);
      this.owned.drop(old);
    }
    const ctx = this.owned.ctx;
    if (!first || old !== null) ctx.clearRect(0, 0, this.owned.width, this.owned.height);
    paintWindow(ctx, b.padL, b.padT, this._boxW, this._boxH, this._style, this.params);
    this.owned.refresh();
    // The window's corner stays on x,y: the origin is the corner's place inside the picture, a whole number of pixels.
    this.setOrigin(b.padL / this.owned.width, b.padT / this.owned.height);
  }

  protected override destroyNode(): void {
    try {
      super.destroyNode();
    } finally {
      this.owned.dispose();
    }
  }
}
