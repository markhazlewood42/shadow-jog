/**
 * Scene3D (src/sje/three/scene3d.ts), headless: the lifecycle, the cleanup in `finally`, and the
 * context-loss watchdog. A FAKE frame stands in for the GPU parts (the real Frame3D is checked in
 * the browser by e2e/sje3d.spec.ts), so these run in Node with the REAL Three scene classes and the
 * real Pixi display classes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type HackOptions, startHack } from '../src/hack3d';
import { buildIce } from '../src/hack3d/look';
import type { HackDef } from '../src/hack3d/result';
import { View3D } from '../src/sje/display/view3d';
import { CanvasFrameTexture } from '../src/sje/render/frametexture';
import { CONTEXT_GRACE_MS, type Frame3D, Scene3D, type Scene3DAbort, type Scene3DOptions } from '../src/sje/three';
import { fakeCanvas, headlessGame } from './sjekit';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A frame that draws nothing and counts what happens to it. */
class FakeFrame implements Frame3D {
  readonly mode = 'shared-context';
  readonly sprite: View3D;
  renders = 0;
  disposes = 0;
  releases = 0;
  contextLost = false;
  throwOnRender = false;
  throwOnDispose = false;
  constructor(host: { textures: never }, readonly log: string[]) {
    this.sprite = new View3D(host, new CanvasFrameTexture(fakeCanvas(480, 270)));
  }
  render(): void {
    if (this.throwOnRender) throw new Error('shader did not compile');
    this.renders++;
    this.log.push('frame.render');
  }
  rewrap(): void {}
  releaseGpuData(): void {
    this.releases++;
    this.log.push('frame.release');
  }
  privateContext(): null {
    return null;
  }
  readPixels(): never {
    throw new Error('not in a fake');
  }
  describe(): ReturnType<Frame3D['describe']> {
    return { mode: this.mode, width: 480, height: 270, minFilter: 'nearest', magFilter: 'nearest', rewraps: 0, hosts: { shared: 0, private: 0 } };
  }
  dispose(): void {
    this.disposes++;
    this.log.push('frame.dispose');
    if (this.throwOnDispose) throw new Error('dispose failed');
  }
}

/** The one thing these tests ask of a Three geometry or material: to hear its `dispose` event. */
interface Disposable {
  addEventListener(type: 'dispose', listener: () => void): void;
}

/** The smallest useful 3D scene: one cube of ICE, and a log of every hook. */
class TestScene3D extends Scene3D<string> {
  readonly log: string[];
  fake: FakeFrame | null = null;
  // Tests may not import `three` (it belongs to the lazy chunk): the objects come from the chunk's own look code.
  readonly ice = buildIce('cube');
  readonly geometries: Disposable[] = [];
  readonly materials: Disposable[] = [];
  geometryDisposes = 0;
  materialDisposes = 0;
  throwIn: 'create3D' | 'makeFrame' | null = null;
  disposed3D = 0;
  closedBy = '';

  constructor(log: string[] = [], options: Scene3DOptions = {}) {
    super({
      makeFrame: (host) => {
        if (this.throwIn === 'makeFrame') throw new Error('no GPU');
        this.fake = new FakeFrame(host as never, this.log);
        return this.fake;
      },
      ...options,
    });
    this.log = log;
    // Count the `dispose` event of every geometry and material of the cube (Three fires it from dispose()).
    this.ice.group.traverse((node) => {
      const o = node as unknown as { geometry?: Disposable; material?: Disposable | Disposable[] };
      if (o.geometry) {
        this.geometries.push(o.geometry);
        o.geometry.addEventListener('dispose', () => this.geometryDisposes++);
      }
      for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
        this.materials.push(m);
        m.addEventListener('dispose', () => this.materialDisposes++);
      }
    });
  }
  protected create3D(): void {
    this.log.push('create3D');
    if (this.throwIn === 'create3D') throw new Error('bad model');
    this.threeScene.add(this.ice.group);
  }
  protected override createHud(): void {
    this.log.push('createHud');
  }
  protected update3D(tick: number): void {
    this.log.push(`update3D:${tick}`);
  }
  protected sync3D(): void {
    this.log.push('sync3D');
  }
  protected abortResult(reason: Scene3DAbort): string {
    return `aborted:${reason}`;
  }
  protected override dispose3D(): void {
    this.disposed3D++;
    this.log.push('dispose3D');
  }
}

describe('colour management is off, so a palette colour is the palette colour (frame-and-rendering.md 7.5)', () => {
  it('a colour written as 0xffcc3d is stored as written (the default would store it in linear light: green 0.8 becomes 0.6)', () => {
    // buildIce makes its colours with `new Color(hex)`. Loading the 3D facade (above) switched colour management off.
    const ice = buildIce('cube');
    const mesh = ice.group.children[0] as unknown as { children: Array<{ material: { color: { r: number; g: number; b: number } } }> };
    const material = (mesh.children[0] as { material: { color: { r: number; g: number; b: number } } }).material;
    expect(material.color.r).toBeCloseTo(0xff / 255, 6);
    expect(material.color.g).toBeCloseTo(0xcc / 255, 6);
    expect(material.color.b).toBeCloseTo(0x3d / 255, 6);
  });
});

describe('the lifecycle', () => {
  it('create3D, then the frame, then the HUD; each tick runs update3D; each draw runs sync3D THEN the frame, before the engine draws', () => {
    const { game, renders } = headlessGame();
    const log: string[] = [];
    const s = new TestScene3D(log);
    void game.run(s);
    expect(log).toEqual(['create3D', 'createHud']);
    expect(s.fake).not.toBeNull();
    log.length = 0;
    game.step(2);
    // step(2): two ticks, then ONE draw. The scene's prerender runs inside the draw, before `renderer.render`.
    expect(log).toEqual(['update3D:1', 'update3D:2', 'sync3D', 'frame.render']);
    expect(renders.count).toBe(1);
  });

  it('the 3D picture goes into the scene’s world at the backdrop depth, behind everything a scene adds', () => {
    const { game } = headlessGame();
    const s = new TestScene3D();
    void game.run(s);
    const view = s.fake?.sprite;
    expect(view).toBeDefined();
    expect(s.sys.world.list).toContain(view);
    expect(view?.depth).toBe(-1);
  });

  it('closing with a result frees everything once: the dispose3D hook, the frame, and the Three geometry and material', async () => {
    const { game } = headlessGame();
    const s = new TestScene3D();
    const p = game.run(s);
    s.close('done');
    await expect(p).resolves.toBe('done');
    expect(s.disposed3D).toBe(1);
    expect(s.fake?.disposes).toBe(1);
    // Every geometry and material of the cube was disposed exactly once.
    expect(s.geometryDisposes).toBe(s.geometries.length);
    expect(s.materialDisposes).toBe(s.materials.length);
    expect(s.geometries.length).toBeGreaterThan(0);
    expect(s.hasFrame).toBe(false);
  });

  it('abandoning the game frees everything too (the scene never gets close())', () => {
    const { game } = headlessGame();
    const s = new TestScene3D();
    void game.run(s);
    game.abandon();
    expect(s.fake?.disposes).toBe(1);
    expect(s.geometryDisposes).toBe(s.geometries.length);
  });

  it('the order of cleanup: the subclass first, then the frame, then the Three objects', () => {
    const { game } = headlessGame();
    const log: string[] = [];
    const s = new TestScene3D(log);
    void game.run(s);
    log.length = 0;
    s.geometries[0]?.addEventListener('dispose', () => log.push('three.dispose'));
    s.close('x');
    expect(log).toEqual(['dispose3D', 'frame.dispose', 'three.dispose']);
  });
});

describe('cleanup in finally (rule 8 of frame-and-rendering.md 7.2)', () => {
  it('create3D throws: the promise rejects, the stack is clean, and what was made is freed', async () => {
    const { game } = headlessGame();
    const s = new TestScene3D();
    s.throwIn = 'create3D';
    await expect(game.run(s)).rejects.toThrow('bad model');
    expect(game.scene.scenes).toEqual([]);
    expect(s.disposed3D).toBe(1);
    expect(s.fake).toBeNull();
  });

  it('the frame cannot be made: the Three objects are still freed', async () => {
    const { game } = headlessGame();
    const s = new TestScene3D();
    s.throwIn = 'makeFrame';
    await expect(game.run(s)).rejects.toThrow('no GPU');
    expect(s.geometryDisposes).toBe(s.geometries.length);
    expect(s.materialDisposes).toBe(s.materials.length);
    expect(s.geometries.length).toBeGreaterThan(0);
  });

  it('a step that fails does not skip the others: frame.dispose throws and the Three objects are freed anyway', () => {
    const { game } = headlessGame();
    const s = new TestScene3D();
    void game.run(s);
    if (s.fake) s.fake.throwOnDispose = true;
    s.close('x');
    expect(s.geometryDisposes).toBe(s.geometries.length);
    expect(s.disposed3D).toBe(1);
    // The failure is reported, not swallowed.
    expect(console.error).toHaveBeenCalled();
  });

  it('the game’s context listeners are removed at shutdown (nothing keeps a closed scene alive)', () => {
    const { game } = headlessGame();
    const s = new TestScene3D();
    void game.run(s);
    expect(game.events.listenerCount('contextlost')).toBe(1);
    expect(game.events.listenerCount('contextrestored')).toBe(1);
    s.close('x');
    expect(game.events.listenerCount('contextlost')).toBe(0);
    expect(game.events.listenerCount('contextrestored')).toBe(0);
  });
});

describe('the watchdog: a lost context cannot leave a story waiting', () => {
  it('closes with the fallback result once the context has been lost for the grace period', async () => {
    vi.useFakeTimers();
    const { game, gl } = headlessGame();
    const s = new TestScene3D();
    const p = game.run(s);
    gl.lost = true;
    game.events.emit('contextlost');
    vi.advanceTimersByTime(CONTEXT_GRACE_MS - 1);
    expect(game.scene.scenes).toEqual([s]); // still waiting
    // The context is still lost when the timer fires.
    vi.advanceTimersByTime(1);
    await expect(p).resolves.toBe('aborted:context-lost');
    expect(game.scene.scenes).toEqual([]);
    expect(s.fake?.disposes).toBe(1);
  });

  it('the grace period is under the 2 second pass line', () => {
    expect(CONTEXT_GRACE_MS).toBeLessThan(2000);
  });

  it('a context that comes back in time cancels it: the scene carries on', async () => {
    vi.useFakeTimers();
    const { game, gl } = headlessGame();
    const s = new TestScene3D();
    void game.run(s);
    gl.lost = true;
    game.events.emit('contextlost');
    vi.advanceTimersByTime(300);
    gl.lost = false;
    game.events.emit('contextrestored');
    vi.advanceTimersByTime(CONTEXT_GRACE_MS * 3);
    expect(game.scene.scenes).toEqual([s]);
  });

  it('a private context that comes back (no engine event) stops the timer, so a second loss gets its FULL grace period', () => {
    vi.useFakeTimers();
    const { game } = headlessGame();
    const s = new TestScene3D();
    void game.run(s);
    const frame = s.fake;
    if (!frame) throw new Error('no frame');
    // Loss 1 at t = 0: the per-frame check starts the timer (due at 1000 ms).
    frame.contextLost = true;
    game.step(1);
    vi.advanceTimersByTime(300);
    // The private context is back at t = 300. The engine sends no event for it: the next draw notices.
    frame.contextLost = false;
    game.step(1);
    vi.advanceTimersByTime(300);
    // Loss 2 at t = 600: its own timer is due at 1600 ms. The first timer (1000 ms) must be gone.
    frame.contextLost = true;
    game.step(1);
    vi.advanceTimersByTime(500); // t = 1100
    expect(game.scene.scenes, 'the old timer must not cut the second loss short').toEqual([s]);
    vi.advanceTimersByTime(500); // t = 1600
    expect(game.scene.scenes).toEqual([]);
  });

  it('a lost context while drawing starts the watchdog even if the event was missed, and nothing draws meanwhile', () => {
    vi.useFakeTimers();
    const { game, gl } = headlessGame();
    const s = new TestScene3D();
    void game.run(s);
    gl.lost = true;
    const before = s.fake?.renders ?? 0;
    game.step(1); // a draw while lost: no event ever came
    expect(s.fake?.renders).toBe(before);
    vi.advanceTimersByTime(CONTEXT_GRACE_MS + 1);
    expect(game.scene.scenes).toEqual([]);
  });

  it('a scene closed before the timer fires is not closed again (and the timer is cleared)', async () => {
    vi.useFakeTimers();
    const { game } = headlessGame();
    const s = new TestScene3D();
    const p = game.run(s);
    game.events.emit('contextlost');
    s.close('won first');
    vi.advanceTimersByTime(CONTEXT_GRACE_MS * 2);
    await expect(p).resolves.toBe('won first');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a context that is ALREADY lost when the scene starts gives the fallback result at once, and makes no frame', async () => {
    const { game, gl } = headlessGame();
    gl.lost = true;
    const s = new TestScene3D();
    await expect(game.run(s)).resolves.toBe('aborted:context-lost');
    expect(s.fake).toBeNull();
    expect(game.scene.scenes).toEqual([]);
  });

  it('a loss lets Three forget its GPU data ONCE per loss (geometry, materials, the frame), and keeps the objects', () => {
    vi.useFakeTimers();
    const { game, gl } = headlessGame();
    const s = new TestScene3D([], { contextGraceMs: 10_000 });
    void game.run(s);
    const geometries = s.geometryDisposes;
    gl.lost = true;
    game.events.emit('contextlost');
    expect(s.fake?.releases).toBe(1);
    expect(s.geometryDisposes).toBeGreaterThan(geometries);
    expect(s.materialDisposes).toBeGreaterThan(0);
    // The cube is still in the scene: Three uploads it again on the next draw after the restore.
    expect(s.ice.group.parent).not.toBeNull();
    // The same loss seen again (the event, then each draw) releases nothing more.
    game.step(3);
    game.events.emit('contextlost');
    expect(s.fake?.releases).toBe(1);
    // It came back and drew; a SECOND loss is a new loss.
    gl.lost = false;
    game.events.emit('contextrestored');
    game.step(1);
    gl.lost = true;
    game.events.emit('contextlost');
    expect(s.fake?.releases).toBe(2);
  });

  it('a loss that is only seen by the per-frame check (no event) releases too', () => {
    vi.useFakeTimers();
    const { game, gl } = headlessGame();
    const s = new TestScene3D([], { contextGraceMs: 10_000 });
    void game.run(s);
    gl.lost = true;
    game.step(1);
    game.step(1);
    expect(s.fake?.releases).toBe(1);
  });

  it('a scene that has ended releases nothing on a late loss event', async () => {
    const { game } = headlessGame();
    const s = new TestScene3D();
    const p = game.run(s);
    s.close('done');
    await p;
    game.events.emit('contextlost');
    expect(s.fake?.releases).toBe(0);
  });

  it('the grace period can be set per scene', async () => {
    vi.useFakeTimers();
    const { game, gl } = headlessGame();
    const s = new TestScene3D([], { contextGraceMs: 50 });
    const p = game.run(s);
    gl.lost = true;
    game.events.emit('contextlost');
    vi.advanceTimersByTime(50);
    await expect(p).resolves.toBe('aborted:context-lost');
  });
});

describe('a frame that throws', () => {
  it('ends the scene with aborted/error ONCE and logs it once (it does not throw on every frame)', async () => {
    const { game } = headlessGame();
    const s = new TestScene3D();
    const p = game.run(s);
    if (s.fake) s.fake.throwOnRender = true;
    game.step(1);
    await expect(p).resolves.toBe('aborted:error');
    expect(console.error).toHaveBeenCalledTimes(1);
    game.step(3); // the scene is gone: nothing more
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('endEarly("user") gives the user abort result', async () => {
    const { game } = headlessGame();
    const s = new TestScene3D();
    const p = game.run(s);
    s.endEarly('user');
    await expect(p).resolves.toBe('aborted:user');
  });
});

describe('startHack: the real HackScene through the door with a fake frame', () => {
  const DEF: HackDef = { id: 't', seed: 7, ticks: 90, iceCount: 3, traceLimit: 100, hitCost: 10 };
  const fake = (log: string[] = []): HackOptions => ({ hud: false, makeFrame: (host) => new FakeFrame(host as never, log) });

  it('a hack that runs to the end resolves success with its numbers; the scene is gone and freed', async () => {
    const { game } = headlessGame();
    const p = startHack(game, DEF, fake());
    game.step(90);
    const r = await p;
    expect(r.status).toBe('success');
    expect(r).toMatchObject({ data: { ticks: 90 } });
    expect(game.scene.scenes).toEqual([]);
  });

  it('a hack whose TRACE hits the limit resolves fail', async () => {
    const { game } = headlessGame();
    const p = startHack(game, { ...DEF, ticks: 5000, traceLimit: 10 }, fake());
    game.step(2000);
    expect((await p).status).toBe('fail');
  });

  it('dropped by game.abandon(): it STILL resolves (aborted / user), unlike a plain game.run', async () => {
    const { game } = headlessGame();
    const p = startHack(game, DEF, fake());
    game.step(5);
    game.abandon();
    expect(await p).toEqual({ status: 'aborted', reason: 'user' });
  });

  it('dropped by game.reset() with another scene: also aborted / user', async () => {
    const { game } = headlessGame();
    const p = startHack(game, DEF, fake());
    void game.reset(new TestScene3D());
    expect(await p).toEqual({ status: 'aborted', reason: 'user' });
  });

  it('a hack that cannot start (the frame throws in create) resolves aborted / error, never rejects', async () => {
    const { game } = headlessGame();
    const p = startHack(game, DEF, {
      hud: false,
      makeFrame: () => {
        throw new Error('no GPU');
      },
    });
    expect(await p).toEqual({ status: 'aborted', reason: 'error' });
  });

  it('a lost context that never returns: aborted / context-lost within the grace period, and the story continues', async () => {
    vi.useFakeTimers();
    const { game, gl } = headlessGame();
    const frames: FakeFrame[] = [];
    const p = startHack(game, DEF, {
      hud: false,
      makeFrame: (host) => {
        const f = new FakeFrame(host as never, []);
        frames.push(f);
        return f;
      },
    });
    gl.lost = true;
    for (const f of frames) f.contextLost = true;
    game.events.emit('contextlost');
    vi.advanceTimersByTime(CONTEXT_GRACE_MS);
    expect(await p).toEqual({ status: 'aborted', reason: 'context-lost' });
  });

  it('simulation time is the TICK count: the same hack gives the same Three transforms at the same tick', () => {
    const grab = () => {
      const { game } = headlessGame();
      const log: string[] = [];
      void startHack(game, { ...DEF, ticks: 5000 }, fake(log));
      game.step(150);
      const top = game.top as unknown as { sim: { tick: number; persona: { x: number } } };
      return { tick: top.sim.tick, x: top.sim.persona.x };
    };
    expect(grab()).toEqual(grab());
  });
});
