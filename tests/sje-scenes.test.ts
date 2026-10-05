/**
 * Engine level 3 (src/sje/runtime): Game, SceneManager and Scene, headless (no GPU).
 * Ports the relevant cases of tests/game.test.ts (the old engine) and adds the new ones the
 * design asks for: close order, microtask timing, and what happens to a promise when a scene is
 * abandoned. See docs/engine/tooling-and-testing.md section 3, "Game stack".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Container, Scene } from '../src/sje';
import { computeVisibility } from '../src/sje/runtime/scenemanager';
import { headlessGame, TestScene } from './sjekit';

beforeEach(() => {
  // A scene that throws is reported with console.error: expected noise in the fault tests.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

/** Let promise continuations run (the microtask queue drains before the next macrotask). */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('game.run and close', () => {
  it('resolves with the result, and only when the scene calls close(result)', async () => {
    const { game } = headlessGame();
    const s = new TestScene<number>([], 's');
    let result: number | undefined;
    void game.run(s).then((r) => (result = r));
    await flush();
    expect(result).toBeUndefined(); // still open: ticks do not resolve it
    game.step(3);
    await flush();
    expect(result).toBeUndefined();
    s.close(42);
    await flush();
    expect(result).toBe(42);
  });

  it('runs init, preload and create in the SAME call as run(), before it returns', () => {
    const { game } = headlessGame();
    const log: string[] = [];
    void game.run(new TestScene(log, 's'), { any: 'data' });
    expect(log).toEqual(['s:init', 's:preload', 's:create']);
    expect(game.top?.sys.status).toBe('running');
  });

  it('passes data to init and create', () => {
    const { game } = headlessGame();
    const seen: unknown[] = [];
    class S extends Scene {
      override init(d: unknown) {
        seen.push(d);
      }
      override create(d: unknown) {
        seen.push(d);
      }
      fixedUpdate() {}
    }
    void game.run(new S(), 7);
    expect(seen).toEqual([7, 7]);
  });

  it('close() twice resolves once and pops once', async () => {
    const { game } = headlessGame();
    const a = new TestScene<string>([], 'a');
    const b = new TestScene<string>([], 'b');
    let n = 0;
    void game.run(a);
    void game.run(b).then(() => n++);
    b.close('x');
    b.close('y');
    await flush();
    expect(n).toBe(1);
    expect(game.scene.scenes).toEqual([a]);
  });

  it('close order: shutdown of the closing scene, THEN resume of the one below, THEN the promise resolves', async () => {
    const { game } = headlessGame();
    const log: string[] = [];
    const below = new TestScene(log, 'below');
    const top = new TestScene<string>(log, 'top');
    void game.run(below);
    const done = game.run(top).then((r) => log.push(`awaiter:${r}`));
    log.length = 0;
    top.close('ok');
    // Synchronously, before any continuation ran:
    expect(log).toEqual(['top:shutdown', 'below:resume']);
    expect(game.scene.scenes).toEqual([below]);
    await done;
    expect(log).toEqual(['top:shutdown', 'below:resume', 'awaiter:ok']);
  });

  it('pushing a scene tells the one below it to pause', () => {
    const { game } = headlessGame();
    const log: string[] = [];
    void game.run(new TestScene(log, 'a'));
    void game.run(new TestScene(log, 'b'));
    expect(log).toContain('a:pause');
  });

  it('a throwing shutdown listener is reported, and the scene is still freed and the stack stays clean', async () => {
    const { game } = headlessGame();
    const a = new TestScene([], 'a');
    const b = new TestScene<void>([], 'b');
    void game.run(a);
    let resolved = false;
    void game.run(b).then(() => (resolved = true));
    b.events.on('shutdown', () => {
      throw new Error('bad cleanup');
    });
    const faults: unknown[] = [];
    game.events.on('fault', (_s, e) => faults.push(e));
    b.close();
    await flush();
    expect(game.scene.scenes).toEqual([a]);
    expect(b.sys.status).toBe('destroyed');
    expect(b.sys.world.destroyed && b.sys.ui.destroyed).toBe(true);
    expect((faults[0] as Error).message).toBe('bad cleanup');
    expect(resolved).toBe(true); // the awaiting story still continues
  });

  it('a scene that throws in create() is removed and its run() promise REJECTS (stack stays clean)', async () => {
    const { game } = headlessGame();
    const keep = new TestScene([], 'keep');
    void game.run(keep);
    class Bad extends Scene {
      override create() {
        throw new Error('create broke');
      }
      fixedUpdate() {}
    }
    const bad = new Bad();
    await expect(game.run(bad)).rejects.toThrow('create broke');
    expect(game.scene.scenes).toEqual([keep]);
    expect(bad.sys.status).toBe('destroyed');
  });

  it('a scene that closes itself inside create() ends cleanly and resolves', async () => {
    const { game } = headlessGame();
    class Instant extends Scene<string> {
      override create() {
        this.close('instant');
      }
      fixedUpdate() {}
    }
    const base = new TestScene([], 'base');
    void game.run(base);
    await expect(game.run(new Instant())).resolves.toBe('instant');
    expect(game.scene.scenes).toEqual([base]);
  });

  it('each scene gets a unique generated key, found by SceneManager.get', () => {
    const { game } = headlessGame();
    const a = new TestScene([], 'a');
    const b = new TestScene([], 'b');
    void game.run(a);
    void game.run(b);
    expect(a.key).not.toBe(b.key);
    expect(game.scene.get(a.key)).toBe(a);
    expect(game.scene.get('nope')).toBeUndefined();
  });

  it('a scene that has not been run has no game yet (loud, not undefined)', () => {
    const s = new TestScene([], 's');
    expect(() => s.game).toThrow(/has not been run yet/);
    expect(() => s.add).toThrow(/has not been run yet/);
  });
});

describe('abandon and reset', () => {
  it('abandon() drops scenes without resolving their promises (they stay pending forever)', async () => {
    const { game } = headlessGame();
    const log: string[] = [];
    const s = new TestScene(log, 's');
    let resolved = false;
    void game.run(s).then(() => (resolved = true));
    game.abandon();
    game.step(5);
    s.close(undefined as never); // closing an abandoned scene does nothing
    await flush();
    expect(resolved).toBe(false);
    expect(game.scene.scenes).toHaveLength(0);
    expect(log).toContain('s:shutdown'); // it was cleaned up
    expect(s.sys.status).toBe('destroyed');
  });

  it('dropCount goes up on abandon() and on reset(), not on a plain run() and not on a refused reset()', async () => {
    const { game } = headlessGame();
    expect(game.dropCount).toBe(0);
    const s = new TestScene([], 's');
    void game.run(s);
    expect(game.dropCount).toBe(0);
    game.abandon();
    expect(game.dropCount).toBe(1);
    void game.reset(new TestScene([], 'r'));
    expect(game.dropCount).toBe(2);
    // A scene that already closed is refused BEFORE the stack is cleared: nothing was dropped.
    await expect(game.reset(s)).rejects.toThrow();
    expect(game.dropCount).toBe(2);
  });

  it('abandon() survives a scene whose cleanup throws', () => {
    const { game } = headlessGame();
    const a = new TestScene([], 'a');
    const b = new TestScene([], 'b');
    void game.run(a);
    void game.run(b);
    b.events.on('shutdown', () => {
      throw new Error('cannot clean');
    });
    expect(() => game.abandon()).not.toThrow();
    expect(game.scene.scenes).toHaveLength(0);
    expect(a.sys.status).toBe('destroyed');
  });

  it('reset() replaces the stack with one scene; the old promises stay pending', async () => {
    const { game } = headlessGame();
    let oldDone = false;
    const old = new TestScene([], 'old');
    void game.run(old).then(() => (oldDone = true));
    const fresh = new TestScene<string>([], 'fresh');
    const p = game.reset(fresh);
    expect(game.scene.scenes).toEqual([fresh]);
    fresh.close('new');
    await expect(p).resolves.toBe('new');
    expect(oldDone).toBe(false);
  });
});

describe('microtask timing: a story continues AFTER the whole frame, not between ticks', () => {
  it('a scene closed in tick 1 of 3 lets ticks 2 and 3 and the draw finish before the awaiting code runs', async () => {
    const h = headlessGame();
    const log: string[] = [];
    // Another scene stays below, so ticks keep running after the top one closes.
    const base = new TestScene(log, 'base');
    void h.game.run(base);
    class Closer extends Scene<string> {
      fixedUpdate(tick: number) {
        log.push(`closer:tick${tick}`);
        if (tick === 1) this.close('done');
      }
    }
    const closer = new Closer();
    void h.game.run(closer).then((r) => log.push(`story:${r}`));
    h.game.events.on('postrender', () => log.push('postrender'));
    log.length = 0;

    h.frame(52); // 52 ms = 3 ticks at 16.67 ms (50 would be 2 ticks and a hair: float error)
    // The callback has returned. Nothing a promise would do has run yet.
    expect(log).toEqual(['closer:tick1', 'base:resume', 'base:tick2', 'base:tick3', 'postrender']);
    await flush();
    expect(log).toEqual(['closer:tick1', 'base:resume', 'base:tick2', 'base:tick3', 'postrender', 'story:done']);
  });
});

describe('the tick and the draw', () => {
  it('a tick runs prestep, step, the scenes, then poststep; the scene gets the new tick number', () => {
    const { game } = headlessGame();
    const log: string[] = [];
    game.events.on('prestep', (t) => log.push(`prestep${t}`));
    game.events.on('step', (t) => log.push(`step${t}`));
    game.events.on('poststep', (t) => log.push(`poststep${t}`));
    const s = new TestScene(log, 's');
    void game.run(s);
    log.length = 0;
    game.advanceTick();
    expect(log).toEqual(['prestep0', 'step0', 's:tick1', 'poststep1']);
    expect(game.tick).toBe(1);
  });

  it('a scene tick fires preupdate, fixedUpdate, update, postupdate, in that order', () => {
    const { game } = headlessGame();
    const log: string[] = [];
    class S extends Scene {
      override create() {
        for (const e of ['preupdate', 'update', 'postupdate'] as const) this.events.on(e, (t) => log.push(`${e}${t}`));
      }
      fixedUpdate(t: number) {
        log.push(`fixed${t}`);
      }
    }
    void game.run(new S());
    game.advanceTick();
    expect(log).toEqual(['preupdate1', 'fixed1', 'update1', 'postupdate1']);
  });

  it('a draw runs prerender (game, then scenes), the renderer, then postrender', () => {
    const log: string[] = [];
    const h = headlessGame(() => log.push('render'));
    h.game.events.on('prerender', () => log.push('game:prerender'));
    h.game.events.on('postrender', () => log.push('game:postrender'));
    class S extends Scene {
      override create() {
        this.events.on('prerender', () => log.push('scene:prerender'));
      }
      fixedUpdate() {}
    }
    void h.game.run(new S());
    h.game.draw();
    expect(log).toEqual(['game:prerender', 'scene:prerender', 'render', 'game:postrender']);
  });

  it('step(n) runs n ticks with no real time, then ONE draw (the deterministic test hook)', () => {
    const h = headlessGame();
    const s = new TestScene([], 's');
    void h.game.run(s);
    h.game.step(10);
    expect(s.updates).toBe(10);
    expect(h.game.tick).toBe(10);
    expect(h.renders.count).toBe(1);
  });

  it('a throw in a scene tick is reported (console and the fault event) and the loop carries on', () => {
    const { game } = headlessGame();
    let n = 0;
    class Flaky extends Scene {
      fixedUpdate(t: number) {
        n++;
        if (t === 2) throw new Error('tick 2 broke');
      }
    }
    const s = new Flaky();
    void game.run(s);
    const faults: Array<[unknown, unknown]> = [];
    game.events.on('fault', (scene, e) => faults.push([scene, e]));
    game.step(5);
    expect(n).toBe(5);
    expect(faults).toHaveLength(1);
    expect(faults[0]?.[0]).toBe(s);
    expect(console.error).toHaveBeenCalled();
  });

  it('a throw in the renderer or a prerender handler does not stop the frame or the loop', () => {
    const h = headlessGame(() => {
      throw new Error('gpu broke');
    });
    const log: string[] = [];
    h.game.events.on('prerender', () => {
      throw new Error('handler broke');
    });
    h.game.events.on('postrender', () => log.push('post'));
    expect(() => h.game.draw()).not.toThrow();
    expect(log).toEqual(['post']);
  });

  it('a fault listener that throws is itself contained', () => {
    const { game } = headlessGame();
    class Bad extends Scene {
      fixedUpdate() {
        throw new Error('x');
      }
    }
    void game.run(new Bad());
    game.events.on('fault', () => {
      throw new Error('listener broke');
    });
    expect(() => game.step(1)).not.toThrow();
  });

  it('update is not part of the Scene API (a Phaser habit is a compile error)', () => {
    class Habit extends Scene {
      fixedUpdate() {}
      // @ts-expect-error `update` is typed `never` on purpose (decision E2)
      override update(): void {}
    }
    expect(Habit).toBeDefined();
  });

  it('speed is ticks per loop step', () => {
    const h = headlessGame();
    const s = new TestScene([], 's');
    void h.game.run(s);
    h.game.speed = 4;
    h.frame(17);
    expect(s.updates).toBe(4);
  });
});

describe('passUpdate, opaque and curtain', () => {
  it('only the top scene ticks, unless it passes updates through', () => {
    const { game } = headlessGame();
    const low = new TestScene([], 'low');
    const mid = Object.assign(new TestScene([], 'mid'), { opaque: false, passUpdate: true });
    const top = Object.assign(new TestScene([], 'top'), { opaque: false });
    void game.run(low);
    void game.run(mid);
    void game.run(top);
    game.step(2);
    expect([low.updates, mid.updates, top.updates]).toEqual([0, 0, 2]); // top does not pass: all below are paused
    expect(low.sys.status).toBe('paused');
    top.close();
    game.step(2);
    expect([low.updates, mid.updates]).toEqual([2, 2]); // mid is the top and passes: low runs too
    expect(low.sys.status).toBe('running');
  });

  it('computeVisibility: the topmost curtain draws over the world, menus under it are hidden (port of tests/game.test.ts)', () => {
    // field (opaque base), menu (curtain), dialog, options (curtain), toast
    const stack = [
      { opaque: true, curtain: false },
      { opaque: false, curtain: true },
      { opaque: false, curtain: false },
      { opaque: false, curtain: true },
      { opaque: false, curtain: false },
    ];
    const out: boolean[] = [];
    expect(computeVisibility(stack, out)).toBe(0);
    // The old engine's expectation was renders [1, 0, 0, 1, 1].
    expect(out).toEqual([true, false, false, true, true]);
  });

  it('computeVisibility: an opaque scene hides everything below it; no curtain means all above the base show', () => {
    const out: boolean[] = [];
    expect(computeVisibility([{ opaque: true, curtain: false }, { opaque: true, curtain: false }, { opaque: false, curtain: false }], out)).toBe(1);
    expect(out).toEqual([false, true, true]);
    expect(computeVisibility([], out)).toBe(0);
    expect(out).toEqual([]);
    // No opaque scene at all: the bottom scene is the base.
    expect(computeVisibility([{ opaque: false, curtain: false }, { opaque: false, curtain: false }], out)).toBe(0);
    expect(out).toEqual([true, true]);
  });

  it('the screen roots hold the base world under worldRoot and every other container under uiRoot', () => {
    const { game } = headlessGame();
    const field = new TestScene([], 'field');
    const menu = Object.assign(new TestScene([], 'menu'), { opaque: false, curtain: true });
    const dialog = Object.assign(new TestScene([], 'dialog'), { opaque: false });
    void game.run(field);
    void game.run(menu);
    void game.run(dialog);
    const names = (c: Container) => c.list.map((o) => o.name);
    // Menu is the topmost curtain: dialog above it shows; field is the base; the layout is bottom first.
    expect(names(game.screen.worldRoot)).toEqual([`${field.key} world`]);
    expect(names(game.screen.uiRoot)).toEqual([`${field.key} ui`, `${menu.key} world`, `${menu.key} ui`, `${dialog.key} world`, `${dialog.key} ui`]);
    expect([field, menu, dialog].map((s) => s.sys.visible)).toEqual([true, true, true]);
    // An opaque scene on top hides the rest: only its containers are parented.
    const full = new TestScene([], 'full');
    void game.run(full);
    expect(names(game.screen.worldRoot)).toEqual([`${full.key} world`]);
    expect(names(game.screen.uiRoot)).toEqual([`${full.key} ui`]);
    expect(field.sys.visible).toBe(false);
    // Closing it brings the others back, in order.
    full.close();
    expect(names(game.screen.uiRoot)).toHaveLength(5);
    expect(field.sys.visible).toBe(true);
  });

  it('a curtain flag changed while running is picked up by the next draw', () => {
    const { game } = headlessGame();
    const field = new TestScene([], 'field');
    const a = Object.assign(new TestScene([], 'a'), { opaque: false });
    const b = Object.assign(new TestScene([], 'b'), { opaque: false });
    void game.run(field);
    void game.run(a);
    void game.run(b);
    expect([a, b].map((s) => s.sys.visible)).toEqual([true, true]);
    a.curtain = true;
    b.curtain = true;
    game.draw();
    expect([a.sys.visible, b.sys.visible]).toEqual([false, true]); // only the topmost curtain draws
  });
});

describe('what a scene owns dies with it', () => {
  it('shutdown aborts the signal, frees the display list and drops the listeners', () => {
    const { game } = headlessGame();
    const s = new TestScene([], 's');
    void game.run(s);
    const world = s.sys.world;
    const sprite = s.add.container(1, 2);
    const layer = s.add.layer({ ui: true });
    expect(world.list).toContain(sprite);
    expect(s.sys.ui.list).toContain(layer);
    expect(s.signal.aborted).toBe(false);
    s.close();
    expect(s.signal.aborted).toBe(true);
    expect(sprite.destroyed && layer.destroyed && world.destroyed).toBe(true);
    expect(s.events.listenerCount('shutdown')).toBe(0);
  });

  it('enter and leave 30 times: nothing piles up', () => {
    const { game } = headlessGame();
    const base = new TestScene([], 'base');
    void game.run(base);
    for (let i = 0; i < 30; i++) {
      const s = new TestScene([], 'tmp');
      void game.run(s);
      s.add.container();
      game.step(1);
      s.close();
    }
    expect(game.scene.scenes).toEqual([base]);
    expect(game.screen.uiRoot.list).toHaveLength(1); // base ui only
    expect(game.screen.worldRoot.list).toHaveLength(1);
  });

  it('scene.add puts objects in the world; add.layer({ ui: true }) puts a container in ui; add.container moves children in', () => {
    const { game } = headlessGame();
    const s = new TestScene([], 's');
    void game.run(s);
    game.textures.addCanvas('t', { width: 8, height: 8 } as unknown as HTMLCanvasElement);
    const img = s.add.image(1, 2, 't');
    const g = s.add.graphics();
    const hud = s.add.layer({ ui: true });
    const c = s.add.container(5, 5, [img]);
    expect(s.sys.world.list).toEqual([g, c]); // img moved into c
    expect(c.list).toEqual([img]);
    expect(s.sys.ui.list).toEqual([hud]);
    expect([hud.x, hud.y]).toEqual([0, 0]); // a layer stays at identity
  });
});
