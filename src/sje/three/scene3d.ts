/**
 * Scene3D: a `Scene` that owns one Three.js scene for the length of one session
 * (docs/engine/interfaces.md section 12, frame-and-rendering.md 7.2 and 7.4).
 * Follows: nothing in Phaser (it has no 3D mode). The three methods a subclass writes are named in
 * the order a frame happens:
 *
 *   `create3D()`    once: build the Object3D graph, the camera, the lights.
 *   `update3D(tick)` every fixed tick: advance the PURE simulation. No Three call in here.
 *   `sync3D()`      every frame, just before the draw: copy the simulation's state into the Object3D
 *                   transforms. (The simulation never touches Three; this method is the only bridge.)
 *
 * `Scene3D` itself does the rest: it makes the `Frame3D`, puts its `View3D` in the scene's `world`,
 * draws the 3D frame in the scene's `prerender`, frees everything at shutdown, and keeps the
 * result promise honest when the GL context is lost (the WATCHDOG, below). A subclass never
 * overrides `create` or `fixedUpdate`: those belong to this class.
 *
 * @deviation from interfaces.md: `create3D` takes no argument. The sketch passes `typeof
 * import('three')` (the whole Three namespace). Handing the namespace around makes the bundler keep
 * ALL of Three in the 3D chunk. A subclass imports the Three names it uses instead, and the chunk
 * keeps only those. See the B2 notes in docs/spikes/engine-platform.md for the measured sizes.
 *
 * THE WATCHDOG (7.4). A lost WebGL context cannot draw, and `game.run` would wait for a scene that
 * can never finish. So the scene listens for the loss. If the context does not come back within
 * `contextGraceMs` (1 second by default; the research pass line is 2 seconds) the scene closes itself
 * with the subclass's `abortResult('context-lost')`. If the context DOES come back, the frame is
 * re-pointed at Three's new texture (`rewrap`) and the session carries on.
 *
 * ON A LOSS the scene also lets Three forget its GPU objects (`releaseGpuData`, once per loss). Without
 * that, ending the scene after a restore deletes dead handles and the browser logs a warning for each.
 * (Doing it while the context is lost is free: every GL call is a silent no-op then.)
 */
import { type Camera, PerspectiveCamera, Scene as ThreeScene } from 'three';
import { H, W } from '../core/size';
import { DEPTH } from '../display/depth';
import type { DisplayHost } from '../display/gameobject';
import { GlRenderer } from '../runtime/glrenderer';
import { Scene } from '../runtime/scene';
import { disposeObject3D, releaseGpuData } from './dispose';
import { type BloomSettings, createFrame3D, type Frame3D, type Frame3DPreference, type Frame3DSetup } from './frame3d';
import { must } from '../core/assert';
import { runAll } from '../core/runall';

/**
 * How long a lost context may take to come back before the scene gives up.
 * @deviation from frame-and-rendering.md 7.4, which says 2 seconds. The pass line is that the hack RESOLVES within 2 s of the loss,
 * and the watchdog is only part of that time (timer jitter, one slow frame on software GL). One second leaves a full second of margin.
 * A context that comes back between 1 and 2 s is therefore given up on, where the design would wait. Drift item 24; Mark decides.
 */
export const CONTEXT_GRACE_MS = 1000;

/** Why a 3D scene ended without finishing its job. */
export type Scene3DAbort = 'context-lost' | 'user' | 'error';

export interface Scene3DOptions {
  /** Which `Frame3D` to use. Default `auto` (the shared context, with the canvas copy as the fallback). */
  frameMode?: Frame3DPreference;
  /** Override the watchdog's patience, in ms. Tests. */
  contextGraceMs?: number;
  /** Replace the way a frame is made (headless tests give a fake that needs no GPU). */
  makeFrame?: (host: DisplayHost, setup: Frame3DSetup) => Frame3D;
}

export abstract class Scene3D<R> extends Scene<R> {
  /** Three's scene graph. Created before `create3D`, which fills it. */
  protected threeScene: ThreeScene = new ThreeScene();
  /** The camera the frame is drawn with. A subclass may replace its settings in `create3D`. */
  protected camera: Camera = new PerspectiveCamera(50, W / H, 0.1, 400);
  /** Set in `create3D` to switch bloom on. Read once, after `create3D`. */
  protected bloom: BloomSettings | null = null;

  private _frame: Frame3D | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private watching = false;
  private torndown = false;
  private createdOk = false;
  /** True from the moment a loss was seen until the next draw that finds the context back. One release per loss. */
  private lossSeen = false;
  // The listeners are kept so shutdown can remove exactly them.
  private readonly onLost = (): void => this.contextWasLost();
  private readonly onRestored = (): void => this.stopWatchdog();

  constructor(protected readonly options: Scene3DOptions = {}) {
    super();
  }

  // ---- what a subclass writes ------------------------------------------------------------------

  /** Once: build the Object3D graph, the camera and the lights. Set `this.bloom` here if wanted. */
  protected abstract create3D(): void;
  /** Every fixed tick: advance the pure simulation. */
  protected abstract update3D(tick: number): void;
  /** Every frame, just before the draw: copy the simulation state into the Object3D transforms. */
  protected abstract sync3D(): void;
  /** The result to give `game.run` when this scene ends without finishing. */
  protected abstract abortResult(reason: Scene3DAbort): R;
  /** Optional: add the 2D HUD (`this.add.layer({ ui: true })`...). Runs after the 3D frame exists. */
  protected createHud?(): void;
  /** Optional: free what the subclass made (HUD textures...). Runs at shutdown, before the 3D parts are freed. */
  protected dispose3D?(): void;

  // ---- what the scene gives ---------------------------------------------------------------------

  protected get frame(): Frame3D {
    return must(this._frame, `Frame3D of scene ${this.key} (it is made in create)`);
  }

  /** True once `create` finished without throwing. (A scene that never got that far was never really started.) */
  protected get started(): boolean {
    return this.createdOk;
  }

  /** Is the 3D frame there yet? (False before `create` finishes, and after shutdown.) */
  get hasFrame(): boolean {
    return this._frame !== null;
  }

  /** The frame, for the dev lab and tests. */
  get frame3d(): Frame3D {
    return this.frame;
  }

  /** End the scene early with `abortResult(reason)`. */
  endEarly(reason: Scene3DAbort = 'user'): void {
    this.close(this.abortResult(reason));
  }

  // ---- the lifecycle ----------------------------------------------------------------------------

  override create(): void {
    // Cleanup is registered FIRST. If anything below throws, the scene manager discards the scene,
    // `shutdown` fires, and everything made so far is freed (rule 8, "always in finally").
    this.events.on('shutdown', () => this.freeAll());
    this.game.events.on('contextlost', this.onLost);
    this.game.events.on('contextrestored', this.onRestored);
    this.watching = true;
    this.events.on('create', () => {
      this.createdOk = true;
    });

    // A context that is already lost cannot make a frame: give the fallback result at once.
    if (this.contextIsLost()) {
      this.endEarly('context-lost');
      return;
    }

    this.create3D();
    const setup: Frame3DSetup = { scene: this.threeScene, camera: this.camera, bloom: this.bloom };
    const make = this.options.makeFrame;
    this._frame = make ? make(this, setup) : this.makeRealFrame(setup);
    // The 3D picture is the backdrop of this scene. The HUD goes above it, in `ui`.
    this.frame.sprite.setDepth(DEPTH.BACKDROP);
    this.sys.world.add(this.frame.sprite);
    this.createHud?.();
    this.events.on('prerender', () => this.drawFrame());
  }

  fixedUpdate(tick: number): void {
    this.update3D(tick);
  }

  // ---- internals --------------------------------------------------------------------------------

  private makeRealFrame(setup: Frame3DSetup): Frame3D {
    const renderer = this.game.renderer;
    if (!(renderer instanceof GlRenderer)) throw new Error('Scene3D needs the GL renderer (a game made with Game.create)');
    return createFrame3D(renderer, this, setup, this.options.frameMode ?? 'auto');
  }

  private contextIsLost(): boolean {
    return this.game.contextLost;
  }

  /** Per frame, before the engine draws: copy the state out, then draw the 3D frame. */
  private drawFrame(): void {
    if (this.closed || !this._frame) return;
    // The event can be missed (a loss while the page was hidden): check the context itself each frame.
    if (this._frame.contextLost || this.contextIsLost()) {
      this.contextWasLost();
      return;
    }
    // The context is back (the engine's event, or a PRIVATE context in the canvas-copy mode, which sends no engine event). A loss
    // seen before ends here: stop its timer, or a second loss soon after would be cut short by the first one's timer.
    if (this.lossSeen) {
      this.lossSeen = false;
      this.stopWatchdog();
    }
    try {
      this.sync3D();
      this._frame.render();
    } catch (e) {
      // A 3D frame that throws (a shader that does not compile) would throw on every frame. End the
      // scene instead, so the story gets an answer.
      console.error(`[sje] 3D scene ${this.key} failed while drawing:`, e);
      this.endEarly('error');
    }
  }

  /** A loss was seen (the event, or the per-frame check): free Three's records once, and start the watchdog. */
  private contextWasLost(): void {
    if (this.closed || this.torndown) return;
    if (!this.lossSeen) {
      this.lossSeen = true;
      try {
        releaseGpuData(this.threeScene);
        this._frame?.releaseGpuData();
      } catch (e) {
        // Not fatal: the worst case is the warnings this step prevents. The watchdog still has to start.
        console.error(`[sje] 3D scene ${this.key}: releasing GPU data after a context loss failed:`, e);
      }
    }
    this.startWatchdog();
  }

  private startWatchdog(): void {
    if (this.watchdog !== null || this.closed) return;
    const ms = this.options.contextGraceMs ?? CONTEXT_GRACE_MS;
    this.watchdog = setTimeout(() => {
      this.watchdog = null;
      // Came back in the meantime? Then there is nothing to give up on.
      if (!this.closed && (this._frame?.contextLost || this.contextIsLost())) this.endEarly('context-lost');
    }, ms);
  }

  private stopWatchdog(): void {
    if (this.watchdog !== null) clearTimeout(this.watchdog);
    this.watchdog = null;
    // The context is back. Three made a new GL texture, so the frame must re-point at it. It does so
    // at its next render (not now: Three's own restore listener may not have run yet).
  }

  /** Shutdown: free everything this scene made, each part guarded so one failure cannot skip the rest. */
  private freeAll(): void {
    if (this.torndown) return;
    this.torndown = true;
    this.stopWatchdog();
    if (this.watching) {
      this.game.events.off('contextlost', this.onLost);
      this.game.events.off('contextrestored', this.onRestored);
    }
    // Every step has its turn even when an earlier one throws (`runAll`), then the first failure is reported.
    // The frame stays readable for the subclass's `dispose3D`, which runs first.
    try {
      runAll([() => this.dispose3D?.(), () => this._frame?.dispose(), () => disposeObject3D(this.threeScene)]);
    } finally {
      this._frame = null;
    }
  }
}
