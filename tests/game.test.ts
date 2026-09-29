/** Game core: a throwing scene never kills the loop, and a persistently broken flow trips recovery. */
import { describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../src/engine/canvas';
import { currentNotice } from '../src/engine/errors';
import { FAULT_LIMIT, Game, Scene } from '../src/engine/game';
import type { Input } from '../src/engine/input';

// performance.now() drives notice lifetime; node has it. Console noise from reportError is expected.
vi.spyOn(console, 'error').mockImplementation(() => undefined);

const input = { update: () => undefined, endFrame: () => undefined, consume: () => undefined } as unknown as Input;
const noop = () => undefined;
const ctx = new Proxy({}, { get: () => noop, set: () => true }) as unknown as Ctx;

class Faulty extends Scene<void> {
  updates = 0;
  renders = 0;
  constructor(private failUpdate: (n: number) => boolean, private failRender = false) {
    super();
  }
  update(): void {
    this.updates++;
    if (this.failUpdate(this.updates)) throw new Error(`update ${this.updates}`);
  }
  render(): void {
    this.renders++;
    if (this.failRender) throw new Error('render');
  }
}

describe('game fault isolation', () => {
  it('reports a one-off exception and keeps ticking', () => {
    const g = new Game(ctx, input);
    const s = new Faulty((n) => n === 2);
    void g.run(s);
    for (let i = 0; i < 5; i++) g.tick();
    expect(s.updates).toBe(5);
    expect(currentNotice()?.text).toBe('update 2');
    expect(currentNotice()?.tone).toBe('error');
  });

  it('drops a ticker or overlay that throws, once, and keeps running', () => {
    const g = new Game(ctx, input);
    let good = 0;
    g.tickers.push(() => {
      throw new Error('bad ticker');
    });
    g.tickers.push(() => {
      good++;
    });
    g.overlays.push(() => {
      throw new Error('bad overlay');
    });
    for (let i = 0; i < 5; i++) {
      g.tick();
      g.render();
    }
    expect(g.tickers.length).toBe(1);
    expect(g.overlays.length).toBe(0);
    expect(good).toBe(5);
  });

  it('keeps rendering overlays when a scene render throws', () => {
    const g = new Game(ctx, input);
    let overlays = 0;
    g.overlays.push(() => overlays++);
    void g.run(new Faulty(() => false, true));
    g.render();
    g.render();
    expect(overlays).toBe(2);
  });

  it('trips onFault once after FAULT_LIMIT consecutive bad ticks, not for intermittent ones', () => {
    const g = new Game(ctx, input);
    let faults = 0;
    g.onFault = () => faults++;
    void g.run(new Faulty((n) => n % 2 === 0));
    for (let i = 0; i < FAULT_LIMIT * 3; i++) g.tick();
    expect(faults).toBe(0);
    g.abandon();
    void g.run(new Faulty(() => true));
    for (let i = 0; i < FAULT_LIMIT; i++) g.tick();
    expect(faults).toBe(1);
  });

  it('trips onFault when only render throws, every frame (a frozen picture is a softlock too)', () => {
    const g = new Game(ctx, input);
    let faults = 0;
    g.onFault = () => {
      faults++;
      g.abandon();
    };
    const s = new Faulty(() => false, true);
    void g.run(s);
    for (let i = 0; i < FAULT_LIMIT - 1; i++) {
      g.tick();
      g.render();
    }
    expect(faults).toBe(0);
    g.tick();
    g.render();
    expect(faults).toBe(1);
    expect(g.stack.length).toBe(0);
  });

  it('an intermittent render fault never trips recovery', () => {
    const g = new Game(ctx, input);
    let faults = 0;
    g.onFault = () => faults++;
    let n = 0;
    const s = new Faulty(() => false);
    s.render = () => {
      if (++n % 2 === 0) throw new Error('every other frame');
    };
    void g.run(s);
    for (let i = 0; i < FAULT_LIMIT * 3; i++) g.render();
    expect(faults).toBe(0);
  });

  it('a scene whose exit() throws still leaves the stack cleanly (and says so)', async () => {
    const { notice } = await import('../src/engine/errors');
    notice('clear', 'warn');
    const g = new Game(ctx, input);
    const a = new Faulty(() => false);
    const b = new Faulty(() => false);
    b.exit = () => {
      throw new Error('bad cleanup');
    };
    void g.run(a);
    void g.run(b);
    g.remove(b);
    expect(g.stack).toEqual([a]);
    expect(currentNotice()?.text).toContain('bad cleanup');
  });

  it('a second error while the first is showing is counted, not shown over it', async () => {
    const { reportError, notice } = await import('../src/engine/errors');
    notice('clear', 'warn');
    reportError(new Error('root cause'));
    reportError(new Error('fallout'));
    reportError(new Error('more fallout'));
    expect(currentNotice()?.text).toBe('root cause (+2 more)');
  });

  it('draws only the topmost curtain over the world: menus under it are not repainted', () => {
    const g = new Game(ctx, input);
    const field = new Faulty(() => false);
    const menu = Object.assign(new Faulty(() => false), { opaque: false, curtain: true });
    const dialog = Object.assign(new Faulty(() => false), { opaque: false });
    const options = Object.assign(new Faulty(() => false), { opaque: false, curtain: true });
    const toast = Object.assign(new Faulty(() => false), { opaque: false });
    void g.run(field);
    void g.run(menu);
    void g.run(dialog);
    void g.run(options);
    void g.run(toast);
    g.render();
    expect([field, menu, dialog, options, toast].map((s) => s.renders)).toEqual([1, 0, 0, 1, 1]);
  });

  it('abandon() drops scenes and timers without resolving them', async () => {
    const g = new Game(ctx, input);
    let woke = false;
    void g.wait(2).then(() => (woke = true));
    void g.run(new Faulty(() => false));
    g.abandon();
    for (let i = 0; i < 5; i++) g.tick();
    await Promise.resolve();
    expect(woke).toBe(false);
    expect(g.stack.length).toBe(0);
  });
});

// Last in the file: its notice would otherwise be what the tests above read.
describe('input polling', () => {
  it('input polling that throws (a blocked Gamepad API) is reported, and the scene still ticks', () => {
    const throwing = { ...input, update: () => { throw new Error('gamepad blocked'); } } as unknown as Input;
    const g = new Game(ctx, throwing);
    const s = new Faulty(() => false);
    void g.run(s);
    for (let i = 0; i < FAULT_LIMIT + 5; i++) expect(() => g.tick()).not.toThrow();
    // Every tick still reached the scene, and a persistent input failure never tripped recovery.
    expect(s.updates).toBe(FAULT_LIMIT + 5);
    expect(g.stack.includes(s)).toBe(true);
    // Reported once (the on-screen notice merges with earlier tests' ones; the log doesn't).
    const logged = vi.mocked(console.error).mock.calls.filter((c) => String(c[1]).includes('gamepad blocked'));
    expect(logged.length).toBe(1);
  });
});
