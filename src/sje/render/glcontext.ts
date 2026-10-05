/**
 * GlContext: the ONE WebGL2 context of the game (docs/engine/frame-and-rendering.md section 6.1).
 *
 * The engine makes the canvas and the context itself, then hands BOTH to Pixi (and, later, to
 * Three.js). Why not let Pixi make it: Three and Pixi must share one context, and the context
 * attributes below cannot be changed once it exists.
 *
 * The options, and why:
 *  - `stencil: true`      Pixi `Graphics` masks use the stencil buffer. Three's own default has none.
 *  - `antialias: false`   pixel art. Edges must not be smoothed.
 *  - `alpha: false`       the page behind the canvas is never shown through it.
 *  - `depth: false`       the 2D picture needs no depth buffer. (A Three render target makes its own.)
 *  - `powerPreference`    ask for the fast GPU on laptops that have two.
 *
 * There is NO refusal of software renderers (SwiftShader, llvmpipe). The old presenter refused
 * them by name, so CI never ran it. Here CI runs the same path as a player.
 */

export interface GlContext {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement;
  /** True between `webglcontextlost` and `webglcontextrestored`. */
  readonly lost: boolean;
  on(event: 'lost' | 'restored', fn: () => void): void;
  /** Dev and tests: lose or restore the context on purpose (needs the WEBGL_lose_context extension). */
  forceLoss(): void;
  forceRestore(): void;
}

const ATTRIBUTES: WebGLContextAttributes = {
  stencil: true,
  antialias: false,
  alpha: false,
  depth: false,
  powerPreference: 'high-performance',
};

/**
 * Does this browser give a WebGL2 context? It really asks (`getContext`): `typeof
 * WebGL2RenderingContext` stays defined even when 3D is switched off, and Pixi's
 * `isWebGLSupported()` probes WebGL 1.
 */
export function probeWebGL2(): boolean {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  // Give the probe context back at once: a page may only hold about 16 live contexts.
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return !!gl;
}

/** Make the game's context on `canvas`. Returns null when the browser has no WebGL2. */
export function createGlContext(canvas: HTMLCanvasElement): GlContext | null {
  const gl = canvas.getContext('webgl2', ATTRIBUTES);
  if (!gl) return null;
  const listeners: Record<'lost' | 'restored', Array<() => void>> = { lost: [], restored: [] };
  let lost = false;
  // preventDefault on `webglcontextlost` is what allows the browser to restore the context later.
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    for (const fn of listeners.lost) fn();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
    for (const fn of listeners.restored) fn();
  });
  // Fetched NOW: once the context is lost, getExtension() returns null, and the restore call is gone with it.
  const loseExt = gl.getExtension('WEBGL_lose_context');
  return {
    gl,
    canvas,
    get lost() {
      return lost || gl.isContextLost();
    },
    on: (event, fn) => {
      listeners[event].push(fn);
    },
    forceLoss: () => loseExt?.loseContext(),
    forceRestore: () => loseExt?.restoreContext(),
  };
}
