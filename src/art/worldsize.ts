/**
 * The battle world's size, defined once. This is a leaf module: it imports only the screen size
 * (`W` and `H`, engine/game.ts), so both the backdrops (`art/battlebg.ts`) and the battle scene
 * kit (`scenes/battlekit/geom.ts`, which re-exports these names) can import it without `art`
 * reaching up into `scenes`. The new engine's size module takes all of this over at M0
 * (`grain(2)`).
 */
import { H, W } from '../engine/game';

/**
 * Screen pixels per world pixel. The battle world (and the title's skyline, which shares this
 * grain) is drawn at half the screen size and then scaled up by this factor, so its art keeps one
 * chunky pixel size whatever the screen is. Every place that converts a world coordinate to a
 * screen coordinate multiplies by this constant, never by a bare 2: if the world layer and the
 * enemy layer ever used different factors, sprites, hit sparks and HP bars would drift apart
 * silently.
 */
export const WORLD_SCALE = 2;
/** The battle world's size in world pixels: the screen divided by `WORLD_SCALE` (240x135 on a 480x270 screen). */
export const BW = W / WORLD_SCALE, BHT = H / WORLD_SCALE;
