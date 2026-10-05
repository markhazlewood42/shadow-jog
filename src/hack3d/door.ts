/**
 * The DOOR a story script goes through to run a hack (docs/engine/frame-and-rendering.md 7.2 and
 * 7.4; interfaces.md section 12: "`hack` uses the same door as `shop()` and `battle()`").
 *
 * This file is NOT in the lazy chunk. The shipped game loads it up front, and it never imports Three:
 * it reaches the 3D chunk through one dynamic `import('./index')`. So the story can ask "can this
 * browser do it?" and read the answer without downloading Three. (It does import the engine facade, so
 * it pulls Pixi along: fine from step M6 on, because the shipped game loads Pixi from M6, before M7 makes the first hack.)
 *
 * Two functions:
 *   `hackDoor`        one try. Always resolves a `HackResult` (decision E11).
 *   `hackWithPolicy`  the story's loop: runs `hackDoor`, then applies the author's policy for this hack
 *                     (decision E19, `decideHack`): retry once after an abort, play a 2D alternative
 *                     when 3D is unsupported, or count it as won.
 */
import { type Game, probeWebGL2 } from '../sje';
import type { HackOptions } from './hackscene';
import { DEFAULT_POLICY, decideHack, type HackDef, type HackResult } from './result';

/** The two things the door asks the outside world, so a test can answer them without a browser. */
export interface DoorEnv {
  /** Does this browser give a WebGL2 context? */
  probe(): boolean;
  /** Load the 3D chunk. Rejects if the file cannot be fetched. */
  load(): Promise<{ startHack(game: Game, def: HackDef, options?: HackOptions): Promise<HackResult> }>;
}

/**
 * The lazy boundary: the ONE dynamic import of the 3D chunk. Anything that needs the chunk (the door below, the
 * lab's test hooks) loads it through here, so a search for "who loads Three" has one answer.
 */
export const loadChunk = () => import('./index');

/** The real answers: ask the browser, and load the chunk. */
export const realDoorEnv: DoorEnv = {
  probe: probeWebGL2,
  load: loadChunk,
};

/**
 * One try at a hack. Resolves, never rejects:
 *   no WebGL2 (probed first, so the chunk is not even requested)   -> `unsupported / no-webgl2`
 *   the chunk would not load (offline, a bad deploy)                -> `unsupported / chunk-failed`
 *   the context is lost right now                                   -> `aborted / context-lost`, at once
 *   the story was dropped (`game.abandon`, `game.reset`) while the
 *   chunk loaded                                                     -> `aborted / user`, no scene is started
 *   anything else: whatever the scene gives (`startHack` always resolves too).
 */
export async function hackDoor(game: Game, def: HackDef, options?: HackOptions, env: DoorEnv = realDoorEnv): Promise<HackResult> {
  if (!env.probe()) return { status: 'unsupported', reason: 'no-webgl2' };
  // A lost context cannot draw. Say so now instead of making the player wait for a watchdog.
  if (game.contextLost) return { status: 'aborted', reason: 'context-lost' };
  // The chunk takes time to load. If the story is dropped meanwhile, the hack it asked for is dropped too.
  const dropsBefore = game.dropCount;
  let chunk: Awaited<ReturnType<DoorEnv['load']>>;
  try {
    chunk = await env.load();
  } catch (e) {
    console.error('[sje] the 3D chunk would not load:', e);
    return { status: 'unsupported', reason: 'chunk-failed' };
  }
  if (game.dropCount !== dropsBefore) return { status: 'aborted', reason: 'user' };
  try {
    return await chunk.startHack(game, def, options);
  } catch (e) {
    // `startHack` should not throw. If it does, the story still gets its answer.
    console.error('[sje] the hack threw:', e);
    return { status: 'aborted', reason: 'error' };
  }
}

/** What the story learns when the whole hack, policy included, is over. */
export interface HackOutcome {
  /** Did the story count this as a win? (`via: 'dropped'` is always 'fail', and the story should stop.) */
  outcome: 'success' | 'fail';
  /** `played`: the player's own result. `policy`: the author's policy decided. `alternative`: the 2D version decided.
   * `dropped`: the player dropped the story (E19): no retry, nothing started, and the story must end. */
  via: 'played' | 'policy' | 'alternative' | 'dropped';
  /** Every raw result, in order (the first try, then the retry if there was one). */
  results: HackResult[];
}

/**
 * Run a hack the way a story does: try, apply the author's policy, maybe retry once, maybe play the
 * authored 2D alternative. `tryHack` is one call to `hackDoor`; `playAlternative` is the author's 2D
 * stand-in (it returns whether the player won it). Resolves, never rejects.
 */
export async function hackWithPolicy(def: HackDef, tryHack: (def: HackDef) => Promise<HackResult>, playAlternative: () => Promise<'success' | 'fail'>): Promise<HackOutcome> {
  const policy = def.policy ?? DEFAULT_POLICY;
  const results: HackResult[] = [];
  let retries = 0;
  for (;;) {
    const result = await tryHack(def);
    results.push(result);
    const decision = decideHack(result, policy, retries);
    if (decision.next === 'retry') {
      retries++;
      continue;
    }
    if (decision.next === 'dropped') return { outcome: 'fail', via: 'dropped', results };
    if (decision.next === 'alternative') return { outcome: await playAlternative(), via: 'alternative', results };
    return { outcome: decision.outcome, via: decision.via, results };
  }
}
