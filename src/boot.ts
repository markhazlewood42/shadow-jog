/** Boot: build generated assets, install debug hooks, route to the first scene. */
import type { Display } from './engine/display';
import type { Game } from './engine/game';
import { FontTestScene } from './scenes/fonttest';

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
    default:
      void game.run(new FontTestScene());
  }
}
