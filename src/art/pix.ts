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
  /** Physical pixel size. Drawing coordinates are in design units, multiplied by `k`. */
  readonly w: number;
  readonly h: number;
  readonly k: number;
  private px: Uint32Array;
  private buf: ArrayBuffer;

  constructor(w: number, h: number, k = 1) {
    this.k = k;
    this.w = Math.round(w * k);
    this.h = Math.round(h * k);
    this.buf = new ArrayBuffer(this.w * this.h * 4);
    this.px = new Uint32Array(this.buf);
  }

  /** Set one physical pixel. */
  private raw(x: number, y: number, c: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = c;
  }

  private pack(c: string): number {
    const [r, g, b] = rgb(c);
    return (255 << 24) | (b << 16) | (g << 8) | r;
  }

  set(x: number, y: number, c: string | number): void {
    const p = typeof c === 'number' ? c : this.pack(c);
    const k = this.k;
    const x0 = Math.round(Math.round(x) * k), y0 = Math.round(Math.round(y) * k);
    const x1 = Math.round((Math.round(x) + 1) * k), y1 = Math.round((Math.round(y) + 1) * k);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.raw(xx, yy, p);
  }

  /** Is the design-unit pixel opaque? */
  get(x: number, y: number): number {
    const px = Math.floor(Math.round(x) * this.k + this.k / 2), py = Math.floor(Math.round(y) * this.k + this.k / 2);
    if (px < 0 || py < 0 || px >= this.w || py >= this.h) return 0;
    return this.px[py * this.w + px]!;
  }

  rect(x: number, y: number, w: number, h: number, c: string): this {
    const p = this.pack(c);
    const k = this.k;
    for (let yy = Math.round(y * k); yy < Math.round((y + h) * k); yy++) for (let xx = Math.round(x * k); xx < Math.round((x + w) * k); xx++) this.raw(xx, yy, p);
    return this;
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: string): this {
    const p = this.pack(c);
    const k = this.k;
    cx *= k; cy *= k; rx *= k; ry *= k;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.raw(x, y, p);
      }
    return this;
  }

  /** Ellipse with 4-tone volumetric shading from the upper-left, dithered between tones. */
  ball(cx: number, cy: number, rx: number, ry: number, base: string, opts: { light?: number; rim?: string } = {}): this {
    const k = this.k;
    cx *= k; cy *= k; rx *= k; ry *= k;
    const ramp = [shade(base, -0.55), shade(base, -0.25), base, shade(base, 0.35)].map((c) => this.pack(c));
    const L = opts.light ?? 0.55;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
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
        this.raw(x, y, ramp[idx]!);
      }
    if (opts.rim) {
      const rim = this.pack(opts.rim);
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          const dx = (x - cx) / rx, dy = (y - cy) / ry;
          const d2 = dx * dx + dy * dy;
          if (d2 <= 1 && d2 > 0.78 && dx > 0.3 && dy > -0.2) this.raw(x, y, rim);
        }
    }
    return this;
  }

  /** Filled polygon (even-odd). */
  poly(ptsIn: [number, number][], c: string): this {
    const p = this.pack(c);
    const pts = ptsIn.map(([x, y]) => [x * this.k, y * this.k] as [number, number]);
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
      for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.round(xs[i]!); x < Math.round(xs[i + 1]!); x++) this.raw(x, y, p);
    }
    return this;
  }

  line(x0: number, y0: number, x1: number, y1: number, c: string, thick = 1): this {
    const p = this.pack(c);
    const k = this.k;
    x0 = (x0 + 0.5) * k; y0 = (y0 + 0.5) * k; x1 = (x1 + 0.5) * k; y1 = (y1 + 0.5) * k;
    const t = Math.max(1, Math.round(thick * k));
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let i = 0; i <= n; i++) {
      const x = Math.floor(x0 + ((x1 - x0) * i) / n - t / 2), y = Math.floor(y0 + ((y1 - y0) * i) / n - t / 2);
      for (let a = 0; a < t; a++) for (let b = 0; b < t; b++) this.raw(x + a, y + b, p);
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

  /**
   * Form shading over the whole silhouette, light from the upper left: a lit band just inside
   * the top and left edges, a shadow band inside the bottom and right. Flat fills (rects, limbs,
   * polygons) get two more tonal steps and read as solid; a limb too thin for both keeps its
   * colour. Run before outline().
   */
  form(lift = 0.2, drop = 0.26): this {
    const w = this.w, h = this.h, src = this.px.slice();
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : src[y * w + x]!);
    const d = Math.max(1, Math.round(this.k));
    const tone = (c: number, t: number) => {
      const r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255;
      const f = (v: number) => Math.round(t > 0 ? v + (255 - v) * t : v * (1 + t));
      return (255 << 24) | (f(b) << 16) | (f(g) << 8) | f(r);
    };
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = src[y * w + x]!;
        if (!c) continue;
        const lit = !at(x - d, y) || !at(x, y - d);
        const dark = !at(x + d, y) || !at(x, y + d);
        if (lit && !dark) this.px[y * w + x] = tone(c, lift);
        else if (dark && !lit) this.px[y * w + x] = tone(c, -drop);
      }
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

/** EPX / Scale2x: doubles a sprite, smoothing diagonal staircases without blurring. */
export function scale2x(src: HTMLCanvasElement): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const s = pixelSurface(w, h);
  s.ctx.drawImage(src, 0, 0);
  const inp = new Uint32Array(s.ctx.getImageData(0, 0, w, h).data.buffer);
  const out = new Uint32Array(w * 2 * h * 2);
  const at = (x: number, y: number) => inp[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))]!;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const P = at(x, y), A = at(x, y - 1), B = at(x + 1, y), C = at(x - 1, y), D = at(x, y + 1);
      let e0 = P, e1 = P, e2 = P, e3 = P;
      if (C === A && C !== D && A !== B) e0 = A;
      if (A === B && A !== C && B !== D) e1 = B;
      if (D === C && D !== B && C !== A) e2 = C;
      if (B === D && B !== A && D !== C) e3 = D;
      const o = y * 2 * w * 2 + x * 2;
      out[o] = e0; out[o + 1] = e1; out[o + w * 2] = e2; out[o + w * 2 + 1] = e3;
    }
  const d = pixelSurface(w * 2, h * 2);
  const img = d.ctx.createImageData(w * 2, h * 2);
  img.data.set(new Uint8ClampedArray(out.buffer));
  d.ctx.putImageData(img, 0, 0);
  const fin = surface(w * 2, h * 2);
  fin.ctx.drawImage(d.canvas, 0, 0);
  return fin.canvas;
}
