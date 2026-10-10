/**
 * Opening the stage for a shipped battle (M3 task 6): the provider the engine's boot glue registers under `?engine=sje` (`src/sje/boot.ts` loads this file with a dynamic
 * `import()`, so none of it is in the default path's download). `open` is called by `runBattle` (`game/systems.ts`) with the battle scene already made, before it runs:
 *
 *   1. load the stage's data once (the checked JSON files, the rig data) and the crew's pictures once (Mark's sheets when his folder is there, the stand-ins when not: the
 *      choice is made without console noise, so a machine without his folder, CI, gets no warning);
 *   2. choose the stage from the battle's backdrop (`stageFor`), the lineup from the party, the group from the enemies;
 *   3. make a `LiveStageScene` and run it, so it stands under the battle on the scene stack. `game.run` starts the scene in the same call (init, preload, create) and
 *      its promise resolves when the stage closes.
 *
 * It answers null when anything goes wrong (a hero with no sheet, a group the stage has no slots for, a failed load), and the battle then draws itself as it does without the
 * flag: a stage that cannot be made must not cost the player the fight.
 */
import type { Game as OldGame } from '../engine/game';
import type { BattleScene } from '../scenes/battle';
import type { BattleStage, BattleStageProvider } from '../scenes/battlekit/stageseam';
import type { Game } from '../sje';
import { type SpriteChoice, type StageData, chooseSprites, haveMarksSheets, loadStageAssets, loadStageData } from './boot';
import { stageOf } from './config';
import { LiveStageScene } from './live';
import { setKeyFor, type BattleStageInit } from './stagescene';

/** The stage that draws each of the old battle's backdrops. Only two stages are designed (the street and the sewer): every other backdrop gets the street's. */
const STAGE_OF_BACKDROP: Readonly<Record<string, string>> = { sewer: 'sewer' };
const DEFAULT_STAGE = 'street';

/** The stage a battle on this backdrop is shown on. */
export function stageFor(backdrop: string): string {
  return STAGE_OF_BACKDROP[backdrop] ?? DEFAULT_STAGE;
}

interface Ready {
  data: StageData;
  choice: SpriteChoice;
}

let ready: Promise<Ready> | null = null;

/** The data and the crew's pictures, loaded once for the page. A failure is not kept: the next battle tries again. */
function load(game: Game): Promise<Ready> {
  ready ??= (async () => {
    const data = await loadStageData();
    // Whether Mark's sheets are there is asked once, without console noise; a missing folder is normal on CI.
    const choice = await chooseSprites(!(await haveMarksSheets()));
    await loadStageAssets(game.textures, choice);
    return { data, choice };
  })();
  ready.catch(() => {
    ready = null;
  });
  return ready;
}

/** What a stage needs to show this battle: the stage, the lineup and the group. Throws when the stage cannot hold them. */
export function initFor(data: StageData, choice: SpriteChoice, scene: BattleScene): BattleStageInit {
  const stageId = stageFor(scene.setup.bg);
  const enemies = scene.battle.enemies.map((e) => e.key);
  return {
    stages: data.stages,
    stageId,
    metas: choice.metas,
    standIns: choice.standIns,
    lineup: scene.battle.party.map((p) => p.key),
    setKey: setKeyFor(enemies, stageOf(data.stages, stageId)),
    enemies,
    axes: data.axes,
    facing: data.facing,
    heroes: data.heroes,
  };
}

export const liveProvider: BattleStageProvider = {
  async open(old: OldGame, scene: BattleScene): Promise<BattleStage | null> {
    // The scene stack and the textures are the new engine's: the glue passes the new `Game` in the old `Game`'s clothes (the one unchecked seam of the migration, src/sje/boot.ts).
    const game = old as unknown as Game;
    try {
      const { data, choice } = await load(game);
      const stage = new LiveStageScene(initFor(data, choice, scene), scene);
      // Runs init, preload and create now. The promise settles when the stage closes; a `create` that throws rejects it (at once) and takes the scene off the stack.
      let failure: unknown = null;
      game.run(stage).catch((e: unknown) => {
        failure = e;
      });
      await Promise.resolve();
      if (stage.closed) throw failure ?? new Error('the stage scene closed as it started');
      return stage;
    } catch (e) {
      console.warn(`[battle stage] could not be made, so the battle draws itself: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  },
};
