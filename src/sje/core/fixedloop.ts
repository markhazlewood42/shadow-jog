/**
 * The fixed 60 Hz loop (docs/engine/frame-and-rendering.md section 1).
 * Follows: the Gaffer "Fix Your Timestep" accumulator, Unity `FixedUpdate`, Godot `_physics_process`.
 * It is today's loop from `src/main.ts`, moved here so it can be tested without a browser.
 *
 * One frame (one `requestAnimationFrame` callback):
 *   1. Add `min(250 ms, elapsed)` to an accumulator. The clamp stops a burst of catch-up ticks
 *      when a hidden tab comes back (the browser stops calling us while the tab is hidden).
 *   2. While the accumulator holds at least one tick (1000/60 ms) and fewer than 5 ticks ran, run
 *      one tick (`speed` times, for debug and tests). If the fifth tick ran, DROP the backlog:
 *      a slow machine then runs slow motion instead of falling further behind.
 *   3. Draw once.
 *
 * The tick changes game state. The draw only reads it. So the same inputs give the same state
 * whatever the frame rate: only how many ticks each frame ran changes.
 */
import { TICK_MS } from './size';

/** Most time one frame may add to the accumulator, in ms. */
export const MAX_ELAPSED_MS = 250;
/** Most ticks one frame may run. */
export const MAX_TICKS_PER_FRAME = 5;

export interface FixedLoopHooks {
  /** One simulation step. */
  tick(): void;
  /** The draw phase. `alpha` (0 to 1) is how far into the next tick the frame is. Nothing interpolates in v1. */
  draw(alpha: number): void;
  /** A hook threw. The loop reports it here and carries on. Default: `console.error`. */
  onError?(error: unknown): void;
  /** After each frame: the whole frame's cost and the part that was ticks, in ms (the old `perf.record`). @ours */
  record?(frameMs: number, tickMs: number): void;
}

export interface FixedLoopOptions {
  /** Replaceable so a test can drive time by hand. Defaults to the browser's. */
  requestFrame?(callback: (now: number) => void): number;
  cancelFrame?(handle: number): void;
  now?(): number;
}

export class FixedLoop {
  /** Ticks per step. Debug and tests only (the old `game.speed`). */
  speed = 1;
  /** Left-over time that is not yet a whole tick, in ms. Read by tests. */
  accumulator = 0;
  private handle: number | null = null;
  private last = 0;
  private readonly request: NonNullable<FixedLoopOptions['requestFrame']>;
  private readonly cancel: NonNullable<FixedLoopOptions['cancelFrame']>;
  private readonly now: NonNullable<FixedLoopOptions['now']>;

  constructor(
    private readonly hooks: FixedLoopHooks,
    options: FixedLoopOptions = {},
  ) {
    this.request = options.requestFrame ?? ((cb) => requestAnimationFrame(cb));
    this.cancel = options.cancelFrame ?? ((h) => cancelAnimationFrame(h));
    this.now = options.now ?? (() => performance.now());
  }

  get running(): boolean {
    return this.handle !== null;
  }

  start(): void {
    if (this.handle !== null) return;
    this.last = this.now();
    this.handle = this.request(this.frame);
  }

  stop(): void {
    if (this.handle !== null) this.cancel(this.handle);
    this.handle = null;
  }

  /**
   * Run one frame for `elapsedMs` of real time. Returns how many ticks ran.
   * The rAF callback calls this. A test calls it directly with made-up times.
   */
  advance(elapsedMs: number): number {
    const t0 = this.hooks.record ? this.now() : 0;
    this.accumulator += Math.min(MAX_ELAPSED_MS, Math.max(0, elapsedMs));
    let ticks = 0;
    while (this.accumulator >= TICK_MS && ticks < MAX_TICKS_PER_FRAME) {
      for (let i = 0; i < this.speed; i++) this.hooks.tick();
      this.accumulator -= TICK_MS;
      ticks++;
    }
    // The fifth tick ran and time is still owed: drop it instead of chasing it.
    if (ticks === MAX_TICKS_PER_FRAME) this.accumulator = 0;
    const tickMs = this.hooks.record ? this.now() - t0 : 0;
    this.hooks.draw(this.accumulator / TICK_MS);
    this.hooks.record?.(this.now() - t0, tickMs);
    return ticks;
  }

  private readonly frame = (now: number): void => {
    // Scheduled first: whatever throws below, the next frame still runs.
    this.handle = this.request(this.frame);
    const elapsed = now - this.last;
    this.last = now;
    try {
      this.advance(elapsed);
    } catch (e) {
      (this.hooks.onError ?? ((err) => console.error(err)))(e);
    }
  };
}
