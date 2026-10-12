/**
 * The seam between the shipped game and the hack door (M7; docs/engine/m7-brief.md). It follows the M5 field seam (`scenes/fieldkit/fieldseam.ts`).
 *
 * This is the ONLY game file that imports `src/hack3d`, and it reaches only three files of it: `door.ts`, `result.ts` and `data.ts`. None of them imports Three, so
 * the shipped game holds the door but not the 3D chunk: the chunk is behind the door's one dynamic `import()`, and a player who never hacks never downloads it.
 * `tests/sje-imports.test.ts` pins both rules.
 *
 * The game's own `Game` type is the old engine class in `src/game`, and the runtime object is the new engine's `Game` (`src/sje/boot.ts` joins them), so the cast
 * from one to the other happens once, here (the same cast `src/devroutes.ts` makes for the FX lab).
 */
import { type HackGame, hackDoor, hackWithPolicy } from '../hack3d/door';
import type { HackDef, HackOutcome } from '../hack3d/result';

export { hackDef } from '../hack3d/data';
export type { HackDef, HackOutcome, HackPolicy, HackResult } from '../hack3d/result';

/** The 2D stand-in a story gives for a browser that cannot run the 3D hack. It returns whether the player won it. */
export type PlayAlternative = () => Promise<'success' | 'fail'>;

/**
 * The alternative when a story gives none: count the hack as won. Nobody wrote a 2D version, and the default policy never traps the player
 * (`DEFAULT_POLICY`: be kind). A story that wants a loss writes `policy.unsupported: 'fail'` or its own alternative.
 */
const wonByDefault: PlayAlternative = async () => 'success';

/**
 * Run a hack the way a story does (decision D4): one try through the door, the author's policy applied, one retry after a lost context, the 2D alternative when
 * 3D is unsupported. Resolves a `HackOutcome`; never rejects because of the hack. `via: 'dropped'` means the player dropped the story (a loaded save, the title screen):
 * the story must stop.
 * @param game the running game (typed as the old `Game` in `src/game`; it is the engine's `Game` at run time).
 */
export function runHack(game: object, def: HackDef, playAlternative: PlayAlternative = wonByDefault): Promise<HackOutcome> {
  const g = game as unknown as HackGame;
  return hackWithPolicy(def, (d) => hackDoor(g, d), playAlternative);
}
