/**
 * Getting ready to show the battle stage (step B1 of the engine-platform spike): the things that have to be true before a
 * `BattleStageScene` can be run. The spike's `boot.ts` also made the Phaser game and kept the canvas whole-number zoomed; on the engine
 * that belongs to `Game.create` and its renderer, so what is left is the data and the assets:
 *
 *  1. Load the game's traced rig data (the enemies' art generators read it).
 *  2. Read the design data (`stages.json`, `hud.json`, `heroes.json`, `enemyfacing.json`, `axes.json`) through the loaders that check
 *     it. Mark edits these files in the Battle Stage Editor, so this code never copies a number out of them.
 *  3. Choose the crew's pictures: Mark's Sprite Fusion sheets when his git-ignored folder is there, the code-drawn stand-ins when not
 *     (CI is such a machine), and add them to the texture manager.
 */
import type { TextureManager } from '../sje';
import { BG_IDS } from '../art/battlebg';
import { loadRigData } from '../art/rig2/data';
import axesJson from '../data/axes.json';
import facingJson from '../data/enemyfacing.json';
import heroesJson from '../data/heroes.json';
import hudJson from '../data/hud.json';
import stagesJson from '../data/stages.json';
import { type AxesFile, loadAxes, loadHud, loadStages, type StageFile } from './config';
import { CREW_IDS } from './crew';
import { type FacingFile, loadFacing } from './facing';
import { STAGE_KNOWN } from './known';
import { type HeroesFile, loadHeroes } from './proportions';
import { addStandInSheets, dropCrewTextures, fetchSheetMetas, loadSheetTextures, type SheetMeta, standInMetas } from './textures';

/** The design data, checked and ready. */
export interface StageData {
  stages: StageFile;
  facing: FacingFile;
  heroes: HeroesFile;
  axes: AxesFile;
}

/** Load the rig data and read the design files. Throws one readable message if a file is wrong. */
export async function loadStageData(): Promise<StageData> {
  await loadRigData();
  return {
    stages: loadStages(stagesJson, BG_IDS, STAGE_KNOWN, loadHud(hudJson)),
    facing: loadFacing(facingJson),
    heroes: loadHeroes(heroesJson),
    axes: loadAxes(axesJson),
  };
}

/** Which pictures the crew use, and the sheet descriptions that go with them. */
export interface SpriteChoice {
  /** True when the crew are code-drawn stand-ins. */
  standIns: boolean;
  metas: Record<string, SheetMeta>;
}

/**
 * Mark's sheets live in a git-ignored folder; on a machine without it (CI) the crew are stand-in blocks, and a message says so.
 * `forceStandIns` skips his folder on purpose (the lab's `?standins`).
 */
export async function chooseSprites(forceStandIns: boolean): Promise<SpriteChoice> {
  if (!forceStandIns) {
    try {
      return { standIns: false, metas: await fetchSheetMetas(CREW_IDS) };
    } catch (e) {
      console.warn(`Mark's Sprite Fusion sheets are not available, so the crew are stand-in blocks: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { standIns: true, metas: standInMetas(CREW_IDS) };
}

/** Whether Mark's sheets can be fetched right now (no console noise: a lab uses it to say what modes it can show). */
export async function haveMarksSheets(): Promise<boolean> {
  try {
    await fetchSheetMetas(CREW_IDS);
    return true;
  } catch {
    return false;
  }
}

/** Which kind of crew pictures each texture manager holds now (a switch between kinds has to remove the old ones first). */
const crewKind = new WeakMap<TextureManager, 'art' | 'standins'>();

/**
 * Put the crew's pictures in the texture manager: Mark's sheets (fetched) or the stand-ins (drawn). Replaces the spike's
 * `preload` (`queueCrewSheets`) and its `addStandInSheets` call. Switching from one kind to the other removes the old crew textures first.
 */
export async function loadStageAssets(textures: TextureManager, choice: SpriteChoice, ids: readonly string[] = CREW_IDS): Promise<void> {
  const kind = choice.standIns ? 'standins' : 'art';
  const have = crewKind.get(textures);
  if (have && have !== kind) dropCrewTextures(textures);
  if (choice.standIns) addStandInSheets(textures, choice.metas);
  else await loadSheetTextures(textures, choice.metas, ids);
  crewKind.set(textures, kind);
}

/** The stage file with one stage's floor seed changed (the floor's puddles and reflections follow the seed). The input is not touched. */
export function withSeed(stages: StageFile, stageId: string, seed: number): StageFile {
  const stage = stages[stageId];
  if (!stage) throw new Error(`No stage "${stageId}" to seed (stages: ${Object.keys(stages).join(', ')})`);
  return { ...stages, [stageId]: { ...stage, floor: { ...stage.floor, seed } } };
}
