/**
 * The sewer's back wall (Phaser spike `spike/phaser-stage`), ported from the design's mockup script
 * (`sewer_wall` in `render.py`). Pure pixel painting, no Phaser.
 *
 * Why a new wall? A backdrop in `mode: "replace"` is one whose old art cannot be slid and reused. The sewer's
 * old picture is a tunnel seen END-ON (walls running away to a vanishing point), which would contradict the
 * side-on camera the fighters are drawn for. So this paints a SIDE wall of the same tunnel instead, in the
 * sewer's own palette: slate planks, pale pillar ribs, the copper pipe, two amber wall lamps, the green-lit
 * grate as an outflow in the middle, and a water channel along the wall's base (behind the back row).
 *
 * `wallId` in the stage config names a painter; today there is one, "sewer-sidewall". `paintWall` is the
 * lookup, so a future stage with its own wall adds one entry.
 */
import wallsJson from '../data/sewerwall.json' with { type: 'json' };
import { SCREEN_H, SCREEN_W, type ScreenSize } from './config';
import { hexRgb, mix, newRaw, type Raw, type RGB, seeded, setRgb, getRgb, th } from './pixels';

/** Where a wall puts its pillars and lamps: columns of the 480x270 picture it paints, from `src/data/sewerwall.json` (no layout number is written in this file). */
interface WallLayout {
  pillars: number[];
  pillarGap: { center: number; halfWidth: number };
  lamps: number[];
}
const LAYOUTS = (wallsJson as { walls: Record<string, WallLayout> }).walls;

/** The layout data of the named wall. */
function layoutOf(wallId: string): WallLayout {
  const l = LAYOUTS[wallId];
  if (!l) throw new Error(`No layout data for the wall "${wallId}" in src/data/sewerwall.json`);
  return l;
}

/** The wall painters by id. */
const PAINTERS: Record<string, (horizon: number) => Raw> = {
  'sewer-sidewall': sewerSideWall,
};

/** The ids `paintWall` knows. */
export const WALL_IDS = Object.keys(PAINTERS);

/**
 * Paint the named wall down to the horizon (rows below it are plain wall colour, covered later by the floor).
 *
 * The painters draw for the 480x270 layout. On a larger `screen` (the 640x360 set) the wall is painted for 480x270 with its horizon moved up by `offset.y`, placed
 * at `offset` in the larger picture, and its edges are repeated outwards to fill the rest (a wall is the same along its length and up into the ceiling, so a repeated
 * edge reads as more wall). The offset is the stage's `backdrop.wallOffset`, so the placement is data and not a number in this file.
 */
export function paintWall(wallId: string, horizon: number, screen: ScreenSize = { w: SCREEN_W, h: SCREEN_H }, offset: { x: number; y: number } = { x: 0, y: 0 }): Raw {
  const paint = PAINTERS[wallId];
  if (!paint) throw new Error(`No wall painter "${wallId}" (there is: ${WALL_IDS.join(', ')})`);
  if (screen.w === SCREEN_W && screen.h === SCREEN_H) return paint(horizon);
  const base = paint(horizon - offset.y);
  const out = newRaw(screen.w, screen.h, [0, 0, 0]);
  for (let y = 0; y < screen.h; y++) {
    const sy = Math.min(base.h - 1, Math.max(0, y - offset.y));
    for (let x = 0; x < screen.w; x++) {
      const sx = Math.min(base.w - 1, Math.max(0, x - offset.x));
      const i = (sy * base.w + sx) * 4;
      const o = (y * screen.w + x) * 4;
      out.data[o] = base.data[i] ?? 0;
      out.data[o + 1] = base.data[i + 1] ?? 0;
      out.data[o + 2] = base.data[i + 2] ?? 0;
      out.data[o + 3] = base.data[i + 3] ?? 255;
    }
  }
  return out;
}

const P = {
  ceil: '#1d2527',
  wall: '#2c3638',
  plank: '#263032',
  plankLit: '#344042',
  beam: '#586a6c',
  beamLit: '#6b8080',
  beamDk: '#3c4a4c',
  pipe: '#514e41',
  pipeLit: '#7a6e52',
  pipeDk: '#35332b',
  lamp: '#ffcc76',
  glow: '#61ab93',
  gateBg: '#33574e',
  bar: '#1b4a40',
  water: '#10302a',
  water2: '#174038',
  water3: '#1b4a40',
  lip: '#4c5c60',
  stain: '#232c2e',
};
const C: Record<keyof typeof P, RGB> = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, hexRgb(v)])) as Record<keyof typeof P, RGB>;

function sewerSideWall(h0: number): Raw {
  const img = newRaw(SCREEN_W, SCREEN_H, C.wall);
  const layout = layoutOf('sewer-sidewall');
  const W = SCREEN_W;
  const put = (x: number, y: number, c: RGB): void => setRgb(img, x, y, c);

  // Wall planks: horizontal boards with a dark seam every 6 px and a lit row under it, with dithered wear.
  for (let y = 0; y < h0; y++)
    for (let x = 0; x < W; x++) {
      let c = C.wall;
      if (y % 6 === 0) c = C.plank;
      else if (y % 6 === 1 && th(x, y) < 0.35) c = C.plankLit;
      put(x, y, c);
    }
  // Ceiling band.
  for (let y = 0; y < 12; y++) for (let x = 0; x < W; x++) put(x, y, th(x, y) < 0.85 || y < 8 ? C.ceil : C.wall);

  // Stains running down from the pipe.
  const rand = seeded(5);
  const ri = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
  for (let n = 0; n < 26; n++) {
    const sx = ri(0, W - 1);
    const sy = ri(36, 44);
    const ln = ri(10, 40);
    for (let y = sy; y < Math.min(h0 - 18, sy + ln); y++) if (th(sx, y) < 0.7 * (1 - (y - sy) / ln)) put(sx, y, C.stain);
  }

  // The green-lit grate (an outflow in the side wall), centre of the screen, between the two sides.
  const gx0 = 212;
  const gx1 = 268;
  const gy0 = 44;
  const gy1 = 80;
  for (let y = gy0 - 16; y < gy1 + 10; y++)
    for (let x = gx0 - 24; x < gx1 + 24; x++) {
      const dx = Math.max(gx0 - x, 0, x - gx1) / 24;
      const dy = Math.max(gy0 - y, 0, y - gy1) / 16;
      const d = Math.hypot(dx, dy);
      if (d < 1 && th(x, y) < (1 - d) * 0.55) put(x, y, mix(getRgb(img, x, y), C.glow, 0.35));
    }
  for (let y = gy0; y < gy1; y++)
    for (let x = gx0; x < gx1; x++) {
      const t = (y - gy0) / (gy1 - gy0);
      let c = th(x, y) < 0.8 - t * 0.4 ? mix(C.glow, C.gateBg, t * 0.8) : C.gateBg;
      if ((x - gx0) % 7 === 0 || (x - gx0) % 7 === 1) c = C.bar;
      put(x, y, c);
    }
  // The grate's frame.
  for (let x = gx0 - 3; x < gx1 + 3; x++) for (const y of [gy0 - 3, gy0 - 2, gy1, gy1 + 1]) put(x, y, y === gy0 - 3 ? C.beamLit : C.beam);
  for (let y = gy0 - 3; y < gy1 + 2; y++) for (const x of [gx0 - 3, gx0 - 2, gx1 + 1, gx1 + 2]) put(x, y, x === gx0 - 3 ? C.beamLit : C.beam);
  // Outflow: a dithered waterfall from the grate down into the channel.
  for (let y = gy1 + 2; y < h0 - 2; y++)
    for (let x = gx0 + 6; x < gx1 - 6; x++) if (th(x, y + (x % 3)) < 0.5) put(x, y, (x + y) % 5 === 0 ? C.glow : C.water3);

  // Pillars (the old art's square ribs, now seen side-on), at the columns of the layout data.
  for (const cx of layout.pillars) {
    if (Math.abs(cx - layout.pillarGap.center) < layout.pillarGap.halfWidth) continue;
    for (let y = 8; y < h0 - 16; y++)
      for (let x = cx - 4; x < cx + 4; x++) {
        let c = x < cx + 2 ? C.beam : C.beamDk;
        if (x === cx - 4) c = C.beamLit;
        put(x, y, c);
      }
  }
  // Ceiling beam over the pillars.
  for (let x = 0; x < W; x++) for (let y = 8; y < 12; y++) put(x, y, y === 8 ? C.beamLit : y < 11 ? C.beam : C.beamDk);

  // Copper pipe running left to right, with brackets.
  for (let x = 0; x < W; x++) {
    if (x >= gx0 - 4 && x <= gx1 + 4) continue;
    const rows: Array<[number, RGB]> = [
      [30, C.pipeLit],
      [31, C.pipe],
      [32, C.pipe],
      [33, C.pipe],
      [34, C.pipeDk],
    ];
    for (const [y, c] of rows) put(x, y, c);
    if (x % 48 < 3) for (let y = 29; y < 36; y++) put(x, y, C.beamDk);
  }

  // Wall lamps with an amber dithered glow.
  for (const lx of layout.lamps) {
    for (let y = 36; y < 70; y++)
      for (let x = lx - 22; x < lx + 23; x++) {
        const d = Math.hypot((x - lx) / 22, (y - 50) / 16);
        if (d < 1 && th(x, y) < (1 - d) * 0.6) put(x, y, mix(getRgb(img, x, y), C.lamp, 0.22));
      }
    for (let y = 46; y < 53; y++) for (let x = lx - 2; x < lx + 3; x++) put(x, y, Math.abs(x - lx) < 2 && y >= 47 && y <= 51 ? C.lamp : C.pipeDk);
  }

  // The water channel along the wall base, then a concrete lip; the floor's kerb follows at the horizon.
  const ch0 = h0 - 16;
  for (let y = ch0 - 2; y < ch0; y++) for (let x = 0; x < W; x++) put(x, y, y === ch0 - 2 ? C.lip : C.beamDk);
  for (let y = ch0; y < h0; y++)
    for (let x = 0; x < W; x++) {
      let c = C.water;
      if ((x + 3 * y) % 23 < 6 && th(x, y) < 0.6) c = C.water2;
      if ((x * 7 + y * 13) % 41 < 3) c = C.water3;
      if (x > gx0 - 8 && x < gx1 + 8 && th(x, y) < 0.45) c = mix(C.water3, C.glow, 0.4);
      put(x, y, c);
    }
  return img;
}
