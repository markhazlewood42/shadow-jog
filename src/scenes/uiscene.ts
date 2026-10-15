/**
 * UiScene: the shared base of the full-screen and popup UI scenes (M8b; the "UiScene helper base" of m8-brief.md task 3).
 * It lives in `src/scenes`, not `src/sje/ui`: it extends `Scene` (runtime level), and tests/sje-imports.test.ts lets the kit import only core, display and ui.
 * Follows: Phaser `Scene`, with the little that every menu-like scene repeated.
 *
 * What it gives (and nothing more, principle 6):
 *  - `t`: the scene's own tick counter. It goes up by one at the start of every tick, before `tick()` runs, as the old scenes' `this.t++` did.
 *  - `tick()`: what a subclass writes instead of `fixedUpdate`.
 *  - `dim(alpha, color)`: the full-screen shade behind a window (the old `ctx.fillRect(0, 0, W, H)` with `OVERLAY_DIM` or a lighter one). It is a `Graphics`,
 *    one of the three plain Graphics the kit allows.
 *  - `picture(x, y, w, h, draw)`: a canvas picture for art, painted once.
 *  - `legend(back, ok)`: the key hint line in the player's own keys (`keyLegend` over `ActionMap.keyName`).
 *
 * A scene adds its objects with `this.sys.ui.add(...)`. There is no `add` helper here on purpose: the scene's own `add` is the object factory of the engine.
 */
import { CanvasImage, Graphics, keyLegend, OVERLAY_DIM, Scene } from '../sje';
import { H, W } from '../sje/core/size';

export abstract class UiScene<R = void> extends Scene<R> {
  /** Ticks since the scene started (1 on the first `tick()`). */
  protected t = 0;

  /** One tick of the scene. */
  protected abstract tick(): void;

  fixedUpdate(): void {
    this.t++;
    this.tick();
  }

  /**
   * A full-screen shade, added to the ui layer. With no argument it is the dim of a full-screen menu (`OVERLAY_DIM`, 0.985); a card
   * passes `0.5`. The color is the game's night black.
   */
  protected dim(alpha: number = OVERLAY_DIM_ALPHA): Graphics {
    const g = new Graphics(this, 0, 0).fillStyle(0x07060d, alpha).fillRect(0, 0, W, H);
    g.name = 'dim';
    this.sys.ui.add(g);
    return g;
  }

  /**
   * A picture painted once from canvas drawing code (a portrait, a character sprite, a plan), added to the ui layer. `draw` gets a context of w by h.
   * Use it for ART. Window frames, text, lists and bars are kit parts (`NineSlice`, `TextObject`, `ListMenu`, `Bar`), never a picture.
   */
  protected picture(x: number, y: number, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): CanvasImage {
    const img = new CanvasImage(this, x, y, w, h);
    draw(img.ctx);
    img.refresh();
    this.sys.ui.add(img);
    return img;
  }

  /** The key reminder in the player's own bindings: '{c}X{/} back', with the confirm key first when `ok` names what it does. */
  protected legend(back = 'back', ok?: string): string {
    return keyLegend(this.input.actions, back, ok);
  }
}

/** The alpha of `OVERLAY_DIM` ('rgba(7,6,13,0.985)'). */
export const OVERLAY_DIM_ALPHA = Number(OVERLAY_DIM.slice(OVERLAY_DIM.lastIndexOf(',') + 1, -1));
