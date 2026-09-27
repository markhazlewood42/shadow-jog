/**
 * Presents the 480×270 back buffer on the page.
 * Strategy: nearest-neighbour upscale to the next integer multiple, then let the browser
 * smoothly downsample to the exact fit size. Every source pixel stays the same size
 * (no uneven columns you'd get from fractional nearest-neighbour).
 */
import { H, W } from './game';

export type ScaleMode = 'fit' | 'integer';

export class Display {
  readonly back: HTMLCanvasElement;
  readonly backCtx: CanvasRenderingContext2D;
  private screen: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  private k = 1;
  mode: ScaleMode = 'fit';

  constructor(screen: HTMLCanvasElement) {
    this.screen = screen;
    this.sctx = screen.getContext('2d', { alpha: false })!;
    this.back = document.createElement('canvas');
    this.back.width = W;
    this.back.height = H;
    this.backCtx = this.back.getContext('2d', { alpha: false })!;
    this.backCtx.imageSmoothingEnabled = false;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const fit = Math.min(vw / W, vh / H);
    let cssScale = fit;
    if (this.mode === 'integer' && fit >= 1) cssScale = Math.floor(fit * dpr) / dpr;
    const cssW = Math.floor(W * cssScale);
    const cssH = Math.floor(H * cssScale);
    this.k = Math.max(1, Math.ceil(cssScale * dpr));
    this.screen.width = W * this.k;
    this.screen.height = H * this.k;
    this.screen.style.width = cssW + 'px';
    this.screen.style.height = cssH + 'px';
    this.sctx.imageSmoothingEnabled = false;
  }

  present(): void {
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
