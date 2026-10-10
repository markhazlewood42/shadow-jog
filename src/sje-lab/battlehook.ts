/**
 * The DEV hook of the battle stage (M3 task 7; docs/engine/m3-brief.md sections 4 and 6, pass lines 3 and 6): two members on `window.__SJ__`, added in a DEV build only (the
 * engine's DEV hook, `devhook.ts`, calls `attachBattleHook`; a shipped build never loads either file, and e2e/prod.spec.ts checks that `window.__SJ__` is absent).
 *
 *   battleStage          the stage of the battle that is on, as plain data: its figures (where, in what draw order, how they look), the camera and what the HUD shows.
 *                        `null` when no battle is on. No Pixi object is in it. (Not called `stage`: `window.__SJ__.stage(name)` is the game's own "jump to a point of the chapter".)
 *   battleTrace(seed, o) a seeded fight on the headless driver (`battlestage/battledrive.ts`), as a status trace: one line per action with the DISPLAYED state of every
 *                        fighter. `o.stage` ("street" or "sewer") and `o.group` ("3", "boss+1"...) choose the fight (the stage's own demo party and group); `o.path: 'legacy'`
 *                        gives the same fight made from the engine alone, the way the shipped battle scene calls it, so a test in the page can hold the two equal.
 */
import { BG_IDS } from '../art/battlebg480';
import { type DriveResult, battleTrace, legacyTrace, setupFor } from '../battlestage/battledrive';
import { loadHud, loadStages, stageOf } from '../battlestage/config';
import { liveStage, type LiveDescription } from '../battlestage/live';
import { STAGE_KNOWN } from '../battlestage/known';
import hudJson from '../data/hud.json';
import stagesJson from '../data/stages.json';

export interface BattleTraceOptions {
  stage?: string;
  group?: string;
  path?: 'driver' | 'legacy';
}

/** A seeded fight, as a status trace. */
export function traceOf(seed: number, o: BattleTraceOptions = {}): DriveResult {
  const stages = loadStages(JSON.parse(JSON.stringify(stagesJson)), BG_IDS, STAGE_KNOWN, loadHud(JSON.parse(JSON.stringify(hudJson))));
  const setup = setupFor(stageOf(stages, o.stage ?? 'street'), o.group ?? '3', seed);
  return o.path === 'legacy' ? legacyTrace(setup) : battleTrace(setup);
}

export interface BattleHook {
  readonly battleStage: LiveDescription | null;
  battleTrace(seed: number, o?: BattleTraceOptions): DriveResult;
}

/** Put the battle members on `window.__SJ__`. `Object.defineProperties` keeps the `battleStage` getter live. */
export function attachBattleHook(sj: Record<string, unknown>): void {
  const hook: BattleHook = {
    get battleStage() {
      return liveStage()?.describe() ?? null;
    },
    battleTrace: (seed, o) => traceOf(seed, o),
  };
  Object.defineProperties(sj, Object.getOwnPropertyDescriptors(hook));
}
