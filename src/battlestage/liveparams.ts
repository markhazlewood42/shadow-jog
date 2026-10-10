/**
 * Every look number of the LIVE battle on the stage (M3 task 6) in one place, so no tuned value hides in the code that uses it (docs/engine/m3-brief.md section 5,
 * the editor contract; the same idea as `src/sje/fx/fxparams.ts`). The stage's own layout is data (`src/data/stages.json`, `hud.json`); these are the numbers of the
 * live presentation that have no data file yet: how a hit looks on a figure, how a floating number moves. They are the old battle's values (`battlekit/geom.ts`,
 * `battlekit/render.ts`) or the Phaser spike's, copied as they were. Mark's look review changes them here.
 */

/** How strongly an enemy's picture flashes white on the blinking frames of a hit (`flashTexture` strength, 0 to 1; the old picture blended 0.55 of white). */
export const HIT_FLASH = 0.5;
/** How strongly a hero's picture is washed red on the blinking frames of a hit (`tintTexture` strength, 0 to 1; the old picture blended 0.45 of red). */
export const HERO_HIT_TINT = 0.5;
/** The fog and its strength over a hero who is down (the spike's "downStill" look: the picture sinks into the floor's dark blue). */
export const DOWN_FOG = '#1a1d33';
export const DOWN_FOG_AMOUNT = 0.55;
/** How see-through a hero who is down is. */
export const DOWN_ALPHA = 0.7;

/** The on-stage health bar of an enemy: the colours at more than half, more than a quarter, and under. */
export const BAR_COLOURS = { high: 0x62e06a, mid: 0xffcc3d, low: 0xff5a5a, back: 0x241f3a, outline: 0x07060d } as const;
/** The lit top line of a bar. */
export const BAR_SHINE_ALPHA = 0.45;

/** The depth the effects layer draws at: over every figure (their numbers stay under 300,000) and under the labels (`DEPTH.MARKS`). */
export const FX_DEPTH = 500_000;
/** The depth of the defeat wash in the scene's `ui` layer: over the stage, under the HUD (`HUD_DEPTH`). */
export const WASH_DEPTH = 1_900_000;
/** The colour of the defeat wash and the share of it at full (the old picture: rgba(36,0,10) up to 0.62 over 70 frames). */
export const WASH = { color: 0x24000a, max: 0.62, frames: 70 } as const;

/** The floating numbers: the old battle's pop, hold, drift, bounce and fade, in world pixels and frames (`battlekit/geom.ts` has the same names). */
export const NUMBER_SCALE = 2;
/** The drop shadow colour of a floating number. */
export const NUMBER_SHADOW = '#0a0913';
/** The prefix of a floating number's textures: the HUD's own clean-up leaves them alone, the live layer prunes them. */
export const NUMBER_PREFIX = 'num-';
