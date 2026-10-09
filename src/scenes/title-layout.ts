/**
 * The title screen's composition, as plain data in one place (the editor rule of docs/IDEAS.md: no
 * decision may make a future visual editor harder, so a position is a named value here, never a
 * literal inside draw code). A future title editor would change these values and nothing else.
 *
 * Two spaces are in play. The *world* is the skyline buffer: `BW` by `BHT` world pixels (320x180 at
 * 640x360), drawn at `WORLD_SCALE` (2x) so the skyline keeps the battle's chunky pixel. The *screen*
 * is `W` by `H`: the logo, the prompt, the menu and the key hints are drawn on it at 1x. Every value
 * below says which space it is in.
 *
 * Why these numbers (WP5 of the 640x360 move, docs/PIVOT-640.md, D9): the title was composed for a
 * 240x135 world. At 320x180 the whole picture is re-composed, not stretched: the three city layers
 * stand on base lines 22 rows lower, the sky gradient and the star band keep their share of the
 * height, things on the right edge (the moon, the water tank, the ledge) hang off the right edge
 * `BW`, and the roof ledge sits on the bottom edge `BHT`. Mark confirms the composition at Review 5.
 */
import { BHT, BW } from '../art/worldsize';
import { AREA_SCALE } from '../field/weather';
import { H } from '../engine/game';

// ------------------------------------------------------------------ the world (world pixels)

/** The sky gradient reaches its last color at this share of the height (it was 100 rows of 135). */
export const SKY_FADE_ROWS = Math.round(BHT * 0.74);
/** The stars fill the top of the sky down to this row (a 0.37 share of the height). */
export const STAR_BAND_ROWS = Math.round(BHT * 0.37);
/** Stars per world pixel of the band (40 stars in the 240x50 band the title had), so the sky keeps its sparkle. */
export const STAR_DENSITY = 0.0033;
export const STAR_COUNT = Math.round(BW * STAR_BAND_ROWS * STAR_DENSITY);

/** The moon hangs off the right edge: its center is this far from it, and this far from the top. */
export const MOON = { fromRight: 28, y: 28, halo: 22, radius: 9 };

/** The three city layers: where their buildings stand (the base line), how tall they grow, and how fast they drift. */
export const CITY = {
  far: { seed: 3, base: 120, minH: 30, maxH: 70, speed: 0.03 },
  mid: { seed: 5, base: 134, minH: 22, maxH: 52, speed: 0.08 },
  near: { seed: 9, base: 148, minH: 10, maxH: 30, speed: 0.2 },
};

/**
 * The spire (the Kessler-Mori arcology) stands at this x in the far layer, a 0.625 share of the world
 * width (the 150 of 240 it was). The searchlights start from its tip.
 */
export const SPIRE_X = Math.round(BW * 0.625);
/** Where the searchlights begin on the spire (world y), and how far their beams reach. */
export const SEARCHLIGHT = { y: 6, reach: 200 };

/** The monorail: the top of its car, the rail under it, and how far off screen it runs before it comes back. */
export const MONORAIL = { carY: 101, carW: 90, carH: 5, railY: 106, offscreenRun: 460, startX: -200, speed: 0.9 };
/** Where the monorail's loop wraps: one world width plus its off-screen run, so it comes back as often as it did. */
export const MONORAIL_LOOP = BW + MONORAIL.offscreenRun;

/**
 * The rooftop, hung off the bottom edge and the right edge. `top` is the row of the roof; the ledge
 * on the left carries the crew, the one on the right carries the water tank. Rows are measured from
 * the roof's top, x from the left edge (`x`) or from the right edge (`fromRight`).
 */
export const ROOF = {
  top: BHT - 17,
  leftLedge: { w: 90, h: 4 },
  rightLedge: { fromRight: 40, w: 40, h: 8 },
  tank: { fromRight: 28, rise: 26, w: 16, h: 18, legAt: [2, 12], legW: 2, legH: 8 },
  antenna: { x: 30, rise: 22, h: 18, barX: 27, barRise: 18, barW: 7 },
  crew: [
    { look: 'rook', x: 44 },
    { look: 'kit', x: 60 },
  ] as const,
};

/** Raindrops over the whole picture: the 90 the 240x135 world had, times the area ratio (1.78). */
export const RAIN_DROPS = Math.round(90 * AREA_SCALE);

// ------------------------------------------------------------------ the screen (screen pixels)

/** The logo's pixel size: 4x (Mark's pick at Review 5, D9). */
export const LOGO_SCALE = 4;
/** The logo's top edge, the prompt's row and the menu's top, as shares of the screen height. */
export const LOGO_Y = Math.round(H * 0.14);
export const PROMPT_Y = Math.round(H * 0.65);
export const MENU_Y = Math.round(H * 0.59);
/** The menu panel's width, and the space the key hints keep from the bottom edge. */
export const MENU_W = 110;
export const FOOT_MARGIN = 12;
