/**
 * The HUD's colours and the small rules that pick one (spike `spike/phaser-stage`), kept apart from `hudkit.ts` because that file
 * makes Phaser textures and so cannot be loaded by a unit test; everything here is plain data and arithmetic.
 */

/** The game's UI colours (from `drawWindow` and the HUD mockups). */
export const UI = {
  outline: '#07060d',
  frame: '#4a4f86',
  frameLit: '#7a80c4',
  fillTop: '#1c1a3a',
  fillBot: '#0d0c1f',
  inner: '#2c2a58',
  cyan: '#3fe0f0',
  pink: '#ff4fb0',
  amber: '#ffcc3d',
  green: '#62e06a',
  red: '#ff6b6b',
  /** The light red a bar and its numbers blink to when health is under a quarter. */
  redLit: '#ffb4b4',
  /** The dark red a low-health bar falls back to in the other half of its blink (clearly NOT a healthy-looking full bar). */
  redDark: '#7a1f30',
  /** The resource bar's fill (KI, RAM, MANA). */
  resource: '#3aa0e8',
  violet: '#b07cff',
  /** Secondary text (hints, resource labels, unfocused command codes): about 70% white with a lavender cast, readable at a glance. */
  dim: '#bfc3e4',
  /** A quieter step still, for text that is standing by (the command codes while an action plays). */
  soft: '#8f94bd',
  text: '#f4f1ff',
  /** Text that is out of play (a downed hero's name, the dash for no resource), still above 4:1 on the navy. */
  disabled: '#7a7ea4',
  foe: '#ff6a6a',
  foeBg: '#4a1a2a',
  chipBg: '#12101f',
  barBack: '#241f3a',
  tabBg: '#12112a',
} as const;

/** How much of a panel's opacity its top edge has (its bottom edge has all of it). */
export const SEE_THROUGH_TOP = 0.85;

export const CHIP_PREFIX = 'chip-';

/** What a damage number is tinted by: an ordinary hit is orange (a fill that stays apart from the white Warden), a critical amber, a hit on a weak spot cyan. */
export type HitKind = 'normal' | 'crit' | 'weak';
export const HIT_COLOUR: Readonly<Record<HitKind, string>> = { normal: '#ff7a45', crit: UI.amber, weak: UI.cyan };

/** How big a damage number is drawn, as a whole-number magnification of the 5 px glyphs: 3x for an ordinary hit, 4x for a critical or a weak spot. */
export function numberScale(kind: HitKind): number {
  return kind === 'normal' ? 3 : 4;
}

/** A critical wins over a weak spot when a hit is both (the number says CRIT; the cyan is for the weak-only hit). */
export function hitKind(crit: boolean, weak: boolean): HitKind {
  return crit ? 'crit' : weak ? 'weak' : 'normal';
}

/** The colour of a health bar for a share of full: green, then amber under half, then red under a quarter. */
export function hpColor(ratio: number): string {
  return ratio > 0.5 ? UI.green : ratio > 0.25 ? UI.amber : UI.red;
}

