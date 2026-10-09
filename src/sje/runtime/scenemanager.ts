/**
 * SceneManager: the stack of scenes (docs/engine/frame-and-rendering.md sections 2 and 4,
 * scene-graph.md section 6). Follows: Phaser `ScenePlugin` (the operations); the promise from
 * `run` is ours (@deviation 2 in conventions.md: Phaser's `run` does not wait).
 *
 * What it does:
 *  - `push` runs a scene's lifecycle (`init`, `preload`, `create`) AT ONCE, in the same call, and
 *    gives back a promise that resolves only when that scene calls `close(result)`. If `preload` queued
 *    files, the scene is `loading` and `create` runs when they are in.
 *  - `remove` (what `close` calls) pops a scene, frees it, wakes the one below, and the scene's
 *    promise resolves AFTER all of that. The order is the one the old engine had: the stack changes,
 *    the scene's `shutdown` runs (its `exit`), input is consumed, the layout updates, the scene below
 *    hears `resume` (only if a `push` paused it), and only then does the promise resolve.
 *  - `tick` runs `fixedUpdate` on the scenes, top first, as far down as `passUpdate` allows.
 *  - `refreshLayout` decides which scenes are drawn (opaque and curtain rules) and parents their
 *    containers under the screen's roots.
 *
 * The Phaser operations (`add`, `launch`, `run`, `pause`, `resume`, `sleep`, `wake`, `stop`, `switch`) are
 * QUEUED and applied at the start of the next tick, as in Phaser (the verified-conventions.md row on
 * `ScenePlugin`). `game.run(scene)` is the exception: it pushes at once, because a story script `await`s it.
 * The ones Phaser has and we do not (`start`, `remove`, `bringToTop`, `moveAbove`, `setActive`, `setVisible`)
 * are absent from the type.
 *
 * A promise whose scene ends any other way (`abandon`, `reset`, `stop`) stays pending FOREVER. That is
 * intended: it is what `abandon()` means. The story flow that awaited it stops dead instead of
 * resuming on top of whatever runs next.
 */
import { Container } from '../display/container';
import type { Screen, ScreenSlot } from '../display/screen';
import type { Game } from './game';
import type { Scene } from './scene';

// biome-ignore lint/suspicious/noExplicitAny: the stack holds scenes of every result type; each run() is typed at its call site.
export type AnyScene = Scene<any>;

/** Where a throw happened: a tick, the draw phase, or anywhere else (a cleanup, a resume). */
export type FaultPhase = 'tick' | 'render' | 'other';

/** What the manager needs to tell the game about a throw. */
export type FaultReporter = (scene: AnyScene | null, error: unknown, phase: FaultPhase) => void;

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

type Op =
  | { kind: 'launch' | 'run'; key: string; data?: unknown }
  | { kind: 'pause' | 'resume' | 'sleep' | 'wake' | 'stop'; key: string }
  | { kind: 'switch'; from: string; to: string };

interface Registered {
  cls: new () => AnyScene;
  scene: AnyScene;
}

export class SceneManager {
  private readonly stack: AnyScene[] = [];
  // The last layout, kept so `refreshLayout` only touches the screen when something changed.
  private lastScenes: AnyScene[] = [];
  private readonly visible: boolean[] = [];
  private lastVisible: boolean[] = [];
  private lastBase = -1;
  private readonly awake: AnyScene[] = [];
  private readonly awakeVisible: boolean[] = [];
  // Scenes that a `push` paused and that have not been resumed yet.
  private paused = new WeakSet<AnyScene>();
  private readonly registry = new Map<string, Registered>();
  private queue: Op[] = [];

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

  /** The base of the picture: the topmost opaque scene that is awake (or the bottom one). Undefined with no scene. */
  get base(): AnyScene | undefined {
    return this.stack[this.lastBase];
  }

  /** The topmost scene that is drawn, or undefined. */
  get topVisible(): AnyScene | undefined {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const s = this.stack[i];
      if (s?.sys.visible) return s;
    }
    return undefined;
  }

  /** Phaser: scene.get(key). A scene on the stack, or one made with `add` that is not running. */
  get(key: string): AnyScene | undefined {
    return this.stack.find((s) => s.key === key) ?? this.registry.get(key)?.scene;
  }

  // ---- Phaser's scene operations (queued to the next tick) ----------------------------------------

  /**
   * Phaser: scene.add(key, sceneClass, autoStart, data). Makes the scene object now and names it `key`. With `autoStart` it
   * launches on the next tick.
   */
  add(key: string, cls: new () => AnyScene, autoStart = false, data?: unknown): AnyScene {
    if (this.registry.has(key) || this.stack.some((s) => s.key === key)) throw new Error(`SceneManager.add: a scene named "${key}" exists already`);
    const scene = new cls();
    scene._rename(key);
    this.registry.set(key, { cls, scene });
    if (autoStart) this.launch(key, data);
    return scene;
  }

  /** Phaser: launch. Start the scene on top of the others. A scene that is already running is left alone. */
  launch(key: string, data?: unknown): void {
    this.queue.push({ kind: 'launch', key, data });
  }

  /** Phaser: ScenePlugin.run. Start the scene, or wake it if it sleeps, or resume it if it is paused. */
  run(key: string, data?: unknown): void {
    this.queue.push({ kind: 'run', key, data });
  }

  /** Phaser: pause. The scene stops updating and is still drawn. */
  pause(key: string): void {
    this.queue.push({ kind: 'pause', key });
  }

  resume(key: string): void {
    this.queue.push({ kind: 'resume', key });
  }

  /** Phaser: sleep. The scene stops updating and is not drawn. */
  sleep(key: string): void {
    this.queue.push({ kind: 'sleep', key });
  }

  wake(key: string): void {
    this.queue.push({ kind: 'wake', key });
  }

  /** Phaser: stop. The scene shuts down and leaves the stack. Its `game.run` promise stays pending (only `close` resolves it). */
  stop(key: string): void {
    this.queue.push({ kind: 'stop', key });
  }

  /** Phaser: switch. Sleep `from`, then run `to`. */
  switch(from: string, to: string): void {
    this.queue.push({ kind: 'switch', from, to });
  }

  /** Apply the queued operations, oldest first. An operation that fails is reported and does not stop the rest. */
  private flushOps(): void {
    if (this.queue.length === 0) return;
    const ops = this.queue;
    this.queue = [];
    for (const op of ops) {
      try {
        this.apply(op);
      } catch (e) {
        this.fault(null, e, 'other');
      }
    }
  }

  private apply(op: Op): void {
    switch (op.kind) {
      case 'launch':
        this.startKey(op.key, op.data);
        return;
      case 'run': {
        const s = this.stack.find((x) => x.key === op.key);
        if (!s) this.startKey(op.key, op.data);
        else if (s._hold === 'sleeping') this.doWake(s);
        else if (s._hold === 'paused') this.doResume(s);
        return;
      }
      case 'pause': {
        const s = this.stack.find((x) => x.key === op.key);
        if (s && s._hold === 'none') {
          s._hold = 'paused';
          s.sys.status = 'paused';
          this.guard(s, () => s.events.emit('pause'));
        }
        return;
      }
      case 'resume': {
        const s = this.stack.find((x) => x.key === op.key);
        if (s && s._hold === 'paused') this.doResume(s);
        return;
      }
      case 'sleep': {
        const s = this.stack.find((x) => x.key === op.key);
        if (s && s._hold !== 'sleeping') {
          s._hold = 'sleeping';
          s.sys.status = 'sleeping';
          this.guard(s, () => s.events.emit('sleep'));
          this.refreshLayout();
        }
        return;
      }
      case 'wake': {
        const s = this.stack.find((x) => x.key === op.key);
        if (s && s._hold === 'sleeping') this.doWake(s);
        return;
      }
      case 'stop': {
        const s = this.stack.find((x) => x.key === op.key);
        if (s) {
          // Not `close`: nothing resolves. The promise of `game.run` stays pending, like `abandon`.
          s.closed = true;
          this.remove(s);
        }
        return;
      }
      case 'switch':
        this.apply({ kind: 'sleep', key: op.from });
        this.apply({ kind: 'run', key: op.to });
        return;
    }
  }

  private doResume(s: AnyScene): void {
    s._hold = 'none';
    s.sys.status = 'running';
    this.guard(s, () => s.events.emit('resume'));
  }

  private doWake(s: AnyScene): void {
    s._hold = 'none';
    s.sys.status = 'running';
    this.guard(s, () => s.events.emit('wake'));
    this.refreshLayout();
  }

  /** `launch` and `run` for a key made with `add`: a scene object runs once, so a second start builds a new one from the class. */
  private startKey(key: string, data: unknown): void {
    if (this.stack.some((s) => s.key === key)) return;
    const reg = this.registry.get(key);
    if (!reg) throw new Error(`SceneManager: no scene named "${key}" (add it first)`);
    let scene = reg.scene;
    if (scene.closed || scene.attached) {
      scene = new reg.cls();
      scene._rename(key);
      reg.scene = scene;
    }
    // A failure here is reported by the fault reporter, not thrown out of the tick.
    this.push(scene, data).catch((e) => this.fault(scene, e, 'other'));
  }

  // ---- the stack ------------------------------------------------------------------------------------

  /**
   * Push a scene and run its lifecycle at once. If `init`, `preload` or `create` throws, the scene
   * is removed again and the returned promise REJECTS with the error (the stack stays clean).
   */
  push<R>(scene: Scene<R>, data?: unknown): Promise<R> {
    // A scene object is single use. Running one again would reuse a destroyed display list (closed)
    // or put one scene on the stack twice (live). Say so at once, with a clear message.
    const refusal = this.reuseProblem(scene);
    if (refusal) return Promise.reject(new Error(refusal));
    return new Promise<R>((resolve, reject) => {
      const world = new Container(scene, 0, 0, `${scene.key} world`);
      const ui = new Container(scene, 0, 0, `${scene.key} ui`);
      scene._attach(this.game, world, ui, resolve);
      const below = this.top;
      this.stack.push(scene);
      if (below) {
        // Remember WHO was paused, so `resume` goes to exactly that scene and to no other.
        this.paused.add(below);
        this.guard(below, () => below.events.emit('pause'));
      }
      this.game.input.consume();
      this.refreshLayout();
      const sys = scene.sys;
      try {
        sys.status = 'start';
        // Any step may close the scene (`close()` inside `init`, say). A closed scene has been torn
        // down already, so the steps after it must not run.
        scene.init?.(data);
        if (scene.closed) return;
        scene.preload?.();
        if (scene.closed) return;
        if (scene.load.pending) {
          // Files are on their way. The scene is on the stack but does not update until they are in.
          sys.status = 'loading';
          scene.load.once('complete', () => this.finishCreate(scene, data, reject));
          scene.load.start();
          return;
        }
        this.create(scene, data);
      } catch (e) {
        this.discard(scene);
        reject(e);
      }
    });
  }

  /** The load is done (or there was none). Runs inside `push`'s try for the first, and as a load callback for the second. */
  private finishCreate(scene: AnyScene, data: unknown, reject: (e: unknown) => void): void {
    if (scene.closed) return;
    try {
      this.create(scene, data);
    } catch (e) {
      this.discard(scene);
      reject(e);
    }
  }

  private create(scene: AnyScene, data: unknown): void {
    const sys = scene.sys;
    sys.status = 'creating';
    scene.create?.(data);
    if (scene.closed) return;
    scene.events.emit('create');
    // `create` may have closed the scene already. Only a scene still being created starts running.
    if (sys.status === 'creating') sys.status = scene._hold === 'sleeping' ? 'sleeping' : scene._hold === 'paused' ? 'paused' : 'running';
  }

  /**
   * Pop a scene, free it, wake the one below. Called by `Scene.close`. The order is: stack change,
   * `shutdown` event and freeing, input consumed, layout, `resume` event on the scene that was paused. The caller
   * resolves the promise after this returns.
   */
  remove(scene: AnyScene): void {
    const i = this.stack.indexOf(scene);
    if (i < 0) return;
    this.stack.splice(i, 1);
    this.paused.delete(scene);
    // A scene's cleanup throwing must not leave the stack half changed: report it and carry on.
    this.guard(scene, () => scene._teardown(), 'other');
    this.game.input.consume();
    this.refreshLayout();
    this.resumeTop();
  }

  /** Replace the whole stack with one scene. Pending promises of the old scenes stay pending. */
  reset<R>(scene: Scene<R>, data?: unknown): Promise<R> {
    // Check BEFORE clearing: a refused scene must not cost the player the screen they were on.
    const refusal = this.reuseProblem(scene);
    if (refusal) return Promise.reject(new Error(refusal));
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
   * scene above it passes updates (`passUpdate`); otherwise it is `paused`. A scene put to sleep or
   * paused with the Phaser operations is skipped.
   */
  tick(tick: number): void {
    this.flushOps();
    let passing = true;
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const s = this.stack[i];
      if (!s || s.closed) continue;
      if (s._hold === 'sleeping') continue;
      const sys = s.sys;
      if (!passing) {
        if (sys.status === 'running') sys.status = 'paused';
        continue;
      }
      if (s._hold === 'none' && sys.status === 'paused') sys.status = 'running';
      if (sys.status === 'running') {
        this.guard(s, () => {
          s.events.emit('preupdate', tick);
          s.time.update();
          s.tweens.update();
          s.fixedUpdate(tick);
          s.events.emit('update', tick);
          s.events.emit('postupdate', tick);
          s.cameras.update();
        });
      }
      passing = s.passUpdate;
    }
  }

  /** The draw phase for the scenes, bottom first: their `prerender` handlers, then the camera transforms. Hidden scenes are skipped. */
  prerender(): void {
    this.refreshLayout();
    for (let i = 0; i < this.stack.length; i++) {
      const s = this.stack[i];
      if (!s || s.closed || !s.sys.visible) continue;
      this.guard(s, () => s.events.emit('prerender'), 'render');
      // A prerender handler may have closed its own scene (a 3D scene that lost its context does).
      // Its display list is destroyed by now, so there is no camera to apply.
      if (s.closed) continue;
      this.guard(s, () => s.cameras.apply(), 'render');
    }
    this.refreshLayout();
  }

  /** Recompute which scenes are drawn and, only if that changed, parent their containers under the screen roots. */
  refreshLayout(): void {
    const n = this.stack.length;
    // A sleeping scene takes no part: it is not drawn, and it does not count as a base or a curtain.
    this.awake.length = 0;
    for (let i = 0; i < n; i++) {
      const s = this.stack[i];
      if (s && s._hold !== 'sleeping') this.awake.push(s);
    }
    const baseAwake = computeVisibility(this.awake, this.awakeVisible);
    const base = this.awake.length === 0 ? -1 : this.stack.indexOf(this.awake[baseAwake] as AnyScene);
    this.visible.length = n;
    let a = 0;
    for (let i = 0; i < n; i++) {
      const s = this.stack[i];
      this.visible[i] = !!s && s._hold !== 'sleeping' && this.awakeVisible[a++] === true;
    }
    let changed = base !== this.lastBase || n !== this.lastScenes.length;
    for (let i = 0; !changed && i < n; i++) {
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

  /**
   * How many times the whole stack has been dropped (`abandon` and `reset`). Code that waits for
   * something slow (the 3D chunk loads) reads it before and after, to learn that the stack it meant
   * to put a scene on is gone.
   */
  get dropCount(): number {
    return this.drops;
  }
  private drops = 0;

  /** Mark every scene closed and free it, newest first, reporting (not throwing) any failure. */
  private clear(): void {
    this.drops++;
    this.queue = [];
    for (const s of [...this.stack].reverse()) {
      s.closed = true;
      this.guard(s, () => s._teardown(), 'other');
    }
    this.stack.length = 0;
    // Nothing is left to resume.
    this.paused = new WeakSet();
  }

  /** A scene whose lifecycle threw: take it off the stack, free it, and give the scene below its `resume` back. */
  private discard(scene: AnyScene): void {
    scene.closed = true;
    const i = this.stack.indexOf(scene);
    if (i >= 0) this.stack.splice(i, 1);
    this.paused.delete(scene);
    this.guard(scene, () => scene._teardown(), 'other');
    this.game.input.consume();
    this.refreshLayout();
    this.resumeTop();
  }

  /**
   * Send `resume` to the top scene, but ONLY if a `push` paused it. When a scene in the middle of
   * the stack closes, the top scene was never paused, so it must not hear `resume`.
   */
  private resumeTop(): void {
    const top = this.top;
    if (!top || !this.paused.delete(top)) return;
    this.guard(top, () => top.events.emit('resume'), 'other');
  }

  /** Why this scene object cannot run now, or null when it can. */
  private reuseProblem(scene: AnyScene): string | null {
    if (scene.closed) return `Scene ${scene.key} has already closed. A scene object runs once: make a new one for each run.`;
    if (this.stack.includes(scene) || scene.attached) return `Scene ${scene.key} is already running. A scene object runs once: make a new one for each run.`;
    return null;
  }

  /** Run `fn`; a throw goes to the game's fault reporter instead of out of the loop. */
  private guard(scene: AnyScene, fn: () => void, phase: FaultPhase = 'tick'): void {
    try {
      fn();
    } catch (e) {
      this.fault(scene, e, phase);
    }
  }
}
