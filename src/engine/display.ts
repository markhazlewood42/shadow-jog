/**
 * Presents the 480×270 back buffer on the page.
 * Strategy: nearest-neighbour upscale to the next integer multiple, then let the browser
 * smoothly downsample to the exact fit size. Every source pixel stays the same size
 * (no uneven columns you'd get from fractional nearest-neighbour).
 *
 * Fill mode snaps to a whole multiple whenever one fills at least 90% of the window, so the
 * common sizes (1080p, 1440p, 4K and most maximised browser windows) are pixel-exact by
 * default; only an awkward window size gets the (slight) resampling. Pixel-perfect always snaps.
 *
 * With GPU effects on (engine/postfx.ts), a WebGL presenter draws the frames instead, into its own
 * canvas laid exactly over the 2D one, at the same size; the 2D canvas keeps focus and input.
 */
import { must } from './assert';
import { type Surface, surface } from './canvas';
import { H, W } from './game';
import { GlPresenter } from './gl/presenter';
import { postfx } from './postfx';

export type ScaleMode = 'fit' | 'integer';

export class Display {
  readonly back: HTMLCanvasElement;
  readonly backCtx: CanvasRenderingContext2D;
  private screen: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  private k = 1;
  mode: ScaleMode = 'fit';
  /** The WebGL presenter while GPU effects are on (and WebGL works), and its two extra layers. */
  private gl: GlPresenter | null = null;
  private glow: Surface | null = null;
  private ui: Surface | null = null;
  /** Something was drawn into the glow layer this frame (else it needn't be cleared or blurred). */
  private glowUsed = false;

  constructor(screen: HTMLCanvasElement) {
    this.screen = screen;
    this.sctx = must(screen.getContext('2d', { alpha: false }), 'a 2D canvas context for the screen (this browser has no canvas drawing)');
    this.back = document.createElement('canvas');
    this.back.width = W;
    this.back.height = H;
    this.backCtx = must(this.back.getContext('2d', { alpha: false }), 'a 2D canvas context for the back buffer');
    this.backCtx.imageSmoothingEnabled = false;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /**
   * Turn GPU effects on or off. On, but no WebGL 2 here (or a shader won't compile): stays off,
   * and says so once in the console. Returns whether they're on.
   */
  setGpu(on: boolean): boolean {
    if (on) postfx.suspended = false;
    if (on && !this.gl) {
      this.gl = GlPresenter.create();
      if (this.gl) {
        const c = this.gl.canvas;
        c.id = 'fx';
        c.setAttribute('aria-hidden', 'true');
        // Exactly over #screen: the same size, centred the same way in the stage; clicks and
        // focus go through to it.
        Object.assign(c.style, { position: 'absolute', inset: '0', margin: 'auto', pointerEvents: 'none', display: 'block' });
        this.screen.after(c);
        this.glow ??= surface(W, H);
        this.ui ??= surface(W, H);
      }
    } else if (!on && this.gl) {
      this.gl.dispose();
      this.gl = null;
    }
    this.resize();
    this.beginFrame();
    return !!this.gl;
  }

  /** Before a frame is drawn: are GPU effects live this frame, and fresh, empty layers if so. */
  beginFrame(): void {
    const live = !!this.gl?.ok && !!this.glow && !!this.ui;
    if (this.gl) this.gl.canvas.style.display = live ? 'block' : 'none';
    postfx.active = live;
    postfx.glow = live && this.glow ? this.glow.ctx : null;
    postfx.ui = live && this.ui ? this.ui.ctx : null;
    if (!live || !this.glow || !this.ui) return;
    this.ui.ctx.clearRect(0, 0, W, H);
    // postfx.glowUsed too: a frame that threw before present() still drew into it.
    if (this.glowUsed || postfx.glowUsed) this.glow.ctx.clearRect(0, 0, W, H);
    this.glowUsed = false;
    postfx.glowUsed = false;
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    // The stage the canvas sits in (the whole window, unless a dev page such as the FX lab has
    // taken a side of it for a panel).
    const stage = this.screen.parentElement;
    const vw = stage?.clientWidth || window.innerWidth;
    const vh = stage?.clientHeight || window.innerHeight;
    const fit = Math.min(vw / W, vh / H);
    const whole = Math.floor(fit * dpr) / dpr;
    let cssScale = fit;
    if (fit >= 1 && (this.mode === 'integer' || whole >= fit * 0.9)) cssScale = whole;
    const cssW = Math.floor(W * cssScale);
    const cssH = Math.floor(H * cssScale);
    this.k = Math.max(1, Math.ceil(cssScale * dpr));
    this.screen.width = W * this.k;
    this.screen.height = H * this.k;
    this.screen.style.width = `${cssW}px`;
    this.screen.style.height = `${cssH}px`;
    this.sctx.imageSmoothingEnabled = false;
    if (this.gl) {
      this.gl.resize(W * this.k, H * this.k);
      this.gl.canvas.style.width = `${cssW}px`;
      this.gl.canvas.style.height = `${cssH}px`;
    }
  }

  present(): void {
    if (postfx.active && this.gl?.ok && this.glow && this.ui) {
      this.glowUsed = postfx.glowUsed;
      this.gl.present(this.back, this.glow.canvas, this.ui.canvas, this.glowUsed);
      return;
    }
    this.sctx.imageSmoothingEnabled = false;
    this.sctx.drawImage(this.back, 0, 0, W * this.k, H * this.k);
  }

  /** Convert a page-space point to back-buffer coordinates. */
  toGame(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.screen.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * W, y: ((clientY - r.top) / r.height) * H };
  }

  get element(): HTMLCanvasElement {
    return this.screen;
  }
}
