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
 * Built later (M1, on demand): `input`, `load`, `time`, `tweens`, `lights`. `preload()` is called
 * but there is no loader yet, so `create` always runs straight after it.
 */
import { must } from '../core/assert';
import { EventEmitter } from '../core/eventemitter';
import { CameraManager } from '../display/camera';
import type { Container } from '../display/container';
import type { DisplayHost, GameObject } from '../display/gameobject';
import type { TextureManager } from '../display/texturemanager';
import type { Game } from './game';
import { GameObjectFactory } from './gameobjectfactory';

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
  /** Generated for a scene that runs through `game.run`. @ours */
  readonly key: string = `scene-${nextKey++}`;
  /** When true, scenes below this one are not drawn. They stay alive. */
  opaque = true;
  /**
   * A full-screen menu that dims what is under it. Only the topmost curtain draws over the world:
   * menus it was opened from are not repainted beneath it. @ours
   */
  curtain = false;
  /** When true, the scene below keeps running `fixedUpdate` (ambient animation under a dialog). @ours */
  passUpdate = false;

  private _game: Game | null = null;
  private _sys: Systems | null = null;
  private _add: GameObjectFactory | null = null;
  private _cameras: CameraManager | null = null;
  private _events: EventEmitter<SceneEvents> | null = null;
  private abort: AbortController | null = null;
  private resolver: ((result: R) => void) | null = null;
  /** @internal True once `close` ran (or the scene was torn down another way). */
  closed = false;

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

  // ---- engine side -----------------------------------------------------------------------------

  /** @internal Build the scene's systems and tie it to a game. Called once by `SceneManager`. */
  _attach(game: Game, world: Container, ui: Container, resolve: (result: R) => void): void {
    this._game = game;
    this.resolver = resolve;
    this.abort = new AbortController();
    this._events = new EventEmitter<SceneEvents>();
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
    if (!sys || sys.status === 'destroyed') return;
    sys.status = 'shutdown';
    this.abort?.abort();
    try {
      this._events?.emit('shutdown');
    } finally {
      // A shutdown listener that throws must not leave the scene half freed.
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
