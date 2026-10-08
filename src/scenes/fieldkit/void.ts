/**
 * The darkest color of the field, in one place. The void behind a map, the fades of the surround
 * (`fieldkit/surround-art.ts`) and the pop-in curtains (`fieldkit/popins.ts`) all draw with it, so
 * they match. It is a leaf module (it imports nothing), so any of them can use it.
 */
const VOID_RGB = '7,6,13';

/** The void as a fill color (a map's own `voidColor` wins where it has one). */
export const VOID = `rgb(${VOID_RGB})`;

/** The void color at an alpha from 0 (clear) to 1 (solid). */
export const voidShade = (alpha: number | string): string => `rgba(${VOID_RGB},${alpha})`;
