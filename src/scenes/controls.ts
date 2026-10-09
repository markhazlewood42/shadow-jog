/** Controls: every action's keys and gamepad button, with one rebindable key per action. */
import { sfx } from '../audio/sfx';
import type { Ctx } from '../engine/canvas';
import { drawText, fitText } from '../engine/font';
import { Scene } from '../engine/game';
import { W, H } from '../sje/core/size';
import { ACTIONS, keyLabel, type Action } from '../engine/input';
import { saveSettings, settings } from '../game/settings';
import { drawCursor, drawSelect, drawWindow, keyLegend, UI, OVERLAY_DIM } from '../ui/draw';

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

export class ControlsScene extends Scene<void> {
  override opaque = false;
  override curtain = true;
  private idx = 0;
  private t = 0;
  private note = '';
  private capturing: Action | null = null;
  private rows: Row[] = [...ACTIONS.map((a): Row => ({ kind: 'action', action: a })), { kind: 'reset' }, { kind: 'back' }];

  update(): void {
    this.t++;
    if (this.capturing) return; // waiting for the next key (see rebind)
    const inp = this.game.input;
    if (inp.pressed('cancel')) {
      sfx('cancel');
      this.close();
      return;
    }
    const n = this.rows.length;
    if (inp.repeat('up')) { this.idx = (this.idx + n - 1) % n; sfx('cursor'); }
    if (inp.repeat('down')) { this.idx = (this.idx + 1) % n; sfx('cursor'); }
    if (!inp.pressed('confirm')) return;
    const row = this.rows[this.idx]!;
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

  render(ctx: Ctx): void {
    ctx.fillStyle = OVERLAY_DIM;
    ctx.fillRect(0, 0, W, H);
    const w = 360, h = this.rows.length * 13 + 46;
    const x = (W - w) / 2, y = (H - h) / 2;
    drawWindow(ctx, x, y, w, h, { title: 'CONTROLS' , footer: keyLegend(this.game.input, 'back', 'rebind') });
    drawText(ctx, 'Keyboard', x + 110, y + 10, { color: UI.dim });
    drawText(ctx, 'Gamepad', x + w - 12, y + 10, { align: 'right', color: UI.dim });
    const input = this.game.input;
    this.rows.forEach((r, i) => {
      const ry = y + 24 + i * 13;
      const sel = i === this.idx;
      if (sel) {
        drawSelect(ctx, x + 6, ry - 2, w - 12, 12);
        drawCursor(ctx, x + 8, ry, this.capturing ? 0 : this.t);
      }
      if (r.kind !== 'action') {
        drawText(ctx, r.kind === 'reset' ? 'Reset keys to defaults' : 'Back', x + 18, ry, { color: sel ? UI.text : '#c8c6dc' });
        return;
      }
      const custom = settings.keys[r.action];
      drawText(ctx, NAMES[r.action], x + 18, ry, { color: sel ? UI.text : '#c8c6dc' });
      const keys = input.keysFor(r.action).map((c) => (c === custom ? `{c}${keyLabel(c)}{/}` : keyLabel(c)));
      drawText(ctx, fitText(keys.join(' '), 130), x + 110, ry, { color: UI.dim });
      drawText(ctx, fitText(PAD[r.action], 100), x + w - 12, ry, { align: 'right', color: UI.dim });
    });
    const hint = this.note || 'Confirm on an action to give it a key of your own.';
    drawText(ctx, fitText(hint, w - 24), W / 2, y + h - 14, { align: 'center', color: this.capturing ? UI.amber : UI.dim });
  }
}
