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
