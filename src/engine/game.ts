/**
 * Game core: fixed-timestep loop (60 Hz), scene stack, frame timers and screen fades.
 *
 * Scenes are pushed with `run()` which returns a promise resolved when the scene calls `close(result)`.
 * This lets story scripts `await` dialogs, shops and battles linearly.
 */
import type { Ctx } from './canvas';
import { Input } from './input';

export const W = 480;
export const H = 270;
export const FPS = 60;

export abstract class Scene<R = unknown> {
  game!: Game;
  /** When true, scenes below this one are not rendered. */
  opaque = true;
  /** When true, the scene below keeps updating (e.g. ambient field animation under a dialog). */
  passUpdate = false;
  private resolver: ((r: R) => void) | null = null;
  closed = false;

  enter(): void {}
  exit(): void {}
  /** Called when a scene above this one closes. */
  resume(): void {}
  abstract update(): void;
  abstract render(ctx: Ctx): void;

  close(result: R): void {
    if (this.closed) return;
    this.closed = true;
    this.game.remove(this);
    this.resolver?.(result);
  }

  /** @internal */
  _bind(res: (r: R) => void): void {
    this.resolver = res;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyScene = Scene<any>;

interface Timer {
  at: number;
  resolve: () => void;
}

interface Fade {
  from: number;
  to: number;
  frames: number;
  t: number;
  color: string;
  resolve: () => void;
}

export class Game {
  readonly input: Input;
  readonly ctx: Ctx;
  readonly stack: AnyScene[] = [];
  frame = 0;
  /** Seconds of play time (only counts while unpaused and not on title). */
  playFrames = 0;
  countPlayTime = false;
  private timers: Timer[] = [];
  private fade: Fade | null = null;
  /** 0 = clear, 1 = fully covered. */
  fadeLevel = 0;
  fadeColor = '#07060d';
  shakeFrames = 0;
  shakeMag = 0;
  flashFrames = 0;
  flashColor = '#ffffff';
  private flashTotal = 1;
  paused = false;
  /** Hooks run after the scene stack renders (overlays like touch controls or debug). */
  overlays: ((ctx: Ctx) => void)[] = [];
  /** Hooks run every tick before scenes (audio sequencer etc.). */
  tickers: (() => void)[] = [];
  /** Speed multiplier for debug / tests (ticks per frame). */
  speed = 1;

  constructor(ctx: Ctx, input: Input) {
    this.ctx = ctx;
    this.input = input;
  }

  get top(): AnyScene | undefined {
    return this.stack[this.stack.length - 1];
  }

  run<R>(scene: Scene<R>): Promise<R> {
    return new Promise<R>((resolve) => {
      scene.game = this;
      scene._bind(resolve);
      this.stack.push(scene);
      this.input.consume();
      scene.enter();
    });
  }

  /** Replace the whole stack with one scene. */
  reset<R>(scene: Scene<R>): Promise<R> {
    for (const s of [...this.stack].reverse()) {
      s.closed = true;
      s.exit();
    }
    this.stack.length = 0;
    return this.run(scene);
  }

  remove(scene: AnyScene): void {
    const i = this.stack.indexOf(scene);
    if (i < 0) return;
    this.stack.splice(i, 1);
    scene.exit();
    this.input.consume();
    this.top?.resume();
  }

  wait(frames: number): Promise<void> {
    return new Promise((resolve) => this.timers.push({ at: this.frame + Math.max(1, Math.round(frames)), resolve }));
  }

  fadeTo(level: number, frames = 20, color?: string): Promise<void> {
    if (color) this.fadeColor = color;
    return new Promise((resolve) => {
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

  fadeOut(frames = 20, color?: string): Promise<void> {
    return this.fadeTo(1, frames, color);
  }

  fadeIn(frames = 20): Promise<void> {
    return this.fadeTo(0, frames);
  }

  shake(frames = 12, mag = 3): void {
    this.shakeFrames = Math.max(this.shakeFrames, frames);
    this.shakeMag = Math.max(mag, this.shakeFrames > 0 ? this.shakeMag : 0);
  }

  flash(color = '#ffffff', frames = 6): void {
    this.flashColor = color;
    this.flashFrames = frames;
    this.flashTotal = frames;
  }

  /** One fixed tick. */
  tick(): void {
    this.input.update();
    for (const t of this.tickers) t();
    if (!this.paused) {
      this.frame++;
      if (this.countPlayTime) this.playFrames++;
      // Timers
      if (this.timers.length) {
        const due = this.timers.filter((t) => t.at <= this.frame);
        if (due.length) {
          this.timers = this.timers.filter((t) => t.at > this.frame);
          for (const t of due) t.resolve();
        }
      }
      // Fade
      if (this.fade) {
        const f = this.fade;
        f.t++;
        const k = Math.min(1, f.t / f.frames);
        this.fadeLevel = f.from + (f.to - f.from) * k;
        if (k >= 1) {
          this.fade = null;
          f.resolve();
        }
      }
      if (this.shakeFrames > 0) this.shakeFrames--;
      if (this.flashFrames > 0) this.flashFrames--;
      // Scenes: top always updates; lower scenes update while the one above passes updates through.
      for (let i = this.stack.length - 1; i >= 0; i--) {
        const s = this.stack[i]!;
        s.update();
        if (!s.passUpdate) break;
      }
    }
    this.input.endFrame();
  }

  render(): void {
    const ctx = this.ctx;
    ctx.save();
    if (this.shakeFrames > 0) {
      const m = this.shakeMag * Math.min(1, this.shakeFrames / 8);
      ctx.translate(Math.round((Math.random() * 2 - 1) * m), Math.round((Math.random() * 2 - 1) * m));
    }
    let start = this.stack.length - 1;
    while (start > 0 && !this.stack[start]!.opaque) start--;
    if (this.stack.length === 0) {
      ctx.fillStyle = '#07060d';
      ctx.fillRect(0, 0, W, H);
    }
    for (let i = Math.max(0, start); i < this.stack.length; i++) this.stack[i]!.render(ctx);
    ctx.restore();
    if (this.flashFrames > 0) {
      ctx.globalAlpha = (this.flashFrames / this.flashTotal) * 0.8;
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
    for (const o of this.overlays) o(ctx);
  }
}
