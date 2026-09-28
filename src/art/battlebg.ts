/**
 * Battle backgrounds at the 240×135 battle resolution (displayed 2×). Each has a static bake
 * and an optional per-frame animation layer (rain, flicker, water, embers).
 */
import { surface, type Ctx } from '../engine/canvas';
import { mix, rgb, shade } from '../engine/color';
import { hash2, Rng } from '../engine/rng';

export const BW = 240;
export const BH = 135;
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
    // Rooftop details
    if (rng.chance(0.4)) c.fillRect(x + rng.int(2, w - 4), top - rng.int(3, 8), 1, 8);
    if (rng.chance(0.3)) c.fillRect(x + 2, top - 2, w - 4, 2);
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
    const s = surface(BW, BH), gl = surface(BW, BH);
    const c = s.ctx, g = gl.ctx;
    const vx = BW / 2, vy = 54;
    c.fillStyle = '#05080a';
    c.fillRect(0, 0, BW, BH);
    // Receding arch rings
    for (let i = 12; i >= 0; i--) {
      const k = Math.pow(0.8, i);
      const rw = 150 * k, rh = 110 * k;
      const col = shade('#3a4448', -0.1 - i * 0.06);
      c.fillStyle = col;
      c.beginPath();
      c.ellipse(vx, vy + 40 * k, rw, rh, 0, Math.PI, 0);
      c.lineTo(vx + rw, vy + 60 * k + 40);
      c.lineTo(vx - rw, vy + 60 * k + 40);
      c.fill();
      c.fillStyle = shade('#1a2224', -0.2 - i * 0.03);
      c.beginPath();
      c.ellipse(vx, vy + 40 * k, rw * 0.9, rh * 0.9, 0, Math.PI, 0);
      c.fill();
      // Wall lamps along the ring
      if (i % 2 === 0 && i > 0) {
        const lx = vx - rw * 0.86, rx = vx + rw * 0.86, ly = vy + 40 * k - rh * 0.3;
        for (const x of [lx, rx]) {
          g.fillStyle = '#ffd07a';
          g.fillRect(Math.round(x), Math.round(ly), 2, 1);
          g.globalAlpha = 0.25;
          g.fillRect(Math.round(x) - 2, Math.round(ly) - 1, 6, 3);
          g.globalAlpha = 1;
        }
      }
    }
    // Water channel + walkways
    floor(c, 70, '#0e2420', '#11282a', null);
    c.fillStyle = '#3a4448';
    c.beginPath();
    c.moveTo(0, BH); c.lineTo(0, 88); c.lineTo(vx - 30, 70); c.lineTo(vx - 36, BH); c.fill();
    c.beginPath();
    c.moveTo(BW, BH); c.lineTo(BW, 88); c.lineTo(vx + 30, 70); c.lineTo(vx + 36, BH); c.fill();
    c.fillStyle = '#4a5458';
    c.fillRect(0, 88, 0, 0);
    // Pipes
    c.fillStyle = '#4a3a30';
    c.fillRect(0, 30, 70, 3);
    c.fillRect(170, 36, 70, 3);
    c.fillStyle = '#6a5040';
    c.fillRect(0, 30, 70, 1);
    c.fillRect(170, 36, 70, 1);
    reflections(g, 72, new Rng(5), ['#ffd07a', '#6affc8'], 10);
    return {
      canvas: s.canvas, glow: gl.canvas, ground: 96, tint: '#2a5a5a', tintAmt: 0.22,
      anim: (ctx, f) => {
        // Drips
        for (let i = 0; i < 6; i++) {
          const x = Math.round(20 + hash2(i, 4) * 200);
          const t = (f + i * 37) % 90;
          ctx.fillStyle = '#8ab8c8';
          ctx.globalAlpha = 0.7;
          if (t < 60) ctx.fillRect(x, 10 + t * 1.6, 1, 2);
          else ctx.fillRect(x - (t - 60) / 6, 106, 1 + (t - 60) / 3, 1);
        }
        // Water shimmer
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#6ab8a8';
        for (let i = 0; i < 20; i++) {
          const y = 72 + hash2(i, 8) * 60;
          const x = BW / 2 + (hash2(i, 9) - 0.5) * (y - 60) * 1.2 + Math.sin(f * 0.05 + i) * 2;
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
    // Observation windows with tanks
    for (let i = 0; i < 4; i++) {
      const x = 14 + i * 60;
      c.fillStyle = '#2a3a4a';
      c.fillRect(x, 16, 30, 24);
      c.fillStyle = '#3a6a7a';
      c.fillRect(x + 2, 18, 26, 20);
      for (const k of [c, g]) {
        k.fillStyle = '#6affe0';
        k.fillRect(x + 12, 22, 6, 14);
        k.fillStyle = '#2a8a7a';
        k.fillRect(x + 14, 26, 2, 6);
      }
    }
    floor(c, HORIZON + 4, '#9aa6b6', '#a6b2c2', '#7a8698');
    return { canvas: s.canvas, glow: gl.canvas, ground: 94, tint: '#8ac8e8', tintAmt: 0.1 };
  },
  core: () => {
    const s = surface(BW, BH), gl = surface(BW, BH);
    const c = s.ctx, g = gl.ctx;
    ditherV(c, 0, 0, BW, HORIZON + 4, ['#0a0612', '#1a0a1e', '#2a0e24']);
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
        // Alarm sweep
        const a = 0.12 + 0.1 * Math.sin(f * 0.1);
        ctx.fillStyle = '#ff2a3a';
        ctx.globalAlpha = a;
        ctx.fillRect(0, 0, BW, BH);
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
    cache.set(id, b);
  }
  return b;
}

export const BG_IDS = Object.keys(MAKERS);
