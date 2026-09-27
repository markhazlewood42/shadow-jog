/** Save / load slot picker. Save writes immediately (with overwrite confirm); load returns the slot. */
import { buildChar } from '../art/chars';
import { sfx } from '../audio/sfx';
import { LOOKS } from '../data/looks';
import type { Ctx } from '../engine/canvas';
import { drawText } from '../engine/font';
import { Scene, W, H } from '../engine/game';
import { formatPlayTime, readMeta, writeSave, type SaveMeta, type SlotId } from '../game/save';
import { drawSelect, drawWindow, UI } from '../ui/draw';

export class SaveScene extends Scene<SlotId | null> {
  override opaque = false;
  private slots: SlotId[];
  private idx = 0;
  private confirm = false;
  private note = '';
  private t = 0;

  constructor(private mode: 'save' | 'load') {
    super();
    this.slots = mode === 'load' ? ['auto', 1, 2, 3] : [1, 2, 3];
    if (mode === 'load') {
      // Start on the most recent save.
      let best = -1;
      this.slots.forEach((s, i) => {
        const m = readMeta(s);
        if (m && m.when > best) {
          best = m.when;
          this.idx = i;
        }
      });
    }
  }

  update(): void {
    this.t++;
    const inp = this.game.input;
    const slot = this.slots[this.idx]!;
    if (this.confirm) {
      if (inp.pressed('confirm')) this.write(slot);
      else if (inp.pressed('cancel')) {
        sfx('cancel');
        this.confirm = false;
      }
      return;
    }
    const n = this.slots.length;
    if (inp.repeat('up')) { this.idx = (this.idx + n - 1) % n; sfx('cursor'); }
    if (inp.repeat('down')) { this.idx = (this.idx + 1) % n; sfx('cursor'); }
    if (inp.pressed('cancel')) {
      sfx('cancel');
      this.close(null);
      return;
    }
    if (!inp.pressed('confirm')) return;
    const meta = readMeta(slot);
    if (this.mode === 'load') {
      if (!meta) {
        sfx('buzz');
        this.note = 'That slot is empty.';
        return;
      }
      sfx('confirm');
      this.close(slot);
    } else if (meta) {
      sfx('confirm');
      this.confirm = true;
    } else this.write(slot);
  }

  private write(slot: SlotId): void {
    if (writeSave(slot, this.game.playFrames)) {
      sfx('save');
      this.note = `Saved to slot ${slot}.`;
      this.confirm = false;
      setTimeout(() => !this.closed && this.close(slot), 500);
    } else {
      sfx('buzz');
      this.note = 'Couldn\'t save — browser storage is unavailable.';
      this.confirm = false;
    }
  }

  render(ctx: Ctx): void {
    ctx.fillStyle = 'rgba(7,6,13,0.65)';
    ctx.fillRect(0, 0, W, H);
    const w = 330, rowH = 40;
    const h = this.slots.length * (rowH + 4) + 30;
    const x = (W - w) / 2, y = (H - h) / 2;
    drawWindow(ctx, x, y, w, h, { title: this.mode === 'save' ? 'SAVE GAME' : 'LOAD GAME' });
    this.slots.forEach((s, i) => {
      const ry = y + 10 + i * (rowH + 4);
      const sel = i === this.idx;
      drawWindow(ctx, x + 8, ry, w - 16, rowH, { plain: !sel, accent: sel ? UI.cyan : undefined });
      if (sel) drawSelect(ctx, x + 10, ry + 2, w - 20, rowH - 4, 'rgba(63,224,240,0.08)');
      const meta = readMeta(s);
      drawText(ctx, s === 'auto' ? 'AUTOSAVE' : `SLOT ${s}`, x + 16, ry + 6, { color: s === 'auto' ? UI.amber : UI.cyan });
      if (!meta) {
        drawText(ctx, 'Empty', x + 16, ry + 20, { color: UI.disabled });
        return;
      }
      this.drawMeta(ctx, meta, x + 16, ry, w - 32);
    });
    if (this.note) drawText(ctx, this.note, W / 2, y + h + 6, { align: 'center', color: UI.green });
    if (this.confirm) {
      drawWindow(ctx, x + 40, y + h / 2 - 16, w - 80, 32, { accent: UI.amber });
      drawText(ctx, 'Overwrite this save?', W / 2, y + h / 2 - 10, { align: 'center' });
      drawText(ctx, '{y}Confirm{/} yes · {d}Cancel{/} no', W / 2, y + h / 2 + 2, { align: 'center' });
    }
  }

  private drawMeta(ctx: Ctx, m: SaveMeta, x: number, y: number, w: number): void {
    drawText(ctx, m.location, x + 70, y + 6);
    drawText(ctx, new Date(m.when).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), x + w, y + 6, { align: 'right', color: UI.dim });
    m.party.forEach((name, i) => {
      const key = name.toLowerCase() as keyof typeof LOOKS;
      const look = LOOKS[key];
      if (look) ctx.drawImage(buildChar(look).frames.down[0]!, x + i * 16, y + 14, 14, 20);
    });
    drawText(ctx, `Lv ${m.leaderLevel}`, x + 70, y + 20, { color: UI.dim });
    drawText(ctx, `${m.cred.toLocaleString('en-US')}¢`, x + 120, y + 20, { color: UI.amber });
    drawText(ctx, formatPlayTime(m.playFrames), x + w, y + 20, { align: 'right', color: UI.dim });
  }
}
