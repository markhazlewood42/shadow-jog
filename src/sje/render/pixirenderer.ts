/**
 * PixiRenderer: makes Pixi's WebGL renderer, once, on the engine's own context.
 * Pixi is only the renderer. Game code never imports `pixi.js`: see docs/engine/README.md.
 */
import { TextureStyle, Ticker, WebGLRenderer } from 'pixi.js';
import { H, W } from '../core/size';
import './extensions';
import type { GlContext } from './glcontext';

export class PixiRenderer {
  /** @internal Pixi's renderer. Allowed under src/sje/render and src/sje/display only. */
  readonly renderer: WebGLRenderer;

  private constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
  }

  /**
   * Create the renderer. It is async because Pixi's `init` is. Call this inside an async function:
   * a top-level `await` on `init` hung a Vite production build in the lab, with no error.
   */
  static async create(glc: GlContext): Promise<PixiRenderer> {
    // Nearest filtering for every texture made from here on. Pixi's default is `linear`, which
    // blurs pixel art. It must be set BEFORE any texture exists. (Pixi's built-in white and empty
    // textures are made at import time and stay linear: they hold no picture.)
    TextureStyle.defaultOptions.scaleMode = 'nearest';

    const renderer = new WebGLRenderer();
    await renderer.init({
      // BOTH context and canvas. Without `canvas`, Pixi listens for context loss on an unrelated
      // canvas and can never recover from one (lab: 10 of 10 checks pass with it, 2 of 10 without).
      context: glc.gl,
      canvas: glc.canvas,
      width: W,
      height: H,
      resolution: 1,
      antialias: false,
      // OFF on purpose (round 4, drift item 25). Pixi's `roundPixels` rounds vertex positions in the shader. The engine already
      // rounds every object's position itself (`snap` in gameobject.ts), so that second rounding changes nothing on a GPU, and on
      // SwiftShader (software GL) it lost a strip of pixels where a sprite mask crosses overlapping swatches. A bare Pixi app shows the
      // same loss with it on and none with it off. tests/sje-display.test.ts checks every snapped node sits on a whole world pixel.
      roundPixels: false,
      clearBeforeRender: false,
      skipExtensionImports: true,
      // Pixi unloads textures idle for 60 s. A scene that returns after a long pause would hitch.
      // The engine frees textures itself (TextureManager).
      gcActive: false,
    });

    // Pixi starts a SECOND requestAnimationFrame loop by itself (its scheduler adds itself to
    // `Ticker.system`, which auto-starts). Our FixedLoop is the only loop that runs game code, so
    // stop Pixi's. This also halts Pixi's own texture GC schedule, which is intended (see above).
    Ticker.system.stop();
    // `Ticker.shared` starts on its own when AnimatedSprite or a video texture adds a listener.
    // The engine uses neither. Make sure it never starts.
    Ticker.shared.autoStart = false;
    Ticker.shared.stop();

    return new PixiRenderer(renderer);
  }

  /** Resize the canvas backing store, in DEVICE pixels, at resolution 1. The back buffer does not change. */
  resize(widthPx: number, heightPx: number): void {
    this.renderer.resize(widthPx, heightPx, 1);
  }

  /** Forget Pixi's cached GL state. Call before Pixi draws if anything else touched the context. */
  resetState(): void {
    this.renderer.resetState();
  }
}
