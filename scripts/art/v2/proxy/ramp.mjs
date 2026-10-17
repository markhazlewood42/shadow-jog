// Ramp steps and selout letters (path C). Letters a to v are the 22 walk colors sorted dark to light (headtest/lib.mjs), so a letter's position is its luma rank.
// A part has a ramp { shadow, base, lit, outline } of letters (spec.parts[id].ramp). Light level 0 is shadow, 1 base, 2 lit.
//   relightLetter  move one letter by a number of light levels, to the nearest letter of the new level (a transform, not an invention)
//   outlineLetter  the outline letter of a part for a light level: the darker letter on the shadow side, the lighter on the lit side (the card's selout rule)
import { HEX_OF, LETTERS } from '../../headtest/lib.mjs';
import { levelOfLetter } from './spec.mjs';

/** Luma of a palette letter (0.299R + 0.587G + 0.114B). */
export function lumaOfLetter(letter) {
  const h = HEX_OF[letter];
  if (!h) return null;
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
/** Near-black letter: luma under 60 (the spike's rule). */
export const isNearBlackLetter = (letter) => (lumaOfLetter(letter) ?? 255) < 60;
/** Rank of a letter (0 darkest). -1 for '.' or an unknown letter. */
export const letterRank = (letter) => LETTERS.indexOf(letter);

const levelSets = (spec, id) => {
  const r = spec.parts[id].ramp;
  return [r.shadow, r.base, r.lit].map((s) => [...s].sort());
};

/**
 * Relight one letter of a part by `shift` light levels (positive = lighter). The new level is the old level plus the shift, clamped to 0..2 and moved back
 * toward the old level while it holds no letter. The new letter is the one of that level nearest in luma rank (a tie goes to the side of travel).
 * A letter that is not in the ramp levels of the part (an outline letter) does not change.
 */
export function relightLetter(spec, id, letter, shift) {
  if (!shift) return letter;
  const lv = levelOfLetter(spec, id, letter);
  if (lv === null) return letter;
  const sets = levelSets(spec, id);
  let target = Math.max(0, Math.min(2, lv + shift));
  while (target !== lv && sets[target].length === 0) target += target > lv ? -1 : 1;
  if (target === lv) return letter;
  const here = letterRank(letter);
  const dir = target > lv ? 1 : -1;
  let best = null;
  for (const c of sets[target]) {
    const d = Math.abs(letterRank(c) - here);
    const tieWins = best !== null && d === best.d && (letterRank(c) - here) * dir > 0;
    if (best === null || d < best.d || tieWins) best = { c, d };
  }
  return best.c;
}

/** The outline letter of a part for a light level. Throws when the part has no outline letters. */
export function outlineLetter(spec, id, level) {
  const o = [...spec.parts[id].ramp.outline].sort();
  if (!o.length) throw new Error(`part ${id} has no outline letters`);
  const lv = Math.max(0, Math.min(2, level ?? 1));
  return o[Math.floor(((o.length - 1) * lv) / 2)];
}
