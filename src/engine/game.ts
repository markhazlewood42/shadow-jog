/**
 * Game core: fixed-timestep loop (60 Hz), scene stack, frame timers and screen fades.
 *
 * Scenes are pushed with `run()` which returns a promise resolved when the scene calls `close(result)`.
 * This lets story scripts `await` dialogs, shops and battles linearly.
 *
 * Fault isolation: an exception in one scene's update or render is reported and that scene skips
 * the frame; the loop never dies. A flow that keeps throwing — in update or in render, counted
 * separately so one can't mask the other — trips `onFault`, which boot uses to abandon it and
 * return to the title.
 */
import type { Ctx } from './canvas';
import { reportError } from './errors';
import type { Input } from './input';

/** Consecutive faulting ticks before the game gives up on the current flow. */
export const FAULT_LIMIT = 30;

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

// biome-ignore lint/suspicious/noExplicitAny: the stack holds scenes of every result type; each run() is typed at its call site.
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
  /** Frames of play time (only counts while countPlayTime is set: not on the title or menus that stop the clock). */
  playFrames = 0;
  countPlayTime = false;
  private timers: Timer[] = [];
  private dueBuf: (Timer | undefined)[] = [];
  private fade: Fade | null = null;
  /** 0 = clear, 1 = fully covered. */
  fadeLevel = 0;
  fadeColor = '#07060d';
  shakeFrames = 0;
  shakeMag = 0;
  /** This frame's shake offset in screen pixels; scenes apply it to their world layer only. */
  shakeX = 0;
  shakeY = 0;
  flashFrames = 0;
  flashColor = '#ffffff';
  private flashTotal = 1;
  /** Hooks run after the scene stack renders (overlays like touch controls or debug). */
  overlays: ((ctx: Ctx) => void)[] = [];
  /** Hooks run every tick before scenes (audio sequencer etc.). */
  tickers: (() => void)[] = [];
  /** Speed multiplier for debug / tests (ticks per frame). */
  speed = 1;
  /** Screen-shake strength multiplier (the player's setting); 0 turns every shake off. */
  shakeScale: () => number = () => 1;
  /** Player setting for full-screen flashes (0 = off). */
  flashScale: () => number = () => 1;
  /** Called once when something keeps throwing (see FAULT_LIMIT). */
  onFault: (() => void) | null = null;
  /** Consecutive ticks in which something threw. */
  private faults = 0;
  private faultedThisTick = false;
  /** Consecutive renders in which a scene threw (a draw bug can freeze the picture on its own). */
  private renderFaults = 0;
  private faultedThisRender = false;

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

  /**
   * Drop every scene, timer and fade without resolving them, so a story flow waiting on any of
   * them stops dead instead of resuming on top of whatever runs next. Used for fault recovery.
   */
  abandon(): void {
    for (const s of this.stack) {
      s.closed = true;
      try {
        s.exit();
      } catch {
        /* a broken scene's cleanup can't be allowed to block recovery */
      }
    }
    this.stack.length = 0;
    this.timers = [];
    this.fade = null;
    this.faults = 0;
    this.renderFaults = 0;
  }

  private fault(e: unknown): void {
    if (!this.faultedThisTick) reportError(e);
    this.faultedThisTick = true;
  }

  remove(scene: AnyScene): void {
    const i = this.stack.indexOf(scene);
    if (i < 0) return;
    this.stack.splice(i, 1);
    // A scene's cleanup throwing must not leave the stack half-changed: report it and carry on,
    // as abandon() does for a faulting flow.
    try {
      scene.exit();
    } catch (e) {
      reportError(e);
    }
    this.input.consume();
    try {
      this.top?.resume();
    } catch (e) {
      reportError(e);
    }
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

  /** Screen shake; overlapping shakes keep the stronger amplitude, a fresh one starts from its own. */
  shake(frames = 12, mag = 3): void {
    this.shakeMag = this.shakeFrames > 0 ? Math.max(mag, this.shakeMag) : mag;
    this.shakeFrames = Math.max(this.shakeFrames, frames);
  }

  flash(color = '#ffffff', frames = 6): void {
    this.flashColor = color;
    this.flashFrames = frames;
    this.flashTotal = frames;
  }

  /** One fixed tick. */
  tick(): void {
    this.faultedThisTick = false;
    this.input.update();
    // A hook that throws is reported and dropped: it isn't a scene, so going back to the title
    // wouldn't clear it, and left in place it would trip the fault limit over and over.
    for (let i = 0; i < this.tickers.length; i++) {
      try {
        this.tickers[i]!();
      } catch (e) {
        this.fault(e);
        this.tickers.splice(i--, 1);
      }
    }
    this.frame++;
    if (this.countPlayTime) this.playFrames++;
    // Timers
    if (this.timers.length) {
      // Compact in place and collect the due ones into a reused buffer: no allocation per tick.
      let keep = 0, due = 0;
      for (let i = 0; i < this.timers.length; i++) {
        const t = this.timers[i]!;
        if (t.at <= this.frame) this.dueBuf[due++] = t;
        else this.timers[keep++] = t;
      }
      this.timers.length = keep;
      for (let i = 0; i < due; i++) {
        const t = this.dueBuf[i]!;
        this.dueBuf[i] = undefined;
        t.resolve();
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
      try {
        s.update();
      } catch (e) {
        this.fault(e);
      }
      if (!s.passUpdate) break;
    }
    this.input.endFrame();
    this.faults = this.faultedThisTick ? this.faults + 1 : 0;
    if (this.faults >= FAULT_LIMIT) {
      this.faults = 0;
      this.onFault?.();
    }
  }

  render(): void {
    const ctx = this.ctx;
    ctx.save();
    // Shake is not applied here: each scene offsets its world by (shakeX, shakeY) and draws its
    // HUD still, so the numbers being read never jitter.
    if (this.shakeFrames > 0) {
      const m = this.shakeMag * this.shakeScale() * Math.min(1, this.shakeFrames / 8);
      this.shakeX = Math.round((Math.random() * 2 - 1) * m);
      this.shakeY = Math.round((Math.random() * 2 - 1) * m);
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
    let start = this.stack.length - 1;
    while (start > 0 && !this.stack[start]!.opaque) start--;
    if (this.stack.length === 0) {
      ctx.fillStyle = '#07060d';
      ctx.fillRect(0, 0, W, H);
    }
    this.faultedThisRender = false;
    for (let i = Math.max(0, start); i < this.stack.length; i++) {
      ctx.save();
      try {
        this.stack[i]!.render(ctx);
      } catch (e) {
        if (!this.faultedThisRender) reportError(e);
        this.faultedThisRender = true;
      }
      ctx.restore();
    }
    ctx.restore();
    // A scene that throws on every draw leaves the last good frame on screen: to the player, a
    // freeze. Same limit as update faults, counted per rendered frame.
    this.renderFaults = this.faultedThisRender ? this.renderFaults + 1 : 0;
    if (this.renderFaults >= FAULT_LIMIT) {
      this.renderFaults = 0;
      this.onFault?.();
    }
    const flash = this.flashScale();
    if (this.flashFrames > 0 && flash > 0) {
      ctx.globalAlpha = (this.flashFrames / this.flashTotal) * 0.8 * flash;
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
    for (let i = 0; i < this.overlays.length; i++) {
      try {
        this.overlays[i]!(ctx);
      } catch (e) {
        this.fault(e);
        this.overlays.splice(i--, 1);
      }
    }
  }
}
