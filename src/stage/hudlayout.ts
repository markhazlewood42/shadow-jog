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

/** The pixels between the top of the timeline box and the top of the heroes' chips. */
const TOP_MARGIN = 2;
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
  // The line sits one chip and a pixel under the box's top margin (y 17 for the shipped 14 px chips), whatever the box's height: the
  // rows under it hold the foes' chips and, under those, the A/B letter tags, so the extra height goes to the bottom.
  const line = { y: TOP_MARGIN + s + 1, x0: 24 + ns + 4, x1: t.w - 6 };
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
  return { now: { x: 24, y: line.y - Math.floor(ns / 2), size: ns }, line, chips, later, roundMark: later.length ? roundMark : null, pitch };
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
  return { mode: 'grid', rowH: Math.min(12, Math.floor((boxH - 4) / Math.ceil(count / 2))), rows: Math.ceil(count / 2) };
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

// ------------------------------------------------------------------ floating damage numbers

/** The highest a floating number's block may start: just under the timeline (it ends at y 45) and the skill banner (y 46 to 58, its shadow to 60), with room for the word over the digits. */
export const NUMBER_FLOOR = 66;
/** The height the CRIT or WEAK word takes over its number (5 px of letters, a dark outline and a clear pixel). */
export const NUMBER_LABEL_H = 10;

/** A number's block on the screen: the middle of it, its top, and its size (the word over the digits is part of it). */
export interface NumberRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a damage number's block stands: above the head, or BESIDE the sprite when the head is too high up for it. */
export interface NumberSpot {
  /** The middle of the block. */
  x: number;
  /** The top of the block (the CRIT or WEAK word's top when it has one). */
  y: number;
  side: 'above' | 'right' | 'left';
}

/**
 * Place a damage number's block `w` wide and `h` tall (the word if any, the digits and their outline) for a figure whose drawn pixels
 * span `left` to `right` and begin at `top`, and whose feet are at `y`. It is worked out from the SPRITE'S OWN BOUNDS so it never lands
 * on the brightest part of a big target (the white Warden's head and face): ABOVE the head, a little to the far side of its middle,
 * when there is room under `floor`; otherwise BESIDE the sprite (right of its widest edge when there is room, else left), level with
 * the head. `taken` is the blocks of this target's numbers that are still showing: the first place that overlaps none of them wins,
 * so a second hit stacks up above the first or down the side, and a long run (five blows on one big target) starts a second column
 * further out instead of piling up. Pure, so a test can check it against every figure's bounds.
 */
export function numberSpot(f: { x: number; y: number; top: number; left: number; right: number }, w: number, h: number, o: { floor: number; screenW: number; gap?: number; farSide?: boolean; taken?: readonly NumberRect[] }): NumberSpot {
  const gap = o.gap ?? 6;
  const half = Math.ceil(w / 2);
  const maxBottom = f.y - 8;
  const clampX = (x: number): number => Math.max(half + 4, Math.min(o.screenW - half - 4, x));
  const tries: NumberSpot[] = [];
  const aboveTop = f.top - h - gap;
  if (aboveTop >= o.floor) {
    const x = clampX(f.x + (o.farSide ? 10 : 0));
    for (let y = aboveTop; y >= o.floor; y -= h + 2) tries.push({ x, y, side: 'above' });
  }
  const rightRoom = o.screenW - 4 - (f.right + 4) >= w;
  for (const side of rightRoom ? (['right', 'left'] as const) : (['left', 'right'] as const)) {
    for (let col = 0; col < 3; col++) {
      const x = side === 'right' ? f.right + 4 + half + col * (w + 4) : f.left - 4 - half - col * (w + 4);
      if (x - half < 4 || x + half > o.screenW - 4) break;
      for (let y = Math.max(o.floor, f.top + 2); y + h <= maxBottom; y += h + 2) tries.push({ x, y, side });
    }
  }
  const taken = o.taken ?? [];
  const free = (t: NumberSpot): boolean => !taken.some((r) => Math.abs(r.x - t.x) < (r.w + w) / 2 + 1 && t.y < r.y + r.h + 1 && t.y + h + 1 > r.y);
  return tries.find(free) ?? tries[0] ?? { x: clampX(f.x), y: Math.max(o.floor, Math.min(maxBottom - h, f.top)), side: 'above' };
}

// ------------------------------------------------------------------ the foe list's columns

/** The columns of the foe list, in the enemy box's own pixels. Fixed by the box's width alone, so they hold for every encounter. */
export interface FoeColumns {
  /** A row's portrait (8 px square) and where the name starts. */
  faceX: number;
  nameX: number;
  /** The widest a name may be before it is clipped (a duplicate's A/B letter is kept). */
  nameW: number;
  /** The health bar: its left edge and length, the same on every row. */
  barX: number;
  barW: number;
  /** Where the right-aligned health number ends, and the room it has (four digits). */
  hpRight: number;
  hpW: number;
}

/** The pixels a four-digit health number takes in the game's font, with a little to spare. */
export const FOE_HP_W = 19;

/**
 * The foe list's columns for a list of two to four foes (one column of rows): face, name, one bar column, one health column. They
 * come from the box's width and nothing else, NOT from the longest name or number in the fight, so the bar is the same length for a
 * punk, a boss and two helpers, or a lone rat (a lone foe has its own read-out, and five or six foes use `foeGrid`). The health
 * column shows the CURRENT health only (the bar says how much of the whole it is; the aimed foe's details show both).
 */
export function foeColumns(boxW: number): FoeColumns {
  const hpRight = boxW - 6;
  const barW = Math.max(24, Math.min(30, Math.floor((boxW - 100) * 0.7)));
  const barX = hpRight - FOE_HP_W - 4 - barW;
  const nameX = 17;
  return { faceX: 4, nameX, nameW: barX - 4 - nameX, barX, barW, hpRight, hpW: FOE_HP_W };
}

/**
 * The layout of one of the two halves of a five or six foe grid (each half is `colW` wide): a portrait at the left, and to its right
 * the name over a bar as wide as the name's room, so a long name keeps most of its letters and the bar is never a stub.
 */
export function foeGrid(colW: number): { faceX: number; nameX: number; nameW: number; barX: number; barW: number; barDy: number } {
  const nameW = colW - 13 - 4;
  return { faceX: 2, nameX: 13, nameW, barX: 13, barW: nameW, barDy: 7 };
}
