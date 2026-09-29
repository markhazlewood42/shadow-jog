/** New game setup and the opening sequence. */
import type { Game } from '../engine/game';
import { freshGame } from '../game/newgame';
import { resetSaveBaseline } from '../game/save';
import { FieldScene } from '../scenes/field';

export async function newGame(game: Game): Promise<void> {
  freshGame();
  game.playFrames = 0;
  resetSaveBaseline();
  // The flat's onEnter-style intro event handles the cold open and fades in.
  void game.reset(new FieldScene('rook_flat', 5, 5, 'down'));
}
