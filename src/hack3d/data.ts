/**
 * The hack definitions as data (decision E3's condition; editor contract items a and b of docs/engine/m7-brief.md section 6).
 *
 * `src/data/hacks.json` holds the definitions and the transition numbers. This file reads it, checks it in a DEV build (`checkHacks`, in `checkdata.ts`: the shapes and the limits,
 * nothing that needs a browser), and hands definitions out. A definition is read when a hack starts, so a dev reload picks up an edited file; a running hack does not swap.
 *
 * No Three and no engine here: the shipped game loads this file up front (through `src/game/hackseam.ts`), next to the door.
 */
import raw, { hacks, transition } from '../data/hacks.json';
import { checkHacks } from './checkdata';
import type { HackDef } from './result';
import type { TransitionParams, UniformData } from './transition';

export { checkHacks, checkTransition, checkUniform } from './checkdata';

/** The file's shape: the transition's defaults and a list of definitions. */
export interface HacksFile {
  transition: TransitionParams;
  uniform: UniformData;
  hacks: HackDef[];
}

// A bad file is a build-time mistake: fail loudly where the file is read, not later in the middle of a story. The check runs in a DEV build and in the tests; a shipped build
// holds the file only as data (`checkdata.ts` is dropped from it), and `npm run check` has already judged the same file.
if (import.meta.env.DEV) {
  const problems = checkHacks(raw);
  if (problems.length) throw new Error(`src/data/hacks.json is not valid:\n- ${problems.join('\n- ')}`);
}

/** The definitions of the file. Read-only: copy before you change one (`hackDef` and `makeHackDef` do). */
export const HACKS: readonly HackDef[] = hacks as unknown as HackDef[];

/** The transition's defaults. Read-only: a caller lays its own fields over a copy. */
export const TRANSITION: TransitionParams = transition;

/** A definition: the file's first hack with `partial` laid over it. A copy: the file's data never changes. */
export function makeHackDef(partial: Partial<HackDef> = {}): HackDef {
  const first = HACKS[0];
  if (!first) throw new Error('src/data/hacks.json has no hack');
  return { ...JSON.parse(JSON.stringify(first)), ...partial };
}

/** The definition with this id, with `over` laid over it. Throws on an id that is not in the file, naming the ids that are. */
export function hackDef(id: string, over: Partial<HackDef> = {}): HackDef {
  const found = HACKS.find((h) => h.id === id);
  if (!found) throw new Error(`no hack "${id}" in src/data/hacks.json (it has: ${HACKS.map((h) => h.id).join(', ')})`);
  return { ...JSON.parse(JSON.stringify(found)), ...over };
}
