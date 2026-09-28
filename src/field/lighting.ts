/**
 * Light map: ambient color × additive colored lights, multiplied over the lit layers.
 * Sprites are lit individually (so emissive details can be interleaved in depth order).
 */
import { surface, type Ctx, type Surface } from '../engine/canvas';
import { rgb } from '../engine/color';
import { H, W } from '../engine/game';
import type { BakedLight } from './bake';

const LIGHT_RES = 64;
const lightSprites = new Map<string, HTMLCanvasElement>();

function lightSprite(color: string): HTMLCanvasElement {
  let s = lightSprites.get(color);
  if (s) return s;
  const surf = surface(LIGHT_RES, LIGHT_RES);
  const [r, g, b] = rgb(color);
  const grd = surf.ctx.createRadialGradient(LIGHT_RES / 2, LIGHT_RES / 2, 0, LIGHT_RES / 2, LIGHT_RES / 2, LIGHT_RES / 2);
  grd.addColorStop(0, `rgba(${r},${g},${b},1)`);
  grd.addColorStop(0.3, `rgba(${r},${g},${b},0.72)`);
  grd.addColorStop(0.62, `rgba(${r},${g},${b},0.28)`);
  grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
  surf.ctx.fillStyle = grd;
  surf.ctx.fillRect(0, 0, LIGHT_RES, LIGHT_RES);
  s = surf.canvas;
  lightSprites.set(color, s);
  return s;
}

export function flickerAmount(l: BakedLight, frame: number): number {
  if (!l.flicker) return 1;
  const s = l.seed ?? (l.x * 13 + l.y * 7);
  const t = frame + s;
  const base = 0.85 + Math.sin(t * 0.13) * 0.06 + Math.sin(t * 0.47) * 0.05;
  // Occasional hard dropout, like a failing neon tube.
  const drop = ((t * 2654435761) >>> 0) % 997 < 12 ? 0.35 : 1;
  return base * drop;
}

export class Lighting {
  readonly map: Surface;
  private scratch: Surface;
  ambient = '#ffffff';
  enabled = true;
  /** How much sprites resist darkness (0 = fully lit by map, 1 = ignore map). */
  spriteBoost = 0.32;

  constructor() {
    this.map = surface(W, H);
    this.scratch = surface(W, H);
  }

  build(lights: BakedLight[], camX: number, camY: number, frame: number, extra: BakedLight[] = []): void {
    const c = this.map.ctx;
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = this.ambient;
    c.fillRect(0, 0, W, H);
    if (!this.enabled) return;
    c.globalCompositeOperation = 'lighter';
    const draw = (l: BakedLight) => {
      const x = l.x - camX, y = l.y - camY;
      if (x + l.r < 0 || y + l.r < 0 || x - l.r > W || y - l.r > H) return;
      // Intensity above 1 is achieved with a second additive pass.
      let a = l.i * flickerAmount(l, frame);
      const img = lightSprite(l.color);
      const d = Math.round(l.r * 2);
      const lx = Math.round(x - l.r), ly = Math.round(y - l.r);
      while (a > 0.01) {
        c.globalAlpha = Math.min(1, a);
        c.drawImage(img, lx, ly, d, d);
        a -= 1;
      }
    };
    for (const l of lights) draw(l);
    for (const l of extra) draw(l);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  /** Multiply the whole screen by the light map. */
  apply(ctx: Ctx): void {
    if (!this.enabled) return;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(this.map.canvas, 0, 0);
    ctx.restore();
  }

  /** Draw a sprite lit by the light map at its screen position. */
  drawLit(ctx: Ctx, img: CanvasImageSource & { width: number; height: number }, sx: number, sy: number): void {
    const w = img.width, h = img.height;
    if (sx + w < 0 || sy + h < 0 || sx > W || sy > H) return;
    if (!this.enabled) {
      ctx.drawImage(img, sx, sy);
      return;
    }
    // A scratch exactly the sprite's size: 'copy' and 'destination-in' are unbounded operators,
    // so on a shared full-screen scratch each sprite touched every pixel of it. Free on a GPU; on
    // a software canvas (CI, blocklisted GPUs) that was 80% of the field's frame time.
    const sc = this.fitted(w, h);
    const s = sc.ctx;
    s.globalCompositeOperation = 'copy';
    s.drawImage(img, 0, 0);
    s.globalCompositeOperation = 'multiply';
    s.globalAlpha = 1 - this.spriteBoost;
    s.drawImage(this.map.canvas, sx, sy, w, h, 0, 0, w, h);
    s.globalAlpha = 1;
    s.globalCompositeOperation = 'destination-in';
    s.drawImage(img, 0, 0);
    s.globalCompositeOperation = 'source-over';
    ctx.drawImage(sc.canvas, sx, sy);
  }

  /** Per-size scratch surfaces for drawLit (a map has a few dozen distinct sprite sizes). */
  private fittedCache = new Map<number, Surface>();
  private fitted(w: number, h: number): Surface {
    const k = w * 4096 + h;
    let sc = this.fittedCache.get(k);
    if (!sc) this.fittedCache.set(k, (sc = surface(w, h)));
    return sc;
  }

  /** Light a full-screen layer (e.g. the overhead layer) in place via the scratch buffer. */
  drawLitLayer(ctx: Ctx, layer: HTMLCanvasElement, srcX: number, srcY: number): void {
    const s = this.scratch.ctx;
    s.globalCompositeOperation = 'copy';
    s.drawImage(layer, srcX, srcY, W, H, 0, 0, W, H);
    if (this.enabled) {
      s.globalCompositeOperation = 'multiply';
      s.drawImage(this.map.canvas, 0, 0);
      s.globalCompositeOperation = 'destination-in';
      s.drawImage(layer, srcX, srcY, W, H, 0, 0, W, H);
    }
    s.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.scratch.canvas, 0, 0);
  }

  /** Additive haze around bright lights (neon bloom). */
  bloom(ctx: Ctx, lights: BakedLight[], camX: number, camY: number, frame: number, strength = 0.16): void {
    if (!this.enabled || strength <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      if (l.i < 0.5) continue;
      const x = l.x - camX, y = l.y - camY;
      const r = l.r * 0.55;
      if (x + r < 0 || y + r < 0 || x - r > W || y - r > H) continue;
      ctx.globalAlpha = strength * l.i * flickerAmount(l, frame);
      ctx.drawImage(lightSprite(l.color), Math.round(x - r), Math.round(y - r), Math.round(r * 2), Math.round(r * 2));
    }
    ctx.restore();
  }
}
