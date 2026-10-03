/**
 * Checking and formatting what the Battle Stage Editor saves (Phaser spike `spike/phaser-stage`).
 *
 * This is the rule "everything saves to a data file the game reads, validated by the module the game loads it
 * with" (`docs/TOOLING-UI.md` 1.5 and 2.5), as pure functions: the dev server's save endpoints (`vite.config.ts`
 * `stageEdit`) call them with the posted body, and the editor page calls them too, so Save can refuse a bad file
 * before it ever leaves the browser, with exactly the same words the server would use.
 *
 * Three files are involved, saved by two endpoints:
 *  - `src/data/stages.json` (the stages, each with a HUD override only when it differs from the global HUD) and
 *    `src/data/axes.json` (foot-anchor corrections per sprite) are saved together by `prepareSave`, checked as a
 *    pair and written only if both are fine, so a refused save never leaves one changed and the other not;
 *  - `src/data/hud.json` (the ONE HUD layout every battle uses) is saved on its own by `prepareHudSave`, through
 *    its own endpoint, checked with its own loader's check (`checkHudFile`).
 */
import { BG_IDS } from '../../art/battlebg';
import { formatJson } from '../../tools/jsonfmt';
import { checkAxes, checkHudFile, checkStages, checkStagesWith, type HudLayout } from '../config';
import { STAGE_KNOWN } from '../known';

export interface SaveBody {
  stages: unknown;
  axes: unknown;
  /** The global HUD layout the stages are resolved against. Optional: the server checks the stage file on its own, the editor page also checks the pair. */
  hud?: unknown;
}

export type Prepared = { ok: true; stagesText: string; axesText: string } | { ok: false; problems: string[] };

/** Where each file lives, for messages. */
export const STAGES_FILE = 'src/data/stages.json';
export const AXES_FILE = 'src/data/axes.json';
export const HUD_FILE = 'src/data/hud.json';

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

/** The HUD file as it is written: a version and the layout. */
export function formatHud(layout: unknown): string {
  return formatJson({ version: 1, layout });
}

/**
 * Check a posted body and, when it is fine, say exactly what would be written.
 *
 * The stages are checked AS THE GAME WILL SEE THEM: each stage's HUD overrides are laid over the global HUD and must
 * still fit the screen (`checkStagesWith`, the check the game's loader runs). Which global HUD? When the dev server
 * passes the text of the `hud.json` it has on disk (`currentHudText`), that one: it is the file the game will load
 * next to this stage file, whatever the page believes. (The page saves the HUD first, so the disk copy is the new
 * one.) Without it, the body's own `hud` is used if there is one, and a stage file alone is checked on its own.
 */
export function prepareSave(body: unknown, currentHudText?: string): Prepared {
  if (typeof body !== 'object' || body === null) return { ok: false, problems: ['the posted body must be an object with stages and axes'] };
  const { stages, axes, hud: postedHud } = body as Partial<SaveBody>;
  let hud: unknown = postedHud;
  if (currentHudText !== undefined) {
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
  const problems = [...stageProblems, ...checkAxes(axes ?? {})];
  if (problems.length) return { ok: false, problems };
  return { ok: true, stagesText: formatStages(stages), axesText: formatAxes(axes ?? {}) };
}

export type PreparedHud = { ok: true; text: string } | { ok: false; problems: string[] };

/** Check a posted HUD layout (the `layout` part of `hud.json`) with the loader's own check and say what would be written. */
export function prepareHudSave(layout: unknown): PreparedHud {
  const problems = checkHudFile({ version: 1, layout });
  if (problems.length) return { ok: false, problems };
  return { ok: true, text: formatHud(layout) };
}
