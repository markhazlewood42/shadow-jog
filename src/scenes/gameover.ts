/** Game over: retry the battle, load the last save, or return to the title. */
import { music } from '../audio/music';
import type { Ctx } from '../engine/canvas';
import { drawText } from '../engine/font';
import { Scene, W, H } from '../engine/game';
import { hasAnySave } from '../game/save';
import { drawWindow, UI } from '../ui/draw';
import { ListMenu } from '../ui/list';
import { Weather } from '../field/weather';
import { battler } from '../art/battlers';
import { LOOKS } from '../data/looks';
import { state } from '../game/state';
import { rimOf, silhouetteCache } from './battlekit/sprites';

export type GameOverChoice = 'retry' | 'load' | 'title';

export class GameOverScene extends Scene<GameOverChoice> {
  private menu: ListMenu<GameOverChoice>;
  private t = 0;
  /** The same three-layer rain as the streets (with splashes), not a cheaper stand-in. */
  private rain = new Weather();
  /** The crew as the fight left them: on their knees, backs to us, facing the city. */
  private crew: HTMLCanvasElement[];

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
    this.crew = state.party.map((id) => battler(id, LOOKS[id]).frames.hurt);
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
    // The crew fades in first, then the words: the picture carries the loss, the text names it.
    this.renderCrew(ctx, Math.min(1, this.t / 45));
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

  /** Dark shapes on a wet street, edged in the city's red, with their reflections under them. */
  private renderCrew(ctx: Ctx, a: number): void {
    const street = 244;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#0c0a16';
    ctx.fillRect(0, street, W, H - street);
    ctx.fillStyle = 'rgba(255,58,90,0.18)';
    ctx.fillRect(0, street, W, 1);
    const gap = 58;
    const x0 = W / 2 - ((this.crew.length - 1) * gap) / 2;
    this.crew.forEach((c, i) => {
      const w = c.width * 2, h = c.height * 2;
      const x = Math.round(x0 + i * gap - w / 2), y = street - h + 4;
      ctx.globalAlpha = a * 0.16;
      ctx.save();
      ctx.translate(x, street + (street - y) - 8);
      ctx.scale(1, -0.5);
      ctx.drawImage(silhouetteCache(c, '#ff3a5a'), 0, 0, w, h);
      ctx.restore();
      ctx.globalAlpha = a;
      ctx.drawImage(silhouetteCache(c, '#07060d'), x, y, w, h);
      ctx.globalAlpha = a * 0.8;
      const rim = rimOf(c, '#ff3a5a');
      ctx.drawImage(rim, x - 2, y - 2, rim.width * 2, rim.height * 2);
    });
    ctx.globalAlpha = 1;
  }
}
