/**
 * Boot of the new engine: what `src/main.ts` runs under `?engine=sje` (docs/engine/m1-brief.md task 12).
 *
 * `main.ts` loads this file with a dynamic `import()`, so it is its own chunk and holds all of Pixi. Without the flag no byte of it
 * downloads. It is the one file under src/sje that may import the old engine and the game: it joins the two.
 *
 *   1. Make the `Game` (canvas, WebGL2 context, Pixi renderer). No WebGL2 means `Game.create` rejects with a plain message and the page shows
 *      its "failed to start" text (`main.ts` `fail`), not a blank page.
 *   2. Hand it the OLD `Input` (keyboard, gamepad, touch, the player's own keys) and the old engine's shake motion, error notice and perf record.
 *   3. Run the game's own boot (`src/boot.ts`) on it: the same title, field, battle and shop, the same art loading, the same autosave and tab
 *      rules. It sees the new `Game` as `LegacyGameSurface` (see gameapi.ts), which is the old `Game` as far as the game code uses it, and a small
 *      stand-in for the old `Display`. That cast is the one unchecked seam of the migration; `tests/sje-game.test.ts` pins both sides to the interface.
 *
 * Build B of M1 replaces the `Display` stand-in with the real `Display` and adds the DEV hook.
 */
import { boot as bootGame } from '../boot';
import type { Display as OldDisplay } from '../engine/display';
import { notice, reportError } from '../engine/errors';
import { SHAKE_PIXEL_GAIN, type Game as OldGame } from '../engine/game';
import { Input } from '../engine/input';
import { perf } from '../engine/perf';
import { shakeOffset } from '../engine/shake';
import { settings } from '../game/settings';
import { drawNotice } from '../noticeoverlay';
import { Game } from './runtime/game';

/** The part of the old `Display` that `src/boot.ts` and the dev routes call. */
interface DisplayStandIn {
  mode: 'fit' | 'integer';
  resize(): void;
  setGpu(on: boolean): boolean;
  readonly element: HTMLCanvasElement;
}

export async function startSje(markStarted: () => void): Promise<void> {
  const stage = document.getElementById('stage') ?? document.body;
  const input = new Input(window);
  input.applyCustom(settings.keys ?? {});
  const game = await Game.create({
    parent: stage,
    input,
    fxLevel: 'auto',
    scaleMode: 'integer',
    dev: import.meta.env.DEV,
    compat: {
      reportError,
      warn: (m) => notice(m, 'warn'),
      shakeOffset,
      shakeGain: SHAKE_PIXEL_GAIN,
      record: (frameMs, tickMs) => perf.record(frameMs, tickMs),
    },
  });
  // The old 2D canvas is not used on this path.
  document.getElementById('screen')?.remove();
  const canvas = stage.querySelector('canvas');
  if (!canvas) throw new Error('The new engine made no canvas');
  const display: DisplayStandIn = {
    mode: 'integer',
    resize: () => void game.fitToWindow(stage),
    // No effects exist on this path until M2, so there is nothing to turn on. Saying "on" keeps the Options toggle from showing a wrong reason.
    setGpu: (on) => on,
    element: canvas,
  };
  // The notice overlay, as `main.ts` registers it on the old path.
  game.overlays.push(drawNotice);
  bootGame(game as unknown as OldGame, display as unknown as OldDisplay);
  const bootEl = document.getElementById('boot');
  if (bootEl) bootEl.style.display = 'none';
  game.start();
  markStarted();
  // The page's own pre-start error screen (index.html) stands down.
  (window as unknown as { __sjStarted?: boolean }).__sjStarted = true;
}
