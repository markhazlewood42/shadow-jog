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
  /** Stop listening. A short-lived listener (a 3D scene) must call this, or the context keeps it alive for good. */
  off(event: 'lost' | 'restored', fn: () => void): void;
  /** Dev and tests: lose or restore the context on purpose (needs the WEBGL_lose_context extension). */
  forceLoss(): void;
  forceRestore(): void;
}

/**
 * Renderer names of WebGL drawn on the CPU (no GPU, or one the browser will not use). The effects level `auto` picks `lite` on one of these
 * (`FxSystem`), and the old presenter refuses them (src/engine/gl/presenter.ts re-exports this). One copy of the pattern.
 */
export const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software|basic render driver/i;

/**
 * The driver's name where the browser says it (the unmasked renderer), else the generic one. Firefox deprecates the debug extension and logs a
 * warning for each use, so it gets the generic name; a lost context has no extensions.
 */
export function glRendererName(glc: GlContext): string {
  const gl = glc.gl;
  if (glc.lost) return 'webgl2 (context lost)';
  const ext = /firefox/i.test(navigator.userAgent) ? null : gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
}

const ATTRIBUTES: WebGLContextAttributes = {
  stencil: true,
  antialias: false,
  alpha: false,
  depth: false,
  powerPreference: 'high-performance',
};

/** The one probe canvas, kept for the life of the page once a probe has succeeded (see `probeWebGL2`). */
let probeCanvas: HTMLCanvasElement | null = null;

/**
 * Does this browser give a WebGL2 context? It really asks (`getContext`): `typeof
 * WebGL2RenderingContext` stays defined even when 3D is switched off, and Pixi's
 * `isWebGLSupported()` probes WebGL 1.
 *
 * A page may only hold about 16 live contexts, and the browser drops the OLDEST one past that, which could be
 * the game's own. So the probe makes ONE context, on the first call, and keeps it: every later call answers
 * from it. (B0 made a new context per call and lost it again at once. That is safe in Chrome, but Firefox
 * logs "WebGL context was lost" as a warning each time, and a story that asks before every hack would log
 * it every time.) A `false` answer is never kept: a GPU that was blocked a moment ago may be back.
 */
export function probeWebGL2(): boolean {
  if (probeCanvas) return true;
  const canvas = document.createElement('canvas');
  // One pixel: the probe context holds almost no memory.
  canvas.width = 1;
  canvas.height = 1;
  if (!canvas.getContext('webgl2')) return false;
  probeCanvas = canvas;
  return true;
}

/** Tests only: forget the kept probe, so the next call asks the browser again. */
export function resetProbeWebGL2(): void {
  probeCanvas = null;
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
    off: (event, fn) => {
      listeners[event] = listeners[event].filter((f) => f !== fn);
    },
    forceLoss: () => loseExt?.loseContext(),
    forceRestore: () => loseExt?.restoreContext(),
  };
}
