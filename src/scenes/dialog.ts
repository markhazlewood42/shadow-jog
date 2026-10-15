/**
 * Dialogue box overlay: typewriter text, paging, optional choices, portrait. Native sje scene (M8b).
 *
 * Editor contract (migration.md principle 11), items (d) and (e):
 *  - `snapshot()` / `restore(snap)`: the live state of the box as plain data (the line, the page, the characters shown, the choice cursor, the
 *    counters). A tool can capture a box and put it back.
 *  - `step(n)`: advance n ticks of the box's own clock with no keys pressed and no sound: the open animation, then the typewriter. It never
 *    turns a page and never closes the box, so a tool can scrub the reveal of one page. The same n from the same state gives the same state.
 */
import { getPortrait } from '../art/portraits';
import { audio } from '../audio/engine';
import { sfx } from '../audio/sfx';
import { speaker, type Speaker } from '../data/speakers';
import { charsPerFrame } from '../game/settings';
import { debug } from '../game/debug';
import { CanvasImage, Cursor, LINE_H, ListMenu, measure, NineSlice, paintTab, TextObject, UI, visibleLength, wrap } from '../sje';
import { H, W } from '../sje/core/size';
import { DIALOG_PAD, DIALOG_PORTRAIT_COL, dialogBoxW, dialogTextW } from '../ui/layout';
import { UiScene } from './uiscene';
import { uiSound } from './uisound';

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

/** The live state of a dialogue box, as plain data (editor contract item d). Every field is a number, a string or a flat record. */
export interface DialogSnapshot {
  /** The line that was asked for: speaker, text, choices and the rest. This is what identifies the line. */
  opts: DialogOpts;
  /** The page being shown, and how many characters of it are shown (a fraction while a fast reveal runs). */
  page: number;
  shown: number;
  /** The pause left after a sentence end, in ticks. */
  waitFrames: number;
  /** The choice the cursor is on. */
  choiceIdx: number;
  /** The box's own clock: ticks since it opened (`frame`), the open animation (`opened`, 0 to 6), the auto-page timer and the blip counter. */
  frame: number;
  opened: number;
  autoT: number;
  blipAcc: number;
  /** A confirm press that came during the open animation and is waiting for it to end. */
  bufferedPress: boolean;
}

const BOX_H = 62;
const PAD = DIALOG_PAD;
const LINES = 4;
const LH = LINE_H + 1;
/** The open animation lasts this many ticks. */
const OPEN_TICKS = 6;
/** Fast-forward hint: shown on the first few boxes, dropped once the player has used it. */
const ffHint = { left: 8 };

/** A copy of the line's options with the undefined keys removed, so a snapshot is plain JSON. */
function plainOpts(o: DialogOpts): DialogOpts {
  const out: DialogOpts = { who: o.who, text: o.text };
  if (o.choices) out.choices = [...o.choices];
  if (o.cancel !== undefined) out.cancel = o.cancel;
  if (o.top !== undefined) out.top = o.top;
  if (o.face !== undefined) out.face = o.face;
  if (o.auto !== undefined) out.auto = o.auto;
  return out;
}

export class DialogScene extends UiScene<number> {
  private o: DialogOpts;
  private pages: string[][] = [];
  private page = 0;
  private shown = 0;
  private waitFrames = 0;
  private sp: Speaker | null = null;
  private hasPortrait = false;
  private choiceIdx = 0;
  private frame = 0;
  private opened = 0;
  private bufferedPress = false;
  private autoT = 0;
  private blipAcc = 0;
  /** The box: its width (capped and centered, D8) and left edge. The numbers are `ui/layout.ts`'s. */
  private bw = dialogBoxW();
  private bx = Math.round((W - this.bw) / 2);

  private win!: NineSlice;
  private portrait: CanvasImage | null = null;
  private portraitKey = '';
  private tab: CanvasImage | null = null;
  private body: TextObject[] = [];
  private more!: Cursor;
  private hint!: TextObject;
  private choiceWin: NineSlice | null = null;
  private menu: ListMenu<number> | null = null;

  constructor(o: DialogOpts) {
    super();
    this.opaque = false;
    this.passUpdate = true;
    this.o = o;
    this.setLine(o);
  }

  /** Work out the speaker, the portrait and the pages of a line. */
  private setLine(o: DialogOpts): void {
    this.o = o;
    this.sp = speaker(o.who);
    this.hasPortrait = !!(this.sp?.portrait && getPortrait(this.sp.portrait, o.face ?? 'neutral'));
    const textW = dialogTextW(this.bw, this.hasPortrait);
    const lines = wrap(o.text, textW);
    this.pages = [];
    for (let i = 0; i < lines.length; i += LINES) this.pages.push(lines.slice(i, i + LINES));
    if (!this.pages.length) this.pages.push(['']);
  }

  override create(): void {
    audio.duck(true);
    this.events.on('shutdown', () => audio.duck(false));
    this.buildObjects();
    this.refreshView();
  }

  /** Make every display object of the current line. Called by `create` and again by `restore` (a restored line can differ from the constructed one). */
  private buildObjects(): void {
    const ui = this.sys.ui;
    const accent = this.sp?.color ?? UI.cyan;
    const y0 = this.boxTop();
    for (const o of [this.win, this.portrait, this.tab, this.more, this.hint, this.choiceWin, this.menu, ...this.body]) o?.destroy();
    this.portrait = null;
    this.portraitKey = '';
    this.tab = null;
    this.body = [];
    this.choiceWin = null;
    this.menu = null;
    this.win = new NineSlice(this, this.bx, y0 + (BOX_H - 4) / 2, this.bw, 4, { accent });
    ui.add(this.win);
    const tx = this.bx + PAD + (this.hasPortrait ? DIALOG_PORTRAIT_COL : 0);
    if (this.hasPortrait) {
      // The portrait: a dark frame round the 48 px picture and an accent line under it, one canvas picture (art).
      this.portrait = new CanvasImage(this, this.bx + 6, y0 + 6, 50, 50);
      ui.add(this.portrait);
    }
    if (this.sp) {
      const label = this.sp.name;
      const tw = measure(label) + 8;
      // The name tab hangs on the top edge (the old drawTab). The picture reaches one pixel round the tab for its dark rim.
      const tab = new CanvasImage(this, this.bx + (this.hasPortrait ? 62 : 8) - 1, y0 - 5 - 1, tw + 2, 12);
      paintTab(tab.ctx, 1, 1, label, accent);
      tab.refresh();
      this.tab = tab;
      ui.add(tab);
    }
    for (let i = 0; i < LINES; i++) {
      const line = new TextObject(this, tx, y0 + 9 + i * LH, '');
      this.body.push(line);
      ui.add(line);
    }
    this.more = new Cursor(this, this.bx + this.bw - 14, y0 + BOX_H - 13, 'more', accent);
    ui.add(this.more);
    this.hint = new TextObject(this, this.bx + this.bw - PAD, this.o.top ? y0 + BOX_H + 3 : y0 - 10, '{d}Hold X to fast-forward{/}', { align: 'right' });
    ui.add(this.hint);
    if (this.o.choices) this.buildChoices(y0);
  }

  /** The choice box: anchored to the right end of the dialog box (capped and centered, so the choices stay beside the question). */
  private buildChoices(boxY: number): void {
    const ch = this.o.choices ?? [];
    const w = Math.max(80, ...ch.map((c) => measure(c))) + 24;
    const h = ch.length * 12 + 10;
    const x = this.bx + this.bw - w - 4;
    const y = this.o.top ? boxY + BOX_H + 4 : boxY - h - 4;
    this.choiceWin = new NineSlice(this, x, y, w, h, { plain: true });
    this.sys.ui.add(this.choiceWin);
    // Cancel makes a sound only when the line answers it (a box with no `cancel` ignores the key).
    const onSound = (s: Parameters<typeof uiSound>[0]): void => {
      if (s === 'cancel' && this.o.cancel === undefined) return;
      uiSound(s);
    };
    this.menu = new ListMenu<number>(this, x + 5, y + 5, ch.map((label, i) => ({ label, value: i })), { rows: ch.length, rowH: 12, width: w - 4, onSound });
    this.sys.ui.add(this.menu);
  }

  private boxTop(): number {
    return this.o.top ? 6 : H - BOX_H - 6;
  }

  private pageLen(): number {
    return (this.pages[this.page] ?? []).reduce((n, l) => n + visibleLength(l), 0);
  }

  private get lastPage(): boolean {
    return this.page >= this.pages.length - 1;
  }

  private get typing(): boolean {
    return this.shown < this.pageLen();
  }

  protected tick(): void {
    this.frame++;
    if (debug.autoDialog) {
      this.close(0);
      return;
    }
    this.advance1();
    // A closed scene has had its objects destroyed.
    if (!this.closed) this.refreshView();
  }

  /** One tick of the box, with the player's keys. */
  private advance1(): void {
    const inp = this.input.actions;
    if (this.opened < OPEN_TICKS) {
      // A press during the open animation isn't lost: it fast-completes the first line.
      if (inp.justPressed('confirm')) this.bufferedPress = true;
      this.opened++;
      if (this.opened === OPEN_TICKS && ffHint.left > 0) ffHint.left--;
      return;
    }
    if (this.bufferedPress) {
      this.bufferedPress = false;
      this.shown = this.pageLen();
    }
    const fast = (inp.isDown('cancel') || debug.playtest) && !this.o.choices;
    if (fast && !debug.playtest) ffHint.left = 0;
    if (this.typing) {
      this.reveal(fast, false);
      if (inp.justPressed('confirm')) this.shown = this.pageLen();
      return;
    }
    if (this.o.auto || debug.playtest) {
      this.autoT++;
      if (this.autoT >= (this.o.auto || 50)) this.nextPage();
      return;
    }
    if (this.lastPage && this.o.choices && this.menu) {
      const r = this.menu.update(inp);
      this.choiceIdx = this.menu.index;
      if (r === 'confirm') this.close(this.choiceIdx);
      else if (r === 'cancel' && this.o.cancel !== undefined) this.close(this.o.cancel);
      return;
    }
    if (inp.justPressed('confirm') || (fast && this.frame % 6 === 0)) this.nextPage();
  }

  /**
   * The typewriter, one tick: pause on a sentence end, else show more characters. With `silent` the blip sound is skipped (a tool's `step`), but
   * the counters move the same, so the state after n silent ticks equals the state after n live ticks.
   */
  private reveal(fast: boolean, silent: boolean): void {
    if (this.waitFrames > 0) {
      this.waitFrames--;
      return;
    }
    const before = Math.floor(this.shown);
    this.shown = Math.min(this.pageLen(), this.shown + charsPerFrame() * (fast ? 4 : 1));
    const after = Math.floor(this.shown);
    if (after > before && this.sp) {
      this.blipAcc += after - before;
      if (this.blipAcc >= 3) {
        this.blipAcc = 0;
        if (!silent) sfx('blip', this.sp.voice);
      }
    }
    // Pause on sentence ends for rhythm.
    const flat = (this.pages[this.page] ?? []).join(' ').replace(/\{[^}]*\}/g, '');
    const ch = flat[after - 1];
    if (after > before && (ch === '.' || ch === '?' || ch === '!') && flat[after] === ' ') this.waitFrames = fast ? 0 : 6;
  }

  private nextPage(): void {
    if (this.lastPage) {
      this.close(0);
    } else {
      this.page++;
      this.shown = 0;
      this.autoT = 0;
      sfx('page');
    }
  }

  // ---- editor contract (d) and (e) --------------------------------------------------------------------------

  /** The live state of the box as plain data. `restore(snapshot())` puts the box back exactly. */
  snapshot(): DialogSnapshot {
    return {
      opts: plainOpts(this.o),
      page: this.page,
      shown: this.shown,
      waitFrames: this.waitFrames,
      choiceIdx: this.menu ? this.menu.index : this.choiceIdx,
      frame: this.frame,
      opened: this.opened,
      autoT: this.autoT,
      blipAcc: this.blipAcc,
      bufferedPress: this.bufferedPress,
    };
  }

  /** Put a snapshot back. The line comes from the snapshot, so a box built for another line becomes this one. Call it on a running scene. */
  restore(s: DialogSnapshot): void {
    this.setLine(plainOpts(s.opts));
    this.page = Math.max(0, Math.min(s.page, this.pages.length - 1));
    this.shown = Math.max(0, Math.min(s.shown, this.pageLen()));
    this.waitFrames = s.waitFrames;
    this.frame = s.frame;
    this.opened = s.opened;
    this.autoT = s.autoT;
    this.blipAcc = s.blipAcc;
    this.bufferedPress = s.bufferedPress;
    this.buildObjects();
    this.choiceIdx = Math.max(0, Math.min(s.choiceIdx, (this.o.choices?.length ?? 1) - 1));
    if (this.menu) this.menu.index = this.choiceIdx;
    this.refreshView();
  }

  /**
   * Advance n ticks with no keys and no sound, for a tool that scrubs the reveal. The open animation runs first, then the typewriter of the
   * current page. It stops at the end of the page: it never pages, never picks a choice and never closes the box.
   */
  step(n: number): void {
    for (let i = 0; i < n; i++) {
      this.frame++;
      if (this.opened < OPEN_TICKS) this.opened++;
      else if (this.typing) this.reveal(false, true);
    }
    this.refreshView();
  }

  // ---- the picture --------------------------------------------------------------------------------------------

  /** Bring every object up to date with the box's state. */
  private refreshView(): void {
    const k = Math.min(1, this.opened / OPEN_TICKS);
    const y0 = this.boxTop();
    const h = Math.max(4, Math.round(BOX_H * k));
    const y = y0 + Math.round((BOX_H - h) / 2);
    this.win.setPosition(this.bx, y);
    this.win.setSize(this.bw, h);
    const open = k >= 1;
    // Nothing but the frame shows until the box has opened.
    this.tab?.setVisible(open);
    this.portrait?.setVisible(open);
    if (this.portrait && open) this.paintPortrait();
    let remaining = Math.floor(this.shown);
    const lines = this.pages[this.page] ?? [];
    this.body.forEach((obj, i) => {
      const ln = lines[i] ?? '';
      const show = open && remaining > 0 && ln !== '';
      obj.setVisible(show);
      if (!show) return;
      obj.setText(ln).setStyle({ max: remaining });
      remaining -= visibleLength(ln);
    });
    const typing = this.typing;
    const asking = open && !typing && this.lastPage && !!this.o.choices;
    this.more.setVisible(false);
    if (open && !typing && !asking && !this.o.auto) this.more.setFrame(this.frame);
    this.hint.setVisible(open && typing && ffHint.left > 0 && !this.o.choices && !this.o.auto);
    this.choiceWin?.setVisible(asking);
    this.menu?.setVisible(asking);
  }

  /** The portrait picture: the face, with the mouth working while the line types and an occasional blink (rig v2). Repainted only when the face changes. */
  private paintPortrait(): void {
    const img = this.portrait;
    const id = this.sp?.portrait;
    if (!img || !id) return;
    const mod = this.typing && !this.waitFrames ? ((this.frame >> 2) % 2 ? 'talk' : undefined) : this.frame % 210 < 6 ? 'blink' : undefined;
    const key = mod ?? 'base';
    if (key === this.portraitKey) return;
    this.portraitKey = key;
    const base = getPortrait(id, this.o.face ?? 'neutral');
    const face = mod ? getPortrait(id, this.o.face ?? 'neutral', mod) : null;
    const ctx = img.ctx;
    const accent = this.sp?.color ?? UI.cyan;
    ctx.clearRect(0, 0, 50, 50);
    ctx.fillStyle = UI.outline;
    ctx.fillRect(0, 0, 50, 50);
    const src = face ?? base;
    if (src) ctx.drawImage(src, 1, 1, 48, 48);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 49, 50, 1);
    img.refresh();
  }
}
