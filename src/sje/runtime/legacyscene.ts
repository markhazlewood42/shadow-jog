/**
 * LegacyScene: runs a scene of the old engine inside the new one (docs/engine/migration.md section 4).
 *
 * A legacy scene has today's shape: `enter`, `exit`, `resume`, `update()`, `render(ctx)`, the flags `opaque`, `curtain`, `passUpdate`,
 * and `close(result)`. The 22 scenes of the game and every story script run on it UNCHANGED. The adapter is a new `Scene` that:
 *
 *   legacy                    in LegacyScene
 *   enter()                   create()
 *   exit()                    the `shutdown` event
 *   resume()                  the `resume` event
 *   update()                  fixedUpdate(tick)
 *   render(ctx)               the `prerender` event, into this scene's own `CanvasImage` (640x360)
 *   opaque, curtain, passUpdate   read from the legacy scene each time (it may change them while it runs)
 *   close(result)             the legacy scene's own: it calls `game.remove(this)`, which pops this adapter, then resolves
 *
 * Why one canvas per scene, and what that costs: each legacy scene draws its whole 2D frame into its own canvas, and Pixi uploads that
 * canvas to the GPU every frame (a `texSubImage2D`; 921,600 bytes at 640x360). Only DRAWN scenes upload (the opaque and curtain rules hide the
 * rest), so a field with a dialog on it uploads two. A third drawn scene is a third upload. The bench (e2e/sje-bench.spec.ts) sets the line.
 *
 * The base scene's canvas is never cleared (it repaints the whole picture, as it did on the old back buffer). A scene above the base starts
 * each frame from a transparent canvas, so what it leaves out lets the scenes below show. The topmost drawn scene also paints the game-level
 * fade, the flash and the overlay hooks (the notice) after itself, which is where the old `Game.render` drew them.
 *
 * The legacy scene sees the new `Game` as its `game`. That is the `LegacyGameSurface` of gameapi.ts: the old `Game` members the game code uses.
 */
import { H, W } from '../core/size';
import type { CanvasImage } from '../display/canvasimage';
import type { LegacyShape } from './gameapi';
import { Scene } from './scene';

export class LegacyScene<R = unknown> extends Scene<R> {
  private image: CanvasImage | null = null;

  constructor(readonly legacy: LegacyShape<R>) {
    super();
  }

  override get opaque(): boolean {
    return this.legacy.opaque;
  }
  override set opaque(v: boolean) {
    this.legacy.opaque = v;
  }
  override get curtain(): boolean {
    return this.legacy.curtain;
  }
  override set curtain(v: boolean) {
    this.legacy.curtain = v;
  }
  override get passUpdate(): boolean {
    return this.legacy.passUpdate;
  }
  override set passUpdate(v: boolean) {
    this.legacy.passUpdate = v;
  }

  /** This scene's canvas (its last drawn frame). Null before `create` and after the scene is gone. */
  get layer(): HTMLCanvasElement | null {
    return this.image?.canvas ?? null;
  }

  override create(): void {
    this.image = this.add.canvasImage(0, 0, W, H);
    const legacy = this.legacy;
    // The legacy `close` removes the scene itself (through `game.remove`) and then calls this resolver.
    legacy._bind((result) => this._settle(result));
    legacy.game = this.game;
    this.events.on('prerender', this.draw, this);
    this.events.on('resume', () => legacy.resume());
    this.events.on('shutdown', () => {
      // A scene torn down by `reset` or `abandon` never ran its own `close`: mark it closed, so a late `close()` from one of its timers does nothing.
      legacy.closed = true;
      this.image = null;
      legacy.exit();
    });
    legacy.enter();
  }

  fixedUpdate(): void {
    this.legacy.update();
  }

  /** The draw phase: today's `render(ctx)` into the canvas, then (on the topmost scene) the washes and overlays, then the upload. */
  private draw(): void {
    const image = this.image;
    if (!image) return;
    const ctx = image.ctx;
    const game = this.game;
    // A scene above the base is a layer: it starts clear. The base keeps its pixels (it repaints them all).
    if (game.scene.base !== this) ctx.clearRect(0, 0, W, H);
    ctx.save();
    let failed = false;
    let error: unknown;
    try {
      this.legacy.render(ctx);
    } catch (e) {
      failed = true;
      error = e;
    } finally {
      ctx.restore();
    }
    if (game.scene.topVisible === this) game.paintTop(ctx);
    image.refresh();
    // The error goes on to the scene manager's guard AFTER the picture and the overlays are done: a scene that throws on every draw must not
    // take the notice (which says so) down with it.
    if (failed) throw error;
  }
}
