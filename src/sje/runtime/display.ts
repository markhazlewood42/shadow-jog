/**
 * Display: how the 640x360 picture sits in the page (docs/engine/frame-and-rendering.md section 6.6, interfaces.md section 13).
 * Follows: Phaser `ScaleManager` (the name), Unity Pixel Perfect Camera (the behavior).
 *
 * INTEGER MODE ONLY (Mark, 2026-10-09: `fit` is dropped). The canvas is the whole window in device pixels, so the browser shows it 1:1 and
 * never resamples it. The picture is drawn at the largest whole-number scale `k` that fits, centered on a whole device pixel, and the rest
 * is the void color. `k` never changes by a fraction, so there are no uneven pixels at any device pixel ratio.
 *
 * The math is in `render/presenter.ts` (`deviceSize`, `pictureLayout`: pure functions the unit tests pin). This class does the browser part:
 * it reads the window, resizes the canvas (through the target), listens for resizes, and maps a pointer position to a game pixel.
 *
 * Tests give it no target. It then only computes the layout, so it runs in Node.
 */
import { H, W } from '../core/size';
import { deviceSize, type PictureLayout, pictureLayout } from '../render/presenter';

/** What the display resizes: the canvas, and the thing that puts the picture in it (`GlRenderer`). */
export interface ScaleTarget {
  readonly canvas: HTMLCanvasElement;
  /** Size the canvas to `viewW` x `viewH` CSS pixels at `dpr` and lay the picture out in it. Returns `k`. */
  fitToWindow(viewW: number, viewH: number, dpr: number, observed?: { w: number; h: number }): number;
  /** Where the picture is in the canvas, in device pixels. */
  readonly picture: PictureLayout;
}

export class Display {
  /** The only mode. `fit` was dropped (Mark, 2026-10-09): a saved `settings.scale: 'fit'` becomes `integer`. */
  readonly mode = 'integer' as const;

  private _layout: PictureLayout = { k: 1, x: 0, y: 0, w: W, h: H };
  private readonly listeners: Array<() => void> = [];
  /** The size the browser says the canvas box has in device pixels, when it can say (real Chrome and Firefox). */
  private observed: { w: number; h: number } | undefined;
  private parent: HTMLElement | null = null;
  private watcher: ResizeObserver | null = null;
  private readonly onWindowResize = (): void => this.refit();

  constructor(private readonly target: ScaleTarget | null = null) {}

  /** Device pixels per game pixel (a whole number). */
  get k(): number {
    return this._layout.k;
  }

  /** Where the picture is in the canvas, in device pixels. */
  get layout(): PictureLayout {
    return this._layout;
  }

  /** The page element the canvas fills (null before `attach`). */
  get stage(): HTMLElement | null {
    return this.parent;
  }

  /** Call `fn` after every resize (once the canvas and the layout have changed). */
  on(_event: 'resize', fn: () => void): void {
    this.listeners.push(fn);
  }

  off(_event: 'resize', fn: () => void): void {
    const i = this.listeners.indexOf(fn);
    if (i >= 0) this.listeners.splice(i, 1);
  }

  /**
   * Fit the canvas to `parent` (which must be positioned and fill the window) now, and again whenever the window changes size or the
   * device pixel ratio changes (browser zoom). Safe to call once.
   */
  attach(parent: HTMLElement): void {
    this.parent = parent;
    this.refit();
    window.addEventListener('resize', this.onWindowResize);
    if (this.target) {
      try {
        this.watcher = new ResizeObserver((entries) => {
          const size = entries[0]?.devicePixelContentBoxSize?.[0];
          if (size && (this.observed?.w !== size.inlineSize || this.observed?.h !== size.blockSize)) {
            this.observed = { w: size.inlineSize, h: size.blockSize };
            this.refit();
          }
        });
        this.watcher.observe(this.target.canvas, { box: 'device-pixel-content-box' });
      } catch {
        // A browser without 'device-pixel-content-box' (Safari): the arithmetic in deviceSize() is used.
        this.watcher = null;
      }
    }
  }

  /** Measure the parent and resize to it. */
  refit(): void {
    const parent = this.parent;
    const viewW = parent?.clientWidth || window.innerWidth;
    const viewH = parent?.clientHeight || window.innerHeight;
    this.resizeTo(viewW, viewH, window.devicePixelRatio || 1, this.observed);
  }

  /** Size to a window of `viewW` x `viewH` CSS pixels at `dpr`. Tests call this directly. */
  resizeTo(viewW: number, viewH: number, dpr: number, observed?: { w: number; h: number }): PictureLayout {
    if (this.target) {
      this.target.fitToWindow(viewW, viewH, dpr, observed);
      this._layout = this.target.picture;
    } else {
      const d = deviceSize(viewW, viewH, dpr, observed);
      this._layout = pictureLayout(d.w, d.h);
    }
    for (const fn of [...this.listeners]) fn();
    return this._layout;
  }

  /**
   * Convert a page position (a pointer event's clientX and clientY) to a game pixel. A position in the bars is outside 0..W and 0..H.
   * The canvas is 1:1 with the window in device pixels, so the box's CSS size over its backing size gives the ratio.
   */
  toGame(clientX: number, clientY: number): { x: number; y: number } {
    const canvas = this.target?.canvas;
    if (!canvas) return { x: (clientX - this._layout.x) / this._layout.k, y: (clientY - this._layout.y) / this._layout.k };
    const r = canvas.getBoundingClientRect();
    const sx = r.width > 0 ? canvas.width / r.width : 1;
    const sy = r.height > 0 ? canvas.height / r.height : 1;
    return { x: ((clientX - r.left) * sx - this._layout.x) / this._layout.k, y: ((clientY - r.top) * sy - this._layout.y) / this._layout.k };
  }

  /** Stop listening to the window. Dev and tests. */
  destroy(): void {
    window.removeEventListener('resize', this.onWindowResize);
    this.watcher?.disconnect();
    this.watcher = null;
    this.listeners.length = 0;
  }
}
