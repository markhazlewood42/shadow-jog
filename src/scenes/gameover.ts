/** Game over: retry the battle, load the last save, or return to the title. Native sje scene (M8b). */
import { music } from '../audio/music';
import { battler } from '../art/battlers';
import { LOOKS } from '../data/looks';
import { Weather } from '../field/weather';
import { hasAnySave } from '../game/save';
import { state } from '../game/state';
import { CanvasImage, ListMenu, NineSlice, type TextStyle, TextObject, UI } from '../sje';
import { H, W } from '../sje/core/size';
import { GLOW_REACH, PAGE_DY, STREET_FROM_BOTTOM } from '../ui/layout';
import { rimOf, silhouetteCache } from './battlekit/sprites';
import { UiScene } from './uiscene';
import { uiSound } from './uisound';

export type GameOverChoice = 'retry' | 'load' | 'title';

/** The street the crew kneels on, and the red glow above it (rects in screen pixels). A test reads them. */
export function gameOverBands(): { street: { x: number; y: number; w: number; h: number }; glow: { x: number; y: number; w: number; h: number } } {
  const y = H - STREET_FROM_BOTTOM;
  return { street: { x: 0, y, w: W, h: H - y }, glow: { x: 0, y: y - GLOW_REACH, w: W, h: GLOW_REACH } };
}

/** The frame at which the menu appears. */
const MENU_AT = 70;

export class GameOverScene extends UiScene<GameOverChoice> {
  private readonly canRetry: boolean;
  /** The same three-layer rain as the streets (with splashes), not a cheaper stand-in. */
  private rain = new Weather();
  /** The crew as the fight left them: on their knees, backs to us, facing the city. */
  private crew: HTMLCanvasElement[];
  private backlight: CanvasGradient | null = null;
  private art!: CanvasImage;
  private head!: TextObject;
  private sub!: TextObject;
  private menuWin!: NineSlice;
  private menu!: ListMenu<GameOverChoice>;

  constructor(canRetry: boolean) {
    super();
    this.canRetry = canRetry;
    this.crew = state.party.map((id) => battler(id, LOOKS[id]).frames.hurt);
    this.rain.set('rain', 0.8);
  }

  override create(): void {
    music('gameover', 10);
    const ui = this.sys.ui;
    const hasSave = hasAnySave();
    this.dim(1);
    // The crew, the glow and the rain are art: one canvas picture, repainted each tick.
    this.art = new CanvasImage(this, 0, 0, W, H);
    ui.add(this.art);
    const red: TextStyle = { align: 'center', color: UI.red };
    this.head = new TextObject(this, W / 2, 44 + PAGE_DY, 'THE RUN IS OVER', red).setAlpha(0);
    ui.add(this.head);
    this.sub = new TextObject(this, W / 2, 60 + PAGE_DY, 'Saltreach keeps what it takes.', { align: 'center', color: UI.dim }).setAlpha(0);
    ui.add(this.sub);
    this.menuWin = new NineSlice(this, W / 2 - 70, 80 + PAGE_DY, 140, 46).setVisible(false);
    ui.add(this.menuWin);
    this.menu = new ListMenu<GameOverChoice>(
      this,
      W / 2 - 62,
      87 + PAGE_DY,
      [
        { label: 'Retry the fight', value: 'retry', enabled: this.canRetry, why: 'This fight can’t be retried.' },
        { label: 'Load last save', value: 'load', enabled: hasSave, why: 'Nothing saved yet: back to the title.' },
        { label: 'Return to title', value: 'title' },
      ],
      { rows: 3, width: 128, onSound: uiSound },
    );
    this.menu.index = this.canRetry ? 0 : hasSave ? 1 : 2;
    // The reason a row is locked sits under the window, centered on the screen (the list's own coordinates are relative to its corner).
    this.menu.setWhyAt(62, 45);
    this.menu.setVisible(false);
    ui.add(this.menu);
    this.paintArt();
  }

  protected tick(): void {
    this.rain.update(0, 0);
    const a = Math.min(1, this.t / 60);
    this.head.setAlpha(a);
    this.sub.setAlpha(a);
    this.paintArt();
    if (this.t < MENU_AT) return;
    this.menuWin.setVisible(true);
    this.menu.setVisible(true);
    const r = this.menu.update(this.input.actions);
    if (r === 'confirm' && this.menu.current) this.close(this.menu.current.value);
  }

  /** Draw the crew, then the rain over it, into the art canvas. */
  private paintArt(): void {
    const ctx = this.art.ctx;
    ctx.clearRect(0, 0, W, H);
    this.renderCrew(ctx, Math.min(1, this.t / 45));
    ctx.globalAlpha = Math.min(1, this.t / 60);
    this.rain.render(ctx);
    ctx.globalAlpha = 1;
    this.art.refresh();
  }

  /** Dark shapes on a wet street, edged in the city's red, with their reflections under them. */
  private renderCrew(ctx: CanvasRenderingContext2D, a: number): void {
    const { street, glow } = gameOverBands();
    ctx.globalAlpha = a;
    // The city's red glow behind them, so the shapes read against it.
    this.backlight ??= (() => {
      const g = ctx.createRadialGradient(W / 2, street.y, 10, W / 2, street.y, GLOW_REACH);
      g.addColorStop(0, 'rgba(255,58,90,0.34)');
      g.addColorStop(0.5, 'rgba(160,30,70,0.14)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      return g;
    })();
    ctx.fillStyle = this.backlight;
    ctx.fillRect(glow.x, glow.y, glow.w, glow.h);
    ctx.fillStyle = '#0c0a16';
    ctx.fillRect(street.x, street.y, street.w, street.h);
    ctx.fillStyle = 'rgba(255,58,90,0.18)';
    ctx.fillRect(0, street.y, W, 1);
    const gap = 74;
    const x0 = W / 2 - ((this.crew.length - 1) * gap) / 2;
    this.crew.forEach((c, i) => {
      const w = c.width * 2, h = c.height * 2;
      const x = Math.round(x0 + i * gap - w / 2), y = street.y - h + 4;
      ctx.globalAlpha = a * 0.16;
      ctx.save();
      ctx.translate(x, street.y + (street.y - y) - 8);
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
