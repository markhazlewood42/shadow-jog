/**
 * BackBuffer: the 640x360 picture. Pixi draws the whole screen into this render target at
 * resolution 1, with nearest scaling. Every filter runs inside it (game resolution), so after the
 * integer upscale every game pixel is an exact block (docs/engine/frame-and-rendering.md 6.2, 6.3).
 */
import { type Container, RenderTexture } from 'pixi.js';
import { H, W } from '../core/size';
import type { PixiRenderer } from './pixirenderer';

/** The color of the void behind everything (the game's own near-black), as 0 to 1 RGBA. */
const VOID: [number, number, number, number] = [7 / 255, 6 / 255, 13 / 255, 1];

export interface Pixels {
  w: number;
  h: number;
  /** RGBA, top row first, 4 bytes per pixel. */
  data: Uint8Array;
}

/** GL hands pixels back bottom row first. Flip the rows so row 0 is the top, like every image. */
export function flipRows(bottomUp: Uint8Array, w: number, h: number): Uint8Array {
  const data = new Uint8Array(w * h * 4);
  const row = w * 4;
  for (let y = 0; y < h; y++) data.set(bottomUp.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  return data;
}

export class BackBuffer {
  /** What the back buffer is cleared to each frame. The void color, except in the hand-off canary (see `setClearColor`). */
  private clearColor: [number, number, number, number] = VOID;

  /** @internal The render target. Allowed under src/sje/render and src/sje/display only. */
  readonly texture: RenderTexture;

  constructor(private readonly pixi: PixiRenderer) {
    this.texture = RenderTexture.create({ width: W, height: H, resolution: 1, scaleMode: 'nearest' });
  }

  /** Draw `root` (the screen root) into the back buffer, clearing it first. */
  render(root: Container): void {
    this.pixi.renderer.render({ container: root, target: this.texture, clear: true, clearColor: this.clearColor });
  }

  /**
   * TEST ONLY. Clear to another color. The hand-off canary (e2e/sje3d.spec.ts) sets TRANSPARENT black,
   * (0,0,0,0): that is the one clear color that equals what Pixi believes the GL clear color is right
   * after `GlHandoff.beginPixi()`, so Pixi then skips its own `gl.clearColor` call and clears with whatever
   * Three left behind. The normal void color is not (0,0,0,0), so it hides the bug. `null` goes back to the void.
   */
  setClearColor(rgba: [number, number, number, number] | null): void {
    this.clearColor = rgba ?? VOID;
  }

  /** Read the back buffer back to the CPU (slow: tests and dev tools only). */
  pixels(): Pixels {
    const out = this.pixi.renderer.extract.pixels(this.texture);
    return { w: out.width, h: out.height, data: new Uint8Array(out.pixels.buffer, out.pixels.byteOffset, out.pixels.byteLength) };
  }

  destroy(): void {
    this.texture.destroy(true);
  }
}
