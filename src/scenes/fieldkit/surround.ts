/**
 * What surrounds a map that is smaller than the screen (decision D7 of docs/PIVOT-640.md).
 *
 * At 640x360 the camera shows 1.78 times the old area, so eleven maps no longer fill the screen:
 * the Rustyard is 96 px narrower than the view, Loading Dock 7 is 320 px narrower and 136 px
 * shorter, and the nine interiors are 224 to 352 px wide. The camera centers such a map
 * (`fieldkit/camera.ts`), and the strip around it is "the surround". Mark's rule (Review 3,
 * 2026-10-08, "indoor areas blank fill (b1), outdoor areas themed (b2)"):
 *
 * - **b1**, an edge fill, for an indoor map: the map's own outermost row of tiles is repeated
 *   outward, and a dark fade takes it to black, so the room seems to go on past its edge.
 * - **b2**, a themed surround, for an outdoor map: something drawn in code that fits the place.
 *   Which one is the entry's `theme`: a corrugated fence and scrap ground for the Rustyard, a quay
 *   edge over black water for the Dock.
 *
 * A map with no entry here is not smaller than the view: it fills the screen, and the field draws
 * the plain void behind it (the base case below). Option c (make the map bigger) is a change to
 * map data, so it is not built.
 *
 * **When you add a small map, add its row.** Choose b1 if it is indoors and b2 (with a theme from
 * `surround-art.ts`) if it is outdoors. A map that is neither (a cave, a dungeon, the world map) has
 * no rule yet: `tests/maps.test.ts` fails for it until the rule is chosen on purpose, so the choice
 * is never made by default.
 *
 * **The table is the one place a map's choice lives** (the editor rule of docs/IDEAS.md, entry 1:
 * no decision may make a future visual editor harder). `SURROUND` is keyed by map id and holds
 * plain values. It sits in code for now because PL6 forbids data edits in this package; it moves
 * into the map data (`MapDef`) once Mark gives his written yes. The drawing code never names a map.
 */
import type { Ctx } from '../../engine/canvas';
import { H, W } from '../../engine/game';
import { drawSurroundArt } from './surround-art';
import { VOID } from './void';

/** The themes of option b2. Each has its painter in `surround-art.ts` (a missing one is a type error). */
export type SurroundTheme = 'yard' | 'dock';

/** A map's surround: b1 (an edge fill, indoors) or b2 with a theme (outdoors). */
export type SurroundEntry = { option: 'b1' } | { option: 'b2'; theme: SurroundTheme };

/**
 * Every map smaller than the view, and what its surround is. `tests/maps.test.ts` pins this key
 * list against the real map sizes, so a map that changes size must change this table with it.
 */
export const SURROUND: Readonly<Record<string, SurroundEntry>> = {
  rustyard: { option: 'b2', theme: 'yard' },
  dock: { option: 'b2', theme: 'dock' },
  rook_flat: { option: 'b1' },
  bar: { option: 'b1' },
  clinic: { option: 'b1' },
  armory: { option: 'b1' },
  threads: { option: 'b1' },
  kwikmart: { option: 'b1' },
  hotel: { option: 'b1' },
  noodles: { option: 'b1' },
  hex_den: { option: 'b1' },
};

/** The entry for a map, or null for a map that is not in the table. */
export function surroundFor(id: string): SurroundEntry | null {
  return SURROUND[id] ?? null;
}

/** What the surround needs to know about the map and the camera. */
export interface SurroundView {
  id: string;
  voidColor?: string | undefined;
  /** The map's baked ground layer (map-sized): the edge fill repeats its outer tiles. */
  ground: HTMLCanvasElement;
  /** The map's size in pixels. */
  mw: number;
  mh: number;
  /** The camera's origin where the map is drawn this frame (negative when the map is centered), shake included. */
  cx: number;
  cy: number;
  /** The camera's origin without the shake. The painted surround depends on this, not on the shake. */
  camX: number;
  camY: number;
  /** The scene's frame count, for the one animated surround (water). */
  frame: number;
}


/**
 * Paint what is behind the map. Called first in the field's draw, before the map is drawn over it.
 * A small map (one with an entry) gets its surround. A map that fills the screen gets the plain
 * void, which the map then covers: that is the base case, and the only place the void shows is the
 * strip a screen shake pulls past a map's edge.
 */
export function drawSurround(ctx: Ctx, v: SurroundView): void {
  const entry = surroundFor(v.id);
  if (!entry || (v.mw >= W && v.mh >= H)) {
    ctx.fillStyle = v.voidColor ?? VOID;
    ctx.fillRect(0, 0, W, H);
    return;
  }
  drawSurroundArt(ctx, v, entry, v.voidColor ?? VOID);
}
