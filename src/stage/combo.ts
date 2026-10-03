/**
 * The combo counter's data (spike `spike/phaser-stage`, HUD polish round 3), kept apart from the HUD so a unit test can load it.
 *
 * One list is the single source: every hit the party lands is ONE entry, and both the floating damage number and the counter
 * ("3 HIT 412") are made from that entry. The counter never has a number of its own, it is worked out from the list, so it
 * cannot disagree with the numbers the player saw.
 */

/** One damage number the party raised on an enemy. `target` is the enemy's place in the fight's enemy list. */
export interface ShownHit {
  target: number;
  amount: number;
  crit: boolean;
  weak: boolean;
}

/** What the combo counter prints: how many hits, and the sum of their damage. */
export function comboOf(hits: readonly ShownHit[]): { hits: number; total: number } {
  return { hits: hits.length, total: hits.reduce((sum, h) => sum + h.amount, 0) };
}
