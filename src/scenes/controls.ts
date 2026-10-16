/** Controls: every action's keys and gamepad button, with one rebindable key per action. Native sje scene (M8b). */
import { sfx } from '../audio/sfx';
import { ACTIONS, type Action, keyLabel } from '../sje/runtime/inputdevice';
import { saveSettings, settings } from '../game/settings';
import { Cursor, fitText, Graphics, NineSlice, SELECT_FILL, TextObject, UI } from '../sje';
import { H, W } from '../sje/core/size';
import { UiScene } from './uiscene';

const NAMES: Record<Action, string> = {
  up: 'Up', down: 'Down', left: 'Left', right: 'Right', confirm: 'Confirm', cancel: 'Cancel / Back',
  menu: 'Menu', dash: 'Dash', fullscreen: 'Fullscreen',
};

/** Standard-layout gamepad buttons (Xbox / PlayStation names). */
const PAD: Record<Action, string> = {
  up: 'D-pad / stick', down: 'D-pad / stick', left: 'D-pad / stick', right: 'D-pad / stick',
  confirm: 'A / Cross', cancel: 'B / Circle', menu: 'Y / Triangle · Start', dash: 'X / Square · RB', fullscreen: '—',
};

type Row = { kind: 'action'; action: Action } | { kind: 'reset' } | { kind: 'back' };

/** The row text colors: the selected row is bright, the others a soft white. */
const ROW_ON: string = UI.text;
const ROW_OFF = '#c8c6dc';

export class ControlsScene extends UiScene<void> {
  private idx = 0;
  private note = '';
  private capturing: Action | null = null;
  private rows: Row[] = [...ACTIONS.map((a): Row => ({ kind: 'action', action: a })), { kind: 'reset' }, { kind: 'back' }];

  // The window and where its rows sit (the old render worked these out each frame).
  private readonly w: number;
  private readonly h: number;
  private readonly x: number;
  private readonly y: number;

  private win!: NineSlice;
  private highlight!: Graphics;
  private shownIdx = -1;
  private cursor!: Cursor;
  private names: TextObject[] = [];
  private keysText: (TextObject | null)[] = [];
  private hint!: TextObject;

  constructor() {
    super();
    this.opaque = false;
    this.curtain = true;
    const w = 360;
    this.w = w;
    this.h = this.rows.length * 13 + 46;
    this.x = (W - w) / 2;
    this.y = (H - this.h) / 2;
  }

  override create(): void {
    const ui = this.sys.ui;
    this.dim();
    const { x, y, w, h } = this;
    this.win = new NineSlice(this, x, y, w, h, { title: 'CONTROLS', footer: this.legend('back', 'rebind') });
    ui.add(this.win);
    const head = new TextObject(this, x + 110, y + 10, 'Keyboard', { color: UI.dim });
    ui.add(head);
    const headPad = new TextObject(this, x + w - 12, y + 10, 'Gamepad', { align: 'right', color: UI.dim });
    ui.add(headPad);
    // The selection highlight is one plain Graphics, moved to the chosen row.
    this.highlight = new Graphics(this, 0, 0);
    ui.add(this.highlight);
    this.rows.forEach((r, i) => {
      const ry = y + 24 + i * 13;
      if (r.kind !== 'action') {
        const label = new TextObject(this, x + 18, ry, r.kind === 'reset' ? 'Reset keys to defaults' : 'Back', { color: ROW_OFF });
        ui.add(label);
        this.names.push(label);
        this.keysText.push(null);
        return;
      }
      const name = new TextObject(this, x + 18, ry, NAMES[r.action], { color: ROW_OFF });
      ui.add(name);
      this.names.push(name);
      const keys = new TextObject(this, x + 110, ry, '', { color: UI.dim });
      ui.add(keys);
      this.keysText.push(keys);
      const pad = new TextObject(this, x + w - 12, ry, fitText(PAD[r.action], 100), { align: 'right', color: UI.dim });
      ui.add(pad);
    });
    this.cursor = new Cursor(this, x + 8, y + 24);
    ui.add(this.cursor);
    this.hint = new TextObject(this, W / 2, y + h - 14, '', { align: 'center', color: UI.dim });
    ui.add(this.hint);
    this.refreshView();
  }

  protected tick(): void {
    if (!this.capturing) this.step();
    // A closed scene has had its objects destroyed.
    if (!this.closed) this.refreshView();
  }

  private step(): void {
    const keys = this.input.actions;
    if (keys.justPressed('cancel')) {
      sfx('cancel');
      this.close();
      return;
    }
    const n = this.rows.length;
    if (keys.repeat('up')) { this.idx = (this.idx + n - 1) % n; sfx('cursor'); }
    if (keys.repeat('down')) { this.idx = (this.idx + 1) % n; sfx('cursor'); }
    if (!keys.justPressed('confirm')) return;
    const row = this.rows[this.idx];
    if (!row) return;
    if (row.kind === 'back') {
      sfx('cancel');
      this.close();
    } else if (row.kind === 'reset') {
      settings.keys = {};
      this.game.input.applyCustom(settings.keys);
      saveSettings();
      sfx('confirm');
      this.note = 'Keys reset to the defaults.';
    } else this.rebind(row.action);
  }

  private rebind(action: Action): void {
    sfx('confirm');
    this.capturing = action;
    this.note = `Press a key for ${NAMES[action]}… (Esc cancels)`;
    this.game.input.captureNext((code) => {
      this.capturing = null;
      if (code === 'Escape') {
        this.note = '';
        return;
      }
      const next = this.game.input.bind(action, code, settings.keys);
      if (!next) {
        sfx('buzz');
        this.note = `${keyLabel(code)} is the only key for another action. Pick a different key.`;
        return;
      }
      settings.keys = next;
      saveSettings();
      sfx('equip');
      this.note = `${NAMES[action]}: ${keyLabel(code)}.`;
    });
  }

  /** Bring every object up to date with the scene's state. A text object ignores a string it already shows, so this is cheap each tick. */
  private refreshView(): void {
    const { x, y, w } = this;
    // The key legend follows the player's own bindings (a rebind of confirm or cancel changes it).
    this.win.setStyle({ footer: this.legend('back', 'rebind') });
    const input = this.game.input;
    this.rows.forEach((r, i) => {
      const sel = i === this.idx;
      this.names[i]?.setStyle({ color: sel ? ROW_ON : ROW_OFF });
      if (r.kind !== 'action') return;
      const custom = settings.keys[r.action];
      const keys = input.keysFor(r.action).map((c) => (c === custom ? `{c}${keyLabel(c)}{/}` : keyLabel(c)));
      this.keysText[i]?.setText(fitText(keys.join(' '), 130));
    });
    if (this.shownIdx !== this.idx) {
      this.shownIdx = this.idx;
      const ry = y + 24 + this.idx * 13;
      this.highlight.clear().fillStyle(SELECT_FILL.color, SELECT_FILL.alpha).fillRect(x + 6, ry - 2, w - 12, 12);
      this.cursor.setHome(x + 8, ry);
    }
    this.cursor.setFrame(this.capturing ? 0 : this.t);
    this.hint.setText(fitText(this.note || 'Confirm on an action to give it a key of your own.', w - 24));
    this.hint.setStyle({ color: this.capturing ? UI.amber : UI.dim });
  }
}
