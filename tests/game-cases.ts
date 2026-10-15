/**
 * The shared case table of the Game core: the fault, abandon, curtain, exit-throw and render-fault behavior (docs/engine/m1-brief.md task 14).
 *
 * `tests/sje-game.test.ts` runs them on the `Game` of the engine (until M8d the old engine's `Game` ran the same table; M8d deleted that class). A case is a plain async function
 * (`run`) so a test can also call it on a deliberately broken `Game` and expect it to throw (the negative controls in `tests/sje-game.test.ts`).
 *
 * A "subject" is a `Game` plus the two calls that run one tick and one draw (`advanceTick()` and `draw()`). The scenes of the cases are native `sje` scenes: `Faulty` counts
 * its ticks (`fixedUpdate`) and its draws (the `prerender` event), and fails on demand.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../src/sje/core/canvas';
import { currentNotice } from '../src/sje/core/errors';
import type { Input } from '../src/sje/runtime/inputdevice';
import type { Game } from '../src/sje/runtime/game';
import { Scene } from '../src/sje/runtime/scene';

// performance.now() drives notice lifetime; node has it. Console noise from reportError is expected.
vi.spyOn(console, 'error').mockImplementation(() => undefined);

export const noopInput = { update: () => undefined, endFrame: () => undefined, consume: () => undefined } as unknown as Input;
const noop = () => undefined;
export const proxyCtx = new Proxy({}, { get: () => noop, set: () => true }) as unknown as Ctx;

/** A `Game` and the two calls that are named differently on the two classes. */
export interface Subject {
  game: Pick<Game, 'run' | 'tickers' | 'overlays' | 'onFault' | 'abandon' | 'scene' | 'wait'>;
  /** One fixed tick: `advanceTick()`. */
  tick(): void;
  /** One drawn frame: `draw()`. */
  render(): void;
}

export type MakeSubject = (input: Input) => Subject;

/**
 * A native scene that throws on demand, and counts what it was asked to do. `render` runs on each `prerender` event (a draw of a visible scene) and `exit` on `shutdown`;
 * both are looked up when they run, so a case can replace them on the instance.
 */
export class Faulty extends Scene<void> {
  updates = 0;
  renders = 0;
  constructor(private failUpdate: (n: number) => boolean, private failRender = false) {
    super();
  }
  override create(): void {
    this.events.on('prerender', () => this.render());
    this.events.on('shutdown', () => this.exit());
  }
  fixedUpdate(): void {
    this.updates++;
    if (this.failUpdate(this.updates)) throw new Error(`update ${this.updates}`);
  }
  render(): void {
    this.renders++;
    if (this.failRender) throw new Error('render');
  }
  exit(): void {}
}

export interface Case {
  name: string;
  run(make: MakeSubject, faultLimit: number): Promise<void>;
}

export const GAME_CASES: Case[] = [
  {
    name: 'reports a one-off exception and keeps ticking',
    async run(make) {
      const g = make(noopInput);
      const s = new Faulty((n) => n === 2);
      void g.game.run(s);
      for (let i = 0; i < 5; i++) g.tick();
      expect(s.updates).toBe(5);
      expect(currentNotice()?.text).toBe('update 2');
      expect(currentNotice()?.tone).toBe('error');
    },
  },
  {
    name: 'drops a ticker or overlay that throws, once, and keeps running',
    async run(make) {
      const g = make(noopInput);
      let good = 0;
      g.game.tickers.push(() => {
        throw new Error('bad ticker');
      });
      g.game.tickers.push(() => {
        good++;
      });
      g.game.overlays.push(() => {
        throw new Error('bad overlay');
      });
      for (let i = 0; i < 5; i++) {
        g.tick();
        g.render();
      }
      expect(g.game.tickers.length).toBe(1);
      expect(g.game.overlays.length).toBe(0);
      expect(good).toBe(5);
    },
  },
  {
    name: 'keeps rendering overlays when a scene render throws',
    async run(make) {
      const g = make(noopInput);
      let overlays = 0;
      g.game.overlays.push(() => overlays++);
      void g.game.run(new Faulty(() => false, true));
      g.render();
      g.render();
      expect(overlays).toBe(2);
    },
  },
  {
    name: 'trips onFault once after FAULT_LIMIT consecutive bad ticks, not for intermittent ones',
    async run(make, limit) {
      const g = make(noopInput);
      let faults = 0;
      g.game.onFault = () => faults++;
      void g.game.run(new Faulty((n) => n % 2 === 0));
      for (let i = 0; i < limit * 3; i++) g.tick();
      expect(faults).toBe(0);
      g.game.abandon();
      void g.game.run(new Faulty(() => true));
      for (let i = 0; i < limit; i++) g.tick();
      expect(faults).toBe(1);
    },
  },
  {
    name: 'trips onFault when only render throws, every frame (a frozen picture is a softlock too)',
    async run(make, limit) {
      const g = make(noopInput);
      let faults = 0;
      g.game.onFault = () => {
        faults++;
        g.game.abandon();
      };
      const s = new Faulty(() => false, true);
      void g.game.run(s);
      for (let i = 0; i < limit - 1; i++) {
        g.tick();
        g.render();
      }
      expect(faults).toBe(0);
      g.tick();
      g.render();
      expect(faults).toBe(1);
      expect(g.game.scene.scenes.length).toBe(0);
    },
  },
  {
    name: 'an intermittent render fault never trips recovery',
    async run(make, limit) {
      const g = make(noopInput);
      let faults = 0;
      g.game.onFault = () => faults++;
      let n = 0;
      const s = new Faulty(() => false);
      s.render = () => {
        if (++n % 2 === 0) throw new Error('every other frame');
      };
      void g.game.run(s);
      for (let i = 0; i < limit * 3; i++) g.render();
      expect(faults).toBe(0);
    },
  },
  {
    name: 'a scene whose exit() throws still leaves the stack cleanly (and says so)',
    async run(make) {
      const { notice } = await import('../src/sje/core/errors');
      notice('clear', 'warn');
      const g = make(noopInput);
      const a = new Faulty(() => false);
      const b = new Faulty(() => false);
      b.exit = () => {
        throw new Error('bad cleanup');
      };
      void g.game.run(a);
      void g.game.run(b);
      b.close();
      expect(g.game.scene.scenes).toEqual([a]);
      expect(currentNotice()?.text).toContain('bad cleanup');
    },
  },
  {
    name: 'draws only the topmost curtain over the world: menus under it are not repainted',
    async run(make) {
      const g = make(noopInput);
      const field = new Faulty(() => false);
      const menu = Object.assign(new Faulty(() => false), { opaque: false, curtain: true });
      const dialog = Object.assign(new Faulty(() => false), { opaque: false });
      const options = Object.assign(new Faulty(() => false), { opaque: false, curtain: true });
      const toast = Object.assign(new Faulty(() => false), { opaque: false });
      void g.game.run(field);
      void g.game.run(menu);
      void g.game.run(dialog);
      void g.game.run(options);
      void g.game.run(toast);
      g.render();
      expect([field, menu, dialog, options, toast].map((s) => s.renders)).toEqual([1, 0, 0, 1, 1]);
    },
  },
  {
    name: 'abandon() drops scenes and timers without resolving them',
    async run(make) {
      const g = make(noopInput);
      let woke = false;
      void g.game.wait(2).then(() => (woke = true));
      void g.game.run(new Faulty(() => false));
      g.game.abandon();
      for (let i = 0; i < 5; i++) g.tick();
      await Promise.resolve();
      expect(woke).toBe(false);
      expect(g.game.scene.scenes.length).toBe(0);
    },
  },
  {
    // Last in the table: its notice would otherwise be what the cases above read.
    name: 'input polling that throws (a blocked Gamepad API) is reported, and the scene still ticks',
    async run(make, limit) {
      const throwing = {
        ...noopInput,
        update: () => {
          throw new Error('gamepad blocked');
        },
      } as unknown as Input;
      vi.mocked(console.error).mockClear();
      const g = make(throwing);
      const s = new Faulty(() => false);
      void g.game.run(s);
      for (let i = 0; i < limit + 5; i++) g.tick();
      // Every tick still reached the scene, and a persistent input failure never tripped recovery.
      expect(s.updates).toBe(limit + 5);
      expect(g.game.scene.scenes.includes(s)).toBe(true);
      // Reported once (the on-screen notice merges with earlier cases' ones; the log doesn't).
      const logged = vi.mocked(console.error).mock.calls.filter((c) => String(c[1]).includes('gamepad blocked'));
      expect(logged.length).toBe(1);
    },
  },
];

/** Register the table as tests for one `Game` class. */
export function defineGameCases(label: string, make: MakeSubject, faultLimit: number): void {
  describe(`${label}: game fault isolation (shared case table)`, () => {
    for (const c of GAME_CASES) it(c.name, () => c.run(make, faultLimit));
  });
}

/** The case with this name. A control uses it to run one case against a broken `Game`. */
export function caseNamed(part: string): Case {
  const found = GAME_CASES.filter((c) => c.name.includes(part));
  if (found.length !== 1) throw new Error(`caseNamed("${part}") matched ${found.length} cases`);
  return found[0] as Case;
}

