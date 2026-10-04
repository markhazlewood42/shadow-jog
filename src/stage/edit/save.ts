/**
 * Checking and formatting what the Battle Stage Editor saves (Phaser spike `spike/phaser-stage`).
 *
 * This is the rule "everything saves to a data file the game reads, validated by the module the game loads it
 * with" (`docs/TOOLING-UI.md` 1.5 and 2.5), as pure functions: the dev server's save endpoints (`vite.config.ts`
 * `stageEdit`) call them with the posted body, and the editor page calls them too, so Save can refuse a bad file
 * before it ever leaves the browser, with exactly the same words the server would use.
 *
 * Four files are involved, and ONE save writes them together, through one endpoint:
 *  - `src/data/stages.json` (the stages, each with a HUD override only when it differs from the global HUD),
 *  - `src/data/axes.json` (foot-anchor corrections per sprite), and
 *  - `src/data/hud.json` (the ONE HUD layout every battle uses), and
 *  - `src/data/enemyfacing.json` (which enemy sprites the stage mirrors so they face the heroes).
 * `prepareSave` checks them all TOGETHER: the HUD layout with its own loader's check (`checkHudFile`), then each
 * stage's HUD overrides against the NEW layout (a stage's own box that fitted the old HUD can stop fitting the new
 * one), then the axes. The files are written only if every check passes, so a refused save never leaves one file
 * changed and another not. (`vite.config.ts` writes them with temporary files and renames.)
 */
import { BG_IDS } from '../../art/battlebg';
import { formatJson } from '../../tools/jsonfmt';
import { checkAxes, checkHudFile, checkStages, checkStagesWith, type HudLayout } from '../config';
import { checkFacing } from '../facing';
import { STAGE_KNOWN } from '../known';

/** The three files a save can write. */
export type SavePart = 'stages' | 'axes' | 'hud' | 'facing';

export interface SaveBody {
  stages: unknown;
  axes: unknown;
  /** The NEW global HUD layout (the `layout` part of `hud.json`). The stages are checked against it only when the HUD is among the files to write; otherwise against the file on disk. Optional for a caller that saves the stages alone. */
  hud?: unknown;
  /** Which enemy sprites are mirrored (the whole `enemyfacing.json`). Optional for a caller that does not touch it; it is checked, and written, only when posted. */
  facing?: unknown;
  /** Which files to write. The others are left alone on disk (the axes are still checked; the HUD is not used at all when it is not written). Default: the stages, the axes, and (when posted) the HUD and the facing file. */
  write?: unknown;
}

export type Prepared = { ok: true; stagesText: string; axesText: string; hudText?: string; facingText?: string; write: SavePart[] } | { ok: false; problems: string[] };

/** Where each file lives, for messages. */
export const STAGES_FILE = 'src/data/stages.json';
export const AXES_FILE = 'src/data/axes.json';
export const HUD_FILE = 'src/data/hud.json';
export const FACING_FILE = 'src/data/enemyfacing.json';

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

/** The HUD file as it is written: a version and the layout. */
export function formatHud(layout: unknown): string {
  return formatJson({ version: 1, layout });
}

/**
 * Check a posted body and, when it is fine, say exactly what would be written.
 *
 * The three files are checked AS THE GAME WILL SEE THEM, together, which means against the HUD layout that will be on
 * disk AFTER this save:
 *  - when the HUD is among the files to write (`write` names 'hud', or there is no `write` and a HUD was posted), that is
 *    the POSTED layout. It is checked with the HUD loader's own check, and every stage, with its HUD overrides laid over it,
 *    is checked against it (`checkStagesWith`, the check the game's loader runs), so an override that fitted the old HUD but
 *    not the new one refuses the whole save;
 *  - when the HUD is NOT among the files to write, the posted layout is ignored (it will not be saved), and the stages are
 *    checked against the `hud.json` text the dev server passes (`currentHudText`, the file on disk). Checking against a
 *    layout that is never written would approve a set the game will not see, or refuse one it would accept;
 *  - the foot-anchor corrections are checked in both cases.
 * A body without a HUD layout and without `currentHudText` is checked on its own (the stages alone).
 */
export function prepareSave(body: unknown, currentHudText?: string): Prepared {
  if (typeof body !== 'object' || body === null) return { ok: false, problems: ['the posted body must be an object with stages and axes'] };
  const { stages, axes, hud: postedHud, facing: postedFacing, write: postedWrite } = body as Partial<SaveBody>;
  if (Array.isArray(postedWrite) && postedWrite.includes('hud') && postedHud === undefined) return { ok: false, problems: ['write lists the HUD but no HUD layout was posted'] };
  if (Array.isArray(postedWrite) && postedWrite.includes('facing') && postedFacing === undefined) return { ok: false, problems: ['write lists the enemy facing file but none was posted'] };
  // Is the HUD one of the files this save writes? By default every file that was posted is.
  const writesHud = postedHud !== undefined && (Array.isArray(postedWrite) ? postedWrite.includes('hud') : true);
  let hud: unknown;
  let hudText: string | undefined;
  if (writesHud) {
    const hudProblems = checkHudFile({ version: 1, layout: postedHud });
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
    const hudProblems = checkHudFile(parsed);
    if (hudProblems.length) return { ok: false, problems: [`${HUD_FILE} on disk is not valid, so the stages cannot be checked against it: ${hudProblems[0]}`] };
    hud = (parsed as { layout: HudLayout }).layout;
  }
  const stageProblems = hud === undefined ? checkStages(stages, BG_IDS, STAGE_KNOWN) : checkStagesWith(stages, hud as HudLayout, BG_IDS, STAGE_KNOWN);
  // A stage's own HUD box that no longer fits is easy to miss from the stage list, so say plainly that the new layout is the cause.
  const explained = writesHud ? stageProblems.map((p) => (/\bhud\./.test(p) ? `the HUD layout in this save does not fit a stage's own HUD box: ${p}` : p)) : stageProblems;
  // The facing file is checked with the game's own loader check whenever it is posted (a bad file is refused whether or not it is written).
  const facingProblems = postedFacing === undefined ? [] : checkFacing(postedFacing).map((p) => `${FACING_FILE}: ${p}`);
  const problems = [...explained, ...checkAxes(axes ?? {}), ...facingProblems];
  if (problems.length) return { ok: false, problems };
  const all: SavePart[] = ['stages', 'axes', ...(hudText !== undefined ? (['hud'] as const) : []), ...(postedFacing !== undefined ? (['facing'] as const) : [])];
  const write = Array.isArray(postedWrite) ? all.filter((p) => postedWrite.includes(p)) : all;
  return { ok: true, stagesText: formatStages(stages), axesText: formatAxes(axes ?? {}), ...(hudText !== undefined ? { hudText } : {}), ...(postedFacing !== undefined ? { facingText: formatFacing(postedFacing) } : {}), write };
}

export type PreparedHud = { ok: true; text: string } | { ok: false; problems: string[] };

/** Check a HUD layout (the `layout` part of `hud.json`) with the loader's own check on its own and say what would be written. (A save checks the layout together with the stages: `prepareSave`.) */
export function prepareHudSave(layout: unknown): PreparedHud {
  const problems = checkHudFile({ version: 1, layout });
  if (problems.length) return { ok: false, problems };
  return { ok: true, text: formatHud(layout) };
}
