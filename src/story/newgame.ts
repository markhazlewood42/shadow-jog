/** New game setup and the opening sequence. */
import type { Game } from '../engine/game';
import { addMember } from '../game/party';
import { resetSaveBaseline } from '../game/save';
import { newState, setState, state } from '../game/state';
import { FieldScene } from '../scenes/field';

export async function newGame(game: Game): Promise<void> {
  setState(newState());
  addMember('kit', 1);
  addMember('rook', 3);
  state.cred = 150;
  state.inventory = { medkit: 3 };
  game.playFrames = 0;
  resetSaveBaseline();
  state.map = 'rook_flat';
  // The flat's onEnter-style intro event handles the cold open and fades in.
  void game.reset(new FieldScene('rook_flat', 5, 5, 'down'));
}
