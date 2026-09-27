/** Dialogue box overlay: typewriter text, paging, optional choices, portrait. */
import type { Ctx } from '../engine/canvas';
import { drawText, LINE_H, visibleLength, wrap } from '../engine/font';
import { Scene, W, H } from '../engine/game';
import { charsPerFrame } from '../game/settings';
import { speaker, type Speaker } from '../data/speakers';
import { drawCursor, drawMore, drawSelect, drawTab, drawWindow, UI } from '../ui/draw';
import { getPortrait } from '../art/portraits';
import { sfx } from '../audio/sfx';

export interface DialogOpts {
  who: string | null;
  text: string;
  choices?: string[];
  /** Choice index returned on cancel (default: none, cancel ignored). */
  cancel?: number;
  top?: boolean;
  face?: string;
  auto?: number;
}

const BOX_H = 62;
const PAD = 8;
const LINES = 4;
const LH = LINE_H + 1;

export class DialogScene extends Scene<number> {
  override opaque = false;
  override passUpdate = true;
  private pages: string[][] = [];
  private page = 0;
  private shown = 0;
  private waitFrames = 0;
  private sp: Speaker | null;
  private portrait: HTMLCanvasElement | null = null;
  private choiceIdx = 0;
  private frame = 0;
  private opened = 0;
  private autoT = 0;
  private blipAcc = 0;

  constructor(private o: DialogOpts) {
    super();
    this.sp = speaker(o.who);
    if (this.sp?.portrait) this.portrait = getPortrait(this.sp.portrait, o.face ?? 'neutral');
    const textW = W - 16 - PAD * 2 - (this.portrait ? 56 : 0);
    const lines = wrap(o.text, textW);
    for (let i = 0; i < lines.length; i += LINES) this.pages.push(lines.slice(i, i + LINES));
    if (!this.pages.length) this.pages.push(['']);
  }

  private pageLen(): number {
    return this.pages[this.page]!.reduce((n, l) => n + visibleLength(l), 0);
  }

  private get lastPage(): boolean {
    return this.page >= this.pages.length - 1;
  }

  private get typing(): boolean {
    return this.shown < this.pageLen();
  }

  update(): void {
    this.frame++;
    if (this.opened < 6) {
      this.opened++;
      return;
    }
    const inp = this.game.input;
    const fast = inp.down('cancel') && !this.o.choices;
    if (this.typing) {
      if (this.waitFrames > 0) {
        this.waitFrames--;
      } else {
        const before = Math.floor(this.shown);
        this.shown = Math.min(this.pageLen(), this.shown + charsPerFrame() * (fast ? 4 : 1));
        const after = Math.floor(this.shown);
        if (after > before && this.sp) {
          this.blipAcc += after - before;
          if (this.blipAcc >= 3) {
            this.blipAcc = 0;
            sfx('blip', this.sp.voice);
          }
        }
        // Pause on sentence ends for rhythm.
        const flat = this.pages[this.page]!.join(' ').replace(/\{[^}]*\}/g, '');
        const ch = flat[after - 1];
        if (after > before && (ch === '.' || ch === '?' || ch === '!') && flat[after] === ' ') this.waitFrames = fast ? 0 : 6;
      }
      if (inp.pressed('confirm')) this.shown = this.pageLen();
      return;
    }
    if (this.o.auto) {
      this.autoT++;
      if (this.autoT >= this.o.auto) this.advance();
      return;
    }
    if (this.lastPage && this.o.choices) {
      const n = this.o.choices.length;
      if (inp.repeat('up')) { this.choiceIdx = (this.choiceIdx + n - 1) % n; sfx('cursor'); }
      if (inp.repeat('down')) { this.choiceIdx = (this.choiceIdx + 1) % n; sfx('cursor'); }
      if (inp.pressed('confirm')) { sfx('confirm'); this.close(this.choiceIdx); }
      else if (inp.pressed('cancel') && this.o.cancel !== undefined) { sfx('cancel'); this.close(this.o.cancel); }
      return;
    }
    if (inp.pressed('confirm') || (fast && this.frame % 6 === 0)) this.advance();
  }

  private advance(): void {
    if (this.lastPage) {
      this.close(0);
    } else {
      this.page++;
      this.shown = 0;
      this.autoT = 0;
      sfx('page');
    }
  }

  render(ctx: Ctx): void {
    const k = Math.min(1, this.opened / 6);
    const y0 = this.o.top ? 6 : H - BOX_H - 6;
    const h = Math.max(4, Math.round(BOX_H * k));
    const y = y0 + Math.round((BOX_H - h) / 2);
    const accent = this.sp?.color ?? UI.cyan;
    drawWindow(ctx, 8, y, W - 16, h, { accent });
    if (k < 1) return;
    let tx = 8 + PAD;
    if (this.portrait) {
      const px = 8 + 7, py = y0 + 7;
      ctx.fillStyle = UI.outline;
      ctx.fillRect(px - 1, py - 1, 50, 50);
      ctx.drawImage(this.portrait, px, py, 48, 48);
      ctx.fillStyle = accent;
      ctx.fillRect(px - 1, py + 48, 50, 1);
      tx += 56;
    }
    if (this.sp) drawTab(ctx, 8 + (this.portrait ? 62 : 8), y0 - 5, this.sp.name, accent);
    const lines = this.pages[this.page]!;
    let remaining = Math.floor(this.shown);
    lines.forEach((ln, i) => {
      if (remaining <= 0) return;
      drawText(ctx, ln, tx, y0 + 9 + i * LH, { max: remaining });
      remaining -= visibleLength(ln);
    });
    if (!this.typing) {
      if (this.lastPage && this.o.choices) this.renderChoices(ctx, y0);
      else if (!this.o.auto) drawMore(ctx, W - 8 - 14, y0 + BOX_H - 13, this.frame, accent);
    }
  }

  private renderChoices(ctx: Ctx, boxY: number): void {
    const ch = this.o.choices!;
    const w = Math.max(80, ...ch.map((c) => wrap(c, 999)[0]!.length * 5)) + 24;
    const h = ch.length * 12 + 10;
    const x = W - 8 - w - 4;
    const y = this.o.top ? boxY + BOX_H + 4 : boxY - h - 4;
    drawWindow(ctx, x, y, w, h, { plain: true });
    ch.forEach((c, i) => {
      const ry = y + 5 + i * 12;
      if (i === this.choiceIdx) {
        drawSelect(ctx, x + 3, ry - 1, w - 6, 11);
        drawCursor(ctx, x + 5, ry, this.frame);
      }
      drawText(ctx, c, x + 14, ry, { color: i === this.choiceIdx ? UI.text : '#c8c6dc' });
    });
  }
}
