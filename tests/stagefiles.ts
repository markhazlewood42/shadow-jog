/**
 * Stage data for the tests, in two kinds. Read `docs/DEVELOPING.md` ("Tests vs design data") before you add a test.
 *
 * FIXTURE data (`fixture*`, from `tests/fixtures/stagedata/`) is a frozen copy of the five stage files. Every test of the
 * TOOL (the editor, the loaders, the savers) and of the ALGORITHMS (rules, bake, mirror, HUD layout) uses it, because
 * the numbers in it never change. Mark edits the real files in the Battle Stage Editor, so a test that pins one of his
 * numbers breaks every time he uses the tool.
 *
 * SHIPPED data (`shipped*`, from `src/data/`) is Mark's design as it is now. Use it only in tests that check INVARIANTS
 * (the files load, every hero is present, the sprites are covered). Never pin one of his values.
 *
 * Both kinds are loaded the way the game loads them: checked and resolved into the stages the scene reads.
 * Every call returns fresh copies, so a test can break one thing without touching the next test's data.
 */
import { BG_IDS } from '../src/art/battlebg480';
import shippedFacingJson from '../src/data/enemyfacing.json';
import shippedHeroesJson from '../src/data/heroes.json';
import shippedHudJson from '../src/data/hud.json';
import shippedStagesJson from '../src/data/stages.json';
import { type EntryFile, type HudLayout, loadEntries, loadHud, loadStages, type StageFile } from '../src/battlestage/config';
import { type FacingFile, loadFacing } from '../src/battlestage/facing';
import { STAGE_KNOWN } from '../src/battlestage/known';
import { type HeroesFile, loadHeroes } from '../src/battlestage/proportions';
import fixtureFacingJson from './fixtures/stagedata/enemyfacing.json';
import fixtureHeroesJson from './fixtures/stagedata/heroes.json';
import fixtureHudJson from './fixtures/stagedata/hud.json';
import fixtureStagesJson from './fixtures/stagedata/stages.json';

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ------------------------------------------------------------------ fixture data (for tests of the tool and the algorithms)

/** The global HUD layout of the fixture. */
export const fixtureHud = (): HudLayout => loadHud(copy(fixtureHudJson));

/** Which enemy sprites the fixture mirrors. */
export const fixtureFacing = (): FacingFile => loadFacing(copy(fixtureFacingJson));

/** How tall and broad each hero stands in the fixture (Kit 1.05, Rook 1.07 x 1.08, Hex 0.8, Sable 1.27 x 1.15). */
export const fixtureHeroes = (): HeroesFile => loadHeroes(copy(fixtureHeroesJson));

/** The fixture's stage entries as `stages.json` holds them (a stage carries HUD overrides only when it differs). */
export const fixtureEntries = (): EntryFile => loadEntries(copy(fixtureStagesJson), BG_IDS, STAGE_KNOWN);

/** The fixture's stages as the scene reads them: the global HUD filled in. */
export const fixtureStages = (): StageFile => loadStages(copy(fixtureStagesJson), BG_IDS, STAGE_KNOWN, fixtureHud());

/** The raw JSON of the fixture files, for tests that check what is written. */
export { fixtureFacingJson, fixtureHeroesJson, fixtureHudJson, fixtureStagesJson };

// ------------------------------------------------------------------ shipped data (Mark's design: invariants only)

/** The global HUD layout from `hud.json`. */
export const shippedHud = (): HudLayout => loadHud(copy(shippedHudJson));

/** Which enemy sprites the stage mirrors, from `enemyfacing.json`. */
export const shippedFacing = (): FacingFile => loadFacing(copy(shippedFacingJson));

/** How tall and broad each hero stands, from `heroes.json`. */
export const shippedHeroes = (): HeroesFile => loadHeroes(copy(shippedHeroesJson));

/** The stage entries as `stages.json` holds them. */
export const shippedEntries = (): EntryFile => loadEntries(copy(shippedStagesJson), BG_IDS, STAGE_KNOWN);

/** The stages as the scene reads them: the global HUD filled in. */
export const shippedStages = (): StageFile => loadStages(copy(shippedStagesJson), BG_IDS, STAGE_KNOWN, shippedHud());

/** The raw JSON of the shipped files, for tests that check the format they are written in. */
export { shippedFacingJson, shippedHeroesJson, shippedHudJson, shippedStagesJson };
