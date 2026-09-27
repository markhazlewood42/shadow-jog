/** Prop painters. Flat props bake into the ground layer; tall props become depth-sorted sprites. */
import { disc, ellipse, surface, type Ctx } from '../engine/canvas';
import { mix, shade } from '../engine/color';
import { drawText, measure } from '../engine/font';
import { Rng } from '../engine/rng';
import type { BakeCtx } from './bake';
import { TS } from './tiles';
import type { PropDef, PropKind } from './types';

type PropPainter = (b: BakeCtx, p: PropDef, rng: Rng) => void;

/** Make a tall sprite whose bottom edge sits at the prop's footprint bottom. */
function tall(
  b: BakeCtx,
  p: PropDef,
  w: number,
  h: number,
  draw: (c: Ctx, e: Ctx) => void,
  opts: { ox?: number; footH?: number; anim?: (ctx: Ctx, frame: number, sx: number, sy: number) => void } = {},
): { x: number; y: number } {
  const s = surface(w, h);
  const em = surface(w, h);
  draw(s.ctx, em.ctx);
  const footW = p.w ?? 1;
  const footH = opts.footH ?? p.h ?? 1;
  const x = p.x * TS + Math.round((footW * TS - w) / 2) + (opts.ox ?? 0);
  const baseY = (p.y + footH) * TS;
  const y = baseY - h;
  const sprite = { canvas: s.canvas, emit: em.canvas, x, y, baseY: baseY - 1, anim: opts.anim };
  b.sprites.push(sprite);
  return { x, y };
}

function blockFoot(b: BakeCtx, p: PropDef, w = p.w ?? 1, h = p.h ?? 1): void {
  if (p.pass) return;
  for (let y = p.y; y < p.y + h; y++) for (let x = p.x; x < p.x + w; x++) b.block(x, y);
}

function groundShadow(b: BakeCtx, cx: number, cy: number, rx: number, ry: number): void {
  ellipse(b.g, cx, cy, rx, ry, 'rgba(6,5,12,0.45)');
}

const both = (c: Ctx, e: Ctx, fn: (x: Ctx) => void) => {
  fn(c);
  fn(e);
};

export const PROPS: Partial<Record<PropKind, PropPainter>> = {
  lamp(b, p) {
    blockFoot(b, p);
    const col = p.color ?? '#ffd9a0';
    const facingRight = p.dir !== 'left';
    const { x, y } = tall(b, p, 16, 46, (c, e) => {
      c.fillStyle = '#2a2c38'; c.fillRect(7, 8, 2, 38);
      c.fillStyle = '#3e4252'; c.fillRect(7, 8, 1, 38);
      c.fillStyle = '#1d1e28'; c.fillRect(5, 42, 6, 4);
      // Arm + head
      const hx = facingRight ? 9 : 1;
      c.fillStyle = '#2a2c38'; c.fillRect(facingRight ? 8 : 2, 6, 7, 2);
      c.fillStyle = '#3e4252'; c.fillRect(hx, 8, 6, 2);
      both(c, e, (k) => {
        k.fillStyle = col; k.fillRect(hx + 1, 10, 4, 1);
        k.fillStyle = mix(col, '#ffffff', 0.6); k.fillRect(hx + 2, 10, 2, 1);
      });
    });
    groundShadow(b, x + 8, y + 45, 4, 1.5);
    const lx = x + (facingRight ? 12 : 4);
    b.lights.push({ x: lx, y: y + 38, r: 64, color: col, i: 1.3 });
    b.lights.push({ x: lx, y: y + 11, r: 12, color: col, i: 0.9 });
  },

  vending(b, p, rng) {
    blockFoot(b, p);
    const col = p.color ?? rng.pick(['#3fe0f0', '#ff4fb0', '#62e06a', '#ffcc3d']);
    const { x, y } = tall(b, p, 14, 26, (c, e) => {
      c.fillStyle = '#12111a'; c.fillRect(0, 0, 14, 26);
      c.fillStyle = shade(col, -0.45); c.fillRect(1, 1, 12, 24);
      c.fillStyle = shade(col, -0.2); c.fillRect(1, 1, 12, 1);
      both(c, e, (k) => {
        k.fillStyle = '#0d1a22'; k.fillRect(2, 3, 7, 13);
        for (let r = 0; r < 4; r++)
          for (let q = 0; q < 3; q++) {
            k.fillStyle = ['#ff6a5a', '#ffe07a', '#7ad8ff', '#9aff8a', '#ffffff'][(r * 3 + q) % 5]!;
            k.fillRect(3 + q * 2, 4 + r * 3, 1, 2);
          }
        k.fillStyle = col; k.fillRect(10, 4, 2, 4);
        k.fillStyle = mix(col, '#fff', 0.5); k.fillRect(10, 4, 2, 1);
        k.globalAlpha = 0.6; k.fillStyle = col; k.fillRect(2, 18, 10, 1); k.globalAlpha = 1;
      });
      c.fillStyle = '#05050a'; c.fillRect(3, 20, 8, 3);
    });
    groundShadow(b, x + 7, y + 26, 7, 2);
    b.lights.push({ x: x + 7, y: y + 20, r: 30, color: col, i: 0.8 });
  },

  barrel(b, p) {
    blockFoot(b, p);
    const col = p.color ?? '#3a5a6a';
    tall(b, p, 12, 15, (c) => {
      c.fillStyle = '#0f0e17'; c.fillRect(0, 1, 12, 14);
      c.fillStyle = col; c.fillRect(1, 2, 10, 12);
      c.fillStyle = shade(col, 0.3); c.fillRect(2, 2, 2, 12);
      c.fillStyle = shade(col, -0.4); c.fillRect(1, 5, 10, 1); c.fillRect(1, 10, 10, 1); c.fillRect(9, 2, 2, 12);
      c.fillStyle = shade(col, -0.2); c.fillRect(1, 0, 10, 2);
    });
  },

  firebarrel(b, p) {
    blockFoot(b, p);
    const { x, y } = tall(
      b, p, 12, 18,
      (c) => {
        c.fillStyle = '#0f0e17'; c.fillRect(0, 4, 12, 14);
        c.fillStyle = '#5a3a2a'; c.fillRect(1, 5, 10, 12);
        c.fillStyle = '#6a4a36'; c.fillRect(2, 5, 2, 12);
        c.fillStyle = '#3a2418'; c.fillRect(1, 9, 10, 1); c.fillRect(1, 13, 10, 1);
        c.fillStyle = '#1a0e08'; c.fillRect(1, 4, 10, 2);
      },
      {
        anim: (ctx, f, sx, sy) => {
          for (let i = 0; i < 6; i++) {
            const ph = (f * 0.2 + i * 1.7) % 6;
            const fx = sx + 3 + ((i * 37) % 6) + Math.round(Math.sin(f * 0.3 + i) * 1);
            const fy = sy + 4 - ph;
            ctx.fillStyle = ph < 2 ? '#fff0a0' : ph < 4 ? '#ffa24a' : '#e8452e';
            ctx.fillRect(fx, fy, ph < 3 ? 2 : 1, 2);
          }
        },
      },
    );
    b.lights.push({ x: x + 6, y: y + 4, r: 54, color: '#ff9a4a', i: 1, flicker: true });
  },

  crates(b, p, rng) {
    blockFoot(b, p);
    const stack = rng.chance(0.5);
    tall(b, p, 16, stack ? 22 : 14, (c) => {
      const box = (x: number, y: number, w: number, h: number) => {
        c.fillStyle = '#0f0e17'; c.fillRect(x, y, w, h);
        c.fillStyle = '#6a5038'; c.fillRect(x + 1, y + 1, w - 2, h - 2);
        c.fillStyle = '#7e6246'; c.fillRect(x + 1, y + 1, w - 2, 2);
        c.fillStyle = '#4a3624';
        c.fillRect(x + 1, y + Math.floor(h / 2), w - 2, 1);
        c.fillRect(x + Math.floor(w / 2), y + 3, 1, h - 4);
      };
      if (stack) {
        box(0, 8, 16, 14);
        box(3, 0, 11, 10);
      } else box(0, 0, 16, 14);
    });
  },

  dumpster(b, p) {
    const w = p.w ?? 2;
    blockFoot(b, p, w, 1);
    const col = p.color ?? '#2f5a4a';
    tall(b, { ...p, w }, 28, 18, (c) => {
      c.fillStyle = '#0f0e17'; c.fillRect(0, 0, 28, 18);
      c.fillStyle = col; c.fillRect(1, 5, 26, 12);
      c.fillStyle = shade(col, 0.2); c.fillRect(1, 5, 26, 1);
      c.fillStyle = shade(col, -0.35); c.fillRect(1, 9, 26, 1); c.fillRect(1, 16, 26, 1);
      c.fillStyle = shade(col, -0.2); c.fillRect(1, 1, 26, 4);
      c.fillStyle = shade(col, 0.1); c.fillRect(1, 1, 26, 1);
      c.fillStyle = '#e8d06a'; c.fillRect(4, 11, 5, 3);
      c.fillStyle = '#1a1820'; c.fillRect(5, 12, 3, 1);
      c.fillStyle = '#2a2830'; c.fillRect(20, 7, 2, 8); c.fillRect(24, 7, 2, 8);
    });
  },

  trash(b, p, rng) {
    const g = b.g;
    const bx = p.x * TS, by = p.y * TS;
    for (let i = 0; i < 3; i++) {
      const cx = bx + 3 + rng.int(0, 9), cy = by + 6 + rng.int(0, 6);
      const col = rng.pick(['#1e1e28', '#2a2a36', '#3a3040']);
      ellipse(g, cx + 1, cy + 2, 4, 2, 'rgba(6,5,12,0.5)');
      ellipse(g, cx, cy, 4, 3, '#0f0e17');
      ellipse(g, cx, cy, 3, 2, col);
      g.fillStyle = shade(col, 0.4); g.fillRect(cx - 1, cy - 2, 2, 1);
    }
    for (let i = 0; i < 4; i++) {
      g.fillStyle = rng.pick(['#8a8070', '#ff4fb0', '#e8d06a', '#6a8a9a']);
      g.fillRect(bx + rng.int(0, 15), by + rng.int(4, 15), 1, 1);
    }
  },

  car(b, p, rng) {
    const w = p.w ?? 2, h = p.h ?? 1;
    blockFoot(b, p, w, h);
    const col = p.color ?? rng.pick(['#8c2f39', '#2c3b5e', '#4d5238', '#6a3fa0', '#b8b0a0', '#1d5c6a']);
    const { x, y } = tall(b, { ...p, w, h }, 30, 22, (c, e) => {
      // 3/4 side view car facing left.
      c.fillStyle = '#0f0e17'; c.fillRect(0, 6, 30, 14);
      c.fillStyle = col; c.fillRect(1, 11, 28, 8);
      c.fillStyle = shade(col, 0.25); c.fillRect(1, 11, 28, 1);
      c.fillStyle = shade(col, -0.3); c.fillRect(1, 16, 28, 3);
      c.fillStyle = '#0f0e17'; c.fillRect(7, 3, 16, 9);
      c.fillStyle = shade(col, -0.1); c.fillRect(8, 4, 14, 8);
      c.fillStyle = '#1a2436'; c.fillRect(9, 5, 5, 5); c.fillRect(15, 5, 6, 5);
      c.fillStyle = '#3a4a66'; c.fillRect(9, 5, 2, 1); c.fillRect(15, 5, 2, 1);
      c.fillStyle = '#0f0e17';
      disc(c, 7, 19, 3, '#0f0e17'); disc(c, 23, 19, 3, '#0f0e17');
      disc(c, 7, 19, 1.5, '#4a4e5c'); disc(c, 23, 19, 1.5, '#4a4e5c');
      both(c, e, (k) => {
        k.fillStyle = '#fff0c0'; k.fillRect(1, 12, 2, 2);
        k.fillStyle = '#ff3a3a'; k.fillRect(27, 12, 2, 2);
      });
    });
    groundShadow(b, x + 15, y + 21, 14, 2.5);
    b.lights.push({ x: x - 4, y: y + 14, r: 18, color: '#fff0c0', i: 0.35 });
  },

  hydrant(b, p) {
    blockFoot(b, p);
    tall(b, p, 8, 11, (c) => {
      c.fillStyle = '#0f0e17'; c.fillRect(1, 0, 6, 11);
      c.fillStyle = '#c0303a'; c.fillRect(2, 1, 4, 9);
      c.fillStyle = '#e0505a'; c.fillRect(2, 1, 1, 9);
      c.fillStyle = '#0f0e17'; c.fillRect(0, 4, 8, 2);
      c.fillStyle = '#a02830'; c.fillRect(1, 4, 6, 1);
    });
  },

  bench(b, p) {
    const w = p.w ?? 2;
    blockFoot(b, p, w, 1);
    tall(b, { ...p, w }, 26, 12, (c) => {
      c.fillStyle = '#0f0e17'; c.fillRect(0, 0, 26, 12);
      c.fillStyle = '#5a4a3e'; c.fillRect(1, 1, 24, 3); c.fillRect(1, 6, 24, 2);
      c.fillStyle = '#6e5a4a'; c.fillRect(1, 1, 24, 1); c.fillRect(1, 6, 24, 1);
      c.fillStyle = '#2a2c38'; c.fillRect(3, 8, 2, 4); c.fillRect(21, 8, 2, 4); c.fillRect(3, 4, 1, 2); c.fillRect(22, 4, 1, 2);
    });
  },

  stall(b, p) {
    const w = p.w ?? 3;
    blockFoot(b, p, w, 1);
    const col = p.color ?? '#d8452e';
    const { x, y } = tall(b, { ...p, w }, w * TS, 34, (c, e) => {
      const W = w * TS;
      // Counter
      c.fillStyle = '#0f0e17'; c.fillRect(1, 20, W - 2, 14);
      c.fillStyle = '#6a4a36'; c.fillRect(2, 21, W - 4, 12);
      c.fillStyle = '#8a6448'; c.fillRect(2, 21, W - 4, 2);
      c.fillStyle = '#4a3226';
      for (let i = 6; i < W - 4; i += 6) c.fillRect(i, 24, 1, 9);
      // Posts
      c.fillStyle = '#2a2830'; c.fillRect(3, 6, 2, 16); c.fillRect(W - 5, 6, 2, 16);
      // Awning
      for (let px = 0; px < W; px++) {
        const st = Math.floor(px / 5) % 2 === 0;
        c.fillStyle = st ? col : '#efe6d4';
        c.fillRect(px, 2, 1, 5);
        c.fillStyle = st ? shade(col, -0.35) : '#b8b0a0';
        c.fillRect(px, 7, 1, px % 5 === 2 ? 2 : 1);
      }
      c.fillStyle = shade(col, 0.3); c.fillRect(0, 2, W, 1);
      // Lanterns
      both(c, e, (k) => {
        for (let i = 8; i < W - 4; i += 14) {
          k.fillStyle = '#ff5a3a'; k.fillRect(i, 10, 4, 5);
          k.fillStyle = '#ffd07a'; k.fillRect(i + 1, 11, 2, 3);
          k.fillStyle = '#1a1018'; k.fillRect(i + 1, 9, 2, 1); k.fillRect(i + 1, 15, 2, 1);
        }
        // Steaming pot glow
        k.fillStyle = '#ffcf7a'; k.fillRect(W / 2 - 4, 19, 8, 2);
      });
      c.fillStyle = '#3a3a46'; c.fillRect(W / 2 - 5, 17, 10, 4);
    }, {
      anim: (ctx, f, sx, sy) => {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#d8d8e8';
        for (let i = 0; i < 4; i++) {
          const t = (f * 0.4 + i * 9) % 24;
          ctx.fillRect(sx + (w * TS) / 2 - 2 + Math.round(Math.sin((f + i * 20) * 0.06) * 3), sy + 16 - t, 2, 2);
        }
        ctx.globalAlpha = 1;
      },
    });
    for (let i = 8; i < w * TS - 4; i += 14) b.lights.push({ x: x + i + 2, y: y + 13, r: 24, color: '#ff8a4a', i: 0.8, flicker: true });
    b.lights.push({ x: x + (w * TS) / 2, y: y + 28, r: 40, color: '#ffb46a', i: 0.6 });
  },

  pillar(b, p) {
    blockFoot(b, p, p.w ?? 2, 1);
    const w = (p.w ?? 2) * TS;
    tall(b, p, w, 90, (c) => {
      c.fillStyle = '#0f0e17'; c.fillRect(2, 0, w - 4, 90);
      c.fillStyle = '#4a4e5e'; c.fillRect(3, 0, w - 6, 90);
      c.fillStyle = '#5a5f70'; c.fillRect(3, 0, 3, 90);
      c.fillStyle = '#3a3d4a'; c.fillRect(w - 7, 0, 4, 90);
      c.fillStyle = '#353848';
      for (let yy = 10; yy < 90; yy += 20) c.fillRect(3, yy, w - 6, 1);
      // Hazard stripes at the base
      for (let xx = 3; xx < w - 3; xx++) {
        c.fillStyle = Math.floor((xx + 0) / 3) % 2 === 0 ? '#d8b02a' : '#1a1820';
        c.fillRect(xx, 80, 1, 6);
      }
    });
  },

  tree(b, p) {
    blockFoot(b, p);
    const glow = p.color ?? '#62e06a';
    const { x, y } = tall(b, p, 30, 44, (c, e) => {
      c.fillStyle = '#0f0e17'; c.fillRect(13, 26, 5, 18);
      c.fillStyle = '#3a2c28'; c.fillRect(14, 26, 3, 18);
      const blob = (cx: number, cy: number, r: number, col: string) => disc(c, cx, cy, r, col);
      blob(15, 16, 13, '#0f0e17');
      blob(15, 16, 12, '#1d4a36');
      blob(11, 13, 8, '#245a42');
      blob(19, 19, 7, '#1a4030');
      blob(10, 10, 4, '#2e6e50');
      both(c, e, (k) => {
        k.fillStyle = glow;
        for (const [gx, gy] of [[8, 12], [20, 9], [14, 20], [23, 17], [6, 18], [16, 6]] as const) k.fillRect(gx, gy, 1, 1);
        k.fillStyle = mix(glow, '#ffffff', 0.5);
        k.fillRect(12, 8, 1, 1);
      });
    });
    groundShadow(b, x + 15, y + 43, 9, 3);
    b.lights.push({ x: x + 15, y: y + 16, r: 30, color: glow, i: 0.35 });
  },

  planter(b, p) {
    blockFoot(b, p);
    tall(b, p, 16, 16, (c, e) => {
      c.fillStyle = '#0f0e17'; c.fillRect(1, 8, 14, 8);
      c.fillStyle = '#5a5f73'; c.fillRect(2, 9, 12, 6);
      c.fillStyle = '#747a90'; c.fillRect(2, 9, 12, 1);
      disc(c, 8, 6, 6, '#0f0e17');
      disc(c, 8, 6, 5, '#245a42');
      disc(c, 6, 5, 2, '#2e7a56');
      both(c, e, (k) => { k.fillStyle = '#9aff8a'; k.fillRect(10, 4, 1, 1); k.fillRect(5, 7, 1, 1); });
    });
  },

  terminal(b, p) {
    blockFoot(b, p);
    const col = p.color ?? '#3fe0f0';
    const { x, y } = tall(b, p, 12, 22, (c, e) => {
      c.fillStyle = '#0f0e17'; c.fillRect(1, 0, 10, 22);
      c.fillStyle = '#3a3e4c'; c.fillRect(2, 1, 8, 20);
      c.fillStyle = '#4e5262'; c.fillRect(2, 1, 8, 1);
      both(c, e, (k) => {
        k.fillStyle = shade(col, -0.5); k.fillRect(3, 3, 6, 6);
        k.fillStyle = col; k.fillRect(4, 4, 4, 1); k.fillRect(4, 6, 3, 1);
      });
      c.fillStyle = '#2a2d38'; c.fillRect(3, 11, 6, 3);
    });
    b.lights.push({ x: x + 6, y: y + 8, r: 20, color: col, i: 0.7 });
  },

  barrier(b, p) {
    const w = p.w ?? 1;
    blockFoot(b, p, w, 1);
    tall(b, { ...p, w }, w * TS, 14, (c) => {
      const W = w * TS;
      c.fillStyle = '#0f0e17'; c.fillRect(0, 2, W, 8);
      for (let xx = 1; xx < W - 1; xx++) {
        c.fillStyle = Math.floor(xx / 4) % 2 === 0 ? '#e8e4da' : '#d8302a';
        c.fillRect(xx, 3, 1, 6);
      }
      c.fillStyle = '#2a2830'; c.fillRect(2, 10, 2, 4); c.fillRect(W - 4, 10, 2, 4);
    });
  },

  cone(b, p) {
    blockFoot(b, p);
    tall(b, p, 8, 10, (c) => {
      c.fillStyle = '#0f0e17'; c.fillRect(2, 0, 4, 9); c.fillRect(0, 8, 8, 2);
      c.fillStyle = '#ff7a2a'; c.fillRect(3, 1, 2, 8);
      c.fillStyle = '#efe6d4'; c.fillRect(3, 4, 2, 2);
      c.fillStyle = '#c85a1a'; c.fillRect(1, 8, 6, 1);
    });
  },

  holo(b, p) {
    blockFoot(b, p);
    const col = p.color ?? '#3fe0f0';
    const text = p.text ?? 'K-M';
    const { x, y } = tall(
      b, p, 30, 40,
      (c) => {
        c.fillStyle = '#0f0e17'; c.fillRect(11, 34, 8, 6);
        c.fillStyle = '#3a3e4c'; c.fillRect(12, 35, 6, 4);
      },
      {
        anim: (ctx, f, sx, sy) => {
          const flick = Math.sin(f * 0.9) > 0.92 ? 0.3 : 1;
          ctx.globalAlpha = 0.55 * flick;
          ctx.fillStyle = col;
          ctx.fillRect(sx + 13, sy + 6, 4, 29);
          ctx.globalAlpha = 0.85 * flick;
          const bob = Math.round(Math.sin(f * 0.05) * 2);
          ctx.fillStyle = shade(col, -0.5);
          ctx.fillRect(sx + 1, sy + 2 + bob, 28, 13);
          ctx.fillStyle = col;
          ctx.fillRect(sx + 1, sy + 2 + bob, 28, 1);
          ctx.fillRect(sx + 1, sy + 14 + bob, 28, 1);
          drawText(ctx, text, sx + 15, sy + 5 + bob, { color: '#ffffff', shadow: false, align: 'center' });
          // Scan line
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = 0.25 * flick;
          ctx.fillRect(sx + 1, sy + 2 + bob + ((f >> 2) % 13), 28, 1);
          ctx.globalAlpha = 1;
        },
      },
    );
    b.lights.push({ x: x + 15, y: y + 12, r: 36, color: col, i: 0.7, flicker: true });
  },

  bollard(b, p) {
    blockFoot(b, p);
    tall(b, p, 6, 10, (c, e) => {
      c.fillStyle = '#0f0e17'; c.fillRect(0, 0, 6, 10);
      c.fillStyle = '#5a5f70'; c.fillRect(1, 1, 4, 9);
      both(c, e, (k) => { k.fillStyle = '#ffcc3d'; k.fillRect(1, 2, 4, 1); });
    });
  },

  sign_post(b, p) {
    blockFoot(b, p);
    const text = p.text ?? '→';
    const tw = measure(text) + 6;
    tall(b, p, Math.max(12, tw), 26, (c) => {
      const W = Math.max(12, tw);
      c.fillStyle = '#2a2c38'; c.fillRect(W / 2 - 1, 8, 2, 18);
      c.fillStyle = '#0f0e17'; c.fillRect(0, 0, W, 10);
      c.fillStyle = '#2f6a5a'; c.fillRect(1, 1, W - 2, 8);
      drawText(c, text, W / 2, 1, { color: '#efe6d4', shadow: false, align: 'center' });
    });
  },

  steam(b, p) {
    const x = p.x * TS + 8, y = p.y * TS + 12;
    b.g.fillStyle = '#1a1c28'; b.g.fillRect(x - 5, y - 2, 10, 4);
    b.g.fillStyle = '#3a3e4c';
    for (let i = -4; i < 5; i += 2) b.g.fillRect(x + i, y - 2, 1, 4);
    b.anims.push({
      x: x - 12, y: y - 40, w: 24, h: 44, lit: true,
      draw: (ctx, f, ox, oy) => {
        for (let i = 0; i < 7; i++) {
          const t = (f * 0.5 + i * 13) % 40;
          const a = 0.3 * (1 - t / 40);
          ctx.globalAlpha = a;
          ctx.fillStyle = '#c8cce0';
          const r = 2 + t / 8;
          const px = x - ox + Math.sin((f + i * 30) * 0.05) * (t / 6);
          ctx.fillRect(Math.round(px - r), Math.round(y - oy - t - r), Math.round(r * 2), Math.round(r * 2));
        }
        ctx.globalAlpha = 1;
      },
    });
  },

  poster(b, p) {
    // Flat wall poster / graffiti tag on an interior or facade surface.
    const x = p.x * TS + 3, y = p.y * TS + 2;
    const col = p.color ?? '#ff4fb0';
    b.g.fillStyle = '#d8d0c0'; b.g.fillRect(x, y, 10, 12);
    b.g.fillStyle = col; b.g.fillRect(x + 1, y + 1, 8, 6);
    b.g.fillStyle = '#2a2830'; b.g.fillRect(x + 1, y + 8, 8, 1); b.g.fillRect(x + 1, y + 10, 6, 1);
  },

  // -------------------------------------------------------------- interior furniture
  counter(b, p) {
    const w = p.w ?? 1;
    blockFoot(b, p, w, 1);
    const col = p.color ?? '#5a3e30';
    tall(b, { ...p, w }, w * TS, 20, (c) => {
      const W = w * TS;
      c.fillStyle = '#0f0e17'; c.fillRect(0, 2, W, 18);
      c.fillStyle = shade(col, 0.2); c.fillRect(0, 3, W, 5);
      c.fillStyle = shade(col, 0.45); c.fillRect(0, 3, W, 1);
      c.fillStyle = col; c.fillRect(0, 8, W, 11);
      c.fillStyle = shade(col, -0.3);
      for (let i = 8; i < W; i += 16) c.fillRect(i, 9, 1, 10);
      c.fillRect(0, 18, W, 1);
    });
  },

  shelf(b, p, rng) {
    const w = p.w ?? 1;
    blockFoot(b, p, w, 1);
    tall(b, { ...p, w }, w * TS, 28, (c, e) => {
      const W = w * TS;
      c.fillStyle = '#0f0e17'; c.fillRect(0, 0, W, 28);
      c.fillStyle = '#3a3040'; c.fillRect(1, 1, W - 2, 26);
      for (let sy = 7; sy < 27; sy += 7) {
        c.fillStyle = '#5a4a5a'; c.fillRect(1, sy, W - 2, 1);
        for (let sx = 2; sx < W - 2; sx += 3) {
          if (rng.chance(0.75)) {
            const col = rng.pick(['#e8452e', '#3fe0f0', '#ffcc3d', '#62e06a', '#ff4fb0', '#efe6d4', '#b07cff']);
            c.fillStyle = col;
            const hh = rng.int(3, 5);
            c.fillRect(sx, sy - hh, 2, hh);
            if (rng.chance(0.2)) { e.fillStyle = col; e.globalAlpha = 0.5; e.fillRect(sx, sy - hh, 2, 1); e.globalAlpha = 1; }
          }
        }
      }
    });
  },

  bed(b, p) {
    blockFoot(b, p, 1, 2);
    const col = p.color ?? '#3a4a7a';
    tall(b, { ...p, h: 2 }, 16, 30, (c) => {
      c.fillStyle = '#0f0e17'; c.fillRect(0, 0, 16, 30);
      c.fillStyle = '#4a3a30'; c.fillRect(1, 1, 14, 28);
      c.fillStyle = '#d8d4cc'; c.fillRect(2, 2, 12, 6);
      c.fillStyle = '#efece6'; c.fillRect(2, 2, 12, 2);
      c.fillStyle = col; c.fillRect(2, 9, 12, 18);
      c.fillStyle = shade(col, 0.25); c.fillRect(2, 9, 12, 2);
      c.fillStyle = shade(col, -0.3); c.fillRect(2, 22, 12, 1);
    }, { footH: 2 });
  },

  table(b, p) {
    const w = p.w ?? 1;
    blockFoot(b, p, w, 1);
    const col = p.color ?? '#5a4034';
    tall(b, { ...p, w }, w * TS, 16, (c, e) => {
      const W = w * TS;
      c.fillStyle = '#0f0e17'; c.fillRect(0, 2, W, 9);
      c.fillStyle = shade(col, 0.2); c.fillRect(1, 3, W - 2, 6);
      c.fillStyle = shade(col, 0.45); c.fillRect(1, 3, W - 2, 1);
      c.fillStyle = shade(col, -0.3); c.fillRect(1, 9, W - 2, 1);
      c.fillStyle = '#0f0e17'; c.fillRect(2, 10, 2, 6); c.fillRect(W - 4, 10, 2, 6);
      c.fillStyle = shade(col, -0.2); c.fillRect(2, 10, 1, 6); c.fillRect(W - 4, 10, 1, 6);
      // A drink or a candle
      both(c, e, (k) => { k.fillStyle = '#ffcf7a'; k.fillRect(Math.floor(W / 2), 4, 1, 2); });
    });
  },

  stool(b, p) {
    blockFoot(b, p);
    tall(b, p, 10, 11, (c) => {
      c.fillStyle = '#0f0e17'; c.fillRect(1, 0, 8, 4); c.fillRect(4, 3, 2, 8);
      c.fillStyle = '#8c2f39'; c.fillRect(2, 1, 6, 2);
      c.fillStyle = '#7a8090'; c.fillRect(4, 4, 1, 6);
    });
  },

  couch(b, p) {
    const w = p.w ?? 2;
    blockFoot(b, p, w, 1);
    const col = p.color ?? '#6a3a4a';
    tall(b, { ...p, w }, w * TS, 18, (c) => {
      const W = w * TS;
      c.fillStyle = '#0f0e17'; c.fillRect(0, 0, W, 18);
      c.fillStyle = shade(col, -0.2); c.fillRect(1, 1, W - 2, 7);
      c.fillStyle = col; c.fillRect(1, 8, W - 2, 8);
      c.fillStyle = shade(col, 0.25); c.fillRect(1, 8, W - 2, 1);
      c.fillStyle = shade(col, -0.4); c.fillRect(Math.floor(W / 2), 8, 1, 8);
      c.fillStyle = shade(col, -0.1); c.fillRect(1, 5, 3, 11); c.fillRect(W - 4, 5, 3, 11);
    });
  },

  plant(b, p) {
    blockFoot(b, p);
    tall(b, p, 12, 20, (c) => {
      c.fillStyle = '#0f0e17'; c.fillRect(3, 13, 7, 7);
      c.fillStyle = '#8a5a3a'; c.fillRect(4, 14, 5, 5);
      for (const [lx, ly, lw] of [[5, 2, 2], [2, 5, 3], [7, 4, 3], [4, 8, 5], [1, 9, 3], [8, 9, 3]] as const) {
        c.fillStyle = '#0f0e17'; c.fillRect(lx - 1, ly - 1, lw + 2, 5);
      }
      for (const [lx, ly, lw] of [[5, 2, 2], [2, 5, 3], [7, 4, 3], [4, 8, 5], [1, 9, 3], [8, 9, 3]] as const) {
        c.fillStyle = '#2e7a4e'; c.fillRect(lx, ly, lw, 3);
        c.fillStyle = '#4a9a66'; c.fillRect(lx, ly, 1, 1);
      }
    });
  },

  screen(b, p) {
    // Wall-mounted screen (flat on wall face).
    const col = p.color ?? '#3fe0f0';
    const x = p.x * TS + 1, y = p.y * TS + 2;
    const w = (p.w ?? 1) * TS - 2;
    b.g.fillStyle = '#0f0e17'; b.g.fillRect(x - 1, y - 1, w + 2, 11);
    b.both((c) => {
      c.fillStyle = shade(col, -0.55); c.fillRect(x, y, w, 9);
      c.fillStyle = col;
      for (let i = 0; i < w - 4; i += 3) c.fillRect(x + 2 + i, y + 2 + ((i * 7) % 5), 2, 1);
      c.fillStyle = mix(col, '#fff', 0.5); c.fillRect(x, y, w, 1);
    });
    b.lights.push({ x: x + w / 2, y: y + 14, r: 26, color: col, i: 0.6, flicker: true });
  },

  bar(b, p) {
    const w = p.w ?? 1;
    blockFoot(b, p, w, 1);
    tall(b, { ...p, w }, w * TS, 20, (c, e) => {
      const W = w * TS;
      c.fillStyle = '#0f0e17'; c.fillRect(0, 2, W, 18);
      c.fillStyle = '#2a2a36'; c.fillRect(0, 3, W, 4);
      c.fillStyle = '#4a4a5c'; c.fillRect(0, 3, W, 1);
      c.fillStyle = '#3a2438'; c.fillRect(0, 7, W, 12);
      both(c, e, (k) => {
        k.fillStyle = '#ff4fb0'; k.fillRect(0, 8, W, 1);
        k.globalAlpha = 0.5; k.fillStyle = '#3fe0f0'; k.fillRect(0, 17, W, 1); k.globalAlpha = 1;
      });
    });
  },

  rack(b, p, rng) {
    const w = p.w ?? 1;
    blockFoot(b, p, w, 1);
    tall(b, { ...p, w }, w * TS, 28, (c) => {
      const W = w * TS;
      c.fillStyle = '#0f0e17'; c.fillRect(0, 0, W, 28);
      c.fillStyle = '#2e3140'; c.fillRect(1, 1, W - 2, 26);
      c.fillStyle = '#464a5c';
      for (let yy = 4; yy < 26; yy += 8) c.fillRect(1, yy, W - 2, 1);
      for (let xx = 3; xx < W - 3; xx += 5) {
        const len = rng.int(10, 20);
        c.fillStyle = rng.pick(['#9aa3b8', '#7a8090', '#c8ccd8']);
        c.fillRect(xx, 5, 1, len);
        c.fillStyle = '#2a2020'; c.fillRect(xx - 1, 5 + len - 4, 3, 3);
      }
    });
  },

  desk(b, p) {
    const w = p.w ?? 2;
    blockFoot(b, p, w, 1);
    tall(b, { ...p, w }, w * TS, 22, (c, e) => {
      const W = w * TS;
      c.fillStyle = '#0f0e17'; c.fillRect(0, 8, W, 14);
      c.fillStyle = '#3a3a4a'; c.fillRect(1, 9, W - 2, 4);
      c.fillStyle = '#4e4e62'; c.fillRect(1, 9, W - 2, 1);
      c.fillStyle = '#2a2a38'; c.fillRect(1, 13, W - 2, 8);
      // Monitors
      c.fillStyle = '#0f0e17'; c.fillRect(4, 0, 12, 10); c.fillRect(W - 14, 1, 10, 9);
      both(c, e, (k) => {
        k.fillStyle = '#1a3a4a'; k.fillRect(5, 1, 10, 7); k.fillRect(W - 13, 2, 8, 6);
        k.fillStyle = '#3fe0f0';
        for (let i = 0; i < 3; i++) k.fillRect(6, 2 + i * 2, 3 + ((i * 5) % 6), 1);
        k.fillStyle = '#62e06a'; k.fillRect(W - 12, 3, 5, 1); k.fillRect(W - 12, 5, 3, 1);
      });
    });
    b.lights.push({ x: p.x * TS + 10, y: p.y * TS + 2, r: 28, color: '#3fe0f0', i: 0.6, flicker: true });
  },

  arcade(b, p) {
    blockFoot(b, p);
    const col = p.color ?? '#ff4fb0';
    const { x, y } = tall(b, p, 14, 28, (c, e) => {
      c.fillStyle = '#0f0e17'; c.fillRect(0, 0, 14, 28);
      c.fillStyle = shade(col, -0.5); c.fillRect(1, 1, 12, 26);
      both(c, e, (k) => {
        k.fillStyle = col; k.fillRect(1, 1, 12, 3);
        k.fillStyle = '#12203a'; k.fillRect(3, 6, 8, 7);
        k.fillStyle = '#ffcc3d'; k.fillRect(5, 8, 2, 2);
        k.fillStyle = '#3fe0f0'; k.fillRect(8, 10, 1, 1);
      });
      c.fillStyle = '#2a2830'; c.fillRect(2, 15, 10, 3);
      c.fillStyle = '#e8452e'; c.fillRect(4, 15, 2, 1);
      c.fillStyle = '#3fe0f0'; c.fillRect(8, 16, 1, 1);
    });
    b.lights.push({ x: x + 7, y: y + 12, r: 22, color: col, i: 0.7, flicker: true });
  },

  jukebox(b, p) {
    blockFoot(b, p);
    const { x, y } = tall(b, p, 14, 24, (c, e) => {
      c.fillStyle = '#0f0e17'; c.fillRect(0, 0, 14, 24);
      c.fillStyle = '#6a2a3a'; c.fillRect(1, 4, 12, 19);
      both(c, e, (k) => {
        k.fillStyle = '#ffa24a'; k.fillRect(1, 1, 12, 4);
        k.fillStyle = '#ffe07a'; k.fillRect(3, 7, 8, 5);
        k.fillStyle = '#ff4fb0'; k.fillRect(1, 14, 12, 1);
      });
    });
    b.lights.push({ x: x + 7, y: y + 8, r: 26, color: '#ffa24a', i: 0.7 });
  },

  capsule(b, p) {
    // Stacked sleep capsules (2 wide, two tiers).
    const w = p.w ?? 2;
    blockFoot(b, p, w, 1);
    tall(b, { ...p, w }, w * TS, 30, (c, e) => {
      const W = w * TS;
      c.fillStyle = '#0f0e17'; c.fillRect(0, 0, W, 30);
      for (let tier = 0; tier < 2; tier++) {
        const ty = tier * 14 + 1;
        c.fillStyle = '#c8ccd8'; c.fillRect(1, ty, W - 2, 13);
        c.fillStyle = '#e6e8ee'; c.fillRect(1, ty, W - 2, 1);
        c.fillStyle = '#20222e'; c.fillRect(4, ty + 3, W - 8, 8);
        both(c, e, (k) => {
          k.fillStyle = tier === 0 ? '#7ad8ff' : '#b89aff';
          k.globalAlpha = 0.8; k.fillRect(5, ty + 4, W - 10, 1); k.globalAlpha = 1;
        });
      }
    });
  },

  fence(b, p) {
    const w = p.w ?? 1;
    blockFoot(b, p, w, 1);
    tall(b, { ...p, w }, w * TS, 24, (c) => {
      const W = w * TS;
      c.fillStyle = '#3a3d4a';
      for (let xx = 0; xx < W; xx += 8) c.fillRect(xx, 0, 1, 24);
      c.fillStyle = '#5a5e6e';
      for (let yy = 0; yy < 24; yy += 3) for (let xx = (yy % 6 === 0 ? 0 : 1); xx < W; xx += 2) c.fillRect(xx, yy, 1, 1);
      c.fillStyle = '#6a6e7e'; c.fillRect(0, 0, W, 1);
    });
  },
};

export function paintProp(b: BakeCtx, p: PropDef, seed: number): void {
  const painter = PROPS[p.kind];
  const rng = new Rng(seed);
  if (painter) painter(b, p, rng);
  else {
    // Unknown prop: neutral box (should never ship — caught by shots review).
    blockFoot(b, p);
    b.g.fillStyle = '#ff00ff';
    b.g.fillRect(p.x * TS + 2, p.y * TS + 2, 12, 12);
  }
}
