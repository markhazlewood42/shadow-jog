/** End-of-chapter results card. */
import { music } from '../audio/music';
import { sfx } from '../audio/sfx';
import { autoClose } from '../game/debug';
import { COMBOS } from '../data/abilities';
import { ENEMIES } from '../data/enemies';
import { MEMBERS } from '../data/party';
import { surface, type Ctx } from '../engine/canvas';
import { drawText, measure } from '../engine/font';
import { Scene, W, H } from '../engine/game';
import { keyLabel } from '../engine/input';
import { formatPlayTime } from '../game/save';
import { state } from '../game/state';
import { drawDivider, drawWindow, UI } from '../ui/draw';
import { getPortrait } from '../art/portraits';

export class EndingScene extends Scene<void> {
  private t = 0;
  /** 0: the run so far (and who is missing). 1: next-chapter card and thanks. */
  private page = 0;

  constructor(private playFrames: number) {
    super();
  }

  override enter(): void {
    music('sable', 60);
  }

  update(): void {
    this.t++;
    if (autoClose(this.t, 200)) {
      if (this.page === 0) this.turn();
      else this.close();
      return;
    }
    const ready = this.page === 0 ? MISSING_AT + 60 : 150;
    if (this.t > ready && (this.game.input.pressed('confirm') || this.game.input.pressed('cancel'))) {
      sfx('confirm');
      if (this.page === 0) this.turn();
      else this.close();
    }
  }

  private turn(): void {
    this.page = 1;
    this.t = 0;
    music('title', 90);
  }

  render(ctx: Ctx): void {
    ctx.fillStyle = '#07060d';
    ctx.fillRect(0, 0, W, H);
    if (this.page === 1) {
      this.renderNext(ctx);
      return;
    }
    ctx.globalAlpha = Math.min(1, this.t / 40);
    drawText(ctx, 'CHAPTER ONE · MILK RUN', W / 2, 16, { align: 'center', color: UI.pink });
    drawText(ctx, 'complete', W / 2, 28, { align: 'center', color: UI.dim });
    drawWindow(ctx, 60, 46, W - 120, 150, { title: 'THE RUN SO FAR' });
    const found = COMBOS.filter((c) => state.combos.includes(c.id)).length;
    const species = Object.keys(state.bestiary).filter((k) => ENEMIES[k]).length;
    const rows: [string, string][] = [
      ['Play time', formatPlayTime(this.playFrames)],
      ['Battles won', String(state.battles)],
      ['Combos discovered', `${found} / ${COMBOS.length}`],
      ['Bestiary', `${species} / ${Object.keys(ENEMIES).length - 1} species`],
      ['Cred (carries over)', `${state.cred.toLocaleString('en-US')}¢`],
      ['Side jobs', `${['job_cat_done', 'job_case_done', 'job_bounty_done'].filter((f) => state.flags[f]).length} / 3`],
    ];
    rows.forEach(([k, v], i) => {
      drawText(ctx, k, 76, 58 + i * 12, { color: UI.dim });
      drawText(ctx, v, W / 2 + 10, 58 + i * 12);
    });
    drawDivider(ctx, 70, 134, W - 140);
    const crew = state.party;
    const gone = Math.max(0, Math.min(1, (this.t - MISSING_AT) / 50));
    const base = ctx.globalAlpha;
    crew.forEach((id, i) => {
      const x = 80 + i * 82;
      const p = getPortrait(id, 'neutral');
      // Rook's card fades out as the reveal lands.
      const k = id === 'rook' ? 1 - gone * 0.75 : 1;
      ctx.globalAlpha = base * k;
      if (p) ctx.drawImage(p, x, 142, 32, 32);
      drawText(ctx, MEMBERS[id].name, x + 36, 146, { color: MEMBERS[id].color });
      drawText(ctx, `Lv ${state.members[id]?.level ?? 1}`, x + 36, 158, { color: UI.dim });
    });
    ctx.globalAlpha = base;
    // The one line that matters arrives on its own, after the numbers have had their moment.
    ctx.globalAlpha = Math.max(0, Math.min(1, (this.t - MISSING_AT) / 50));
    const mw = measure('Rook: missing') + 28;
    drawWindow(ctx, (W - mw) / 2, 208, mw, 19, { plain: true, accent: UI.red });
    drawText(ctx, 'Rook: {r}missing{/}', W / 2, 213, { align: 'center' });
    ctx.globalAlpha = 1;
    if (this.t > MISSING_AT + 60 && Math.floor(this.t / 25) % 2 === 0) drawText(ctx, '▼', W / 2, 250, { align: 'center', color: UI.cyan });
  }

  private renderNext(ctx: Ctx): void {
    const fade = (from: number) => Math.max(0, Math.min(1, (this.t - from) / 40));
    ctx.globalAlpha = fade(20);
    drawText(ctx, 'CHAPTER TWO', W / 2, 96, { align: 'center', color: UI.dim });
    ctx.globalAlpha = fade(50);
    drawBig(ctx, 'DENIABLE ASSETS', W / 2, 110, UI.cyan);
    ctx.globalAlpha = fade(80);
    drawText(ctx, 'coming soon', W / 2, 138, { align: 'center', color: UI.dim });
    ctx.globalAlpha = fade(130);
    drawText(ctx, 'Thank you for playing Chapter One.', W / 2, 206, { align: 'center', color: '#8a87a8' });
    ctx.globalAlpha = 1;
    const ok = this.game.input.keysFor('confirm')[0];
    if (this.t > 150 && Math.floor(this.t / 25) % 2 === 0) drawText(ctx, `Press ${ok ? keyLabel(ok) : 'Confirm'} to return to the title`, W / 2, 250, { align: 'center', color: UI.cyan });
  }
}

/** Frame at which "Rook: missing" starts to fade in on the results page. */
const MISSING_AT = 110;

/** The bitmap font at 2x, centred. */
const bigBuf = surface(W, 12);
function drawBig(ctx: Ctx, text: string, cx: number, y: number, color: string): void {
  bigBuf.ctx.clearRect(0, 0, W, 12);
  const w = drawText(bigBuf.ctx, text, 1, 1, { color, shadow: '#1a1020' });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bigBuf.canvas, 0, 0, w + 2, 12, Math.round(cx - w - 1), y, (w + 2) * 2, 24);
}
