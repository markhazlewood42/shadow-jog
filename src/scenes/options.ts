/** Options: volumes, text & battle speed, shake, scaling, fullscreen, controls. Native sje scene (M8b). */
import { audio } from '../audio/engine';
import { previewMusic } from '../audio/music';
import { sfx } from '../audio/sfx';
import { notice } from '../sje/core/errors';
import { type Action, keyLabel } from '../sje/runtime/inputdevice';
import { BATTLE_SPEEDS, battleSpeed, gpuWanted, saveSettings, settings, TEXT_SPEEDS, textSpeed } from '../game/settings';
import { Bar, Container, Cursor, fitText, Graphics, NineSlice, SELECT_FILL, TextObject, UI } from '../sje';
import { H, W } from '../sje/core/size';
import { ControlsScene } from './controls';
import { UiScene } from './uiscene';

type Row = { id: string; label: string; value: () => string; bar?: () => number; adjust?: (d: number) => void; action?: () => void };

/** The row text color of a row that is not selected (the selected row is bright). */
const ROW_OFF = '#c8c6dc';

/** The objects of one row, made once. A row that has no bar has no `bar`. */
interface RowView {
  label: TextObject;
  value: TextObject;
  bar: Bar | null;
}

export class OptionsScene extends UiScene<'back' | 'title'> {
  private idx = 0;
  private rows: Row[];
  private confirmQuit = false;

  // The window and where its rows sit (the old render worked these out each frame).
  private readonly w = 280;
  private readonly h: number;
  private readonly x: number;
  private readonly y: number;

  private highlight!: Graphics;
  private shownIdx = -1;
  private cursor!: Cursor;
  private views: RowView[] = [];
  private legendLines: TextObject[] = [];
  private popup!: Container;

  constructor(inGame: boolean) {
    super();
    this.opaque = false;
    this.curtain = true;
    const vol = (k: 'musicVol' | 'sfxVol') => ({
      value: () => `${Math.round(settings[k] * 10)}`,
      bar: () => settings[k],
      adjust: (d: number) => {
        settings[k] = Math.max(0, Math.min(1, Math.round((settings[k] + d * 0.1) * 10) / 10));
        audio.applyVolumes();
        // Let the player hear the new level: a representative hit for sound effects, a chime for
        // music when no song is playing to judge it by.
        if (k === 'sfxVol') sfx('hit');
        else previewMusic();
      },
    });
    this.rows = [
      { id: 'music', label: 'Music volume', ...vol('musicVol') },
      { id: 'sfx', label: 'Sound volume', ...vol('sfxVol') },
      {
        id: 'text', label: 'Text speed', value: () => textSpeed().label,
        adjust: (d) => (settings.textSpeed = Math.max(1, Math.min(TEXT_SPEEDS.length, settings.textSpeed + d))),
      },
      {
        id: 'battle', label: 'Battle speed', value: () => battleSpeed().label,
        adjust: (d) => (settings.battleSpeed = Math.max(1, Math.min(BATTLE_SPEEDS.length, settings.battleSpeed + d))),
      },
      {
        // Assist lands every press as a good one, for players who'd rather not play the timing.
        id: 'timing', label: 'Timed presses', value: () => ({ on: 'On', assist: 'Assist', off: 'Off' })[settings.timing],
        adjust: (d) => {
          const modes = ['on', 'assist', 'off'] as const;
          settings.timing = modes[(modes.indexOf(settings.timing) + d + 3) % 3] ?? 'on';
        },
      },
      {
        id: 'shake', label: 'Screen shake', value: () => ['Off', 'Gentle', 'Full'][settings.shake] ?? 'Full',
        adjust: (d) => {
          settings.shake = (settings.shake + d + 3) % 3;
          this.game.shake(14, 3); // preview at the new strength
        },
      },
      {
        id: 'flash', label: 'Screen flash', value: () => ['Off', 'Reduced', 'Full'][settings.flash] ?? 'Full',
        adjust: (d) => {
          settings.flash = (settings.flash + d + 3) % 3;
          this.game.flash('#ffffff', 10); // preview at the new strength
        },
      },
      {
        id: 'hitpause', label: 'Hit pause', value: () => (settings.hitPause ? 'On' : 'Off'),
        adjust: () => {
          settings.hitPause = !settings.hitPause;
        },
      },
      {
        // On but not running: the effects system is not active (for example `?fx=none` in the address forces it off).
        id: 'gpu', label: 'GPU effects', value: () => (!gpuWanted() ? 'Off' : this.game.fx.active ? 'On' : 'Unavailable'),
        adjust: () => {
          settings.fxLevel = gpuWanted() ? 'none' : 'auto';
          window.dispatchEvent(new Event('sj-gpu'));
        },
      },
      {
        id: 'full', label: 'Fullscreen', value: () => (document.fullscreenElement ? 'On' : 'Off'),
        action: () => toggleFullscreen(),
        adjust: () => toggleFullscreen(),
      },
      { id: 'controls', label: 'Controls', value: () => 'Keys & pad ▶', action: () => void this.game.run(new ControlsScene()) },
      { id: 'back', label: 'Back', value: () => '', action: () => this.done('back') },
    ];
    if (inGame) this.rows.splice(this.rows.length - 1, 0, { id: 'title', label: 'Quit to title', value: () => '', action: () => (this.confirmQuit = true) });
    this.h = this.rows.length * 13 + 60;
    this.x = (W - this.w) / 2;
    this.y = (H - this.h) / 2;
  }

  override create(): void {
    const ui = this.sys.ui;
    const { x, y, w, h } = this;
    this.dim();
    ui.add(new NineSlice(this, x, y, w, h, { title: 'OPTIONS' }));
    // The selection highlight is one plain Graphics, moved to the chosen row.
    this.highlight = new Graphics(this, 0, 0);
    ui.add(this.highlight);
    this.rows.forEach((r, i) => {
      const ry = y + 12 + i * 13;
      const label = new TextObject(this, x + 18, ry, r.label, { color: ROW_OFF });
      ui.add(label);
      let bar: Bar | null = null;
      if (r.bar) {
        bar = new Bar(this, x + 150, ry + 3, 90, 3, UI.cyan, r.bar());
        ui.add(bar);
      }
      const value = new TextObject(this, x + w - 12, ry, '', { align: 'right', color: UI.dim });
      ui.add(value);
      this.views.push({ label, value, bar });
    });
    this.cursor = new Cursor(this, x + 8, y + 12);
    ui.add(this.cursor);
    // The key reminder block under the rows. Its lines follow the player's own bindings.
    const cy = y + h - 40;
    ui.add(new TextObject(this, x + 12, cy, 'CONTROLS', { color: UI.cyan }));
    for (const dy of [11, 22]) {
      const line = new TextObject(this, x + 12, cy + dy, '', { color: UI.dim });
      ui.add(line);
      this.legendLines.push(line);
    }
    // The quit question: a small window with two lines, shown only while it is asked.
    this.popup = new Container(this, 0, 0, 'quit-confirm');
    this.popup.add(new NineSlice(this, x + 30, y + h / 2 - 16, w - 60, 32, { accent: UI.red }));
    this.popup.add(new TextObject(this, x + w / 2, y + h / 2 - 10, 'Quit to title? Unsaved progress is lost.', { align: 'center' }));
    this.popup.add(new TextObject(this, x + w / 2, y + h / 2 + 2, '{y}Confirm{/} quit · {d}Cancel{/} stay', { align: 'center' }));
    ui.add(this.popup);
    this.refreshView();
  }

  private done(r: 'back' | 'title'): void {
    saveSettings();
    this.close(r);
  }

  protected tick(): void {
    this.step();
    // A closed scene has had its objects destroyed.
    if (!this.closed) this.refreshView();
  }

  private step(): void {
    const keys = this.input.actions;
    if (this.confirmQuit) {
      if (keys.justPressed('confirm')) this.done('title');
      else if (keys.justPressed('cancel')) {
        sfx('cancel');
        this.confirmQuit = false;
      }
      return;
    }
    if (keys.justPressed('cancel')) {
      sfx('cancel');
      this.done('back');
      return;
    }
    const n = this.rows.length;
    if (keys.repeat('up')) { this.idx = (this.idx + n - 1) % n; sfx('cursor'); }
    if (keys.repeat('down')) { this.idx = (this.idx + 1) % n; sfx('cursor'); }
    const row = this.rows[this.idx];
    if (!row) return;
    if (row.adjust && (keys.repeat('left') || keys.repeat('right'))) {
      row.adjust(keys.repeat('left') ? -1 : 1);
      sfx('cursor');
    }
    if (keys.justPressed('confirm')) {
      if (row.action) row.action();
      else row.adjust?.(1);
      sfx('confirm');
    }
  }

  /** Bring every object up to date with the scene's state. A text object ignores a string it already shows, so this is cheap each tick. */
  private refreshView(): void {
    const { x, y, w } = this;
    this.rows.forEach((r, i) => {
      const view = this.views[i];
      if (!view) return;
      const sel = i === this.idx;
      view.label.setStyle({ color: sel ? UI.text : ROW_OFF });
      view.bar?.setRatio(r.bar?.() ?? 0);
      const v = r.value();
      if (r.bar) view.value.setText(v).setStyle({ color: UI.dim });
      else view.value.setText(v ? (r.adjust ? '◀ ' : '') + v + (r.adjust ? ' ▶' : '') : '').setStyle({ color: sel ? UI.cyan : UI.dim });
    });
    if (this.shownIdx !== this.idx) {
      this.shownIdx = this.idx;
      const ry = y + 12 + this.idx * 13;
      this.highlight.clear().fillStyle(SELECT_FILL.color, SELECT_FILL.alpha).fillRect(x + 6, ry - 2, w - 12, 12);
      this.cursor.setHome(x + 8, ry);
    }
    this.cursor.setFrame(this.t);
    // The legend reads the live bindings, so a rebound key shows here too.
    const input = this.game.input;
    const k = (a: Action) => input.keysFor(a).slice(0, 3).map(keyLabel).join('/');
    const dirs = (['up', 'down', 'left', 'right'] as const).map((a) => input.keysFor(a).map(keyLabel));
    const move = [0, 1].map((j) => dirs.map((d) => d[j] ?? '').join('')).filter(Boolean).join(' / ');
    this.legendLines[0]?.setText(fitText(`Move: ${move} · Confirm: ${k('confirm')}`, w - 24));
    this.legendLines[1]?.setText(fitText(`Cancel: ${k('cancel')} · Menu: ${k('menu')} · Dash: ${k('dash')}`, w - 24));
    this.popup.setVisible(this.confirmQuit);
  }
}

export function toggleFullscreen(): void {
  // A refusal (no support, an iframe without permission, a browser setting) says so, like every
  // other blocked action: the row not changing isn't an explanation.
  const refused = () => notice('Fullscreen isn’t available here: the browser refused it. The window scale options still work.', 'warn');
  try {
    const req = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
    if (!req) refused();
    else req.catch(refused);
  } catch {
    refused();
  }
}
