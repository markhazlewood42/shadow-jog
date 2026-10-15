/**
 * A stand-in for the old engine's `Scene` base class, for the tests of the `LegacyScene` adapter only (M8d task 11; task 13 deletes this file with those tests).
 *
 * The old engine's game file held the real class (deleted in task 12). These tests still need a scene "of the old shape" until the adapter goes, so the shape lives here:
 * `enter`, `exit`, `resume`, `update()`, `render(ctx)`, the three flags and `close(result)`, which takes the scene off the game and resolves its promise.
 */
import type { LegacyGameSurface, LegacyShape } from '../src/sje/runtime/gameapi';

export abstract class OldScene<R = unknown> implements LegacyShape<R> {
  game!: LegacyGameSurface;
  opaque = true;
  curtain = false;
  passUpdate = false;
  closed = false;
  private resolver: ((r: R) => void) | null = null;

  enter(): void {}
  exit(): void {}
  resume(): void {}
  abstract update(): void;
  abstract render(ctx: CanvasRenderingContext2D): void;

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
