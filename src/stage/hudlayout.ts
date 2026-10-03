/**
 * The HUD's layout rules as pure functions (spike `spike/phaser-stage`): when a region shows, and where the
 * chips of the turn timeline go. They live apart from `hud.ts`, which draws with Phaser, so a unit test can
 * check them without a browser (and an editor can show the same numbers as overlays).
 */
import type { HudRegion, HudLayout } from './config';
import type { Phase, TurnChipView } from './demo';

export type RegionName = 'turnOrder' | 'commands' | 'partyStatus' | 'enemyInfo' | 'banner' | 'combo';

/**
 * Whether a region is shown in a phase of the turn. `always` and `never` mean what they say. `input` is "while
 * the player is choosing", and `action` is "while an action plays"; two regions read them a little wider, as in
 * the design's mockups: the enemy box stays up while an action plays (it then shows the target's details), and
 * the banner also shows its prompt while a target is being picked.
 */
export function isShown(region: RegionName, show: HudRegion['show'], phase: Phase): boolean {
  if (show === 'never') return false;
  if (show === 'always') return true;
  if (show === 'input') return region === 'enemyInfo' ? true : phase !== 'act';
  return region === 'banner' ? phase !== 'choose' : phase === 'act';
}

/** One chip of the timeline: who it is and where its top-left corner goes, in the timeline box's own pixels. */
export interface PlacedChip extends TurnChipView {
  x: number;
  y: number;
}

export interface TimelineLayout {
  /** The "NOW" chip's top-left corner and size. */
  now: { x: number; y: number; size: number };
  /** The timeline: a horizontal line with an arrow head at its right end. */
  line: { y: number; x0: number; x1: number };
  /** The rest of this round's turns, in order, heroes above the line and enemies below it. The first is the one who acts next. */
  chips: PlacedChip[];
  /**
   * The round after this one, as a preview: where the order starts again (the NOW hero's chip first), drawn dim after `roundMark`.
   * Empty when the box is too narrow to have room for any. It fills the track that would otherwise stay bare.
   */
  later: PlacedChip[];
  /** The x of the little tick that says "the next round starts here", or null when there are no later chips. */
  roundMark: number | null;
  /** The steps between neighbouring chips, left to right. */
  pitch: number;
}

/** The most pixels between two chips' left edges (a chip and four). */
const PITCH_GAP = 4;

/**
 * Where the NOW chip, the line and the other chips go in a turn-order box (the design's layout). The chips sit one
 * `pitch` apart (a chip and a gap, less when there are so many that they would not fit); after the last of this
 * round's comes a round tick and then the next round's order again, dim, as far as the track allows, so the whole
 * track says something instead of the last third being a bare line. `now` is the NOW chip's own turn, repeated
 * first in that preview (it acts first again).
 */
export function timelineLayout(t: HudLayout['turnOrder'], rest: readonly TurnChipView[], now?: TurnChipView): TimelineLayout {
  const ns = t.nowChip;
  const s = t.chip;
  const line = { y: Math.floor(t.h / 2), x0: 24 + ns + 4, x1: t.w - 6 };
  const span = line.x1 - line.x0 - 8;
  const pitch = rest.length === 0 ? s + PITCH_GAP : Math.max(1, Math.min(s + PITCH_GAP, Math.floor(span / rest.length)));
  const left = line.x0 + 6;
  const put = (c: TurnChipView, x: number): PlacedChip => ({ ...c, x, y: c.side === 'party' ? line.y - s - 1 : line.y + 2 });
  const chips = rest.map((c, i) => put(c, left + i * pitch));
  const lastRight = rest.length ? left + (rest.length - 1) * pitch + s : left - 3;
  const roundMark = now ? lastRight + 3 : null;
  const cycle = now ? [now, ...rest] : [];
  const later: PlacedChip[] = [];
  if (roundMark !== null) {
    for (let j = 0; j < cycle.length; j++) {
      const x = roundMark + 5 + j * pitch;
      if (x + s > line.x1) break;
      later.push(put(cycle[j] as TurnChipView, x));
    }
  }
  return { now: { x: 24, y: Math.floor((t.h - ns) / 2), size: ns }, line, chips, later, roundMark: later.length ? roundMark : null, pitch };
}

// ------------------------------------------------------------------ the bottom band

/** A frame the HUD draws behind several boxes at once: the unified bottom band. */
export interface BandPlan {
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  /** Which boxes stand on it, left to right. */
  members: RegionName[];
  /** Where the thin dividers between the boxes go, as x in screen pixels. */
  dividers: number[];
}

/** The most pixels between two boxes that still count as one band (the shipped boxes are 4 apart). */
const BAND_GAP = 8;

/**
 * Which boxes share one frame. The party table, the command strip and the enemy box sit side by side along the bottom, and
 * drawn as three separate windows the stage showed through the gaps and the command strip left a hole when it hid. So boxes
 * on the same row (same top and height), no more than `BAND_GAP` pixels apart, are framed as ONE window with a divider in
 * each gap. A box set to "never" is not part of any band, so hiding one by hand still works. The boxes' own x, y, w and h stay what the editor edits; this only decides how they are framed.
 */
export function bandPlans(hud: HudLayout): BandPlan[] {
  const names: RegionName[] = ['partyStatus', 'commands', 'enemyInfo'];
  const boxes = names.filter((n) => hud[n].show !== 'never').map((n) => ({ n, r: hud[n] }));
  // Boxes on the same row (same top and height), left to right; a box on another row (a menu floating above the band) is not in the way.
  boxes.sort((a, b) => a.r.y - b.r.y || a.r.h - b.r.h || a.r.x - b.r.x);
  const plans: BandPlan[] = [];
  let chain: typeof boxes = [];
  const flush = (): void => {
    const first = chain[0];
    const last = chain[chain.length - 1];
    if (first && last && chain.length >= 2) {
      plans.push({
        x: first.r.x,
        y: first.r.y,
        w: last.r.x + last.r.w - first.r.x,
        h: first.r.h,
        opacity: first.r.opacity ?? 1,
        members: chain.map((c) => c.n),
        dividers: chain.slice(1).map((c, i) => {
          const prev = chain[i];
          const edge = (prev?.r.x ?? 0) + (prev?.r.w ?? 0);
          return edge + Math.floor((c.r.x - edge) / 2);
        }),
      });
    }
    chain = [];
  };
  for (const b of boxes) {
    const prev = chain[chain.length - 1];
    const gap = prev ? b.r.x - (prev.r.x + prev.r.w) : 0;
    if (prev && !(prev.r.y === b.r.y && prev.r.h === b.r.h && gap >= 0 && gap <= BAND_GAP)) flush();
    chain.push(b);
  }
  flush();
  return plans;
}

/** How the enemy box lays out its foes: one big read-out, a list with a row each, or two short columns. */
export interface FoeLayout {
  mode: 'detail' | 'list' | 'grid';
  /** Pixels per row (list and grid). */
  rowH: number;
  /** Rows per column (grid) or in all (list). */
  rows: number;
}

/** Size the enemy box to what is in it: a lone foe gets the detail read-out, two to four a list that spreads over the box, five or six two columns. */
export function foeLayout(count: number, boxH: number): FoeLayout {
  if (count <= 1) return { mode: 'detail', rowH: boxH, rows: 1 };
  if (count <= 4) return { mode: 'list', rowH: Math.min(11, Math.floor((boxH - 4) / count)), rows: count };
  return { mode: 'grid', rowH: Math.min(11, Math.floor((boxH - 4) / Math.ceil(count / 2))), rows: Math.ceil(count / 2) };
}

/** An enemy's name as the HUD prints it: the data has a few in capitals (WARDEN), which print as Warden so every row reads the same. */
export function foeName(name: string): string {
  if (!/[A-Z]{2,}/.test(name) || name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|\s)([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
}

/** Where the aimed-at enemy's name tab goes: above the sprite, or beside it when there is no room above. */
export interface TabPlace {
  x: number;
  y: number;
  side: 'above' | 'right' | 'left';
}

/**
 * Place the name tab (`w` wide, 9 tall plus its 1 px outline) for a foe whose drawn pixels span `left` to `right` and start at
 * `top`, on a screen `screenW` wide with the timeline and banner taking everything above `topClear`. ABOVE the head when the
 * tab and its pointer fit under `topClear`; otherwise BESIDE the sprite (right of its widest edge, else left), at `topClear`, so
 * it never covers the face. The `x` is the tab's left edge.
 */
export function targetTab(f: { x: number; top: number; left: number; right: number }, w: number, screenW: number, topClear: number): TabPlace {
  const above = f.top - 14;
  if (above >= topClear) return { x: Math.max(4, Math.min(screenW - 4 - w, f.x - Math.floor(w / 2))), y: above, side: 'above' };
  if (screenW - 4 - (f.right + 8) >= w) return { x: f.right + 8, y: topClear, side: 'right' };
  return { x: Math.max(4, f.left - 8 - w), y: topClear, side: 'left' };
}

/** The size of a foe's health bar on the stage: the stage's own for an ordinary foe, a wide taller one (96 x 4) for a boss, the one bar in the fight that matters most. */
export function stageBarSize(boss: boolean, spec: { w: number; h: number }): { w: number; h: number } {
  return boss ? { w: Math.max(96, spec.w), h: Math.max(4, spec.h) } : { w: spec.w, h: spec.h };
}
