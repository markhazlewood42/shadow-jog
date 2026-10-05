/**
 * The ONE source of the logical resolution (docs/engine/frame-and-rendering.md section 5).
 *
 * Every renderer, the presenter, the editors and every mixed-grain layer import `W` and `H` from
 * here. No other code may write a number that means "the screen width, height or centre": to try
 * 640x360, change this file only. (Godot calls this the base resolution.)
 *
 * The old engine (`src/engine/game.ts`) re-exports `W` and `H` from here, so the shipped game and
 * the new engine can never disagree about the picture size.
 *
 * THE DEV SIZE SWITCH (step B3, the resolution mock; decision E12). In a DEV build only, the page's
 * address can ask for the other candidate size: `?size=640x360`. It is read ONCE, when this module
 * first loads (so one page shows one size for its whole life: changing the size means loading the
 * page again). Nothing is re-laid out for it. It is a mock: it shows the art and the text unchanged
 * at the other size, so Mark can judge sprite size, text size and how much world shows.
 *
 * Why it cannot reach players: Vite replaces `import.meta.env.DEV` with the plain value `false` in a production
 * build. The query reading below is then dead code and the minifier deletes it, so a shipped build still has
 * `W = 480` and `H = 270` and nothing else. `node scripts/prod-bytes.mjs` builds the game with and without this
 * switch and compares every file; e2e/sjemock.spec.ts checks the shipped bundle for the switch's name.
 */

/**
 * True when a DEV build was opened with `?size=640x360`. Only that one value counts; anything else asked for in the address is ignored.
 * `location` is missing in Node (the unit tests), where the shipped size is right. In a production build `import.meta.env.DEV` is the
 * plain value `false`, so this whole line is the constant `false` and the minifier folds the two choices below to 480 and 270.
 * (It is written as two plain choices, not a pair read from an array, so the minifier can fold it: an array would stop `W` and `H`
 * from being plain numbers in the bundle, and the shipped bundle would change.)
 */
const DEV_640X360 = import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('size') === '640x360';

export const W: number = DEV_640X360 ? 640 : 480;
export const H: number = DEV_640X360 ? 360 : 270;
export const FPS = 60;
/** One simulation tick in milliseconds (1000 / 60). A "tick" is one fixed step; a "frame" is one drawn picture. */
export const TICK_MS = 1000 / FPS;

/** The size of a coarser layer: grain 2 is 240x135, shown at 2x in the 480x270 grid. @ours */
export const grain = (n: 1 | 2 | 4): { w: number; h: number } => ({ w: W / n, h: H / n });
