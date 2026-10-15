/** Save / load slot picker. Save writes immediately (with overwrite confirm); load returns the slot. Native sje scene (M8b). */
import { buildChar } from '../art/chars';
import { sfx } from '../audio/sfx';
import { LOOKS } from '../data/looks';
import { autoClose } from '../game/debug';
import { formatPlayTime, readMeta, type SaveMeta, type SlotId, type SlotStatus, savedByVersion, slotStatus, writeSave } from '../game/save';
import { Container, fitText, Graphics, measure, NineSlice, SELECT_FILL, TextObject, UI } from '../sje';
import { H, W } from '../sje/core/size';
import { UiScene } from './uiscene';

/** The slot select highlight is lighter than a list's (the old drawSelect color rgba(63,224,240,0.08)). */
const SLOT_SELECT_ALPHA = 0.08;

/** What one slot shows, read once. */
interface SlotInfo {
  meta: SaveMeta | null;
  status: SlotStatus;
  version: string | null;
}

export class SaveScene extends UiScene<SlotId | null> {
  private slots: SlotId[];
  private idx = 0;
  private confirm = false;
  private note = '';

  /** Slot headers, loadability and (for newer-version saves) the version that wrote them, read once (full validation and JSON parsing are too costly per frame). */
  private info: SlotInfo[] = [];

  // The window and where the rows sit.
  private readonly w = 330;
  private readonly rowH = 40;
  private readonly h: number;
  private readonly x: number;
  private readonly y: number;

  private cards: NineSlice[] = [];
  private contents: Container[] = [];
  private highlight!: Graphics;
  private shownKey = '';
  private noteText!: TextObject;
  private win!: NineSlice;
  private popup!: Container;
  private popupTitle!: TextObject;

  constructor(private mode: 'save' | 'load') {
    super();
    this.opaque = false;
    this.curtain = true;
    this.slots = mode === 'load' ? ['auto', 1, 2, 3] : [1, 2, 3];
    this.h = this.slots.length * (this.rowH + 4) + 30;
    this.x = (W - this.w) / 2;
    this.y = (H - this.h) / 2;
    this.refresh();
    if (mode === 'load') {
      // Start on the most recent save that will load.
      let best = -1;
      this.info.forEach(({ meta, status }, i) => {
        if (meta && status === 'ok' && meta.when > best) {
          best = meta.when;
          this.idx = i;
        }
      });
    }
  }

  private refresh(): void {
    this.info = this.slots.map((s) => {
      const status = slotStatus(s);
      return { meta: readMeta(s), status, version: status === 'newer' ? savedByVersion(s) : null };
    });
  }

  override create(): void {
    const ui = this.sys.ui;
    const { x, y, w, h, rowH } = this;
    this.dim();
    this.win = new NineSlice(this, x, y, w, h, { title: this.mode === 'save' ? 'SAVE GAME' : 'LOAD GAME', footer: this.legend() });
    ui.add(this.win);
    this.highlight = new Graphics(this, 0, 0);
    this.slots.forEach((_s, i) => {
      const ry = y + 10 + i * (rowH + 4);
      const card = new NineSlice(this, x + 8, ry, w - 16, rowH, { plain: true });
      ui.add(card);
      this.cards.push(card);
    });
    // The highlight sits over the selected card's frame and under its text.
    ui.add(this.highlight);
    this.buildContents();
    this.noteText = new TextObject(this, W / 2, y + h + 6, '', { align: 'center', color: UI.amber });
    ui.add(this.noteText);
    // The overwrite question: a small window with two lines, shown only while it is asked.
    this.popup = new Container(this, 0, 0, 'overwrite');
    this.popup.add(new NineSlice(this, x + 40, y + h / 2 - 16, w - 80, 32, { accent: UI.amber }));
    this.popupTitle = new TextObject(this, W / 2, y + h / 2 - 10, '', { align: 'center' });
    this.popup.add(this.popupTitle);
    this.popup.add(new TextObject(this, W / 2, y + h / 2 + 2, '{y}Confirm{/} yes · {d}Cancel{/} no', { align: 'center' }));
    ui.add(this.popup);
    this.refreshView();
  }

  /** Build what each slot shows (its header and details) from `info`. Called again after a save, which changes a slot. */
  private buildContents(): void {
    for (const c of this.contents) c.destroy();
    this.contents = [];
    const ui = this.sys.ui;
    this.slots.forEach((s, i) => {
      const c = new Container(this, 0, 0, `slot-${s}`);
      ui.add(c);
      this.contents.push(c);
      this.fillSlot(c, i);
    });
  }

  private fillSlot(c: Container, i: number): void {
    const { x, y, w, rowH } = this;
    const s = this.slots[i] as SlotId;
    const ry = y + 10 + i * (rowH + 4);
    const text = (tx: number, ty: number, str: string, style: ConstructorParameters<typeof TextObject>[4] = {}): void => void c.add(new TextObject(this, tx, ty, str, style));
    const { meta, status, version: v } = this.info[i] as SlotInfo;
    text(x + 16, ry + 6, s === 'auto' ? 'AUTOSAVE' : `SLOT ${s}`, { color: s === 'auto' ? UI.amber : UI.cyan });
    if (status === 'empty') {
      text(x + 16, ry + 20, 'Empty', { color: UI.disabled });
      return;
    }
    if (status === 'newer') {
      text(x + 70, ry + 6, fitText(v ? `Saved by a newer version (v${v})` : 'Saved by a newer version', w - 86), { color: UI.amber });
      text(x + 70, ry + 20, this.mode === 'load' ? 'This version can’t load it' : 'Saving here replaces it', { color: UI.dim });
      return;
    }
    if (status === 'damaged' || !meta) {
      text(x + 16, ry + 20, this.mode === 'load' ? 'Damaged — can’t be loaded' : 'Damaged — saving here replaces it', { color: UI.red });
      return;
    }
    this.fillMeta(c, meta, x + 16, ry, w - 32);
  }

  private fillMeta(c: Container, m: SaveMeta, x: number, y: number, w: number): void {
    const when = new Date(m.when).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    c.add(new TextObject(this, x + 70, y + 6, fitText(m.location, w - 70 - measure(when) - 8)));
    c.add(new TextObject(this, x + w, y + 6, when, { align: 'right', color: UI.dim }));
    m.party.forEach((name, i) => {
      const key = name.toLowerCase() as keyof typeof LOOKS;
      const look = LOOKS[key];
      if (!look) return;
      const frame = buildChar(look).frames.down[0] as CanvasImageSource;
      // A character sprite is art: a 14 x 20 canvas picture.
      c.add(this.picture(x + i * 16, y + 14, 14, 20, (ctx) => ctx.drawImage(frame, 0, 0, 14, 20)));
    });
    c.add(new TextObject(this, x + 70, y + 20, `Lv ${m.leaderLevel}`, { color: UI.dim }));
    c.add(new TextObject(this, x + 120, y + 20, `${m.cred.toLocaleString('en-US')}¢`, { color: UI.amber }));
    c.add(new TextObject(this, x + w, y + 20, formatPlayTime(m.playFrames), { align: 'right', color: UI.dim }));
  }

  protected tick(): void {
    if (autoClose(this.t, 40)) {
      this.close(null);
      return;
    }
    this.step();
    // A closed scene has had its objects destroyed.
    if (!this.closed) this.refreshView();
  }

  private step(): void {
    const keys = this.input.actions;
    const slot = this.slots[this.idx] as SlotId;
    if (this.confirm) {
      if (keys.justPressed('confirm')) this.write(slot);
      else if (keys.justPressed('cancel')) {
        sfx('cancel');
        this.confirm = false;
      }
      return;
    }
    const n = this.slots.length;
    if (keys.repeat('up')) { this.idx = (this.idx + n - 1) % n; sfx('cursor'); }
    if (keys.repeat('down')) { this.idx = (this.idx + 1) % n; sfx('cursor'); }
    if (keys.justPressed('cancel')) {
      sfx('cancel');
      this.close(null);
      return;
    }
    if (!keys.justPressed('confirm')) return;
    const { meta, status } = this.info[this.idx] as SlotInfo;
    if (this.mode === 'load') {
      if (status !== 'ok') {
        sfx('buzz');
        this.note = status === 'empty' ? 'That slot is empty.'
          : status === 'newer' ? 'That save is from a newer version and can’t be loaded.'
          : 'That save is damaged and can’t be loaded.';
        return;
      }
      sfx('confirm');
      this.close(slot);
    } else if (meta || status === 'newer') {
      // A newer-version save always asks first, even if its header is unreadable: it may be the
      // only copy of progress made on a newer build.
      sfx('confirm');
      this.confirm = true;
    } else this.write(slot);
  }

  private write(slot: SlotId): void {
    if (writeSave(slot, this.game.playFrames)) {
      this.refresh();
      this.buildContents();
      sfx('save');
      this.note = `Saved to slot ${slot}.`;
      this.confirm = false;
      void this.game.wait(30).then(() => !this.closed && this.close(slot));
    } else {
      sfx('buzz');
      this.note = 'Couldn’t save — browser storage is unavailable.';
      this.confirm = false;
    }
  }

  /** Bring the objects up to date: which card is lit, the highlight, the note and the overwrite question. */
  private refreshView(): void {
    const { x, y, rowH } = this;
    this.win.setStyle({ footer: this.legend() });
    this.cards.forEach((card, i) => {
      card.setStyle(i === this.idx ? { plain: false, accent: UI.cyan } : { plain: true, accent: undefined });
    });
    if (this.shownKey !== String(this.idx)) {
      this.shownKey = String(this.idx);
      const ry = y + 10 + this.idx * (rowH + 4);
      this.highlight.clear().fillStyle(SELECT_FILL.color, SLOT_SELECT_ALPHA).fillRect(x + 10, ry + 2, this.w - 20, rowH - 4);
    }
    this.noteText.setText(this.note).setStyle({ color: this.note.startsWith('Saved') ? UI.green : UI.amber });
    this.popup.setVisible(this.confirm);
    if (this.confirm) this.popupTitle.setText(this.info[this.idx]?.status === 'newer' ? 'Replace this newer-version save?' : 'Overwrite this save?');
  }
}
