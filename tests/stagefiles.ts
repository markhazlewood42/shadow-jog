/**
 * The shipped stage data for the tests, loaded the way the game loads it: `stages.json` (each stage's own part) and
 * `hud.json` (the ONE HUD layout every battle uses), checked and resolved into the stages the scene reads.
 * Every call returns fresh copies, so a test can break one thing without touching the next test's data.
 */
import { BG_IDS } from '../src/art/battlebg';
import facingJson from '../src/data/enemyfacing.json';
import hudJson from '../src/data/hud.json';
import stagesJson from '../src/data/stages.json';
import { type EntryFile, type HudLayout, loadEntries, loadHud, loadStages, type StageFile } from '../src/stage/config';
import { type FacingFile, loadFacing } from '../src/stage/facing';
import { STAGE_KNOWN } from '../src/stage/known';

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The global HUD layout from `hud.json`. */
export const shippedHud = (): HudLayout => loadHud(copy(hudJson));

/** Which enemy sprites the stage mirrors, from `enemyfacing.json`. */
export const shippedFacing = (): FacingFile => loadFacing(copy(facingJson));

/** The stage entries as `stages.json` holds them (a stage carries HUD overrides only when it differs). */
export const shippedEntries = (): EntryFile => loadEntries(copy(stagesJson), BG_IDS, STAGE_KNOWN);

/** The stages as the scene reads them: the global HUD filled in. */
export const shippedStages = (): StageFile => loadStages(copy(stagesJson), BG_IDS, STAGE_KNOWN, shippedHud());

/** The raw text of the two files, for tests that check what is written. */
export { facingJson, hudJson, stagesJson };
