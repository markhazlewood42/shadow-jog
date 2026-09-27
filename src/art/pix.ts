/**
 * Tiny pixel-painting kit for procedural sprites: hard-edged shapes, volumetric shading with
 * ordered dithering (light from the upper left), and auto-outline. No antialiasing anywhere.
 */
import { pixelSurface, surface } from '../engine/canvas';
import { rgb, shade } from '../engine/color';

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

export class Pix {
  readonly w: number;
  readonly h: number;
  private px: Uint32Array;
  private buf: ArrayBuffer;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.buf = new ArrayBuffer(w * h * 4);
    this.px = new Uint32Array(this.buf);
  }

  private pack(c: string): number {
    const [r, g, b] = rgb(c);
    return (255 << 24) | (b << 16) | (g << 8) | r;
  }

  set(x: number, y: number, c: string | number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = typeof c === 'number' ? c : this.pack(c);
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.px[y * this.w + x]!;
  }

  clear(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = 0;
  }

  rect(x: number, y: number, w: number, h: number, c: string): this {
    const p = this.pack(c);
    for (let yy = Math.round(y); yy < Math.round(y + h); yy++) for (let xx = Math.round(x); xx < Math.round(x + w); xx++) this.set(xx, yy, p);
    return this;
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: string): this {
    const p = this.pack(c);
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, p);
      }
    return this;
  }

  /** Ellipse with 4-tone volumetric shading from the upper-left, dithered between tones. */
  ball(cx: number, cy: number, rx: number, ry: number, base: string, opts: { light?: number; rim?: string } = {}): this {
    const ramp = [shade(base, -0.55), shade(base, -0.25), base, shade(base, 0.35)].map((c) => this.pack(c));
    const L = opts.light ?? 0.55;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        const d2 = dx * dx + dy * dy;
        if (d2 > 1) continue;
        const nz = Math.sqrt(1 - d2);
        // Light vector (-0.5, -0.6, 0.62) normalized-ish.
        let l = -0.5 * dx - 0.62 * dy + 0.6 * nz;
        l = (l + 0.35) * L * 1.6;
        const t = Math.max(0, Math.min(3, l * 3));
        const lo = Math.floor(t);
        const frac = t - lo;
        const bayer = (BAYER[y & 3]![x & 3]! + 0.5) / 16;
        const idx = Math.min(3, lo + (frac > bayer ? 1 : 0));
        this.set(x, y, ramp[idx]!);
      }
    if (opts.rim) {
      const rim = this.pack(opts.rim);
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          const dx = (x - cx) / rx, dy = (y - cy) / ry;
          const d2 = dx * dx + dy * dy;
          if (d2 <= 1 && d2 > 0.78 && dx > 0.3 && dy > -0.2) this.set(x, y, rim);
        }
    }
    return this;
  }

  /** Filled polygon (even-odd). */
  poly(pts: [number, number][], c: string): this {
    const p = this.pack(c);
    const minY = Math.floor(Math.min(...pts.map((q) => q[1])));
    const maxY = Math.ceil(Math.max(...pts.map((q) => q[1])));
    for (let y = minY; y <= maxY; y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i]!;
        const [x1, y1] = pts[(i + 1) % pts.length]!;
        if (y0 === y1) continue;
        const yc = y + 0.5;
        if ((yc >= y0 && yc < y1) || (yc >= y1 && yc < y0)) xs.push(x0 + ((yc - y0) / (y1 - y0)) * (x1 - x0));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.round(xs[i]!); x < Math.round(xs[i + 1]!); x++) this.set(x, y, p);
    }
    return this;
  }

  line(x0: number, y0: number, x1: number, y1: number, c: string, thick = 1): this {
    const p = this.pack(c);
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
      if (thick <= 1) this.set(x, y, p);
      else for (let a = 0; a < thick; a++) for (let b = 0; b < thick; b++) this.set(x + a - (thick >> 1), y + b - (thick >> 1), p);
    }
    return this;
  }

  /** Thick tapered stroke along a polyline (tentacles, tails, limbs). */
  limb(pts: [number, number][], r0: number, r1: number, base: string): this {
    const segs: [number, number, number][] = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1]!, [bx, by] = pts[i]!;
      const len = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(1, Math.ceil(len));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const r = r0 + (r1 - r0) * ((acc + len * t) / total);
        segs.push([ax + (bx - ax) * t, ay + (by - ay) * t, r]);
      }
      acc += len;
    }
    for (const [x, y, r] of segs) this.ellipse(x, y, r, r, shade(base, -0.3));
    for (const [x, y, r] of segs) this.ellipse(x - r * 0.25, y - r * 0.25, Math.max(0.5, r * 0.7), Math.max(0.5, r * 0.7), base);
    for (const [x, y, r] of segs) if (r > 1.5) this.set(x - r * 0.45, y - r * 0.45, shade(base, 0.35));
    return this;
  }

  /** Replace every pixel of one color with another (palette swap on a finished sprite). */
  swap(from: string, to: string): this {
    const a = this.pack(from), b = this.pack(to);
    for (let i = 0; i < this.px.length; i++) if (this.px[i] === a) this.px[i] = b;
    return this;
  }

  /** 1px outline around opaque pixels (outside only). */
  outline(c = '#0e0b16'): this {
    const p = this.pack(c);
    const src = this.px.slice();
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (src[y * this.w + x]) continue;
        const n =
          (x > 0 && src[y * this.w + x - 1]) || (x < this.w - 1 && src[y * this.w + x + 1]) || (y > 0 && src[(y - 1) * this.w + x]) || (y < this.h - 1 && src[(y + 1) * this.w + x]);
        if (n) this.px[y * this.w + x] = p;
      }
    return this;
  }

  toCanvas(): HTMLCanvasElement {
    const s = pixelSurface(this.w, this.h);
    const img = s.ctx.createImageData(this.w, this.h);
    img.data.set(new Uint8ClampedArray(this.buf));
    s.ctx.putImageData(img, 0, 0);
    const out = surface(this.w, this.h);
    out.ctx.drawImage(s.canvas, 0, 0);
    return out.canvas;
  }
}
