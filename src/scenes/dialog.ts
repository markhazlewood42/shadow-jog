/** Dialogue box overlay: typewriter text, paging, optional choices, portrait. */
import type { Ctx } from '../engine/canvas';
import { drawText, LINE_H, measure, visibleLength, wrap } from '../engine/font';
import { Scene } from '../engine/game';
import { W, H } from '../sje/core/size';
import { charsPerFrame } from '../game/settings';
import { speaker, type Speaker } from '../data/speakers';
import { drawCursor, drawMore, drawSelect, drawTab, drawWindow, UI } from '../ui/draw';
import { getPortrait } from '../art/portraits';
import { sfx } from '../audio/sfx';
import { audio } from '../audio/engine';
import { debug } from '../game/debug';
import { DIALOG_PAD, DIALOG_PORTRAIT_COL, dialogBoxW, dialogTextW } from '../ui/layout';

export interface DialogOpts {
  who: string | null;
  text: string;
  choices?: string[] | undefined;
  /** Choice index returned on cancel (default: none, cancel ignored). */
  cancel?: number | undefined;
  top?: boolean | undefined;
  face?: string | undefined;
  auto?: number | undefined;
}

const BOX_H = 62;
const PAD = DIALOG_PAD;
const LINES = 4;
const LH = LINE_H + 1;
/** Fast-forward hint: shown on the first few boxes, dropped once the player has used it. */
const ffHint = { left: 8 };

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
  private bufferedPress = false;
  private autoT = 0;
  private blipAcc = 0;
  /** The box: its width (capped and centered, D8) and left edge. The numbers are `ui/layout.ts`'s. */
  private bw = dialogBoxW();
  private bx = Math.round((W - this.bw) / 2);

  constructor(private o: DialogOpts) {
    super();
    this.sp = speaker(o.who);
    if (this.sp?.portrait) this.portrait = getPortrait(this.sp.portrait, o.face ?? 'neutral');
    const textW = dialogTextW(this.bw, !!this.portrait);
    const lines = wrap(o.text, textW);
    for (let i = 0; i < lines.length; i += LINES) this.pages.push(lines.slice(i, i + LINES));
    if (!this.pages.length) this.pages.push(['']);
  }

  override enter(): void {
    audio.duck(true);
  }

  override exit(): void {
    audio.duck(false);
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
    if (debug.autoDialog) {
      this.close(0);
      return;
    }
    const inp = this.game.input;
    if (this.opened < 6) {
      // A press during the open animation isn't lost: it fast-completes the first line.
      if (inp.pressed('confirm')) this.bufferedPress = true;
      this.opened++;
      if (this.opened === 6 && ffHint.left > 0) ffHint.left--;
      return;
    }
    if (this.bufferedPress) {
      this.bufferedPress = false;
      this.shown = this.pageLen();
    }
    const fast = (inp.down('cancel') || debug.playtest) && !this.o.choices;
    if (fast && !debug.playtest) ffHint.left = 0;
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
    if (this.o.auto || debug.playtest) {
      this.autoT++;
      if (this.autoT >= (this.o.auto || 50)) this.advance();
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
    drawWindow(ctx, this.bx, y, this.bw, h, { accent });
    if (k < 1) return;
    let tx = this.bx + PAD;
    if (this.portrait) {
      const px = this.bx + 7, py = y0 + 7;
      ctx.fillStyle = UI.outline;
      ctx.fillRect(px - 1, py - 1, 50, 50);
      // Rig v2 portraits work the mouth while the line types and blink now and then.
      const mod = this.typing && !this.waitFrames ? ((this.frame >> 2) % 2 ? 'talk' : undefined) : this.frame % 210 < 6 ? 'blink' : undefined;
      const face = mod && this.sp?.portrait ? getPortrait(this.sp.portrait, this.o.face ?? 'neutral', mod) : null;
      ctx.drawImage(face ?? this.portrait, px, py, 48, 48);
      ctx.fillStyle = accent;
      ctx.fillRect(px - 1, py + 48, 50, 1);
      tx += DIALOG_PORTRAIT_COL;
    }
    if (this.sp) drawTab(ctx, this.bx + (this.portrait ? 62 : 8), y0 - 5, this.sp.name, accent);
    const lines = this.pages[this.page]!;
    let remaining = Math.floor(this.shown);
    lines.forEach((ln, i) => {
      if (remaining <= 0) return;
      drawText(ctx, ln, tx, y0 + 9 + i * LH, { max: remaining });
      remaining -= visibleLength(ln);
    });
    if (!this.typing) {
      if (this.lastPage && this.o.choices) this.renderChoices(ctx, y0);
      else if (!this.o.auto) drawMore(ctx, this.bx + this.bw - 14, y0 + BOX_H - 13, this.frame, accent);
    } else if (ffHint.left > 0 && !this.o.choices && !this.o.auto) {
      // Teach fast-forward early; stop once the player has used it.
      drawText(ctx, '{d}Hold X to fast-forward{/}', this.bx + this.bw - PAD, this.o.top ? y0 + BOX_H + 3 : y0 - 10, { align: 'right' });
    }
  }

  private renderChoices(ctx: Ctx, boxY: number): void {
    const ch = this.o.choices!;
    const w = Math.max(80, ...ch.map((c) => measure(c))) + 24;
    const h = ch.length * 12 + 10;
    // Anchored to the right end of the box (capped and centered, so the choices stay beside the question).
    const x = this.bx + this.bw - w - 4;
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
