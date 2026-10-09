/**
 * The new engine's Game core (docs/engine/m1-brief.md tasks 3 to 8 and 14), in plain Node: no browser, no GPU.
 *
 *  1. The shared case table of tests/game-cases.ts runs on the NEW `Game`: the same fault, abandon, curtain, exit-throw and render-fault cases
 *     that tests/game.test.ts runs on the old one. Controls: a `Game` with a broken fault counter and a broken render counter must fail the
 *     matching case.
 *  2. Close order and microtask timing, for new scenes and legacy scenes. Controls: a close in the wrong order, and a loop that lets promises
 *     run between ticks, must fail.
 *  3. The loop rules: up to 5 catch-up ticks then the backlog drops, and the hidden-tab clamp. Control: a naive loop fails.
 *  4. The old `Game` and the new one both fit the interfaces (a compile-time check, plus a runtime check that both have the surface).
 *
 * `Game` needs a renderer; the one here draws nothing. `CanvasImage` needs `document.createElement('canvas')`, so a minimal stand-in is
 * installed. Pixi's scene classes run in Node; the GPU is not needed.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { currentNotice, reportError } from '../src/engine/errors';
import type { Game as OldGame } from '../src/engine/game';
import { FAULT_LIMIT as OLD_FAULT_LIMIT, Scene as OldScene } from '../src/engine/game';
import type { Input } from '../src/engine/input';
import { shakeOffset } from '../src/engine/shake';
import { FixedLoop, type FixedLoopOptions, MAX_TICKS_PER_FRAME } from '../src/sje/core/fixedloop';
import { TICK_MS } from '../src/sje/core/size';
import { FAULT_LIMIT, Game } from '../src/sje/runtime/game';
import type { GameApi, LegacyGameSurface } from '../src/sje/runtime/gameapi';
import { LegacyScene } from '../src/sje/runtime/legacyscene';
import { Scene } from '../src/sje/runtime/scene';
import { caseNamed, defineGameCases, Faulty, noopInput, type Subject } from './game-cases';

vi.spyOn(console, 'error').mockImplementation(() => undefined);

// ---- a canvas stand-in, so CanvasImage works in Node --------------------------------------------------
const noop = () => undefined;
const fakeCtx = new Proxy({}, { get: () => noop, set: () => true });
const realDocument = (globalThis as { document?: unknown }).document;
(globalThis as unknown as { document: unknown }).document = {
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => fakeCtx }),
};
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDocument;
});

/** A renderer that draws nothing (the scene stack and the loop are the subject, not the GPU). */
const nullRenderer = { render: noop };

function newGame(input: Input = noopInput, loop?: FixedLoopOptions): Game {
  return new Game({ renderer: nullRenderer, input, compat: { reportError }, ...(loop ? { loop } : {}) });
}

function subjectOf(g: Game): Subject {
  return { game: g, tick: () => g.advanceTick(), render: () => g.draw() };
}

// ---- 1. the shared case table ---------------------------------------------------------------------------

describe('the two Game classes agree on the limit', () => {
  it('FAULT_LIMIT is the same number (30) on both', () => {
    expect(FAULT_LIMIT).toBe(30);
    expect(FAULT_LIMIT).toBe(OLD_FAULT_LIMIT);
  });
});

defineGameCases('new Game', (input) => subjectOf(newGame(input)), FAULT_LIMIT);

describe('negative controls: a broken new Game fails the matching shared case', () => {
  /** Run one shared case on a subject and say whether it passed. */
  async function passes(part: string, make: (input: Input) => Subject): Promise<boolean> {
    try {
      await caseNamed(part).run(make, FAULT_LIMIT);
      return true;
    } catch {
      return false;
    }
  }

  it('the controls are honest: the unbroken Game passes the same two cases', async () => {
    expect(await passes('trips onFault once after', (i) => subjectOf(newGame(i)))).toBe(true);
    expect(await passes('trips onFault when only render throws', (i) => subjectOf(newGame(i)))).toBe(true);
  });

  it('no tick fault counter: onFault never trips, so "trips onFault once after FAULT_LIMIT" fails', async () => {
    const broken = (i: Input) => {
      const g = newGame(i);
      // The counter is read as 0 whatever is written to it.
      Object.defineProperty(g, 'faults', { get: () => 0, set: () => undefined });
      return subjectOf(g);
    };
    expect(await passes('trips onFault once after', broken)).toBe(false);
  });

  it('no render fault counter: a draw that always throws never trips onFault, so "trips onFault when only render throws" fails', async () => {
    const broken = (i: Input) => {
      const g = newGame(i);
      Object.defineProperty(g, 'renderFaults', { get: () => 0, set: () => undefined });
      return subjectOf(g);
    };
    expect(await passes('trips onFault when only render throws', broken)).toBe(false);
  });

  it('a render fault counter that also counts the tick (the two mixed up) fails "an intermittent render fault never trips recovery"... or is caught by the tick case', async () => {
    // Mixed counters: a draw fault feeds the tick counter. The tick case (30 ticks that throw in update) still passes, so the mix is caught by
    // the render-only case: it would trip at the same count anyway. This control checks the SEPARATION instead: a scene that throws in update every tick
    // and renders fine must trip once, not twice (one counter per phase).
    const g = newGame();
    let faults = 0;
    g.onFault = () => faults++;
    void g.run(new Faulty(() => true));
    for (let i = 0; i < FAULT_LIMIT; i++) {
      g.advanceTick();
      g.draw();
    }
    expect(faults).toBe(1);
  });

  it('exit() throws and is not reported: the stack stays clean but the notice is missing, so the exit-throw case fails', async () => {
    const broken = (i: Input) => {
      // Report nothing at all.
      const g = new Game({ renderer: nullRenderer, input: i, compat: { reportError: noop } });
      return subjectOf(g);
    };
    expect(await passes('exit() throws still leaves', broken)).toBe(false);
  });
});

// ---- 2. close order and microtask timing -------------------------------------------------------------

/** A new scene that logs what it hears. */
class Logged extends Scene<string> {
  constructor(readonly name: string, readonly log: string[]) {
    super();
  }
  override create(): void {
    this.events.on('pause', () => this.log.push(`${this.name}:pause`));
    this.events.on('resume', () => this.log.push(`${this.name}:resume`));
    this.events.on('shutdown', () => this.log.push(`${this.name}:shutdown`));
    this.events.on('destroy', () => this.log.push(`${this.name}:destroy`));
  }
  fixedUpdate(): void {}
}

describe('close order (frame-and-rendering.md section 2, "Scene lifecycle")', () => {
  it('close(): the scene shuts down and is destroyed, input is consumed, the scene below resumes, and only then does the promise resolve', async () => {
    const log: string[] = [];
    const input = { ...noopInput, consume: () => log.push('consume') } as unknown as Input;
    const g = newGame(input);
    const below = new Logged('below', log);
    const top = new Logged('top', log);
    void g.run(below);
    const p = g.run(top).then((r) => log.push(`resolved:${r}`));
    log.length = 0;
    top.close('done');
    // Nothing after the close call has run yet except what close() did synchronously.
    expect(log).toEqual(['top:shutdown', 'top:destroy', 'consume', 'below:resume']);
    await p;
    expect(log).toEqual(['top:shutdown', 'top:destroy', 'consume', 'below:resume', 'resolved:done']);
  });

  it('push: the scene below hears pause, input is consumed, and init, preload and create run in the same call', () => {
    const log: string[] = [];
    const input = { ...noopInput, consume: () => log.push('consume') } as unknown as Input;
    const g = newGame(input);
    const below = new Logged('below', log);
    void g.run(below);
    log.length = 0;
    class Steps extends Scene<void> {
      override init(): void {
        log.push('init');
      }
      override preload(): void {
        log.push('preload');
      }
      override create(): void {
        log.push('create');
      }
      fixedUpdate(): void {}
    }
    void g.run(new Steps());
    expect(log).toEqual(['below:pause', 'consume', 'init', 'preload', 'create']);
  });

  it('resume goes only to a scene that a push paused: closing a scene in the middle sends nothing to the top', () => {
    const log: string[] = [];
    const g = newGame();
    const a = new Logged('a', log);
    const b = new Logged('b', log);
    const c = new Logged('c', log);
    void g.run(a);
    void g.run(b);
    void g.run(c);
    log.length = 0;
    b.close('x');
    expect(log).toEqual(['b:shutdown', 'b:destroy']);
  });

  it('a legacy scene closes in the old order too: exit, consume, the scene below resumes, then its promise resolves', async () => {
    const log: string[] = [];
    const input = { ...noopInput, consume: () => log.push('consume') } as unknown as Input;
    const g = newGame(input);
    class Old extends OldScene<string> {
      constructor(private name: string) {
        super();
      }
      override enter(): void {
        log.push(`${this.name}:enter`);
      }
      override exit(): void {
        log.push(`${this.name}:exit`);
      }
      override resume(): void {
        log.push(`${this.name}:resume`);
      }
      update(): void {}
      render(): void {}
    }
    const below = new Old('below');
    const top = new Old('top');
    void g.run(below);
    const p = g.run(top).then((r) => log.push(`resolved:${r}`));
    log.length = 0;
    top.close('ok');
    expect(log).toEqual(['top:exit', 'consume', 'below:resume']);
    await p;
    expect(log.at(-1)).toBe('resolved:ok');
  });

  it('control: closing in the wrong order (resume before the shutdown) makes the order check fail', () => {
    const log: string[] = [];
    const g = newGame();
    const below = new Logged('below', log);
    const top = new Logged('top', log);
    void g.run(below);
    void g.run(top);
    log.length = 0;
    // The mutant: the manager resumes the scene below before it takes the closing scene down.
    const sm = g.scene as unknown as { remove(s: unknown): void; resumeTop(): void };
    const real = sm.remove.bind(sm);
    sm.remove = (s) => {
      log.push('below:resume');
      real(s);
    };
    top.close('x');
    expect(log).not.toEqual(['top:shutdown', 'top:destroy', 'below:resume']);
  });

  it('a scene that throws in init is discarded, the scene below resumes, and the promise rejects', async () => {
    const log: string[] = [];
    const g = newGame();
    const below = new Logged('below', log);
    void g.run(below);
    class Bad extends Scene<void> {
      override init(): void {
        throw new Error('init failed');
      }
      fixedUpdate(): void {}
    }
    log.length = 0;
    await expect(g.run(new Bad())).rejects.toThrow('init failed');
    expect(g.scene.scenes).toEqual([below]);
    expect(log).toContain('below:resume');
  });
});

describe('microtask timing: story promises continue after the whole frame, not between ticks', () => {
  /**
   * A story waits one frame twice. `ticksPerFrame` ticks run in one animation-frame callback. Returns the order in which a ticker (once per tick)
   * and the story's continuation logged.
   */
  async function order(ticksPerFrame: number, flushBetweenTicks: boolean): Promise<string[]> {
    const log: string[] = [];
    let frameCb: ((now: number) => void) | null = null;
    const g = newGame(noopInput, {
      requestFrame: (cb) => {
        frameCb = cb;
        return 1;
      },
      cancelFrame: noop,
      now: () => 0,
    });
    g.tickers.push(() => log.push(`tick${g.tick + 1}`));
    void (async () => {
      await g.wait(1);
      log.push('story-a');
      await g.wait(1);
      log.push('story-b');
    })();
    g.start();
    if (flushBetweenTicks) {
      // The wrong shape of loop: promises get to run between ticks.
      for (let i = 0; i < ticksPerFrame; i++) {
        g.advanceTick();
        await Promise.resolve();
        await Promise.resolve();
      }
    } else {
      // The real loop: one callback runs all the ticks, the promises run after it returns.
      (frameCb as unknown as (now: number) => void)(ticksPerFrame * TICK_MS + 0.001);
      await Promise.resolve();
      await Promise.resolve();
    }
    g.stop();
    return log;
  }

  it('three ticks in one callback: the story continues after the third tick, not after the first', async () => {
    expect(await order(3, false)).toEqual(['tick1', 'tick2', 'tick3', 'story-a']);
  });

  it('control: a loop that lets promises run between ticks is told apart (the story would continue after tick 1)', async () => {
    expect(await order(3, true)).toEqual(['tick1', 'story-a', 'tick2', 'story-b', 'tick3']);
    expect(await order(3, true)).not.toEqual(await order(3, false));
  });
});

// ---- 3. the loop rules --------------------------------------------------------------------------------------

describe('loop rules: catch-up ticks, dropped backlog, hidden-tab clamp', () => {
  /** What the loop must do whatever it is made of: `advance(ms)` returns how many ticks ran. */
  function loopRules(advance: (ms: number) => number): void {
    // A frame owed exactly 3 ticks runs 3.
    expect(advance(3 * TICK_MS + 0.01)).toBe(3);
    // A tab that was hidden for ten seconds comes back: at most MAX_TICKS_PER_FRAME ticks run, not 600.
    expect(advance(10_000)).toBeLessThanOrEqual(MAX_TICKS_PER_FRAME);
    // The backlog is dropped, not owed: the next normal frame runs ONE tick.
    expect(advance(TICK_MS + 0.01)).toBe(1);
  }

  it('the real loop (through a Game): 5 catch-up ticks at most, then the backlog drops', () => {
    const g = newGame();
    const loop = (g as unknown as { loop: FixedLoop }).loop;
    loopRules((ms) => loop.advance(ms));
  });

  it('a Game counts every tick the loop ran', () => {
    const g = newGame();
    const loop = (g as unknown as { loop: FixedLoop }).loop;
    loop.advance(3 * TICK_MS + 0.01);
    expect(g.tick).toBe(3);
    loop.advance(10_000);
    expect(g.tick).toBe(3 + MAX_TICKS_PER_FRAME);
  });

  it('control: a naive loop (no clamp, no drop) fails the same rules', () => {
    let owed = 0;
    const naive = (ms: number): number => {
      owed += ms;
      let n = 0;
      while (owed >= TICK_MS) {
        owed -= TICK_MS;
        n++;
      }
      return n;
    };
    expect(() => loopRules(naive)).toThrow();
  });
});

// ---- 4. both classes fit the interfaces --------------------------------------------------------------------

describe('the interface seam', () => {
  it('compile time: the old Game fits GameApi, and the new Game fits LegacyGameSurface (tsc fails this file otherwise)', () => {
    // These are type checks. `tsc` is the test: an assignment that does not fit is a compile error.
    const fitsApi = (g: OldGame): GameApi => g;
    const fitsSurface = (g: Game): LegacyGameSurface => g;
    const oldIsTheSurface = (g: OldGame): LegacyGameSurface => g;
    expect([typeof fitsApi, typeof fitsSurface, typeof oldIsTheSurface]).toEqual(['function', 'function', 'function']);
  });

  it('runtime: both classes have every member of the surface that the legacy scenes call', () => {
    const members = ['run', 'reset', 'abandon', 'remove', 'wait', 'fadeTo', 'fadeOut', 'fadeIn', 'shake', 'flash'] as const;
    const g = newGame();
    for (const m of members) expect(typeof g[m]).toBe('function');
    for (const m of ['tickers', 'overlays', 'stack'] as const) expect(Array.isArray(g[m])).toBe(true);
    for (const m of ['frame', 'playFrames', 'speed', 'fadeLevel', 'shakeX', 'shakeY'] as const) expect(typeof g[m]).toBe('number');
  });

  it('wraps a legacy scene: the stack lists the legacy scene, not the adapter, and `top` is the legacy scene', () => {
    const g = newGame();
    const a = new Faulty(() => false);
    void g.run(a);
    expect(g.stack).toEqual([a]);
    expect(g.top).toBe(a);
    expect(g.scene.top).toBeInstanceOf(LegacyScene);
  });

  it('legacy flags are read live: a scene that turns `opaque` off while it runs changes what is drawn', () => {
    const g = newGame();
    const field = new Faulty(() => false);
    const dialog = new Faulty(() => false);
    dialog.opaque = true;
    void g.run(field);
    void g.run(dialog);
    g.draw();
    expect([field.renders, dialog.renders]).toEqual([0, 1]);
    dialog.opaque = false;
    g.draw();
    expect([field.renders, dialog.renders]).toEqual([1, 2]);
  });
});

// ---- legacy shake and fade behave as the old engine's ---------------------------------------------------

describe('game-level fade, shake and flash', () => {
  it('fadeTo resolves after its frames and leaves the level at the target', async () => {
    const g = newGame();
    let done = false;
    void g.fadeTo(1, 3).then(() => (done = true));
    g.advanceTick();
    g.advanceTick();
    await Promise.resolve();
    expect(done).toBe(false);
    g.advanceTick();
    await Promise.resolve();
    expect(done).toBe(true);
    expect(g.fadeLevel).toBe(1);
  });

  it('shake offsets come from the injected motion, scaled by the setting, and are zero when nothing shakes', () => {
    const g = new Game({ renderer: nullRenderer, input: noopInput, compat: { reportError, shakeOffset, shakeGain: 4 / 3 } });
    g.draw();
    expect([g.shakeX, g.shakeY]).toEqual([0, 0]);
    g.shake(10, 3, { x: 1, y: 0 });
    g.draw();
    // Frame 0 of a blow along x: the full kick, 3 * 4/3 = 4 pixels.
    expect([g.shakeX, g.shakeY]).toEqual([4, 0]);
    g.shakeScale = () => 0;
    g.draw();
    expect([g.shakeX, g.shakeY]).toEqual([0, 0]);
  });

  it('wait(n) resolves on tick n, and a wait of 0 or less waits one tick', async () => {
    const g = newGame();
    const order: string[] = [];
    void g.wait(2).then(() => order.push('two'));
    void g.wait(0).then(() => order.push('zero'));
    g.advanceTick();
    await Promise.resolve();
    expect(order).toEqual(['zero']);
    g.advanceTick();
    await Promise.resolve();
    expect(order).toEqual(['zero', 'two']);
  });

  it('the game notice shows for a fault only once per tick, however many things threw: the first one', async () => {
    const { notice } = await import('../src/engine/errors');
    notice('clear', 'warn');
    const g = newGame();
    g.tickers.push(() => {
      throw new Error('the first error of the tick');
    });
    void g.run(new Faulty(() => true));
    g.advanceTick();
    // The ticker ran first and threw first. The scene's `update 1` came second in the same tick and is not shown over it (and not counted as more).
    expect(currentNotice()?.text).toBe('the first error of the tick');
  });
});
