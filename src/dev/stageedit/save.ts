/**
 * Checking and formatting what the Battle Stage Editor saves (Phaser spike `spike/phaser-stage`; on the Shadow Jog Engine since ET).
 *
 * This is the rule "everything saves to a data file the game reads, validated by the module the game loads it
 * with" (`docs/TOOLING-UI.md` 1.5 and 2.5), as pure functions: the dev server's save endpoint (`vite.config.ts`, `serve.ts`)
 * calls them with the posted body, and the editor page calls them too, so Save can refuse a bad file
 * before it ever leaves the browser, with exactly the same words the server would use.
 *
 * Five files are involved, and ONE save writes them together, through one endpoint. They are the 640x360 set the game reads (ET decision 4; the 480x270 set
 * stays frozen for the parity fixtures and the editor never writes it):
 *  - `src/data/stages-640.json` (the stages, each with a HUD override only when it differs from the global HUD),
 *  - `src/data/hud-640.json` (the ONE HUD layout every battle uses), and
 *  - `src/data/axes.json` (foot-anchor corrections per sprite), and
 *  - `src/data/enemyfacing.json` (which enemy sprites the stage mirrors so they face the heroes), and
 *  - `src/data/heroes.json` (how tall and how broad each hero stands in every battle). The last three are shared by both sets.
 * `prepareSave` checks them all TOGETHER: the HUD layout with its own loader's check (`checkHudFile`), then each
 * stage's HUD overrides against the NEW layout (a stage's own box that fitted the old HUD can stop fitting the new
 * one), then the axes. The files are written only if every check passes, so a refused save never leaves one file
 * changed and another not. (`serve.ts` writes them with temporary files and renames.)
 */
import { BG_IDS } from '../../art/battlebg480';
import { checkAxes, checkHudFile, checkStages, checkStagesWith, type HudLayout, type ScreenSize, screenOf, type StageEntry } from '../../battlestage/config';
import { checkFacing } from '../../battlestage/facing';
import { STAGE_KNOWN } from '../../battlestage/known';
import { checkHeroes } from '../../battlestage/proportions';
import { H, W } from '../../sje';
import { formatJson } from './jsonfmt';

/** The five files a save can write. */
export type SavePart = 'stages' | 'axes' | 'hud' | 'facing' | 'heroes';

/** Every part, in the order a save reports them. */
export const SAVE_PARTS: readonly SavePart[] = ['stages', 'axes', 'hud', 'facing', 'heroes'];

/** The screen of the set the editor writes: the game's 640x360. Every stage of the file is laid out on it. */
export const SET_SCREEN: ScreenSize = { w: W, h: H };

export interface SaveBody {
  stages: unknown;
  axes: unknown;
  /** The NEW global HUD layout (the `layout` part of `hud-640.json`). The stages are checked against it only when the HUD is among the files to write; otherwise against the file on disk. Optional for a caller that saves the stages alone. */
  hud?: unknown;
  /** Which enemy sprites are mirrored (the whole `enemyfacing.json`). Optional for a caller that does not touch it; it is checked, and written, only when posted. */
  facing?: unknown;
  /** How tall and how broad each hero stands (the whole `heroes.json`). Optional for a caller that does not touch it; it is checked, and written, only when posted. */
  heroes?: unknown;
  /** Which files to write. The others are left alone on disk (the axes are still checked; the HUD is not used at all when it is not written). Default: the stages, the axes, and (when posted) the HUD and the facing file. */
  write?: unknown;
}

export type Prepared = { ok: true; stagesText: string; axesText: string; hudText?: string; facingText?: string; heroesText?: string; write: SavePart[] } | { ok: false; problems: string[] };

/** How a save is checked beyond the files themselves. */
export interface SaveOptions {
  /**
   * The screen the set is laid out on. When given, the HUD file is checked against it and EVERY stage must carry exactly this `screen` (the editor and the dev server pass
   * `SET_SCREEN`: the 640 set holds 640x360 stages only). When left out, the HUD is checked on the default 480x270 screen and a stage's own screen is not judged (the unit tests
   * of the algorithms run on the frozen 480 fixture).
   */
  screen?: ScreenSize | undefined;
}

/** Where each file lives, for messages. */
export const STAGES_FILE = 'src/data/stages-640.json';
export const AXES_FILE = 'src/data/axes.json';
export const HUD_FILE = 'src/data/hud-640.json';
export const FACING_FILE = 'src/data/enemyfacing.json';
export const HEROES_FILE = 'src/data/heroes.json';

/** The stages file as it is written: stable, diff-friendly JSON. */
export function formatStages(stages: unknown): string {
  return formatJson(stages);
}

/** The axes file as it is written: only sprites with a real correction are kept, so an undone nudge leaves no trace. */
export function formatAxes(axes: unknown): string {
  if (typeof axes !== 'object' || axes === null || Array.isArray(axes)) return formatJson({});
  const kept = Object.fromEntries(Object.entries(axes).filter(([, v]) => !(typeof v === 'object' && v !== null && (v as { x?: number }).x === 0 && (v as { y?: number }).y === 0)));
  return formatJson(kept);
}

/** The facing file as it is written: stable, diff-friendly JSON. */
export function formatFacing(facing: unknown): string {
  return formatJson(facing);
}

/** The heroes file as it is written: stable, diff-friendly JSON. */
export function formatHeroes(heroes: unknown): string {
  return formatJson(heroes);
}

/** The HUD file as it is written: a version and the layout. */
export function formatHud(layout: unknown): string {
  return formatJson({ version: 1, layout });
}

/**
 * Check a posted body and, when it is fine, say exactly what would be written.
 *
 * The files are checked AS THE GAME WILL SEE THEM, together, which means against the HUD layout that will be on
 * disk AFTER this save:
 *  - when the HUD is among the files to write (`write` names 'hud', or there is no `write` and a HUD was posted), that is
 *    the POSTED layout. It is checked with the HUD loader's own check, and every stage, with its HUD overrides laid over it,
 *    is checked against it (`checkStagesWith`, the check the game's loader runs), so an override that fitted the old HUD but
 *    not the new one refuses the whole save;
 *  - when the HUD is NOT among the files to write, the posted layout is ignored (it will not be saved), and the stages are
 *    checked against the `hud-640.json` text the dev server passes (`currentHudText`, the file on disk). Checking against a
 *    layout that is never written would approve a set the game will not see, or refuse one it would accept;
 *  - the foot-anchor corrections are checked in both cases.
 * A body without a HUD layout and without `currentHudText` is checked on its own (the stages alone).
 * `opts.screen` names the set's screen (see `SaveOptions`). `write` may only name the five parts.
 */
export function prepareSave(body: unknown, currentHudText?: string, opts: SaveOptions = {}): Prepared {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, problems: ['the posted body must be an object with stages and axes'] };
  const { stages, axes, hud: postedHud, facing: postedFacing, heroes: postedHeroes, write: postedWrite } = body as Partial<SaveBody>;
  // `write` is a list of the five part names and nothing else: a file name, a path or any other word is refused before anything is checked, so no body can name a file of its own.
  if (postedWrite !== undefined) {
    if (!Array.isArray(postedWrite)) return { ok: false, problems: ['write must be a list of the parts to write: stages, axes, hud, facing, heroes'] };
    const strange = postedWrite.filter((p) => !(SAVE_PARTS as readonly unknown[]).includes(p));
    if (strange.length) return { ok: false, problems: [`write names ${strange.map((p) => JSON.stringify(p)).join(', ')}, which is not one of the parts: ${SAVE_PARTS.join(', ')}`] };
  }
  if (Array.isArray(postedWrite) && postedWrite.includes('hud') && postedHud === undefined) return { ok: false, problems: ['write lists the HUD but no HUD layout was posted'] };
  if (Array.isArray(postedWrite) && postedWrite.includes('facing') && postedFacing === undefined) return { ok: false, problems: ['write lists the enemy facing file but none was posted'] };
  if (Array.isArray(postedWrite) && postedWrite.includes('heroes') && postedHeroes === undefined) return { ok: false, problems: ['write lists the hero proportions file but none was posted'] };
  // Is the HUD one of the files this save writes? By default every file that was posted is.
  const writesHud = postedHud !== undefined && (Array.isArray(postedWrite) ? postedWrite.includes('hud') : true);
  let hud: unknown;
  let hudText: string | undefined;
  if (writesHud) {
    const hudProblems = checkHudFile({ version: 1, layout: postedHud }, opts.screen);
    if (hudProblems.length) return { ok: false, problems: hudProblems.map((p) => `the HUD layout (${HUD_FILE}) is not valid: ${p}`) };
    hud = postedHud;
    hudText = formatHud(postedHud);
  } else if (currentHudText !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(currentHudText);
    } catch {
      return { ok: false, problems: [`${HUD_FILE} on disk is not valid JSON, so the stages cannot be checked against it`] };
    }
    const hudProblems = checkHudFile(parsed, opts.screen);
    if (hudProblems.length) return { ok: false, problems: [`${HUD_FILE} on disk is not valid, so the stages cannot be checked against it: ${hudProblems[0]}`] };
    hud = (parsed as { layout: HudLayout }).layout;
  }
  const stageProblems = hud === undefined ? checkStages(stages, BG_IDS, STAGE_KNOWN) : checkStagesWith(stages, hud as HudLayout, BG_IDS, STAGE_KNOWN);
  // A stage's own HUD box that no longer fits is easy to miss from the stage list, so say plainly that the new layout is the cause.
  const explained = writesHud ? stageProblems.map((p) => (/\bhud\./.test(p) ? `the HUD layout in this save does not fit a stage's own HUD box: ${p}` : p)) : stageProblems;
  // The 640 set holds 640x360 stages only (ET decision 4): a stage laid out on another screen would draw wrong in the game.
  const screenProblems = opts.screen && stageProblems.length === 0 ? wrongScreens(stages, opts.screen) : [];
  // The facing file is checked with the game's own loader check whenever it is posted (a bad file is refused whether or not it is written).
  const facingProblems = postedFacing === undefined ? [] : checkFacing(postedFacing).map((p) => `${FACING_FILE}: ${p}`);
  // So is the heroes file, with the loader the game reads it with.
  const heroesProblems = postedHeroes === undefined ? [] : checkHeroes(postedHeroes).map((p) => `${HEROES_FILE}: ${p}`);
  const problems = [...explained, ...screenProblems, ...checkAxes(axes ?? {}), ...facingProblems, ...heroesProblems];
  if (problems.length) return { ok: false, problems };
  const all: SavePart[] = ['stages', 'axes', ...(hudText !== undefined ? (['hud'] as const) : []), ...(postedFacing !== undefined ? (['facing'] as const) : []), ...(postedHeroes !== undefined ? (['heroes'] as const) : [])];
  const write = Array.isArray(postedWrite) ? all.filter((p) => postedWrite.includes(p)) : all;
  return { ok: true, stagesText: formatStages(stages), axesText: formatAxes(axes ?? {}), ...(hudText !== undefined ? { hudText } : {}), ...(postedFacing !== undefined ? { facingText: formatFacing(postedFacing) } : {}), ...(postedHeroes !== undefined ? { heroesText: formatHeroes(postedHeroes) } : {}), write };
}

/** The stages of a file that are not laid out on `screen`, as sentences. (The stages already passed `checkStages`, so each is an object.) */
function wrongScreens(stages: unknown, screen: ScreenSize): string[] {
  return Object.entries(stages as Record<string, StageEntry>).flatMap(([id, entry]) => {
    const own = screenOf(entry);
    return own.w === screen.w && own.h === screen.h ? [] : [`stage "${id}" is laid out on ${own.w}x${own.h}, but ${STAGES_FILE} holds ${screen.w}x${screen.h} stages only`];
  });
}

export type PreparedHud = { ok: true; text: string } | { ok: false; problems: string[] };

/** Check a HUD layout (the `layout` part of `hud-640.json`) with the loader's own check on its own and say what would be written. (A save checks the layout together with the stages: `prepareSave`.) */
export function prepareHudSave(layout: unknown, screen?: ScreenSize): PreparedHud {
  const problems = checkHudFile({ version: 1, layout }, screen);
  if (problems.length) return { ok: false, problems };
  return { ok: true, text: formatHud(layout) };
}
