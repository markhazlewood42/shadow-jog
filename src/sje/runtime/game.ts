/**
 * Game: the top object (docs/engine/interfaces.md section 1, frame-and-rendering.md sections 1 to 3).
 * Follows: Phaser `Game`. It is created with `await Game.create(config)` because Pixi's `init` is async.
 *
 * It owns the loop, the scene stack, the texture store, the screen root and the renderer.
 *
 * One TICK (`advanceTick`), in the design's order:
 *   1. `prestep` then `step` events (with the tick that is ending).
 *   2. The tick counter goes up.
 *   3. The scenes run, top first (`SceneManager.tick`).
 *   4. `poststep` event.
 * One DRAW (`draw`):
 *   1. `prerender` event, then each scene's `prerender` and the camera transforms.
 *   2. The renderer draws the screen into the back buffer and presents it.
 *   3. `postrender` event.
 * The tick changes state. The draw only reads it.
 *
 * A throw in a scene or a handler is reported (`console.error` and the `fault` event) and the loop
 * carries on. Counting faults to a limit and recovering to the title is M1 (the old engine's FAULT_LIMIT).
 *
 * Built later (M1): input, audio bridge, `fx`, `scale` (Display), `wait` and `waitMs`, fades, the
 * game-level `shake` and `flash`, the 250 ms hidden-tab handling beyond the loop's clamp, `cache`, `registry`.
 */
import { EventEmitter } from '../core/eventemitter';
import { FixedLoop, type FixedLoopOptions } from '../core/fixedloop';
import { Screen } from '../display/screen';
import type { DisplayHost } from '../display/gameobject';
import { TextureManager } from '../display/texturemanager';
import { type FrameRenderer, GlRenderer } from './glrenderer';
import { type AnyScene, SceneManager } from './scenemanager';
import type { Scene } from './scene';

export interface GameConfig {
  /** Where the canvas goes. */
  parent: HTMLElement;
  /** Dev builds: the lab hook, extra checks. Not used by the engine yet. @ours */
  dev?: boolean;
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
  textures?: TextureManager;
  loop?: FixedLoopOptions;
}

export class Game implements DisplayHost {
  readonly events = new EventEmitter<GameEvents>();
  readonly textures: TextureManager;
  readonly screen: Screen;
  readonly scene: SceneManager;
  readonly renderer: FrameRenderer;
  /** The tick counter. It goes up by one per tick (today's `frame`). */
  tick = 0;
  private readonly loop: FixedLoop;

  constructor(parts: GameParts) {
    this.renderer = parts.renderer;
    this.textures = parts.textures ?? new TextureManager();
    this.screen = new Screen(this);
    this.scene = new SceneManager(this, this.screen, (scene, error) => this.reportFault(scene, error));
    this.loop = new FixedLoop({ tick: () => this.advanceTick(), draw: (alpha) => this.draw(alpha), onError: (e) => this.reportFault(null, e) }, parts.loop);
  }

  /**
   * Make the canvas, the WebGL2 context and the Pixi renderer, and a game on top of them.
   * Rejects with a plain message when the browser has no WebGL2 (the page shows it as "failed to start").
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
    const game = new Game({ renderer });
    renderer.glc.on('lost', () => game.events.emit('contextlost'));
    renderer.glc.on('restored', () => game.events.emit('contextrestored'));
    return game;
  }

  /** Ticks per loop step. Debug and tests only. */
  get speed(): number {
    return this.loop.speed;
  }
  set speed(v: number) {
    this.loop.speed = v;
  }

  /** True while the WebGL context is lost (nothing can be drawn). */
  get contextLost(): boolean {
    return this.renderer.contextLost === true;
  }

  /** How many times the scene stack was dropped (`abandon` or `reset`). See `SceneManager.dropCount`. */
  get dropCount(): number {
    return this.scene.dropCount;
  }

  get top(): AnyScene | undefined {
    return this.scene.top;
  }

  /**
   * Push a scene and wait for it. `init`, `preload` and `create` run in THIS call. The promise
   * resolves when the scene calls `close(result)`, and only then. @deviation Phaser's `run` does not wait.
   */
  run<R>(scene: Scene<R>, data?: unknown): Promise<R> {
    return this.scene.push(scene, data);
  }

  /** Replace the whole stack with one scene. The old scenes' promises stay pending. */
  reset<R>(scene: Scene<R>, data?: unknown): Promise<R> {
    return this.scene.reset(scene, data);
  }

  /** Drop every scene without resolving it, so a story flow waiting on one stops dead. */
  abandon(): void {
    this.scene.abandon();
  }

  /** Start the real loop (`requestAnimationFrame`). */
  start(): void {
    this.loop.start();
  }

  stop(): void {
    this.loop.stop();
  }

  /** One fixed tick. The loop calls this; so does `step`. */
  advanceTick(): void {
    this.guard(null, () => {
      this.events.emit('prestep', this.tick);
      this.events.emit('step', this.tick);
    });
    this.tick++;
    this.scene.tick(this.tick);
    this.guard(null, () => this.events.emit('poststep', this.tick));
  }

  /** The draw phase: scene `prerender` handlers and camera transforms, then draw and present. */
  draw(alpha = 0): void {
    this.guard(null, () => this.events.emit('prerender', alpha));
    this.guard(null, () => this.scene.prerender());
    this.guard(null, () => this.renderer.render(this.screen));
    this.guard(null, () => this.events.emit('postrender'));
  }

  /**
   * Run `n` ticks with no real time passing, then draw one frame. The dev and test hook
   * (`__SJ__.step` in the design): the same tick count always gives the same picture.
   */
  step(n: number): void {
    for (let i = 0; i < n; i++) this.advanceTick();
    this.draw(0);
  }

  /** Dev and tests only: stop, drop the scenes, free the renderer. Production never destroys the renderer. */
  destroyForTests(): void {
    this.stop();
    this.abandon();
    if (this.renderer instanceof GlRenderer) this.renderer.destroy();
  }

  private reportFault(scene: AnyScene | null, error: unknown): void {
    console.error(`[sje] ${scene ? `scene ${scene.key}` : 'game'} threw:`, error);
    // A listener that throws while hearing about a fault must not make things worse.
    try {
      this.events.emit('fault', scene, error);
    } catch (e) {
      console.error('[sje] a fault listener threw:', e);
    }
  }

  private guard(scene: AnyScene | null, fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.reportFault(scene, e);
    }
  }
}
