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
import { settings, shakeScale } from './game/settings';
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
  // Two tabs on one save file overwrite each other: warn in both, and only the first keeps autosaving.
  try {
    const tabs = new BroadcastChannel('shadowjog');
    const warn = () => notice('Shadow Jog is open in another tab: saves from either tab can overwrite each other.', 'warn');
    tabs.onmessage = (e) => {
      if (e.data === 'hello') {
        tabs.postMessage('here');
        warn();
      } else if (e.data === 'here') {
        autosavePolicy.enabled = false;
        warn();
      }
    };
    tabs.postMessage('hello');
  } catch {
    /* no BroadcastChannel: nothing to coordinate */
  }
  // A flow that throws every frame can't be trusted to finish: drop it and go back to the title,
  // where Continue picks up the last good save.
  game.shakeScale = shakeScale;
  game.onFault = () => {
    game.abandon();
    notice('Something broke and the game recovered to the title. Continue loads your last save.', 'warn');
    void startTitle(game, 30);
  };
  // Dev routes (?scene=field|battle|mapview|portraits|bestiary|chars|font) load only in DEV
  // builds: the test scenes aren't part of the shipped bundle.
  const scene = params.get('scene');
  if (import.meta.env.DEV && scene) {
    void import('./devroutes').then((m) => {
      if (!m.runDevScene(game, scene, params)) void startTitle(game);
    });
  } else void startTitle(game);
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
