/**
 * The ONE source of the logical resolution (docs/engine/frame-and-rendering.md section 5).
 *
 * Every renderer, the presenter, the editors and every mixed-grain layer import `W` and `H` from
 * here. No other code may write a number that means "the screen width, height or center": to try
 * another size, change this file only. `tests/screen-literals.test.ts` enforces this. (Godot calls
 * this the base resolution.)
 *
 * The old engine (`src/engine/game.ts`) re-exports `W` and `H` from here, so the shipped game and
 * the new engine can never disagree about the picture size.
 *
 * There is no size switch. The spike had a DEV `?size=` mock; the 640x360 move (PR #23) made it
 * obsolete, so a shipped build, a dev build and a test all have the one size below.
 */

/** The picture width in game pixels. @ours (not a Phaser concept; Phaser takes the size in its config) */
export const W = 640;
/** The picture height in game pixels. @ours */
export const H = 360;
export const FPS = 60;
/** One simulation tick in milliseconds (1000 / 60). A "tick" is one fixed step; a "frame" is one drawn picture. */
export const TICK_MS = 1000 / FPS;

/** The size of a coarser layer: grain 2 is 320x180, shown at 2x in the 640x360 grid. @ours */
export const grain = (n: 1 | 2 | 4): { w: number; h: number } => ({ w: W / n, h: H / n });
