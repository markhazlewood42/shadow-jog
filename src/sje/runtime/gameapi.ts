/**
 * GameApi: the narrow part of the `Game` that story code and the scenes use (docs/engine/interfaces.md section 13). Types only: this file adds no code to any bundle.
 *
 * Until M8d it was the seam that let story code and scenes run on the old engine and the new one; the old engine is gone, and the `Game` of `src/sje/runtime/game.ts` is the one
 * class that implements it. `fadeTo`, `shake` and `flash` are written out here, because `Game['fadeTo']` would make this file import the class.
 *
 * @deviation from interfaces.md section 13: its `GameApi` has `readonly tick: number`. The old `Game` had a METHOD called
 * `tick()` (one fixed step), which could not also be a number, so the shared name is `frame` (the old counter, "today's
 * `frame`"). The `Game` has both: `tick` (the number, the design's name) and `frame` (the same number, the legacy name).
 */
import type { Scene } from './scene';

/** The way a blow travelled, as a vector (the shake argument). */
export interface ShakeDirection {
  x: number;
  y: number;
}

export interface GameApi {
  /** Push a scene and wait for it: the promise resolves when the scene calls `close(result)`. */
  run<R>(scene: Scene<R>): Promise<R>;
  /** Wait `frames` ticks (one frame equals one tick). About 25 call sites and all story scripts use it. */
  wait(frames: number): Promise<void>;
  fadeTo(level: number, frames?: number, color?: string): Promise<void>;
  shake(frames?: number, mag?: number, dir?: ShakeDirection): void;
  flash(color?: string, frames?: number): void;
  /** The scene on top, or undefined when the stack is empty. */
  readonly top: unknown;
  /** The tick counter. */
  readonly frame: number;
  /** Ticks per loop step. Debug and tests only. */
  speed: number;
}
