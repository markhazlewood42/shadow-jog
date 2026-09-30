/** DEV-only scene routes (?scene=...): loaded by boot.ts through a dynamic import in DEV builds. */
import { createMember } from './game/party';
import { state, type MemberId } from './game/state';
import type { Display } from './engine/display';
import type { Game } from './engine/game';
import { BattleScene } from './scenes/battle';
import { BestiaryTestScene } from './scenes/bestiarytest';
import { CharTestScene } from './scenes/chartest';
import { FieldScene } from './scenes/field';
import { FontTestScene } from './scenes/fonttest';
import { MapViewScene } from './scenes/mapview';
import { PortraitTestScene } from './scenes/portraittest';

/** Run the named dev scene; false if the name isn't one (the caller shows the title). */
export function runDevScene(game: Game, scene: string, params: URLSearchParams, display: Display): boolean {
  switch (scene) {
    case 'fxlab':
      // The FX lab: tune particle presets and battle moments, save them to src/data/fx.json.
      void import('./dev/fxlab').then(({ FxLabScene }) => game.run(new FxLabScene(display)));
      break;
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
      void game.run(new CharTestScene(Number(params.get('zoom') ?? 2), params.has('npcs'), params.has('battlers')));
      break;
    case 'font':
      void game.run(new FontTestScene());
      break;
    default:
      return false;
  }
  return true;
}
