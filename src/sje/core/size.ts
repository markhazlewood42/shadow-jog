/**
 * The ONE source of the logical resolution (docs/engine/frame-and-rendering.md section 5).
 *
 * Every renderer, the presenter, the editors and every mixed-grain layer import `W` and `H` from
 * here. No other code may write a number that means "the screen width, height or centre": to try
 * 640x360, change this file only. (Godot calls this the base resolution.)
 *
 * The old engine (`src/engine/game.ts`) re-exports `W` and `H` from here, so the shipped game and
 * the new engine can never disagree about the picture size.
 */
export const W = 480;
export const H = 270;
export const FPS = 60;
/** One simulation tick in milliseconds (1000 / 60). A "tick" is one fixed step; a "frame" is one drawn picture. */
export const TICK_MS = 1000 / FPS;

/** The size of a coarser layer: grain 2 is 240x135, shown at 2x in the 480x270 grid. @ours */
export const grain = (n: 1 | 2 | 4): { w: number; h: number } => ({ w: W / n, h: H / n });
