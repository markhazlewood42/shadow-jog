/** Boot: build generated assets, install debug hooks, route to the first scene. */
import type { Display } from './engine/display';
import { audio } from './audio/engine';
import type { Game } from './engine/game';
import { FieldScene } from './scenes/field';
import { autosave, autosavePolicy, installSystems, loadIntoGame } from './game/systems';
import { TitleScene } from './scenes/title';
import { loadSave, unsavedFrames, writeSave } from './game/save';
import { newGame } from './story/newgame';
import type { Game as GameT } from './engine/game';
import { flashScale, saveSettings, settings, shakeScale } from './game/settings';
import { debug, debugBattleDriver } from './game/debug';
import { setBattleDriver } from './scenes/battlekit/driver';
import type { GameState } from './game/state';
import type { ScriptFn } from './game/script';
import { ENCOUNTERS } from './data/enemies';
import * as stateMod from './game/state';
import { applyStage } from './game/stages';
import { perf } from './engine/perf';
import { currentNotice, notice } from './engine/errors';
import { EndingScene } from './scenes/ending';
import { fieldHooks } from './game/hooks';
import { postfx } from './engine/postfx';
import { FX } from './data/fx';
import { ALL_DRAWN, DEFAULT_DRAWN, loadDrawnArt } from './art/drawn';
import { loadRigData } from './art/rig2/data';
import { applyRigNpcs } from './art/rig2/npcs';
import { applyRigPortraits } from './art/rig2/portrait';

declare global {
  interface Window {
    __SJ__?: unknown;
  }
}

export function boot(game: Game, display: Display): void {
  const params = new URLSearchParams(location.search);
  const field = () => game.stack.find((s): s is FieldScene => s instanceof FieldScene) ?? null;
  // Debug/test hook: dev server only (E2E and screenshot tooling), never in a production build.
  // Test harness hooks exist only in DEV builds: a shipped build's battles have no driver.
  if (import.meta.env.DEV) setBattleDriver(debugBattleDriver);
  // The DEV menu: every dev tool one click away (src/dev/devmenu.ts; not in the shipped game).
  if (import.meta.env.DEV) void import('./dev/devmenu').then((m) => m.mountDevMenu(params.has('devmenu')));
  if (import.meta.env.DEV) window.__SJ__ = {
    game,
    display,
    debug,
    get state(): GameState {
      return stateMod.state;
    },
    field,
    top: () => game.top?.constructor.name ?? null,
    idle: () => {
      const f = field();
      return !!f && game.top === f && f.busy === 0 && !f.leader.moving;
    },
    tp: (map: string, x: number, y: number, dir: 'up' | 'down' | 'left' | 'right' = 'down') => field()?.warp(map, x, y, dir, false),
    newGame: () => newGame(game),
    /** Jump to a preset point in the chapter on a fresh field. */
    stage: async (name: string) => {
      const st = applyStage(name);
      game.playFrames = st.minutes * 60 * 60;
      void game.reset(new FieldScene(st.map, st.x, st.y, st.dir));
      await game.fadeTo(0, 0);
    },
    /** Register a one-group encounter (screenshots of a specific line-up). */
    defineEncounter: (id: string, e: string[]) => {
      ENCOUNTERS[id] = [{ w: 1, e }];
    },
    battle: (enc: string, bg = 'street', boss = false) => void field()?.runScript((s) => s.battle(enc, { bg, boss, canRun: !boss }).then(() => undefined)),
    say: (who: string, text: string, face = 'neutral') => void field()?.runScript((s) => s.say(who, text, { face })),
    menu: () => field() && fieldHooks.openMenu?.(field()!),
    shop: (id: string) => void field()?.runScript((s) => s.shop(id)),
    run: (fn: ScriptFn) => void field()?.runScript(fn),
    save: (slot: 1 | 2 | 3 | 'auto') => writeSave(slot, game.playFrames),
    /** Frame-work timing (see engine/perf.ts). */
    perf,
    notice: () => currentNotice(),
    /** The end-of-chapter results and next-chapter card, without the comic pages. */
    ending: () => void game.run(new EndingScene(game.playFrames)),
    /** GPU effects: the façade (engine/postfx.ts), the live presets and moments (data/fx.ts), and
     *  the switch as Options flips it. */
    postfx,
    fx: FX,
    /** The trailer tools (src/dev/trailer.ts, for scripts/trailer.mjs), loaded on first use. */
    trailer: async () => {
      const t = await import('./dev/trailer');
      t.attach(game);
      return t;
    },
    gpu: (on: boolean) => {
      settings.gpuFx = on;
      saveSettings();
      window.dispatchEvent(new Event('sj-gpu'));
    },
  };
  display.mode = settings.scale;
  display.resize();
  window.addEventListener('sj-scale', () => {
    display.mode = settings.scale;
    display.resize();
  });
  installSystems(game, {
    toTitle: () => void startTitle(game),
    toField: (map, x, y, dir) => void game.reset(new FieldScene(map, x, y, dir)),
  });
  const unlock = () => audio.unlock();
  window.addEventListener('keydown', unlock);
  window.addEventListener('pointerdown', unlock);
  // Navigating away: stop making audio calls (Firefox rejects every one after navigation starts).
  window.addEventListener('pagehide', () => audio.close());
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) audio.reopen();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      audio.resume();
      return;
    }
    audio.suspend();
    // Tabbing away (or a phone locking) is the moment progress is most at risk: save if it's safe.
    const f = game.top;
    if (f instanceof FieldScene && f.busy === 0 && game.countPlayTime && unsavedFrames(game.playFrames) > 60 * 20) autosave(game);
  });
  // Closing the tab with unsaved progress asks first. (Not under ?debug: the test harness
  // navigates mid-session, and a prompt there would stall the run.)
  if (!params.has('debug')) {
    window.addEventListener('beforeunload', (e) => {
      if (!game.countPlayTime || unsavedFrames(game.playFrames) < 60 * 30) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }
  // Two tabs on one save file overwrite each other: warn in both, and only the oldest open tab
  // autosaves. When it closes it says goodbye, and the next oldest takes over.
  try {
    const tabs = new BroadcastChannel('shadowjog');
    const born = Date.now() + Math.random();
    const warn = () => notice('Shadow Jog is open in another tab: saves from either tab can overwrite each other.', 'warn');
    tabs.onmessage = (e) => {
      const m = e.data as { t?: string; born?: number } | null;
      if (!m || typeof m.born !== 'number') return;
      if (m.t === 'hello') {
        tabs.postMessage({ t: 'here', born });
        if (m.born < born) autosavePolicy.enabled = false;
        warn();
      } else if (m.t === 'here') {
        if (m.born < born) autosavePolicy.enabled = false;
        warn();
      } else if (m.t === 'bye' && !autosavePolicy.enabled) {
        // Take over, then ask again: an older tab still open will answer and take it back.
        autosavePolicy.enabled = true;
        autosavePolicy.pausedNoticeShown = false;
        notice('The other tab closed: autosave is back on here.', 'news');
        tabs.postMessage({ t: 'hello', born });
      }
    };
    tabs.postMessage({ t: 'hello', born });
    window.addEventListener('pagehide', (e) => {
      if (autosavePolicy.enabled) tabs.postMessage({ t: 'bye', born });
      // Gone: a closing page can still be alive for a moment, and must not answer the next
      // tab's hello (it would take autosave straight back). A page kept in the back-forward
      // cache is frozen instead, and keeps its channel for when it comes back.
      if (!e.persisted) tabs.close();
    });
  } catch {
    /* no BroadcastChannel: nothing to coordinate */
  }
  // A flow that throws every frame can't be trusted to finish: drop it and go back to the title,
  // where Continue picks up the last good save.
  game.shakeScale = shakeScale;
  game.flashScale = flashScale;
  // GPU effects: on when the setting says so and WebGL 2 works. Shockwaves follow Screen shake
  // and pulses follow Screen flash, so the comfort options cover them too.
  display.setGpu(settings.gpuFx);
  window.addEventListener('sj-gpu-slow', () => {
    display.setGpu(false);
    postfx.suspended = true;
    notice('The GPU effects were slowing the game down, so they’re off for now. Options → GPU effects turns them back on.', 'warn');
  });
  window.addEventListener('sj-gpu', () => {
    if (!display.setGpu(settings.gpuFx) && settings.gpuFx) notice('GPU effects need a graphics card this browser can use (WebGL 2). The game looks as before.', 'warn');
  });
  game.tickers.push(() => {
    postfx.motion = [0, 0.6, 1][settings.shake] ?? 1;
    postfx.intensity = [0, 0.5, 1][settings.flash] ?? 1;
    postfx.update();
  });
  game.onFault = () => {
    game.abandon();
    notice('Something broke and the game recovered to the title. Continue loads your last save.', 'warn');
    void startTitle(game, 30);
  };
  // Dev routes (?scene=field|battle|mapview|portraits|bestiary|chars|font) load only in DEV
  // builds: the test scenes aren't part of the shipped bundle.
  const scene = params.get('scene');
  const start = () => {
    if (import.meta.env.DEV && scene) {
      void import('./devroutes').then((m) => {
        if (!m.runDevScene(game, scene, params, display)) void startTitle(game);
      });
    } else void startTitle(game);
  };
  // Drawn art (the PixelLab pass's picks, src/art/drawn.ts): by default only the tilesets and props
  // (Mark, 2026-09-30: the characters, enemies and portraits went back to code-drawn art; snapshot
  // tag snapshot/2026-09-30-pixellab-picks). `?art=drawn` loads all of it and `?art=classic` none,
  // for comparing. It goes in before anything is built (swaps apply to sprites made after them);
  // anything that doesn't load keeps its code-drawn art, with a notice.
  const art = params.get('art');
  const timeout = () => new Promise<never>((_, reject) => setTimeout(() => reject(new Error('it took too long')), 10_000));
  const drawnArt: Promise<void> =
    art === 'classic'
      ? Promise.resolve()
      : Promise.race([loadDrawnArt('art/', art === 'drawn' ? ALL_DRAWN : DEFAULT_DRAWN), timeout()]).then(
          ({ failed }) => {
            if (failed.length) notice(`Some drawn art didn't load, so the original shows for it (${failed.length}: ${failed.slice(0, 2).join('; ')}${failed.length > 2 ? '…' : ''})`, 'warn');
          },
          (e: unknown) => notice(`The drawn art didn't load, so the game shows its original art (${e instanceof Error ? e.message : String(e)})`, 'warn'),
        );
  // Rig v2's traced frames (src/art/rig2/data.ts): without them the crew use the letter-grid rig.
  // `?rig=old` keeps the letter-grid rig (for comparing).
  const rigData: Promise<void> =
    params.get('rig') === 'old'
      ? Promise.resolve()
      : Promise.race([loadRigData(), timeout()]).then(
          () => {
            applyRigNpcs();
            applyRigPortraits();
          },
          (e: unknown) => notice(`The character art didn't load, so the crew use their older sprites (${e instanceof Error ? e.message : String(e)})`, 'warn'),
        );
  const drawn = Promise.all([drawnArt, rigData]).then(() => undefined);
  // ?art=review (DEV only): art-pass options tried in the game on top (src/dev/artswap.ts).
  if (import.meta.env.DEV && (art === 'review' || art === 'pixellab')) {
    void drawn
      .then(() => import('./dev/artswap'))
      .then((m) => m.applyReview(params))
      .then(
        ({ done, failed }) => {
          if (done.length) notice(`Trying art-pass picks: ${done.join(', ')}`, 'news');
          if (failed.length) notice(`Couldn't swap in: ${failed.join('; ')}`, 'warn');
          if (!done.length && !failed.length) notice('No art-pass picks to try yet: mark some ★ Best on /artreview.html', 'warn');
        },
        (e: unknown) => notice(`Art pass not available: ${e instanceof Error ? e.message : String(e)}`, 'warn'),
      )
      .finally(start);
  } else void drawn.finally(start);
}

/** Show the title (fading in over `fadeIn` frames) and act on the choice. */
export async function startTitle(game: GameT, fadeIn = 0): Promise<void> {
  const title = game.reset(new TitleScene());
  void game.fadeTo(0, fadeIn);
  const choice = await title;
  await game.fadeOut(30);
  if (choice.kind === 'new') {
    await newGame(game);
    return;
  }
  const s = loadSave(choice.slot);
  if (!s) {
    notice('That save is damaged and could not be loaded. Your other slots are unaffected.', 'warn');
    void startTitle(game, 30);
    return;
  }
  loadIntoGame(game, s);
  await game.fadeIn(30);
}
