/**
 * Opening the stage for the shipped field (M5 task 7): the provider the engine's boot glue registers under `?engine=sje` (`src/sje/boot.ts` loads this file with a dynamic
 * `import()`, so none of it is in the default path's download). `open` is called by the field scene (`scenes/field.ts`) when it enters:
 *
 *   1. make a `FieldStageScene` that reads the field (`FieldStageSource`), and put it on the scene stack UNDER the field (`Game.runBeneath`), so the field's rules keep running
 *      on top of it and its dialogs, menus and shops open over the stage as they always did;
 *   2. wait for the first of two things: the scene's own promise (a failure in `create`, or a scene that closed as it started) or the next macrotask (the stage is up).
 *
 * It answers null when anything goes wrong, and the field then draws itself as it does without the flag. A stage that cannot be made must not cost the player the field.
 */
import { notice } from '../engine/errors';
import type { Game as OldGame } from '../engine/game';
import { FIELD_STAGE_FAILED_NOTICE, type FieldStage, type FieldStageProvider } from '../scenes/fieldkit/fieldseam';
import type { FieldScene } from '../scenes/field';
import type { Game } from '../sje';
import { FieldStageScene } from './stagescene';

export const fieldProvider: FieldStageProvider = {
  async open(old: OldGame, field: FieldScene): Promise<FieldStage | null> {
    // The scene stack is the new engine's: the glue passes the new `Game` in the old `Game`'s clothes (the one unchecked seam of the migration, src/sje/boot.ts).
    const game = old as unknown as Game;
    // The field closed while the code was loading: nothing to stand under.
    if (field.closed) return null;
    try {
      const stage = new FieldStageScene(field);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const started = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 0);
      });
      // Runs init, preload and create now. The promise settles when the stage closes (a field that ends closes it); a `create` that throws rejects it.
      const ran = game.runBeneath(stage, field).then(() => {
        throw new Error('the stage scene closed as it started');
      });
      try {
        await Promise.race([ran, started]);
      } finally {
        clearTimeout(timer);
      }
      if (stage.closed) throw new Error('the stage scene closed as it started');
      return stage;
    } catch (e) {
      console.warn(`[field stage] could not be made, so the field draws itself: ${e instanceof Error ? e.message : String(e)}`);
      notice(FIELD_STAGE_FAILED_NOTICE, 'warn');
      return null;
    }
  },
};
