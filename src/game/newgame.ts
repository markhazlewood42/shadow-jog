/** The state a new game starts from (pure: no scenes), so tests can check it. */
import { addMember } from './party';
import { newState, setState, state } from './state';

/**
 * A fresh run: Kit and Rook at their own starting levels (party.ts: Kit 1, Rook the veteran 10),
 * a little cred and three medkits, in Rook's flat.
 */
export function freshGame(): void {
  setState(newState());
  addMember('kit');
  addMember('rook');
  state.cred = 150;
  state.inventory = { medkit: 3 };
  state.map = 'rook_flat';
}
