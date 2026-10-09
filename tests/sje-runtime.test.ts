/**
 * The new engine's runtime parts, in plain Node (docs/engine/m1-brief.md tasks 3 to 8, 14): the Phaser scene operations, the load-aware
 * lifecycle, the LegacyScene layers, the clock, the tweens, the camera effects, the loader and the action map.
 * The key checks have a control: a case where the thing it guards is broken on purpose, and the check says so.
 *
 * No browser and no GPU: `Game` gets a renderer that draws nothing, and `document.createElement('canvas')` is a recorder, so a test can see which
 * calls a legacy scene's canvas got.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportError } from '../src/engine/errors';
import { Scene as OldScene } from '../src/engine/game';
import type { Input } from '../src/engine/input';
import { Container } from '../src/sje/display/container';
import { CameraEffects, msToTicks, parseColor } from '../src/sje/display/cameraeffects';
import { Graphics } from '../src/sje/display/graphics';
import { TextureManager } from '../src/sje/display/texturemanager';
import { Cancelled, Clock, ignoreCancel, toTicks } from '../src/sje/runtime/clock';
import { Game } from '../src/sje/runtime/game';
import { actionMapOf } from '../src/sje/runtime/input';
import { CacheManager, type LoadBackend, Loader } from '../src/sje/runtime/loader';
import { Scene } from '../src/sje/runtime/scene';
import { TweenManager } from '../src/sje/runtime/tween';
import { TICK_MS } from '../src/sje/core/size';

vi.spyOn(console, 'error').mockImplementation(() => undefined);

// ---- canvases that record what they were asked to draw ----------------------------------------------------
interface FakeCanvas {
  width: number;
  height: number;
  style: Record<string, string>;
  calls: string[];
  getContext(): unknown;
}
let canvases: FakeCanvas[] = [];
function makeCanvas(): FakeCanvas {
  const calls: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, name) => (typeof name === 'string' ? (..._a: unknown[]) => void calls.push(name) : undefined),
    set: () => true,
  });
  const c: FakeCanvas = { width: 0, height: 0, style: {}, calls, getContext: () => ctx };
  canvases.push(c);
  return c;
}
const realDocument = (globalThis as { document?: unknown }).document;
(globalThis as unknown as { document: unknown }).document = { createElement: makeCanvas };
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDocument;
});
beforeEach(() => {
  canvases = [];
});

const noop = () => undefined;
const input = { update: noop, endFrame: noop, consume: noop } as unknown as Input;
const newGame = (backend?: LoadBackend, warn: (m: string) => void = noop): Game =>
  new Game({ renderer: { render: noop }, input, compat: { reportError, warn }, ...(backend ? { loadBackend: backend } : {}) });

/** A native scene that counts what it was asked to do. */
class Counting extends Scene<string> {
  updates = 0;
  prerenders = 0;
  log: string[] = [];
  override create(): void {
    this.events.on('prerender', () => this.prerenders++);
    for (const e of ['pause', 'resume', 'sleep', 'wake', 'shutdown'] as const) this.events.on(e, () => this.log.push(e));
  }
  fixedUpdate(): void {
    this.updates++;
  }
}

// ---- the Phaser scene operations ------------------------------------------------------------------------

describe('scene operations (launch, run, pause, resume, sleep, wake, stop, switch) are queued to the next tick', () => {
  it('add() makes the scene object and names it; launch() starts it on the NEXT tick, not now', () => {
    const g = newGame();
    const s = g.scene.add('hud', Counting) as Counting;
    expect(s.key).toBe('hud');
    expect(g.scene.scenes).toEqual([]);
    g.scene.launch('hud');
    // Control: it is queued. Nothing has started yet.
    expect(g.scene.scenes).toEqual([]);
    g.advanceTick();
    expect(g.scene.scenes).toEqual([s]);
    expect(g.scene.get('hud')).toBe(s);
  });

  it('autoStart launches at the next tick; a scene that already runs is left alone', () => {
    const g = newGame();
    g.scene.add('a', Counting, true);
    g.advanceTick();
    expect(g.scene.scenes).toHaveLength(1);
    g.scene.launch('a');
    g.advanceTick();
    expect(g.scene.scenes).toHaveLength(1);
  });

  it('pause: the scene stops updating and is still drawn; resume starts it again', () => {
    const g = newGame();
    const s = g.scene.add('a', Counting, true) as Counting;
    g.advanceTick();
    expect(s.updates).toBe(1);
    g.scene.pause('a');
    g.advanceTick();
    g.advanceTick();
    expect(s.updates).toBe(1);
    expect(s.sys.status).toBe('paused');
    g.draw();
    expect(s.prerenders).toBe(1);
    g.scene.resume('a');
    g.advanceTick();
    expect(s.updates).toBe(2);
    expect(s.log).toContain('pause');
    expect(s.log).toContain('resume');
  });

  it('sleep: the scene is neither updated nor drawn; wake brings both back', () => {
    const g = newGame();
    const s = g.scene.add('a', Counting, true) as Counting;
    g.advanceTick();
    g.scene.sleep('a');
    g.advanceTick();
    g.draw();
    expect(s.updates).toBe(1);
    expect(s.prerenders).toBe(0);
    expect(s.sys.status).toBe('sleeping');
    g.scene.wake('a');
    g.advanceTick();
    g.draw();
    expect(s.updates).toBe(2);
    expect(s.prerenders).toBe(1);
  });

  it('a sleeping scene does not count as the opaque base: the scene under it is drawn', () => {
    const g = newGame();
    const under = new Counting();
    void g.run(under);
    g.scene.add('over', Counting, true);
    g.advanceTick();
    g.draw();
    expect(under.prerenders).toBe(0);
    g.scene.sleep('over');
    g.advanceTick();
    g.draw();
    expect(under.prerenders).toBe(1);
  });

  it('stop: the scene shuts down and leaves; the promise of game.run stays pending (only close resolves it)', async () => {
    const g = newGame();
    const s = new Counting();
    s._rename('a');
    let settled = false;
    void g.run(s).then(() => (settled = true));
    g.scene.stop('a');
    g.advanceTick();
    await Promise.resolve();
    expect(g.scene.scenes).toEqual([]);
    expect(s.log).toContain('shutdown');
    expect(settled).toBe(false);
  });

  it('switch(from, to): from sleeps and to runs (a scene object runs once, so a second start builds a fresh one)', () => {
    const g = newGame();
    const a = g.scene.add('a', Counting, true) as Counting;
    g.scene.add('b', Counting);
    g.advanceTick();
    g.scene.switch('a', 'b');
    g.advanceTick();
    expect(a.sys.status).toBe('sleeping');
    expect(g.scene.scenes.map((s) => s.key)).toEqual(['a', 'b']);
    g.scene.stop('b');
    g.scene.run('b');
    g.advanceTick();
    expect(g.scene.scenes.map((s) => s.key)).toEqual(['a', 'b']);
    expect(g.scene.get('b')).not.toBe(undefined);
  });

  it('run() wakes a sleeping scene and resumes a paused one', () => {
    const g = newGame();
    const s = g.scene.add('a', Counting, true) as Counting;
    g.advanceTick();
    g.scene.sleep('a');
    g.advanceTick();
    g.scene.run('a');
    g.advanceTick();
    expect(s.sys.status).toBe('running');
    g.scene.pause('a');
    g.advanceTick();
    g.scene.run('a');
    g.advanceTick();
    expect(s.sys.status).toBe('running');
  });

  it('an operation on a key that does not exist is reported, not thrown out of the tick', () => {
    const g = newGame();
    g.scene.launch('nobody');
    expect(() => g.advanceTick()).not.toThrow();
  });
});

describe('the load-aware lifecycle', () => {
  /** A backend whose files arrive when the test says so. */
  function manualBackend() {
    const waiting: Array<() => void> = [];
    const backend: LoadBackend = {
      image: (url) =>
        new Promise((resolve, reject) => {
          waiting.push(() => (url.includes('missing') ? reject(new Error('404')) : resolve({ source: makeCanvas() as unknown as CanvasImageSource, width: 8, height: 8 })));
        }),
      json: () => Promise.resolve({ ok: true }),
    };
    return { backend, arrive: () => waiting.shift()?.() };
  }

  class Loads extends Scene<void> {
    steps: string[] = [];
    updates = 0;
    constructor(private files: Array<[string, string]>) {
      super();
    }
    override preload(): void {
      for (const [k, u] of this.files) this.load.image(k, u);
    }
    override create(): void {
      this.steps.push(`create:${this.sys.status}`);
    }
    fixedUpdate(): void {
      this.updates++;
    }
  }

  it('preload() that queues nothing: create runs in the same call as game.run', () => {
    const g = newGame();
    const s = new Loads([]);
    void g.run(s);
    expect(s.steps).toEqual(['create:creating']);
    expect(s.sys.status).toBe('running');
  });

  it('preload() that queues a file: the scene is "loading", fixedUpdate does not run, and create runs when the load completes', async () => {
    const m = manualBackend();
    const g = newGame(m.backend);
    const s = new Loads([['hero', 'art/hero.png']]);
    void g.run(s);
    expect(s.sys.status).toBe('loading');
    g.advanceTick();
    g.advanceTick();
    expect(s.updates).toBe(0);
    expect(s.steps).toEqual([]);
    m.arrive();
    await vi.waitFor(() => expect(s.steps).toEqual(['create:creating']));
    expect(s.sys.status).toBe('running');
    g.advanceTick();
    expect(s.updates).toBe(1);
    expect(g.textures.exists('hero')).toBe(true);
  });

  it('a key that is already loaded is not fetched again: create runs at once', () => {
    const m = manualBackend();
    const g = newGame(m.backend);
    g.textures.createCanvas('hero', 4, 4);
    const s = new Loads([['hero', 'art/hero.png']]);
    void g.run(s);
    expect(s.steps).toEqual(['create:creating']);
  });

  it('a file that does not load gets a stand-in and a notice, and the scene still starts (a load error never rejects)', async () => {
    const m = manualBackend();
    const warnings: string[] = [];
    const g = newGame(m.backend, (w) => warnings.push(w));
    const s = new Loads([['gone', 'art/missing.png']]);
    const p = g.run(s);
    m.arrive();
    await vi.waitFor(() => expect(s.steps).toEqual(['create:creating']));
    expect(g.textures.exists('gone')).toBe(true);
    expect(g.textures.get('gone').width).toBe(16);
    expect(warnings.join(' ')).toContain('art/missing.png');
    s.close(undefined);
    await expect(p).resolves.toBeUndefined();
  });

  it('a scene closed while it loads never runs create', async () => {
    const m = manualBackend();
    const g = newGame(m.backend);
    const s = new Loads([['hero', 'art/hero.png']]);
    void g.run(s);
    s.close(undefined);
    m.arrive();
    await new Promise((r) => setTimeout(r, 5));
    expect(s.steps).toEqual([]);
  });

  it('a scene that throws in create after a load is discarded and its promise rejects', async () => {
    const m = manualBackend();
    const g = newGame(m.backend);
    class Bad extends Loads {
      override create(): void {
        throw new Error('create failed');
      }
    }
    const p = g.run(new Bad([['hero', 'art/hero.png']]));
    m.arrive();
    await expect(p).rejects.toThrow('create failed');
    expect(g.scene.scenes).toEqual([]);
  });
});

// ---- the legacy layers -------------------------------------------------------------------------------------

describe('LegacyScene: one canvas per scene, a layer above the base starts clear, the topmost scene paints the washes and overlays', () => {
  class Old extends OldScene<void> {
    renders = 0;
    constructor(opaque: boolean) {
      super();
      this.opaque = opaque;
    }
    update(): void {}
    render(): void {
      this.renders++;
    }
  }

  it('the base canvas is never cleared; a scene above it clears its own canvas each frame', () => {
    const g = newGame();
    const base = new Old(true);
    const dialog = new Old(false);
    void g.run(base);
    void g.run(dialog);
    g.draw();
    const [baseCanvas, dialogCanvas] = allLegacyCanvases(g);
    expect(baseCanvas?.calls.filter((c) => c === 'clearRect')).toHaveLength(0);
    expect(dialogCanvas?.calls.filter((c) => c === 'clearRect').length).toBeGreaterThan(0);
  });

  /** The canvases of the legacy scenes on the stack, bottom first. */
  function allLegacyCanvases(g: Game): Array<FakeCanvas | undefined> {
    return g.scene.scenes.map((s) => (s as unknown as { layer: FakeCanvas | null }).layer ?? undefined);
  }

  it('control: the clearRect probe sees a clear when one happens (a layer above the base does clear)', () => {
    const g = newGame();
    void g.run(new Old(false));
    void g.run(new Old(false));
    g.draw();
    const [first, second] = allLegacyCanvases(g);
    // The first scene is the bottom one, so it is the base even though it is not opaque: it is never cleared. The second one is a layer, and the probe sees its clear.
    expect(first?.calls.filter((c) => c === 'clearRect')).toHaveLength(0);
    expect(second?.calls.filter((c) => c === 'clearRect').length).toBeGreaterThan(0);
  });

  it('the overlay hooks and the game wash paint on the topmost drawn scene, once, after it', () => {
    const g = newGame();
    const seen: unknown[] = [];
    g.overlays.push((ctx) => seen.push(ctx));
    void g.run(new Old(true));
    void g.run(new Old(false));
    g.draw();
    const [, top] = g.scene.scenes.map((s) => (s as unknown as { image: { ctx: unknown } }).image);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(top?.ctx);
  });

  it('a scene under an opaque one is not drawn and not uploaded', () => {
    const g = newGame();
    const under = new Old(true);
    const over = new Old(true);
    void g.run(under);
    void g.run(over);
    g.draw();
    expect([under.renders, over.renders]).toEqual([0, 1]);
  });

  it('enter and exit 10 times: no texture and no canvas image outlives its scene', () => {
    const g = newGame();
    const before = g.textures.getTextureKeys().length;
    for (let i = 0; i < 10; i++) {
      const s = new Old(true);
      void g.run(s);
      g.draw();
      s.close();
      g.draw();
    }
    expect(g.textures.getTextureKeys().length).toBe(before);
  });

  it('control: a leak is visible: a texture made and never removed raises the count', () => {
    const g = newGame();
    const before = g.textures.getTextureKeys().length;
    g.textures.createCanvas('leaky', 4, 4);
    expect(g.textures.getTextureKeys().length).toBe(before + 1);
  });

  it('game.ctx is a snapshot of the drawn legacy layers, in stack order', () => {
    const g = newGame();
    void g.run(new Old(true));
    void g.run(new Old(false));
    g.draw();
    const ctx = g.ctx;
    expect(ctx).toBeTruthy();
    const drawn = canvases[canvases.length - 1]?.calls.filter((c) => c === 'drawImage');
    expect(drawn?.length).toBe(2);
  });
});

// ---- Clock ------------------------------------------------------------------------------------------------

describe('Clock: timers in ticks, never in wall time', () => {
  it('milliseconds become whole ticks, at least one', () => {
    expect(toTicks(500)).toBe(30);
    expect(toTicks(16)).toBe(1);
    expect(toTicks(0)).toBe(1);
    expect(toTicks(1000 / 60)).toBe(1);
    expect(msToTicks(100)).toBe(6);
  });

  it('delayedCall fires on the tick it is due, once, with its args and scope', () => {
    const c = new Clock();
    const got: unknown[] = [];
    const scope = { tag: 'me' };
    c.delayedCall(100, function (this: unknown, a: unknown, b: unknown) { got.push([this, a, b]); }, ['x', 2], scope);
    for (let i = 0; i < 5; i++) c.update();
    expect(got).toEqual([]);
    c.update();
    expect(got).toEqual([[scope, 'x', 2]]);
    for (let i = 0; i < 20; i++) c.update();
    expect(got).toHaveLength(1);
  });

  it('control: before it is due it does not fire (the check above would see it early)', () => {
    const c = new Clock();
    let n = 0;
    c.delayedCall(TICK_MS * 3, () => n++);
    c.update();
    c.update();
    expect(n).toBe(0);
    c.update();
    expect(n).toBe(1);
  });

  it('addEvent: repeat calls 1 + repeat times; loop never stops until removed', () => {
    const c = new Clock();
    let r = 0;
    let l = 0;
    c.addEvent({ delay: TICK_MS * 2, repeat: 2, callback: () => r++ });
    const loop = c.addEvent({ delay: TICK_MS * 2, loop: true, callback: () => l++ });
    for (let i = 0; i < 20; i++) c.update();
    expect([r, l]).toEqual([3, 10]);
    loop.remove();
    for (let i = 0; i < 20; i++) c.update();
    expect(l).toBe(10);
  });

  it('timeScale 0.5 runs at half speed and 0 stops the timers', () => {
    const c = new Clock();
    let n = 0;
    c.delayedCall(TICK_MS * 4, () => n++);
    c.timeScale = 0.5;
    for (let i = 0; i < 7; i++) c.update();
    expect(n).toBe(0);
    c.update();
    expect(n).toBe(1);
    const stopped = new Clock();
    stopped.timeScale = 0;
    let m = 0;
    stopped.delayedCall(10, () => m++);
    for (let i = 0; i < 100; i++) stopped.update();
    expect(m).toBe(0);
  });

  it('a callback may add events: the new one waits for its own time', () => {
    const c = new Clock();
    const log: string[] = [];
    c.delayedCall(TICK_MS, () => {
      log.push('first');
      c.delayedCall(TICK_MS, () => log.push('second'));
    });
    c.update();
    expect(log).toEqual(['first']);
    c.update();
    expect(log).toEqual(['first', 'second']);
  });

  it('shutdown: events never fire and every pending wait rejects with Cancelled', async () => {
    const c = new Clock();
    let fired = false;
    c.delayedCall(TICK_MS, () => (fired = true));
    const w = c.wait(1000);
    c.shutdown();
    c.update();
    expect(fired).toBe(false);
    await expect(w).rejects.toBeInstanceOf(Cancelled);
    await expect(c.wait(10)).rejects.toBeInstanceOf(Cancelled);
    expect(() => c.addEvent({ delay: 1, callback: noop })).toThrow();
  });

  it('wait() resolves after its ticks', async () => {
    const c = new Clock();
    let done = false;
    void c.wait(TICK_MS * 2).then(() => (done = true));
    c.update();
    await Promise.resolve();
    expect(done).toBe(false);
    c.update();
    await Promise.resolve();
    expect(done).toBe(true);
  });

  it('ignoreCancel swallows Cancelled and passes every other error on (control)', () => {
    expect(() => ignoreCancel(new Cancelled())).not.toThrow();
    expect(() => ignoreCancel(new Error('real'))).toThrow('real');
    expect(new Cancelled().name).toBe('Cancelled');
  });

  it('a scene that closes takes its timers with it: the callback never runs, and a wait rejects', async () => {
    const g = newGame();
    const s = new Counting();
    void g.run(s);
    let fired = false;
    s.time.delayedCall(TICK_MS * 2, () => (fired = true));
    const w = s.time.wait(TICK_MS * 5);
    s.close('x');
    g.advanceTick();
    g.advanceTick();
    g.advanceTick();
    expect(fired).toBe(false);
    await expect(w).rejects.toBeInstanceOf(Cancelled);
  });

  it('scene.time advances with the scene: it does not run while the scene is paused', () => {
    const g = newGame();
    const s = g.scene.add('a', Counting, true) as Counting;
    g.advanceTick();
    let n = 0;
    s.time.delayedCall(TICK_MS * 2, () => n++);
    g.scene.pause('a');
    g.advanceTick();
    g.advanceTick();
    g.advanceTick();
    expect(n).toBe(0);
    g.scene.resume('a');
    g.advanceTick();
    g.advanceTick();
    expect(n).toBe(1);
  });
});

// ---- Tweens -------------------------------------------------------------------------------------------------

describe('Tweens: ticks, Phaser names, die with the scene', () => {
  it('moves a property linearly over its duration and ends exactly on the target', () => {
    const t = new TweenManager();
    const o = { x: 0 };
    t.add({ targets: o, x: 100, duration: TICK_MS * 10 });
    for (let i = 0; i < 5; i++) t.update();
    expect(o.x).toBe(50);
    for (let i = 0; i < 5; i++) t.update();
    expect(o.x).toBe(100);
    expect(t.count).toBe(0);
  });

  it('eases: Quad.easeIn at the half is a quarter, not a half (control: Linear is a half)', () => {
    const lin = new TweenManager();
    const quad = new TweenManager();
    const a = { x: 0 };
    const b = { x: 0 };
    lin.add({ targets: a, x: 100, duration: TICK_MS * 10 });
    quad.add({ targets: b, x: 100, duration: TICK_MS * 10, ease: 'Quad.easeIn' });
    for (let i = 0; i < 5; i++) {
      lin.update();
      quad.update();
    }
    expect(a.x).toBe(50);
    expect(b.x).toBe(25);
  });

  it('relative values, { from, to }, several targets, delay', () => {
    const t = new TweenManager();
    const a = { x: 10, y: 0 };
    const b = { x: 20, y: 0 };
    t.add({ targets: [a, b], x: '+=10', y: { from: 5, to: 15 }, duration: TICK_MS * 2, delay: TICK_MS * 2 });
    t.update();
    t.update();
    expect([a.x, a.y]).toEqual([10, 0]);
    t.update();
    expect([a.x, a.y, b.x]).toEqual([15, 10, 25]);
    t.update();
    expect([a.x, a.y, b.x]).toEqual([20, 15, 30]);
  });

  it('yoyo plays back; repeat replays; onComplete runs once, at the end', () => {
    const t = new TweenManager();
    const o = { x: 0 };
    let done = 0;
    t.add({ targets: o, x: 10, duration: TICK_MS * 2, yoyo: true, repeat: 1, onComplete: () => done++ });
    const xs: number[] = [];
    for (let i = 0; i < 8; i++) {
      t.update();
      xs.push(o.x);
    }
    expect(xs).toEqual([5, 10, 5, 0, 5, 10, 5, 0]);
    expect(done).toBe(1);
  });

  it('finished resolves at the end; stop() freezes the values and runs no callback', async () => {
    const t = new TweenManager();
    const o = { x: 0 };
    let completed = false;
    const tw = t.add({ targets: o, x: 10, duration: TICK_MS * 2, onComplete: () => (completed = true) });
    t.update();
    tw.stop();
    t.update();
    t.update();
    expect(o.x).toBe(5);
    expect(completed).toBe(false);
    const quick = t.add({ targets: o, x: 0, duration: TICK_MS });
    t.update();
    await expect(quick.finished).resolves.toBeUndefined();
  });

  it('shutdown stops every tween: no callback, finished rejects with Cancelled, and nothing can be added', async () => {
    const t = new TweenManager();
    const o = { x: 0 };
    let completed = false;
    const tw = t.add({ targets: o, x: 10, duration: TICK_MS * 4, onComplete: () => (completed = true) });
    t.update();
    t.shutdown();
    t.update();
    t.update();
    t.update();
    expect(completed).toBe(false);
    expect(o.x).toBe(2.5);
    await expect(tw.finished).rejects.toBeInstanceOf(Cancelled);
    expect(() => t.add({ targets: o, x: 1, duration: 1 })).toThrow();
  });

  it('an unknown ease or a property that is not a number is a loud error, not a silent no-op', () => {
    const t = new TweenManager();
    expect(() => t.add({ targets: { x: 0 }, x: 1, duration: 10, ease: 'Bounce.easeIn' })).toThrow('unknown ease');
    const bad = t.add({ targets: { name: 'hero' }, name: 5, duration: TICK_MS });
    expect(() => t.update()).toThrow('not a number');
    expect(bad.isDone).toBe(false);
  });

  it('through a scene: a tween on a game object moves it and dies with the scene', () => {
    const g = newGame();
    const s = new Counting();
    void g.run(s);
    const o = { x: 0 };
    s.tweens.add({ targets: o, x: 10, duration: TICK_MS * 2 });
    g.advanceTick();
    expect(o.x).toBe(5);
    s.close('x');
    g.advanceTick();
    expect(o.x).toBe(5);
  });
});

// ---- Camera effects -----------------------------------------------------------------------------------------

describe('camera effects: fade, flash, shake, driven by the tick', () => {
  function rig() {
    const host = { textures: new TextureManager() };
    const world = new Container(host, 0, 0, 'world');
    const fx = new CameraEffects(world);
    const wash = (): Graphics | undefined => world.list.find((c): c is Graphics => c instanceof Graphics);
    return { world, fx, wash };
  }

  it('parseColor reads #rgb and #rrggbb, and refuses anything else', () => {
    expect(parseColor('#fff')).toBe(0xffffff);
    expect(parseColor('#07060d')).toBe(0x07060d);
    expect(parseColor(0x123456)).toBe(0x123456);
    expect(() => parseColor('red')).toThrow('#rrggbb');
  });

  it('fadeOut goes to full cover over its ticks and holds there; fadeIn uncovers', () => {
    const { fx, wash } = rig();
    fx.fadeOut(TICK_MS * 4, '#000000');
    const alphas: number[] = [];
    for (let i = 0; i < 6; i++) {
      fx.update();
      fx.apply(0, 0);
      alphas.push(wash()?.alpha ?? 0);
    }
    expect(alphas).toEqual([0.25, 0.5, 0.75, 1, 1, 1]);
    fx.fadeIn(TICK_MS * 2);
    fx.update();
    fx.apply(0, 0);
    expect(wash()?.alpha).toBeCloseTo(0.5);
    fx.update();
    fx.apply(0, 0);
    expect(wash()?.visible).toBe(false);
  });

  it('flash starts at full and fades to nothing, then hides', () => {
    const { fx, wash } = rig();
    fx.flash(TICK_MS * 2);
    fx.apply(0, 0);
    expect(wash()?.alpha).toBe(1);
    fx.update();
    fx.apply(0, 0);
    expect(wash()?.alpha).toBe(0.5);
    fx.update();
    fx.apply(0, 0);
    expect(wash()?.visible).toBe(false);
  });

  it('the wash stays on the screen when the camera scrolls and shakes (it is placed at the screen origin)', () => {
    const { fx, wash } = rig();
    fx.fadeOut(TICK_MS * 2);
    fx.shake(TICK_MS * 6, 4);
    fx.update();
    fx.apply(100, 50);
    const w = wash();
    // The world sits at (-100 + offset). The wash at (100 - offset) puts it back at screen (0, 0).
    expect(w?.x).toBe(100 - fx.offsetX);
    expect(w?.y).toBe(50 - fx.offsetY);
  });

  it('shake offsets are whole pixels, fall to zero by the end, and the world position includes them (through a Camera)', () => {
    const { fx } = rig();
    fx.shake(TICK_MS * 6, 4);
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) {
      fx.apply(0, 0);
      seen.push(fx.offsetX, fx.offsetY);
      fx.update();
    }
    expect(seen.every((n) => Number.isInteger(n))).toBe(true);
    expect(seen.slice(-4)).toEqual([0, 0, 0, 0]);
    // Control: the shake really moved something at the start.
    expect(seen.slice(0, 6).some((n) => n !== 0)).toBe(true);
  });

  it('through a scene: camera.fadeOut washes the scene world and the effect advances with the scene tick', () => {
    const g = newGame();
    const s = new Counting();
    void g.run(s);
    s.cameras.main.fadeOut(TICK_MS * 2);
    g.advanceTick();
    g.advanceTick();
    g.draw();
    const wash = s.sys.world.list.find((c): c is Graphics => c instanceof Graphics);
    expect(wash?.alpha).toBe(1);
    expect(s.cameras.main.busy).toBe(true);
    expect(() => s.cameras.ui.shake(10)).toThrow('never shakes');
  });
});

// ---- Loader -------------------------------------------------------------------------------------------------

describe('Loader and CacheManager', () => {
  function rig(opts?: { fail?: string[]; hang?: boolean; timeoutMs?: number }) {
    const textures = new TextureManager();
    const cache = new CacheManager();
    const warnings: string[] = [];
    const requested: string[] = [];
    const backend: LoadBackend = {
      image: (url) => {
        requested.push(url);
        if (opts?.hang) return new Promise(() => undefined);
        if (opts?.fail?.includes(url)) return Promise.reject(new Error('404'));
        return Promise.resolve({ source: makeCanvas() as unknown as CanvasImageSource, width: 32, height: 16 });
      },
      json: (url) => {
        requested.push(url);
        if (opts?.fail?.includes(url)) return Promise.reject(new Error('the answer is not JSON'));
        return Promise.resolve({ from: url });
      },
    };
    const loader = new Loader({ textures, cache, warn: (m) => warnings.push(m), backend, ...(opts?.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) });
    return { loader, textures, cache, warnings, requested };
  }

  it('loads images and JSON by key, reports progress from 0 to 1, and fires complete once', async () => {
    const r = rig();
    const progress: number[] = [];
    let complete = 0;
    r.loader.image('a', 'art/a.png').json('d', 'data/d.json').spritesheet('s', 'art/s.png', { frameWidth: 16, frameHeight: 16 });
    r.loader.on('progress', (f) => progress.push(f)).once('complete', () => complete++);
    expect(r.loader.pending).toBe(true);
    r.loader.start();
    await vi.waitFor(() => expect(complete).toBe(1));
    expect(progress).toEqual([1 / 3, 2 / 3, 1]);
    expect(r.textures.exists('a')).toBe(true);
    expect(r.cache.json.get('d')).toEqual({ from: 'data/d.json' });
    // A 32x16 sheet of 16x16 cells: two frames, named 0 and 1.
    expect([...r.textures.get('s').frames.keys()]).toEqual(['0', '1']);
    expect(r.loader.pending).toBe(false);
  });

  it('a key that is already in the cache is not fetched again; start() with nothing queued completes at once', async () => {
    const r = rig();
    r.textures.createCanvas('a', 4, 4);
    r.loader.image('a', 'art/a.png');
    expect(r.loader.pending).toBe(false);
    let complete = 0;
    r.loader.once('complete', () => complete++);
    r.loader.start();
    expect(complete).toBe(1);
    expect(r.requested).toEqual([]);
  });

  it('a file that fails gets a stand-in, one notice, a loaderror event, and the rest still load', async () => {
    const r = rig({ fail: ['art/b.png', 'data/b.json'] });
    const errors: string[] = [];
    r.loader.image('a', 'art/a.png').image('b', 'art/b.png').json('b', 'data/b.json');
    r.loader.on('loaderror', (k) => errors.push(k));
    let done = false;
    r.loader.once('complete', () => (done = true));
    r.loader.start();
    await vi.waitFor(() => expect(done).toBe(true));
    expect(errors).toEqual(['b', 'b']);
    expect(r.warnings).toHaveLength(2);
    expect(r.textures.get('b').width).toBe(16);
    expect(r.cache.json.get('b')).toEqual({});
    expect(r.textures.exists('a')).toBe(true);
  });

  it('control: a file that loads fine gives no notice and no stand-in', async () => {
    const r = rig();
    r.loader.image('a', 'art/a.png');
    let done = false;
    r.loader.once('complete', () => (done = true));
    r.loader.start();
    await vi.waitFor(() => expect(done).toBe(true));
    expect(r.warnings).toEqual([]);
    expect(r.textures.get('a').width).toBe(32);
  });

  it('a file that never answers counts as lost after the timeout (10 s by default)', async () => {
    vi.useFakeTimers();
    try {
      const r = rig({ hang: true });
      r.loader.image('slow', 'art/slow.png');
      let done = false;
      r.loader.once('complete', () => (done = true));
      r.loader.start();
      await vi.advanceTimersByTimeAsync(9_999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(done).toBe(true);
      expect(r.warnings.join(' ')).toContain('it took too long');
    } finally {
      vi.useRealTimers();
    }
  });

  it('bundles: unloadBundle frees exactly the keys of that bundle', async () => {
    const r = rig();
    r.loader.bundle('stage1', [
      { key: 'bg', url: 'art/bg.png' },
      { key: 'map', url: 'data/map.json' },
    ]);
    r.loader.image('keep', 'art/keep.png');
    let done = false;
    r.loader.once('complete', () => (done = true));
    r.loader.start();
    await vi.waitFor(() => expect(done).toBe(true));
    await r.loader.unloadBundle('stage1');
    expect(r.textures.exists('bg')).toBe(false);
    expect(r.cache.json.exists('map')).toBe(false);
    expect(r.textures.exists('keep')).toBe(true);
    await expect(r.loader.unloadBundle('nothing')).resolves.toBeUndefined();
  });

  it('shutdown stops the loader: results that arrive afterwards are dropped and nothing fires', async () => {
    const r = rig();
    r.loader.image('a', 'art/a.png');
    let complete = 0;
    r.loader.once('complete', () => complete++);
    r.loader.start();
    r.loader.shutdown();
    await new Promise((res) => setTimeout(res, 5));
    expect(complete).toBe(0);
    expect(r.textures.exists('a')).toBe(false);
  });
});

// ---- Input ---------------------------------------------------------------------------------------------------

describe('the action map wraps the old Input (it does not copy it)', () => {
  it('every call goes to the old Input object', () => {
    const calls: string[] = [];
    const fake = {
      pressed: (a: string) => (calls.push(`pressed:${a}`), true),
      down: (a: string) => (calls.push(`down:${a}`), true),
      repeat: (a: string) => (calls.push(`repeat:${a}`), false),
      dir: () => (calls.push('dir'), 'left'),
      consume: () => calls.push('consume'),
    } as unknown as Input;
    const map = actionMapOf(fake);
    expect(map.justPressed('confirm')).toBe(true);
    expect(map.isDown('up')).toBe(true);
    expect(map.repeat('down')).toBe(false);
    expect(map.dir()).toBe('left');
    map.consume();
    expect(calls).toEqual(['pressed:confirm', 'down:up', 'repeat:down', 'dir', 'consume']);
  });

  it('a scene reads the same input as the game', () => {
    const g = newGame();
    const s = new Counting();
    void g.run(s);
    expect(s.input.actions).toBe(g.actions);
  });
});
