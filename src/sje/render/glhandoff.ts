/**
 * GlHandoff: the ONE module that moves the WebGL context between Pixi, Three and raw GL
 * (docs/engine/frame-and-rendering.md 7.3). Only this file may touch GL state.
 *
 * Why it exists. Pixi and Three share one context and each keeps its OWN cache of "what GL state
 * is set". When one draws, the other's cache is wrong. Two cures:
 *   1. `resetState()` on the library that is about to draw, so it forgets its cache.
 *   2. The clear-colour fix. Pixi 8.22 `resetState()` sets its clear-colour CACHE to (0,0,0,0)
 *      but does not call `gl.clearColor`. Three leaves its scene background as the real clear
 *      colour. Pixi then clears its filter and mask textures with Three's colour (lab: 768 wrong
 *      pixels per 6 frames). So after Three draws we call `three.resetState()` AGAIN and set
 *      `gl.clearColor(0,0,0,0)` ourselves. Re-test this on every Pixi bump.
 *
 * In B0 there is no Three yet, so the per-frame call is only `beginPixi()`. The Three side takes
 * a structural type (anything with `resetState()`), so this file never imports `three`.
 *   TODO(M1b): type `ThreeLike` as the real `WebGLRenderer` once the 3D chunk exists, add
 *   `Frame3D` and the canary test that the plain smoke test hides (a back buffer, a filtered
 *   container with a transparent gap, and a non-black Three background).
 */
import type { PixiRenderer } from './pixirenderer';

/** The one method of the Three renderer that the hand-off needs. */
export interface ThreeLike {
  resetState(): void;
}

export class GlHandoff {
  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly pixi: PixiRenderer,
  ) {}

  /** Before Three draws: Three forgets its cached GL state. */
  beginThree(three: ThreeLike): void {
    three.resetState();
  }

  /** After Three draws: forget its state again, then undo the stale clear colour it left behind. */
  endThree(three: ThreeLike): void {
    three.resetState();
    this.gl.clearColor(0, 0, 0, 0);
  }

  /** Before Pixi draws the frame: Pixi forgets its cached GL state. */
  beginPixi(): void {
    this.pixi.resetState();
  }
}
