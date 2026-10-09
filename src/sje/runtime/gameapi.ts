/**
 * GameApi: the seam that lets story code and scenes run on the old engine and the new one during the migration
 * (docs/engine/interfaces.md section 13, migration.md section 4). Types only: this file adds no code to any bundle.
 *
 * Two interfaces, on purpose:
 *
 *  - `GameApi` is the narrow one the design names. Both `Game` classes implement it (the old class gets one
 *    type-only `implements` line). Code that wants to work on either engine types against this.
 *  - `LegacyGameSurface` is everything the 22 legacy scenes, `src/game` and `src/boot.ts` call on the old `Game`
 *    (the survey of M1 task 1). The new `Game` implements it, so a legacy scene runs on it unchanged. A test holds the
 *    old class to it too (`tests/sje-game.test.ts`), so the two cannot drift apart without a compile error.
 *
 * @deviation from interfaces.md section 13: its `GameApi` has `readonly tick: number`. The old `Game` has a METHOD called
 * `tick()` (one fixed step), which cannot also be a number, so the shared name is `frame` (the old counter, "today's
 * `frame`"). The new `Game` has both: `tick` (the number, the design's name) and `frame` (the same number, the legacy name).
 * `fadeTo`, `shake` and `flash` are written out here, because `Game['fadeTo']` would make this file import the class.
 */
import type { Input } from '../../engine/input';
import type { Scene } from './scene';

/** The way a blow travelled, as a vector (the old engine's `shake` argument). */
export interface ShakeDirection {
  x: number;
  y: number;
}

/**
 * Today's scene shape (src/engine/game.ts `Scene`): `enter`, `exit`, `resume`, `update()`, `render(ctx)`, the three flags and
 * `close(result)`. The old base class satisfies it. The `LegacyScene` adapter wraps one of these in a new `Scene`.
 */
export interface LegacyShape<R = unknown> {
  /** Set by the adapter to the game, before `enter()`. Typed `unknown` here: the legacy code types it as the old `Game`. */
  game: unknown;
  opaque: boolean;
  curtain: boolean;
  passUpdate: boolean;
  closed: boolean;
  enter(): void;
  exit(): void;
  resume(): void;
  update(): void;
  render(ctx: CanvasRenderingContext2D): void;
  close(result: R): void;
  /** @internal The old `Scene.run` hands its promise resolver here. */
  _bind(resolve: (result: R) => void): void;
}

// biome-ignore lint/suspicious/noExplicitAny: the stack holds scenes of every result type; each run() is typed at its call site (the same reason as `AnyScene`).
export type AnyLegacy = LegacyShape<any>;

export interface GameApi {
  /** Push a scene (new or legacy) and wait for it: the promise resolves when the scene calls `close(result)`. */
  run<R>(scene: Scene<R> | LegacyShape<R>): Promise<R>;
  /** Wait `frames` ticks (one frame equals one tick). About 25 call sites and all story scripts use it. */
  wait(frames: number): Promise<void>;
  fadeTo(level: number, frames?: number, color?: string): Promise<void>;
  shake(frames?: number, mag?: number, dir?: ShakeDirection): void;
  flash(color?: string, frames?: number): void;
  /** The scene on top. `unknown` on purpose: the old engine returns a legacy scene, the new one a legacy scene or a `Scene`. */
  readonly top: unknown;
  /** The tick counter. */
  readonly frame: number;
  /** Ticks per loop step. Debug and tests only. */
  speed: number;
}

/** The surface of the old `Game` that the game code uses. See the file comment. */
export interface LegacyGameSurface extends GameApi {
  readonly input: Input;
  /** A 2D context holding the picture as the player sees it (the old back buffer). The new engine builds it when asked. */
  readonly ctx: CanvasRenderingContext2D;
  /** The legacy scenes on the stack, bottom first. */
  readonly stack: readonly AnyLegacy[];
  /** Frames of play time (counts only while `countPlayTime` is set). */
  playFrames: number;
  countPlayTime: boolean;
  /** Run every tick before the scenes (audio sequencer, postfx). A ticker that throws is reported and dropped. */
  tickers: (() => void)[];
  /** Run after the scenes draw (the notice badge). An overlay that throws is reported and dropped. */
  overlays: ((ctx: CanvasRenderingContext2D) => void)[];
  shakeScale: () => number;
  flashScale: () => number;
  /** Called once when something keeps throwing (`FAULT_LIMIT` ticks or frames in a row). */
  onFault: (() => void) | null;
  /** This frame's shake offset in screen pixels; legacy scenes apply it to their world layer themselves. */
  readonly shakeX: number;
  readonly shakeY: number;
  fadeLevel: number;
  fadeColor: string;
  reset<R>(scene: Scene<R> | LegacyShape<R>): Promise<R>;
  /** Drop every scene, timer and fade without resolving them. */
  abandon(): void;
  /** Take a legacy scene off the stack (what the old `Scene.close` calls). */
  remove(scene: AnyLegacy): void;
  fadeOut(frames?: number, color?: string): Promise<void>;
  fadeIn(frames?: number): Promise<void>;
}
