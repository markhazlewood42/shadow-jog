/**
 * Battle visual effects in battle-world coordinates (240×135, drawn 2×).
 * `play(id, from, targets)` spawns shapes and particles and returns when the impact lands
 * and when the effect is done, so the scene can sync damage numbers to the hit.
 */
import { surface, type Ctx } from '../engine/canvas';
import { mix } from '../engine/color';
import { Rng } from '../engine/rng';

export interface Pt {
  x: number;
  y: number;
}

interface Particle {
  x: number; y: number; vx: number; vy: number; g: number; drag: number;
  life: number; max: number; color: string; size: number; kind: 'dot' | 'spark' | 'glyph' | 'crow' | 'smoke';
  ch?: string | undefined; delay: number;
}

interface Shape {
  t: number; max: number; delay: number;
  draw: (ctx: Ctx, k: number, t: number) => void;
}

export interface FxTiming {
  impact: number;
  total: number;
}

const GLYPHS = '01#$%&*+<>=/\\{}[]|?';

/** Crescent sprites, drawn once per size and colour. */
const crescentCache = new Map<string, HTMLCanvasElement>();
function crescentSprite(r: number, color: string): HTMLCanvasElement {
  const key = `${r}:${color}`;
  let c = crescentCache.get(key);
  if (!c) {
    const s = surface(r * 2 + 2, r * 2 + 2);
    const ox = r * 0.5, oy = -r * 0.4, ir = r * 0.92;
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        const d = Math.hypot(x, y), di = Math.hypot(x - ox, y - oy);
        if (d > r || di < ir) continue;
        s.ctx.fillStyle = r - d < 1.5 || di - ir < 1.5 ? '#ffffff' : color;
        s.ctx.fillRect(x + r + 1, y + r + 1, 1, 1);
      }
    }
    c = s.canvas;
    crescentCache.set(key, c);
  }
  return c;
}

export class FxLayer {
  private parts: Particle[] = [];
  private shapes: Shape[] = [];
  private rng = new Rng(9);
  /** Screen flash requests consumed by the scene. */
  flash: { color: string; frames: number } | null = null;
  shake = 0;
  /**
   * Effect frames per real frame. The scene sets it every frame (battle pace, Battle Speed, held
   * confirm): below 1 the effects play slower than they're authored and linger. Every duration in
   * the catalogue below is in effect frames; `realFrames` converts.
   */
  rate = 1;

  /** How many real frames `frames` effect frames take at the current rate. */
  realFrames(frames: number): number {
    return Math.max(1, Math.round(frames / this.rate));
  }

  get busy(): boolean {
    return this.parts.length > 0 || this.shapes.length > 0;
  }

  clear(): void {
    this.parts = [];
    this.shapes = [];
  }

  private p(o: Partial<Particle> & { x: number; y: number }): void {
    this.parts.push({ vx: 0, vy: 0, g: 0, drag: 1, life: 0, max: 24, color: '#ffffff', size: 1, kind: 'dot', delay: 0, ...o });
  }

  private s(max: number, draw: Shape['draw'], delay = 0): void {
    this.shapes.push({ t: 0, max, delay, draw });
  }

  // ------------------------------------------------------------------ primitives
  burst(at: Pt, color: string, n = 12, speed = 2, delay = 0, life = 18): void {
    for (let i = 0; i < n; i++) {
      const a = this.rng.range(0, Math.PI * 2), v = this.rng.range(speed * 0.4, speed);
      this.p({ x: at.x, y: at.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 0.9, max: life + this.rng.int(-4, 4), color, size: this.rng.chance(0.3) ? 2 : 1, kind: 'spark', delay });
    }
  }

  private rise(at: Pt, color: string, n: number, spread: number, delay = 0, speed = 0.6): void {
    for (let i = 0; i < n; i++)
      this.p({ x: at.x + this.rng.range(-spread, spread), y: at.y + this.rng.range(-spread / 2, spread / 2), vy: -this.rng.range(speed * 0.5, speed * 1.5), vx: this.rng.range(-0.15, 0.15), max: this.rng.int(24, 40), color, size: this.rng.chance(0.4) ? 2 : 1, delay: delay + this.rng.int(0, 10) });
  }

  private slash(at: Pt, color: string, delay = 0, len = 14, angle = -0.8, width = 2): void {
    this.s(10, (ctx, k) => {
      const grow = Math.min(1, k * 3);
      const fade = 1 - Math.max(0, (k - 0.4) / 0.6);
      const dx = Math.cos(angle) * len, dy = Math.sin(angle) * len;
      ctx.globalAlpha = fade;
      for (let i = -len; i < len * (grow * 2 - 1); i++) {
        const t = i / len;
        const x = at.x + dx * t, y = at.y - dy * t;
        ctx.fillStyle = color;
        ctx.fillRect(Math.round(x), Math.round(y) - 1, width, width + 1);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
      ctx.globalAlpha = 1;
    }, delay);
  }

  /** The contact frame of a hit: a white four-point star, then a smaller coloured one. */
  private impact(at: Pt, color: string, delay = 0, r = 7): void {
    this.s(5, (ctx, k) => {
      const hot = k < 0.4, len = Math.round(r * (hot ? 1 : 0.6));
      const x = Math.round(at.x), y = Math.round(at.y);
      ctx.fillStyle = hot ? '#ffffff' : color;
      ctx.fillRect(x - len, y, len * 2 + 1, 1);
      ctx.fillRect(x, y - len, 1, len * 2 + 1);
      const d = Math.round(len * 0.55);
      for (let i = 1; i <= d; i++) {
        ctx.fillRect(x - i, y - i, 1, 1);
        ctx.fillRect(x + i, y - i, 1, 1);
        ctx.fillRect(x - i, y + i, 1, 1);
        ctx.fillRect(x + i, y + i, 1, 1);
      }
      if (hot) ctx.fillRect(x - 1, y - 1, 3, 3);
    }, delay);
  }

  /** Chips knocked off the target: flung up and out, then falling. */
  private debris(at: Pt, color: string, n: number, delay = 0): void {
    for (let i = 0; i < n; i++)
      this.p({ x: at.x + this.rng.range(-3, 3), y: at.y + this.rng.range(-3, 3), vx: this.rng.range(-1.6, 1.6), vy: -this.rng.range(0.8, 2.2), g: 0.16, drag: 0.98, max: this.rng.int(18, 28), color, size: this.rng.chance(0.35) ? 2 : 1, kind: 'spark', delay });
  }

  /** Speed lines converging on the point of impact just before contact. */
  private converge(at: Pt, color: string, frames = 4, delay = 0): void {
    const angles = [this.rng.range(2.4, 3.0), this.rng.range(3.3, 3.8), this.rng.range(-0.4, 0.3)];
    this.s(frames, (ctx, k) => {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.9;
      for (const a of angles) {
        const r0 = 22 * (1 - k) + 4, r1 = r0 + 7;
        for (let r = r0; r < r1; r++) ctx.fillRect(Math.round(at.x + Math.cos(a) * r), Math.round(at.y + Math.sin(a) * r * 0.6), 1, 1);
      }
      ctx.globalAlpha = 1;
    }, delay);
  }

  private ring(at: Pt, color: string, r0: number, r1: number, frames: number, delay = 0, thick = 1): void {
    this.s(frames, (ctx, k) => {
      const r = r0 + (r1 - r0) * k;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = color;
      const n = Math.max(12, Math.round(r * 5));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        ctx.fillRect(Math.round(at.x + Math.cos(a) * r), Math.round(at.y + Math.sin(a) * r * 0.6), thick, thick);
      }
      ctx.globalAlpha = 1;
    }, delay);
  }

  private bolt(at: Pt, color: string, delay = 0, fromY = -4): void {
    const pts: Pt[] = [];
    let x = at.x + this.rng.range(-10, 10);
    for (let y = fromY; y < at.y; y += 6) {
      pts.push({ x, y });
      x += this.rng.range(-5, 5);
    }
    pts.push(at);
    this.s(12, (ctx, k) => {
      if (k > 0.7 && Math.floor(k * 20) % 2) return;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        if (!a || !b) continue;
        const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
        for (let j = 0; j <= n; j++) {
          const xx = a.x + ((b.x - a.x) * j) / n, yy = a.y + ((b.y - a.y) * j) / n;
          ctx.fillStyle = color;
          ctx.fillRect(Math.round(xx) - 1, Math.round(yy), 3, 1);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(Math.round(xx), Math.round(yy), 1, 1);
        }
      }
    }, delay);
  }

  private beam(from: Pt, to: Pt, color: string, delay = 0, frames = 22, width = 5): void {
    this.s(frames, (ctx, k) => {
      const w = width * (k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8) + 1;
      const n = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y));
      for (let j = 0; j <= n; j++) {
        const x = from.x + ((to.x - from.x) * j) / n, y = from.y + ((to.y - from.y) * j) / n;
        ctx.fillStyle = color;
        ctx.fillRect(Math.round(x - w / 2), Math.round(y - w / 2), Math.ceil(w), Math.ceil(w));
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(Math.round(x - w / 4), Math.round(y - w / 4), Math.max(1, Math.ceil(w / 2)), Math.max(1, Math.ceil(w / 2)));
      }
    }, delay);
  }

  private tracer(from: Pt, to: Pt, color: string, delay: number): void {
    this.s(6, (ctx, k) => {
      const t0 = k, t1 = Math.min(1, k + 0.35);
      const n = 12;
      for (let j = 0; j <= n; j++) {
        const t = t0 + ((t1 - t0) * j) / n;
        ctx.fillStyle = j > n - 3 ? '#ffffff' : color;
        ctx.fillRect(Math.round(from.x + (to.x - from.x) * t), Math.round(from.y + (to.y - from.y) * t), 1, 1);
      }
    }, delay);
  }

  // ---- marquee shapes: one silhouette per signature move, not a rescaled burst

  /** A crescent that drops from the top of the frame and bites down on the target. */
  private crescent(at: Pt, color: string, r: number, delay = 0, frames = 22): void {
    const spr = crescentSprite(r, color);
    this.s(frames, (ctx, k) => {
      const fall = Math.min(1, k / 0.5);
      const cy = -r * 2 + (at.y - 4 + r * 2) * fall * fall;
      ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      ctx.drawImage(spr, Math.round(at.x - r - 1), Math.round(cy - r - 1));
      // Afterimage trail while it falls.
      if (fall < 1) {
        ctx.globalAlpha *= 0.35;
        ctx.drawImage(spr, Math.round(at.x - r - 1), Math.round(cy - r - 1 - 10));
      }
      ctx.globalAlpha = 1;
    }, delay);
  }

  /** A column of fire or light rising from the ground under the target, flickering at its edges. */
  private pillar(at: Pt, color: string, core: string, h: number, delay = 0, frames = 26): void {
    const seed = this.rng.range(0, 10);
    const base = at.y + 10;
    this.s(frames, (ctx, k, t) => {
      const grow = Math.min(1, k / 0.25);
      ctx.globalAlpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      const top = Math.round(base - h * grow);
      for (let y = top; y < base; y++) {
        const u = (base - y) / h;
        const wob = Math.sin(y * 0.6 + t * 0.8 + seed) * 1.4;
        const w = Math.max(1, Math.round(8 - u * 5 + wob));
        ctx.fillStyle = color;
        ctx.fillRect(Math.round(at.x - w), y, w * 2, 1);
        const cw = Math.max(0, Math.round(w * 0.45));
        if (cw) {
          ctx.fillStyle = core;
          ctx.fillRect(Math.round(at.x - cw), y, cw * 2, 1);
        }
      }
      ctx.globalAlpha = 1;
    }, delay);
  }

  /** A jagged crack racing along the ground through the target, spitting sparks. */
  private fissure(at: Pt, color: string, delay = 0): void {
    const pts: Pt[] = [];
    let y = at.y + 10;
    for (let x = at.x - 70; x <= at.x + 70; x += 3) {
      pts.push({ x, y });
      y = Math.max(at.y + 6, Math.min(at.y + 14, y + this.rng.range(-1.6, 1.6)));
    }
    this.s(22, (ctx, k) => {
      const reach = Math.min(1, k / 0.35);
      ctx.globalAlpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      const mid = Math.floor(pts.length / 2), span = Math.ceil(mid * reach);
      for (let i = Math.max(1, mid - span); i < Math.min(pts.length, mid + span); i++) {
        const a = pts[i - 1], b = pts[i];
        if (!a || !b) continue;
        for (let j = 0; j < 3; j++) {
          const xx = a.x + ((b.x - a.x) * j) / 3, yy = a.y + ((b.y - a.y) * j) / 3;
          ctx.fillStyle = color;
          ctx.fillRect(Math.round(xx), Math.round(yy) - 1, 1, 3);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(Math.round(xx), Math.round(yy), 1, 1);
        }
      }
      ctx.globalAlpha = 1;
    }, delay);
    for (let i = 0; i < 6; i++) this.burst({ x: at.x + this.rng.range(-50, 50), y: at.y + 10 }, color, 4, 1.6, delay + 4 + i, 12);
  }

  /** Right-angled circuit traces racing in from both sides and converging on the target. */
  private circuit(at: Pt, color: string, delay = 0): void {
    const paths: Pt[][] = [];
    for (let i = 0; i < 4; i++) {
      const side = i % 2 ? 1 : -1;
      const x0 = at.x + side * this.rng.range(55, 90), y0 = at.y + this.rng.range(-26, 26);
      const elbow = at.x + side * this.rng.range(8, 30);
      paths.push([{ x: x0, y: y0 }, { x: elbow, y: y0 }, { x: elbow, y: at.y }, { x: at.x, y: at.y }]);
    }
    this.s(22, (ctx, k) => {
      const run = Math.min(1, k / 0.6);
      ctx.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      for (const p of paths) {
        const seg = (i: number) => {
          const a = p[i - 1], b = p[i];
          return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
        };
        const lens = [seg(1), seg(2), seg(3)];
        let left = lens.reduce((n, l) => n + l, 0) * run;
        for (let i = 1; i < 4 && left > 0; i++) {
          const a = p[i - 1], b = p[i], len = lens[i - 1] ?? 0;
          if (!a || !b || !len) continue;
          const n = Math.min(len, left);
          for (let j = 0; j <= n; j++) {
            ctx.fillStyle = color;
            ctx.fillRect(Math.round(a.x + ((b.x - a.x) * j) / len), Math.round(a.y + ((b.y - a.y) * j) / len), 1, 1);
          }
          if (left >= len) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(Math.round(b.x) - 1, Math.round(b.y) - 1, 3, 3);
          }
          left -= len;
        }
      }
      ctx.globalAlpha = 1;
    }, delay);
  }

  /** A serpent of ki: a sinuous body that winds from the user to the target, head first. */
  private dragon(from: Pt, to: Pt, color: string, delay = 0, frames = 22): void {
    this.s(frames, (ctx, k) => {
      const head = Math.min(1, k / 0.55);
      const tail = Math.max(0, head - 0.5);
      ctx.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      const n = 48;
      for (let j = 0; j <= n; j++) {
        const u = tail + (head - tail) * (j / n);
        const x = from.x + (to.x - from.x) * u;
        const y = from.y + (to.y - from.y) * u + Math.sin(u * 13 + k * 5) * 9 * (1 - u * 0.6);
        const w = 1 + Math.round(3 * (j / n));
        ctx.fillStyle = j > n - 4 ? '#ffffff' : j % 6 === 0 ? '#ffe0b0' : color;
        ctx.fillRect(Math.round(x - w / 2), Math.round(y - w / 2), w, w);
      }
      ctx.globalAlpha = 1;
    }, delay);
  }

  /** A flattened ground ring pushed out from an impact. */
  private shockwave(at: Pt, color: string, delay = 0, r1 = 44): void {
    this.s(16, (ctx, k) => {
      const r = 4 + r1 * (1 - (1 - k) ** 2);
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = color;
      const n = Math.round(r * 4);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        ctx.fillRect(Math.round(at.x + Math.cos(a) * r), Math.round(at.y + 12 + Math.sin(a) * r * 0.22), 2, 1);
      }
      ctx.globalAlpha = 1;
    }, delay);
  }

  private glyphs(at: Pt, color: string, n: number, delay = 0): void {
    for (let i = 0; i < n; i++)
      this.p({ x: at.x + this.rng.range(-14, 14), y: at.y - 24 + this.rng.range(-6, 6), vy: this.rng.range(0.8, 1.6), max: this.rng.int(18, 30), color, kind: 'glyph', ch: GLYPHS[this.rng.int(0, GLYPHS.length - 1)], delay: delay + this.rng.int(0, 12) });
  }

  private crows(from: Pt, to: Pt, n: number, delay = 0): void {
    for (let i = 0; i < n; i++) {
      const sx = from.x - 30 + this.rng.range(-10, 10), sy = from.y - 40 + this.rng.range(-20, 20);
      const dur = 20 + this.rng.int(0, 8);
      this.p({ x: sx, y: sy, vx: (to.x - sx) / dur + this.rng.range(-0.3, 0.3), vy: (to.y - sy) / dur, max: dur + 6, color: '#1a1020', kind: 'crow', delay: delay + i * 2 });
    }
  }

  private smoke(at: Pt, color: string, n: number, delay = 0): void {
    for (let i = 0; i < n; i++)
      this.p({ x: at.x + this.rng.range(-10, 10), y: at.y + this.rng.range(-8, 8), vx: this.rng.range(-0.4, 0.4), vy: -this.rng.range(0.1, 0.5), max: this.rng.int(26, 40), color, kind: 'smoke', size: this.rng.int(3, 6), delay: delay + this.rng.int(0, 8) });
  }

  private static scratch: FxLayer | null = null;
  /** When `id`'s hit lands, without showing it: the same catalogue runs on a scratch layer. */
  impactOf(id: string, from: Pt, targets: Pt[], color?: string): number {
    if (!FxLayer.scratch) FxLayer.scratch = new FxLayer();
    const s = FxLayer.scratch;
    const t = s.play(id, from, targets, color);
    s.clear();
    return t.impact;
  }

  // ------------------------------------------------------------------ catalogue
  play(id: string, from: Pt, targets: Pt[], color?: string): FxTiming {
    const T = targets.length ? targets : [from];
    const each = (fn: (t: Pt, i: number) => void) => T.forEach(fn);
    switch (id) {
      case 'slash':
      case 'claw':
      case 'whip':
        each((t) => {
          const col = color ?? '#e8f0ff', ang = id === 'claw' ? -1.1 : -0.8;
          this.slash(t, col, 0, 12, ang);
          // Afterimage: a thinner cut trailing a frame behind.
          this.slash({ x: t.x + 2, y: t.y + 1 }, col, 2, 10, ang, 1);
          if (id === 'claw') this.slash({ x: t.x + 4, y: t.y }, '#e8f0ff', 2, 11, -1.1);
          this.impact(t, col, 3, 6);
          this.burst(t, '#ffffff', 6, 1.6, 3);
          this.debris(t, id === 'claw' ? '#ff9a9a' : '#c8d0e0', 4, 4);
        });
        return { impact: 4, total: 18 };
      case 'punch':
      case 'bite':
      case 'crush':
        each((t) => {
          const hot = id === 'bite' ? '#ff6a6a' : '#ffe07a';
          this.converge(t, '#ffffff', 3, 0);
          this.impact(t, hot, 2, id === 'crush' ? 9 : 7);
          this.ring(t, '#ffffff', 2, 12, 10, 2, 1);
          this.burst(t, hot, 10, 2.2, 2);
          this.debris(t, id === 'crush' ? '#8a8490' : hot, id === 'crush' ? 8 : 4, 3);
        });
        this.shake = id === 'crush' ? 8 : 3;
        return { impact: 3, total: 18 };
      case 'flash_step':
        each((t) => {
          this.s(8, (ctx, k) => {
            ctx.globalAlpha = 1 - k;
            ctx.fillStyle = '#ff8a6a';
            ctx.fillRect(Math.round(t.x - 40 + k * 40), Math.round(t.y), 36, 1);
            ctx.globalAlpha = 1;
          });
          this.slash(t, '#ff8a6a', 5, 16, -0.6, 2);
          this.slash(t, '#ffd0a0', 8, 16, 0.6, 2);
          this.burst(t, '#ffd0a0', 12, 2.6, 8);
        });
        return { impact: 8, total: 22 };
      case 'moonfall':
        each((t, i) => {
          this.crescent(t, '#b8a0ff', 15, i * 3);
          this.slash(t, '#e0d0ff', 11 + i * 3, 30, 0, 2);
          this.burst(t, '#d8c8ff', 22, 3.4, 11 + i * 3, 22);
          this.shockwave(t, '#b8a0ff', 11 + i * 3, 36);
        });
        this.flash = { color: '#b8a0ff', frames: 8 };
        this.shake = 8;
        return { impact: 12, total: 36 };
      case 'arc_cut':
        each((t) => {
          this.s(14, (ctx, k) => {
            const r = 18;
            ctx.globalAlpha = 1 - Math.max(0, (k - 0.5) * 2);
            const sweep = Math.min(1, k * 2.5);
            for (let a = -1.9; a < -1.9 + 2.6 * sweep; a += 0.04) {
              const x = t.x + Math.cos(a) * r, y = t.y + Math.sin(a) * r * 0.8 + 6;
              ctx.fillStyle = '#d8e8ff';
              ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
            }
            ctx.globalAlpha = 1;
          });
          this.burst(t, '#ffffff', 12, 2.4, 6);
        });
        this.shake = 5;
        return { impact: 6, total: 24 };
      case 'gunfire':
      case 'shot':
        each((t, i) => {
          const shots = id === 'shot' ? 1 : 3;
          for (let k = 0; k < shots; k++) {
            const d = i * 2 + k * 3;
            const tt = { x: t.x + this.rng.range(-5, 5), y: t.y + this.rng.range(-6, 6) };
            // Muzzle flash: a hot star at the barrel for each shot.
            this.s(4, (ctx, kk) => {
              const r = 4 * (1 - kk) + 1;
              ctx.globalAlpha = 1 - kk * 0.6;
              ctx.fillStyle = '#fff4c0';
              ctx.fillRect(Math.round(from.x - r), Math.round(from.y - 12), Math.round(r * 2), 1);
              ctx.fillRect(Math.round(from.x), Math.round(from.y - 12 - r), 1, Math.round(r * 2));
              ctx.fillStyle = '#ffb040';
              ctx.fillRect(Math.round(from.x - 1), Math.round(from.y - 13), 3, 3);
              ctx.globalAlpha = 1;
            }, d);
            this.tracer(from, tt, '#ffe07a', d);
            // Impact: white pop, spark spray and a little dust.
            this.ring(tt, '#ffffff', 1, 5, 6, d + 3, 1);
            this.burst(tt, '#ffe07a', 6, 1.8, d + 3, 12);
            this.burst(tt, '#8a8490', 3, 0.6, d + 4, 18);
          }
        });
        return { impact: 5, total: 20 };
      case 'coil':
        each((t, i) => {
          this.dragon(from, t, '#ffb46a', i * 2);
          this.ring(t, '#ffb46a', 2, 22, 14, 11 + i * 2, 2);
          this.burst(t, '#ffe0b0', 16, 2.6, 12 + i * 2, 20);
        });
        this.flash = { color: '#ffb46a', frames: 6 };
        return { impact: 12, total: 34 };
      case 'palm':
        each((t) => {
          this.ring(t, '#ffb46a', 2, 18, 14, 0, 2);
          this.ring(t, '#ffffff', 2, 10, 10, 3, 1);
          this.rise(t, '#ffd0a0', 10, 8, 4);
        });
        return { impact: 5, total: 26 };
      case 'rain_hits':
        each((t) => {
          for (let k = 0; k < 5; k++) this.burst({ x: t.x + this.rng.range(-10, 10), y: t.y + this.rng.range(-10, 10) }, '#ffd0a0', 5, 1.8, k * 3, 10);
        });
        return { impact: 3, total: 22 };
      case 'code':
      case 'glitch':
      case 'scan':
        each((t) => {
          this.glyphs(t, id === 'scan' ? '#62e06a' : '#3fe0f0', id === 'code' ? 14 : 10);
          if (id === 'scan') {
            this.s(24, (ctx, k) => {
              ctx.fillStyle = '#62e06a';
              ctx.globalAlpha = 0.8;
              ctx.fillRect(Math.round(t.x - 16), Math.round(t.y - 18 + k * 36), 32, 1);
              ctx.globalAlpha = 1;
            });
          } else {
            this.s(18, (ctx, k) => {
              if (Math.floor(k * 12) % 2) return;
              ctx.fillStyle = id === 'glitch' ? '#ff4fb0' : '#3fe0f0';
              ctx.globalAlpha = 0.6;
              for (let r = 0; r < 4; r++) ctx.fillRect(Math.round(t.x - 14 + this.rng.range(-3, 3)), Math.round(t.y - 12 + r * 7), 28, 2);
              ctx.globalAlpha = 1;
            }, 4);
          }
        });
        return { impact: 12, total: 28 };
      case 'lightning':
      case 'zap':
        each((t, i) => {
          if (id === 'lightning') this.bolt(t, '#9ae8ff', i * 3);
          else this.bolt(t, '#9ae8ff', 0, t.y - 20);
          this.burst(t, '#d8f6ff', 10, 2.2, i * 3 + 4);
        });
        this.flash = { color: '#9ae8ff', frames: 5 };
        return { impact: 5, total: 20 };
      case 'fire':
      case 'fire_all':
      case 'explosion':
        each((t, i) => {
          const d = i * 3;
          this.burst(t, '#ffa24a', 14, 2, d, 20);
          this.burst(t, '#ffe07a', 8, 1.2, d, 14);
          this.rise(t, '#ff6a2a', 12, 8, d, 0.9);
          if (id === 'explosion') {
            this.ring(t, '#ffe07a', 2, 20, 12, d, 2);
            this.shockwave(t, '#ffa24a', d, 40);
          }
          if (id === 'fire_all') this.pillar(t, '#ff6a2a', '#ffe07a', 34, d);
          this.smoke(t, '#5a4a4a', 5, d + 8);
        });
        if (id !== 'fire') this.flash = { color: '#ffa24a', frames: 6 };
        this.shake = id === 'explosion' ? 6 : 2;
        return { impact: 6, total: 30 };
      case 'heal':
      case 'heal_all':
      case 'heal_self':
      case 'revive':
      case 'cleanse':
      case 'tp':
      case 'lifeline': {
        const col = id === 'tp' ? '#6ff3ff' : id === 'revive' ? '#ffe07a' : id === 'cleanse' ? '#e0f0ff' : '#86f08c';
        each((t, i) => {
          this.rise(t, col, 14, 10, i * 2, 0.7);
          this.ring(t, col, 16, 3, 18, i * 2, 1);
          if (id === 'revive' || id === 'lifeline') this.s(24, (ctx, k) => {
            ctx.globalAlpha = 0.6 * (1 - k);
            ctx.fillStyle = col;
            ctx.fillRect(Math.round(t.x - 6), 0, 12, Math.round(t.y + 10));
            ctx.globalAlpha = 1;
          });
        });
        return { impact: 10, total: 30 };
      }
      case 'victory': {
        // Confetti of spark colours from each fighter, then a slow rise of motes.
        const cols = ['#ffe07a', '#ff4fb0', '#3fe0f0', '#86f08c', '#ffa24a'];
        each((t, i) => {
          for (let n = 0; n < 16; n++) {
            const a = -Math.PI / 2 + (this.rng.next() - 0.5) * 1.8;
            const sp = 1.6 + this.rng.next() * 1.8;
            this.p({ x: t.x, y: t.y - 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 0.09, max: 34 + n, color: cols[(n + i) % cols.length] ?? '#ffffff', size: 1, kind: 'spark', delay: i * 4 });
          }
          this.rise(t, '#ffe07a', 10, 18, 10 + i * 4, 0.4);
        });
        return { impact: 6, total: 50 };
      }
      case 'shield':
      case 'buff':
      case 'roar':
      case 'guard': {
        const col = id === 'roar' ? '#ff6a6a' : id === 'buff' ? '#ffcc3d' : '#6ff3ff';
        each((t, i) => {
          this.ring(t, col, 4, 18, 18, i * 2, 1);
          this.ring(t, '#ffffff', 2, 12, 14, i * 2 + 4, 1);
        });
        return { impact: 8, total: 22 };
      }
      case 'crow':
        each((t) => this.crows(from, t, 5));
        each((t) => this.burst(t, '#b07cff', 10, 2, 20));
        return { impact: 22, total: 36 };
      case 'smog':
      case 'dark':
      case 'wail':
        each((t, i) => {
          this.smoke(t, id === 'smog' ? '#6a6a5a' : '#5a3a8a', 10, i * 2);
          if (id !== 'smog') this.ring(t, '#b07cff', 16, 2, 16, i * 2, 1);
        });
        return { impact: 10, total: 30 };
      case 'wave':
        this.s(26, (ctx, k) => {
          ctx.fillStyle = '#6ab8d8';
          ctx.globalAlpha = 0.7 * (1 - k);
          const y = 135 - k * 70;
          for (let x = 0; x < 240; x += 2) ctx.fillRect(x, Math.round(y + Math.sin(x * 0.1 + k * 10) * 4), 2, 10);
          ctx.globalAlpha = 1;
        });
        this.shake = 5;
        return { impact: 12, total: 28 };
      case 'flash':
        this.flash = { color: '#ffffff', frames: 10 };
        return { impact: 4, total: 14 };
      case 'beam':
        each((t) => {
          this.beam(from, t, '#6ff3ff', 0, 26, 7);
          this.burst(t, '#d8f6ff', 20, 3, 6);
          this.shockwave(t, '#6ff3ff', 8, 50);
        });
        this.flash = { color: '#6ff3ff', frames: 8 };
        this.shake = 10;
        return { impact: 8, total: 30 };
      case 'bolt':
        each((t) => {
          this.beam(from, t, '#b07cff', 0, 14, 3);
          this.burst(t, '#e0d0ff', 10, 2, 6);
        });
        return { impact: 7, total: 18 };
      case 'summon':
        each((t) => this.ring(t, '#ff3a3a', 30, 2, 18, 0, 1));
        return { impact: 10, total: 20 };
      case 'smoke':
        each((t) => this.smoke(t, '#8a8a9a', 20));
        return { impact: 6, total: 24 };
      case 'item':
        each((t) => this.rise(t, '#ffffff', 8, 8));
        return { impact: 6, total: 16 };
      // ---------------------------------------------------------------- combos
      case 'thunder_rift':
        each((t) => {
          this.s(8, (ctx, k) => {
            ctx.globalAlpha = 1 - k;
            ctx.fillStyle = '#ff8a6a';
            ctx.fillRect(0, Math.round(t.y), Math.round(240 * k), 2);
            ctx.globalAlpha = 1;
          });
          this.bolt(t, '#ffe07a', 6);
          this.bolt({ x: t.x + 6, y: t.y }, '#9ae8ff', 9);
          this.slash(t, '#ffffff', 12, 26, -0.9, 3);
          this.burst(t, '#ffe07a', 30, 4, 12, 24);
          this.fissure(t, '#ffe07a', 12);
        });
        this.flash = { color: '#ffe07a', frames: 10 };
        this.shake = 12;
        return { impact: 13, total: 36 };
      case 'target_lock':
        each((t, i) => {
          this.s(20, (ctx, k) => {
            const r = 14 - k * 8;
            ctx.fillStyle = '#62e06a';
            ctx.fillRect(Math.round(t.x - r), Math.round(t.y), Math.round(r * 2), 1);
            ctx.fillRect(Math.round(t.x), Math.round(t.y - r), 1, Math.round(r * 2));
          }, i * 2);
          for (let k = 0; k < 4; k++) this.tracer(from, t, '#ffe07a', 16 + i * 2 + k * 2);
          this.burst(t, '#ffe07a', 10, 2.4, 20 + i * 2);
        });
        return { impact: 20, total: 34 };
      case 'ghost_circuit':
        each((t) => {
          this.circuit(t, '#3fe0f0', 0);
          this.glyphs(t, '#3fe0f0', 18);
          this.ring(t, '#ffb46a', 30, 2, 20, 4, 2);
          this.beam({ x: t.x, y: -4 }, t, '#e0d0ff', 16, 16, 6);
          this.burst(t, '#ffffff', 30, 4, 20, 26);
        });
        this.flash = { color: '#e0d0ff', frames: 12 };
        this.shake = 12;
        return { impact: 20, total: 40 };
      case 'pyre_storm':
        each((t, i) => {
          this.bolt(t, '#9ae8ff', i * 2);
          this.pillar(t, '#ff6a2a', '#ffe07a', 46, 6 + i * 2, 30);
          this.burst(t, '#ffa24a', 20, 3, 6 + i * 2, 24);
          this.rise(t, '#ff6a2a', 16, 12, 6 + i * 2, 1.2);
        });
        this.flash = { color: '#ffa24a', frames: 10 };
        this.shake = 10;
        return { impact: 8, total: 36 };
      case 'crows_wing':
        // A wall of crows settles over the crew, then the ward rings close.
        each((t, i) => {
          this.crows({ x: t.x + 40, y: -10 }, t, 4, i * 3);
          this.ring(t, '#b07cff', 26, 3, 20, 10 + i * 2, 1);
          this.ring(t, '#6ff3ff', 4, 18, 18, 16 + i * 2, 1);
          this.rise(t, '#86f08c', 10, 10, 20 + i * 2, 0.7);
        });
        this.flash = { color: '#6ff3ff', frames: 8 };
        return { impact: 18, total: 40 };
      case 'spirit_walk':
        each((t) => this.crows(from, t, 6));
        each((t) => {
          for (let k = 0; k < 8; k++) this.burst({ x: t.x + this.rng.range(-12, 12), y: t.y + this.rng.range(-12, 12) }, k % 2 ? '#b07cff' : '#ffd0a0', 6, 2, 14 + k * 2, 12);
        });
        this.flash = { color: '#b07cff', frames: 8 };
        return { impact: 14, total: 40 };
      case 'blackout':
        // The lights go: a dark sweep across the pack, muzzle flashes in it, dead-screen static.
        this.flash = { color: '#000000', frames: 14 };
        each((t, i) => {
          this.s(22, (ctx, k) => {
            ctx.globalAlpha = 0.55 * (1 - k);
            ctx.fillStyle = '#05040a';
            ctx.fillRect(Math.round(t.x - 16), Math.round(t.y - 16), 32, 32);
            ctx.globalAlpha = 1;
          }, i * 2);
          for (let k = 0; k < 3; k++) this.tracer(from, t, '#ffcc3d', 4 + i * 2 + k * 3);
          this.glyphs(t, '#3fe0f0', 5, 10 + i * 2);
          this.burst(t, '#ffcc3d', 6, 1.8, 8 + i * 2);
        });
        this.shake = 6;
        return { impact: 10, total: 30 };
      case 'clean_job':
        // Hex's crosshair finds the seam; Kit's blur opens it; Rook's cut goes through.
        each((t) => {
          this.s(14, (ctx, k) => {
            const r = 16 - k * 10;
            ctx.fillStyle = '#62e06a';
            ctx.fillRect(Math.round(t.x - r), Math.round(t.y), Math.round(r * 2), 1);
            ctx.fillRect(Math.round(t.x), Math.round(t.y - r), 1, Math.round(r * 2));
          });
          this.s(8, (ctx, k) => {
            ctx.globalAlpha = 1 - k;
            ctx.fillStyle = '#ff8a6a';
            ctx.fillRect(0, Math.round(t.y), Math.round(240 * k), 2);
            ctx.globalAlpha = 1;
          }, 10);
          this.bolt(t, '#9ae8ff', 14);
          this.slash(t, '#ffffff', 16, 30, -0.9, 3);
          this.slash({ x: t.x + 3, y: t.y + 2 }, '#ffe07a', 18, 26, -0.9, 2);
          this.burst(t, '#ffe07a', 34, 4.2, 16, 26);
          this.fissure(t, '#ffe07a', 16);
        });
        this.flash = { color: '#ffffff', frames: 10 };
        this.shake = 14;
        return { impact: 17, total: 40 };
      default:
        each((t) => this.burst(t, color ?? '#ffffff', 8, 1.8));
        return { impact: 3, total: 14 };
    }
  }

  update(): void {
    // Integrated in effect frames (dt of them per real frame), so a slower rate stretches every
    // effect smoothly instead of skipping frames.
    const dt = this.rate;
    for (const p of this.parts) {
      if (p.delay > 0) {
        p.delay -= dt;
        continue;
      }
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.g * dt;
      if (p.drag !== 1) {
        const d = p.drag ** dt;
        p.vx *= d;
        p.vy *= d;
      }
    }
    let w = 0;
    for (const p of this.parts) if (p.life < p.max) this.parts[w++] = p;
    this.parts.length = w;
    for (const s of this.shapes) {
      if (s.delay > 0) s.delay -= dt;
      else s.t += dt;
    }
    let k = 0;
    for (const s of this.shapes) if (s.t < s.max) this.shapes[k++] = s;
    this.shapes.length = k;
  }

  render(ctx: Ctx, drawGlyph: (ctx: Ctx, ch: string, x: number, y: number, color: string) => void): void {
    for (const s of this.shapes) if (s.delay <= 0) s.draw(ctx, s.t / s.max, s.t);
    for (const p of this.parts) {
      if (p.delay > 0) continue;
      const k = p.life / p.max;
      const x = Math.round(p.x), y = Math.round(p.y);
      switch (p.kind) {
        case 'glyph':
          ctx.globalAlpha = 1 - k;
          drawGlyph(ctx, p.ch ?? '0', x, y, k < 0.2 ? '#ffffff' : p.color);
          break;
        case 'crow': {
          const flap = Math.floor(p.life / 3) % 2;
          ctx.fillStyle = p.color;
          ctx.fillRect(x - 1, y, 3, 1);
          ctx.fillRect(x - 3, y - (flap ? 1 : -1), 2, 1);
          ctx.fillRect(x + 2, y - (flap ? 1 : -1), 2, 1);
          ctx.fillStyle = '#b07cff';
          ctx.fillRect(x, y, 1, 1);
          break;
        }
        case 'smoke':
          ctx.globalAlpha = 0.45 * (1 - k);
          ctx.fillStyle = p.color;
          ctx.fillRect(x - Math.round(p.size / 2), y - Math.round(p.size / 2), p.size + Math.round(k * 4), p.size + Math.round(k * 4));
          break;
        default:
          ctx.globalAlpha = 1 - k * k;
          ctx.fillStyle = k < 0.25 ? mix(p.color, '#ffffff', 0.6) : p.color;
          ctx.fillRect(x, y, p.size, p.size);
      }
      ctx.globalAlpha = 1;
    }
  }
}
