/**
 * Painting the stage's floor (Phaser spike `spike/phaser-stage`), ported from the design's Python mockup script
 * (`render.py`, `build_stage`). Pure: it takes the finished wall (the backdrop above the horizon) and the stage
 * config and returns the whole 480x270 picture, wall plus a freshly painted floor. No Phaser, no browser.
 *
 * Why paint a floor at all? The game's old backdrops were drawn for a camera standing BEHIND the party, so
 * their floor is a road running into the screen with lane lines meeting at a vanishing point in the middle of
 * the fight. The new battle camera looks ACROSS the battle line from up high, so the floor must agree: nothing
 * on it points into the screen. This floor is stripes ("bands") that get taller toward the camera, and that
 * is the whole perspective trick: equal-width stripes would look flat, stripes growing 1.2x per step look like
 * a surface tilting toward you. The paving joints meet 400 px ABOVE the screen, so they lean only a little.
 *
 * Layers, in the order they are painted (later ones paint over earlier ones):
 *   kerb -> bands -> speckle flecks -> band seams -> paving joints -> lane seams -> painted stripes
 *   -> neon spill (the signs reflected in the wet street) -> neon streaks -> puddles -> haze.
 * Every fade is an ordered dither (see `pixels.ts`), never a smooth gradient.
 *
 * The result is the same for the same config: flecks and puddles come from a seeded generator.
 */
import type { StageConfig } from './config';
import { SCREEN_H, SCREEN_W } from './config';
import { blendRgb, cloneRaw, getRgb, hexRgb, mix, type Raw, type RGB, seeded, setRgb, th } from './pixels';

const BLACK: RGB = [0, 0, 0];

/** The stripes the floor is made of, as `[top, bottom)` rows. */
export type Bands = Array<[number, number]>;

/** Work out the bands: the first is `bandStart` tall, each next one `bandGrowth` times taller, from just under the kerb down to the floor's bottom. */
export function floorBands(top: number, bottom: number, start: number, growth: number): Bands {
  const bands: Bands = [];
  let y = top;
  let h = start;
  while (y < bottom) {
    const n = Math.max(1, Math.round(h));
    bands.push([y, Math.min(y + n, bottom)]);
    y += n;
    h *= growth;
  }
  return bands;
}

export interface Puddle {
  cx: number;
  cy: number;
  a: number;
}

/**
 * Where the puddles go: random spots (from the seed) that keep clear of every place anyone can stand, in
 * any group size, so nobody ever stands in a puddle, and clear of each other.
 */
export function puddleSpots(stage: StageConfig, rand: () => number, top: number, count: number): Puddle[] {
  const ys = stage.rows.map((r) => r.y);
  const keep: Array<[number, number]> = stage.party.map((q) => [q.x, ys[q.row] ?? 0]);
  for (const set of Object.values(stage.enemySets)) for (const q of set) keep.push([q.x, ys[q.row] ?? 0]);
  const ri = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
  const placed: Puddle[] = [];
  let tries = 0;
  while (placed.length < count && tries < 3000) {
    tries++;
    const a = ri(18, 32);
    const cx = ri(20, SCREEN_W - 20);
    const cy = ri(top + 10, 224);
    if (keep.some(([kx, ky]) => Math.abs(cx - kx) < a + 24 && Math.abs(cy - ky) < 14)) continue;
    if (placed.every((p) => Math.abs(cx - p.cx) > 70 || Math.abs(cy - p.cy) > 22)) placed.push({ cx, cy, a });
  }
  return placed;
}

/**
 * Paint the floor onto a copy of `base` (a 480x270 picture whose rows above and including `horizonY` are the
 * finished wall) and return the copy. See the file header for the layers.
 */
export function paintFloor(base: Raw, stage: StageConfig): Raw {
  const img = cloneRaw(base);
  const wall = base; // read-only: the neon spill reflects the wall as it was before any floor existed
  const fl = stage.floor;
  const h0 = stage.backdrop.horizonY;
  const rand = seeded(fl.seed ?? 0);
  const y1 = fl.y1;
  const ys = h0 + 2;

  // --- the kerb: a lit row, then a darker one
  if (fl.edge) {
    const edge = hexRgb(fl.edge);
    for (let x = 0; x < SCREEN_W; x++) {
      setRgb(img, x, h0, edge);
      setRgb(img, x, h0 + 1, mix(edge, BLACK, 0.55));
    }
  }

  // --- bands: horizontal stripes that grow `bandGrowth` times taller per step
  const cA = hexRgb(fl.colors[0]);
  const cB = hexRgb(fl.colors[1]);
  const bands = floorBands(ys, y1, fl.bandStart, fl.bandGrowth);
  const bandColour = new Map<number, RGB>();
  bands.forEach(([a, b], i) => {
    for (let y = a; y < b; y++) {
      const c = i % 2 === 0 ? cA : cB;
      bandColour.set(y, c);
      for (let x = 0; x < SCREEN_W; x++) setRgb(img, x, y, c);
    }
  });
  const rowColour = (y: number): RGB => bandColour.get(y) ?? cA;

  // --- speckle flecks: 1 px dots far away, longer dashes near the camera, denser near the horizon
  if (fl.texture) {
    for (let y = ys; y < y1; y++) {
      const base0 = rowColour(y);
      const flecks: RGB[] = [mix(base0, [150, 150, 190], 0.2), mix(base0, [6, 6, 18], 0.45)];
      const t = (y - ys) / (y1 - ys);
      const dens = 0.05 - 0.03 * t * fl.texture.shrink * 2;
      const len = 1 + Math.floor(t * 3.99);
      for (let x = 0; x < SCREEN_W; x++) {
        if (rand() < dens / len) {
          const c = flecks[Math.floor(rand() * flecks.length)] ?? flecks[0] ?? base0;
          for (let k = 0; k < len; k++) setRgb(img, x + k, y, c);
        }
      }
    }
  }

  // --- band seams: a lit dithered line on top of each band, stronger toward the camera
  if (fl.seam) {
    const sc = hexRgb(fl.seam.color);
    for (const [a, b] of bands) {
      const t = (a - ys) / (y1 - ys);
      const p = fl.seam.far + (fl.seam.near - fl.seam.far) * t;
      for (let x = 0; x < SCREEN_W; x++) if (th(x, a) < p) setRgb(img, x, a, mix(rowColour(a), sc, 0.55));
      // Big near bands get a dark grout row under the lit one.
      if (b - a >= 8) for (let x = 0; x < SCREEN_W; x++) if (th(x, a + 1) < p * 0.6) setRgb(img, x, a + 1, mix(rowColour(a), BLACK, 0.3));
    }
  }

  // --- paving joints: staggered slab joints whose lines meet far ABOVE the screen, clearer near the camera
  if (fl.style === 'grid' && fl.grid) {
    const g = fl.grid;
    const gc = hexRgb(g.color);
    const vy = g.vanishY;
    bands.forEach(([a, b], i) => {
      const off = g.stagger && i % 2 ? g.spacing / 2 : 0;
      const t = (a - ys) / (y1 - ys);
      const ga = g.alpha + ((g.nearAlpha ?? g.alpha) - g.alpha) * t;
      for (let k = -12; k <= 12; k++) {
        const xb = SCREEN_W / 2 + k * g.spacing + off;
        for (let y = a + 1; y < b; y++) {
          const x = Math.round(SCREEN_W / 2 + ((xb - SCREEN_W / 2) * (y - vy)) / (SCREEN_H - vy));
          if (x >= 0 && x < SCREEN_W && th(x, y) < ga) setRgb(img, x, y, gc);
        }
      }
    });
  }

  // --- lane seams: a faint lit line halfway between depth rows, so each row reads as its own lane
  if (fl.laneSeams) {
    const lc = hexRgb(fl.laneSeams.color);
    const ry = stage.rows.map((r) => r.y);
    for (let i = 0; i + 1 < ry.length; i++) {
      const y = Math.floor(((ry[i] ?? 0) + (ry[i + 1] ?? 0)) / 2) + 2;
      for (let x = 0; x < SCREEN_W; x++) if (th(x, y) < fl.laneSeams.alpha) setRgb(img, x, y, mix(getRgb(img, x, y), lc, 0.6));
    }
  }

  // --- painted stripes (left to right only, behind the back row)
  for (const s of fl.stripes ?? []) {
    const sc = hexRgb(s.color);
    for (let y = s.y; y < s.y + s.h; y++)
      for (let x = 0; x < SCREEN_W; x++) {
        if (s.dash && x % (s.dash[0] + s.dash[1]) >= s.dash[0]) continue;
        if (th(x, y) < s.alpha) setRgb(img, x, y, sc);
      }
  }

  // --- neon spill: bright wall pixels mirrored into the wet floor just below the kerb; plus vertical streaks under the brightest
  const ns = fl.neonSpill;
  if (ns) {
    for (let d = 1; d <= ns.reach; d++) {
      const y = h0 + 1 + d;
      const sy = h0 - Math.round(d * 0.8);
      if (y >= y1 || sy < 0) break;
      const prob = ns.strength * (1 - d / ns.reach) ** 1.3;
      for (let x = 0; x < SCREEN_W; x++) {
        const c = getRgb(wall, x, sy);
        if (Math.max(...c) >= 120 && Math.max(...c) - Math.min(...c) >= 50 && th(x, y) < prob) setRgb(img, x, y, mix(getRgb(img, x, y), c, 0.5));
      }
    }
    if (ns.streaks) {
      for (let x = 0; x < SCREEN_W; x++) {
        const c = getRgb(wall, x, h0 - 6);
        if (Math.max(...c) >= 170 && Math.max(...c) - Math.min(...c) >= 80) {
          const len = 18 + ((x * 7) % 14);
          for (let d = 0; d < len; d++) {
            const y = h0 + 2 + d;
            if (d % 3 !== 2 && th(x, y) < ns.streaks * (1 - d / len)) setRgb(img, x, y, mix(getRgb(img, x, y), c, 0.55));
          }
        }
      }
    }
  }

  // --- puddle reflections, kept away from every slot
  if (fl.reflections && fl.reflections.count > 0) {
    const cols = fl.reflections.colors.map(hexRgb);
    puddleSpots(stage, rand, ys, fl.reflections.count).forEach(({ cx, cy, a }, n) => {
      const b = Math.max(3, Math.floor(a / 4));
      const nc = cols[n % cols.length] ?? cols[0] ?? BLACK;
      for (let y = cy - b - 1; y < cy + b + 2; y++)
        for (let x = cx - a - 1; x < cx + a + 2; x++) {
          if (x < 0 || x >= SCREEN_W || y < ys || y >= y1) continue;
          const d = ((x + 0.5 - cx) / a) ** 2 + ((y + 0.5 - cy) / b) ** 2;
          if (d > 1) continue;
          let c = mix(getRgb(img, x, y), [12, 12, 24], 0.4);
          if (th(x, y) < (1 - d) * 0.9) c = mix(c, nc, 0.38);
          setRgb(img, x, y, c);
        }
      // A bright highlight line across the upper part of the puddle.
      const hy = cy - Math.max(1, Math.floor(b / 3));
      for (let x = cx - Math.floor(a / 2); x < cx + Math.floor(a / 3); x++) setRgb(img, x, hy, mix(getRgb(img, x, hy), nc, 0.85));
    });
  }

  // --- haze: the far floor dithers toward the fog colour
  if (fl.haze) {
    const fog = hexRgb(fl.haze.color);
    for (let y = ys; y < Math.min(y1, ys + fl.haze.reach); y++) {
      const amt = fl.haze.amount * (1 - (y - ys) / fl.haze.reach) ** 1.5;
      for (let x = 0; x < SCREEN_W; x++) if (th(x, y) < amt) setRgb(img, x, y, mix(getRgb(img, x, y), fog, 0.55));
    }
  }

  // --- an optional colour wash over the whole floor
  if (fl.tint) {
    const tc = hexRgb(fl.tint.color);
    for (let y = ys; y < y1; y++) for (let x = 0; x < SCREEN_W; x++) blendRgb(img, x, y, tc, fl.tint.amount);
  }
  return img;
}

/**
 * The wall for a "reproject" backdrop: the old picture slid by `shiftY` so its kerb row lands on the horizon, with
 * a dithered sky fade over the top rows (tower tops cut by the slide fade into the night sky instead of ending at a hard edge).
 * `source` is the old backdrop at 480x270.
 */
export function reprojectWall(source: Raw, stage: StageConfig): Raw {
  const bd = stage.backdrop;
  const h0 = bd.horizonY;
  const out: Raw = { w: SCREEN_W, h: SCREEN_H, data: new Uint8ClampedArray(SCREEN_W * SCREEN_H * 4) };
  for (let i = 0; i < SCREEN_W * SCREEN_H; i++) out.data[i * 4 + 3] = 255;
  for (let y = 0; y <= h0; y++) {
    const sy = y - bd.shiftY;
    if (sy < 0 || sy >= source.h) continue;
    out.data.set(source.data.subarray(sy * source.w * 4, (sy + 1) * source.w * 4), y * SCREEN_W * 4);
  }
  const sf = bd.skyFade;
  if (sf) {
    const sc = hexRgb(sf.color);
    for (let y = 0; y < sf.height; y++) {
      const p = sf.amount * (1 - y / sf.height) ** 1.1;
      for (let x = 0; x < SCREEN_W; x++) if (th(x, y) < p) setRgb(out, x, y, mix(getRgb(out, x, y), sc, 0.85));
    }
  }
  return out;
}
