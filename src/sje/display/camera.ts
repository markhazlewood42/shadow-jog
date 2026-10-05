/**
 * Camera: scroll and bounds, as a transform on a scene's `world` container
 * (docs/engine/scene-graph.md section 5). Follows: Phaser `Camera` (the API). Pixi has no camera.
 *
 * `cameras.main` moves its scene's `world` container: `world.position = -round(scroll)`. It never
 * moves another scene's `world`. Scroll is ALWAYS rounded to whole pixels (snap to pixel), because
 * Phaser's vertex rounding has no Pixi equivalent: a fractional scroll would slide the whole
 * picture between pixels and shimmer.
 *
 * Built in B0: `scrollX`, `scrollY`, `setScroll`, `setBounds`. Not built yet (M1, on demand):
 * `zoom`, `startFollow`, `setDeadzone`, `fade`, `flash`, `shake`, `pan`, `zoomTo`, `filters`. They
 * are absent from the type, so using one is a compile error, not a silent no-op.
 */
import { H, W } from '../core/size';
import { snap } from './gameobject';
import type { Container } from './container';

export interface CameraBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Camera {
  private _scrollX = 0;
  private _scrollY = 0;
  private bounds: CameraBounds | null = null;

  /**
   * @param world the container this camera moves
   * @param canScroll false for the `ui` camera, which "never scrolls, shakes, or zooms" (it exists
   *   so UI code can use the same Camera API for fades later). @ours
   */
  constructor(
    private readonly world: Container,
    private readonly canScroll = true,
  ) {}

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
   * Phaser: setBounds. The scroll then stays inside the rectangle. A rectangle smaller than the
   * view is centred on it. Whole pixels only: the numbers are rounded.
   */
  setBounds(x: number, y: number, w: number, h: number): this {
    this.bounds = { x: snap(x), y: snap(y), w: snap(w), h: snap(h) };
    return this.setScroll(this._scrollX, this._scrollY);
  }

  /** Write the transform to the world container. The draw phase calls this, and `setScroll` does. */
  apply(): void {
    this.world.setPosition(-this._scrollX, -this._scrollY);
  }

  private clamp(v: number, axis: 'x' | 'y'): number {
    const b = this.bounds;
    if (!b) return v;
    const view = axis === 'x' ? W : H;
    const start = axis === 'x' ? b.x : b.y;
    const size = axis === 'x' ? b.w : b.h;
    // Smaller than the view: no room to scroll, so centre it.
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

  /** Write both transforms. One call per frame, in the draw phase. */
  apply(): void {
    this.main.apply();
    this.ui.apply();
  }
}
