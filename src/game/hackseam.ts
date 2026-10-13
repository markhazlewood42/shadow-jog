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
import { type DoorEnv, type HackGame, type HackOptions, hackDoor, hackWithPolicy, realDoorEnv } from '../hack3d/door';
import type { HackDef, HackOutcome } from '../hack3d/result';

export { hackDef } from '../hack3d/data';
export type { HackDef, HackOutcome, HackPolicy, HackResult } from '../hack3d/result';
export type { HackOptions };

/** The 2D stand-in a story gives for a browser that cannot run the 3D hack. It returns whether the player won it. */
export type PlayAlternative = () => Promise<'success' | 'fail'>;

/**
 * How a story handles a browser that cannot run the hack (decision E19: per hack, authored; D4 shape). The author MUST choose: pass the 2D `playAlternative`, or say
 * `onUnsupported: 'win'` (the hack counts as won where 3D is unsupported). A call with neither does not compile, so no default decides for the author and a player without
 * WebGL 2 never gets a silent win. `tests/hack3d-seam.test.ts` pins this with `@ts-expect-error`. (`policy.unsupported: 'fail'` or `'succeed'` on the definition skips the choice at run time.)
 */
export type HackHandling = { playAlternative: PlayAlternative; onUnsupported?: undefined } | { onUnsupported: 'win'; playAlternative?: undefined };

/** The explicit win: what `onUnsupported: 'win'` plays. */
const wonByAuthor: PlayAlternative = async () => 'success';

/**
 * DEV and tests only (decision D1 A of docs/engine/m7-brief.md: the 3D test scene has a DEV entry and no story caller). What the next hacks use in place of the real thing:
 * the door's environment (the WebGL 2 probe, the chunk loader: a booted game always has WebGL 2, and the probe keeps its context, so a test cannot make a page without it) and
 * the scene's options (the frame mode, the context grace, the HUD). A shipped build ignores it: `import.meta.env.DEV` is false there, so both functions below
 * are empty and nothing reads the variable.
 */
export interface HackDevOverride {
  env?: Partial<DoorEnv>;
  options?: HackOptions;
}

let devOverride: HackDevOverride | null = null;

/** DEV only: replace the door's environment and/or the scene options for the hacks that start from now on. `null` puts the real ones back. */
export function setHackDevOverride(o: HackDevOverride | null): void {
  if (import.meta.env.DEV) devOverride = o;
}

/** What is replaced now. Always `null` in a shipped build. */
export function hackDevOverride(): HackDevOverride | null {
  return import.meta.env.DEV ? devOverride : null;
}

/**
 * Run a hack the way a story does (decision D4): one try through the door, the author's policy applied, one retry after a lost context, the 2D alternative when
 * 3D is unsupported. Resolves a `HackOutcome`; never rejects because of the hack. `via: 'dropped'` means the player dropped the story (a loaded save, the title screen):
 * the story must stop.
 * @param game the running game (typed as the old `Game` in `src/game`; it is the engine's `Game` at run time).
 * @param how the author's choice for a browser without 3D: `{ playAlternative }` or `{ onUnsupported: 'win' }` (required, see `HackHandling`).
 */
export function runHack(game: object, def: HackDef, how: HackHandling): Promise<HackOutcome> {
  const g = game as unknown as HackGame;
  const dev = hackDevOverride();
  const env: DoorEnv | undefined = dev?.env ? { ...realDoorEnv, ...dev.env } : undefined;
  // Total at run time: a caller that dodged the types with neither field gets the explicit win, and the door never rejects.
  return hackWithPolicy(def, (d) => hackDoor(g, d, dev?.options, env), how.playAlternative ?? wonByAuthor);
}
