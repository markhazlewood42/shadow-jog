/**
 * The DOOR a story script goes through to run a hack (docs/engine/frame-and-rendering.md 7.2 and
 * 7.4; interfaces.md section 12: "`hack` uses the same door as `shop()` and `battle()`").
 *
 * This file is NOT in the lazy chunk. The shipped game loads it up front (through `src/game/hackseam.ts`), and it never imports Three:
 * it reaches the 3D chunk through one dynamic `import('./index')`. So the story can ask "can this
 * browser do it?" and read the answer without downloading Three. It takes the engine's WebGL 2 probe straight from `render/glcontext`
 * (not the facade) and the engine's `Game` as a type only, so the start path gains the door and nothing else.
 *
 * Two functions:
 *   `hackDoor`        one try. Always resolves a `HackResult` (decision E11).
 *   `hackWithPolicy`  the story's loop: runs `hackDoor`, then applies the author's policy for this hack
 *                     (decision E19, `decideHack`): retry once after an abort, play a 2D alternative
 *                     when 3D is unsupported, or count it as won. It resolves a `HackOutcome` (D4).
 */
import type { Game } from '../sje';
import { probeWebGL2 } from '../sje/render/glcontext';
import { type Jack, makeJack } from './jack';
import type { HackOptions } from './hackscene';
import { DEFAULT_POLICY, decideHack, type HackDef, type HackOutcome, type HackResult } from './result';

export type { HackOptions } from './hackscene';

/** The engine's game, for the seam in `src/game/hackseam.ts` (the one game file that may name the hack door). A type only: it costs nothing at run time. */
export type HackGame = Game;

/** The two things the door asks the outside world, so a test can answer them without a browser. */
export interface DoorEnv {
  /** Does this browser give a WebGL2 context? */
  probe(): boolean;
  /** Load the 3D chunk. Rejects if the file cannot be fetched. */
  load(): Promise<{ startHack(game: Game, def: HackDef, options?: HackOptions): Promise<HackResult> }>;
  /**
   * The cover for the jump between the 2D game and the 3D scene (`jack.ts`), or null for a cut. Left out, there is no transition (a unit test, and the Phase 0 behavior).
   * The real environment makes the style that ships (`?jack=` picks another in a DEV build).
   */
  jack?(game: Game, def: HackDef, options?: HackOptions): Promise<Jack | null>;
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
  jack: (game, def, options) => makeJack(game, def.seed, options?.jack),
};

/**
 * One try at a hack. Resolves, never rejects:
 *   no WebGL2 (probed first, so the chunk is not even requested)   -> `unsupported / no-webgl2`
 *   the chunk would not load (offline, a bad deploy), or took longer
 *   than the hold bound (`holdBoundMs`, 10 s)                       -> `unsupported / chunk-failed`
 *   the context is lost right now                                   -> `aborted / context-lost`, at once
 *   the story was dropped (`game.abandon`, `game.reset`) while the
 *   chunk loaded                                                     -> `aborted / user`, no scene is started
 *   anything else: whatever the scene gives (`startHack` always resolves too).
 *
 * THE JUMP (M7 decision D5, pass lines 19 to 24). With a cover (`env.jack`) the door plays it around the scene:
 *   jack in   out phase over the 2D picture, chunk load from the first tick, hold while it loads, then under the solid cover the scene is started and draws its first frame
 *             (`onFirstRender`), then the reveal.
 *   jack out  when the scene's sim has ended, the scene calls the `gate`: the cover closes over the last 3D frame, and only then does the scene close. Then the reveal of the
 *             2D picture. A scene that ends any other way (abort, drop, error) gets no cover: it is gone, and so is the cover.
 * The cover is removed in a `finally`, so no way out of this function leaves it on screen.
 */
export async function hackDoor(game: Game, def: HackDef, options?: HackOptions, env: DoorEnv = realDoorEnv): Promise<HackResult> {
  if (!env.probe()) return { status: 'unsupported', reason: 'no-webgl2' };
  // A lost context cannot draw. Say so now instead of making the player wait for the grace timer.
  if (game.contextLost) return { status: 'aborted', reason: 'context-lost' };
  // The chunk takes time to load. If the story is dropped meanwhile, the hack it asked for is dropped too.
  const dropsBefore = game.dropCount;
  let jack: Jack | null = null;
  try {
    jack = (await env.jack?.(game, def, options)) ?? null;
  } catch (e) {
    // A cover that cannot start must not stop the hack: it is a cut then.
    console.error('[sje] the transition could not start:', e);
  }
  try {
    return jack ? await withCover(game, def, options, env, jack, dropsBefore) : await withoutCover(game, def, options, env, dropsBefore);
  } finally {
    jack?.dispose();
  }
}

type Chunk = Awaited<ReturnType<DoorEnv['load']>>;

/** Load the chunk and start the scene, with no cover (a cut). */
async function withoutCover(game: Game, def: HackDef, options: HackOptions | undefined, env: DoorEnv, dropsBefore: number): Promise<HackResult> {
  let chunk: Chunk;
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

/** The state that the cover's polls read. Plain fields: the cover asks on its ticks, so no frame depends on when a promise settles. */
interface CoverState {
  chunk: Chunk | null;
  loadError: unknown;
  loadSettled: boolean;
  scene: Promise<HackResult> | null;
  rendered: boolean;
  sceneSettled: boolean;
  outRun: Promise<'done' | 'aborted'> | null;
  /** `startHack` threw inside the swap (it should not): the swap answers 'abort' and the story gets `aborted / error`. */
  startThrew: boolean;
}

async function withCover(game: Game, def: HackDef, options: HackOptions | undefined, env: DoorEnv, jack: Jack, dropsBefore: number): Promise<HackResult> {
  const st: CoverState = { chunk: null, loadError: null, loadSettled: false, scene: null, rendered: false, sceneSettled: false, outRun: null, startThrew: false };
  // The chunk load starts at the first tick of the cover (the loader is memoized, so a second hack does not fetch again).
  void jack.started
    .then(() => env.load())
    .then(
      (c) => {
        st.chunk = c;
        st.loadSettled = true;
      },
      (e) => {
        st.loadError = e;
        st.loadSettled = true;
      },
    );

  const into = jack.run({
    // A dropped story ends the wait at once: the swap then sees the drop and goes back.
    holdReleased: () => st.loadSettled || game.dropCount !== dropsBefore,
    onSwap: () => {
      const chunk = st.chunk;
      if (!chunk || st.loadError !== null || game.dropCount !== dropsBefore) return 'abort';
      // Under the solid cover: start the scene. Its first frame is drawn in the next draw, and the reveal waits for it (`swapDone`).
      const own: HackOptions = {
        ...options,
        onFirstRender: () => {
          st.rendered = true;
          options?.onFirstRender?.();
        },
        // Jack out: when the sim ends, close the cover over the last frame first.
        // The gate must ALWAYS settle (decision E11), or the scene never closes. It settles at the swap, and also when the run ends with no swap (a cover that was disposed, or a run that was cut).
        gate: () =>
          new Promise<void>((resolve) => {
            const out = jack.run({
              onSwap: () => {
                resolve();
                return 'go';
              },
              swapDone: () => st.sceneSettled,
            });
            st.outRun = out;
            out.then(
              () => resolve(),
              () => resolve(),
            );
          }),
      };
      try {
        st.scene = chunk.startHack(game, def, own).finally(() => {
          st.sceneSettled = true;
        });
      } catch (e) {
        // `startHack` should not throw. If it does, no scene runs: the cover must come down (the swap answers 'abort') and the story gets `aborted / error`, as with no cover.
        console.error('[sje] the hack threw:', e);
        st.startThrew = true;
        return 'abort';
      }
      // `startHack` always resolves; if it ever rejected, it is read (and answered) below, after the reveal, so it must not count as unhandled meanwhile.
      st.scene.catch(() => undefined);
      return 'go';
    },
    swapDone: () => st.rendered || st.sceneSettled,
  });
  const how = await into;
  const scene = st.scene;
  if (st.startThrew) return { status: 'aborted', reason: 'error' };
  if (how === 'aborted' || !scene) {
    // The way back to the 2D picture has begun (the hold timed out, the load failed, or the story was dropped).
    if (game.dropCount !== dropsBefore) return { status: 'aborted', reason: 'user' };
    if (st.loadError !== null) console.error('[sje] the 3D chunk would not load:', st.loadError);
    else if (!st.loadSettled) console.error('[sje] the 3D chunk took longer to load than the hold bound allows');
    else console.error('[sje] the cover went back before the 3D scene started (the chunk had loaded)');
    return { status: 'unsupported', reason: 'chunk-failed' };
  }
  let result: HackResult;
  try {
    result = await scene;
  } catch (e) {
    console.error('[sje] the hack threw:', e);
    return { status: 'aborted', reason: 'error' };
  }
  // The gate ran when the sim ended: the cover closed, the scene went, and the 2D picture is being revealed. Wait for it, so the story goes on over a clean picture.
  if (st.outRun) await st.outRun;
  return result;
}

/** How long the one retry waits for a lost context (decision D3: the 1 s grace of `CONTEXT_GRACE_MS` in `scene3d.ts`, which this file may not import: it is not in the 3D chunk). */
export const RETRY_WAIT_MS = 1000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves when the game's context is back, or after `ms`, whichever comes first (at once if it is not lost). Never rejects. The seam passes this as `beforeRetry`. */
export function waitForContext(game: Game, ms: number = RETRY_WAIT_MS): Promise<void> {
  if (!game.contextLost) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      game.events.off('contextrestored', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    game.events.on('contextrestored', done);
  });
}

/**
 * Run a hack the way a story does: try, apply the author's policy, maybe retry once, maybe play the
 * authored 2D alternative. `tryHack` is one call to `hackDoor`; `playAlternative` is the author's 2D
 * stand-in (it returns whether the player won it). Resolves with the outcome. It never rejects because of a hack
 * (`tryHack` is a door); a `playAlternative` that throws is the author's own bug and its error comes out as it is.
 */
export async function hackWithPolicy(
  def: HackDef,
  tryHack: (def: HackDef) => Promise<HackResult>,
  playAlternative: () => Promise<'success' | 'fail'>,
  beforeRetry: () => Promise<void> = () => sleep(RETRY_WAIT_MS),
): Promise<HackOutcome> {
  const policy = def.policy ?? DEFAULT_POLICY;
  const results: HackResult[] = [];
  let retries = 0;
  for (;;) {
    const result = await tryHack(def);
    results.push(result);
    const decision = decideHack(result, policy, retries);
    if (decision.next === 'retry') {
      // D3: the lost context gets its grace to come back before the one retry. Without the wait, the retry sees the same lost flag and the hack is won with no play.
      await beforeRetry();
      retries++;
      continue;
    }
    if (decision.next === 'dropped') return { outcome: 'fail', via: 'dropped', results };
    if (decision.next === 'alternative') return { outcome: await playAlternative(), via: 'alternative', results };
    return { outcome: decision.outcome, via: decision.via, results };
  }
}
