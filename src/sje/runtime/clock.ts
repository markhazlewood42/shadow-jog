/**
 * Clock: a scene's timers (docs/engine/frame-and-rendering.md section 4, interfaces.md section 11).
 * Follows: Phaser `Clock` (`scene.time`): `delayedCall`, `addEvent`, `timeScale`. `wait` is ours.
 *
 * Everything advances by TICKS, never by the wall clock. Phaser takes milliseconds, so every delay converts to
 * `max(1, round(ms / TICK_MS))` ticks: the result is deterministic, and a 16 ms delay is one tick, not zero.
 * `timeScale` (Phaser's name) speeds the clock up or slows it down: it adds `timeScale` ticks of clock time per game
 * tick, so 0.5 is slow motion and 0 pauses the scene's timers.
 *
 * Everything dies with its scene: at shutdown the events stop (their callbacks do not run) and every pending `wait`
 * rejects with `Cancelled`. `src/main.ts` knows `Cancelled` and shows no notice for it; code that cares writes
 * `.catch(ignoreCancel)`.
 *
 * Not built yet (on demand): `removeAllEvents`, event `args` beyond `delayedCall`, `paused`, and timelines.
 */
import { TICK_MS } from '../core/size';

/** What an awaited engine promise rejects with when its scene is gone. It is not an error: nobody is waiting any more. @ours */
export class Cancelled extends Error {
  constructor(what = 'The scene ended') {
    super(what);
    // `src/main.ts` tells it apart by this name, so it does not have to import the class.
    this.name = 'Cancelled';
  }
}

/** `promise.catch(ignoreCancel)`: swallow `Cancelled`, pass every other error on. @ours */
export const ignoreCancel = (e: unknown): void => {
  if (!(e instanceof Cancelled)) throw e;
};

/** Milliseconds to whole ticks, at least 1. */
export function toTicks(ms: number): number {
  return Math.max(1, Math.round(ms / TICK_MS));
}

export interface TimerEventConfig {
  /** Milliseconds between calls (or until the one call). */
  delay: number;
  /** Call again and again until `remove()`. */
  loop?: boolean;
  /** Extra calls after the first. Ignored when `loop` is set. */
  repeat?: number;
  callback: () => void;
}

/** One scheduled call. Phaser: `TimerEvent`. */
export class TimerEvent {
  /** Clock time (in ticks) at which it fires next. */
  due: number;
  /** Calls still to make after the next one; -1 for a loop. */
  left: number;
  removed = false;

  constructor(
    due: number,
    readonly period: number,
    left: number,
    readonly callback: () => void,
  ) {
    this.due = due;
    this.left = left;
  }

  /** True once it will not fire again. */
  get hasDispatched(): boolean {
    return this.removed;
  }

  /** Stop it. Its callback will not run. */
  remove(): void {
    this.removed = true;
  }
}

interface Waiter {
  event: TimerEvent;
  reject(reason: unknown): void;
}

export class Clock {
  /** Clock ticks per game tick. 1 is normal, 0.5 half speed, 0 stopped. */
  timeScale = 1;
  private now = 0;
  private events: TimerEvent[] = [];
  private waiters: Waiter[] = [];
  private closed = false;

  /** Phaser: delayedCall(delay, callback, args, callbackScope). One call after `ms`. */
  delayedCall(ms: number, fn: (...args: unknown[]) => void, args: unknown[] = [], scope?: unknown): TimerEvent {
    return this.addEvent({ delay: ms, callback: () => fn.apply(scope, args) });
  }

  /** Phaser: addEvent. */
  addEvent(cfg: TimerEventConfig): TimerEvent {
    if (this.closed) throw new Error('Clock.addEvent: the scene has ended');
    const period = toTicks(cfg.delay);
    const left = cfg.loop ? -1 : Math.max(0, Math.floor(cfg.repeat ?? 0));
    const e = new TimerEvent(this.now + period, period, left, cfg.callback);
    this.events.push(e);
    return e;
  }

  /** A promise that resolves after `ms` and rejects with `Cancelled` if the scene ends first. @ours */
  wait(ms: number): Promise<void> {
    if (this.closed) return Promise.reject(new Cancelled());
    return new Promise<void>((resolve, reject) => {
      const event = this.addEvent({
        delay: ms,
        callback: () => {
          this.waiters = this.waiters.filter((w) => w.event !== event);
          resolve();
        },
      });
      this.waiters.push({ event, reject });
    });
  }

  /** Live events (tests). */
  get count(): number {
    return this.events.length;
  }

  /** Advance by one game tick. Fires every event that came due, in the order they were added. */
  update(): void {
    this.now += this.timeScale;
    const list = this.events;
    // An event added by a callback goes on the end and is not looked at until the next tick (its due time is at least a tick away).
    const n = list.length;
    let dirty = false;
    for (let i = 0; i < n; i++) {
      const e = list[i];
      if (!e || e.removed) {
        dirty = true;
        continue;
      }
      if (e.due > this.now) continue;
      if (e.left === 0) {
        e.removed = true;
        dirty = true;
      } else {
        if (e.left > 0) e.left--;
        e.due += e.period;
      }
      e.callback();
    }
    if (dirty) this.events = this.events.filter((e) => !e.removed);
  }

  /** Scene shutdown: stop every event and reject every pending `wait`. */
  shutdown(): void {
    this.closed = true;
    for (const e of this.events) e.removed = true;
    this.events = [];
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w.reject(new Cancelled());
  }
}
