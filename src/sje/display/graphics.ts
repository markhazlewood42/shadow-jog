/**
 * Graphics: rectangle fills and 1 px lines (docs/engine/scene-graph.md sections 2 and 10).
 * Follows: Phaser `Graphics` (a subset: deviation 15 in conventions.md). Pixi backing: `Graphics`.
 *
 * The Phaser call `fillStyle(c, a).fillRect(x, y, w, h)` becomes Pixi `rect(...).fill({ color, alpha })`.
 * The wrapper always uses the object form: the two-argument `fill(color, alpha)` is deprecated in
 * Pixi 8.22 and logs a warning.
 *
 * Whole pixels only. Rectangle edges are rounded to whole pixels, so an edge can never fall
 * between two pixels and blend. Lines are always 1 px wide (`lineStyle` accepts only width 1).
 */
import { Graphics as PixiGraphics } from 'pixi.js';
import { type DisplayHost, GameObject, snap } from './gameobject';

export class Graphics extends GameObject {
  private readonly g: PixiGraphics;
  private fillColor = 0xffffff;
  private fillAlpha = 1;
  private lineColor = 0xffffff;
  private lineAlpha = 1;

  constructor(scene: DisplayHost, x = 0, y = 0) {
    const g = new PixiGraphics({ label: 'graphics' });
    super(scene, g);
    this.g = g;
    this.name = 'graphics';
    this.setPosition(x, y);
  }

  /** Phaser: fillStyle. `color` is 0xRRGGBB. */
  fillStyle(color: number, alpha = 1): this {
    this.fillColor = color;
    this.fillAlpha = alpha;
    return this;
  }

  /** Fill a rectangle in the current fill style. */
  fillRect(x: number, y: number, w: number, h: number): this {
    this.assertAlive('Graphics.fillRect');
    const x0 = snap(x);
    const y0 = snap(y);
    // Round both corners (not the size), so two rectangles that touch still touch after rounding.
    this.g.rect(x0, y0, snap(x + w) - x0, snap(y + h) - y0).fill({ color: this.fillColor, alpha: this.fillAlpha });
    return this;
  }

  /**
   * Phaser: lineStyle(width, color, alpha). @deviation width must be 1.
   * Set the style of `lineBetween`.
   */
  lineStyle(width: 1, color: number, alpha = 1): this {
    if (width !== 1) throw new Error(`Graphics.lineStyle: only 1 px lines are built (got ${width})`);
    this.lineColor = color;
    this.lineAlpha = alpha;
    return this;
  }

  /**
   * Phaser: lineBetween. A 1 px line from one pixel to another, both ends included, drawn by
   * Bresenham as runs of 1 px rectangles: the same pixels on every GPU and on software GL.
   *
   * @deviation from scene-graph.md sections 2 and 10, which say 1 px lines use Pixi
   * `stroke({ pixelLine: true })`. The spike lab measured it: Pixi's pixel line is drawn by GL line
   * rasterisation, which is implementation-defined. It left out the START pixel of a horizontal or
   * vertical line, and put a diagonal one pixel off, against a Canvas 2D reference. Rectangles are exact.
   */
  lineBetween(x0: number, y0: number, x1: number, y1: number): this {
    this.assertAlive('Graphics.lineBetween');
    let x = snap(x0);
    let y = snap(y0);
    const ex = snap(x1);
    const ey = snap(y1);
    const dx = Math.abs(ex - x);
    const sx = x < ex ? 1 : -1;
    const dy = -Math.abs(ey - y);
    const sy = y < ey ? 1 : -1;
    let err = dx + dy;
    const fill = { color: this.lineColor, alpha: this.lineAlpha };
    // A run is the pixels of one row that touch each other: a flat line is one rectangle.
    let runY = y;
    let runFrom = x;
    let runTo = x;
    const flush = (): void => {
      this.g.rect(Math.min(runFrom, runTo), runY, Math.abs(runTo - runFrom) + 1, 1).fill(fill);
    };
    // A vertical line is one tall rectangle instead of one per row.
    if (x === ex) {
      this.g.rect(x, Math.min(y, ey), 1, Math.abs(ey - y) + 1).fill(fill);
      return this;
    }
    for (;;) {
      if (x === ex && y === ey) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
      if (y === runY) runTo = x;
      else {
        flush();
        runY = y;
        runFrom = x;
        runTo = x;
      }
    }
    flush();
    return this;
  }

  /** Erase everything drawn so far. */
  clear(): this {
    this.g.clear();
    return this;
  }

  /** Free the drawing too: a Graphics keeps GPU data that a plain destroy would leave. */
  protected override destroyNode(): void {
    this.g.destroy({ context: true });
  }
}
