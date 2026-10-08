/**
 * Battle backgrounds at the battle world's resolution (BW×BH, half the screen, displayed at 2×).
 * Each has a static bake and an optional per-frame animation layer (rain, flicker, water, embers).
 */
import { surface, type Ctx } from '../engine/canvas';
import { mix, rgb, shade } from '../engine/color';
import { hash2, Rng } from '../engine/rng';
// The backdrop size is the battle world's (art/worldsize.ts, the one place it is defined), under
// the names the makers below use, so the world and its backdrops can never disagree on their size.
import { BHT as BH, BW } from './worldsize';

export const HORIZON = 62;

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

export interface BattleBg {
  canvas: HTMLCanvasElement;
  /** Emissive overlay drawn after the darkening tint (neon, lights). */
  glow?: HTMLCanvasElement;
  anim?: (ctx: Ctx, frame: number) => void;
  /** Ground line y where enemies stand. */
  ground: number;
  /**
   * Foreground framing, drawn over the fighters: dark silhouettes at the frame's edges (rails,
   * cables, pipes) that put the camera inside the place instead of in front of a backdrop.
   */
  fg?: HTMLCanvasElement | undefined;
  /** Tint applied to enemies (ambient light color) and its strength. */
  tint: string;
  tintAmt: number;
}

/** Vertical gradient with ordered dithering between palette steps. */
function ditherV(c: Ctx, x: number, y: number, w: number, h: number, stops: string[]): void {
  const cols = stops.map(rgb);
  const img = c.getImageData(x, y, w, h);
  const d = img.data;
  for (let yy = 0; yy < h; yy++) {
    const t = (yy / Math.max(1, h - 1)) * (cols.length - 1);
    const i0 = Math.floor(t);
    const f = t - i0;
    for (let xx = 0; xx < w; xx++) {
      const th = (BAYER[yy & 3]![xx & 3]! + 0.5) / 16;
      const cc = cols[Math.min(cols.length - 1, f > th ? i0 + 1 : i0)]!;
      const k = (yy * w + xx) * 4;
      d[k] = cc[0]; d[k + 1] = cc[1]; d[k + 2] = cc[2]; d[k + 3] = 255;
    }
  }
  c.putImageData(img, x, y);
}

function skyline(c: Ctx, g: Ctx, rng: Rng, base: number, minH: number, maxH: number, color: string, winColors: string[], winChance: number, signs = 0): void {
  let x = -rng.int(0, 10);
  while (x < BW) {
    const w = rng.int(10, 26);
    const h = rng.int(minH, maxH);
    const top = base - h;
    c.fillStyle = color;
    c.fillRect(x, top, w, h);
    // Rooftop landmarks: water towers, antennas with warning lights, billboards.
    const roof = rng.next();
    if (roof < 0.18 && w >= 12) {
      const tx = x + rng.int(2, w - 9);
      c.fillRect(tx + 1, top - 4, 1, 4);
      c.fillRect(tx + 6, top - 4, 1, 4);
      c.fillRect(tx, top - 10, 8, 6);
      c.fillRect(tx + 1, top - 12, 6, 2);
    } else if (roof < 0.4) {
      const ax = x + rng.int(2, Math.max(2, w - 4));
      const ah = rng.int(6, 14);
      c.fillRect(ax, top - ah, 1, ah);
      c.fillRect(ax - 1, top - ah + 3, 3, 1);
      g.fillStyle = '#ff3a3a';
      g.fillRect(ax, top - ah - 1, 1, 1);
    } else if (roof < 0.52 && w >= 14 && signs) {
      const bw = w - 4, bx = x + 2, by = top - 9;
      c.fillRect(bx + 2, top - 3, 1, 3);
      c.fillRect(bx + bw - 3, top - 3, 1, 3);
      const col = rng.pick(['#ff4fb0', '#3fe0f0', '#ffcc3d']);
      // Signs low enough to sit in the band where enemies' heads and HP bars are stay dark: a lit
      // bar there merges with the readouts.
      const lit = by < 44;
      for (const k of lit ? [c, g] : [c]) {
        k.fillStyle = lit ? col : '#1c1a28';
        k.fillRect(bx, by, bw, 6);
      }
      c.fillStyle = color;
      for (let i = bx + 2; i < bx + bw - 2; i += 3) c.fillRect(i, by + 2, 2, 2);
      c.fillStyle = color;
    } else if (roof < 0.7) c.fillRect(x + 2, top - 2, w - 4, 2);
    c.fillStyle = color;
    // Windows
    for (let wy = top + 3; wy < base - 2; wy += 3) {
      for (let wx = x + 2; wx < x + w - 1; wx += 2) {
        if (rng.chance(winChance)) {
          const col = rng.pick(winColors);
          c.fillStyle = col;
          c.fillRect(wx, wy, 1, 1);
          g.fillStyle = col;
          g.fillRect(wx, wy, 1, 1);
        }
      }
    }
    if (signs && rng.chance(signs)) {
      const col = rng.pick(['#ff4fb0', '#3fe0f0', '#ffcc3d', '#b07cff', '#62e06a']);
      const vertical = rng.chance(0.5);
      const sw = vertical ? 3 : rng.int(6, Math.max(7, w - 4));
      const sh = vertical ? rng.int(8, 16) : 3;
      const sx = x + rng.int(1, Math.max(1, w - sw - 1));
      const sy = top + rng.int(3, Math.max(4, h - sh - 4));
      for (const k of [c, g]) {
        k.fillStyle = col;
        k.fillRect(sx, sy, sw, sh);
        k.fillStyle = mix(col, '#ffffff', 0.5);
        k.fillRect(sx, sy, sw, 1);
      }
    }
    x += w + rng.int(0, 3);
  }
}

/** Perspective floor: rows get taller toward the viewer; optional converging lines. */
function floor(c: Ctx, top: number, colA: string, colB: string, lines: string | null, vpX = BW / 2, nLines = 9): void {
  let y = top;
  let h = 1.2;
  let i = 0;
  while (y < BH) {
    c.fillStyle = i % 2 === 0 ? colA : colB;
    c.fillRect(0, Math.round(y), BW, Math.ceil(h) + 1);
    y += h;
    h *= 1.28;
    i++;
  }
  if (lines) {
    c.fillStyle = lines;
    for (let k = -nLines; k <= nLines; k++) {
      const bx = vpX + k * 38;
      for (let yy = top; yy < BH; yy++) {
        const t = (yy - top) / (BH - top);
        const xx = vpX + (bx - vpX) * t * 1.6;
        if (xx >= 0 && xx < BW) c.fillRect(Math.round(xx), yy, 1, 1);
      }
    }
  }
}

/**
 * The street's midground: a row of Lower Wards frontages standing on the far kerb (a noodle bar,
 * a capsule hotel, a pawn shop, a shuttered unit), with lit windows, neon signs, striped awnings,
 * lamp posts and a vending machine between them. Emissive parts go in the glow layer.
 */
function storefronts(c: Ctx, g: Ctx, rng: Rng, base: number): void {
  const neon = ['#ff4fb0', '#3fe0f0', '#ffcc3d', '#62e06a', '#b07cff'];
  const walls = ['#1a1830', '#221a34', '#16202e', '#241a26'];
  let x = -6;
  let i = 0;
  while (x < BW + 4) {
    const w = rng.int(30, 46), h = rng.int(20, 30), top = base - h;
    const wall = walls[i % walls.length]!;
    c.fillStyle = wall;
    c.fillRect(x, top, w, h);
    c.fillStyle = shade(wall, 0.25);
    c.fillRect(x, top, w, 1);
    const shut = i % 4 === 3;
    // Shopfront: a lit window (or a rolled shutter) at street level.
    const wx = x + 3, wy = base - 11, ww = w - 6;
    if (shut) {
      c.fillStyle = '#2e2c3a';
      c.fillRect(wx, wy, ww, 11);
      c.fillStyle = '#23212e';
      for (let yy = wy + 1; yy < base; yy += 2) c.fillRect(wx, yy, ww, 1);
    } else {
      const warm = rng.pick(['#ffd98a', '#ffb46a', '#8ad8ff', '#ffe0c0']);
      c.fillStyle = mix(warm, '#0a0814', 0.78);
      c.fillRect(wx, wy, ww, 10);
      // Lit, but across the street: dim enough that the fight in front stays the brightest thing.
      g.globalAlpha = 0.2;
      g.fillStyle = warm;
      g.fillRect(wx + 1, wy + 1, ww - 2, 8);
      g.globalAlpha = 1;
      // Figures behind the glass: the place is open.
      c.fillStyle = '#0c0b16';
      for (let k = 0; k < 2; k++) {
        const fx = wx + 3 + rng.int(0, Math.max(1, ww - 8));
        c.fillRect(fx, wy + 4, 3, 6);
        c.fillRect(fx + 1, wy + 2, 2, 2);
      }
      // A striped awning over the window.
      const aw = rng.pick(['#8c2f39', '#2f6a5a', '#6a3fa0', '#a0652f']);
      for (let ax = wx - 1; ax < wx + ww + 1; ax++) {
        c.fillStyle = (ax - wx) % 4 < 2 ? aw : shade(aw, 0.3);
        c.fillRect(ax, wy - 3, 1, 3);
      }
    }
    // A neon sign above: a bar of light with a glyph block, some on the wall, some hung out.
    const col = neon[(i * 3 + 1) % neon.length]!;
    const sw = Math.min(w - 8, rng.int(14, 24)), sx = x + Math.round((w - sw) / 2), sy = top + 3;
    c.fillStyle = mix(col, '#0a0814', 0.82);
    c.fillRect(sx, sy, sw, 5);
    g.globalAlpha = 0.55;
    g.fillStyle = col;
    g.fillRect(sx, sy, sw, 1);
    g.fillRect(sx, sy + 4, sw, 1);
    for (let gx = sx + 2; gx < sx + sw - 2; gx += 3) g.fillRect(gx, sy + 2, 2, 1);
    g.globalAlpha = 1;
    // Upper-floor windows, a few lit.
    for (let wy2 = top + 10; wy2 < wy - 5; wy2 += 5)
      for (let wx2 = x + 3; wx2 < x + w - 4; wx2 += 6) {
        c.fillStyle = '#0e0d18';
        c.fillRect(wx2, wy2, 3, 3);
        if (hash2(wx2, wy2, 7) < 0.3) {
          g.globalAlpha = 0.35;
          g.fillStyle = rng.pick(['#ffd98a', '#8ad8ff']);
          g.fillRect(wx2, wy2, 3, 3);
          g.globalAlpha = 1;
        }
      }
    x += w;
    // Between buildings: a lamp post, or a vending machine against the wall.
    if (i % 2 === 0) {
      c.fillStyle = '#2a2a3c';
      c.fillRect(x + 1, base - 22, 1, 22);
      c.fillRect(x - 1, base - 22, 5, 1);
      g.fillStyle = '#ffe0b0';
      g.fillRect(x, base - 21, 3, 1);
      g.globalAlpha = 0.25;
      g.fillRect(x - 3, base - 20, 9, 4);
      g.globalAlpha = 1;
      x += 4;
    } else {
      c.fillStyle = '#2c3a5a';
      c.fillRect(x, base - 12, 6, 12);
      g.globalAlpha = 0.45;
      g.fillStyle = '#9ae8ff';
      g.fillRect(x + 1, base - 11, 4, 5);
      g.fillStyle = '#ff4fb0';
      g.fillRect(x + 1, base - 5, 4, 1);
      g.globalAlpha = 1;
      x += 7;
    }
    i++;
  }
}

function reflections(g: Ctx, top: number, rng: Rng, colors: string[], n: number): void {
  for (let i = 0; i < n; i++) {
    const x = rng.int(0, BW - 1);
    const col = rng.pick(colors);
    const len = rng.int(8, 30);
    for (let y = top + 1; y < top + len && y < BH; y++) {
      if (hash2(x, y, 3) < 0.35) continue;
      g.globalAlpha = 0.35 * (1 - (y - top) / len);
      g.fillStyle = col;
      g.fillRect(x, y, 1 + (i % 2), 1);
    }
  }
  g.globalAlpha = 1;
}

function rain(ctx: Ctx, frame: number, n = 70, color = '#aab8ff', alpha = 0.35): void {
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  for (let i = 0; i < n; i++) {
    const sx = (hash2(i, 1) * BW * 1.3 + frame * 1.2) % (BW * 1.3) - 20;
    const sy = (hash2(i, 2) * BH + frame * (3.5 + hash2(i, 3) * 1.5)) % BH;
    ctx.fillRect(Math.round(sx), Math.round(sy), 1, 3);
    ctx.fillRect(Math.round(sx) - 1, Math.round(sy) + 3, 1, 1);
  }
  ctx.globalAlpha = 1;
}

type Maker = () => BattleBg;

const MAKERS: Record<string, Maker> = {
  street: () => {
    const s = surface(BW, BH), gl = surface(BW, BH);
    const c = s.ctx, g = gl.ctx;
    const rng = new Rng(11);
    ditherV(c, 0, 0, BW, HORIZON + 4, ['#07061a', '#120c2e', '#2a1446', '#4a1e58', '#6a2a60']);
    skyline(c, g, rng, HORIZON + 2, 18, 46, '#1c1636', ['#6a7ab8', '#8a6ab8', '#4a5a98'], 0.08);
    skyline(c, g, rng, HORIZON + 4, 10, 34, '#110e22', ['#ffd98a', '#8ad8ff', '#ff8ad0'], 0.13, 0.45);
    // The far kerb: the street's own shops, not only a distant skyline.
    storefronts(c, g, new Rng(29), HORIZON + 4);
    floor(c, HORIZON + 4, '#1a1a2c', '#1e1e32', '#2a2a44');
    // Lane markings
    c.fillStyle = '#6a5a2a';
    for (let y = HORIZON + 8; y < BH; y += 9) c.fillRect(BW / 2 - 1, y, 2, Math.max(1, Math.round((y - HORIZON) / 8)));
    reflections(g, HORIZON + 4, rng, ['#ff4fb0', '#3fe0f0', '#ffcc3d', '#b07cff'], 14);
    // Curbs
    c.fillStyle = '#2a2a40';
    c.fillRect(0, HORIZON + 4, BW, 1);
    return { canvas: s.canvas, glow: gl.canvas, ground: 94, tint: '#3a3a7a', tintAmt: 0.25, anim: (ctx, f) => rain(ctx, f) };
  },
  barrens: () => {
    const s = surface(BW, BH), gl = surface(BW, BH);
    const c = s.ctx, g = gl.ctx;
    const rng = new Rng(21);
    ditherV(c, 0, 0, BW, HORIZON + 4, ['#1a1026', '#3a1a32', '#6a2a36', '#a2503a', '#c8703e']);
    // Hazy sun
    for (let r = 14; r > 0; r -= 3) {
      c.fillStyle = mix('#ffb46a', '#c8703e', r / 14);
      c.beginPath();
      c.arc(170, HORIZON - 8, r, 0, Math.PI * 2);
      c.fill();
    }
    // Ruins with broken tops
    let x = 0;
    while (x < BW) {
      const w = rng.int(12, 28), h = rng.int(12, 34);
      c.fillStyle = '#2a1a22';
      c.beginPath();
      c.moveTo(x, HORIZON + 4);
      c.lineTo(x, HORIZON + 4 - h);
      for (let k = 0; k < 4; k++) c.lineTo(x + (w * (k + 1)) / 4, HORIZON + 4 - h + rng.int(-2, 8));
      c.lineTo(x + w, HORIZON + 4);
      c.fill();
      for (let wy = HORIZON + 8 - h; wy < HORIZON; wy += 4) for (let wx = x + 2; wx < x + w - 2; wx += 4) if (rng.chance(0.3)) { c.fillStyle = '#1a0e14'; c.fillRect(wx, wy, 2, 2); }
      x += w + rng.int(4, 20);
    }
    floor(c, HORIZON + 4, '#4a3428', '#523a2c', null);
    for (let i = 0; i < 90; i++) {
      const yy = rng.int(HORIZON + 6, BH - 1);
      const sz = 1 + Math.floor((yy - HORIZON) / 18);
      c.fillStyle = rng.pick(['#3a2820', '#6a5040', '#5a4436']);
      c.fillRect(rng.int(0, BW), yy, sz + rng.int(0, 2), sz);
    }
    void g;
    return {
      canvas: s.canvas, glow: gl.canvas, ground: 94, tint: '#a0603a', tintAmt: 0.15,
      anim: (ctx, f) => {
        ctx.fillStyle = '#e8c8a0';
        ctx.globalAlpha = 0.35;
        for (let i = 0; i < 40; i++) ctx.fillRect(Math.round((hash2(i, 5) * BW + f * (0.4 + hash2(i, 6))) % BW), Math.round(hash2(i, 7) * BH + Math.sin(f * 0.02 + i) * 3), 1, 1);
        ctx.globalAlpha = 1;
      },
    };
  },
  rustyard: () => {
    const s = surface(BW, BH), gl = surface(BW, BH);
    const c = s.ctx, g = gl.ctx;
    const rng = new Rng(31);
    ditherV(c, 0, 0, BW, HORIZON + 4, ['#0a0816', '#1a1030', '#34183a', '#5a2438']);
    // Crane
    c.fillStyle = '#1a1220';
    c.fillRect(40, 8, 3, HORIZON - 4);
    c.fillRect(20, 10, 70, 3);
    c.fillRect(80, 12, 1, 20);
    g.fillStyle = '#ff3a3a';
    g.fillRect(41, 6, 1, 1);
    // Scrap mounds
    for (let i = 0; i < 7; i++) {
      const cx = rng.int(0, BW), w = rng.int(30, 60), h = rng.int(10, 26);
      c.fillStyle = rng.pick(['#241a26', '#2a1e28', '#1e1622']);
      c.beginPath();
      c.moveTo(cx - w / 2, HORIZON + 4);
      for (let k = 0; k <= 8; k++) c.lineTo(cx - w / 2 + (w * k) / 8, HORIZON + 4 - Math.sin((k / 8) * Math.PI) * h + rng.int(-2, 2));
      c.fill();
    }
    // Tent with lantern glow
    c.fillStyle = '#3a2a1e';
    c.beginPath();
    c.moveTo(150, HORIZON + 4);
    c.lineTo(166, HORIZON - 10);
    c.lineTo(182, HORIZON + 4);
    c.fill();
    g.fillStyle = '#ffa24a';
    g.fillRect(164, HORIZON - 2, 4, 6);
    floor(c, HORIZON + 4, '#2e2420', '#34281f', null);
    for (let i = 0; i < 70; i++) {
      const yy = rng.int(HORIZON + 6, BH - 1);
      const sz = 1 + Math.floor((yy - HORIZON) / 16);
      c.fillStyle = rng.pick(['#5a5e6c', '#6a4a36', '#3a3d48', '#8a5a3a']);
      c.fillRect(rng.int(0, BW), yy, sz + rng.int(0, 3), sz);
    }
    return {
      canvas: s.canvas, glow: gl.canvas, ground: 94, tint: '#8a4a3a', tintAmt: 0.18,
      anim: (ctx, f) => {
        for (let i = 0; i < 14; i++) {
          const t = (f * 0.6 + i * 23) % 60;
          ctx.fillStyle = t < 20 ? '#ffe07a' : '#ff7a2a';
          ctx.globalAlpha = 1 - t / 60;
          ctx.fillRect(Math.round(166 + Math.sin(i + f * 0.05) * 8), Math.round(HORIZON - t * 0.8), 1, 1);
        }
        ctx.globalAlpha = 1;
      },
    };
  },
  park: () => {
    const s = surface(BW, BH), gl = surface(BW, BH);
    const c = s.ctx, g = gl.ctx;
    const rng = new Rng(41);
    ditherV(c, 0, 0, BW, HORIZON + 4, ['#040a14', '#0a1a24', '#0f2a2e', '#1a3a34']);
    // Mana aurora ribbons
    for (let r = 0; r < 3; r++) {
      const col = ['#3fe0a0', '#3fb8e0', '#8a6aff'][r]!;
      for (let x = 0; x < BW; x++) {
        const y = 14 + r * 8 + Math.sin(x * 0.04 + r * 2) * 6;
        for (let k = 0; k < 6; k++) {
          if (hash2(x, k + r * 10, 9) < 0.5) continue;
          g.globalAlpha = 0.35 * (1 - k / 6);
          g.fillStyle = col;
          g.fillRect(x, Math.round(y + k), 1, 1);
        }
      }
    }
    g.globalAlpha = 1;
    // Giant trees
    for (let i = 0; i < 6; i++) {
      const tx = 10 + i * 44 + rng.int(-8, 8);
      c.fillStyle = '#0a1612';
      c.fillRect(tx - 3, HORIZON - 20, 7, 26);
      for (let k = 0; k < 5; k++) {
        c.beginPath();
        c.arc(tx + rng.int(-14, 14), HORIZON - 24 - rng.int(0, 16), rng.int(10, 16), 0, Math.PI * 2);
        c.fill();
      }
      for (let k = 0; k < 10; k++) {
        g.fillStyle = rng.pick(['#62e06a', '#3fe0f0', '#b07cff']);
        g.fillRect(tx + rng.int(-20, 20), HORIZON - 44 + rng.int(0, 30), 1, 1);
      }
    }
    floor(c, HORIZON + 4, '#14281e', '#183022', null);
    for (let i = 0; i < 60; i++) {
      const x = rng.int(0, BW), y = rng.int(HORIZON + 6, BH - 1);
      const col = rng.pick(['#62e06a', '#3fe0f0', '#ff6fc8', '#2a5a3a', '#2a5a3a']);
      c.fillStyle = col;
      c.fillRect(x, y, 1, 1 + Math.floor((y - HORIZON) / 20));
      if (col !== '#2a5a3a') { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
    }
    return {
      canvas: s.canvas, glow: gl.canvas, ground: 94, tint: '#2a6a5a', tintAmt: 0.2,
      anim: (ctx, f) => {
        for (let i = 0; i < 18; i++) {
          const x = (hash2(i, 1) * BW + Math.sin(f * 0.01 + i) * 10) % BW;
          const y = HORIZON + 10 + ((hash2(i, 2) * 60 - f * 0.15 * (1 + hash2(i, 3))) % 60 + 60) % 60 - 20;
          ctx.globalAlpha = 0.5 + 0.5 * Math.sin(f * 0.1 + i);
          ctx.fillStyle = '#b8ff9a';
          ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
        }
        ctx.globalAlpha = 1;
      },
    };
  },
  sewer: () => {
    // A brick storm-drain tunnel in one-point perspective: lit far opening as the focal point,
    // stone ribs with wall lamps, raised walkways either side of a green-black channel.
    const s = surface(BW, BH), gl = surface(BW, BH);
    const c = s.ctx, g = gl.ctx;
    const vx = BW / 2, vy = 56;
    // Far opening (x 104..136, y 40..72) and the near frame of the tunnel mouth.
    const fx0 = 104, fx1 = 136, fy0 = 40, fy1 = 72;
    ditherV(c, 0, 0, BW, BH, ['#141c1e', '#1a2426', '#1e2a2c']);
    // Side walls and ceiling: brick courses converging on the vanishing point.
    const wall = (x0: number, x1: number, edgeX: number) => {
      c.fillStyle = '#2c3638';
      c.beginPath();
      c.moveTo(edgeX, 0); c.lineTo(x0, fy0); c.lineTo(x1, fy1); c.lineTo(edgeX, 104);
      c.fill();
    };
    wall(fx0, fx0, 0);
    wall(fx1, fx1, BW);
    c.fillStyle = '#263032';
    c.beginPath();
    c.moveTo(0, 0); c.lineTo(BW, 0); c.lineTo(fx1, fy0); c.lineTo(fx0, fy0);
    c.fill();
    // Courses (mortar lines) on the walls: from the screen edge to the far frame.
    c.strokeStyle = '#1c2426';
    c.lineWidth = 1;
    for (let i = 1; i < 14; i++) {
      const ey = i * 8;
      if (ey > 104) break;
      const t = ey / 104;
      for (const [edge, fx] of [[0, fx0], [BW, fx1]] as const) {
        c.beginPath();
        c.moveTo(edge, ey);
        c.lineTo(fx, fy0 + (fy1 - fy0) * t);
        c.stroke();
      }
    }
    // Pipes along the left wall, tapering toward the far end (behind the ribs).
    for (const [ey, col] of [[16, '#5a4032'], [23, '#4a3a30']] as const) {
      const fy = fy0 + (fy1 - fy0) * (ey / 104);
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(0, ey - 2); c.lineTo(fx0, fy - 0.5); c.lineTo(fx0, fy + 0.5); c.lineTo(0, ey + 2);
      c.fill();
      c.fillStyle = shade(col, 0.35);
      c.beginPath();
      c.moveTo(0, ey - 2); c.lineTo(fx0, fy - 0.5); c.lineTo(fx0, fy); c.lineTo(0, ey - 1);
      c.fill();
    }
    // Ribs: stone arches at perspective depths, each with a lamp and its light pool.
    const depths = [0.08, 0.2, 0.36, 0.56, 0.8];
    depths.forEach((d, i) => {
      const lx = fx0 * d, rx = BW - (BW - fx1) * d;
      const top = fy0 * d, bot = 104 + (fy1 - 104) * d;
      const w = Math.max(1, Math.round(5 * (1 - d)));
      const lit = shade('#5a6c6e', -d * 0.45);
      c.fillStyle = lit;
      c.fillRect(Math.round(lx), Math.round(top), w, Math.round(bot - top));
      c.fillRect(Math.round(rx) - w, Math.round(top), w, Math.round(bot - top));
      c.fillRect(Math.round(lx), Math.round(top), Math.round(rx - lx), w);
      c.fillStyle = shade(lit, 0.25);
      c.fillRect(Math.round(lx), Math.round(top), Math.round(rx - lx), 1);
      if (i % 2 === 0) {
        const ly = Math.round(top + (bot - top) * 0.35);
        for (const [x, side] of [[lx + w + 1, 1], [rx - w - 2, -1]] as const) {
          c.fillStyle = '#1a1614';
          c.fillRect(Math.round(x), ly - 1, 2, 3);
          g.fillStyle = '#ffd07a';
          g.fillRect(Math.round(x), ly, 2, 1);
          const r = 16 * (1 - d * 0.6);
          const grd = g.createRadialGradient(x, ly, 0, x, ly, r);
          grd.addColorStop(0, 'rgba(255,196,110,0.35)');
          grd.addColorStop(1, 'rgba(255,196,110,0)');
          g.fillStyle = grd;
          g.fillRect(Math.round(x - r + side * 2), ly - r, r * 2, r * 2);
        }
      }
    });
    // Far opening: pale green light spilling from the next chamber.
    c.fillStyle = '#3a6a5e';
    c.fillRect(fx0, fy0, fx1 - fx0, fy1 - fy0);
    c.fillStyle = '#5a9a86';
    c.fillRect(fx0 + 4, fy0 + 4, fx1 - fx0 - 8, fy1 - fy0 - 10);
    c.fillStyle = '#1e2a2c';
    for (let x = fx0 + 6; x < fx1 - 4; x += 5) c.fillRect(x, fy0 + 4, 1, fy1 - fy0 - 10);
    const far = g.createRadialGradient(vx, vy, 0, vx, vy, 40);
    far.addColorStop(0, 'rgba(120,230,190,0.28)');
    far.addColorStop(1, 'rgba(120,230,190,0)');
    g.fillStyle = far;
    g.fillRect(vx - 40, vy - 40, 80, 80);
    // Walkways (lighter concrete) and the channel between them.
    c.fillStyle = '#4a5456';
    c.beginPath();
    c.moveTo(0, 104); c.lineTo(fx0, fy1); c.lineTo(fx0 + 8, fy1); c.lineTo(62, BH); c.lineTo(0, BH);
    c.fill();
    c.beginPath();
    c.moveTo(BW, 104); c.lineTo(fx1, fy1); c.lineTo(fx1 - 8, fy1); c.lineTo(BW - 62, BH); c.lineTo(BW, BH);
    c.fill();
    c.fillStyle = '#6a7678';
    c.beginPath();
    c.moveTo(fx0 + 8, fy1); c.lineTo(62, BH); c.lineTo(59, BH); c.lineTo(fx0 + 7, fy1);
    c.fill();
    c.beginPath();
    c.moveTo(fx1 - 8, fy1); c.lineTo(BW - 62, BH); c.lineTo(BW - 59, BH); c.lineTo(fx1 - 7, fy1);
    c.fill();
    c.fillStyle = '#10302a';
    c.beginPath();
    c.moveTo(fx0 + 8, fy1); c.lineTo(fx1 - 8, fy1); c.lineTo(BW - 62, BH); c.lineTo(62, BH);
    c.fill();
    // Ripple bands on the water, denser toward the far end.
    for (let i = 0; i < 12; i++) {
      const t = (i / 12) ** 1.6;
      const y = Math.round(fy1 + 2 + t * (BH - fy1 - 2));
      const half = 8 + ((BW / 2 - 62) - 8) * ((y - fy1) / (BH - fy1));
      c.fillStyle = i % 2 ? '#174038' : '#1b4a40';
      c.fillRect(Math.round(vx - half + 3), y, Math.round(half * 2 - 6), 1);
    }
    reflections(g, 76, new Rng(5), ['#ffd07a', '#78e6be'], 8);
    return {
      canvas: s.canvas, glow: gl.canvas, ground: 96, tint: '#2a5a5a', tintAmt: 0.18,
      anim: (ctx, f) => {
        // Drips from the ceiling into the channel.
        for (let i = 0; i < 6; i++) {
          const x = Math.round(70 + hash2(i, 4) * 100);
          const t = (f + i * 37) % 90;
          ctx.fillStyle = '#8ab8c8';
          ctx.globalAlpha = 0.7;
          if (t < 50) ctx.fillRect(x, 8 + t * 1.8, 1, 2);
          else ctx.fillRect(x - (t - 50) / 6, 98, 1 + (t - 50) / 4, 1);
        }
        // Water shimmer along the channel.
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = '#6ad0b0';
        for (let i = 0; i < 18; i++) {
          const y = fy1 + 4 + hash2(i, 8) * (BH - fy1 - 6);
          const half = 8 + ((BW / 2 - 62) - 8) * ((y - fy1) / (BH - fy1));
          const x = vx + (hash2(i, 9) - 0.5) * half * 1.6 + Math.sin(f * 0.05 + i) * 2;
          ctx.fillRect(Math.round(x), Math.round(y), 2, 1);
        }
        ctx.globalAlpha = 1;
      },
    };
  },
  junction: () => {
    const s = surface(BW, BH), gl = surface(BW, BH);
    const c = s.ctx, g = gl.ctx;
    const rng = new Rng(61);
    ditherV(c, 0, 0, BW, 80, ['#040808', '#0a1414', '#102020', '#163030']);
    // Columns
    for (let i = 0; i < 7; i++) {
      const x = 8 + i * 36 + rng.int(-3, 3);
      const w = 10 + (i % 2) * 4;
      c.fillStyle = '#1a2626';
      c.fillRect(x, 0, w, 84);
      c.fillStyle = '#243434';
      c.fillRect(x, 0, 2, 84);
      c.fillStyle = '#0e1818';
      c.fillRect(x + w - 2, 0, 2, 84);
      // Algae glow
      for (let k = 0; k < 6; k++) { g.fillStyle = '#4affb0'; g.fillRect(x + rng.int(1, w - 2), rng.int(40, 80), 1, 1); }
    }
    // Deep water
    ditherV(c, 0, 76, BW, BH - 76, ['#0c2a26', '#0a2220', '#06181a']);
    return {
      canvas: s.canvas, glow: gl.canvas, ground: 104, tint: '#2a6a5a', tintAmt: 0.25,
      anim: (ctx, f) => {
        ctx.fillStyle = '#5aa89a';
        for (let i = 0; i < 40; i++) {
          const y = 78 + (i % 10) * 6;
          const x = (hash2(i, 2) * BW + f * (0.2 + (y - 76) / 120)) % BW;
          ctx.globalAlpha = 0.25 + 0.2 * Math.sin(f * 0.08 + i);
          ctx.fillRect(Math.round(x), y, 3 + (y - 76) / 12, 1);
        }
        ctx.globalAlpha = 1;
      },
    };
  },
  lab: () => {
    const s = surface(BW, BH), gl = surface(BW, BH);
    const c = s.ctx, g = gl.ctx;
    ditherV(c, 0, 0, BW, HORIZON + 4, ['#8a96a8', '#a8b4c4', '#bcc6d4']);
    // Wall panels
    c.fillStyle = '#98a4b6';
    for (let x = 0; x < BW; x += 24) c.fillRect(x, 8, 1, HORIZON - 4);
    c.fillRect(0, 44, BW, 1);
    // Cyan stripe
    for (const k of [c, g]) { k.fillStyle = '#2fb8c8'; k.fillRect(0, 48, BW, 2); }
    // Ceiling light strips
    for (const k of [c, g]) { k.fillStyle = '#eaf6ff'; for (let x = 10; x < BW; x += 48) k.fillRect(x, 2, 28, 2); }
    // Observation windows with tanks. They sit at the height of the enemies' heads, so they're
    // kept dim and cool: set dressing, not a second focal point.
    for (let i = 0; i < 4; i++) {
      const x = 14 + i * 60;
      c.fillStyle = '#2a3a4a';
      c.fillRect(x, 16, 30, 24);
      c.fillStyle = '#2e4c5a';
      c.fillRect(x + 2, 18, 26, 20);
      c.fillStyle = '#3e8a80';
      c.fillRect(x + 12, 22, 6, 14);
      c.fillStyle = '#24605a';
      c.fillRect(x + 14, 26, 2, 6);
      g.globalAlpha = 0.3;
      g.fillStyle = '#6affe0';
      g.fillRect(x + 12, 22, 6, 14);
      g.globalAlpha = 1;
    }
    // Readout monitors between the windows (content animates).
    for (let i = 0; i < 3; i++) {
      const x = 46 + i * 60;
      c.fillStyle = '#2a3440';
      c.fillRect(x - 1, 17, 18, 16);
      c.fillStyle = '#0c1a22';
      c.fillRect(x, 18, 16, 14);
    }
    floor(c, HORIZON + 4, '#9aa6b6', '#a6b2c2', '#7a8698');
    return {
      canvas: s.canvas, glow: gl.canvas, ground: 94, tint: '#8ac8e8', tintAmt: 0.1,
      anim: (ctx, f) => {
        for (let i = 0; i < 3; i++) {
          const x = 46 + i * 60;
          if (i === 1) {
            // Vital-sign trace sweeping left to right.
            const head = Math.floor(f / 2) % 16;
            for (let k = 0; k < 16; k++) {
              const age = (head - k + 16) % 16;
              if (age > 12) continue;
              const phase = (k + Math.floor(f / 32) * 5) % 16;
              const y = phase === 6 ? 20 : phase === 7 ? 29 : phase === 8 ? 23 : 25;
              ctx.globalAlpha = 0.6 * (1 - age / 13);
              ctx.fillStyle = '#6affa0';
              ctx.fillRect(x + k, y, 1, 1);
            }
          } else {
            // Scrolling telemetry: rows of dashes of varying length.
            for (let r = 0; r < 4; r++) {
              const n = Math.floor(f / 20) + r + i * 7;
              const len = 3 + Math.floor(hash2(n, i) * 11);
              ctx.globalAlpha = 0.5;
              ctx.fillStyle = r === 0 && Math.floor(f / 15) % 2 ? '#ffd07a' : '#6ad8ff';
              ctx.fillRect(x + 2, 20 + r * 3, len, 1);
            }
          }
        }
        // Bubbles rising in the specimen tanks.
        ctx.fillStyle = '#d8fff4';
        for (let i = 0; i < 4; i++) {
          for (let b = 0; b < 2; b++) {
            const t = (f * 0.4 + b * 17 + i * 9) % 30;
            ctx.globalAlpha = 0.45;
            ctx.fillRect(14 + i * 60 + 13 + ((b + i) % 2) * 3, Math.round(36 - t * 0.45), 1, 1);
          }
        }
        ctx.globalAlpha = 1;
      },
    };
  },
  core: () => {
    const s = surface(BW, BH), gl = surface(BW, BH);
    const c = s.ctx, g = gl.ctx;
    ditherV(c, 0, 0, BW, HORIZON + 4, ['#0a0612', '#1a0a1e', '#2a0e24']);
    // Back wall: server racks with blinking status lights, pipes along the ceiling.
    for (let x = 4; x < BW; x += 26) {
      if (Math.abs(x + 9 - BW / 2) < 58) continue; // leave the containment ring clear
      c.fillStyle = '#140c1a'; c.fillRect(x, 18, 18, HORIZON - 22);
      c.fillStyle = '#221628'; c.fillRect(x + 1, 19, 16, 1);
      for (let y = 24; y < HORIZON - 8; y += 5) {
        c.fillStyle = '#1c1224'; c.fillRect(x + 2, y, 14, 3);
        for (const k of [c, g]) { k.fillStyle = (x + y) % 3 ? '#62e06a' : '#ff5a4a'; k.fillRect(x + 3 + ((x * 7 + y) % 9), y + 1, 1, 1); }
      }
    }
    for (const [y, col] of [[4, '#2a2030'], [8, '#241a2a'], [11, '#30243a']] as const) {
      c.fillStyle = col; c.fillRect(0, y, BW, 2);
      for (let x = 12; x < BW; x += 30) { c.fillStyle = '#3a3040'; c.fillRect(x, y - 1, 3, 4); }
    }
    // Coolant towers either side, lit bands glowing.
    for (const tx of [14, BW - 30]) {
      c.fillStyle = '#1a1422'; c.fillRect(tx, 14, 16, HORIZON - 12);
      c.fillStyle = '#2a2034'; c.fillRect(tx + 2, 14, 3, HORIZON - 12);
      for (let y = 20; y < HORIZON; y += 9) for (const k of [c, g]) { k.fillStyle = '#6ff3ff'; k.fillRect(tx + 1, y, 14, 1); }
    }
    // Containment ring
    for (let r = 50; r > 30; r -= 1) {
      c.strokeStyle = r % 4 === 0 ? '#3a3040' : '#2a2030';
      c.beginPath();
      c.arc(BW / 2, 44, r, 0, Math.PI * 2);
      c.stroke();
    }
    for (let a = 0; a < 16; a++) {
      const x = BW / 2 + Math.cos((a / 16) * Math.PI * 2) * 40, y = 44 + Math.sin((a / 16) * Math.PI * 2) * 40;
      for (const k of [c, g]) { k.fillStyle = '#8a6aff'; k.fillRect(Math.round(x), Math.round(y), 2, 2); }
    }
    // Catwalk rails
    c.fillStyle = '#3a3d48';
    c.fillRect(0, HORIZON - 6, BW, 2);
    for (let x = 0; x < BW; x += 10) c.fillRect(x, HORIZON - 6, 1, 10);
    floor(c, HORIZON + 4, '#2a2a34', '#30303a', '#3a3a48');
    // Hazard stripes
    for (let x = 0; x < BW; x++) { c.fillStyle = Math.floor(x / 4) % 2 ? '#d8b02a' : '#1a1820'; c.fillRect(x, HORIZON + 4, 1, 2); }
    return {
      canvas: s.canvas, glow: gl.canvas, ground: 98, tint: '#6a2a4a', tintAmt: 0.2,
      anim: (ctx, f) => {
        // Alarm: a lighter red pulse, and two beacon beams sweeping the ceiling.
        const a = 0.06 + 0.05 * Math.sin(f * 0.1);
        ctx.fillStyle = '#ff2a3a';
        ctx.globalAlpha = a;
        ctx.fillRect(0, 0, BW, BH);
        for (const [bx, ph] of [[22, 0], [BW - 22, Math.PI]] as const) {
          const ang = Math.sin(f * 0.05 + ph) * 0.9;
          ctx.globalAlpha = 0.18;
          for (let r = 4; r < 70; r += 2) {
            const w = Math.round(r * 0.35);
            ctx.fillRect(Math.round(bx + Math.sin(ang) * r - w / 2), Math.round(12 + Math.cos(ang) * r * 0.5), w, 1);
          }
          ctx.globalAlpha = 0.9;
          ctx.fillRect(bx - 1, 10, 3, 3);
        }
        ctx.globalAlpha = 1;
      },
    };
  },
};

const cache = new Map<string, BattleBg>();

export function battleBg(id: string): BattleBg {
  let b = cache.get(id);
  if (!b) {
    b = (MAKERS[id] ?? MAKERS.street!)();
    b.fg ??= FRAMING[id]?.();
    cache.set(id, b);
  }
  return b;
}

// ------------------------------------------------------------------ foreground framing
const FG_DARK = '#07060d';

/** A sagging cable between two points (2px, with a rim of light along its top). */
function cable(c: Ctx, x0: number, y0: number, x1: number, y1: number, sag: number, rim: string): void {
  const n = Math.ceil(Math.abs(x1 - x0));
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * sag);
    c.fillStyle = FG_DARK;
    c.fillRect(x, y, 1, 3);
    c.fillStyle = rim;
    c.fillRect(x, y, 1, 1);
  }
}

/** A railing across the bottom corner: posts and a top rail, catching a little light. */
function railing(c: Ctx, x0: number, x1: number, y: number, rim: string): void {
  c.fillStyle = FG_DARK;
  c.fillRect(x0, y, x1 - x0, 3);
  c.fillRect(x0, y + 12, x1 - x0, 2);
  for (let x = x0 + 2; x < x1; x += 12) c.fillRect(x, y, 3, BH - y);
  c.fillStyle = rim;
  c.fillRect(x0, y, x1 - x0, 1);
  for (let x = x0 + 2; x < x1; x += 12) c.fillRect(x, y, 1, BH - y);
}

const FRAMING: Record<string, () => HTMLCanvasElement> = {
  street: () => {
    const s = surface(BW, BH), c = s.ctx;
    cable(c, -4, 6, 70, 14, 9, '#ffc27a');
    cable(c, 170, 12, BW + 4, 4, 8, '#ffc27a');
    railing(c, 0, 34, 104, '#ffc27a');
    railing(c, BW - 34, BW, 104, '#ffc27a');
    return s.canvas;
  },
  junction: () => {
    const s = surface(BW, BH), c = s.ctx;
    // Pipes along the ceiling, dripping; a catwalk rail in the near corners.
    c.fillStyle = FG_DARK;
    c.fillRect(0, 0, 58, 6);
    c.fillRect(BW - 70, 0, 70, 5);
    c.fillStyle = '#ffcf7a';
    c.fillRect(0, 5, 58, 1);
    c.fillRect(BW - 70, 4, 70, 1);
    c.fillStyle = '#6a9ab0';
    for (const x of [18, 44, BW - 50, BW - 22]) c.fillRect(x, 7, 1, 2);
    railing(c, 0, 28, 108, '#ffcf7a');
    railing(c, BW - 28, BW, 108, '#ffcf7a');
    return s.canvas;
  },
  lab: () => {
    const s = surface(BW, BH), c = s.ctx;
    // A conduit pipe across the ceiling corner, shaded round and bracketed (a flat bar read as a
    // rendering fault), and the edges of consoles in the near corners.
    const pipe = (x0: number, x1: number, y: number) => {
      for (const [dy, col] of [[0, '#1a1822'], [1, '#3a3848'], [2, '#2a2836'], [3, '#1a1822'], [4, FG_DARK]] as const) {
        c.fillStyle = col;
        c.fillRect(x0, y + dy, x1 - x0, 1);
      }
      c.fillStyle = '#ff6a7a';
      c.fillRect(x0, y + 1, x1 - x0, 1);
      for (let x = x0 + 8; x < x1; x += 22) {
        c.fillStyle = FG_DARK;
        c.fillRect(x, y - 1, 3, 7);
        c.fillStyle = '#4a4858';
        c.fillRect(x, y - 1, 3, 1);
      }
    };
    pipe(0, 84, 2);
    // A drop line off the pipe's end, with a warning lamp.
    c.fillStyle = FG_DARK;
    c.fillRect(80, 7, 1, 10);
    c.fillStyle = '#ff3a4a';
    c.fillRect(79, 17, 3, 2);
    for (const [x, w] of [[0, 30], [BW - 30, 30]] as const) {
      c.fillStyle = FG_DARK;
      c.fillRect(x, 112, w, BH - 112);
      c.fillStyle = '#3a2830';
      c.fillRect(x, 112, w, 1);
      c.fillStyle = '#ff6a7a';
      c.fillRect(x + 4, 116, 3, 1);
      c.fillRect(x + 10, 116, 5, 1);
    }
    return s.canvas;
  },
  core: () => {
    const s = surface(BW, BH), c = s.ctx;
    // The Warden's containment: heavy cable bundles hanging from the top corners, a field pylon
    // standing at the near right.
    cable(c, -6, 2, 60, 4, 16, '#8ae8ff');
    cable(c, -6, 8, 46, 10, 12, '#8ae8ff');
    cable(c, BW + 6, 3, BW - 64, 5, 15, '#8ae8ff');
    c.fillStyle = FG_DARK;
    c.fillRect(BW - 18, 70, 10, BH - 70);
    c.fillRect(BW - 22, 70, 18, 4);
    c.fillStyle = '#8ae8ff';
    for (let y = 78; y < BH; y += 6) c.fillRect(BW - 17, y, 8, 1);
    return s.canvas;
  },
};

export const BG_IDS = Object.keys(MAKERS);
