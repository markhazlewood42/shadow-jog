/** Boot: build generated assets, install debug hooks, route to the first scene. */
import type { Display } from './engine/display';
import type { Game } from './engine/game';
import { FontTestScene } from './scenes/fonttest';
import { CharTestScene } from './scenes/chartest';
import { BestiaryTestScene } from './scenes/bestiarytest';
import { FieldScene } from './scenes/field';
import { state, type MemberId } from './game/state';
import { BattleScene } from './scenes/battle';
import { createMember } from './game/party';

declare global {
  interface Window {
    __SJ__?: unknown;
  }
}

export function boot(game: Game, display: Display): void {
  const params = new URLSearchParams(location.search);
  window.__SJ__ = { game, display };
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
    case 'bestiary':
      void game.run(new BestiaryTestScene(Number(params.get('page') ?? 0)));
      break;
    case 'chars':
      void game.run(new CharTestScene(Number(params.get('zoom') ?? 2), params.has('npcs')));
      break;
    default:
      void game.run(new FontTestScene());
  }
}
