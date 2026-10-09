/** Centered info card (tutorial hints, notices). Confirm to dismiss. */
import { sfx } from '../audio/sfx';
import { autoClose } from '../game/debug';
import type { Ctx } from '../engine/canvas';
import { drawParagraph, wrap } from '../engine/font';
import { Scene } from '../engine/game';
import { W, H } from '../sje/core/size';
import { drawMore, drawWindow, UI } from '../ui/draw';

export class CardScene extends Scene<void> {
  override opaque = false;
  private t = 0;
  private lines: number;

  constructor(private title: string, private body: string, private accent = UI.amber) {
    super();
    this.lines = wrap(body, 300).length;
  }

  override enter(): void {
    sfx('alert');
  }

  update(): void {
    this.t++;
    if (autoClose(this.t, 100)) {
      this.close();
      return;
    }
    if (this.t > 12 && (this.game.input.pressed('confirm') || this.game.input.pressed('cancel'))) {
      sfx('confirm');
      this.close();
    }
  }

  render(ctx: Ctx): void {
    ctx.fillStyle = 'rgba(7,6,13,0.5)';
    ctx.fillRect(0, 0, W, H);
    const w = 320, h = 34 + this.lines * 11;
    const x = (W - w) / 2, y = (H - h) / 2 - 10;
    const k = Math.min(1, this.t / 8);
    drawWindow(ctx, x, y + (1 - k) * 8, w, h, { title: this.title, accent: this.accent });
    if (k < 1) return;
    drawParagraph(ctx, this.body, x + 10, y + 12, 300, { lineH: 11 });
    drawMore(ctx, x + w - 14, y + h - 13, this.t, this.accent);
  }
}
