/** Game over: retry the battle, load the last save, or return to the title. */
import { music } from '../audio/music';
import type { Ctx } from '../engine/canvas';
import { drawText } from '../engine/font';
import { Scene, W, H } from '../engine/game';
import { hasAnySave } from '../game/save';
import { drawWindow, UI } from '../ui/draw';
import { ListMenu } from '../ui/list';
import { Weather } from '../field/weather';

export type GameOverChoice = 'retry' | 'load' | 'title';

export class GameOverScene extends Scene<GameOverChoice> {
  private menu: ListMenu<GameOverChoice>;
  private t = 0;
  /** The same three-layer rain as the streets (with splashes), not a cheaper stand-in. */
  private rain = new Weather();

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
    this.rain.set('rain', 0.8);
  }

  override enter(): void {
    music('gameover', 10);
  }

  update(): void {
    this.t++;
    this.rain.update(0, 0);
    if (this.t < 70) return;
    const r = this.menu.update(this.game.input);
    if (r === 'confirm') this.close(this.menu.current!.value);
  }

  render(ctx: Ctx): void {
    ctx.fillStyle = '#07060d';
    ctx.fillRect(0, 0, W, H);
    const a = Math.min(1, this.t / 60);
    ctx.globalAlpha = a;
    this.rain.render(ctx);
    drawText(ctx, 'THE RUN IS OVER', W / 2, 88, { align: 'center', color: UI.red });
    drawText(ctx, 'Saltreach keeps what it takes.', W / 2, 104, { align: 'center', color: UI.dim });
    ctx.globalAlpha = 1;
    if (this.t >= 70) {
      drawWindow(ctx, W / 2 - 70, 132, 140, 46);
      this.menu.render(ctx, W / 2 - 62, 139, 128);
    }
  }
}
