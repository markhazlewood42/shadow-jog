/**
 * Presenter: draws the back buffer into the canvas as ONE nearest-sampled sprite, scaled by a
 * whole number `k`, in DEVICE pixels (docs/engine/frame-and-rendering.md 6.2 and 6.6).
 * Follows: Unity Pixel Perfect Camera, Godot integer stretch. Today's `display.ts` does the same
 * job with Canvas 2D.
 *
 * With a whole-number `k` and nearest sampling, each game pixel becomes an exact k-by-k block.
 * A fractional scale (2.5) gives uneven pixels, so `k` is always a whole number.
 */
import { Container, Sprite } from 'pixi.js';
import { H, W } from '../core/size';
import type { BackBuffer, Pixels } from './backbuffer';
import type { PixiRenderer } from './pixirenderer';

/**
 * The integer scale for a window, in device pixels. This is `integer` mode of `Display`
 * (docs/engine/frame-and-rendering.md 6.6): `k = max(1, floor(fit * dpr))`, where `fit` is how
 * many times the picture fits in the window in CSS pixels. Pure, so a test can check it.
 * Stand-in for the full `Display` class, which arrives with M1.
 */
export function integerScale(viewW: number, viewH: number, dpr: number): number {
  const fit = Math.min(viewW / W, viewH / H);
  return Math.max(1, Math.floor(fit * dpr + 1e-9));
}

/**
 * Where to put the canvas's top-left corner, along one axis, in CSS pixels, so it sits on a WHOLE
 * DEVICE PIXEL and the browser never has to resample it. `freeCss` is the room left over (window
 * minus canvas, in CSS pixels). The result is at most half of it.
 *
 * At a device pixel ratio of p/q (1.25 is 5/4, 1.5 is 3/2) a CSS length is a whole number of
 * device pixels only when it is a multiple of q. So the offset is rounded down to a multiple of q
 * CSS pixels. It is also an exact multiple of 1/64 then, which is how finely the browser lays out
 * (a value such as 17.6 is not, and the browser rounds it its own way). A ratio with no small q
 * (a odd zoom level such as 1.1) falls back to whole device pixels.
 */
export function alignedOffset(freeCss: number, dpr: number): number {
  const half = Math.max(0, freeCss) / 2;
  for (let q = 1; q <= 64; q++) {
    if (Math.abs(dpr * q - Math.round(dpr * q)) < 1e-9) return Math.floor(half / q) * q;
  }
  return Math.floor(half * dpr) / dpr;
}

export class Presenter {
  private readonly root = new Container({ label: 'present' });
  private readonly sprite: Sprite;
  private _k = 1;

  constructor(
    private readonly pixi: PixiRenderer,
    backBuffer: BackBuffer,
  ) {
    this.sprite = new Sprite(backBuffer.texture);
    this.sprite.label = 'back buffer';
    this.root.addChild(this.sprite);
  }

  get k(): number {
    return this._k;
  }

  /**
   * Set the integer scale. The canvas backing store becomes W*k by H*k device pixels. Resizing a
   * canvas clears it, so draw a frame afterwards.
   */
  setScale(k: number): void {
    if (!Number.isInteger(k) || k < 1) throw new Error(`Presenter scale must be a whole number of 1 or more, got ${k}`);
    this._k = k;
    this.sprite.scale.set(k);
    this.pixi.resize(W * k, H * k);
  }

  /** Draw the back buffer into the canvas. */
  present(): void {
    this.pixi.renderer.render({ container: this.root, clear: true });
  }

  /**
   * Read the canvas itself (what the player sees), top row first. Call it in the SAME task as
   * `present()`: a WebGL canvas without `preserveDrawingBuffer` is only valid until the browser
   * draws the page. Slow: tests and dev tools only.
   */
  readCanvas(): Pixels {
    const gl = this.pixi.renderer.gl;
    const w = W * this._k;
    const h = H * this._k;
    const bottomUp = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
    // GL rows run bottom to top. Flip them so row 0 is the top, like every image.
    const data = new Uint8Array(w * h * 4);
    const row = w * 4;
    for (let y = 0; y < h; y++) data.set(bottomUp.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    return { w, h, data };
  }
}
