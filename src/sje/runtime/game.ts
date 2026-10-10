/**
 * Game: the top object (docs/engine/interfaces.md section 1, frame-and-rendering.md sections 1 to 3, 9 and 11).
 * Follows: Phaser `Game`. It is created with `await Game.create(config)` because Pixi's `init` is async.
 *
 * It owns the loop, the scene stack, the texture store, the screen root and the renderer.
 *
 * One TICK (`advanceTick`), in the order of frame-and-rendering.md section 2:
 *   1. Input polling (`input.update()`). A throw is reported once and dropped: a blocked Gamepad API is not a scene fault.
 *   2. `prestep` then `step` events (with the tick that is ending).
 *   3. The legacy tickers (the audio sequencer, the old effects layer). A ticker that throws is reported and dropped.
 *   4. The game clock: the tick counter goes up, `playFrames`, due `wait()` timers resolve, the game fade moves, shake and flash count down.
 *   5. The scenes run, top first (`SceneManager.tick`): `preupdate`, the scene's `time` and `tweens`, `fixedUpdate`, `update`, `postupdate`,
 *      the cameras' effects.
 *   6. `poststep` event, then `input.endFrame()`.
 *   7. Fault counting: ONE counter for the whole tick. After `FAULT_LIMIT` ticks in a row that threw, `onFault` runs.
 *      (The destroy queue of step 8 is not built: nothing defers a destroy yet.)
 * One DRAW (`draw`):
 *   1. This frame's shake offset, then the `prerender` event, then each drawn scene's `prerender` and the camera transforms.
 *   2. The renderer draws the screen into the back buffer and presents it.
 *   3. A SEPARATE counter for the draw: a throw in a `prerender` handler or in the draw counts. After `FAULT_LIMIT` frames in a row,
 *      `onFault` runs (a scene that throws on every draw is a frozen picture, which is a softlock too).
 *   4. `postrender` event.
 * The tick changes state. The draw only reads it.
 *
 * Microtasks: story code (`await game.wait(30)`) continues AFTER the whole animation-frame callback, not between the ticks of it. A promise
 * resolved in a tick runs its continuation when the callback returns. That is today's behavior, and it follows from the loop's shape.
 *
 * Fault isolation is today's, line for line (tests/game.test.ts runs the same cases on both `Game` classes): an exception in one scene's
 * update or draw is reported and that scene skips the frame; the loop never dies.
 *
 * `scale` is the `Display`: integer mode only (Mark, 2026-10-09). It redraws the frame after every resize, because resizing a canvas clears it.
 *
 * `fx` is the effects system (M2, src/sje/fx/fxsystem.ts). `Game.create` gives it the GPU. A `Game` made by hand (a test) has one with no GPU: its
 * state works, nothing is drawn. `draw` starts each frame's layers (`fx.beginFrame`); the renderer calls `fx.prepare` before it draws the screen.
 * The state step, `fx.update()`, is NOT called here: the game's ticker does it through `postfx` (see fxsystem.ts).
 *
 * Not built yet: `audio` (the bridge, with the first native scene), `registry`, the destroy queue, the 3D scene (M1b).
 */
import { EventEmitter } from '../core/eventemitter';
import { FixedLoop, type FixedLoopOptions } from '../core/fixedloop';
import { H, W } from '../core/size';
import { CanvasImage } from '../display/canvasimage';
import type { DisplayHost } from '../display/gameobject';
import { Graphics } from '../display/graphics';
import { Screen } from '../display/screen';
import { TextureManager } from '../display/texturemanager';
import { FxSystem, type FxLevel, type FxRequest } from '../fx/fxsystem';
import { glRendererName } from '../render/glcontext';
import type { Input } from '../../engine/input';
import { Display } from './display';
import type { AnyLegacy, LegacyGameSurface, LegacyShape, ShakeDirection } from './gameapi';
import { type FrameRenderer, GlRenderer } from './glrenderer';
import { type ActionMap, actionMapOf } from './input';
import { LegacyScene } from './legacyscene';
import { CacheManager, type LoadBackend } from './loader';
import { Scene } from './scene';
import { type AnyScene, type FaultPhase, SceneManager } from './scenemanager';
import { GameFx, type LegacyCompat } from './screenfx';

/** Consecutive faulting ticks (or draws) before the game gives up on the current flow. The same number as the old engine's. */
export const FAULT_LIMIT = 30;

/** `lite` is never in `settings.fxLevel`; it is the level that `auto` picks on software GL (src/sje/fx/fxsystem.ts). */
export type { FxLevel };

export interface GameConfig {
  /** Where the canvas goes. It must be positioned (fixed, absolute or relative) and fill the window. */
  parent: HTMLElement;
  /** The old `Input` (keyboard, gamepad, touch). The new engine wraps it, it does not copy it. */
  input: Input;
  /** Effects level, from `settings.fxLevel`, or forced (`?fx=full`). `auto` picks `lite` on software GL. @ours */
  fxLevel?: FxRequest;
  /** Visual randomness only. @ours */
  seed?: number;
  /** Dev builds: the hook, extra checks. @ours */
  dev?: boolean;
  /** The old engine's reportError, shake motion and the like. */
  compat?: Partial<LegacyCompat>;
}

export interface GameEvents {
  prestep(tick: number): void;
  step(tick: number): void;
  poststep(tick: number): void;
  prerender(alpha: number): void;
  postrender(): void;
  /** @ours */
  contextlost(): void;
  /** @ours */
  contextrestored(): void;
  /** A scene (or the loop, when `scene` is null) threw. @ours */
  fault(scene: AnyScene | null, error: unknown): void;
}

/** What `new Game` needs. `Game.create` builds the real ones; a test builds a renderer that draws nothing. */
export interface GameParts {
  renderer: FrameRenderer;
  input: Input;
  textures?: TextureManager;
  loop?: FixedLoopOptions;
  compat?: Partial<LegacyCompat>;
  /** Where the loader gets bytes. Tests give their own. */
  loadBackend?: LoadBackend;
  /** The display. `Game.create` builds the real one; a test leaves it out and gets one with no canvas. */
  scale?: Display;
}

interface Timer {
  at: number;
  resolve: () => void;
}

const DEFAULT_COMPAT: LegacyCompat = {
  reportError: (e) => console.error('[sje]', e),
  warn: (m) => console.warn('[sje]', m),
  shakeOffset: () => ({ x: 0, y: 0 }),
  shakeGain: 1,
};

export class Game implements DisplayHost, LegacyGameSurface {
  readonly events = new EventEmitter<GameEvents>();
  readonly textures: TextureManager;
  readonly cache = new CacheManager();
  readonly screen: Screen;
  /** Where the picture sits in the window (integer scale only). */
  readonly scale: Display;
  readonly scene: SceneManager;
  readonly renderer: FrameRenderer;
  /** The old `Input`, as the legacy scenes use it. */
  readonly input: Input;
  /** The same input as an action map, for the new scenes. */
  readonly actions: ActionMap;
  readonly loadBackend: LoadBackend | undefined;
  /** The tick counter. It goes up by one per tick (today's `frame`). */
  tick = 0;
  /** Frames of play time (only counts while countPlayTime is set: not on the title or menus that stop the clock). */
  playFrames = 0;
  countPlayTime = false;
  /** Hooks run every tick before the scenes (the audio sequencer, the old effects layer). */
  tickers: (() => void)[] = [];
  /** Hooks run after the topmost scene draws (the notice badge). */
  overlays: ((ctx: CanvasRenderingContext2D) => void)[] = [];
  /** Screen-shake strength multiplier (the player's setting); 0 turns every shake off. */
  shakeScale: () => number = () => 1;
  /** Player setting for full-screen flashes (0 = off). */
  flashScale: () => number = () => 1;
  /** Called once when something keeps throwing (see FAULT_LIMIT). */
  onFault: (() => void) | null = null;
  /** The screen effects (src/sje/fx/fxsystem.ts). `Game.create` gives it the GPU; a hand-made `Game` has the headless one (state only, nothing drawn). */
  fx: FxSystem = new FxSystem();

  private readonly loop: FixedLoop;
  private readonly compat: LegacyCompat;
  private readonly gfx: GameFx;
  private timers: Timer[] = [];
  private dueBuf: (Timer | undefined)[] = [];
  private readonly wrappers = new WeakMap<object, AnyScene>();
  /** Consecutive ticks in which something threw. */
  private faults = 0;
  /** Input polling has thrown once (reported); later throws are dropped silently. */
  private inputFaulted = false;
  private faultedThisTick = false;
  /** Consecutive draws in which a scene threw (a draw bug can freeze the picture on its own). */
  private renderFaults = 0;
  private faultedThisRender = false;
  private snapshot: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;
  // Used only while the topmost drawn scene is not a legacy scene (or there is none).
  private washGfx: Graphics | null = null;
  private overlayLayer: CanvasImage | null = null;

  constructor(parts: GameParts) {
    this.renderer = parts.renderer;
    this.input = parts.input;
    this.actions = actionMapOf(parts.input);
    this.loadBackend = parts.loadBackend;
    this.compat = { ...DEFAULT_COMPAT, ...parts.compat };
    this.gfx = new GameFx(this.compat);
    this.textures = parts.textures ?? new TextureManager();
    this.screen = new Screen(this);
    this.scale = parts.scale ?? new Display();
    // Resizing a canvas clears it: draw again at once rather than show a blank frame until the next tick.
    this.scale.on('resize', () => this.draw(0));
    this.scene = new SceneManager(this, this.screen, (scene, error, phase) => this.reportFault(scene, error, phase));
    const record = this.compat.record;
    this.loop = new FixedLoop(
      { tick: () => this.advanceTick(), draw: (alpha) => this.draw(alpha), onError: (e) => this.reportFault(null, e, 'other'), ...(record ? { record } : {}) },
      parts.loop,
    );
  }

  /**
   * Make the canvas, the WebGL2 context and the Pixi renderer, and a game on top of them.
   * Rejects with a plain message when the browser has no WebGL2: the page shows it as "failed to start".
   */
  static async create(config: GameConfig): Promise<Game> {
    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    config.parent.appendChild(canvas);
    let renderer: GlRenderer;
    try {
      renderer = await GlRenderer.create(canvas);
    } catch (e) {
      canvas.remove();
      throw e;
    }
    const scale = new Display(renderer);
    const game = new Game({ renderer, scale, input: config.input, ...(config.compat ? { compat: config.compat } : {}) });
    game.startFx(renderer, config.fxLevel ?? 'auto', config.seed);
    renderer.glc.on('lost', () => game.events.emit('contextlost'));
    renderer.glc.on('restored', () => game.events.emit('contextrestored'));
    scale.attach(config.parent);
    return game;
  }

  /** The effects level that was asked for (`auto`, `full`, `lite`, `none`). Setting it switches the effects at once; `fx.level` is what is drawn. */
  get fxLevel(): FxRequest {
    return this.fx.request;
  }
  set fxLevel(v: FxRequest) {
    this.fx.setLevel(v);
  }

  /** Give the effects the GPU: the Pixi renderer, the screen and the context's name. Called once by `Game.create`. */
  private startFx(renderer: GlRenderer, request: FxRequest, seed?: number): void {
    this.fx = new FxSystem({ gpu: { pixi: renderer.pixi, screen: this.screen, host: this, rendererName: glRendererName(renderer.glc) }, request, ...(seed !== undefined ? { seed } : {}) });
    renderer.beforeDraw = (pixi) => this.fx.prepare(pixi);
  }

  /** Ticks per loop step. Debug and tests only. */
  get speed(): number {
    return this.loop.speed;
  }
  set speed(v: number) {
    this.loop.speed = v;
  }

  /** The tick counter, under the name the old engine used. */
  get frame(): number {
    return this.tick;
  }

  /** True while the WebGL context is lost (nothing can be drawn). */
  get contextLost(): boolean {
    return this.renderer.contextLost === true;
  }

  /** How many times the scene stack was dropped (`abandon` or `reset`). See `SceneManager.dropCount`. */
  get dropCount(): number {
    return this.scene.dropCount;
  }

  /** The scene on top: the old scene for a legacy one, else the `Scene`. */
  get top(): unknown {
    const t = this.scene.top;
    return t instanceof LegacyScene ? t.legacy : t;
  }

  /** The legacy scenes on the stack, bottom first (what `game.stack` was). New scenes are not listed. */
  get stack(): readonly AnyLegacy[] {
    const out: AnyLegacy[] = [];
    for (const s of this.scene.scenes) if (s instanceof LegacyScene) out.push(s.legacy);
    return out;
  }

  get fadeLevel(): number {
    return this.gfx.fadeLevel;
  }
  set fadeLevel(v: number) {
    this.gfx.fadeLevel = v;
  }
  get fadeColor(): string {
    return this.gfx.fadeColor;
  }
  set fadeColor(v: string) {
    this.gfx.fadeColor = v;
  }
  get shakeX(): number {
    return this.gfx.shakeX;
  }
  get shakeY(): number {
    return this.gfx.shakeY;
  }

  /**
   * A 2D context holding the picture as the player sees it, drawn on demand from the layers of the drawn legacy scenes (the old
   * back buffer). `snapshotScreen` reads it before a battle transition. It is rebuilt on each call; keep the canvas, not the context.
   */
  get ctx(): CanvasRenderingContext2D {
    if (!this.snapshot) {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('A 2D canvas context is needed for the screen snapshot (this browser has no canvas drawing)');
      ctx.imageSmoothingEnabled = false;
      this.snapshot = { canvas, ctx };
    }
    const { ctx } = this.snapshot;
    ctx.fillStyle = '#07060d';
    ctx.fillRect(0, 0, W, H);
    for (const s of this.scene.scenes) {
      if (!s.sys.visible) continue;
      // A scene that draws with display objects (the field stage, M5) has no canvas of its own: it paints a picture of itself on request.
      if (s.paintSnapshot) s.paintSnapshot(ctx);
      else if (s instanceof LegacyScene && s.layer) ctx.drawImage(s.layer, 0, 0);
    }
    return ctx;
  }

  /**
   * Push a scene and wait for it. `init`, `preload` and `create` run in THIS call (a legacy scene's `enter` too). The promise
   * resolves when the scene calls `close(result)`, and only then. @deviation Phaser's `run` does not wait.
   */
  run<R>(scene: Scene<R> | LegacyShape<R>, data?: unknown): Promise<R> {
    return this.scene.push(this.adopt(scene), data);
  }

  /**
   * Push a scene UNDER another one that is on the stack (a new `Scene`, or the old scene the other is wrapped from), and run its lifecycle at once (M5: the field
   * stage stands under the field scene and draws it). The scene above must be non-opaque, or the new one is hidden. Rejects if `above` is not on the stack.
   */
  runBeneath<R>(scene: Scene<R>, above: AnyScene | AnyLegacy): Promise<R> {
    const target = above instanceof Scene ? above : this.wrappers.get(above);
    if (!target) return Promise.reject(new Error('Game.runBeneath: the scene above is not on the stack'));
    return this.scene.pushBeneath(scene, target);
  }

  /** Replace the whole stack with one scene. The old scenes' promises stay pending. */
  reset<R>(scene: Scene<R> | LegacyShape<R>, data?: unknown): Promise<R> {
    return this.scene.reset(this.adopt(scene), data);
  }

  /** Drop every scene, timer and fade without resolving them, so a story flow waiting on any of them stops dead. */
  abandon(): void {
    this.scene.abandon();
    this.timers = [];
    this.gfx.abandon();
    this.faults = 0;
    this.renderFaults = 0;
  }

  /** What the old `Scene.close` calls: take a legacy scene off the stack. The scene's own `close` then resolves its promise. */
  remove(legacy: AnyLegacy): void {
    const wrapper = this.wrappers.get(legacy);
    if (!wrapper) return;
    wrapper.closed = true;
    this.scene.remove(wrapper);
  }

  wait(frames: number): Promise<void> {
    return new Promise((resolve) => this.timers.push({ at: this.tick + Math.max(1, Math.round(frames)), resolve }));
  }

  fadeTo(level: number, frames = 20, color?: string): Promise<void> {
    return this.gfx.fadeTo(level, frames, color);
  }

  fadeOut(frames = 20, color?: string): Promise<void> {
    return this.gfx.fadeTo(1, frames, color);
  }

  fadeIn(frames = 20): Promise<void> {
    return this.gfx.fadeTo(0, frames);
  }

  shake(frames = 12, mag = 3, dir?: ShakeDirection): void {
    this.gfx.shake(frames, mag, dir);
  }

  flash(color = '#ffffff', frames = 6): void {
    this.gfx.flash(color, frames);
  }

  /** Start the real loop (`requestAnimationFrame`). */
  start(): void {
    this.loop.start();
  }

  stop(): void {
    this.loop.stop();
  }

  /** Tell the player something in plain words (a notice). */
  warn(message: string): void {
    this.compat.warn(message);
  }

  /** One fixed tick. The loop calls this; so does `step`. */
  advanceTick(): void {
    this.faultedThisTick = false;
    // Input polling shouldn't throw (Input guards the Gamepad API itself), but if it does, the loop reports it once and carries on rather
    // than dying on a black screen. It isn't a scene fault: a persistent input failure mustn't send the player back to the title every 30 ticks.
    try {
      this.input.update();
    } catch (e) {
      if (!this.inputFaulted) this.compat.reportError(e);
      this.inputFaulted = true;
    }
    this.guardGame(() => {
      this.events.emit('prestep', this.tick);
      this.events.emit('step', this.tick);
    });
    // A hook that throws is reported and dropped: it isn't a scene, so going back to the title wouldn't clear it, and left in place it would
    // trip the fault limit over and over.
    for (let i = 0; i < this.tickers.length; i++) {
      try {
        this.tickers[i]?.();
      } catch (e) {
        this.reportFault(null, e, 'tick');
        this.tickers.splice(i--, 1);
      }
    }
    this.tick++;
    if (this.countPlayTime) this.playFrames++;
    this.resolveTimers();
    this.gfx.advance();
    this.scene.tick(this.tick);
    this.guardGame(() => this.events.emit('poststep', this.tick));
    this.input.endFrame();
    this.faults = this.faultedThisTick ? this.faults + 1 : 0;
    if (this.faults >= FAULT_LIMIT) {
      this.faults = 0;
      this.onFault?.();
    }
  }

  /** The draw phase: scene `prerender` handlers and camera transforms, then draw and present. */
  draw(alpha = 0): void {
    this.faultedThisRender = false;
    // Fresh effect layers before any scene draws, and the game flash for the composite (it washes the world, not the UI).
    this.fx.beginFrame();
    if (this.fx.compositing) {
      this.fx.flashColor = this.gfx.flashColor;
      this.fx.flashAlpha = this.gfx.flashAlpha(this.flashScale());
    }
    this.gfx.prepare(this.shakeScale());
    this.guardDraw(() => this.events.emit('prerender', alpha));
    this.scene.prerender();
    this.paintNative();
    this.guardDraw(() => this.renderer.render(this.screen));
    // A scene that throws on every draw leaves the last good frame on screen: to the player, a freeze. Same limit as tick faults, counted per drawn frame.
    this.renderFaults = this.faultedThisRender ? this.renderFaults + 1 : 0;
    if (this.renderFaults >= FAULT_LIMIT) {
      this.renderFaults = 0;
      this.onFault?.();
    }
    this.guardGame(() => this.events.emit('postrender'));
  }

  /**
   * Run `n` ticks with no real time passing, then draw one frame. The dev and test hook
   * (`__SJ__.step` in the design): the same tick count always gives the same picture.
   */
  step(n: number): void {
    for (let i = 0; i < n; i++) this.advanceTick();
    this.draw(0);
  }

  /**
   * Called by the topmost drawn legacy scene after it drew itself: the game-level flash and fade, then the overlay hooks, in the old
   * engine's order. Overlays that throw are reported and dropped.
   */
  paintTop(ctx: CanvasRenderingContext2D): void {
    // With the composite on, the flash is the composite's (set in `draw`), and the fade and the notices go in the effects' UI layer so the
    // shockwaves do not bend them: as in the old engine. That layer sits under every scene above the base, so it is only right when the base is the
    // topmost drawn scene; otherwise that scene's own canvas (already above the filtered world) carries them.
    const layer = this.fx.compositing && this.scene.topVisible === this.scene.base ? this.fx.ui : null;
    const target = layer ?? ctx;
    this.gfx.paint(target, this.flashScale(), !this.fx.compositing);
    for (let i = 0; i < this.overlays.length; i++) {
      try {
        this.overlays[i]?.(target);
      } catch (e) {
        this.reportFault(null, e, 'tick');
        this.overlays.splice(i--, 1);
      }
    }
  }

  /** Dev and tests only: stop, drop the scenes, free the renderer. Production never destroys the renderer. */
  destroyForTests(): void {
    this.stop();
    this.abandon();
    this.scale.destroy();
    this.renderer.destroyForTests?.();
  }

  // ---- internals --------------------------------------------------------------------------------------

  /** A legacy scene gets its adapter (one per legacy scene, remembered so `remove` can find it). A new scene runs as it is. */
  private adopt<R>(scene: Scene<R> | LegacyShape<R>): Scene<R> {
    if (scene instanceof Scene) return scene;
    const known = this.wrappers.get(scene);
    if (known) return known as Scene<R>;
    const wrapper = new LegacyScene<R>(scene);
    this.wrappers.set(scene, wrapper);
    return wrapper;
  }

  private resolveTimers(): void {
    if (this.timers.length === 0) return;
    // Compact in place and collect the due ones into a reused buffer: no allocation per tick.
    let keep = 0;
    let due = 0;
    for (const t of this.timers) {
      if (t.at <= this.tick) this.dueBuf[due++] = t;
      else this.timers[keep++] = t;
    }
    this.timers.length = keep;
    for (let i = 0; i < due; i++) {
      const t = this.dueBuf[i];
      this.dueBuf[i] = undefined;
      t?.resolve();
    }
  }

  /** The game-level washes and overlays when the topmost drawn scene is not a legacy scene (or there is none). */
  private paintNative(): void {
    const top = this.scene.topVisible;
    if (top instanceof LegacyScene) {
      // The legacy scene paints them itself. A fallback layer left from a moment with no scene is freed.
      if (this.overlayLayer) {
        this.overlayLayer.destroy();
        this.overlayLayer = null;
      }
      if (this.washGfx) this.washGfx.visible = false;
      return;
    }
    if (this.gfx.painting) {
      if (!this.washGfx) {
        this.washGfx = new Graphics(this);
        this.washGfx.name = 'game wash';
        this.screen.overlayRoot.add(this.washGfx);
      }
      this.washGfx.visible = true;
      this.gfx.paintNative(this.washGfx, this.flashScale(), !this.fx.compositing);
    } else if (this.washGfx) this.washGfx.visible = false;
    if (this.overlays.length === 0) {
      if (this.overlayLayer) this.overlayLayer.visible = false;
      return;
    }
    if (!this.overlayLayer) {
      this.overlayLayer = new CanvasImage(this, 0, 0, W, H, 'game-overlays');
      this.screen.overlayRoot.add(this.overlayLayer);
    }
    const layer = this.overlayLayer;
    layer.visible = true;
    layer.ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < this.overlays.length; i++) {
      try {
        this.overlays[i]?.(layer.ctx);
      } catch (e) {
        this.reportFault(null, e, 'tick');
        this.overlays.splice(i--, 1);
      }
    }
    layer.refresh();
  }

  /** Run `fn` as part of the tick: a throw is a tick fault. */
  private guardGame(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.reportFault(null, e, 'tick');
    }
  }

  /** Run `fn` as part of the draw: a throw is a render fault. */
  private guardDraw(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.reportFault(null, e, 'render');
    }
  }

  /**
   * One report for each tick (or draw) that throws, however many things threw in it: the first is shown, the rest are only logged by
   * `events.fault`. The tick counter and the draw counter are separate, so one cannot mask the other.
   */
  private reportFault(scene: AnyScene | null, error: unknown, phase: FaultPhase): void {
    if (phase === 'tick') {
      if (!this.faultedThisTick) this.compat.reportError(error);
      this.faultedThisTick = true;
    } else if (phase === 'render') {
      if (!this.faultedThisRender) this.compat.reportError(error);
      this.faultedThisRender = true;
    } else this.compat.reportError(error);
    // A listener that throws while hearing about a fault must not make things worse.
    try {
      this.events.emit('fault', scene, error);
    } catch (e) {
      console.error('[sje] a fault listener threw:', e);
    }
  }
}
