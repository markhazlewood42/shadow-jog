/**
 * Scene3D (docs/engine/m1b-brief.md tasks 2, 3 and 6; interfaces.md section 12), in plain Node: no browser, no GPU.
 *
 * The scene runs on a real `Game` with a renderer that draws nothing, and a FAKE `Frame3D` that records its calls (the `makeFrame` option of
 * `Scene3D`). So the lifecycle, the close order and the end-early paths are tested without a GL context. The real frame is tested in the
 * browser (e2e/sje-scene3d.spec.ts).
 *
 *  1. Lifecycle: `create3D`, then the frame, then the sprite in the display list; `fixedUpdate` is `update3D`; each draw is `sync3D` and then
 *     one `frame.render()`; shutdown frees the frame first and then the Three objects; nothing runs after the scene closed.
 *  2. Ending early: `endEarly` closes with `abortResult(reason)` once; a lost context ends the scene in the next draw with `context-lost`,
 *     releases Three's GPU data once, draws nothing more, and a restore after the end throws nothing.
 *  3. Failures of the subclass: an overridden `fixedUpdate`, a missing camera, a renderer that is not the GL one.
 *  4. The cube scene: `update3D` is pure and deterministic (the same tick count, however the draws fall).
 *  5. Mutants: the lifecycle checker must fail on a scene whose dispose is skipped and on one that overrides `fixedUpdate`.
 */
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera } from 'three';
import { Texture } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CubeScene } from '../src/sje-lab/cubescene';
import { H, W } from '../src/sje/core/size';
import type { DisplayHost } from '../src/sje/display/gameobject';
import { View3D } from '../src/sje/display/view3d';
import type { FrameTexture } from '../src/sje/render/frametexture';
import { Game } from '../src/sje/runtime/game';
import { Scene } from '../src/sje/runtime/scene';
import { type Frame3D, type HackResult, Scene3D, type Scene3DAbort, type Scene3DOptions } from '../src/sje/three';
import { noopInput } from './game-cases';

const noop = () => undefined;

/** Faults the game reported (a throw in a tick or a draw). Every test checks it stays empty. */
function newGame(faults: unknown[] = [], onRender: () => void = noop): Game {
  return new Game({ renderer: { render: onRender }, input: noopInput, compat: { reportError: (e) => faults.push(e) } });
}

// ---- a fake Frame3D that records ----------------------------------------------------------------------------

const fakeTexture: FrameTexture = { texture: Texture.EMPTY, width: W, height: H, flipY: true, destroy: noop };

class FakeFrame implements Frame3D {
  readonly mode = 'shared-context';
  readonly sprite: View3D;
  contextLost = false;
  renders = 0;
  released = 0;
  disposed = 0;
  constructor(
    host: DisplayHost,
    private readonly log: string[],
  ) {
    this.sprite = new View3D(host, fakeTexture);
  }
  render(): void {
    this.renders++;
    this.log.push('render');
  }
  rewrap(): void {}
  releaseGpuData(): void {
    this.released++;
    this.log.push('release');
  }
  privateContext(): WebGL2RenderingContext | null {
    return null;
  }
  readPixels(): { w: number; h: number; data: Uint8Array } {
    return { w: 0, h: 0, data: new Uint8Array(0) };
  }
  describe(): ReturnType<Frame3D['describe']> {
    return { mode: 'shared-context', width: W, height: H, minFilter: 'nearest', magFilter: 'nearest', rewraps: 0, hosts: { shared: 0, private: 0 } };
  }
  dispose(): void {
    this.disposed++;
    this.log.push('frame.dispose');
    this.sprite.destroy();
  }
}

/** What a test scene records: its calls in order, and the frame it was given. */
interface Probe {
  log: string[];
  frame: FakeFrame | null;
  aborts: Scene3DAbort[];
}
const newProbe = (): Probe => ({ log: [], frame: null, aborts: [] });
const makeFrameFor =
  (probe: Probe) =>
  (_setup: unknown, host: DisplayHost): Frame3D => {
    probe.log.push('makeFrame');
    probe.frame = new FakeFrame(host, probe.log);
    return probe.frame;
  };

class ProbeScene extends Scene3D<HackResult> {
  constructor(
    protected readonly probe: Probe,
    options: Scene3DOptions = {},
  ) {
    super({ makeFrame: makeFrameFor(probe), ...options });
  }
  create3D(): void {
    this.probe.log.push('create3D');
    const geometry = new BoxGeometry(1, 1, 1);
    geometry.addEventListener('dispose', () => this.probe.log.push('geometry.dispose'));
    this.world3D.add(new Mesh(geometry, new MeshBasicMaterial()));
    this.camera3D = new PerspectiveCamera();
  }
  update3D(tick: number): void {
    this.probe.log.push(`update3D ${tick}`);
  }
  sync3D(): void {
    this.probe.log.push('sync3D');
  }
  abortResult(reason: Scene3DAbort): HackResult {
    this.probe.aborts.push(reason);
    return { status: 'aborted', reason };
  }
}

// ---- 1. the lifecycle ---------------------------------------------------------------------------------------

describe('Scene3D lifecycle', () => {
  it('create3D, then the frame, then the sprite in the scene; each tick is update3D; each draw is sync3D then one render', async () => {
    const faults: unknown[] = [];
    const g = newGame(faults);
    const probe = newProbe();
    const scene = new ProbeScene(probe);
    const done = g.run(scene);
    expect(probe.log).toEqual(['create3D', 'makeFrame']);
    expect(scene.sys.world.list).toContain(probe.frame?.sprite);
    g.advanceTick();
    g.advanceTick();
    g.draw();
    // The tick number is the game's tick: the first tick a scene hears is 1.
    expect(probe.log.slice(2)).toEqual(['update3D 1', 'update3D 2', 'sync3D', 'render']);
    g.draw();
    expect(probe.log.slice(-2)).toEqual(['sync3D', 'render']);
    expect(probe.frame?.renders).toBe(2);
    scene.close({ status: 'success' });
    expect(await done).toEqual({ status: 'success' });
    expect(faults).toEqual([]);
  });

  it('shutdown frees the frame first (its sprite is destroyed, the texture goes after), then the geometry; once each', async () => {
    const g = newGame();
    const probe = newProbe();
    const scene = new ProbeScene(probe);
    const done = g.run(scene);
    const sprite = probe.frame?.sprite;
    expect(sprite?.destroyed).toBe(false);
    scene.close({ status: 'success' });
    await done;
    expect(probe.log.slice(-2)).toEqual(['frame.dispose', 'geometry.dispose']);
    expect(probe.frame?.disposed).toBe(1);
    expect(sprite?.destroyed).toBe(true);
    expect(g.scene.scenes).toHaveLength(0);
  });

  it('after the scene closed, ticks and draws do nothing to it', async () => {
    const g = newGame();
    const probe = newProbe();
    const scene = new ProbeScene(probe);
    const done = g.run(scene);
    scene.close({ status: 'success' });
    await done;
    const before = [...probe.log];
    g.advanceTick();
    g.draw();
    expect(probe.log).toEqual(before);
  });

  it('a second close is ignored, and the frame is freed once', async () => {
    const g = newGame();
    const probe = newProbe();
    const scene = new ProbeScene(probe);
    const done = g.run(scene);
    scene.close({ status: 'success' });
    scene.close({ status: 'fail' });
    expect(await done).toEqual({ status: 'success' });
    expect(probe.frame?.disposed).toBe(1);
  });
});

// ---- 2. ending early ----------------------------------------------------------------------------------------

describe('Scene3D ending early', () => {
  it('endEarly closes with abortResult(reason), once; the default reason is user', async () => {
    const g = newGame();
    const probe = newProbe();
    const scene = new ProbeScene(probe);
    const done = g.run(scene);
    scene.endEarly();
    scene.endEarly('error');
    expect(await done).toEqual({ status: 'aborted', reason: 'user' });
    expect(probe.aborts).toEqual(['user']);
    expect(probe.frame?.disposed).toBe(1);
    expect(probe.log.slice(-2)).toEqual(['frame.dispose', 'geometry.dispose']);
  });

  it('an early end from the scene itself carries the reason it was given (error)', async () => {
    const g = newGame();
    const probe = newProbe();
    const scene = new ProbeScene(probe);
    const done = g.run(scene);
    scene.endEarly('error');
    expect(await done).toEqual({ status: 'aborted', reason: 'error' });
  });
});

// ---- 2b. the context grace (decision C4 and D3 of docs/engine/m7-brief.md) --------------------------------------------------------------------------

describe('Scene3D context grace: a lost context gets 1 second to come back', () => {
  afterEach(() => vi.useRealTimers());

  /** A running scene on a fake frame, and a way to lose and restore the context the way the browser does (the frame flag and the game events together). */
  function rig(options: Scene3DOptions = {}) {
    vi.useFakeTimers();
    const faults: unknown[] = [];
    const g = newGame(faults);
    const probe = newProbe();
    const scene = new ProbeScene(probe, options);
    let result: HackResult | null = null;
    void g.run(scene).then((r) => {
      result = r;
    });
    const lose = (): void => {
      if (probe.frame) probe.frame.contextLost = true;
      g.events.emit('contextlost');
    };
    const restore = (): void => {
      if (probe.frame) probe.frame.contextLost = false;
      g.events.emit('contextrestored');
    };
    return { g, probe, scene, faults, lose, restore, result: () => result };
  }

  it('a loss: Three forgets its GPU data once, draws stop, the sim keeps ticking, and nothing ends inside the event or the draw', () => {
    const r = rig();
    r.g.draw();
    expect(r.probe.frame?.renders).toBe(1);
    r.lose();
    r.g.events.emit('contextlost');
    expect(r.probe.frame?.released).toBe(1);
    expect(r.scene.closed).toBe(false);
    r.g.advanceTick();
    r.g.draw();
    r.g.draw();
    // A draw after the loss makes no sync3D and no frame.render (every GL call would be a no-op), and the scene is still there.
    expect(r.probe.frame?.renders).toBe(1);
    expect(r.scene.closed).toBe(false);
    expect(r.probe.log).toContain('update3D 1');
    expect(r.faults).toEqual([]);
  });

  it('the scene ends with context-lost exactly 1000 ms after the loss, not before (D3 option A)', async () => {
    const r = rig();
    r.lose();
    r.g.draw();
    vi.advanceTimersByTime(999);
    expect(r.scene.closed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(r.scene.closed).toBe(true);
    await vi.waitFor(() => expect(r.result()).toEqual({ status: 'aborted', reason: 'context-lost' }));
    expect(r.probe.frame?.disposed).toBe(1);
    expect(r.probe.frame?.released).toBe(1);
    expect(r.faults).toEqual([]);
  });

  it('the end runs from the timer, outside the draw: a loss never closes a scene inside its own prerender', () => {
    const r = rig();
    r.lose();
    r.g.draw();
    r.g.draw();
    expect(r.scene.closed).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(r.scene.closed).toBe(true);
  });

  it('the frame saying contextLost is enough, without the game event: the grace starts at the first draw that sees it', () => {
    const r = rig();
    if (r.probe.frame) r.probe.frame.contextLost = true;
    r.g.draw();
    expect(r.probe.frame?.released).toBe(1);
    expect(r.probe.frame?.renders).toBe(0);
    expect(r.probe.log).not.toContain('sync3D');
    vi.advanceTimersByTime(1000);
    expect(r.scene.closed).toBe(true);
  });

  it('a restore at 500 ms: the scene carries on, draws again, and the timer is gone', () => {
    const r = rig();
    r.g.draw();
    r.lose();
    r.g.draw();
    vi.advanceTimersByTime(500);
    r.restore();
    r.g.draw();
    vi.advanceTimersByTime(5000);
    expect(r.scene.closed).toBe(false);
    expect(r.probe.frame?.renders).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(r.faults).toEqual([]);
  });

  it('a restore seen only by the frame (no game event, the canvas-copy path) also saves the scene', () => {
    const r = rig();
    r.lose();
    r.g.draw();
    vi.advanceTimersByTime(400);
    if (r.probe.frame) r.probe.frame.contextLost = false;
    r.g.draw();
    vi.advanceTimersByTime(5000);
    expect(r.scene.closed).toBe(false);
    expect(r.probe.frame?.renders).toBe(1);
  });

  it('after a restore, a second loss makes Three forget its GPU data again and starts a fresh grace', () => {
    const r = rig();
    r.lose();
    vi.advanceTimersByTime(300);
    r.restore();
    r.g.draw();
    expect(r.probe.frame?.released).toBe(1);
    r.lose();
    expect(r.probe.frame?.released).toBe(2);
    vi.advanceTimersByTime(999);
    expect(r.scene.closed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(r.scene.closed).toBe(true);
  });

  it('a restore after the end draws nothing and throws nothing', () => {
    const r = rig();
    r.lose();
    r.g.draw();
    vi.advanceTimersByTime(1000);
    const before = [...r.probe.log];
    r.restore();
    r.g.advanceTick();
    r.g.draw();
    r.g.draw();
    expect(r.probe.log).toEqual(before);
    expect(r.faults).toEqual([]);
  });

  it('closing the scene during the grace clears the timer', () => {
    const r = rig();
    r.lose();
    expect(vi.getTimerCount()).toBe(1);
    r.scene.close({ status: 'success' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('contextGraceMs sets the wait: 250 ends at 250 ms, and 2500 is still alive at 2000 ms (the control of pass line 7)', () => {
    const quick = rig({ contextGraceMs: 250 });
    quick.lose();
    vi.advanceTimersByTime(249);
    expect(quick.scene.closed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(quick.scene.closed).toBe(true);
    const slow = rig({ contextGraceMs: 2500 });
    slow.lose();
    vi.advanceTimersByTime(2000);
    expect(slow.scene.closed).toBe(false);
    vi.advanceTimersByTime(500);
    expect(slow.scene.closed).toBe(true);
  });

  it('contextGraceMs 0 is "no grace" (D3 option C): the scene ends in the first draw after the loss, as M1b built it', () => {
    const r = rig({ contextGraceMs: 0 });
    r.lose();
    expect(r.scene.closed).toBe(false);
    r.g.draw();
    expect(r.scene.closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('contextGraceMs 0 and a loss that only the game reports (the frame flag stays false): the scene still ends, it does not freeze (decision E11)', () => {
    const r = rig({ contextGraceMs: 0 });
    // The game's renderer says the context is gone; the frame (the canvas-copy path) does not.
    (r.g.renderer as { contextLost?: boolean }).contextLost = true;
    r.g.events.emit('contextlost');
    r.g.draw();
    expect(r.scene.closed).toBe(true);
  });
});

// ---- 2c. hidden 3D scenes draw no frame, and a revealed one is not stale (pass line 11) --------------------------------------------------------------

/** An opaque scene that hides what is under it. `inPrerender` closes it inside its own prerender handler, the way a scene that loses its context (with no grace) does. */
class Cover extends Scene<void> {
  constructor(private readonly inPrerender = false) {
    super();
  }
  override create(): void {
    if (this.inPrerender) this.events.on('prerender', () => this.close());
  }
  fixedUpdate(): void {}
}

describe('a Scene3D under an opaque scene', () => {
  it('calls frame.render 0 times over 30 draws while it is hidden, and still ticks (nothing pauses a scene just because it is hidden)', () => {
    const g = newGame();
    const probe = newProbe();
    void g.run(new ProbeScene(probe));
    void g.run(new Cover());
    g.advanceTick();
    for (let i = 0; i < 30; i++) g.draw();
    expect(probe.frame?.renders).toBe(0);
    expect(probe.log).not.toContain('sync3D');
  });

  it('when the cover closes in a tick, the first drawn frame renders the 3D picture BEFORE Pixi draws the display list', () => {
    const order: string[] = [];
    const g = newGame([], () => order.push('pixi'));
    const probe = newProbe();
    probe.log = order;
    void g.run(new ProbeScene(probe));
    const cover = new Cover();
    void g.run(cover);
    g.advanceTick();
    g.draw();
    expect(probe.frame?.renders).toBe(0);
    order.length = 0;
    cover.close();
    g.draw();
    expect(probe.frame?.renders).toBe(1);
    expect(order).toEqual(['sync3D', 'render', 'pixi']);
  });

  // M7 task 5 (tests/sje-runtime.test.ts holds the same case without 3D). Run red on 2026-10-12: renders was 0, so the revealed scene showed the texture from before it was hidden.
  it('when the cover closes INSIDE its own prerender, the scene under it renders in that same frame (the second pass)', () => {
    const order: string[] = [];
    const g = newGame([], () => order.push('pixi'));
    const probe = newProbe();
    probe.log = order;
    void g.run(new ProbeScene(probe));
    void g.run(new Cover(true));
    g.advanceTick();
    order.length = 0;
    g.draw();
    expect(probe.frame?.renders).toBe(1);
    expect(order).toEqual(['sync3D', 'render', 'pixi']);
  });

  it('a draw phase keeps no scene alive: a scene that closed inside its own prerender is not held by the manager afterwards', () => {
    const g = newGame();
    const held = (): number => (g.scene as unknown as { prerendered: Set<unknown> }).prerendered.size;
    void g.run(new ProbeScene(newProbe()));
    void g.run(new Cover(true));
    g.advanceTick();
    g.draw();
    expect(held()).toBe(0);
    // One scene left, nothing closes: still empty, and the frame drew it once.
    g.draw();
    expect(held()).toBe(0);
  });

  // CONTROL: a prerender with no second pass (the code before M7 task 5) leaves the revealed scene unrendered.
  it('control: a prerender with no second pass renders the revealed scene 0 times', () => {
    const g = newGame();
    const mgr = g.scene;
    mgr.prerender = () => {
      mgr.refreshLayout();
      for (const s of mgr.scenes) {
        if (s.closed || !s.sys.visible) continue;
        s.events.emit('prerender');
        if (s.closed) continue;
        s.cameras.apply();
      }
      mgr.refreshLayout();
    };
    const probe = newProbe();
    void g.run(new ProbeScene(probe));
    void g.run(new Cover(true));
    g.advanceTick();
    g.draw();
    expect(probe.frame?.renders).toBe(0);
  });
});

// ---- 3. what a bad subclass or a bad game gets --------------------------------------------------------------

describe('Scene3D refuses a bad setup, with a plain message, and leaves nothing behind', () => {
  it('a subclass that overrides fixedUpdate: run rejects and the stack is clean', async () => {
    class Overrider extends ProbeScene {
      override fixedUpdate(): void {}
    }
    const g = newGame();
    await expect(g.run(new Overrider(newProbe()))).rejects.toThrow(/overrides fixedUpdate/);
    expect(g.scene.scenes).toHaveLength(0);
  });

  it('create3D that sets no camera: run rejects naming camera3D, no frame is made, and what create3D built is freed', async () => {
    class NoCamera extends ProbeScene {
      override create3D(): void {
        super.create3D();
        this.camera3D = null;
      }
    }
    const g = newGame();
    const probe = newProbe();
    await expect(g.run(new NoCamera(probe))).rejects.toThrow(/camera3D/);
    expect(probe.frame).toBeNull();
    expect(probe.log).not.toContain('makeFrame');
    expect(probe.log).toContain('geometry.dispose');
    expect(g.scene.scenes).toHaveLength(0);
  });

  it('a game whose renderer is not the GL one: run rejects, nothing is leaked', async () => {
    class DefaultFrame extends Scene3D<HackResult> {
      geometryDisposed = 0;
      create3D(): void {
        const geometry = new BoxGeometry(1, 1, 1);
        geometry.addEventListener('dispose', () => this.geometryDisposed++);
        this.world3D.add(new Mesh(geometry, new MeshBasicMaterial()));
        this.camera3D = new PerspectiveCamera();
      }
      update3D(): void {}
      sync3D(): void {}
      abortResult(reason: Scene3DAbort): HackResult {
        return { status: 'aborted', reason };
      }
    }
    const g = newGame();
    const scene = new DefaultFrame();
    await expect(g.run(scene)).rejects.toThrow(/needs the GL renderer/);
    expect(scene.geometryDisposed).toBe(1);
  });
});

// ---- 4. the cube scene: pure and deterministic --------------------------------------------------------------

/** A cube scene on a fake frame. */
function cube(probe: Probe, make: typeof CubeScene = CubeScene): CubeScene {
  return new make({ makeFrame: makeFrameFor(probe) });
}

describe('the cube scene: update3D is pure sim, sync3D writes Three', () => {
  it('the angles are a function of the tick; the Object3D does not move until sync3D', () => {
    const g = newGame();
    const scene = cube(newProbe());
    void g.run(scene);
    expect(scene.angles).toEqual({ x: 0, y: 0 });
    g.advanceTick();
    expect(scene.angles).toEqual({ x: 1 * 0.03, y: 1 * 0.05 });
    for (let i = 0; i < 9; i++) g.advanceTick();
    expect(scene.angles.x).toBeCloseTo(0.3, 12);
    expect(scene.angles.y).toBeCloseTo(0.5, 12);
    // Ten ticks and no draw: the cube has not turned.
    expect(scene.cubeRotation).toEqual({ x: 0, y: 0 });
    g.draw();
    expect(scene.cubeRotation).toEqual(scene.angles);
  });

  it('the same tick count gives the same cube however the draws fall between the ticks', () => {
    const run = (draws: ReadonlyArray<number>, make: typeof CubeScene = CubeScene) => {
      const g = newGame();
      const scene = cube(newProbe(), make);
      void g.run(scene);
      for (let i = 1; i <= 60; i++) {
        g.advanceTick();
        if (draws.includes(i)) g.draw();
      }
      g.draw();
      return { angles: scene.angles, rotation: scene.cubeRotation };
    };
    const a = run([60]);
    expect(run([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 30, 45, 60])).toEqual(a);
    expect(run([20, 40])).toEqual(a);
    // Control: a scene whose sim reads the number of draws is NOT deterministic, and the same check catches it.
    class DrawCounting extends CubeScene {
      private draws = 0;
      override sync3D(): void {
        this.draws++;
        super.sync3D();
      }
      override update3D(tick: number): void {
        super.update3D(tick + this.draws);
      }
    }
    expect(run([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 30, 45, 60], DrawCounting)).not.toEqual(run([60], DrawCounting));
  });

  it('the cube scene ends with the aborted result and frees its frame', async () => {
    const g = newGame();
    const probe = newProbe();
    const scene = cube(probe);
    const done = g.run(scene);
    scene.endEarly('user');
    expect(await done).toEqual({ status: 'aborted', reason: 'user' });
    expect(probe.log.slice(-1)).toEqual(['frame.dispose']);
  });
});

// ---- 5. the mutants -----------------------------------------------------------------------------------------

/**
 * The lifecycle checker: runs a scene through create, one tick, one draw and a close, and lists what is wrong. The real `Scene3D` must give an
 * empty list. The mutants below must give a list that is not empty, or this checker could not fail.
 */
async function lifecycleProblems(make: (probe: Probe) => Scene3D<HackResult>): Promise<string[]> {
  const problems: string[] = [];
  const g = newGame();
  const probe = newProbe();
  const scene = make(probe);
  const run = g.run(scene);
  let rejected: unknown = null;
  run.catch((e) => {
    rejected = e;
  });
  await Promise.resolve();
  if (rejected) return [`run rejected: ${(rejected as Error).message}`];
  g.advanceTick();
  g.draw();
  if (!probe.log.includes('update3D 1')) problems.push('update3D was not called for the tick');
  const sync = probe.log.indexOf('sync3D');
  const render = probe.log.indexOf('render');
  if (sync < 0 || render < 0 || sync > render) problems.push('a draw is not sync3D and then render');
  scene.close({ status: 'success' });
  await run;
  const frameDispose = probe.log.indexOf('frame.dispose');
  const geometryDispose = probe.log.indexOf('geometry.dispose');
  if (frameDispose < 0) problems.push('the frame was not disposed');
  if (geometryDispose < 0) problems.push('the Three objects were not disposed');
  if (frameDispose >= 0 && geometryDispose >= 0 && frameDispose > geometryDispose) problems.push('the Three objects were freed before the frame');
  return problems;
}

describe('the lifecycle checker can fail (mutants)', () => {
  it('the real Scene3D passes it', async () => {
    expect(await lifecycleProblems((p) => new ProbeScene(p))).toEqual([]);
  });

  it('mutant: dispose skipped (the shutdown listeners are gone) fails it', async () => {
    class NoDispose extends ProbeScene {
      override create3D(): void {
        super.create3D();
        this.events.off('shutdown');
      }
    }
    const problems = await lifecycleProblems((p) => new NoDispose(p));
    expect(problems).toContain('the frame was not disposed');
    expect(problems).toContain('the Three objects were not disposed');
  });

  it('mutant: fixedUpdate overridden fails it', async () => {
    class Overrider extends ProbeScene {
      override fixedUpdate(): void {}
    }
    const problems = await lifecycleProblems((p) => new Overrider(p));
    expect(problems[0]).toMatch(/run rejected: .*overrides fixedUpdate/);
  });

  it('mutant: the draw renders before it syncs fails it', async () => {
    class RenderFirst extends ProbeScene {
      override sync3D(): void {
        this.probe.log.push('render');
        this.probe.log.push('sync3D');
      }
    }
    // The extra 'render' comes first in the log, so the checker's first 'render' is before the first 'sync3D'.
    expect(await lifecycleProblems((p) => new RenderFirst(p))).toContain('a draw is not sync3D and then render');
  });
});
