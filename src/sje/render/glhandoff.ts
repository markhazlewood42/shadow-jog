/**
 * GlHandoff: the ONE module that moves the WebGL context between Pixi, Three and raw GL
 * (docs/engine/frame-and-rendering.md 7.3). Only this file may touch GL state.
 *
 * Why it exists. Pixi and Three share one context and each keeps its OWN cache of "what GL state
 * is set". When one draws, the other's cache is wrong. Two cures:
 *   1. `resetState()` on the library that is about to draw, so it forgets its cache.
 *   2. The clear-color fix. Pixi 8.22 `resetState()` sets its clear-color CACHE to (0,0,0,0)
 *      but does not call `gl.clearColor`. Three leaves its scene background as the real clear
 *      color. Pixi then clears its filter and mask textures with Three's color (lab: 768 wrong
 *      pixels per 6 frames). So after Three draws we call `three.resetState()` AGAIN and set
 *      `gl.clearColor(0,0,0,0)` ourselves. Re-test this on every Pixi bump.
 *
 * The per-frame order when a 3D view is on screen:
 *
 *      beginThree(three)   ->   three renders into its render target   ->   endThree(three)
 *      beginPixi()         ->   Pixi draws the screen into the back buffer, then the canvas
 *
 * This file never imports `three` (only src/sje/three and src/hack3d may, and this is level 1). It
 * asks for the one method it needs, `resetState()`, in a structural type. The real
 * `THREE.WebGLRenderer` has that method, so it can be passed as it is.
 *
 * Everything else in the engine that must touch raw GL goes through here too, so a search for
 * "who changes GL state" has one answer:
 *   - `prepareForThree()`          pixel-store flags, once, before the Three renderer is made
 *   - `readDefaultFramebuffer()`   the canvas pixels (tests and dev tools)
 *   - `drainErrors()`              the GL error flags (tests)
 */
import type { PixiRenderer } from './pixirenderer';

/** The one method of the Three renderer that the hand-off needs. */
export interface ThreeLike {
  resetState(): void;
}

export class GlHandoff {
  // Test switch: false skips the end-of-Three clean up, to prove that the canary test notices (see `setClearColorFix`).
  private clearColorFix = true;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly pixi: PixiRenderer,
  ) {}

  /**
   * Before the Three renderer is made, once. Pixi has uploaded textures by now and left two
   * pixel-store flags set; with them set, Three's start-up logs two INVALID_OPERATION warnings
   * (lab, rule 3 in frame-and-rendering.md 7.2). Unset, both are the GL default.
   */
  prepareForThree(): void {
    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, false);
    this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  /** Before Three draws: Three forgets its cached GL state. */
  beginThree(three: ThreeLike): void {
    three.resetState();
  }

  /** After Three draws: forget its state again, then undo the stale clear color it left behind. */
  endThree(three: ThreeLike): void {
    if (!this.clearColorFix) return;
    three.resetState();
    this.gl.clearColor(0, 0, 0, 0);
  }

  /**
   * Run `draw` (Three renders) between `beginThree` and `endThree`. `endThree` runs even if `draw`
   * throws, so a failed Three frame cannot leave Pixi with Three's GL state.
   */
  withThree<T>(three: ThreeLike, draw: () => T): T {
    this.beginThree(three);
    try {
      return draw();
    } finally {
      this.endThree(three);
    }
  }

  /** Before Pixi draws the frame: Pixi forgets its cached GL state. */
  beginPixi(): void {
    this.pixi.resetState();
  }

  /**
   * TEST ONLY. Switch the end-of-Three clean up off, to show the canary test sees the bug it
   * guards (a "negative control": a test that cannot fail proves nothing). Never call this in the game.
   */
  setClearColorFix(on: boolean): void {
    this.clearColorFix = on;
  }

  /**
   * Read a rectangle of the canvas (the default framebuffer) back to the CPU, bottom row first, as GL
   * stores it. `x` and `yFromBottom` are the rectangle's lower-left corner, counted from the
   * canvas's lower-left corner (GL's own origin). Slow: tests and dev tools only. Call it in the SAME
   * task as the draw: a WebGL canvas without `preserveDrawingBuffer` is only valid until the browser
   * paints the page.
   */
  readDefaultFramebuffer(x: number, yFromBottom: number, width: number, height: number): Uint8Array {
    const gl = this.gl;
    const bottomUp = new Uint8Array(width * height * 4);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.readPixels(x, yFromBottom, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
    // The read binding is not Pixi's to know about: make Pixi re-read its state before it draws.
    this.pixi.resetState();
    return bottomUp;
  }

  /** TEST ONLY. Every GL error flag that is set right now (reading clears each one). Empty when there is none. */
  drainErrors(): number[] {
    const out: number[] = [];
    // Real GL has one flag per kind of error; a lost context answers NO_ERROR forever, so cap the loop.
    for (let i = 0; i < 16; i++) {
      const e = this.gl.getError();
      if (e === this.gl.NO_ERROR) break;
      out.push(e);
    }
    return out;
  }
}
