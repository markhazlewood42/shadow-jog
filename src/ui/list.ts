/** Scrolling list menu widget with cursor, disabled rows, right-aligned detail and repeat navigation. */
import { sfx } from '../audio/sfx';
import type { Ctx } from '../engine/canvas';
import { drawText, fitText, measure } from '../engine/font';
import type { Input } from '../engine/input';
import { drawCursor, drawSelect, UI } from './draw';

export interface ListItem<T> {
  label: string;
  value: T;
  right?: string;
  enabled?: boolean;
  color?: string;
  /** Small colored tag drawn before the label (e.g. an icon glyph). */
  icon?: string;
  iconColor?: string;
}

export class ListMenu<T> {
  items: ListItem<T>[];
  index = 0;
  scroll = 0;
  rows: number;
  rowH = 11;
  cols = 1;
  frame = 0;
  /** Play sounds on navigation (disable for passive lists). */
  sounds = true;

  constructor(items: ListItem<T>[], rows = 6, cols = 1) {
    this.items = items;
    this.rows = rows;
    this.cols = cols;
  }

  get current(): ListItem<T> | undefined {
    return this.items[this.index];
  }

  setItems(items: ListItem<T>[]): void {
    this.items = items;
    this.index = Math.min(this.index, Math.max(0, items.length - 1));
    this.clampScroll();
  }

  private clampScroll(): void {
    const row = Math.floor(this.index / this.cols);
    if (row < this.scroll) this.scroll = row;
    if (row >= this.scroll + this.rows) this.scroll = row - this.rows + 1;
    // Never scroll past the end: a shorter list must show from its top, not leave rows hidden above.
    const maxScroll = Math.max(0, Math.ceil(this.items.length / this.cols) - this.rows);
    this.scroll = Math.max(0, Math.min(this.scroll, maxScroll));
  }

  /** Returns 'confirm' | 'cancel' | 'move' | null. Confirm on disabled rows returns 'blocked'. */
  update(input: Input): 'confirm' | 'cancel' | 'move' | 'blocked' | null {
    this.frame++;
    const n = this.items.length;
    if (input.pressed('cancel')) {
      if (this.sounds) sfx('cancel');
      return 'cancel';
    }
    if (!n) return null;
    const prev = this.index;
    if (input.repeat('up')) this.index = this.index - this.cols < 0 ? (this.cols === 1 ? n - 1 : this.index) : this.index - this.cols;
    else if (input.repeat('down')) this.index = this.index + this.cols >= n ? (this.cols === 1 ? 0 : this.index) : this.index + this.cols;
    else if (this.cols > 1 && input.repeat('left')) this.index = Math.max(0, this.index - 1);
    else if (this.cols > 1 && input.repeat('right')) this.index = Math.min(n - 1, this.index + 1);
    if (this.index !== prev) {
      this.clampScroll();
      if (this.sounds) sfx('cursor');
      return 'move';
    }
    if (input.pressed('confirm')) {
      if (this.current?.enabled === false) {
        sfx('buzz');
        return 'blocked';
      }
      if (this.sounds) sfx('confirm');
      return 'confirm';
    }
    return null;
  }

  /** `empty` is drawn in place of the rows when there is nothing to list. */
  render(ctx: Ctx, x: number, y: number, w: number, active = true, empty?: string): void {
    if (!this.items.length) {
      if (empty) drawText(ctx, empty, x + 4, y, { color: UI.dim });
      return;
    }
    const colW = Math.floor(w / this.cols);
    const start = this.scroll * this.cols;
    const end = Math.min(this.items.length, start + this.rows * this.cols);
    for (let i = start; i < end; i++) {
      const it = this.items[i]!;
      const r = Math.floor((i - start) / this.cols), c = (i - start) % this.cols;
      const rx = x + c * colW, ry = y + r * this.rowH;
      const sel = i === this.index;
      if (sel && active) drawSelect(ctx, rx - 2, ry - 1, colW - 2, this.rowH);
      if (sel) drawCursor(ctx, rx, ry, active ? this.frame : 0, active ? UI.cyan : UI.dim);
      const enabled = it.enabled !== false;
      let lx = rx + 9;
      if (it.icon) {
        drawText(ctx, it.icon, lx, ry, { color: it.iconColor ?? UI.dim });
        lx += measure(it.icon) + 3;
      }
      // Labels are cut to the room left by the right-hand column, never drawn over it.
      const room = rx + colW - 6 - (it.right ? measure(it.right) + 6 : 0) - lx;
      const color = !enabled ? UI.disabled : !active ? (sel ? '#b8bcd0' : '#7d8098') : it.color ?? (sel ? UI.text : '#d0cee4');
      drawText(ctx, fitText(it.label, room), lx, ry, { color });
      if (it.right) drawText(ctx, it.right, rx + colW - 6, ry, { color: enabled ? UI.dim : UI.disabled, align: 'right' });
    }
    // Scroll indicators
    const totalRows = Math.ceil(this.items.length / this.cols);
    if (this.scroll > 0) drawText(ctx, '▲', x + w - 10, y - 9, { color: UI.cyan });
    if (this.scroll + this.rows < totalRows) drawText(ctx, '▼', x + w - 10, y + this.rows * this.rowH - 2, { color: UI.cyan });
  }
}
