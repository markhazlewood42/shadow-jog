/**
 * Presenter: draws the back buffer into the canvas as ONE nearest-sampled sprite, scaled by a
 * whole number `k`, in DEVICE pixels (docs/engine/frame-and-rendering.md 6.2 and 6.6).
 * Follows: Unity Pixel Perfect Camera, Godot integer stretch. Today's `display.ts` does the same
 * job with Canvas 2D.
 *
 * With a whole-number `k` and nearest sampling, each game pixel becomes an exact k-by-k block.
 * A fractional scale (2.5) gives uneven pixels, so `k` is always a whole number.
 *
 * @deviation from frame-and-rendering.md 6.6 (drift item 10 in docs/spikes/engine-platform.md): THE CANVAS IS THE WHOLE WINDOW, IN DEVICE PIXELS
 * (B2 change, spike finding 10). Its backing store
 * is exactly as many pixels as the window has on the screen, so the browser shows it 1:1 and never
 * resamples it. The 640x360 picture sits inside it, at a WHOLE device pixel offset, scaled by `k`;
 * the rest is the void colour (letterbox bars). B0 sized the canvas to the picture (W*k by H*k) and
 * let CSS shrink it by the device pixel ratio. That is not exact when the picture's size divided by
 * the ratio is not a multiple of 1/64 of a CSS pixel (the layout unit): at ratio 2.25 and zoom 7 the
 * browser drew 2651 uneven blocks (lab, Edge), and at 1.75 and 1.1 as well. A canvas the size of the
 * window has none of that problem, and it is how WebGL pages are sized in general.
 */
import { Container, Sprite } from 'pixi.js';
import { H, W } from '../core/size';
import { type BackBuffer, flipRows, type Pixels } from './backbuffer';
import type { GlHandoff } from './glhandoff';
import type { PixiRenderer } from './pixirenderer';

/** The colour of the letterbox bars (the game's own near-black, as 0 to 1 RGBA): the same as the back buffer's void. */
const BARS: [number, number, number, number] = [7 / 255, 6 / 255, 13 / 255, 1];

/** Where the picture sits in the canvas, in device pixels. */
export interface PictureLayout {
  /** The whole number of device pixels per game pixel. */
  k: number;
  /** Top-left corner of the picture in the canvas. Never negative. */
  x: number;
  y: number;
  /** The picture's size: W*k and H*k. */
  w: number;
  h: number;
}

/**
 * How big the canvas must be, in device pixels, for a window of `viewW` x `viewH` CSS pixels at
 * device pixel ratio `dpr`. A real browser knows this exactly (`devicePixelContentBoxSize`); pass it
 * as `observed` and it is used IF it agrees with the arithmetic to within 1 pixel. Browsers that do
 * not have it, and test tools that emulate a ratio (Playwright reports the CSS size there, not the
 * device size), get the arithmetic: the window's CSS size times the ratio, rounded.
 */
export function deviceSize(viewW: number, viewH: number, dpr: number, observed?: { w: number; h: number }): { w: number; h: number } {
  const w = Math.max(1, Math.round(viewW * dpr));
  const h = Math.max(1, Math.round(viewH * dpr));
  if (observed && Math.abs(observed.w - w) <= 1 && Math.abs(observed.h - h) <= 1) return { w: Math.max(1, observed.w), h: Math.max(1, observed.h) };
  return { w, h };
}

/**
 * The integer scale and the picture's place for a canvas of `deviceW` x `deviceH` device pixels
 * (`integer` mode of `Display`, frame-and-rendering.md 6.6): the largest whole `k` for which the
 * picture fits, at least 1, centred on a whole device pixel. A canvas smaller than the picture pins
 * it to the top-left corner. Pure, so a test can check it.
 */
export function pictureLayout(deviceW: number, deviceH: number): PictureLayout {
  const k = Math.max(1, Math.floor(Math.min(deviceW / W, deviceH / H) + 1e-9));
  const w = W * k;
  const h = H * k;
  return { k, w, h, x: Math.max(0, Math.floor((deviceW - w) / 2)), y: Math.max(0, Math.floor((deviceH - h) / 2)) };
}

/**
 * The integer scale for a window, from its CSS size and device pixel ratio. Same as
 * `pictureLayout(deviceSize(...)).k`.
 */
export function integerScale(viewW: number, viewH: number, dpr: number): number {
  const d = deviceSize(viewW, viewH, dpr);
  return pictureLayout(d.w, d.h).k;
}

export class Presenter {
  private readonly root = new Container({ label: 'present' });
  private readonly sprite: Sprite;
  private _layout: PictureLayout = { k: 1, x: 0, y: 0, w: W, h: H };
  private canvasW: number = W;
  private canvasH: number = H;

  constructor(
    private readonly pixi: PixiRenderer,
    backBuffer: BackBuffer,
    private readonly handoff: GlHandoff,
  ) {
    this.sprite = new Sprite(backBuffer.texture);
    this.sprite.label = 'back buffer';
    this.root.addChild(this.sprite);
  }

  get k(): number {
    return this._layout.k;
  }

  /** Where the picture is in the canvas, in device pixels. */
  get layout(): PictureLayout {
    return this._layout;
  }

  /** The canvas's size in device pixels. */
  get canvasSize(): { w: number; h: number } {
    return { w: this.canvasW, h: this.canvasH };
  }

  /**
   * Make the canvas `deviceW` x `deviceH` device pixels and put the picture in it. Resizing a canvas
   * clears it, so draw a frame afterwards. Returns the layout.
   */
  setCanvasSize(deviceW: number, deviceH: number): PictureLayout {
    if (!Number.isInteger(deviceW) || !Number.isInteger(deviceH) || deviceW < 1 || deviceH < 1) throw new Error(`Presenter canvas size must be whole device pixels of 1 or more, got ${deviceW}x${deviceH}`);
    const layout = pictureLayout(deviceW, deviceH);
    this._layout = layout;
    this.canvasW = deviceW;
    this.canvasH = deviceH;
    this.sprite.scale.set(layout.k);
    this.sprite.position.set(layout.x, layout.y);
    this.pixi.resize(deviceW, deviceH);
    return layout;
  }

  /** Draw the back buffer into the canvas. */
  present(): void {
    this.pixi.renderer.render({ container: this.root, clear: true, clearColor: BARS });
  }

  /**
   * Read the PICTURE out of the canvas (what the player sees, without the bars), top row first. Call
   * it in the SAME task as `present()`: a WebGL canvas without `preserveDrawingBuffer` is only valid
   * until the browser draws the page. Slow: tests and dev tools only.
   *
   * A canvas SMALLER than the picture (a tiny window) shows only the top-left part of it, so only that
   * part is read: asking GL for pixels outside the canvas would give the zeros of an empty read.
   */
  readCanvas(): Pixels {
    const { x, y } = this._layout;
    const w = Math.min(this._layout.w, this.canvasW - x);
    const h = Math.min(this._layout.h, this.canvasH - y);
    // GL counts rows from the BOTTOM of the canvas; `y` counts from the top.
    const bottomUp = this.handoff.readDefaultFramebuffer(x, this.canvasH - (y + h), w, h);
    return { w, h, data: flipRows(bottomUp, w, h) };
  }
}
