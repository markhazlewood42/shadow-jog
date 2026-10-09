/**
 * The painters behind the surround of a map that is smaller than the screen (decision D7 of
 * docs/PIVOT-640.md): b1, an edge fill (indoors), and b2, a themed surround (outdoors). See
 * `surround.ts` for what the options are and the per-map table that chooses them.
 */
import { surface, type Ctx, type Surface } from '../../engine/canvas';
import { H, W } from '../../sje/core/size';
import { TS } from '../../field/tiles';
import type { SurroundEntry, SurroundTheme, SurroundView } from './surround';
import { voidShade } from './void';

// ------------------------------------------------------------------ the looks

/**
 * The b1 edge fill's dark fade: the alpha of the void color where the fade starts (at the map's edge)
 * and where it ends (150 px away). Interiors only: the picture beside a room fades to a very dark tone (alpha 0.94 of the void color; the void itself is
 * a near-black, not pure black).
 */
export const EDGE_FILL = { fadeNear: 0.35, fadeFar: 0.94 };

/**
 * The Rustyard's theme record: every color and alpha of its painter, named. The surround is drawn
 * before the field's light multiplies the screen, so the night ambient (about 0.38, 0.35, 0.52 of
 * each channel) darkens it like the yard's own ground. The colors are picked so that, after that
 * multiply, the gravel and the fence read about as dark as the yard's own shadowed ground (round 3,
 * Mark: the strip below the yard read as black, a void). The fade is light for the same reason: it
 * only takes the far edge of the picture toward the void, and does not black out the near strip.
 */
export const YARD = {
  /** The gravel tile: its ground and two speck colors. */
  gravelGround: '#664b3a',
  gravelSpecks: ['#765a47', '#8a6a54'] as const,
  /** The fence's three rib colors (lit, mid, shadowed), its dark outer edge, and the seams between panels. */
  fenceRibs: ['#8e6046', '#6e4a38', '#54392a'] as const,
  fenceEdge: '#2d1f17',
  seamShadow: '#2a1c15',
  seamLight: '#9a6a4a',
  /** The rust streak under some seams. */
  rustStreak: '#8c4a26',
  /** A fence post: its body and its lit top. */
  postBody: '#2e211a',
  postTop: '#9a6a4a',
  /** A scrap heap beyond the fence: its body, its rusty rim light and its inner crack. */
  heapBody: '#3a2b21',
  heapRim: '#7d4e30',
  heapCrack: '#4e382b',
  /** The fade: the void's alpha at the yard's edge and 150 px away. */
  fadeNear: 0,
  fadeFar: 0.4,
};

/** The Dock's theme record: every color and alpha of its painter and of its moving water. */
export const DOCK = {
  waterTop: '#0a1a2b',
  waterMid: '#0c2236',
  waterBottom: '#07121e',
  glint: 'rgba(90,150,190,0.14)',
  lipShadow: 'rgba(0,0,0,0.5)',
  lipBody: '#16120b',
  hazard: '#b08d2a',
  lipTop: '#2c3646',
  lipLit: '#4c5b72',
  bollardShadow: '#05070b',
  bollardBody: '#2a3342',
  bollardLit: '#5a6a84',
  /** The moving water's ripple dashes: color, how many, how far past the apron they stay, length range and speed range. */
  ripple: 'rgba(120,175,215,0.3)',
  rippleCount: 56,
  rippleMargin: 14,
  rippleLenMin: 6,
  rippleLenRange: 12,
  rippleSpeedMin: 0.12,
  rippleSpeedRange: 0.2,
  fadeNear: 0.0,
  fadeFar: 0.62,
};

// ------------------------------------------------------------------ the themes

/** What one b2 theme draws. */
interface ThemeArt {
  /** Paint the still part of the surround into the picture. The map is drawn over its middle. */
  paint: (g: Ctx, v: SurroundView) => void;
  /** Draw the moving part over the copied picture each frame, for a theme that has one (the Dock's water). */
  animate?: (ctx: Ctx, v: SurroundView) => void;
}

/**
 * Every b2 theme and its painters. The record is keyed by the closed `SurroundTheme` type, so a theme
 * without an entry here, or an entry for a theme that does not exist, is a type error (an unknown
 * theme never falls back to another one's art). Whether a theme moves is a property of its own
 * entry: only the dock has an `animate`.
 */
export const THEMES: Readonly<Record<SurroundTheme, ThemeArt>> = {
  yard: { paint: paintYard },
  dock: { paint: paintDock, animate: rippleWater },
};

// ------------------------------------------------------------------ drawing and the cache

/**
 * Extra pixels painted past each screen edge. A screen shake moves the map by a few pixels, and the
 * picture slides with it instead of being repainted; the shake would otherwise show a strip of
 * unpainted void at the far edge. The strongest shake in the game is under 8 pixels.
 */
const SHAKE_PAD = 16;
/** The size of the painted picture: the screen and the pad on every side. */
const PW = W + 2 * SHAKE_PAD, PH = H + 2 * SHAKE_PAD;

/**
 * Copy the four strips around the map from the painted surround; the map is drawn over the rest.
 * The picture is painted for the camera at rest and slid by the shake, so a shake costs a copy and
 * no repaint.
 */
export function drawSurroundArt(ctx: Ctx, v: SurroundView, entry: SurroundEntry, voidColor: string): void {
  const picture = built(v, entry, voidColor);
  // How far the map is from its resting place on screen this frame (the shake), within the pad.
  const slideX = Math.max(-SHAKE_PAD, Math.min(SHAKE_PAD, v.camX - v.cx));
  const slideY = Math.max(-SHAKE_PAD, Math.min(SHAKE_PAD, v.camY - v.cy));
  const x0 = -v.cx, y0 = -v.cy;
  const left = Math.max(0, Math.min(W, x0)), right = Math.max(0, Math.min(W, x0 + v.mw));
  const top = Math.max(0, Math.min(H, y0)), bottom = Math.max(0, Math.min(H, y0 + v.mh));
  const strip = (x: number, y: number, w: number, h: number): void => {
    if (w > 0 && h > 0) ctx.drawImage(picture.canvas, x - slideX + SHAKE_PAD, y - slideY + SHAKE_PAD, w, h, x, y, w, h);
  };
  strip(0, 0, W, top);
  strip(0, bottom, W, H - bottom);
  strip(0, top, left, bottom - top);
  strip(right, top, W - right, bottom - top);
  if (entry.option === 'b2') THEMES[entry.theme].animate?.(ctx, v);
}

/**
 * The surround is painted once into a picture and copied each frame. A room's camera never moves, so
 * the paint happens once per room. The Rustyard scrolls, so its picture is repainted when the camera
 * moves (the key holds the camera at rest). The key says what the picture depends on: the map, the
 * option and theme, the map's size, the void color, the map's ground (the edge fill copies it) and
 * the camera at rest. The shake is not in it.
 */
let cache: { key: string; ground: HTMLCanvasElement; art: Surface } | null = null;

/** What the painted picture depends on (see above): two frames with the same key share one picture. */
export function pictureKey(v: SurroundView, entry: SurroundEntry, voidColor: string): string {
  return `${v.id}|${entry.option}|${entry.option === 'b2' ? entry.theme : ''}|${v.mw}x${v.mh}|${voidColor}|${v.camX}|${v.camY}`;
}

function built(v: SurroundView, entry: SurroundEntry, voidColor: string): Surface {
  const key = pictureKey(v, entry, voidColor);
  if (cache?.key === key && cache.ground === v.ground) return cache.art;
  const art = cache?.art ?? surface(PW, PH);
  const g = art.ctx;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = voidColor;
  g.fillRect(0, 0, PW, PH);
  // The painters work in the picture's own coordinates: the camera is the resting camera, moved by the pad.
  const at: SurroundView = { ...v, cx: v.camX - SHAKE_PAD, cy: v.camY - SHAKE_PAD };
  if (entry.option === 'b1') paintEdgeFill(g, at);
  else THEMES[entry.theme].paint(g, at);
  cache = { key, ground: v.ground, art };
  return art;
}

// ------------------------------------------------------------------ b1: the edge fill

/**
 * Repeat the map's outermost row and column of tiles outward, then fade toward the void color with distance (dark, not pure black).
 * The edge tiles are walls, fences and darkness in every map, so repeating them reads as more
 * of the same wall.
 */
function paintEdgeFill(g: Ctx, v: SurroundView): void {
  const x0 = -v.cx, y0 = -v.cy;
  // The rows and columns of the map that are in the picture, in map pixels and in picture pixels.
  const dx0 = Math.max(0, x0), dx1 = Math.min(PW, x0 + v.mw);
  const dy0 = Math.max(0, y0), dy1 = Math.min(PH, y0 + v.mh);
  const sx = dx0 - x0, sy = dy0 - y0, sw = dx1 - dx0, sh = dy1 - dy0;
  // Sides: the outer tile column, repeated out to the picture's edge.
  if (sh > 0) {
    for (let x = x0 - TS; x > -TS; x -= TS) g.drawImage(v.ground, 0, sy, TS, sh, x, dy0, TS, sh);
    for (let x = x0 + v.mw; x < PW; x += TS) g.drawImage(v.ground, v.mw - TS, sy, TS, sh, x, dy0, TS, sh);
  }
  // Top and bottom: the outer tile row.
  if (sw > 0) {
    for (let y = y0 - TS; y > -TS; y -= TS) g.drawImage(v.ground, sx, 0, sw, TS, dx0, y, sw, TS);
    for (let y = y0 + v.mh; y < PH; y += TS) g.drawImage(v.ground, sx, v.mh - TS, sw, TS, dx0, y, sw, TS);
  }
  // Corners: the corner tile.
  for (let x = x0 - TS; x > -TS; x -= TS) {
    for (let y = y0 - TS; y > -TS; y -= TS) g.drawImage(v.ground, 0, 0, TS, TS, x, y, TS, TS);
    for (let y = y0 + v.mh; y < PH; y += TS) g.drawImage(v.ground, 0, v.mh - TS, TS, TS, x, y, TS, TS);
  }
  for (let x = x0 + v.mw; x < PW; x += TS) {
    for (let y = y0 - TS; y > -TS; y -= TS) g.drawImage(v.ground, v.mw - TS, 0, TS, TS, x, y, TS, TS);
    for (let y = y0 + v.mh; y < PH; y += TS) g.drawImage(v.ground, v.mw - TS, v.mh - TS, TS, TS, x, y, TS, TS);
  }
  fadeOut(g, x0, y0, v.mw, v.mh, EDGE_FILL.fadeNear, EDGE_FILL.fadeFar);
}

/** How far from the map's edge the fade takes to reach its far strength, in pixels. */
const FADE_REACH = 150;

/**
 * Darken the area around a rectangle: `near` (alpha) at its edge, rising to `far` at `FADE_REACH` px
 * away and staying there out to the picture's edge. Four linear gradients, one per side; the corners
 * get two of them, so they are the darkest.
 */
function fadeOut(g: Ctx, x0: number, y0: number, mw: number, mh: number, near: number, far: number): void {
  /** One side's region (x, y, w, h). `edgeFirst`: the map's edge is at the region's left or top end (else its right or bottom end). */
  const side = (x: number, y: number, w: number, h: number, horizontal: boolean, edgeFirst: boolean): void => {
    if (w <= 0 || h <= 0) return;
    // The gradient line runs from the map's edge to FADE_REACH px away from it; beyond it the color holds.
    const from = horizontal ? (edgeFirst ? x : x + w) : edgeFirst ? y : y + h;
    const to = from + (edgeFirst ? FADE_REACH : -FADE_REACH);
    const grad = horizontal ? g.createLinearGradient(from, 0, to, 0) : g.createLinearGradient(0, from, 0, to);
    grad.addColorStop(0, voidShade(near));
    grad.addColorStop(1, voidShade(far));
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
  };
  const right = Math.max(0, x0 + mw), bottom = Math.max(0, y0 + mh);
  side(0, 0, Math.min(PW, x0), PH, true, false);
  side(right, 0, PW - right, PH, true, true);
  side(0, 0, PW, Math.min(PH, y0), false, false);
  side(0, bottom, PW, PH - bottom, false, true);
}

// ------------------------------------------------------------------ b2: the themed surrounds

/** The small repeating tiles the themes use, each drawn once (the Rustyard repaints as it scrolls). */
const tiles = new Map<string, Surface>();

/** A repeating tile, drawn once per theme and pinned to the world so it does not swim. */
function tilePattern(g: Ctx, name: string, w: number, h: number, draw: (c: Ctx) => void): CanvasPattern | null {
  let s = tiles.get(name);
  if (!s) {
    s = surface(w, h);
    draw(s.ctx);
    tiles.set(name, s);
  }
  return g.createPattern(s.canvas, 'repeat');
}

/** A cheap, repeatable hash in [0, 1) for scattering details without a random stream. */
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * The Rustyard: a corrugated scrap-metal fence runs down each side, with posts and seams that scroll
 * with the yard, and rust-dark gravel and heaped scrap beyond it.
 */
function paintYard(g: Ctx, v: SurroundView): void {
  const x0 = -v.cx, y0 = -v.cy;
  const gravel = tilePattern(g, 'yard-gravel', 32, 32, (c) => {
    c.fillStyle = YARD.gravelGround;
    c.fillRect(0, 0, 32, 32);
    for (let i = 0; i < 26; i++) {
      c.fillStyle = YARD.gravelSpecks[hash(i) > 0.5 ? 0 : 1];
      c.fillRect(Math.floor(hash(i + 50) * 30), Math.floor(hash(i + 90) * 30), 1 + Math.floor(hash(i + 7) * 3), 1 + Math.floor(hash(i + 3) * 2));
    }
  });
  if (gravel) {
    g.save();
    g.translate(-v.cx, -v.cy);
    g.fillStyle = gravel;
    g.fillRect(v.cx, v.cy, PW, PH);
    g.restore();
  }
  // Scrap heaps beyond the fence: dark lumps with a rusty rim light, at fixed spots down the yard.
  const FENCE = 16;
  const bar = Math.max(0, Math.min(x0, PW - (x0 + v.mw)));
  for (let k = 0; ; k++) {
    const wy = k * 41 - 20; // world y of the next heap
    const sy = wy - v.cy;
    if (sy > PH) break;
    if (sy < -30) continue;
    const w = 10 + Math.floor(hash(k) * 14), h = 7 + Math.floor(hash(k + 11) * 9);
    for (const side of [0, 1] as const) {
      const room = bar - FENCE - 2;
      if (room < w) continue;
      const off = Math.floor(hash(k * 2 + side + 5) * (room - w + 1));
      const x = side === 0 ? x0 - FENCE - 2 - w - off : x0 + v.mw + FENCE + 2 + off;
      g.fillStyle = YARD.heapBody;
      g.fillRect(x, sy - h, w, h);
      g.fillStyle = YARD.heapRim;
      g.fillRect(x, sy - h, w, 1);
      g.fillStyle = YARD.heapCrack;
      g.fillRect(x + 2, sy - h + 3, Math.max(1, w - 5), 1);
    }
  }
  // The fence: panels of corrugated metal, one rib every 3 px, a seam every 48 px of the yard.
  const panel = (x: number, outer: boolean): void => {
    for (let i = 0; i < FENCE; i++) {
      g.fillStyle = YARD.fenceRibs[(i % 3) as 0 | 1 | 2];
      g.fillRect(x + i, 0, 1, PH);
    }
    g.fillStyle = YARD.fenceEdge;
    g.fillRect(outer ? x : x + FENCE - 1, 0, 1, PH);
    for (let k = Math.floor(v.cy / 48) - 1; k * 48 - v.cy < PH; k++) {
      const sy = k * 48 - v.cy;
      g.fillStyle = YARD.seamShadow;
      g.fillRect(x, sy, FENCE, 2);
      g.fillStyle = YARD.seamLight;
      g.fillRect(x, sy + 2, FENCE, 1);
      // A rust streak under some seams.
      if (hash(k + 31) > 0.5) {
        g.fillStyle = YARD.rustStreak;
        g.fillRect(x + 3 + Math.floor(hash(k) * 8), sy + 3, 1, 8 + Math.floor(hash(k + 4) * 14));
      }
    }
    for (let k = Math.floor(v.cy / 96) - 1; k * 96 - v.cy < PH; k++) {
      const sy = k * 96 - v.cy;
      g.fillStyle = YARD.postBody;
      g.fillRect(x + (outer ? -1 : FENCE - 2), sy - 3, 3, 8);
      g.fillStyle = YARD.postTop;
      g.fillRect(x + (outer ? -1 : FENCE - 2), sy - 3, 3, 1);
    }
  };
  if (x0 > FENCE) {
    panel(x0 - FENCE, false);
    panel(x0 + v.mw, true);
  }
  fadeOut(g, x0, y0, v.mw, v.mh, YARD.fadeNear, YARD.fadeFar);
}

/**
 * Loading Dock 7: the apron is a quay over black water. A hazard-striped concrete lip runs round
 * the apron, with mooring bollards, and the water beyond it is dark with lamp-colored shine; the
 * ripples move (`rippleWater`).
 */
function paintDock(g: Ctx, v: SurroundView): void {
  const x0 = -v.cx, y0 = -v.cy;
  // The water's colors run down the screen (the picture's middle), so the pad only extends them.
  const water = g.createLinearGradient(0, SHAKE_PAD, 0, SHAKE_PAD + H);
  water.addColorStop(0, DOCK.waterTop);
  water.addColorStop(0.5, DOCK.waterMid);
  water.addColorStop(1, DOCK.waterBottom);
  g.fillStyle = water;
  g.fillRect(0, 0, PW, PH);
  // A still glint across the water, here and there (scattered over the screen, in the picture's coordinates).
  g.fillStyle = DOCK.glint;
  for (let k = 0; k < 90; k++) g.fillRect(SHAKE_PAD + Math.floor(hash(k) * W), SHAKE_PAD + Math.floor(hash(k + 200) * H), 8 + Math.floor(hash(k + 400) * 22), 1);
  // The lip: a 5 px concrete edge with a lit top, a 4 px hazard stripe outside it, and a shadow on the water.
  const LIP = 5, STRIPE = 4;
  const rx = x0 - LIP - STRIPE, ry = y0 - LIP - STRIPE, rw = v.mw + 2 * (LIP + STRIPE), rh = v.mh + 2 * (LIP + STRIPE);
  g.fillStyle = DOCK.lipShadow;
  g.fillRect(rx - 3, ry - 3, rw + 6, rh + 6);
  g.fillStyle = DOCK.lipBody;
  g.fillRect(rx, ry, rw, rh);
  // Hazard blocks along the four sides, 6 px of amber then 6 px of dark.
  g.fillStyle = DOCK.hazard;
  for (let x = rx; x < rx + rw; x += 12) {
    g.fillRect(x, ry, Math.min(6, rx + rw - x), STRIPE);
    g.fillRect(x + 3, ry + rh - STRIPE, Math.min(6, rx + rw - x - 3), STRIPE);
  }
  for (let y = ry; y < ry + rh; y += 12) {
    g.fillRect(rx, y, STRIPE, Math.min(6, ry + rh - y));
    g.fillRect(rx + rw - STRIPE, y + 3, STRIPE, Math.min(6, ry + rh - y - 3));
  }
  g.fillStyle = DOCK.lipTop;
  g.fillRect(rx + STRIPE, ry + STRIPE, rw - 2 * STRIPE, rh - 2 * STRIPE);
  g.fillStyle = DOCK.lipLit;
  g.fillRect(rx + STRIPE, ry + STRIPE, rw - 2 * STRIPE, 1);
  // The apron itself is drawn by the map over this block.
  // Bollards on the lip: the four corners and every 64 px along the long sides.
  const bollard = (x: number, y: number): void => {
    g.fillStyle = DOCK.bollardShadow;
    g.fillRect(x - 4, y - 3, 8, 8);
    g.fillStyle = DOCK.bollardBody;
    g.fillRect(x - 3, y - 4, 6, 6);
    g.fillStyle = DOCK.bollardLit;
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
  fadeOut(g, x0 - LIP - STRIPE, y0 - LIP - STRIPE, v.mw + 2 * (LIP + STRIPE), v.mh + 2 * (LIP + STRIPE), DOCK.fadeNear, DOCK.fadeFar);
}

/** The dock's moving water: pale ripple dashes that drift sideways, only where the water shows. */
function rippleWater(ctx: Ctx, v: SurroundView): void {
  const x0 = -v.cx, y0 = -v.cy;
  ctx.fillStyle = DOCK.ripple;
  const margin = DOCK.rippleMargin;
  for (let k = 0; k < DOCK.rippleCount; k++) {
    const y = Math.floor(hash(k + 900) * H);
    const len = DOCK.rippleLenMin + Math.floor(hash(k + 950) * DOCK.rippleLenRange);
    const speed = DOCK.rippleSpeedMin + hash(k + 990) * DOCK.rippleSpeedRange;
    const x = Math.floor((hash(k + 700) * (W + len) + v.frame * speed * (k % 2 ? 1 : -1) + W * 4) % (W + len)) - len;
    const inside = x + len > x0 - margin && x < x0 + v.mw + margin && y > y0 - margin && y < y0 + v.mh + margin;
    if (!inside) ctx.fillRect(x, y, len, 1);
  }
}
