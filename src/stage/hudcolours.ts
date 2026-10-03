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
  red: '#ff5a5a',
  /** The light red a bar and its numbers blink to when health is under a quarter. */
  redLit: '#ffb4b4',
  /** The resource bar's fill (KI, RAM, MANA). */
  resource: '#3aa0e8',
  violet: '#b07cff',
  dim: '#8b8fa8',
  text: '#f4f1ff',
  disabled: '#5d6080',
  foe: '#ff6a6a',
  foeBg: '#2a0f18',
  chipBg: '#12101f',
  barBack: '#241f3a',
  tabBg: '#12112a',
} as const;

/** How much of a panel's opacity its top edge has (its bottom edge has all of it). */
export const SEE_THROUGH_TOP = 0.85;

export const CHIP_PREFIX = 'chip-';

/** What a damage number is tinted by: an ordinary hit is pale, a critical amber, a hit on a weak spot cyan. */
export type HitKind = 'normal' | 'crit' | 'weak';
export const HIT_COLOUR: Readonly<Record<HitKind, string>> = { normal: '#e6ecff', crit: UI.amber, weak: UI.cyan };

/** A critical wins over a weak spot when a hit is both (the number says CRIT; the cyan is for the weak-only hit). */
export function hitKind(crit: boolean, weak: boolean): HitKind {
  return crit ? 'crit' : weak ? 'weak' : 'normal';
}

/** The colour of a health bar for a share of full: green, then amber under half, then red under a quarter. */
export function hpColor(ratio: number): string {
  return ratio > 0.5 ? UI.green : ratio > 0.25 ? UI.amber : UI.red;
}

