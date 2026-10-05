/**
 * SceneManager: the stack of scenes (docs/engine/frame-and-rendering.md sections 2 and 4,
 * scene-graph.md section 6). Follows: Phaser `ScenePlugin` (the stack idea); the promise from
 * `run` is ours (@deviation 2 in conventions.md: Phaser's `run` does not wait).
 *
 * What it does:
 *  - `push` runs a scene's lifecycle (`init`, `preload`, `create`) AT ONCE, in the same call, and
 *    gives back a promise that resolves only when that scene calls `close(result)`.
 *  - `remove` (what `close` calls) pops a scene, frees it, wakes the one below, and the scene's
 *    promise resolves AFTER all of that.
 *  - `tick` runs `fixedUpdate` on the scenes, top first, as far down as `passUpdate` allows.
 *  - `refreshLayout` decides which scenes are drawn (opaque and curtain rules) and parents their
 *    containers under the screen's roots.
 *
 * A promise whose scene ends any other way (`abandon`, `reset`) stays pending FOREVER. That is
 * intended: it is what `abandon()` means. The story flow that awaited it stops dead instead of
 * resuming on top of whatever runs next.
 *
 * Not built yet (M1): the Phaser scene operations (`launch`, `pause`, `sleep`, `switch`...), which
 * Phaser queues to the next step.
 */
import { Container } from '../display/container';
import type { Screen, ScreenSlot } from '../display/screen';
import type { Game } from './game';
import type { Scene } from './scene';

// biome-ignore lint/suspicious/noExplicitAny: the stack holds scenes of every result type; each run() is typed at its call site.
export type AnyScene = Scene<any>;

/** What the manager needs to tell the game about a throw. */
export type FaultReporter = (scene: AnyScene, error: unknown) => void;

/**
 * Which scenes are drawn. Fills `out` (one boolean per scene) and returns the index of the BASE
 * scene: the topmost opaque one, or the bottom scene. This is today's rule from
 * `src/engine/game.ts` `render`:
 *  - The base is drawn. Scenes below it are not (they stay alive).
 *  - Only the topmost CURTAIN draws over the base. Scenes between the base and that curtain are
 *    hidden: a menu it was opened from is not repainted beneath it.
 *  - If there is no curtain, every scene from the base up is drawn.
 */
export function computeVisibility(scenes: readonly { opaque: boolean; curtain: boolean }[], out: boolean[] = []): number {
  const n = scenes.length;
  out.length = n;
  let base = n - 1;
  while (base > 0 && !scenes[base]?.opaque) base--;
  let curtain = n - 1;
  while (curtain > base && !scenes[curtain]?.curtain) curtain--;
  for (let i = 0; i < n; i++) out[i] = i >= base && !(i > base && i < curtain);
  return Math.max(0, base);
}

export class SceneManager {
  private readonly stack: AnyScene[] = [];
  // The last layout, kept so `refreshLayout` only touches the screen when something changed.
  private lastScenes: AnyScene[] = [];
  private readonly visible: boolean[] = [];
  private lastVisible: boolean[] = [];
  private lastBase = -1;

  constructor(
    private readonly game: Game,
    private readonly screen: Screen,
    private readonly fault: FaultReporter,
  ) {}

  get scenes(): readonly AnyScene[] {
    return this.stack;
  }

  get top(): AnyScene | undefined {
    return this.stack[this.stack.length - 1];
  }

  /** Phaser: scene.get(key). The key is the generated `Scene.key`. */
  get(key: string): AnyScene | undefined {
    return this.stack.find((s) => s.key === key);
  }

  /**
   * Push a scene and run its lifecycle at once. If `init`, `preload` or `create` throws, the scene
   * is removed again and the returned promise REJECTS with the error (the stack stays clean).
   */
  push<R>(scene: Scene<R>, data?: unknown): Promise<R> {
    return new Promise<R>((resolve) => {
      const world = new Container(scene, 0, 0, `${scene.key} world`);
      const ui = new Container(scene, 0, 0, `${scene.key} ui`);
      scene._attach(this.game, world, ui, resolve);
      const below = this.top;
      this.stack.push(scene);
      this.guard(below, () => below?.events.emit('pause'));
      this.refreshLayout();
      const sys = scene.sys;
      try {
        sys.status = 'start';
        scene.init?.(data);
        scene.preload?.();
        // There is no loader yet, so nothing is ever waiting: `create` runs straight away.
        sys.status = 'creating';
        scene.create?.(data);
        scene.events.emit('create');
      } catch (e) {
        this.discard(scene);
        throw e;
      }
      // `create` may have closed the scene already. Only a scene still being created starts running.
      if (sys.status === 'creating') sys.status = 'running';
    });
  }

  /**
   * Pop a scene, free it, wake the one below. Called by `Scene.close`. The order is: stack change,
   * `shutdown` event and freeing, layout, `resume` event on the new top. The caller resolves the
   * promise after this returns.
   */
  remove(scene: AnyScene): void {
    const i = this.stack.indexOf(scene);
    if (i < 0) return;
    this.stack.splice(i, 1);
    // A scene's cleanup throwing must not leave the stack half changed: report it and carry on.
    this.guard(scene, () => scene._teardown());
    this.refreshLayout();
    const top = this.top;
    if (top) this.guard(top, () => top.events.emit('resume'));
  }

  /** Replace the whole stack with one scene. Pending promises of the old scenes stay pending. */
  reset<R>(scene: Scene<R>, data?: unknown): Promise<R> {
    this.clear();
    return this.push(scene, data);
  }

  /** Drop every scene without resolving them, so a story waiting on any of them stops dead. */
  abandon(): void {
    this.clear();
    this.refreshLayout();
  }

  /**
   * One tick for the scenes: top first. The top always runs. A scene below runs only while every
   * scene above it passes updates (`passUpdate`); otherwise it is `paused`.
   */
  tick(tick: number): void {
    let passing = true;
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const s = this.stack[i];
      if (!s || s.closed) continue;
      const sys = s.sys;
      if (!passing) {
        if (sys.status === 'running') sys.status = 'paused';
        continue;
      }
      if (sys.status === 'paused') sys.status = 'running';
      if (sys.status === 'running') {
        this.guard(s, () => {
          s.events.emit('preupdate', tick);
          s.fixedUpdate(tick);
          s.events.emit('update', tick);
          s.events.emit('postupdate', tick);
        });
      }
      passing = s.passUpdate;
    }
  }

  /** The draw phase for the scenes, bottom first: their `prerender` handlers, then the camera transforms. */
  prerender(): void {
    for (let i = 0; i < this.stack.length; i++) {
      const s = this.stack[i];
      if (!s || s.closed) continue;
      this.guard(s, () => s.events.emit('prerender'));
      s.cameras.apply();
    }
    this.refreshLayout();
  }

  /** Recompute which scenes are drawn and, only if that changed, parent their containers under the screen roots. */
  refreshLayout(): void {
    const base = computeVisibility(this.stack, this.visible);
    let changed = base !== this.lastBase || this.stack.length !== this.lastScenes.length;
    for (let i = 0; !changed && i < this.stack.length; i++) {
      changed = this.stack[i] !== this.lastScenes[i] || this.visible[i] !== this.lastVisible[i];
    }
    if (!changed) return;
    this.lastBase = base;
    this.lastScenes = [...this.stack];
    this.lastVisible = [...this.visible];
    const slots: ScreenSlot[] = this.stack.map((s, i) => {
      const visible = this.visible[i] === true;
      s.sys.visible = visible;
      return { world: s.sys.world, ui: s.sys.ui, visible, base: i === base };
    });
    this.screen.layout(slots);
  }

  /** Mark every scene closed and free it, newest first, reporting (not throwing) any failure. */
  private clear(): void {
    for (const s of [...this.stack].reverse()) {
      s.closed = true;
      this.guard(s, () => s._teardown());
    }
    this.stack.length = 0;
  }

  /** A scene whose lifecycle threw: take it off the stack and free it. */
  private discard(scene: AnyScene): void {
    scene.closed = true;
    const i = this.stack.indexOf(scene);
    if (i >= 0) this.stack.splice(i, 1);
    this.guard(scene, () => scene._teardown());
    this.refreshLayout();
  }

  /** Run `fn`; a throw goes to the game's fault reporter instead of out of the loop. */
  private guard(scene: AnyScene | undefined, fn: () => void): void {
    if (!scene) return;
    try {
      fn();
    } catch (e) {
      this.fault(scene, e);
    }
  }
}
