import { type Mood, resolveMood } from '@cruxgarden/plasma-ui';

// The colors of the glass. PlasmaUI draws its background field and its panels from a "mood": three colors (a deep base, a mid tone and an accent),
// the distance at which panels fuse, and the spring of a drag. A mood is made here from the tokens of tokens.css, so the glass has the same colors as
// every other part of the site, and a change of the profile reaches it through the one token file. No color is written in this file.

/** A function that gives the value of a CSS variable as text (a hex color, for the tokens that the glass reads), or "" when the variable is not set. */
export type TokenReader = (token: string) => string;

/**
 * The three tokens, in the order of the three colors of a mood. The deep base is the navy of the page (`paper`), the mid tone is the lighter navy
 * of a panel (`paper-2`), and the accent slot, where the built-in moods put their one bright color, gets the lavender of the frame (`rule-solid`).
 * Amber (`accent`) is deliberately not here: it marks the one or two focal items of a page, and a field of it would mark everything.
 */
const MOOD_TOKENS = ['--cc-paper', '--cc-paper-2', '--cc-rule-solid'] as const;

/** The name of the built-in mood that is used when the tokens cannot be read. */
const FALLBACK_MOOD = 'ember';

/** The glass takes its colors as hex strings (three or six digits). A color in any other notation (a function such as rgba, or a reference to another variable) cannot be used. */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/;

/**
 * The reader of the real page: the value of a variable on the root element, as the browser computes it. (Custom properties come back as the text
 * that was written, with the white space of the declaration around it, so the mood trims it.)
 */
export function readPageToken(token: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(token);
}

/**
 * The mood of the glass, made from the tokens that `read` gives. Only the colors are ours: the distance at which panels fuse and the spring of a drag
 * are the built-in mood's (see FALLBACK_MOOD). When a token is missing or is not a hex color, the whole built-in mood is used and not a mix, so the
 * glass never shows one token color next to a color that nobody chose.
 */
export function moodFromTokens(read: TokenReader): Mood {
  const base = resolveMood(FALLBACK_MOOD);
  const colors = MOOD_TOKENS.map((token) => read(token).trim().toLowerCase());
  if (!colors.every((color) => HEX_COLOR.test(color))) return base;
  return { ...base, colors: colors as Mood['colors'] };
}
