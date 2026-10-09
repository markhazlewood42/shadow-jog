/**
 * GameFx: the game-level fade, shake and flash (docs/engine/interfaces.md section 1: `fadeTo`, `shake`, `flash`).
 * This is the old engine's `Game` fade/shake/flash code, moved here with the same numbers, so a legacy scene sees the same
 * `shakeX`, `shakeY` and `fadeLevel` it always did. Everything advances by TICKS (`advance()` runs once per tick).
 *
 * How it reaches the screen:
 *  - A LEGACY scene draws on a canvas, so the fade and flash are drawn on the canvas of the topmost drawn legacy scene, after the
 *    scene itself (`paint`). That is the old engine's order, pixel for pixel, and it needs no third canvas.
 *  - When the topmost drawn scene is a native `Scene` (or none), `paintNative` draws them as rectangles in `overlayRoot`.
 *
 * The scene-level versions (a camera fade that washes only that scene's world) are `camera.fadeIn/fadeOut/flash/shake`.
 *
 * `shake(frames, mag, dir)` takes the strength the caller wrote in the OLD pixel size (480 wide). `gain` (4/3) turns it into
 * today's pixels (D10 of docs/PIVOT-640.md). The shake MOTION (`shakeOffset`) is the old engine's own function, handed in through
 * `LegacyCompat`, so this file imports no old code.
 */
import { H, W } from '../core/size';
import { parseColor } from '../display/cameraeffects';
import type { Graphics } from '../display/graphics';
import type { ShakeDirection } from './gameapi';

/** What the legacy code supplies. The new `Game` has a default for each, so a test or a lab needs none. */
export interface LegacyCompat {
  /** Show an error as the on-screen notice. Default: `console.error`. */
  reportError(error: unknown): void;
  /** Tell the player something in plain words (a file that did not load). Default: `console.warn`. */
  warn(message: string): void;
  /** The shake motion: this frame's offset in whole pixels (src/engine/shake.ts). Default: no motion. */
  shakeOffset(s: { t: number; len: number; mag: number; dir: ShakeDirection | null }): { x: number; y: number };
  /** Multiplier from the caller's shake strength to today's pixels (`SHAKE_PIXEL_GAIN`, 4/3). */
  shakeGain: number;
  /** After each frame: the frame's cost and the tick part of it, in ms (the old `perf.record`). */
  record?(frameMs: number, tickMs: number): void;
}

interface Fade {
  from: number;
  to: number;
  frames: number;
  t: number;
  color: string;
  resolve: () => void;
}

export class GameFx {
  /** 0 = clear, 1 = fully covered. */
  fadeLevel = 0;
  fadeColor = '#07060d';
  shakeFrames = 0;
  shakeMag = 0;
  /** This frame's shake offset in screen pixels. Scenes apply it to their world layer only. */
  shakeX = 0;
  shakeY = 0;
  flashFrames = 0;
  flashColor = '#ffffff';
  private fade: Fade | null = null;
  /** The running shake: frames into it, its length, and the blow's direction (null: a rumble). */
  private shakeT = 0;
  private shakeLen = 0;
  private shakeDir: ShakeDirection | null = null;
  private flashTotal = 1;

  constructor(private readonly compat: Pick<LegacyCompat, 'shakeOffset' | 'shakeGain'>) {}

  fadeTo(level: number, frames = 20, color?: string): Promise<void> {
    if (color) this.fadeColor = color;
    return new Promise((resolve) => {
      // A fade that is cut short by a new one still resolves, as the old engine did: its waiter must not hang.
      this.fade?.resolve();
      if (frames <= 0) {
        this.fadeLevel = level;
        this.fade = null;
        resolve();
        return;
      }
      this.fade = { from: this.fadeLevel, to: level, frames, t: 0, color: this.fadeColor, resolve };
    });
  }

  /**
   * Screen shake. `dir` is the way the blow travelled: the frame kicks that way and springs back; without one it is a rumble.
   * A stronger shake takes over from a running one (and its direction); a weaker one only extends it.
   */
  shake(frames = 12, mag = 3, dir?: ShakeDirection): void {
    const scaled = mag * this.compat.shakeGain;
    if (this.shakeFrames <= 0 || scaled >= this.shakeMag) {
      this.shakeMag = scaled;
      this.shakeT = 0;
      this.shakeLen = frames;
      this.shakeDir = dir ?? null;
    } else this.shakeLen = Math.max(this.shakeLen, this.shakeT + frames);
    this.shakeFrames = this.shakeLen - this.shakeT;
  }

  flash(color = '#ffffff', frames = 6): void {
    this.flashColor = color;
    this.flashFrames = frames;
    this.flashTotal = frames;
  }

  /** One tick: the fade moves on, and the shake and flash counters count down. */
  advance(): void {
    const f = this.fade;
    if (f) {
      f.t++;
      const k = Math.min(1, f.t / f.frames);
      this.fadeLevel = f.from + (f.to - f.from) * k;
      if (k >= 1) {
        this.fade = null;
        f.resolve();
      }
    }
    if (this.shakeFrames > 0) {
      this.shakeFrames--;
      this.shakeT++;
    }
    if (this.flashFrames > 0) this.flashFrames--;
  }

  /** Start of a draw: this frame's shake offset, from the player's setting. */
  prepare(shakeScale: number): void {
    if (this.shakeFrames > 0) {
      const o = this.compat.shakeOffset({ t: this.shakeT, len: this.shakeLen, mag: this.shakeMag * shakeScale, dir: this.shakeDir });
      this.shakeX = o.x;
      this.shakeY = o.y;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
  }

  /** The flash's opacity now, 0 to 0.8 (the player's flash setting scales it). */
  flashAlpha(flashScale: number): number {
    return this.flashFrames > 0 && flashScale > 0 ? (this.flashFrames / this.flashTotal) * 0.8 * flashScale : 0;
  }

  /**
   * The old engine's order: the flash, then the fade, both over the whole picture. `withFlash` false leaves the flash out: the effects' composite
   * washes the world with it instead, and the fade and the notices go in the UI layer above it (`FxSystem`).
   */
  paint(ctx: CanvasRenderingContext2D, flashScale: number, withFlash = true): void {
    const flashA = withFlash ? this.flashAlpha(flashScale) : 0;
    if (flashA > 0) {
      ctx.globalAlpha = flashA;
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    if (this.fadeLevel > 0.001) {
      ctx.globalAlpha = Math.min(1, this.fadeLevel);
      ctx.fillStyle = this.fadeColor;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  /** The same two washes as rectangles, for a native scene on top. */
  paintNative(g: Graphics, flashScale: number, withFlash = true): void {
    g.clear();
    const flashA = withFlash ? this.flashAlpha(flashScale) : 0;
    if (flashA > 0) g.fillStyle(parseColor(this.flashColor), Math.min(1, flashA)).fillRect(0, 0, W, H);
    if (this.fadeLevel > 0.001) g.fillStyle(parseColor(this.fadeColor), Math.min(1, this.fadeLevel)).fillRect(0, 0, W, H);
  }

  /** Whether anything needs painting this frame. */
  get painting(): boolean {
    return this.flashFrames > 0 || this.fadeLevel > 0.001;
  }

  /** Drop the fade without resolving it (fault recovery: a flow waiting on it must stop dead). */
  abandon(): void {
    this.fade = null;
  }
}
