/** Game over: retry the battle, load the last save, or return to the title. */
import { music } from '../audio/music';
import type { Ctx } from '../engine/canvas';
import { drawText } from '../engine/font';
import { Scene, W, H } from '../engine/game';
import { hasAnySave } from '../game/save';
import { drawWindow, UI } from '../ui/draw';
import { ListMenu } from '../ui/list';

export type GameOverChoice = 'retry' | 'load' | 'title';

export class GameOverScene extends Scene<GameOverChoice> {
  private menu: ListMenu<GameOverChoice>;
  private t = 0;

  constructor(canRetry: boolean) {
    super();
    this.menu = new ListMenu<GameOverChoice>(
      [
        { label: 'Retry the fight', value: 'retry', enabled: canRetry },
        { label: 'Load last save', value: 'load', enabled: hasAnySave() },
        { label: 'Return to title', value: 'title' },
      ],
      3,
    );
    this.menu.index = canRetry ? 0 : hasAnySave() ? 1 : 2;
  }

  override enter(): void {
    music('gameover', 10);
  }

  update(): void {
    this.t++;
    if (this.t < 70) return;
    const r = this.menu.update(this.game.input);
    if (r === 'confirm') this.close(this.menu.current!.value);
  }

  render(ctx: Ctx): void {
    ctx.fillStyle = '#07060d';
    ctx.fillRect(0, 0, W, H);
    const a = Math.min(1, this.t / 60);
    ctx.globalAlpha = a;
    // Falling rain streaks for mood.
    ctx.fillStyle = '#2a2a48';
    for (let i = 0; i < 60; i++) {
      const x = (i * 83 + this.t * 0.6) % W;
      const y = (i * 47 + this.t * (2 + (i % 3))) % H;
      ctx.fillRect(Math.round(x), Math.round(y), 1, 5);
    }
    drawText(ctx, 'THE RUN IS OVER', W / 2, 88, { align: 'center', color: UI.red });
    drawText(ctx, 'Saltreach keeps what it takes.', W / 2, 104, { align: 'center', color: UI.dim });
    ctx.globalAlpha = 1;
    if (this.t >= 70) {
      drawWindow(ctx, W / 2 - 70, 132, 140, 46);
      this.menu.render(ctx, W / 2 - 62, 139, 128);
    }
  }
}
