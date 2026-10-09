/**
 * Camera effects: fade, flash and shake of one camera (docs/engine/scene-graph.md section 5).
 * Follows: Phaser `Camera.fadeIn`, `fadeOut`, `flash`, `shake`. The arguments differ (conventions.md section 3): durations are in
 * MILLISECONDS and convert to whole ticks, a color is a CSS hex string, and the shake strength is in pixels. @ours
 *
 * Everything is driven by the tick (`update()` runs once per tick), never by the wall clock, so the same inputs give the same
 * picture whatever the frame rate. The wash is one full-screen `Graphics` inside the camera's own `world` container, at a depth above
 * everything in the world and below the scene's `ui`. So a fade or flash washes the world only, as the old engine does.
 *
 * Not built yet (on demand): `pan`, `zoomTo`, `fadeIn`/`fadeOut` completion events and `resetFX`.
 */
import { assert } from '../core/assert';
import { H, TICK_MS, W } from '../core/size';
import type { Container } from './container';
import { Graphics } from './graphics';

/** Above every band in `depth.ts` that lives in a `world`, below `hud` (2,000,000, which lives in `ui`). */
const WASH_DEPTH = 1_999_999;

/** Milliseconds to whole ticks, at least 1 (the same rule as `scene.time.delayedCall`). */
export function msToTicks(ms: number): number {
  return Math.max(1, Math.round(ms / TICK_MS));
}

/** `#rgb`, `#rrggbb` or a number to 0xRRGGBB. Anything else is a mistake and throws, not a silent black. */
export function parseColor(color: string | number): number {
  if (typeof color === 'number') return color & 0xffffff;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  assert(m, `a color must be #rgb or #rrggbb, got "${color}"`);
  const hex = m[1] ?? '000';
  return Number.parseInt(hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex, 16);
}

interface Wash {
  from: number;
  to: number;
  t: number;
  len: number;
  color: number;
}

export class CameraEffects {
  private fade: Wash | null = null;
  /** The level the fade holds after it ends (0 = clear, 1 = covered). Phaser holds a fade until it is undone. */
  private fadeHold = 0;
  private fadeColor = 0;
  private flashing: Wash | null = null;
  private shaking: { t: number; len: number; mag: number } | null = null;
  private rect: Graphics | null = null;
  private drawnColor = -1;
  /** This tick's shake offset, whole pixels. */
  offsetX = 0;
  offsetY = 0;

  constructor(private readonly world: Container) {}

  /** Cover the world with `color` over `ms`. It stays covered until `fadeIn`. */
  fadeOut(ms: number, color: string | number = '#000000'): void {
    this.startFade(this.currentFade(), 1, ms, parseColor(color));
  }

  /** Uncover the world over `ms` (from a fade that was held, or from nothing). */
  fadeIn(ms: number, color?: string | number): void {
    this.startFade(this.currentFade(), 0, ms, color === undefined ? this.fadeColor : parseColor(color));
  }

  /** Wash the world with `color` and fade it away over `ms`. */
  flash(ms: number, color: string | number = '#ffffff'): void {
    this.flashing = { from: 1, to: 0, t: 0, len: msToTicks(ms), color: parseColor(color) };
  }

  /** Shake the world by up to `magnitudePx` pixels, easing out over `ms`. A new shake replaces a running one. */
  shake(ms: number, magnitudePx = 3): void {
    this.shaking = { t: 0, len: msToTicks(ms), mag: Math.max(0, magnitudePx) };
  }

  /** True while any effect is running or a fade is held. */
  get active(): boolean {
    return this.fade !== null || this.flashing !== null || this.shaking !== null || this.fadeHold > 0;
  }

  /** Advance every effect by one tick. */
  update(): void {
    const f = this.fade;
    if (f) {
      f.t++;
      if (f.t >= f.len) {
        this.fadeHold = f.to;
        this.fade = null;
      }
    }
    const fl = this.flashing;
    if (fl && ++fl.t >= fl.len) this.flashing = null;
    const s = this.shaking;
    if (s && ++s.t >= s.len) this.shaking = null;
  }

  /** The fade level now, 0 to 1. */
  private currentFade(): number {
    const f = this.fade;
    if (!f) return this.fadeHold;
    return f.from + (f.to - f.from) * Math.min(1, f.t / f.len);
  }

  private startFade(from: number, to: number, ms: number, color: number): void {
    this.fadeColor = color;
    this.fadeHold = from;
    this.fade = { from, to, t: 0, len: msToTicks(ms), color };
  }

  /**
   * The draw phase: compute this tick's shake offset (a pure function of the tick count) and paint the wash.
   * `scrollX` and `scrollY` are the camera scroll: the wash sits at the screen's own origin, not the world's.
   */
  apply(scrollX: number, scrollY: number): void {
    const s = this.shaking;
    if (s) {
      // Eases out quadratically; two out-of-step sines make it wander on both axes. Whole pixels (snap to pixel).
      const a = s.mag * (1 - s.t / s.len) ** 2;
      this.offsetX = Math.round(a * Math.sin(s.t * 1.7));
      this.offsetY = Math.round(a * Math.sin(s.t * 2.3 + 1));
    } else {
      this.offsetX = 0;
      this.offsetY = 0;
    }
    const fadeA = this.currentFade();
    const flashA = this.flashing ? this.flashing.from + (this.flashing.to - this.flashing.from) * (this.flashing.t / this.flashing.len) : 0;
    // The flash draws over the fade. When both run, the one with more cover wins the color; the alpha is theirs combined.
    const useFlash = flashA > 0 && flashA >= fadeA;
    const alpha = useFlash ? flashA : fadeA;
    const color = useFlash ? (this.flashing?.color ?? 0) : (this.fade?.color ?? this.fadeColor);
    if (alpha <= 0.001 && !this.rect) return;
    const rect = this.ensureRect();
    rect.visible = alpha > 0.001;
    if (!rect.visible) return;
    if (color !== this.drawnColor) {
      rect.clear().fillStyle(color, 1).fillRect(0, 0, W, H);
      this.drawnColor = color;
    }
    rect.alpha = Math.min(1, alpha);
    // The world sits at (-scroll + offset), so the wash goes at (scroll - offset) to stay on the screen.
    rect.setPosition(scrollX - this.offsetX, scrollY - this.offsetY);
  }

  private ensureRect(): Graphics {
    if (!this.rect) {
      this.rect = new Graphics(this.world.scene);
      this.rect.name = 'camera wash';
      this.rect.setDepth(WASH_DEPTH);
      this.world.add(this.rect);
    }
    return this.rect;
  }
}
