/**
 * Named depth bands: one file names the ranges so no scene writes a magic number
 * (docs/engine/scene-graph.md section 4). Follows: Unity Sorting Layers and Order in Layer. @ours
 *
 * `depth` is a plain number. A HIGHER number draws LATER (on top). This is Phaser's rule, and it
 * maps to Pixi `zIndex`. The values come from the Phaser spike where the spike has them.
 */
export const DEPTH = {
  /** Sky, wall, floor art. */
  BACKDROP: -1,
  /** Figures start at 0 and run up to (but not including) 300,000. See `depthFor`. */
  ACTORS: 0,
  /** Editor guides. */
  GUIDE: 900_000,
  /** Active tag, target label, damage numbers. */
  MARKS: 1_000_000,
  /** HUD windows, in a scene's `ui` container. */
  HUD: 2_000_000,
} as const;
// Not named yet: `floor` (set at M3) and `fx` (set at M2). Overlay (fade, flash, notice) is not a depth:
// it is its own root, `overlayRoot`.

/**
 * The depth of a figure that stands at `y` on the ground (the spike's formula):
 * `y*1000 + closeness*2 + side + order*1000`. A lower figure on the screen draws over a higher one.
 */
export function depthFor(y: number, closeness = 0, side = 0, order = 0): number {
  return y * 1000 + closeness * 2 + side + order * 1000;
}

/** Offsets of the parts of one figure, drawn inside its sorting group (the spike's PART values). */
export const PART = { SHADOW: -0.5, RING: -0.4, BODY: 0, SMEAR: 0.1, BAR: 0.25 } as const;
