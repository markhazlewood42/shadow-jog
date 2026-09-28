/** End-of-chapter results card. */
import { music } from '../audio/music';
import { sfx } from '../audio/sfx';
import { autoClose } from '../game/debug';
import { COMBOS } from '../data/abilities';
import { ENEMIES } from '../data/enemies';
import { MEMBERS } from '../data/party';
import type { Ctx } from '../engine/canvas';
import { drawText } from '../engine/font';
import { Scene, W, H } from '../engine/game';
import { formatPlayTime } from '../game/save';
import { state } from '../game/state';
import { drawDivider, drawWindow, UI } from '../ui/draw';
import { getPortrait } from '../art/portraits';

export class EndingScene extends Scene<void> {
  private t = 0;

  constructor(private playFrames: number) {
    super();
  }

  override enter(): void {
    music('victory_boss', 30);
  }

  update(): void {
    this.t++;
    if (autoClose(this.t, 200)) return this.close();
    if (this.t > 90 && (this.game.input.pressed('confirm') || this.game.input.pressed('cancel'))) {
      sfx('confirm');
      this.close();
    }
  }

  render(ctx: Ctx): void {
    ctx.fillStyle = '#07060d';
    ctx.fillRect(0, 0, W, H);
    const a = Math.min(1, this.t / 40);
    ctx.globalAlpha = a;
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
      ['Cred on hand', `${state.cred.toLocaleString('en-US')}¢`],
      ['Side jobs', `${['job_cat_done', 'job_case_done', 'job_bounty_done'].filter((f) => state.flags[f]).length} / 3`],
    ];
    rows.forEach(([k, v], i) => {
      drawText(ctx, k, 76, 58 + i * 12, { color: UI.dim });
      drawText(ctx, v, W / 2 + 10, 58 + i * 12);
    });
    drawDivider(ctx, 70, 134, W - 140);
    const crew = state.party;
    crew.forEach((id, i) => {
      const x = 80 + i * 82;
      const p = getPortrait(id, 'neutral');
      if (p) ctx.drawImage(p, x, 142, 32, 32);
      drawText(ctx, MEMBERS[id].name, x + 36, 146, { color: MEMBERS[id].color });
      drawText(ctx, `Lv ${state.members[id]?.level ?? 1}`, x + 36, 158, { color: UI.dim });
    });
    drawText(ctx, 'Rook: {r}missing{/}', W / 2, 182, { align: 'center' });
    drawText(ctx, 'Thank you for playing the SHADOW JOG alpha.', W / 2, 212, { align: 'center' });
    drawText(ctx, 'Chapter Two: {c}Rook, Taken{/} — coming soon.', W / 2, 226, { align: 'center', color: UI.dim });
    if (this.t > 90 && Math.floor(this.t / 25) % 2 === 0) drawText(ctx, 'Press Z to return to the title', W / 2, 250, { align: 'center', color: UI.cyan });
    ctx.globalAlpha = 1;
    void H;
  }
}
