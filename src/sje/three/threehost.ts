/**
 * ThreeHost: makes the Three.js renderer ONCE and keeps it (docs/engine/frame-and-rendering.md
 * 7.2, rules 1 to 3; decision E3). This file is in the lazy 3D chunk: the game downloads Three only
 * when the first 3D scene runs.
 *
 * Two kinds of host:
 *  - SHARED   Three draws on the engine's own canvas and WebGL2 context, the one Pixi uses. The
 *             normal way. There is one per game, made on first use, never per scene entry (a new
 *             Three renderer per entry leaked 5 textures and 3 framebuffers each time, in the lab).
 *  - PRIVATE  Three draws on a canvas of its own (a second context). This is the fallback
 *             (`Frame3D` mode `canvas-copy`). One per game too, kept for the life of the page.
 *
 * Rules that this file keeps, and why:
 *  - Pass BOTH `canvas` and `context`. With only `context`, Three r186 still makes a throwaway
 *    canvas and puts its `webglcontextlost` and `webglcontextrestored` listeners on THAT. Three would
 *    then never hear about a loss or a restore.
 *  - Never call `setSize`, `setViewport` or `setPixelRatio` on the shared renderer. They would
 *    resize the shared canvas, which Pixi owns. The shared renderer only ever draws into render
 *    targets, and each target brings its own viewport.
 *  - Color: `ColorManagement.enabled = false` and `outputColorSpace = LinearSRGBColorSpace`, and no
 *    `OutputPass`. Then a color written as 0xff2080 reaches the picture as 0xff2080. (With the
 *    defaults it comes out as #ff0437: lab, research finding 13.) This is a global of Three, so it
 *    is set when this module loads, before any scene makes a color. Lighting then runs on the raw
 *    numbers, which is fine for flat colors and vertex colors. sRGB textures are not used.
 */
import { ColorManagement, LinearSRGBColorSpace, WebGLRenderer } from 'three';
import { H, W } from '../core/size';
import type { GlRenderer } from '../runtime/glrenderer';

ColorManagement.enabled = false;

export type ThreeHostKind = 'shared' | 'private';

/** How many Three renderers this page has made, by kind. A test reads it: "once, never per entry" must be a number, not a hope. */
export const hostsCreated: Record<ThreeHostKind, number> = { shared: 0, private: 0 };

export class ThreeHost {
  private static readonly sharedHosts = new WeakMap<GlRenderer, ThreeHost>();
  private static readonly privateHosts = new WeakMap<GlRenderer, ThreeHost>();

  private constructor(
    readonly renderer: WebGLRenderer,
    readonly kind: ThreeHostKind,
    /** The canvas Three draws on: the engine's (shared) or its own (private). */
    readonly canvas: HTMLCanvasElement,
  ) {}

  /** The shared-context host of this game. Made on first call. */
  static shared(gl: GlRenderer): ThreeHost {
    const have = ThreeHost.sharedHosts.get(gl);
    if (have) return have;
    // Pixi has uploaded textures by now. Unset its pixel-store flags, or Three logs two warnings as it starts.
    gl.handoff.prepareForThree();
    // The same again after a context RESTORE. The browser calls the listeners of `webglcontextrestored` in the order they
    // were added: the engine's, then Pixi's (which re-uploads textures and leaves those two flags set), then THIS one,
    // then Three's own (added by the constructor below). Without this, Three's restore logs two INVALID_OPERATION
    // warnings (texImage3D) and leaves a GL error flag. Found by the context-loss e2e in step B2.
    gl.glc.canvas.addEventListener('webglcontextrestored', () => gl.handoff.prepareForThree());
    const renderer = new WebGLRenderer({ canvas: gl.glc.canvas, context: gl.glc.gl, antialias: false });
    renderer.outputColorSpace = LinearSRGBColorSpace;
    // Three's start-up touched GL state. Reset it and undo the clear color it left, before Pixi draws.
    gl.handoff.endThree(renderer);
    hostsCreated.shared++;
    const host = new ThreeHost(renderer, 'shared', gl.glc.canvas);
    ThreeHost.sharedHosts.set(gl, host);
    return host;
  }

  /** The private-canvas host of this game (the fallback path). Made on first call. */
  static privateCopy(gl: GlRenderer): ThreeHost {
    const have = ThreeHost.privateHosts.get(gl);
    if (have) return have;
    const canvas = document.createElement('canvas');
    // The canvas stays off the page: Pixi reads it as a texture. It is the picture's size exactly.
    canvas.width = W;
    canvas.height = H;
    const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    renderer.outputColorSpace = LinearSRGBColorSpace;
    // It is OUR canvas, so sizing it is allowed (the rule above is for the shared one).
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    hostsCreated.private++;
    const host = new ThreeHost(renderer, 'private', canvas);
    ThreeHost.privateHosts.set(gl, host);
    return host;
  }
}
