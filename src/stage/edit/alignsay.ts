/**
 * What the Align bar says on the status line (Phaser spike `spike/phaser-stage`), as a pure function so a unit test can
 * check the words. The words follow the FINAL positions (`AcrossResult` in `model.ts`), never the plan: if a fighter did
 * not fit it says so, and if nothing changed it says "No change".
 */
import { ALIGN_GAP, type AcrossResult } from './model';
import { RULE_LIMITS } from '../rules';

/** Every Align choice: sideways, over the rows, or an even spread. */
export type AlignHow = 'left' | 'centre' | 'right' | 'back' | 'middle' | 'front' | 'spreadAcross' | 'spreadDepth';

/** The end of the undo label: "Align Rook to the left edge". */
export const ALIGN_WORDS: Record<AlignHow, string> = {
  left: 'to the left edge',
  centre: 'to the centre',
  right: 'to the right edge',
  back: 'to the back row',
  middle: 'to the middle row',
  front: 'to the front row',
  spreadAcross: 'evenly across',
  spreadDepth: 'evenly over the rows',
};

export interface AlignSayInput {
  how: AlignHow;
  /** Who was aligned: "Rook" or "6 enemies". */
  who: string;
  side: 'party' | 'enemy';
  /** What the model reported; null for the spreads, which have no counts. */
  result: AcrossResult | null;
  /** One fighter lining up sideways with its side's standing range (not with other fighters). */
  acrossOne?: boolean;
}

const sentence = (n: string): string => `${n.charAt(0).toUpperCase()}${n.slice(1)}.`;

/** The status line for an Align of fighters, and whether to show it as a problem. */
export function alignStatus(input: AlignSayInput): { text: string; bad: boolean } {
  const { how, who, side, result: r, acrossOne = false } = input;
  const words = ALIGN_WORDS[how];
  if (!r) return { text: `Aligned ${who} ${words}.`, bad: false };
  // Nothing changed and nobody was left out: say so plainly, and do not report a move that never happened.
  if (r.moved === 0 && r.short === 0) return { text: `No change: ${who} already ${r.total > 1 ? 'stand' : 'stands'} there.`, bad: false };
  const depth = how === 'back' || how === 'middle' || how === 'front';
  // Say what really happened, from the final positions: fighters that share a row cannot share an edge, so they were packed side by side;
  // a block wider than the room is only partly packed; one that slid off an exact same spot is counted too.
  const packedNote: string[] = [];
  if (r.packed && r.short > 0) packedNote.push(`the ${r.packed} that fit were packed side by side in their old left-to-right order, ${ALIGN_GAP} px apart`);
  else if (r.packed) packedNote.push(`${r.packed} of them share ${r.packedRows === 1 ? 'a row' : 'rows'}, so ${r.packedRows === 1 ? 'they were' : 'those on one row were'} packed side by side in their old left-to-right order, ${ALIGN_GAP} px apart, so ${r.packedRows === 1 ? 'they do not' : 'none'} overlap`);
  const otherNote: string[] = [];
  if (r.slid > 0) otherNote.push(`${r.slid} had to slide a pixel or more to stay off another fighter’s spot`);
  if (r.limited) otherNote.push(side === 'party' ? `heroes stay at x ${r.range.r} or less, to keep ${RULE_LIMITS.gap} px between the sides` : `enemies stay at x ${r.range.l} or more, to keep ${RULE_LIMITS.gap} px between the sides`);
  if (depth && r.short > 0) {
    // "3 of 6 moved to the back row; 3 stayed: not enough room."
    const row = words.replace('to the ', '');
    const there = r.total - r.short - r.moved;
    const text = `${r.moved} of ${r.total} moved to the ${row}; ${r.short} stayed: not enough room.${there > 0 ? ` ${there} ${there === 1 ? 'was' : 'were'} already there.` : ''}${otherNote.map((n) => ` ${sentence(n)}`).join('')}`;
    return { text, bad: true };
  }
  const note = [...packedNote, ...otherNote];
  const half = side === 'party' ? (r.limited ? `the heroes’ side of the stage (x 0 to ${r.range.r})` : 'the heroes’ half of the stage') : `the enemies’ side of the stage (x ${r.range.l} to ${r.range.r})`;
  const head = `Aligned ${who} ${words}${acrossOne ? ` of ${half}` : ''}`;
  if (r.short > 0) {
    // "Aligned X to the left edge, but there is not enough room: 3 of 4 fit, ..." when something did not fit.
    return { text: `${head}, but there is not enough room: ${r.fit} of ${r.total} fit, the rest stayed where they were.${note.map((n) => ` ${sentence(n)}`).join('')}`, bad: true };
  }
  return { text: `${head}.${note.map((n) => ` ${sentence(n)}`).join('')}`, bad: false };
}
