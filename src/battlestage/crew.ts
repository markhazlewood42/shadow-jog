/**
 * Which crew members have a Sprite Fusion sheet, and where it lives (Phaser spike, `spike/phaser-stage`).
 * Pure data, no Phaser, so the stage config's checker and its tests can use the list.
 *
 * WHO stands in which party slot is not decided here but in the stage config (`lineup` in
 * `src/data/stages.json`), so an editor can reorder the party without touching the asset pipeline.
 */

/** Crew id -> the folder under `public/art/crew/` (served at `/art/crew/`) that holds that member's idle loop. */
export const CREW_SHEETS: Readonly<Record<string, string>> = {
  hex: 'hex/idle',
  sable: 'sable/idle',
  rook: 'rook/idle',
  kit: 'kit/idle',
};

/** The ids of every crew member that has a sheet. */
export const CREW_IDS: readonly string[] = Object.keys(CREW_SHEETS);

/** A crew member's sheet folder, or a readable error for an id with none. */
export function sheetFolder(id: string): string {
  const folder = CREW_SHEETS[id];
  if (!folder) throw new Error(`No sprite sheet is known for crew member "${id}" (known: ${CREW_IDS.join(', ')})`);
  return folder;
}
