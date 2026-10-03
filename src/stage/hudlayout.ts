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
  /** The rest of the turns, in order, heroes above the line and enemies below it. */
  chips: PlacedChip[];
}

/** Where the NOW chip, the line and the other chips go in a turn-order box (the design's layout). */
export function timelineLayout(t: HudLayout['turnOrder'], rest: readonly TurnChipView[]): TimelineLayout {
  const ns = t.nowChip;
  const s = t.chip;
  const line = { y: Math.floor(t.h / 2), x0: 24 + ns + 4, x1: t.w - 6 };
  const step = Math.floor((line.x1 - line.x0 - 8) / Math.max(1, rest.length));
  const chips = rest.map((c, i) => {
    const cx = line.x0 + 6 + i * step + Math.floor(s / 2);
    return { ...c, x: cx - Math.floor(s / 2), y: c.side === 'party' ? line.y - s - 1 : line.y + 2 };
  });
  return { now: { x: 24, y: Math.floor((t.h - ns) / 2), size: ns }, line, chips };
}
