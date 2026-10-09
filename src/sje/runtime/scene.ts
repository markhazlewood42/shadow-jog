/**
 * Scene: one whole screen state on the stack (docs/engine/interfaces.md section 2, scene-graph.md
 * sections 1 and 6, frame-and-rendering.md section 2).
 * Follows: Phaser `Scene`. In this engine "scene" always means a screen state, never a Unity level
 * file or a Godot node tree.
 *
 * A scene owns its display list (`sys.world` and `sys.ui`), its cameras, its events and an abort
 * signal. They all die with it.
 *
 * The lifecycle, in order (written as Phaser's names):
 *   `init(data)` -> `preload()` -> `create(data)` -> then `fixedUpdate(tick)` every tick.
 * `game.run(scene)` calls the first three at once, in the same call, and then returns a promise
 * that resolves when the scene calls `close(result)`.
 *
 * `preload()` fills `this.load`. If it queues nothing (or every key is cached), `create` runs at once, in the same call as
 * `game.run`; otherwise the scene is `loading` and `create` runs when the load completes (frame-and-rendering.md section 2).
 *
 * Built in M1: `input` (actions), `load`, `time` (Clock), `tweens`. Not built yet (on demand): `lights` (M5), `registry`.
 * A scene starts and stops through `SceneManager` (see its file for the Phaser operations).
 */
import { must } from '../core/assert';
import { EventEmitter } from '../core/eventemitter';
import { CameraManager } from '../display/camera';
import type { Container } from '../display/container';
import type { DisplayHost, GameObject } from '../display/gameobject';
import type { TextureManager } from '../display/texturemanager';
import { Clock } from './clock';
import type { Game } from './game';
import { GameObjectFactory } from './gameobjectfactory';
import type { SceneInput } from './input';
import { Loader } from './loader';
import { TweenManager } from './tween';

/** Phaser's event names. `preupdate`, `update` and `postupdate` fire per TICK. `prerender` fires per FRAME. */
export interface SceneEvents {
  create(): void;
  preupdate(tick: number): void;
  update(tick: number): void;
  postupdate(tick: number): void;
  prerender(): void;
  pause(): void;
  resume(): void;
  sleep(): void;
  wake(): void;
  shutdown(): void;
  destroy(): void;
}

export type SceneStatus = 'init' | 'start' | 'loading' | 'creating' | 'running' | 'paused' | 'sleeping' | 'shutdown' | 'destroyed';

/** A scene's display list, as Phaser's `scene.sys.displayList`. */
export interface DisplayList {
  readonly list: readonly GameObject[];
}

/** Phaser: `scene.sys`. The engine's own state for a scene. */
export interface Systems {
  /** The game's tick number (the same value `fixedUpdate` received last). */
  readonly tick: number;
  status: SceneStatus;
  /** Is the scene drawn right now? False under an opaque scene or under a curtain. */
  visible: boolean;
  readonly displayList: DisplayList;
  /** Moved by `cameras.main`. The engine parents it under the screen's `worldRoot` or `uiRoot`. */
  readonly world: Container;
  /** Never moved by a camera. The engine parents it under `uiRoot`. */
  readonly ui: Container;
}

let nextKey = 1;

export abstract class Scene<R = unknown> implements DisplayHost {
  private _key = `scene-${nextKey++}`;
  /** Generated for a scene that runs through `game.run`; the given name for one made with `scenes.add`. @ours */
  get key(): string {
    return this._key;
  }
  /** @internal `SceneManager.add` names the scene. */
  _rename(key: string): void {
    this._key = key;
  }
  private _opaque = true;
  private _curtain = false;
  private _passUpdate = false;

  /**
   * When true, scenes below this one are not drawn. They stay alive.
   * (An accessor, so the `LegacyScene` adapter can read the flag from the legacy scene it wraps.)
   */
  get opaque(): boolean {
    return this._opaque;
  }
  set opaque(v: boolean) {
    this._opaque = v;
  }
  /**
   * A full-screen menu that dims what is under it. Only the topmost curtain draws over the world:
   * menus it was opened from are not repainted beneath it. @ours
   */
  get curtain(): boolean {
    return this._curtain;
  }
  set curtain(v: boolean) {
    this._curtain = v;
  }
  /** When true, the scene below keeps running `fixedUpdate` (ambient animation under a dialog). @ours */
  get passUpdate(): boolean {
    return this._passUpdate;
  }
  set passUpdate(v: boolean) {
    this._passUpdate = v;
  }

  private _game: Game | null = null;
  private _sys: Systems | null = null;
  private _add: GameObjectFactory | null = null;
  private _cameras: CameraManager | null = null;
  private _events: EventEmitter<SceneEvents> | null = null;
  private _time: Clock | null = null;
  private _tweens: TweenManager | null = null;
  private _load: Loader | null = null;
  private _input: SceneInput | null = null;
  private abort: AbortController | null = null;
  private resolver: ((result: R) => void) | null = null;
  /** @internal True once `close` ran (or the scene was torn down another way). */
  closed = false;
  /** @internal Set by `pause` and `sleep` (Phaser's operations). The stack's own pausing (a scene under one that does not pass updates) is separate. */
  _hold: 'none' | 'paused' | 'sleeping' = 'none';

  /**
   * @internal Native scenes hear `resume` only when a `push` paused them (Phaser style). A LegacyScene overrides this to true: the old
   * `Game.remove` called `resume` on the top scene after ANY close, even a scene in the middle of the stack.
   */
  get resumesOnAnyClose(): boolean {
    return false;
  }

  /** @internal True once a `SceneManager` has attached this scene (it is running or was). */
  get attached(): boolean {
    return this._game !== null;
  }

  // ---- what a subclass writes ------------------------------------------------------------------

  init?(data: unknown): void;
  preload?(): void;
  /** Runs once, after `preload()`. Never async. */
  create?(data: unknown): void;
  /** The fixed 60 Hz tick. Change game state here. @deviation Phaser's `update` is variable. */
  abstract fixedUpdate(tick: number): void;
  /** There is no variable-delta `update`. Writing one is a compile error on purpose (decision E2). */
  update?: never;

  // ---- what the scene gets ---------------------------------------------------------------------

  get game(): Game {
    return must(this._game, `game for scene ${this.key} (it has not been run yet)`);
  }
  get sys(): Systems {
    return must(this._sys, `sys for scene ${this.key} (it has not been run yet)`);
  }
  get add(): GameObjectFactory {
    return must(this._add, `add for scene ${this.key} (it has not been run yet)`);
  }
  get cameras(): CameraManager {
    return must(this._cameras, `cameras for scene ${this.key} (it has not been run yet)`);
  }
  get events(): EventEmitter<SceneEvents> {
    return must(this._events, `events for scene ${this.key} (it has not been run yet)`);
  }
  /** Timers: `delayedCall`, `addEvent`, `wait`, `timeScale`. They die with the scene. */
  get time(): Clock {
    return must(this._time, `time for scene ${this.key} (it has not been run yet)`);
  }
  /** Property tweens. They die with the scene. */
  get tweens(): TweenManager {
    return must(this._tweens, `tweens for scene ${this.key} (it has not been run yet)`);
  }
  /** The loader. Fill it in `preload()`; `create` runs when it is done. */
  get load(): Loader {
    return must(this._load, `load for scene ${this.key} (it has not been run yet)`);
  }
  get input(): SceneInput {
    return must(this._input, `input for scene ${this.key} (it has not been run yet)`);
  }
  get textures(): TextureManager {
    return this.game.textures;
  }
  /** Aborts at shutdown. Use it for `fetch` and your own awaits. @ours */
  get signal(): AbortSignal {
    return must(this.abort, `signal for scene ${this.key} (it has not been run yet)`).signal;
  }

  /**
   * Pop this scene, resume the one below, and resolve the promise `game.run` returned with
   * `result`. Calling it twice does nothing.
   */
  close(result: R): void {
    if (this.closed) return;
    this.closed = true;
    this.game.scene.remove(this);
    this.resolver?.(result);
  }

  /** @internal Resolve the promise `game.run` gave back, without touching the stack. The legacy adapter needs this: the old `close` removes the scene itself. */
  _settle(result: R): void {
    this.resolver?.(result);
  }

  // ---- engine side -----------------------------------------------------------------------------

  /** @internal Build the scene's systems and tie it to a game. Called once by `SceneManager`. */
  _attach(game: Game, world: Container, ui: Container, resolve: (result: R) => void): void {
    this._game = game;
    this.resolver = resolve;
    this.abort = new AbortController();
    this._events = new EventEmitter<SceneEvents>();
    this._time = new Clock();
    this._tweens = new TweenManager();
    this._load = new Loader({ textures: game.textures, cache: game.cache, warn: (m) => game.warn(m), ...(game.loadBackend ? { backend: game.loadBackend } : {}) });
    this._input = { actions: game.actions };
    this._cameras = new CameraManager(world, ui);
    this._add = new GameObjectFactory(this, world, ui);
    this._sys = {
      get tick() {
        return game.tick;
      },
      status: 'init',
      visible: true,
      displayList: world,
      world,
      ui,
    };
  }

  /** @internal Shutdown: stop the signal, tell the listeners, free the display list, drop the listeners. */
  _teardown(): void {
    const sys = this._sys;
    if (!sys || sys.status === 'destroyed' || sys.status === 'shutdown') return;
    sys.status = 'shutdown';
    this.abort?.abort();
    try {
      this._events?.emit('shutdown');
    } finally {
      // A shutdown listener that throws must not leave the scene half freed. Timers, tweens and loads end here: their callbacks never run,
      // and every awaited promise of the engine rejects with `Cancelled`.
      this._time?.shutdown();
      this._tweens?.shutdown();
      this._load?.shutdown();
      sys.world.destroy();
      sys.ui.destroy();
      sys.status = 'destroyed';
      try {
        this._events?.emit('destroy');
      } finally {
        this._events?.removeAllListeners();
      }
    }
  }
}
