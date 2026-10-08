/**
 * What surrounds a map that is smaller than the screen (decision D7 of docs/PIVOT-640.md).
 *
 * At 640x360 the camera shows 1.78 times the old area, so eleven maps no longer fill the screen:
 * the Rustyard is 96 px narrower than the view, Loading Dock 7 is 320 px narrower and 136 px
 * shorter, and the nine interiors are 224 to 352 px wide. The camera centers such a map
 * (`fieldkit/camera.ts`), and the strip around it is "the surround". There are three options:
 *
 * - **a**, accept the void: the map color (and, for an interior, the dark brick shell of
 *   `drawShell`). This is how the game looked before the move, and it ships until Mark answers D7.
 * - **b1**, an edge fill: the map's own outermost row of tiles is repeated outward, and a dark
 *   fade takes it to black, so the place seems to go on past its edge.
 * - **b2**, a themed surround: something drawn in code that fits the place. Which one is the
 *   map's `theme` in the table below: a brick building frame for the interiors, a corrugated
 *   fence and scrap ground for the Rustyard, a quay edge over black water for the Dock.
 *
 * Option c (make the map bigger) is a change to map data, so it is not built here.
 *
 * **The table is the one place a map's choice lives** (the editor rule of docs/IDEAS.md, entry 1:
 * no decision may make a future visual editor harder). `SURROUND` is keyed by map id and holds
 * plain values. It sits in code for now because PL6 forbids data edits in this package; it moves
 * into the map data (`MapDef`) once Mark gives his written yes. The drawing code below never
 * names a map.
 */
import type { Ctx } from '../../engine/canvas';
import { H, W } from '../../engine/game';
import { reviewSwitch } from './devswitch';
import { drawShell } from './draw';
import * as surroundArt from './surround-art';

export type SurroundOption = 'a' | 'b1' | 'b2';
export type SurroundTheme = 'brick' | 'yard' | 'dock';

export interface SurroundEntry {
  /** What ships for this map: a (the void), b1 (an edge fill) or b2 (the themed surround). */
  option: SurroundOption;
  /** What option b2 draws for this map. */
  theme: SurroundTheme;
}

/**
 * Every map smaller than the view, and what its surround is. All `a` until Mark answers D7
 * (recommended: the Rustyard b, the Dock b, the interiors a). `tests/maps.test.ts` pins this key
 * list against the real map sizes, so a map that changes size must change this table with it.
 */
export const SURROUND: Readonly<Record<string, SurroundEntry>> = {
  rustyard: { option: 'a', theme: 'yard' },
  dock: { option: 'a', theme: 'dock' },
  rook_flat: { option: 'a', theme: 'brick' },
  bar: { option: 'a', theme: 'brick' },
  clinic: { option: 'a', theme: 'brick' },
  armory: { option: 'a', theme: 'brick' },
  threads: { option: 'a', theme: 'brick' },
  kwikmart: { option: 'a', theme: 'brick' },
  hotel: { option: 'a', theme: 'brick' },
  noodles: { option: 'a', theme: 'brick' },
  hex_den: { option: 'a', theme: 'brick' },
};

/** The map color the void shows (a map's own `voidColor` wins). */
const VOID = '#07060d';

/** The entry for a map, with the dev review switch (`?surround=a|b1|b2`) applied. Null for a map that is not in the table. */
export function surroundFor(id: string): SurroundEntry | null {
  const entry = SURROUND[id];
  if (!entry) return null;
  const forced = reviewSwitch('surround');
  return forced === 'a' || forced === 'b1' || forced === 'b2' ? { ...entry, option: forced } : entry;
}

/** What the surround needs to know about the map and the camera. */
export interface SurroundView {
  id: string;
  kind: 'town' | 'interior' | 'dungeon' | 'world';
  voidColor?: string | undefined;
  /** The map's baked ground layer (map-sized): the edge fill repeats its outer tiles. */
  ground: HTMLCanvasElement;
  /** The map's size in pixels. */
  mw: number;
  mh: number;
  /** The camera's origin (negative when the map is centered), shake included. */
  cx: number;
  cy: number;
  /** The scene's frame count, for the one animated surround (water). */
  frame: number;
}

/**
 * The painters of options b1 and b2 (`surround-art.ts`) are in the dev build only. Until Mark
 * answers D7 the game ships option a everywhere, so a production build leaves them out:
 * `import.meta.env.DEV` is false there, the bundler folds this to null, and the whole file goes.
 * When he picks b1 or b2 for a map, make `art` the module itself in the same commit.
 */
const art = import.meta.env.DEV ? surroundArt : null;

/**
 * Paint the surround, or the plain void for a map that has none. Called first in the field's draw,
 * before the map is drawn over it. Option a is the old look, unchanged. An option whose painter is
 * not in the build (the production build, for now) draws option a.
 */
export function drawSurround(ctx: Ctx, v: SurroundView): void {
  const entry = surroundFor(v.id);
  const option = entry?.option ?? 'a';
  if (!entry || option === 'a' || !art || (v.mw >= W && v.mh >= H)) {
    ctx.fillStyle = v.voidColor ?? VOID;
    ctx.fillRect(0, 0, W, H);
    if (v.kind === 'interior') drawShell(ctx, v.mw, v.mh, v.cx, v.cy);
    return;
  }
  art.drawSurroundArt(ctx, v, entry, v.voidColor ?? VOID);
}
