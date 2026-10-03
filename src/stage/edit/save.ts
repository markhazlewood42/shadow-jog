/**
 * Checking and formatting what the Battle Stage Editor saves (Phaser spike `spike/phaser-stage`).
 *
 * This is the rule "everything saves to a data file the game reads, validated by the module the game loads it
 * with" (`docs/TOOLING-UI.md` 1.5 and 2.5), as a pure function: the dev server's save endpoint (`vite.config.ts`
 * `stageEdit`) calls `prepareSave` with the posted body, and the editor page calls it too, so Save can refuse a
 * bad file before it ever leaves the browser, with exactly the same words the server would use.
 *
 * Two files are saved together: `src/data/stages.json` (the stages) and `src/data/axes.json` (foot-anchor
 * corrections per sprite). They are checked as a pair and written only if both are fine, so a refused save never
 * leaves one file changed and the other not.
 */
import { BG_IDS } from '../../art/battlebg';
import { formatJson } from '../../tools/jsonfmt';
import { checkAxes, checkStages } from '../config';
import { STAGE_KNOWN } from '../known';

export interface SaveBody {
  stages: unknown;
  axes: unknown;
}

export type Prepared = { ok: true; stagesText: string; axesText: string } | { ok: false; problems: string[] };

/** Where each file lives, for messages. */
export const STAGES_FILE = 'src/data/stages.json';
export const AXES_FILE = 'src/data/axes.json';

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

/** Check a posted body and, when it is fine, say exactly what would be written. */
export function prepareSave(body: unknown): Prepared {
  if (typeof body !== 'object' || body === null) return { ok: false, problems: ['the posted body must be an object with stages and axes'] };
  const { stages, axes } = body as Partial<SaveBody>;
  const problems = [...checkStages(stages, BG_IDS, STAGE_KNOWN), ...checkAxes(axes ?? {})];
  if (problems.length) return { ok: false, problems };
  return { ok: true, stagesText: formatStages(stages), axesText: formatAxes(axes ?? {}) };
}
