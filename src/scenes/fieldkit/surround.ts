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
import { surface, type Ctx, type Surface } from '../../engine/canvas';
import { H, W } from '../../engine/game';
import { TS } from '../../field/tiles';
import { reviewSwitch } from './devswitch';
import { drawShell } from './draw';

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
 * Paint the surround, or the plain void for a map that has none. Called first in the field's draw,
 * before the map is drawn over it. Option a is the old look, unchanged.
 */
export function drawSurround(ctx: Ctx, v: SurroundView): void {
  const entry = surroundFor(v.id);
  const option = entry?.option ?? 'a';
  if (!entry || option === 'a' || (v.mw >= W && v.mh >= H)) {
    ctx.fillStyle = v.voidColor ?? VOID;
    ctx.fillRect(0, 0, W, H);
    if (v.kind === 'interior') drawShell(ctx, v.mw, v.mh, v.cx, v.cy);
    return;
  }
  const art = built(v, entry);
  // Copy only the four strips around the map; the map is drawn over the rest.
  const x0 = -v.cx, y0 = -v.cy;
  const left = Math.max(0, Math.min(W, x0)), right = Math.max(0, Math.min(W, x0 + v.mw));
  const top = Math.max(0, Math.min(H, y0)), bottom = Math.max(0, Math.min(H, y0 + v.mh));
  const strip = (x: number, y: number, w: number, h: number): void => {
    if (w > 0 && h > 0) ctx.drawImage(art.canvas, x, y, w, h, x, y, w, h);
  };
  strip(0, 0, W, top);
  strip(0, bottom, W, H - bottom);
  strip(0, top, left, bottom - top);
  strip(right, top, W - right, bottom - top);
  if (option === 'b2' && entry.theme === 'dock') rippleWater(ctx, v);
}

// ------------------------------------------------------------------ the cache

/**
 * The surround is painted once into a screen-sized surface and copied each frame. A room's camera
 * never moves, so the paint happens once per room; the Rustyard scrolls, so it is repainted each
 * frame (two thin strips: cheap). The key says what the picture depends on.
 */
let cache: { key: string; art: Surface } | null = null;

function built(v: SurroundView, entry: SurroundEntry): Surface {
  const key = `${v.id}|${entry.option}|${entry.theme}|${v.cx}|${v.cy}`;
  if (cache?.key === key) return cache.art;
  const art = cache?.art ?? surface(W, H);
  const g = art.ctx;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = v.voidColor ?? VOID;
  g.fillRect(0, 0, W, H);
  if (entry.option === 'b1') paintEdgeFill(g, v);
  else paintTheme(g, v, entry.theme);
  cache = { key, art };
  return art;
}

// ------------------------------------------------------------------ b1: the edge fill

/**
 * Repeat the map's outermost row and column of tiles outward, then fade to black with distance.
 * The edge tiles are walls, fences and darkness in every map, so repeating them reads as more
 * of the same wall.
 */
function paintEdgeFill(g: Ctx, v: SurroundView): void {
  const x0 = -v.cx, y0 = -v.cy;
  // The rows and columns of the map that are on screen, in map pixels and in screen pixels.
  const dx0 = Math.max(0, x0), dx1 = Math.min(W, x0 + v.mw);
  const dy0 = Math.max(0, y0), dy1 = Math.min(H, y0 + v.mh);
  const sx = dx0 - x0, sy = dy0 - y0, sw = dx1 - dx0, sh = dy1 - dy0;
  // Sides: the outer tile column, repeated out to the screen edge.
  if (sh > 0) {
    for (let x = x0 - TS; x > -TS; x -= TS) g.drawImage(v.ground, 0, sy, TS, sh, x, dy0, TS, sh);
    for (let x = x0 + v.mw; x < W; x += TS) g.drawImage(v.ground, v.mw - TS, sy, TS, sh, x, dy0, TS, sh);
  }
  // Top and bottom: the outer tile row.
  if (sw > 0) {
    for (let y = y0 - TS; y > -TS; y -= TS) g.drawImage(v.ground, sx, 0, sw, TS, dx0, y, sw, TS);
    for (let y = y0 + v.mh; y < H; y += TS) g.drawImage(v.ground, sx, v.mh - TS, sw, TS, dx0, y, sw, TS);
  }
  // Corners: the corner tile.
  for (let x = x0 - TS; x > -TS; x -= TS) {
    for (let y = y0 - TS; y > -TS; y -= TS) g.drawImage(v.ground, 0, 0, TS, TS, x, y, TS, TS);
    for (let y = y0 + v.mh; y < H; y += TS) g.drawImage(v.ground, 0, v.mh - TS, TS, TS, x, y, TS, TS);
  }
  for (let x = x0 + v.mw; x < W; x += TS) {
    for (let y = y0 - TS; y > -TS; y -= TS) g.drawImage(v.ground, v.mw - TS, 0, TS, TS, x, y, TS, TS);
    for (let y = y0 + v.mh; y < H; y += TS) g.drawImage(v.ground, v.mw - TS, v.mh - TS, TS, TS, x, y, TS, TS);
  }
  fadeOut(g, x0, y0, v.mw, v.mh, 0.35, 0.94);
}

/**
 * Darken the area around a rectangle: `near` (alpha) at its edge, rising to `far` at 150 px away
 * and staying there out to the screen's edge. Four linear gradients, one per side; the corners get
 * two of them, so they are the darkest.
 */
function fadeOut(g: Ctx, x0: number, y0: number, mw: number, mh: number, near: number, far: number): void {
  const REACH = 150;
  const shade = (a: number): string => `rgba(7,6,13,${a})`;
  /** One side's region (x, y, w, h). `edgeFirst`: the map's edge is at the region's left or top end (else its right or bottom end). */
  const side = (x: number, y: number, w: number, h: number, horizontal: boolean, edgeFirst: boolean): void => {
    if (w <= 0 || h <= 0) return;
    // The gradient line runs from the map's edge to REACH px away from it; beyond it the color holds.
    const from = horizontal ? (edgeFirst ? x : x + w) : edgeFirst ? y : y + h;
    const to = from + (edgeFirst ? REACH : -REACH);
    const grad = horizontal ? g.createLinearGradient(from, 0, to, 0) : g.createLinearGradient(0, from, 0, to);
    grad.addColorStop(0, shade(near));
    grad.addColorStop(1, shade(far));
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
  };
  const right = Math.max(0, x0 + mw), bottom = Math.max(0, y0 + mh);
  side(0, 0, Math.min(W, x0), H, true, false);
  side(right, 0, W - right, H, true, true);
  side(0, 0, W, Math.min(H, y0), false, false);
  side(0, bottom, W, H - bottom, false, true);
}

// ------------------------------------------------------------------ b2: the themed surrounds

function paintTheme(g: Ctx, v: SurroundView, theme: SurroundTheme): void {
  if (theme === 'brick') paintBrick(g, v);
  else if (theme === 'yard') paintYard(g, v);
  else paintDock(g, v);
}

/** A repeating tile, drawn once per theme and pinned to the world so it does not swim. */
function tilePattern(g: Ctx, w: number, h: number, draw: (c: Ctx) => void): CanvasPattern | null {
  const s = surface(w, h);
  draw(s.ctx);
  return g.createPattern(s.canvas, 'repeat');
}

/** A cheap, repeatable hash in [0, 1) for scattering details without a random stream. */
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Interiors: the room is a box inside a brick building. Bricks all round, the building's steel
 * (two columns, a beam and a run of pipes, a concrete footing) framing the room, and the room's
 * light spilling warm onto the wall beside it. Darker with distance.
 */
function paintBrick(g: Ctx, v: SurroundView): void {
  const x0 = -v.cx, y0 = -v.cy;
  const bricks = tilePattern(g, 32, 16, (c) => {
    c.fillStyle = '#120f1b';
    c.fillRect(0, 0, 32, 16);
    for (const [bx, by] of [[0, 0], [16, 0], [-8, 8], [8, 8], [24, 8]] as const) {
      c.fillStyle = '#272036';
      c.fillRect(bx + 1, by + 1, 14, 6);
      c.fillStyle = '#322a45';
      c.fillRect(bx + 1, by + 1, 14, 1);
      c.fillStyle = '#1d1829';
      c.fillRect(bx + 1, by + 6, 14, 1);
    }
  });
  if (bricks) {
    g.save();
    g.translate(-v.cx, -v.cy);
    g.fillStyle = bricks;
    g.fillRect(v.cx, v.cy, W, H);
    g.restore();
  }
  fadeOut(g, x0, y0, v.mw, v.mh, 0.0, 0.78);
  // Warm light from the room, falling on the brick just outside it.
  // Drawn as outlines that grow outward and fade, so the corners stay clean (no double bright squares).
  const SPILL = 30;
  for (let i = 0; i < SPILL; i++) {
    g.fillStyle = `rgba(255,176,96,${(0.2 * (1 - i / SPILL) ** 2).toFixed(3)})`;
    g.fillRect(x0 - i - 1, y0 - i - 1, v.mw + 2 * i + 2, 1);
    g.fillRect(x0 - i - 1, y0 + v.mh + i, v.mw + 2 * i + 2, 1);
    g.fillRect(x0 - i - 1, y0 - i, 1, v.mh + 2 * i);
    g.fillRect(x0 + v.mw + i, y0 - i, 1, v.mh + 2 * i);
  }
  // Steel: a beam across the top, a footing across the bottom, a column each side. Each is a dark
  // body with a lit top or left edge and rivets.
  const steel = (x: number, y: number, w: number, h: number): void => {
    g.fillStyle = '#17131f';
    g.fillRect(x, y, w, h);
    g.fillStyle = '#3a3150';
    if (w > h) g.fillRect(x, y, w, 1);
    else g.fillRect(x, y, 1, h);
    g.fillStyle = '#4a4063';
    if (w > h) for (let i = x + 6; i < x + w - 3; i += 24) g.fillRect(i, y + Math.floor(h / 2), 2, 2);
    else for (let j = y + 6; j < y + h - 3; j += 24) g.fillRect(x + Math.floor(w / 2), j, 2, 2);
  };
  const GAP = 22;
  steel(0, y0 - GAP - 10, W, 10);
  steel(0, y0 + v.mh + GAP, W, 8);
  steel(x0 - GAP - 10, 0, 10, H);
  steel(x0 + v.mw + GAP, 0, 10, H);
  // Two pipes beside the beam, with brackets.
  for (const [dy, c] of [[-GAP - 18, '#2a2438'], [-GAP - 24, '#312a43']] as const) {
    g.fillStyle = c;
    g.fillRect(0, y0 + dy, W, 3);
    g.fillStyle = '#4a4063';
    g.fillRect(0, y0 + dy, W, 1);
  }
  g.fillStyle = '#17131f';
  for (let x = ((x0 % 48) + 48) % 48; x < W; x += 48) g.fillRect(x, y0 - GAP - 27, 3, 12);
}

/**
 * The Rustyard: a corrugated scrap-metal fence runs down each side, with posts and seams that scroll
 * with the yard, and rust-dark gravel and heaped scrap beyond it.
 */
function paintYard(g: Ctx, v: SurroundView): void {
  const x0 = -v.cx, y0 = -v.cy;
  const gravel = tilePattern(g, 32, 32, (c) => {
    c.fillStyle = '#0e0a0b';
    c.fillRect(0, 0, 32, 32);
    for (let i = 0; i < 26; i++) {
      c.fillStyle = hash(i) > 0.5 ? '#1c1411' : '#271a13';
      c.fillRect(Math.floor(hash(i + 50) * 30), Math.floor(hash(i + 90) * 30), 1 + Math.floor(hash(i + 7) * 3), 1 + Math.floor(hash(i + 3) * 2));
    }
  });
  if (gravel) {
    g.save();
    g.translate(-v.cx, -v.cy);
    g.fillStyle = gravel;
    g.fillRect(v.cx, v.cy, W, H);
    g.restore();
  }
  // Scrap heaps beyond the fence: dark lumps with a rusty rim light, at fixed spots down the yard.
  const FENCE = 16;
  const bar = Math.max(0, Math.min(x0, W - (x0 + v.mw)) );
  for (let k = 0; ; k++) {
    const wy = k * 41 - 20; // world y of the next heap
    const sy = wy - v.cy;
    if (sy > H) break;
    if (sy < -30) continue;
    const w = 10 + Math.floor(hash(k) * 14), h = 7 + Math.floor(hash(k + 11) * 9);
    for (const side of [0, 1] as const) {
      const room = bar - FENCE - 2;
      if (room < w) continue;
      const off = Math.floor(hash(k * 2 + side + 5) * (room - w + 1));
      const x = side === 0 ? x0 - FENCE - 2 - w - off : x0 + v.mw + FENCE + 2 + off;
      g.fillStyle = '#080607';
      g.fillRect(x, sy - h, w, h);
      g.fillStyle = '#3d2417';
      g.fillRect(x, sy - h, w, 1);
      g.fillStyle = '#1a100c';
      g.fillRect(x + 2, sy - h + 3, Math.max(1, w - 5), 1);
    }
  }
  // The fence: panels of corrugated metal, one rib every 3 px, a seam every 48 px of the yard.
  const panel = (x: number, outer: boolean): void => {
    for (let i = 0; i < FENCE; i++) {
      g.fillStyle = i % 3 === 0 ? '#573a2a' : i % 3 === 1 ? '#3f2a1f' : '#2f1f17';
      g.fillRect(x + i, 0, 1, H);
    }
    g.fillStyle = '#17100c';
    g.fillRect(outer ? x : x + FENCE - 1, 0, 1, H);
    for (let k = Math.floor(v.cy / 48) - 1; k * 48 - v.cy < H; k++) {
      const sy = k * 48 - v.cy;
      g.fillStyle = '#150e0b';
      g.fillRect(x, sy, FENCE, 2);
      g.fillStyle = '#6a4630';
      g.fillRect(x, sy + 2, FENCE, 1);
      // A rust streak under some seams.
      if (hash(k + 31) > 0.5) {
        g.fillStyle = '#7a3b1c';
        g.fillRect(x + 3 + Math.floor(hash(k) * 8), sy + 3, 1, 8 + Math.floor(hash(k + 4) * 14));
      }
    }
    for (let k = Math.floor(v.cy / 96) - 1; k * 96 - v.cy < H; k++) {
      const sy = k * 96 - v.cy;
      g.fillStyle = '#100a0a';
      g.fillRect(x + (outer ? -1 : FENCE - 2), sy - 3, 3, 8);
      g.fillStyle = '#6a4630';
      g.fillRect(x + (outer ? -1 : FENCE - 2), sy - 3, 3, 1);
    }
  };
  if (x0 > FENCE) {
    panel(x0 - FENCE, false);
    panel(x0 + v.mw, true);
  }
  fadeOut(g, x0, y0, v.mw, v.mh, 0.05, 0.8);
}

/**
 * Loading Dock 7: the apron is a quay over black water. A hazard-striped concrete lip runs round
 * the apron, with mooring bollards, and the water beyond it is dark with lamp-colored shine; the
 * ripples move (`rippleWater`).
 */
function paintDock(g: Ctx, v: SurroundView): void {
  const x0 = -v.cx, y0 = -v.cy;
  const water = g.createLinearGradient(0, 0, 0, H);
  water.addColorStop(0, '#0a1a2b');
  water.addColorStop(0.5, '#0c2236');
  water.addColorStop(1, '#07121e');
  g.fillStyle = water;
  g.fillRect(0, 0, W, H);
  // A still glint across the water, here and there.
  g.fillStyle = 'rgba(90,150,190,0.14)';
  for (let k = 0; k < 90; k++) g.fillRect(Math.floor(hash(k) * W), Math.floor(hash(k + 200) * H), 8 + Math.floor(hash(k + 400) * 22), 1);
  // The lip: a 5 px concrete edge with a lit top, a 4 px hazard stripe outside it, and a shadow on the water.
  const LIP = 5, STRIPE = 4;
  const rx = x0 - LIP - STRIPE, ry = y0 - LIP - STRIPE, rw = v.mw + 2 * (LIP + STRIPE), rh = v.mh + 2 * (LIP + STRIPE);
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.fillRect(rx - 3, ry - 3, rw + 6, rh + 6);
  g.fillStyle = '#16120b';
  g.fillRect(rx, ry, rw, rh);
  // Hazard blocks along the four sides, 6 px of amber then 6 px of dark.
  g.fillStyle = '#b08d2a';
  for (let x = rx; x < rx + rw; x += 12) {
    g.fillRect(x, ry, Math.min(6, rx + rw - x), STRIPE);
    g.fillRect(x + 3, ry + rh - STRIPE, Math.min(6, rx + rw - x - 3), STRIPE);
  }
  for (let y = ry; y < ry + rh; y += 12) {
    g.fillRect(rx, y, STRIPE, Math.min(6, ry + rh - y));
    g.fillRect(rx + rw - STRIPE, y + 3, STRIPE, Math.min(6, ry + rh - y - 3));
  }
  g.fillStyle = '#2c3646';
  g.fillRect(rx + STRIPE, ry + STRIPE, rw - 2 * STRIPE, rh - 2 * STRIPE);
  g.fillStyle = '#4c5b72';
  g.fillRect(rx + STRIPE, ry + STRIPE, rw - 2 * STRIPE, 1);
  // The apron itself is drawn by the map over this block.
  // Bollards on the lip: the four corners and every 64 px along the long sides.
  const bollard = (x: number, y: number): void => {
    g.fillStyle = '#05070b';
    g.fillRect(x - 4, y - 3, 8, 8);
    g.fillStyle = '#2a3342';
    g.fillRect(x - 3, y - 4, 6, 6);
    g.fillStyle = '#5a6a84';
    g.fillRect(x - 3, y - 4, 6, 1);
    g.fillRect(x - 3, y - 4, 1, 4);
  };
  for (let k = 0; k <= v.mw; k += 64) {
    bollard(x0 + k, ry + 1);
    bollard(x0 + k, ry + rh - 1);
  }
  for (let k = 0; k <= v.mh; k += 64) {
    bollard(rx + 1, y0 + k);
    bollard(rx + rw - 1, y0 + k);
  }
  fadeOut(g, x0 - LIP - STRIPE, y0 - LIP - STRIPE, v.mw + 2 * (LIP + STRIPE), v.mh + 2 * (LIP + STRIPE), 0.0, 0.62);
}

/** The dock's moving water: pale ripple dashes that drift sideways, only where the water shows. */
function rippleWater(ctx: Ctx, v: SurroundView): void {
  const x0 = -v.cx, y0 = -v.cy;
  ctx.fillStyle = 'rgba(120,175,215,0.3)';
  const margin = 14;
  for (let k = 0; k < 56; k++) {
    const y = Math.floor(hash(k + 900) * H);
    const len = 6 + Math.floor(hash(k + 950) * 12);
    const speed = 0.12 + hash(k + 990) * 0.2;
    const x = Math.floor((hash(k + 700) * (W + len) + v.frame * speed * (k % 2 ? 1 : -1) + W * 4) % (W + len)) - len;
    const inside = x + len > x0 - margin && x < x0 + v.mw + margin && y > y0 - margin && y < y0 + v.mh + margin;
    if (!inside) ctx.fillRect(x, y, len, 1);
  }
}
