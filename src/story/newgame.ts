/** New game setup and the opening sequence. */
import type { Game } from '../engine/game';
import { addMember } from '../game/party';
import { newState, setState, state } from '../game/state';
import { FieldScene } from '../scenes/field';

export async function newGame(game: Game): Promise<void> {
  setState(newState());
  addMember('kit', 1);
  addMember('rook', 3);
  state.cred = 150;
  state.inventory = { medkit: 3 };
  game.playFrames = 0;
  state.map = 'lantern_row';
  void game.reset(new FieldScene('lantern_row', 26, 15, 'down'));
  await game.fadeIn(40);
}
