/**
 * What the stage checker is told exists (`checkStages`' third argument), in one place that does not import
 * Phaser, so the game-side loader, the editor and the dev server's save endpoint all check against the same lists.
 */
import { ENEMIES } from '../data/enemies';
import { CREW_IDS } from './crew';

export const STAGE_KNOWN = {
  enemies: Object.keys(ENEMIES),
  bosses: Object.keys(ENEMIES).filter((k) => ENEMIES[k]?.boss),
  crew: CREW_IDS,
};
