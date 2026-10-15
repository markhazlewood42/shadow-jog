/**
 * Boot of the engine: what `src/main.ts` runs (docs/engine/m1-brief.md task 12).
 *
 * `main.ts` loads this file with a dynamic `import()`, so it is its own chunk and holds all of Pixi. It is the one file under src/sje that may import the old input and the game: it joins them.
 *
 *   1. Make the `Game` (canvas, WebGL2 context, Pixi renderer). No WebGL2 means `Game.create` rejects with a plain message and the page shows
 *      its "failed to start" text (`main.ts` `fail`), not a blank page.
 *   2. Hand it the `Input` (keyboard, gamepad, touch, the player's own keys) and the shake motion, error notice and perf record of `src/engine`.
 *   3. Run the game's own boot (`src/boot.ts`) on it: the title, field, battle and shop, the art loading, the autosave and tab rules. The game code takes the `Game` as it is, plus a
 *      thin adapter over the real `Display` (`PageDisplay`: `game.scale`, integer scale only).
 *      Before that, the effects (M2): the presets and moments of `fx.json` are loaded into `game.fx` (`loadData`), so `FxSystem.playMoment` works by name. No `#fx` overlay canvas exists.
 *      And the battle stage (M3): the battle's routing (`game/systems.ts`) asks for a stage, and the provider registered here makes one (`src/battlestage/liveopen.ts`, loaded
 *      with a dynamic `import()` the first time a battle starts, so a session that never fights downloads none of it).
 *      And the field stage (M5): the field asks for a stage when it enters, and the provider registered here (`src/fieldstage/fieldopen.ts`, a dynamic `import()` too, fetched ahead) puts a
 *      `FieldStageScene` UNDER the field scene.
 *   4. In a DEV build only, add the engine's members to `window.__SJ__` (`src/sje-lab/devhook.ts`, interfaces.md section 14). A shipped build
 *      never loads that file (the import sits behind `import.meta.env.DEV`).
 */
import { notice, reportError } from '../engine/errors';
import { Input } from '../engine/input';
import { perf } from '../engine/perf';
import { shakeOffset } from '../engine/shake';
import { FX } from '../data/fx';
import { showGpuNoticeOnce } from '../game/gpunotice';
import { settings } from '../game/settings';
import { drawNotice } from '../noticeoverlay';
import { lazyStageProvider, setBattleStageProvider } from '../scenes/battlekit/stageseam';
import { fieldStages, lazyFieldStageProvider, setFieldStageProvider } from '../scenes/fieldkit/fieldseam';
import type { FxRequest } from './fx/fxsystem';
import { SOFTWARE_GL } from './render/glcontext';
import { pageSeed } from './runtime/devseed';
import { Game } from './runtime/game';
import type { PageDisplay } from './runtime/display';
import { SHAKE_PIXEL_GAIN } from './runtime/screenfx';

/**
 * `?fx=full|lite|none` forces the effects level (tests, and a look at what a software renderer gets). Anything else leaves the setting alone.
 * It is for development and tests only, and it ships in the build: while it is set it wins over the player's setting, and over the Options toggle
 * (`display.setGpu`), so with `?fx=none` the toggle cannot turn the effects on.
 */
function forcedFx(): FxRequest | null {
  const v = new URLSearchParams(location.search).get('fx');
  return v === 'full' || v === 'lite' || v === 'none' ? v : null;
}

/**
 * `?seed=N` seeds the effects' visual stream (the screen tears, the transition's blocks), so two page loads draw the same pictures and a capture can be made again
 * (pass line 24 of docs/engine/m7-brief.md). DEV builds only: a shipped game keeps the engine's own seed.
 */
function forcedSeed(): number | undefined {
  return pageSeed();
}

/** The `seed` field of the game config, or nothing. */
function seedOption(): { seed?: number } {
  const seed = forcedSeed();
  return seed === undefined ? {} : { seed };
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
    ...seedOption(),
    dev: import.meta.env.DEV,
    compat: {
      reportError,
      warn: (m) => notice(m, 'warn'),
      shakeOffset,
      shakeGain: SHAKE_PIXEL_GAIN,
      record: (frameMs, tickMs) => perf.record(frameMs, tickMs),
    },
  });
  // The game's own boot (scenes, systems) is a chunk of its own. A static import would merge it with the engine into one 770 kB chunk, over the largest-chunk cap of
  // scripts/bundle-budget.mjs, and any edit to the game would then change the hash of Pixi's code too. It is requested only now that `Game.create` has succeeded, so a
  // browser without WebGL 2 (decision E5) does not download game code that cannot run. The rest of this function is synchronous until the `await` below, so the fetch still
  // overlaps the setup.
  const gameBoot = import('../boot');
  void gameBoot.catch(() => undefined); // a failure shows where it is awaited below, through the `catch` of this function; this only stops a second, unhandled report
  try {
    // The old 2D canvas is not used on this path.
    document.getElementById('screen')?.remove();
    const canvas = stage.querySelector('canvas');
    if (!canvas) throw new Error('The new engine made no canvas');
    const display: PageDisplay = {
      mode: 'integer',
      resize: () => game.scale.refit(),
      // Switches the effects (M2). On means the level the ?fx= override (dev and test only) or the player asked for; `auto` there can still end up as `lite` on a software renderer.
      setGpu: (on) => {
        game.fxLevel = on ? (forcedFx() ?? (settings.fxLevel === 'none' ? 'auto' : settings.fxLevel)) : 'none';
        return game.fx.active;
      },
      get fxLevel() {
        return game.fx.level;
      },
      toGame: (x, y) => game.scale.toGame(x, y),
      element: canvas,
    };
    // The effects: `game.fx` gets the data. `src/boot.ts` sets the comfort settings and calls `game.fx.update()` once a tick.
    const problems = game.fx.loadData(FX);
    if (problems.length > 0) throw new Error(`src/data/fx.json is not valid: ${problems.join('; ')}`);
    // The battle stage: loaded when the first battle asks for it (src/scenes/battlekit/stageseam.ts).
    // A failed load is a notice and the legacy renderer, never a fight that does not start (battlekit/stageseam.ts).
    setBattleStageProvider(lazyStageProvider(async () => (await import('../battlestage/liveopen')).liveProvider));
    // The field stage (M5): the field asks for it when it enters (src/scenes/fieldkit/fieldseam.ts). Loaded on first use; a failed load is a notice and the field draws itself.
    // The code is fetched ahead, so the first field does not wait for it.
    setFieldStageProvider(lazyFieldStageProvider(async () => (await import('../fieldstage/fieldopen')).fieldProvider));
    fieldStages.warm();
    // The notice overlay, as `main.ts` registers it on the old path.
    game.overlays.push(drawNotice);
    const { boot: bootGame } = await gameBoot;
    bootGame(game, display);
    dev?.attach(game);
    const bootEl = document.getElementById('boot');
    if (bootEl) bootEl.style.display = 'none';
  } catch (e) {
    // A failure after the canvas and the GL context exist (the game chunk did not load, fx.json is invalid, the game's own boot threw): free them. Left alone, the page shows
    // the "failed to start" text over a live, empty Game, and a retry would add a second context. The loop has not started, so nothing is running.
    try {
      game.destroyForTests(); // named for tests, but it is the one teardown; the context is ours alone here (the game never started)
    } catch (cleanup) {
      console.error(cleanup);
    }
    throw e;
  }
  game.start();
  // One notice, once, on a software renderer: the GPU effects can be turned off in Options (src/game/gpunotice.ts). `?debug` is the test harness flag: the notice would sit
  // on top of the goldens, so it stays away (e2e/gpufx.spec.ts opens the page without it).
  if (!new URLSearchParams(location.search).has('debug')) {
    let store: Storage | null = null;
    try {
      store = localStorage;
    } catch {
      /* storage blocked: the notice then shows once for each page load */
    }
    showGpuNoticeOnce(SOFTWARE_GL.test(game.rendererName), store, (text) => notice(text, 'warn'));
  }
  markStarted();
  // The page's own pre-start error screen (index.html) stands down.
  (window as unknown as { __sjStarted?: boolean }).__sjStarted = true;
}
