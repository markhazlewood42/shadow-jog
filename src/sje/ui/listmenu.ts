/**
 * ListMenu: a scrolling list with a cursor (UI kit, M8a). The old `ListMenu` of `src/ui/list.ts`, as a container of display objects.
 *
 * What it does, as before:
 *  - the cursor moves with up and down (and left and right when there are columns), repeats while held, WRAPS from the first row to the last in a
 *    single column, and stops at the edge in a grid;
 *  - the visible rows are a WINDOW onto the list: `scroll` is the first visible row, the window follows the cursor, and it never scrolls past the end;
 *  - a row can be locked (`enabled: false`): confirm on it answers `blocked`, and its `why` shows while it is selected, in amber for a moment after
 *    it was pressed;
 *  - a row has a label (cut with an ellipsis if it would run over the right-hand text), optional right-hand text, an icon glyph and colors;
 *  - the highlight eases toward the cursor's row and snaps on a long jump or a wrap-around.
 *
 * What is different: it is retained, not redrawn. It builds its text objects once and updates them (a `TextObject` ignores a string it already shows), so
 * a tick where nothing changed repaints nothing. x,y is the list's top-left corner and the first row's text starts at y. The list keeps only its items
 * and the cursor and takes plain data, so a tool can preview it. It plays no sound: pass `onSound` and the scene plays them.
 *
 * Call `update(actions)` once per tick for a list that takes input. `update()` without input only animates (a passive list beside the active one).
 * `rows`, `cols`, `rowH`, `scroll`, `index`, `width`, `focused` and `empty` can be set at any time; the picture follows at once.
 * The highlight's ease takes one step per `update`, as the old one took one per `render`.
 */
import { Container } from '../display/container';
import { fitText, measure } from '../display/font';
import type { DisplayHost } from '../display/gameobject';
import { Graphics } from '../display/graphics';
import { Cursor } from './cursor';
import { type ListParams, SELECT_FILL, UI, UI_DEFAULTS } from './params';
import { TextObject } from './textobject';

export interface ListItem<T> {
  label: string;
  value: T;
  right?: string | undefined;
  /** Color for the right-hand detail (a price you can't afford reads red). */
  rightColor?: string | undefined;
  enabled?: boolean | undefined;
  /** Why a disabled row can't be chosen: shown while it is selected, flashed when pressed. */
  why?: string | undefined;
  color?: string | undefined;
  /** Small colored tag drawn before the label (e.g. an icon glyph). */
  icon?: string | undefined;
  iconColor?: string | undefined;
}

export type ListAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'cancel';
export type ListResult = 'confirm' | 'cancel' | 'move' | 'blocked';
export type UiSound = 'cursor' | 'confirm' | 'cancel' | 'buzz';

/** What a list reads from the player: the scene's `ActionMap` fits. */
export interface ListInput {
  justPressed(a: ListAction): boolean;
  repeat(a: ListAction): boolean;
}

/** The index after one step of the cursor, or the same index when it cannot move. A single column wraps; a grid stops at its edges. */
export function stepIndex(index: number, n: number, cols: number, action: 'up' | 'down' | 'left' | 'right'): number {
  if (n <= 0) return 0;
  if (action === 'up') return index - cols < 0 ? (cols === 1 ? n - 1 : index) : index - cols;
  if (action === 'down') return index + cols >= n ? (cols === 1 ? 0 : index) : index + cols;
  if (cols <= 1) return index;
  if (action === 'left') return Math.max(0, index - 1);
  return Math.min(n - 1, index + 1);
}

/** The first visible row for a cursor at `index`: the window follows the cursor, and never starts so late that rows stay hidden above a short list. */
export function scrollFor(index: number, scroll: number, rows: number, cols: number, n: number): number {
  const row = Math.floor(index / cols);
  let s = scroll;
  if (row < s) s = row;
  if (row >= s + rows) s = row - rows + 1;
  const maxScroll = Math.max(0, Math.ceil(n / cols) - rows);
  return Math.max(0, Math.min(s, maxScroll));
}

/** Where one visible row goes, in the list's own coordinates. */
export interface RowGeometry {
  /** The item's index. */
  i: number;
  /** The row's left edge and top. */
  rx: number;
  ry: number;
  /** Where the label starts (after the cursor's room and the icon). */
  labelX: number;
  /** The width the label may take before it would run over the right-hand text. */
  room: number;
  /** Where the right-hand text ends (it is right-aligned). */
  rightX: number;
  /** The width of one column. */
  colW: number;
}

/** The geometry of the visible rows (the rule of the old `ListMenu.render`, as plain numbers). */
export function listRows<T>(items: readonly ListItem<T>[], scroll: number, rows: number, cols: number, rowH: number, width: number): RowGeometry[] {
  const colW = Math.floor(width / cols);
  const start = scroll * cols;
  const end = Math.min(items.length, start + rows * cols);
  const out: RowGeometry[] = [];
  for (let i = start; i < end; i++) {
    const it = items[i];
    if (!it) continue;
    const r = Math.floor((i - start) / cols);
    const c = (i - start) % cols;
    const rx = c * colW;
    let labelX = rx + 9;
    if (it.icon) labelX += measure(it.icon) + 3;
    out.push({ i, rx, ry: r * rowH, labelX, room: rx + colW - 6 - (it.right ? measure(it.right) + 6 : 0) - labelX, rightX: rx + colW - 6, colW });
  }
  return out;
}

/** The text objects of one visible row. */
interface Slot {
  label: TextObject;
  right: TextObject;
  icon: TextObject;
}

export class ListMenu<T> extends Container {
  private _items: ListItem<T>[];
  private _index = 0;
  private _scroll = 0;
  private _rows: number;
  private _cols: number;
  private _rowH: number;
  private _width: number;
  private _focused = true;
  private _empty: string | undefined;
  private frame = 0;
  /** Frames left of the flash on a locked row's reason after it was pressed. */
  private buzzT = 0;
  /** Row the highlight is drawn at (eases toward the cursor's row; snaps on wrap-around). -1: not set yet. */
  private shownRow = -1;
  private readonly params: ListParams;
  /** Called with the sound a move, a choice or a refusal should make. */
  onSound: ((sound: UiSound) => void) | null;
  /** Play the cursor, confirm and cancel sounds (a locked row's buzz always plays). Turn it off for a passive list. */
  sounds = true;

  private readonly highlight: Graphics;
  private highlightKey = '';
  private highlightBox: { x: number; y: number; w: number; h: number } | null = null;
  private readonly cursor: Cursor;
  private readonly slots: Slot[] = [];
  private readonly up: TextObject;
  private readonly down: TextObject;
  private readonly emptyText: TextObject;
  private readonly whyText: TextObject;
  private whyX = 0;
  private whyY = 0;

  constructor(scene: DisplayHost, x: number, y: number, items: ListItem<T>[], params: Partial<ListParams> & { onSound?: (s: UiSound) => void } = {}) {
    super(scene, x, y, 'list');
    const { onSound, ...rest } = params;
    this.params = { ...UI_DEFAULTS.list, ...rest };
    this.onSound = onSound ?? null;
    this._items = items;
    this._rows = this.params.rows;
    this._cols = this.params.cols;
    this._rowH = this.params.rowH;
    this._width = this.params.width;
    this.highlight = new Graphics(scene).setDepth(0);
    this.cursor = new Cursor(scene, 0, 0).setDepth(1);
    this.up = new TextObject(scene, 0, 0, '▲', { color: UI.cyan }).setDepth(1);
    this.down = new TextObject(scene, 0, 0, '▼', { color: UI.cyan }).setDepth(1);
    this.emptyText = new TextObject(scene, 4, 0, '', { color: UI.dim }).setDepth(1);
    this.whyText = new TextObject(scene, 0, 0, '', { color: UI.dim, align: 'center' }).setDepth(1);
    this.add([this.highlight, this.cursor, this.up, this.down, this.emptyText, this.whyText]);
    this.name = 'list';
    this.refresh();
  }

  /** Where the selection highlight is, in the list's own coordinates, or null (an empty list, or a list that is not focused). For tools and tests. */
  get highlightRect(): { x: number; y: number; w: number; h: number } | null {
    return this.highlightBox;
  }

  // ---- the data ---------------------------------------------------------------------------------------------

  get items(): ListItem<T>[] {
    return this._items;
  }
  get index(): number {
    return this._index;
  }
  /** Move the cursor (clamped to the list); the window follows it. */
  set index(i: number) {
    this._index = Math.max(0, Math.min(i, Math.max(0, this._items.length - 1)));
    this.followCursor();
    this.refresh();
  }
  get current(): ListItem<T> | undefined {
    return this._items[this._index];
  }
  get scroll(): number {
    return this._scroll;
  }
  /** Set the first visible row (kept so the cursor stays visible and no rows hide above a short list). */
  set scroll(s: number) {
    this._scroll = s;
    this.followCursor();
    this.refresh();
  }
  get rows(): number {
    return this._rows;
  }
  set rows(n: number) {
    this._rows = Math.max(1, n);
    this.followCursor();
    this.refresh();
  }
  get cols(): number {
    return this._cols;
  }
  set cols(n: number) {
    this._cols = Math.max(1, n);
    this.followCursor();
    this.refresh();
  }
  get rowH(): number {
    return this._rowH;
  }
  set rowH(n: number) {
    this._rowH = n;
    this.refresh();
  }
  get width(): number {
    return this._width;
  }
  set width(w: number) {
    this._width = w;
    this.refresh();
  }
  /** A list that is not focused is drawn dim and without the highlight (the list beside the one that has the cursor). */
  get focused(): boolean {
    return this._focused;
  }
  set focused(on: boolean) {
    this._focused = on;
    this.refresh();
  }
  /** Shown in place of the rows when there is nothing to list. */
  get empty(): string | undefined {
    return this._empty;
  }
  set empty(text: string | undefined) {
    this._empty = text;
    this.refresh();
  }
  /** The selected row's reason for being locked, if it is; nothing otherwise. */
  get why(): string | undefined {
    const it = this.current;
    return it && it.enabled === false ? it.why : undefined;
  }
  /** Where the `why` line is centered, in the list's own coordinates (the old `renderWhy(ctx, cx, y)` minus the list's place). */
  setWhyAt(cx: number, y: number): this {
    this.whyX = cx;
    this.whyY = y;
    this.refresh();
    return this;
  }

  setItems(items: ListItem<T>[]): void {
    this._items = items;
    this._index = Math.min(this._index, Math.max(0, items.length - 1));
    this.followCursor();
    this.refresh();
  }

  private followCursor(): void {
    this._scroll = scrollFor(this._index, this._scroll, this._rows, this._cols, this._items.length);
  }

  // ---- input ------------------------------------------------------------------------------------------------

  /**
   * One tick. With input: returns 'confirm', 'cancel', 'move', 'blocked' (confirm on a locked row) or null. Without input it only animates.
   * Cancel works on an empty list too; the rest does nothing there.
   */
  update(input?: ListInput): ListResult | null {
    this.frame++;
    if (this.buzzT > 0) this.buzzT--;
    const result = input ? this.read(input) : null;
    this.ease();
    this.refresh();
    return result;
  }

  private read(input: ListInput): ListResult | null {
    const n = this._items.length;
    if (input.justPressed('cancel')) {
      if (this.sounds) this.onSound?.('cancel');
      return 'cancel';
    }
    if (!n) return null;
    const prev = this._index;
    const dir = (['up', 'down', 'left', 'right'] as const).find((a) => input.repeat(a));
    if (dir) this._index = stepIndex(this._index, n, this._cols, dir);
    if (this._index !== prev) {
      this.followCursor();
      if (this.sounds) this.onSound?.('cursor');
      return 'move';
    }
    if (input.justPressed('confirm')) {
      if (this.current?.enabled === false) {
        this.onSound?.('buzz');
        this.buzzT = this.params.buzzFrames;
        return 'blocked';
      }
      if (this.sounds) this.onSound?.('confirm');
      return 'confirm';
    }
    return null;
  }

  // ---- the picture ------------------------------------------------------------------------------------------

  /** One step of the highlight toward the cursor's row. It snaps on the first draw, in a grid, and on a jump of more than `snapRows`. */
  private ease(): void {
    const target = Math.floor(this._index / this._cols) - this._scroll;
    if (this.shownRow < 0 || this._cols > 1 || Math.abs(target - this.shownRow) > this.params.snapRows) this.shownRow = target;
    else this.shownRow += (target - this.shownRow) * this.params.ease;
    if (Math.abs(target - this.shownRow) < 0.05) this.shownRow = target;
  }

  /** Bring every child in line with the data. Cheap when nothing changed. */
  refresh(): void {
    if (this.destroyed) return;
    const { _items: items, _rows: rows, _cols: cols, _rowH: rowH, _width: width } = this;
    const empty = items.length === 0;
    if (this.shownRow < 0 && !empty) this.shownRow = Math.floor(this._index / cols) - this._scroll;

    // The reason a locked row gives.
    const why = this.why;
    this.whyText.setPosition(this.whyX, this.whyY);
    this.whyText.setText(why ?? '');
    this.whyText.setVisible(!!why);
    if (why) this.whyText.setStyle({ color: this.buzzT > 0 && (this.buzzT >> 2) % 2 === 0 ? UI.amber : UI.dim });

    this.emptyText.setText(empty ? (this._empty ?? '') : '');
    this.emptyText.setVisible(empty && !!this._empty);
    for (const s of this.slots) {
      s.label.setVisible(false);
      s.right.setVisible(false);
      s.icon.setVisible(false);
    }
    this.cursor.setVisible(false);
    if (empty) {
      this.paintHighlight(null);
      this.up.setVisible(false);
      this.down.setVisible(false);
      return;
    }

    const geo = listRows(items, this._scroll, rows, cols, rowH, width);
    while (this.slots.length < geo.length) this.addSlot();
    let highlight: { x: number; y: number; w: number; h: number } | null = null;
    for (const [k, g] of geo.entries()) {
      const it = items[g.i];
      const slot = this.slots[k];
      if (!it || !slot) continue;
      const sel = g.i === this._index;
      const hy = cols > 1 ? g.ry : Math.round(this.shownRow * rowH);
      if (sel && this._focused) highlight = { x: g.rx - 2, y: hy - 1, w: g.colW - 2, h: rowH };
      if (sel) {
        this.cursor.setHome(g.rx, hy);
        this.cursor.setStyle({ color: this._focused ? UI.cyan : UI.dim });
        this.cursor.setFrame(this._focused ? this.frame : 0);
        this.cursor.setVisible(true);
      }
      const enabled = it.enabled !== false;
      if (it.icon) {
        slot.icon.setText(it.icon);
        slot.icon.setStyle({ color: it.iconColor ?? UI.dim });
        slot.icon.setPosition(g.rx + 9, g.ry);
        slot.icon.setVisible(true);
      }
      const p = this.params;
      const color = !enabled ? UI.disabled : !this._focused ? (sel ? p.idleColorSelected : p.idleColor) : (it.color ?? (sel ? p.rowColorSelected : p.rowColor));
      slot.label.setText(fitText(it.label, g.room));
      slot.label.setStyle({ color });
      slot.label.setPosition(g.labelX, g.ry);
      slot.label.setVisible(true);
      if (it.right) {
        slot.right.setText(it.right);
        slot.right.setStyle({ color: it.rightColor ?? (enabled ? UI.dim : UI.disabled), align: 'right' });
        slot.right.setPosition(g.rightX, g.ry);
        slot.right.setVisible(true);
      }
    }
    this.paintHighlight(highlight);

    // Scroll indicators
    const totalRows = Math.ceil(items.length / cols);
    this.up.setPosition(width - 10, -9);
    this.up.setVisible(this._scroll > 0);
    this.down.setPosition(width - 10, rows * rowH - 2);
    this.down.setVisible(this._scroll + rows < totalRows);
  }

  /** The highlight is a Graphics: repaint it only when its rectangle moved. */
  private paintHighlight(r: { x: number; y: number; w: number; h: number } | null): void {
    const key = r ? `${r.x},${r.y},${r.w},${r.h}` : '';
    if (key === this.highlightKey) return;
    this.highlightKey = key;
    this.highlightBox = r;
    this.highlight.clear();
    if (r) this.highlight.fillStyle(SELECT_FILL.color, SELECT_FILL.alpha).fillRect(r.x, r.y, r.w, r.h);
  }

  private addSlot(): void {
    const mk = (align: 'left' | 'right'): TextObject => {
      const t = new TextObject(this.scene, 0, 0, '', { align }).setDepth(1).setVisible(false);
      this.add(t);
      return t;
    };
    this.slots.push({ label: mk('left'), right: mk('right'), icon: mk('left') });
  }
}
