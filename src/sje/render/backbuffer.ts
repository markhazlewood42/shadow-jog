/**
 * BackBuffer: the 480x270 picture. Pixi draws the whole screen into this render target at
 * resolution 1, with nearest scaling. Every filter runs inside it (game resolution), so after the
 * integer upscale every game pixel is an exact block (docs/engine/frame-and-rendering.md 6.2, 6.3).
 */
import { type Container, RenderTexture } from 'pixi.js';
import { H, W } from '../core/size';
import type { PixiRenderer } from './pixirenderer';

/** The colour of the void behind everything (the game's own near-black), as 0 to 1 RGBA. */
const VOID: [number, number, number, number] = [7 / 255, 6 / 255, 13 / 255, 1];

export interface Pixels {
  w: number;
  h: number;
  /** RGBA, top row first, 4 bytes per pixel. */
  data: Uint8Array;
}

export class BackBuffer {
  /** @internal The render target. Allowed under src/sje/render and src/sje/display only. */
  readonly texture: RenderTexture;

  constructor(private readonly pixi: PixiRenderer) {
    this.texture = RenderTexture.create({ width: W, height: H, resolution: 1, scaleMode: 'nearest' });
  }

  /** Draw `root` (the screen root) into the back buffer, clearing it first. */
  render(root: Container): void {
    this.pixi.renderer.render({ container: root, target: this.texture, clear: true, clearColor: VOID });
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
