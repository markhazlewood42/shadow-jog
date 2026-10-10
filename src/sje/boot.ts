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
 *      rules. It sees the new `Game` as `LegacyGameSurface` (see gameapi.ts), which is the old `Game` as far as the game code uses it, and a thin
 *      adapter over the real `Display` (`game.scale`, integer scale only) in the shape of the old one. That cast is the one unchecked seam of
 *      the migration; `tests/sje-game.test.ts` pins both sides to the interface.
 *      Before that, the effects (M2): `postfx`, the singleton that scenes and `moments.ts` call, is routed to `game.fx` (`fx/route.ts`), and the
 *      presets and moments of `fx.json` are loaded into it (`loadData`), so `FxSystem.playMoment` works by name. No `#fx` overlay canvas exists on this path.
 *   4. In a DEV build only, add the engine's members to `window.__SJ__` (`src/sje-lab/devhook.ts`, interfaces.md section 14). A shipped build
 *      never loads that file (the import sits behind `import.meta.env.DEV`).
 */
import { boot as bootGame } from '../boot';
import type { Display as OldDisplay } from '../engine/display';
import { notice, reportError } from '../engine/errors';
import { SHAKE_PIXEL_GAIN, type Game as OldGame } from '../engine/game';
import { Input } from '../engine/input';
import { perf } from '../engine/perf';
import { postfx } from '../engine/postfx';
import { shakeOffset } from '../engine/shake';
import { FX } from '../data/fx';
import { settings } from '../game/settings';
import { drawNotice } from '../noticeoverlay';
import type { FxRequest } from './fx/fxsystem';
import { routePostfx } from './fx/route';
import { Game } from './runtime/game';

/**
 * `?fx=full|lite|none` forces the effects level (tests, and a look at what a software renderer gets). Anything else leaves the setting alone.
 * It is for development and tests only, and it ships in the build: while it is set it wins over the player's setting, and over the Options toggle
 * (`display.setGpu`), so with `?fx=none` the toggle cannot turn the effects on.
 */
function forcedFx(): FxRequest | null {
  const v = new URLSearchParams(location.search).get('fx');
  return v === 'full' || v === 'lite' || v === 'none' ? v : null;
}

/** The part of the old `Display` that `src/boot.ts` and the dev routes call, over the new `Display`. */
interface DisplayAdapter {
  /** Always `integer`. `boot()` assigns `settings.scale` (also `integer`) to it. */
  mode: 'integer';
  resize(): void;
  setGpu(on: boolean): boolean;
  toGame(clientX: number, clientY: number): { x: number; y: number };
  readonly element: HTMLCanvasElement;
}

export async function startSje(markStarted: () => void): Promise<void> {
  const stage = document.getElementById('stage') ?? document.body;
  // The GL object counter must wrap the context calls before the context exists.
  const dev = import.meta.env.DEV ? await import('../sje-lab/devhook') : null;
  dev?.prepare();
  const input = new Input(window);
  input.applyCustom(settings.keys ?? {});
  const game = await Game.create({
    parent: stage,
    input,
    fxLevel: forcedFx() ?? settings.fxLevel, // the ?fx= override wins over the setting: dev and test only (see forcedFx)
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
  const display: DisplayAdapter = {
    mode: 'integer',
    resize: () => game.scale.refit(),
    // Switches the effects (M2). On means the level the ?fx= override (dev and test only) or the player asked for; `auto` there can still end up as `lite` on a software renderer.
    setGpu: (on) => {
      game.fxLevel = on ? (forcedFx() ?? (settings.fxLevel === 'none' ? 'auto' : settings.fxLevel)) : 'none';
      return game.fx.active;
    },
    toGame: (x, y) => game.scale.toGame(x, y),
    element: canvas,
  };
  // The effects: `postfx` becomes `game.fx`, and `game.fx` gets the data. `src/boot.ts` sets the comfort settings and calls `postfx.update()` once a tick.
  const problems = game.fx.loadData(FX);
  if (problems.length > 0) throw new Error(`src/data/fx.json is not valid: ${problems.join('; ')}`);
  routePostfx(postfx, () => game.fx);
  // The notice overlay, as `main.ts` registers it on the old path.
  game.overlays.push(drawNotice);
  bootGame(game as unknown as OldGame, display as unknown as OldDisplay);
  dev?.attach(game);
  const bootEl = document.getElementById('boot');
  if (bootEl) bootEl.style.display = 'none';
  game.start();
  markStarted();
  // The page's own pre-start error screen (index.html) stands down.
  (window as unknown as { __sjStarted?: boolean }).__sjStarted = true;
}
