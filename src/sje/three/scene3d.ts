/**
 * Scene3D: a `Scene` that owns a Three scene for one session (docs/engine/interfaces.md section 12, frame-and-rendering.md 7.2 and 7.3).
 * Lives in the lazy 3D chunk, with Three. Follows: Phaser `Scene` for the lifecycle; the Three names inside `create3D` stay unchanged.
 *
 * What a subclass writes:
 *   `create3D()`      build the Object3D graph into `world3D`, set `camera3D`, optionally set `bloom`. Import the Three names you use:
 *                     passing the Three namespace in would make the bundler keep all of Three.
 *   `update3D(tick)`  the fixed tick. Pure sim: numbers in, numbers out. It must not touch an Object3D.
 *   `sync3D()`        the draw phase, once per drawn frame: sim state out into Object3D (rotation, position).
 *   `abortResult(r)`  the result of `game.run` when the scene ends early.
 *
 * What this class does, in order:
 *   create    `create3D`, then a `Frame3D` over `world3D` and `camera3D`, then `frame.sprite` into the scene's `world`.
 *   tick      `fixedUpdate(tick)` is `update3D(tick)`. A subclass does not override it (`create` throws if it does).
 *   draw      the scene's `prerender` event: `sync3D()`, then `frame.render()` once. Pixi draws the sprite after that, in the same frame.
 *   shutdown  the frame first (the sprite and Pixi's wrapper, then Three's render target), then the geometry, materials and textures
 *             of `world3D`. The sprite is gone before the texture it shows. `Scene._teardown` then destroys the display list; a sprite
 *             that is already destroyed is skipped.
 *
 * A lost GL context: the scene ends with `abortResult('context-lost')` in the next draw. It does not try to keep going. The game
 * event `contextlost` (or the frame's own `contextLost` flag, whichever comes first) makes Three forget its GPU objects once
 * (`releaseGpuData`), so the disposal at shutdown deletes no dead handle. A context that comes back after the scene ended finds nothing to draw.
 *
 * @deviation from Phaser: there is no variable-delta `update`; `fixedUpdate` is the only update (decision E2), here named `update3D`.
 */
import { type Camera, Scene as ThreeScene } from 'three';
import { must } from '../core/assert';
import { runAll } from '../core/runall';
import type { DisplayHost } from '../display/gameobject';
import { GlRenderer } from '../runtime/glrenderer';
import { Scene } from '../runtime/scene';
import { disposeObject3D, releaseGpuData } from './dispose';
import { type BloomSettings, createFrame3D, type Frame3D, type Frame3DPreference, type Frame3DSetup } from './frame3d';

/** Why a 3D scene ended early. */
export type Scene3DAbort = 'context-lost' | 'user' | 'error';

/** The result of a hack session (interfaces.md section 12). The hack door (M7) builds on it; M1b only uses `aborted`. */
export type HackResult =
  | { status: 'success'; data?: unknown }
  | { status: 'fail'; data?: unknown }
  | { status: 'aborted'; reason: Scene3DAbort }
  | { status: 'unsupported'; reason: 'no-webgl2' | 'chunk-failed' };

/** Makes the `Frame3D` of a scene. The default is `createFrame3D` on the game's GL renderer. A test gives its own. @ours */
export type FrameMaker = (setup: Frame3DSetup, host: DisplayHost) => Frame3D;

export interface Scene3DOptions {
  /** Which Frame3D: `auto` (default), `shared-context` or `canvas-copy`. */
  frame?: Frame3DPreference;
  /** TEST ONLY: build the frame yourself (a fake that records its calls, so the lifecycle runs in Node with no GPU). */
  makeFrame?: FrameMaker;
}

export abstract class Scene3D<R> extends Scene<R> {
  /** The root of the Three graph. `create3D` fills it. The scene frees everything under it at shutdown. */
  protected readonly world3D: ThreeScene = new ThreeScene();
  /** The camera the frame draws with. `create3D` must set it. */
  protected camera3D: Camera | null = null;
  /** Bloom inside the 3D target, or null (default). Set it in `create3D`. */
  protected bloom: BloomSettings | null = null;

  private _frame: Frame3D | null = null;
  private gpuReleased = false;
  private lost = false;

  constructor(private readonly options: Scene3DOptions = {}) {
    super();
  }

  /** The frame. Only exists from `create` on. */
  protected get frame(): Frame3D {
    return must(this._frame, `frame for scene ${this.key} (create3D has not finished)`);
  }

  abstract create3D(): void;
  abstract update3D(tick: number): void;
  abstract sync3D(): void;
  abstract abortResult(reason: Scene3DAbort): R;

  /** Closes the scene with `abortResult(reason)`. Does nothing when the scene has ended already. */
  endEarly(reason: Scene3DAbort = 'user'): void {
    if (this.closed) return;
    this.close(this.abortResult(reason));
  }

  /** The tick is `update3D`. A subclass does not override this. */
  fixedUpdate(tick: number): void {
    this.update3D(tick);
  }

  /** Not for subclasses: write `create3D`. */
  override create(): void {
    if (this.fixedUpdate !== Scene3D.prototype.fixedUpdate) throw new Error(`Scene3D "${this.key}" overrides fixedUpdate. Write update3D(tick) instead.`);
    // Registered first, so a throw inside `create3D` still frees what it built.
    this.events.on('shutdown', this.free);
    this.create3D();
    const camera = must(this.camera3D, `camera3D for scene ${this.key} (create3D must set it)`);
    const frame = this.makeFrame({ scene: this.world3D, camera, bloom: this.bloom });
    this._frame = frame;
    this.sys.world.add(frame.sprite);
    this.events.on('prerender', this.draw3D);
    this.game.events.on('contextlost', this.onContextLost);
  }

  private makeFrame(setup: Frame3DSetup): Frame3D {
    if (this.options.makeFrame) return this.options.makeFrame(setup, this);
    const renderer = this.game.renderer;
    if (!(renderer instanceof GlRenderer)) throw new Error(`Scene3D "${this.key}" needs the GL renderer (this game has another one)`);
    return createFrame3D(renderer, this, setup, this.options.frame ?? 'auto');
  }

  /** Tell Three to forget its GPU objects, once per loss. While the context is lost every GL call is a no-op, so this is free. */
  private releaseOnce(): void {
    if (this.gpuReleased) return;
    this.gpuReleased = true;
    runAll([() => releaseGpuData(this.world3D), () => this._frame?.releaseGpuData()]);
  }

  private readonly onContextLost = (): void => {
    this.lost = true;
    this.releaseOnce();
  };

  /** The draw phase: end early on a lost context, else sim out into Three, then one frame. */
  private readonly draw3D = (): void => {
    const frame = this._frame;
    if (!frame) return;
    if (this.lost || frame.contextLost) {
      this.lost = true;
      this.releaseOnce();
      this.endEarly('context-lost');
      return;
    }
    this.sync3D();
    frame.render();
  };

  private readonly free = (): void => {
    this.game.events.off('contextlost', this.onContextLost);
    const frame = this._frame;
    this._frame = null;
    // The frame first: its sprite stops reading the texture before the texture goes. Each step runs even if the one before it threw.
    runAll([() => frame?.dispose(), () => disposeObject3D(this.world3D)]);
  };
}
