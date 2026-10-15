/**
 * The UI kit's numbers and colors in one plain object (principle 11, the editor contract; M8a).
 *
 * The values are the ones the old `src/ui/draw.ts` and `src/ui/list.ts` used, so a window or a list looks the same. Every component takes a
 * partial override of its own section; a tool that edits the look changes this object and nothing else. What stays in code on purpose, because
 * it is the FORM and not a tuning: the shape of the frame (outline, lit frame, scanlines, corner brackets), the glyphs of the cursor.
 */

/** The palette of the game's windows and menus (the old `UI` of `src/ui/draw.ts`). */
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
  violet: '#b07cff',
  dim: '#8b8fa8',
  text: '#f4f1ff',
  select: 'rgba(63,224,240,0.16)',
  disabled: '#5d6080',
} as const;

/** The dim laid over the field behind a full-screen menu (the old `OVERLAY_DIM`). */
export const OVERLAY_DIM_ALPHA = 0.985;
export const OVERLAY_DIM = `rgba(7,6,13,${OVERLAY_DIM_ALPHA})`;

/** The selection highlight as a Graphics fill: the color of `UI.select` and its alpha. */
export const SELECT_FILL = { color: 0x3fe0f0, alpha: 0.16 } as const;

export interface WindowParams {
  /** How solid the body is (0 to 1). The outline and the frame are always solid. */
  alpha: number;
  /** Where the drop shadow sits, in pixels down and right. */
  shadowOffset: number;
  /** The drop shadow's opacity, before `alpha` scales it. */
  shadowAlpha: number;
  /** The scanlines' opacity, before `alpha` scales it. */
  scanAlpha: number;
  /** A frame at least this wide gets the circuit trim (tick marks and the lit trace). */
  trimMinWidth: number;
  /** The distance between two tick marks on the bottom edge. */
  tickStep: number;
}

export interface CursorParams {
  /** How far the chevron nudges sideways, in pixels (the peak of the sine). */
  nudge: number;
  /** The sine's speed, in radians per frame. */
  rate: number;
  /** The "more" arrow is on for this many frames, then off for as many. */
  blinkFrames: number;
}

export interface BarParams {
  /** The empty part's color. */
  back: string;
  /** The opacity of the one-pixel shine on top of the fill. */
  shineAlpha: number;
}

export interface ListParams {
  rows: number;
  cols: number;
  /** The height of one row, in pixels. */
  rowH: number;
  /** The width of the list, in pixels (the old `render` took it per call). */
  width: number;
  /** Frames the locked row's reason flashes after it was pressed. */
  buzzFrames: number;
  /** How far the highlight moves toward the cursor's row each frame (0 to 1). */
  ease: number;
  /** A jump of more rows than this snaps the highlight instead of easing. */
  snapRows: number;
  /** The row colors: the cursor row, the other rows, and the same two while the list is not active. */
  rowColor: string;
  rowColorSelected: string;
  idleColor: string;
  idleColorSelected: string;
}

export interface UiParams {
  window: WindowParams;
  cursor: CursorParams;
  bar: BarParams;
  list: ListParams;
}

/** The defaults. Frozen: copy a section to change it (`{ ...UI_DEFAULTS.window, alpha: 0.8 }`). */
export const UI_DEFAULTS: Readonly<UiParams> = Object.freeze({
  window: Object.freeze({ alpha: 0.95, shadowOffset: 2, shadowAlpha: 0.45, scanAlpha: 0.07, trimMinWidth: 40, tickStep: 16 }),
  cursor: Object.freeze({ nudge: 1.5, rate: 0.18, blinkFrames: 20 }),
  bar: Object.freeze({ back: '#241f3a', shineAlpha: 0.45 }),
  list: Object.freeze({
    rows: 6,
    cols: 1,
    rowH: 11,
    width: 100,
    buzzFrames: 24,
    ease: 0.5,
    snapRows: 2,
    rowColor: '#d0cee4',
    rowColorSelected: UI.text,
    idleColor: '#7d8098',
    idleColorSelected: '#b8bcd0',
  }),
});

/** The color of a health bar at this ratio (the old `hpColor`). */
export function hpColor(ratio: number): string {
  if (ratio > 0.5) return UI.green;
  if (ratio > 0.25) return UI.amber;
  return UI.red;
}

/** The key reminder for a menu screen, in the player's own bindings: '{c}X{/} back' (the old `keyLegend`; any object with `keyName` fits). */
export function keyLegend(keys: { keyName(action: 'confirm' | 'cancel'): string }, back = 'back', ok?: string): string {
  const b = `{c}${keys.keyName('cancel')}{/} ${back}`;
  return ok ? `{c}${keys.keyName('confirm')}{/} ${ok}   ${b}` : b;
}
