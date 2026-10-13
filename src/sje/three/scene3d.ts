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
 *             of `world3D`, then `dispose3D()` (the subclass's own parts, for example a HUD). The sprite is gone before the texture it shows.
 *             `Scene._teardown` then destroys the display list; a sprite that is already destroyed is skipped.
 *
 * A lost GL context (decision C4, D3 of docs/engine/m7-brief.md): the scene gets a GRACE of `contextGraceMs` (default 1000) to get it back.
 *   - The game event `contextlost` (or the frame's own `contextLost` flag, whichever comes first) makes Three forget its GPU objects once
 *     (`releaseGpuData`), so the disposal at shutdown deletes no dead handle, and starts the grace timer. Nothing ends inside the event: the
 *     browser is still calling the other listeners of the loss.
 *   - During the grace the sim keeps ticking and the draw does nothing (every GL call would be a no-op). If the context returns, the scene
 *     carries on: the frame rewraps its texture in its next `render()` (Frame3D marks itself stale on `restored`), and Three uploads its objects again.
 *   - When the timer runs out the scene ends with `abortResult('context-lost')`. The end runs from the timer, outside the draw phase, so no scene closes
 *     inside its own `prerender` because of a loss.
 *   - `contextGraceMs: 0` means no grace: the scene ends in the first draw after the loss, as M1b built it (D3 option C).
 *   The timer is wall-clock time (`setTimeout`): a lost context is a wall-clock fact, and the grace must hold when ticks stall. A context that comes
 *   back after the scene ended finds nothing to draw.
 *
 * @deviation from Phaser: there is no variable-delta `update`; `fixedUpdate` is the only update (decision E2), here named `update3D`.
 */
import { type Camera, Scene as ThreeScene } from 'three';
import { must } from '../core/assert';
import type { HackAbortReason, HackResult } from '../core/hackresult';
import { runAll } from '../core/runall';
import type { DisplayHost } from '../display/gameobject';
import { GlRenderer } from '../runtime/glrenderer';
import { Scene } from '../runtime/scene';
import { disposeObject3D, releaseGpuData } from './dispose';
import { type BloomSettings, createFrame3D, type Frame3D, type Frame3DPreference, type Frame3DSetup } from './frame3d';

/** Why a 3D scene ended early. */
export type Scene3DAbort = HackAbortReason;

/** The result of a hack session (interfaces.md section 12). One definition, in `core/hackresult.ts`; this is the name the 3D chunk and the lab already import. */
export type { HackResult };

/** How long a lost context may take to come back before the scene gives up, in ms (decision C4, confirmed as D3 option A in docs/engine/m7-brief.md). */
export const CONTEXT_GRACE_MS = 1000;

/** Makes the `Frame3D` of a scene. The default is `createFrame3D` on the game's GL renderer. A test gives its own. @ours */
export type FrameMaker = (setup: Frame3DSetup, host: DisplayHost) => Frame3D;

export interface Scene3DOptions {
  /** Which Frame3D: `auto` (default), `shared-context` or `canvas-copy`. */
  frame?: Frame3DPreference;
  /** TEST ONLY: build the frame yourself (a fake that records its calls, so the lifecycle runs in Node with no GPU). */
  makeFrame?: FrameMaker;
  /** How long a lost context may take to come back, in ms (default `CONTEXT_GRACE_MS`, 1000). 0 means no grace. */
  contextGraceMs?: number;
  /**
   * Called once, in the draw phase, right after the scene's FIRST 3D frame is drawn (`frame.render()` has run). The jack-in transition waits for it: the first frame pays
   * the shader compile, and it must land under the cover, before the reveal (M7 pass line 22).
   */
  onFirstRender?: () => void;
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
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private _started = false;
  private rendered = false;

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

  /** Optional hook: build the scene's 2D parts (a HUD) once the frame exists. Runs at the end of `create`. A throw here makes `game.run` reject; the scene is freed. */
  protected createHud(): void {}
  /** Optional hook: free the parts `createHud` built. Runs at shutdown, after the frame and the Three objects, and runs even if one of those threw. */
  protected dispose3D(): void {}
  /** True once `create` has finished (the frame is up and `createHud` has run). A scene that shuts down before this never really started. */
  protected get started(): boolean {
    return this._started;
  }

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
    this.game.events.on('contextrestored', this.onContextRestored);
    this.createHud();
    this._started = true;
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

  /** The first sign of a loss (the game event, or the frame's flag in a draw). Once per loss: Three forgets its GPU data, and the grace timer starts. */
  private markLost(): void {
    if (this.lost) return;
    this.lost = true;
    this.releaseOnce();
    const grace = this.options.contextGraceMs ?? CONTEXT_GRACE_MS;
    // No grace: the first draw after the loss ends the scene (see `draw3D`).
    if (grace > 0) this.graceTimer = setTimeout(this.graceExpired, grace);
  }

  /** The context is back before the grace ran out: draw again. Three's objects upload again in the next `render()`, and the frame rewraps its texture. */
  private recover(): void {
    if (!this.lost) return;
    this.lost = false;
    // A second loss must make Three forget its GPU data again.
    this.gpuReleased = false;
    this.clearGrace();
  }

  private clearGrace(): void {
    if (this.graceTimer !== null) clearTimeout(this.graceTimer);
    this.graceTimer = null;
  }

  private readonly graceExpired = (): void => {
    this.graceTimer = null;
    this.endEarly('context-lost');
  };

  private readonly onContextLost = (): void => this.markLost();

  /** The browser says the context is back. The frame's own flag decides: in the canvas-copy path the game's context and the frame's can differ. */
  private readonly onContextRestored = (): void => {
    if (this._frame && !this._frame.contextLost) this.recover();
  };

  /** The draw phase: nothing while the context is lost, else sim out into Three, then one frame. */
  private readonly draw3D = (): void => {
    const frame = this._frame;
    if (!frame) return;
    if (frame.contextLost) {
      this.markLost();
      // D3 option C (no grace): end in the draw, as M1b built it.
      if ((this.options.contextGraceMs ?? CONTEXT_GRACE_MS) <= 0) this.endEarly('context-lost');
      return;
    }
    // The frame says the context is fine, but the scene thinks it is lost: it came back and only the frame saw it (the canvas-copy path).
    // A loss the game reports (`Game.contextLost`) is the shared path's own flag: stay lost until the game says it is back.
    if (this.lost && !this.game.contextLost) this.recover();
    if (this.lost) {
      // No grace: a loss that only the game event reported (the frame flag is still false) ends the scene here too. Else the scene would freeze for ever (decision E11).
      if ((this.options.contextGraceMs ?? CONTEXT_GRACE_MS) <= 0) this.endEarly('context-lost');
      return;
    }
    this.sync3D();
    frame.render();
    if (!this.rendered) {
      this.rendered = true;
      this.options.onFirstRender?.();
    }
  };

  private readonly free = (): void => {
    this.clearGrace();
    this.game.events.off('contextlost', this.onContextLost);
    this.game.events.off('contextrestored', this.onContextRestored);
    const frame = this._frame;
    this._frame = null;
    // The frame first: its sprite stops reading the texture before the texture goes. Each step runs even if the one before it threw.
    // The subclass's own parts go last, and they run even when a step before them threw (a hack must still tell its story that it ended).
    runAll([() => frame?.dispose(), () => disposeObject3D(this.world3D), () => this.dispose3D()]);
  };
}
