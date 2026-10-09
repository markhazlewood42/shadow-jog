/**
 * Tweens: a scene's property animations (docs/engine/frame-and-rendering.md section 4, interfaces.md section 11).
 * Follows: Phaser `TweenManager` (`scene.tweens.add`). `Tween.finished` is ours.
 *
 * A tween moves numeric properties of its targets from where they are to the values asked for, over `duration`
 * milliseconds. Time is TICKS: the duration converts to whole ticks (`toTicks`), and progress is `ticks done / ticks total`,
 * so the same inputs give the same values on every machine and at every frame rate.
 *
 * A property value is one of: a number (the end value), `{ from, to }`, or `'+=n'` / `'-=n'` (relative to the start).
 * `ease` is a Phaser name: `Linear`, `Quad.easeIn/Out/InOut`, `Cubic.easeIn/Out/InOut`, `Sine.easeIn/Out/InOut`.
 * `yoyo` plays back after it arrives. `repeat` replays: 0 once (the default), 2 three times in all, -1 for ever.
 *
 * Everything dies with its scene: at shutdown the tweens stop, their callbacks do not run, and `finished` rejects with `Cancelled`.
 *
 * Not built yet (on demand): `chain`, `addCounter`, `stagger`, `persist`, `hold`, `onUpdate`, per-property configs and `loopDelay`.
 */
import { assert } from '../core/assert';
import { Cancelled, toTicks } from './clock';

type Ease = (t: number) => number;

const EASES: Readonly<Record<string, Ease>> = {
  Linear: (t) => t,
  'Quad.easeIn': (t) => t * t,
  'Quad.easeOut': (t) => 1 - (1 - t) * (1 - t),
  'Quad.easeInOut': (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  'Cubic.easeIn': (t) => t * t * t,
  'Cubic.easeOut': (t) => 1 - (1 - t) ** 3,
  'Cubic.easeInOut': (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  'Sine.easeIn': (t) => 1 - Math.cos((t * Math.PI) / 2),
  'Sine.easeOut': (t) => Math.sin((t * Math.PI) / 2),
  'Sine.easeInOut': (t) => -(Math.cos(Math.PI * t) - 1) / 2,
};

export type PropValue = number | string | { from?: number; to: number };

export interface TweenConfig {
  targets: object | object[];
  /** Milliseconds. */
  duration: number;
  ease?: string;
  /** Milliseconds before it starts. */
  delay?: number;
  yoyo?: boolean;
  repeat?: number;
  onComplete?: () => void;
  /** The properties to tween. Reserved keys above are not properties. */
  [prop: string]: unknown;
}

const RESERVED = new Set(['targets', 'duration', 'ease', 'delay', 'yoyo', 'repeat', 'onComplete']);

interface Track {
  target: Record<string, number>;
  prop: string;
  from: number;
  to: number;
}

export class Tween {
  private tracks: Track[] = [];
  private t = 0;
  private readonly len: number;
  private delayLeft: number;
  private forward = true;
  private repeatsLeft: number;
  private started = false;
  private done = false;
  private readonly ease: Ease;
  private readonly yoyo: boolean;
  private readonly onComplete: (() => void) | undefined;
  private resolve: () => void = () => undefined;
  private reject: (e: unknown) => void = () => undefined;
  /** Resolves when the tween ends; rejects with `Cancelled` if the scene ends first. @ours */
  readonly finished: Promise<void>;

  constructor(private readonly cfg: TweenConfig) {
    const ease = cfg.ease ?? 'Linear';
    const fn = EASES[ease];
    assert(fn, `Tween: unknown ease "${ease}" (built: ${Object.keys(EASES).join(', ')})`);
    this.ease = fn;
    this.len = toTicks(cfg.duration);
    this.delayLeft = cfg.delay ? toTicks(cfg.delay) : 0;
    this.yoyo = cfg.yoyo === true;
    this.repeatsLeft = cfg.repeat ?? 0;
    this.onComplete = cfg.onComplete;
    this.finished = new Promise<void>((res, rej) => {
      this.resolve = res;
      this.reject = rej;
    });
    // A tween nobody awaits must not report an unhandled rejection when its scene ends.
    this.finished.catch(() => undefined);
  }

  get isDone(): boolean {
    return this.done;
  }

  /** Stop at the current values. `onComplete` does not run; `finished` stays pending. */
  stop(): void {
    this.done = true;
  }

  /** @internal Read the start values (when the delay is over, as Phaser does). */
  private begin(): void {
    const targets = Array.isArray(this.cfg.targets) ? this.cfg.targets : [this.cfg.targets];
    for (const raw of targets) {
      const target = raw as Record<string, number>;
      for (const prop of Object.keys(this.cfg)) {
        if (RESERVED.has(prop)) continue;
        const spec = this.cfg[prop] as PropValue;
        const current = target[prop];
        assert(typeof current === 'number' || (typeof spec === 'object' && spec.from !== undefined), `Tween: "${prop}" is not a number on the target`);
        let from = typeof current === 'number' ? current : 0;
        let to: number;
        if (typeof spec === 'number') to = spec;
        else if (typeof spec === 'string') {
          const m = /^([+-])=(-?\d+(?:\.\d+)?)$/.exec(spec);
          assert(m, `Tween: "${prop}" must be a number, { from, to } or '+=n' / '-=n', got "${spec}"`);
          to = from + (m[1] === '-' ? -Number(m[2]) : Number(m[2]));
        } else {
          if (spec.from !== undefined) from = spec.from;
          to = spec.to;
        }
        this.tracks.push({ target, prop, from, to });
      }
    }
    this.started = true;
  }

  private write(progress: number): void {
    const k = this.ease(progress);
    for (const tr of this.tracks) tr.target[tr.prop] = tr.from + (tr.to - tr.from) * k;
  }

  /** @internal Advance one tick. Returns true while the tween lives. */
  update(): boolean {
    if (this.done) return false;
    if (this.delayLeft > 0) {
      this.delayLeft--;
      return true;
    }
    if (!this.started) this.begin();
    this.t++;
    const p = Math.min(1, this.t / this.len);
    this.write(this.forward ? p : 1 - p);
    if (this.t < this.len) return true;
    // One leg is over.
    if (this.yoyo && this.forward) {
      this.forward = false;
      this.t = 0;
      return true;
    }
    if (this.repeatsLeft !== 0) {
      if (this.repeatsLeft > 0) this.repeatsLeft--;
      this.forward = true;
      this.t = 0;
      return true;
    }
    this.done = true;
    this.onComplete?.();
    this.resolve();
    return false;
  }

  /** @internal Scene shutdown. */
  cancel(): void {
    if (this.done) return;
    this.done = true;
    this.reject(new Cancelled());
  }
}

export class TweenManager {
  private list: Tween[] = [];
  private closed = false;

  /** Phaser: tweens.add. Starts at once (on the next tick). */
  add(cfg: TweenConfig): Tween {
    if (this.closed) throw new Error('TweenManager.add: the scene has ended');
    const tw = new Tween(cfg);
    this.list.push(tw);
    return tw;
  }

  /** Live tweens (tests). */
  get count(): number {
    return this.list.length;
  }

  /** Advance every tween by one tick, in the order they were added. */
  update(): void {
    const list = this.list;
    const n = list.length;
    let dirty = false;
    for (let i = 0; i < n; i++) {
      const tw = list[i];
      if (tw && !tw.update()) dirty = true;
    }
    if (dirty) this.list = this.list.filter((t) => !t.isDone);
  }

  shutdown(): void {
    this.closed = true;
    const list = this.list;
    this.list = [];
    for (const tw of list) tw.cancel();
  }
}
