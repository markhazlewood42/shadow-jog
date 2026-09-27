/** Boot: build generated assets, install debug hooks, route to the first scene. */
import type { Display } from './engine/display';
import type { Game } from './engine/game';
import { FontTestScene } from './scenes/fonttest';
import { CharTestScene } from './scenes/chartest';
import { BestiaryTestScene } from './scenes/bestiarytest';
import { FieldScene } from './scenes/field';
import { state } from './game/state';

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
