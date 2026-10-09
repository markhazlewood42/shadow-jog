import type { Ctx } from '../engine/canvas';
import { drawParagraph, drawText } from '../engine/font';
import { Scene } from '../engine/game';
import { W, H } from '../sje/core/size';
import { drawBar, drawCursor, drawWindow, hpColor, UI } from '../ui/draw';

/** Dev-only scene for checking the font and window chrome. */
export class FontTestScene extends Scene {
  update(): void {}
  render(ctx: Ctx): void {
    ctx.fillStyle = '#141325';
    ctx.fillRect(0, 0, W, H);
    drawWindow(ctx, 8, 12, 300, 120, { title: 'FONT' });
    drawText(ctx, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 16, 22);
    drawText(ctx, 'abcdefghijklmnopqrstuvwxyz', 16, 34);
    drawText(ctx, '0123456789 .,!?:;\'"-+=/()[]%#*&<>@$', 16, 46);
    drawText(ctx, '¢ ▶ ▼ ♥ ★ • … — → ↑ ↓ × 1,250¢', 16, 58);
    drawParagraph(
      ctx,
      '{c}Rook:{/} Easy job, kid. In, out, nobody gets {y}geeked{/}. We walk away with {g}3,000¢{/} and a story nobody believes.',
      16, 72, 280,
    );
    drawWindow(ctx, 318, 12, 154, 120, { accent: UI.pink, title: 'STATUS' });
    drawText(ctx, 'Kit', 328, 24);
    drawText(ctx, 'Lv 3', 440, 24, { color: UI.dim, align: 'right' });
    drawText(ctx, 'HP', 328, 38, { color: UI.dim });
    drawBar(ctx, 344, 40, 80, 3, 0.8, hpColor(0.8));
    drawText(ctx, '96/120', 462, 38, { align: 'right' });
    drawText(ctx, 'TP', 328, 50, { color: UI.dim });
    drawBar(ctx, 344, 52, 80, 3, 0.3, UI.cyan);
    drawCursor(ctx, 326, 70, 0);
    drawText(ctx, 'Attack', 336, 70);
    drawText(ctx, 'Tech', 336, 82);
    drawText(ctx, 'Skill', 336, 94, { color: UI.disabled });
  }
}
