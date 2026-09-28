/** Boot: build generated assets, install debug hooks, route to the first scene. */
import type { Display } from './engine/display';
import { audio } from './audio/engine';
import type { Game } from './engine/game';
import { FontTestScene } from './scenes/fonttest';
import { CharTestScene } from './scenes/chartest';
import { BestiaryTestScene } from './scenes/bestiarytest';
import { PortraitTestScene } from './scenes/portraittest';
import { MapViewScene } from './scenes/mapview';
import { FieldScene } from './scenes/field';
import { state, type MemberId } from './game/state';
import { BattleScene } from './scenes/battle';
import { createMember } from './game/party';
import { installSystems, loadIntoGame } from './game/systems';
import { TitleScene } from './scenes/title';
import { loadSave, writeSave } from './game/save';
import { newGame } from './story/newgame';
import type { Game as GameT } from './engine/game';
import { settings } from './game/settings';
import { debug } from './game/debug';
import type { GameState } from './game/state';
import * as stateMod from './game/state';
import { applyStage } from './game/stages';
import { fieldHooks } from './game/hooks';

declare global {
  interface Window {
    __SJ__?: unknown;
  }
}

export function boot(game: Game, display: Display): void {
  const params = new URLSearchParams(location.search);
  const field = () => game.stack.find((s): s is FieldScene => s instanceof FieldScene) ?? null;
  window.__SJ__ = {
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
    battle: (enc: string, bg = 'street', boss = false) => void field()?.runScript((s) => s.battle(enc, { bg, boss, canRun: !boss }).then(() => undefined)),
    say: (who: string, text: string, face = 'neutral') => void field()?.runScript((s) => s.say(who, text, { face })),
    menu: () => field() && fieldHooks.openMenu?.(field()!),
    shop: (id: string) => void field()?.runScript((s) => s.shop(id)),
    run: (fn: (s: unknown) => Promise<void>) => void field()?.runScript(fn as never),
    save: (slot: 1 | 2 | 3 | 'auto') => writeSave(slot, game.playFrames),
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
  document.addEventListener('visibilitychange', () => (document.hidden ? audio.suspend() : audio.resume()));
  const scene = params.get('scene');
  switch (scene) {
    case 'field': {
      state.party = ['kit', 'rook'];
      const x = Number(params.get('x') ?? 26), y = Number(params.get('y') ?? 15);
      void game.run(new FieldScene(params.get('map') ?? 'lantern_row', x, y, 'down'));
      break;
    }
    case 'battle': {
      const ids = (params.get('party') ?? 'kit,rook,hex,sable').split(',') as MemberId[];
      const lv = Number(params.get('lv') ?? 6);
      state.party = ids;
      for (const id of ids) state.members[id] = createMember(id, lv);
      state.inventory = { medkit: 5, neurotab: 2, adrenal_stim: 1, frag: 2, smoke_pellet: 1 };
      const enemies = params.get('enemies')?.split(',');
      const run = async (): Promise<void> => {
        for (;;) await game.run(new BattleScene({ encounter: params.get('enc') ?? 'street', enemies, bg: params.get('bg') ?? 'street', boss: params.has('boss') }));
      };
      void run();
      break;
    }
    case 'mapview':
      void game.run(new MapViewScene(params.get('map') ?? 'lantern_row'));
      break;
    case 'portraits':
      void game.run(new PortraitTestScene(params.get('faces')?.split(',')));
      break;
    case 'bestiary':
      void game.run(new BestiaryTestScene(Number(params.get('page') ?? 0)));
      break;
    case 'chars':
      void game.run(new CharTestScene(Number(params.get('zoom') ?? 2), params.has('npcs')));
      break;
    case 'font':
      void game.run(new FontTestScene());
      break;
    default:
      void startTitle(game);
  }
}

export async function startTitle(game: GameT): Promise<void> {
  await game.fadeTo(0, 0);
  const choice = await game.reset(new TitleScene());
  await game.fadeOut(30);
  if (choice.kind === 'new') {
    await newGame(game);
    return;
  }
  const s = loadSave(choice.slot);
  if (!s) {
    void startTitle(game);
    return;
  }
  loadIntoGame(game, s);
  await game.fadeIn(30);
}
