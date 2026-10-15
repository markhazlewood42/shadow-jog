/**
 * The base of the art viewers (`?scene=mapview|chars|portraits|bestiary|font`): a scene of the new engine that draws its whole picture with Canvas 2D.
 *
 * ET moved the five viewers from the old engine's `Scene` (deleted in M8d) onto this. It does what the old adapter did for them, and no more: one
 * `CanvasImage` of the screen's size, repainted on every frame by `render(ctx)`, then uploaded. A viewer fills the whole canvas itself, so nothing is cleared here.
 * Follows: Phaser `Scene` with a `CanvasTexture` (docs/engine/scene-graph.md).
 */
import type { Ctx } from '../../sje/core/canvas';
import { type CanvasImage, H, Scene, W } from '../../sje';

export abstract class CanvasViewScene extends Scene<void> {
  private image: CanvasImage | null = null;

  override create(): void {
    this.image = this.add.canvasImage(0, 0, W, H);
    this.events.on('prerender', this.draw, this);
    this.events.on('shutdown', () => {
      this.image = null;
    });
  }

  /** The viewers show still pictures: nothing changes on a tick. */
  fixedUpdate(): void {}

  /** Paint the picture on `ctx` (W by H). Called once a frame. */
  protected abstract render(ctx: Ctx): void;

  private draw(): void {
    const image = this.image;
    if (!image) return;
    const ctx = image.ctx;
    ctx.save();
    try {
      this.render(ctx);
    } finally {
      ctx.restore();
    }
    image.refresh();
  }
}
