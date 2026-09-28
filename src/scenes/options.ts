/** Options: volumes, text & battle speed, shake, scaling, fullscreen, controls. */
import { audio } from '../audio/engine';
import { previewMusic } from '../audio/music';
import { sfx } from '../audio/sfx';
import type { Ctx } from '../engine/canvas';
import { drawText, fitText } from '../engine/font';
import { Scene, W, H } from '../engine/game';
import { BATTLE_SPEEDS, battleSpeed, saveSettings, settings, TEXT_SPEEDS, textSpeed } from '../game/settings';
import { drawBar, drawCursor, drawSelect, drawWindow, UI, OVERLAY_DIM } from '../ui/draw';
import { keyLabel, type Action } from '../engine/input';
import { ControlsScene } from './controls';

type Row = { id: string; label: string; value: () => string; bar?: () => number; adjust?: (d: number) => void; action?: () => void };

export class OptionsScene extends Scene<'back' | 'title'> {
  override opaque = false;
  private idx = 0;
  private rows: Row[];
  private t = 0;
  private confirmQuit = false;

  constructor(inGame: boolean) {
    super();
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
        id: 'shake', label: 'Screen shake', value: () => ['Off', 'Gentle', 'Full'][settings.shake] ?? 'Full',
        adjust: (d) => {
          settings.shake = (settings.shake + d + 3) % 3;
          this.game.shake(14, 3); // preview at the new strength
        },
      },
      {
        id: 'scale', label: 'Scaling', value: () => (settings.scale === 'fit' ? 'Smooth fit' : 'Pixel-perfect'),
        adjust: () => {
          settings.scale = settings.scale === 'fit' ? 'integer' : 'fit';
          window.dispatchEvent(new Event('sj-scale'));
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
  }

  private done(r: 'back' | 'title'): void {
    saveSettings();
    this.close(r);
  }

  update(): void {
    this.t++;
    const inp = this.game.input;
    if (this.confirmQuit) {
      if (inp.pressed('confirm')) this.done('title');
      else if (inp.pressed('cancel')) {
        sfx('cancel');
        this.confirmQuit = false;
      }
      return;
    }
    if (inp.pressed('cancel')) {
      sfx('cancel');
      this.done('back');
      return;
    }
    const n = this.rows.length;
    if (inp.repeat('up')) { this.idx = (this.idx + n - 1) % n; sfx('cursor'); }
    if (inp.repeat('down')) { this.idx = (this.idx + 1) % n; sfx('cursor'); }
    const row = this.rows[this.idx]!;
    if (row.adjust && (inp.repeat('left') || inp.repeat('right'))) {
      row.adjust(inp.repeat('left') ? -1 : 1);
      sfx('cursor');
    }
    if (inp.pressed('confirm')) {
      if (row.action) row.action();
      else row.adjust?.(1);
      sfx('confirm');
    }
  }

  render(ctx: Ctx): void {
    ctx.fillStyle = OVERLAY_DIM;
    ctx.fillRect(0, 0, W, H);
    const w = 280, h = this.rows.length * 13 + 60;
    const x = (W - w) / 2, y = (H - h) / 2;
    drawWindow(ctx, x, y, w, h, { title: 'OPTIONS' });
    this.rows.forEach((r, i) => {
      const ry = y + 12 + i * 13;
      const sel = i === this.idx;
      if (sel) {
        drawSelect(ctx, x + 6, ry - 2, w - 12, 12);
        drawCursor(ctx, x + 8, ry, this.t);
      }
      drawText(ctx, r.label, x + 18, ry, { color: sel ? UI.text : '#c8c6dc' });
      if (r.bar) {
        drawBar(ctx, x + 150, ry + 3, 90, 3, r.bar(), UI.cyan);
        drawText(ctx, r.value(), x + w - 12, ry, { align: 'right', color: UI.dim });
      } else if (r.value()) drawText(ctx, (r.adjust ? '◀ ' : '') + r.value() + (r.adjust ? ' ▶' : ''), x + w - 12, ry, { align: 'right', color: sel ? UI.cyan : UI.dim });
    });
    const cy = y + h - 40;
    // The legend reads the live bindings, so a rebound key shows here too.
    const k = (a: Action) => this.game.input.keysFor(a).slice(0, 3).map(keyLabel).join('/');
    drawText(ctx, 'CONTROLS', x + 12, cy, { color: UI.cyan });
    const dirs = (['up', 'down', 'left', 'right'] as const).map((a) => this.game.input.keysFor(a).map(keyLabel));
    const move = [0, 1].map((i) => dirs.map((d) => d[i] ?? '').join('')).filter(Boolean).join(' / ');
    drawText(ctx, fitText(`Move: ${move} · Confirm: ${k('confirm')}`, w - 24), x + 12, cy + 11, { color: UI.dim });
    drawText(ctx, fitText(`Cancel: ${k('cancel')} · Menu: ${k('menu')} · Dash: ${k('dash')}`, w - 24), x + 12, cy + 22, { color: UI.dim });
    if (this.confirmQuit) {
      drawWindow(ctx, x + 30, y + h / 2 - 16, w - 60, 32, { accent: UI.red });
      drawText(ctx, 'Quit to title? Unsaved progress is lost.', x + w / 2, y + h / 2 - 10, { align: 'center' });
      drawText(ctx, '{y}Confirm{/} quit · {d}Cancel{/} stay', x + w / 2, y + h / 2 + 2, { align: 'center' });
    }
  }
}

export function toggleFullscreen(): void {
  try {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  } catch {
    /* not supported */
  }
}
