/**
 * Camera: scroll and bounds, as a transform on a scene's `world` container
 * (docs/engine/scene-graph.md section 5). Follows: Phaser `Camera` (the API). Pixi has no camera.
 *
 * `cameras.main` moves its scene's `world` container: `world.position = -round(scroll)`. It never
 * moves another scene's `world`. Scroll is ALWAYS rounded to whole pixels (snap to pixel), because
 * Phaser's vertex rounding has no Pixi equivalent: a fractional scroll would slide the whole
 * picture between pixels and shimmer.
 *
 * Built in B0: `scrollX`, `scrollY`, `setScroll`, `setBounds`. Built in M1: `fadeIn`, `fadeOut`, `flash`, `shake`
 * (cameraeffects.ts; durations in milliseconds, driven by the tick). Built in M5: `pan` (ease-in-out, whole-pixel steps, bounds and the
 * small-room rule on every step). Not built yet (on demand):
 * `zoom`, `startFollow`, `setDeadzone`, `zoomTo`, `filters`. They
 * are absent from the type, so using one is a compile error, not a silent no-op.
 */
import { H, W } from '../core/size';
import { CameraEffects, msToTicks } from './cameraeffects';
import { snap } from './gameobject';
import type { Container } from './container';

export interface CameraBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The easings of `pan`. `quadInOut` is the field's: `2k^2` up to the middle, then `1 - (2 - 2k)^2 / 2`. `linear` is Phaser's default. */
export type PanEase = 'linear' | 'quadInOut';

const EASE: Record<PanEase, (k: number) => number> = {
  linear: (k) => k,
  quadInOut: (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2),
};

interface Pan {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  t: number;
  len: number;
  ease: PanEase;
  done: (() => void) | undefined;
}

export class Camera {
  private _scrollX = 0;
  private _scrollY = 0;
  private bounds: CameraBounds | null = null;
  private panning: Pan | null = null;
  private readonly fx: CameraEffects;

  /**
   * @param world the container this camera moves
   * @param canScroll false for the `ui` camera, which "never scrolls, shakes, or zooms" (it exists
   *   so UI code can use the same Camera API for fades later). @ours
   */
  constructor(
    private readonly world: Container,
    private readonly canScroll = true,
  ) {
    this.fx = new CameraEffects(world);
  }

  get scrollX(): number {
    return this._scrollX;
  }
  get scrollY(): number {
    return this._scrollY;
  }

  /** Phaser: setScroll. Like Phaser, `y` defaults to `x`. The result is rounded, then kept inside the bounds. */
  setScroll(x: number, y: number = x): this {
    if (!this.canScroll) throw new Error('This camera never scrolls (the ui camera)');
    this._scrollX = this.clamp(snap(x), 'x');
    this._scrollY = this.clamp(snap(y), 'y');
    this.apply();
    return this;
  }

  /**
   * Phaser: pan. Move the camera so it is CENTERED on the world point (x, y), over `ms` milliseconds (whole ticks, at least one).
   * The end point is the scroll that centers the point, rounded and then kept inside the bounds (a map smaller than the view is
   * centered), so it is the same place `setScroll` would put the camera. Each tick moves the scroll to the eased point between where
   * the pan started and the end point, rounded to a whole pixel and kept inside the bounds again. After `ms` it is at the end point and
   * `done` runs once, in the tick it arrives (before any later code of that tick).
   *
   * A new `pan` replaces a running one and starts from where the camera is: the old `done` is never called. `setScroll` during a pan is
   * overwritten by the next tick; a pan does not stop for it. @ours (arguments: `done` instead of an event, and `ease`, whose default
   * is the field's `quadInOut`, not Phaser's linear)
   */
  pan(x: number, y: number, ms: number, ease: PanEase = 'quadInOut', done?: () => void): this {
    if (!this.canScroll) throw new Error('This camera never scrolls (the ui camera)');
    this.panning = {
      fromX: this._scrollX,
      fromY: this._scrollY,
      toX: this.clamp(snap(x - W / 2), 'x'),
      toY: this.clamp(snap(y - H / 2), 'y'),
      t: 0,
      len: msToTicks(ms),
      ease,
      done,
    };
    return this;
  }

  /** True while a pan runs (until the tick it arrives). */
  get isPanning(): boolean {
    return this.panning !== null;
  }

  /**
   * Phaser: setBounds. The scroll then stays inside the rectangle. A rectangle smaller than the
   * view is centerd on it. Whole pixels only: the numbers are rounded.
   */
  setBounds(x: number, y: number, w: number, h: number): this {
    this.bounds = { x: snap(x), y: snap(y), w: snap(w), h: snap(h) };
    return this.setScroll(this._scrollX, this._scrollY);
  }

  /** Cover the world with `color` (a CSS hex string) over `ms`, and keep it covered until `fadeIn`. Phaser: fadeOut. @ours (arguments) */
  fadeOut(ms: number, color?: string | number): this {
    this.fx.fadeOut(ms, color);
    return this;
  }

  /** Phaser: `fade` is `fadeOut`. @ours (arguments) */
  fade(ms: number, color?: string | number): this {
    return this.fadeOut(ms, color);
  }

  /** Uncover the world over `ms`. */
  fadeIn(ms: number, color?: string | number): this {
    this.fx.fadeIn(ms, color);
    return this;
  }

  /** Wash the world with `color` and let it fade away over `ms`. */
  flash(ms: number, color?: string | number): this {
    this.fx.flash(ms, color);
    return this;
  }

  /** Shake the world by up to `magnitudePx` pixels over `ms`. The ui camera never shakes. @ours (pixels, not a fraction of the view) */
  shake(ms: number, magnitudePx?: number): this {
    if (!this.canScroll) throw new Error('This camera never shakes (the ui camera)');
    this.fx.shake(ms, magnitudePx);
    return this;
  }

  /** True while a fade, flash or shake runs, a fade is held, or a pan runs. */
  get busy(): boolean {
    return this.fx.active || this.panning !== null;
  }

  /** Advance the pan and the effects by one tick. The scene manager calls this each tick, after `postupdate`. */
  update(): void {
    this.stepPan();
    this.fx.update();
  }

  private stepPan(): void {
    const p = this.panning;
    if (!p) return;
    p.t++;
    const k = Math.min(1, p.t / p.len);
    const e = EASE[p.ease](k);
    this._scrollX = this.clamp(snap(p.fromX + (p.toX - p.fromX) * e), 'x');
    this._scrollY = this.clamp(snap(p.fromY + (p.toY - p.fromY) * e), 'y');
    this.apply();
    if (k >= 1) {
      this.panning = null;
      p.done?.();
    }
  }

  /** Write the transform to the world container. The draw phase calls this, and `setScroll` does. */
  apply(): void {
    this.fx.apply(this._scrollX, this._scrollY);
    this.world.setPosition(-this._scrollX + this.fx.offsetX, -this._scrollY + this.fx.offsetY);
  }

  private clamp(v: number, axis: 'x' | 'y'): number {
    const b = this.bounds;
    if (!b) return v;
    const view = axis === 'x' ? W : H;
    const start = axis === 'x' ? b.x : b.y;
    const size = axis === 'x' ? b.w : b.h;
    // Smaller than the view: no room to scroll, so center it.
    if (size <= view) return snap(start + (size - view) / 2);
    return Math.min(Math.max(v, start), start + size - view);
  }
}

/** A scene's two cameras. */
export class CameraManager {
  readonly main: Camera;
  /** @ours */
  readonly ui: Camera;

  constructor(world: Container, ui: Container) {
    this.main = new Camera(world);
    this.ui = new Camera(ui, false);
  }

  /** Advance both cameras' effects by one tick. */
  update(): void {
    this.main.update();
    this.ui.update();
  }

  /** Write both transforms. One call per frame, in the draw phase. */
  apply(): void {
    this.main.apply();
    this.ui.apply();
  }
}
