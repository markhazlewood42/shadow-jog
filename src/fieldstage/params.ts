/**
 * The field stage's layer table and the few numbers its drawing needs (M5 task 5). Every layer is a direct child of the scene's `world`; `depth` is the draw order,
 * the same order as the old `FieldScene.render` (src/scenes/field.ts), top to bottom of that function. A number here is a place in that order, not a look value:
 * the look lives in the baked layers, the map data, the old painters, which the stage calls unchanged, and `src/data/fieldlook.json` (shadow, glow, haze, chest halo and glint,
 * the flicker of a failing tube, the sprite boost).
 *
 * "Pinned" means the picture is screen-sized and is moved with the camera each frame, so it stays on the screen while the world scrolls under it. The old field drew
 * these straight onto the screen (the surround, the lit animations, the light map, the unlit animations, the haze, the dust and weather).
 */
export const LAYER = {
  /** Pinned. What shows around a map smaller than the view (src/scenes/fieldkit/surround.ts), or the void behind a map's edge. */
  SURROUND: 0,
  /** The baked ground. */
  GROUND: 10,
  /** Pinned. The animations that are lit by the light map (`AnimFx.lit`: lures, steam, cryopods, water). */
  LIT_ANIMS: 20,
  /** The soft contact shadows under the actors, drawn before the light map so the room's light dims them too. */
  SHADOWS: 25,
  /** Pinned. The light map, shown with a multiply blend over everything above (the surround, the ground, the lit animations, the shadows). */
  LIGHT: 30,
  /** The baked emissive layer: neon, lamps, lit windows. Drawn after the light map, so the dark does not touch it. */
  EMIT: 40,
  /** Pinned. The animations that are not lit (lasers, binding circles, windows, antennas). */
  UNLIT_ANIMS: 50,
  /** The y-sorted container: the props, the chests and the actors (`Container.ySort`). */
  SORT: 60,
  /** The overhead layer (lantern strings), lit part by part. */
  OVER: 70,
  /** The overhead layer's emissive half. */
  OVER_EMIT: 80,
  /** Pinned, additive. The haze around the bright lights. */
  BLOOM: 90,
  /** Pinned. The screen-fixed layer the field paints with its old painters: dust, weather, curtains, emotes, cue, banner, objective, overlay. */
  SCREEN: 100,
} as const;

/**
 * How far past a prop's picture its own animation may draw, on every side, in pixels. The widest is the stall's steam, which rises 8 px above the stall; the others stay
 * inside the picture. The animation gets a canvas this much bigger than the prop's, so a painter that draws a little outside never loses a pixel.
 */
export const ANIM_MARGIN = 16;
