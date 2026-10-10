/**
 * ONE table of state cases for the effects (docs/engine/m2-brief.md pass line 2), run against every `FxState`: the old `postfx` (tests/gpufx.test.ts)
 * and the new `FxSystem`, plain and routed (tests/sje-fx.test.ts). The logic is one copy (src/sje/fx/fxstate.ts), so the table is one copy too.
 * A case throws (a failed `expect`) when the state is wrong. `runCases` returns the names of the cases that threw, which is how the mutant
 * controls ask "did the matching case fail?".
 */
import { expect } from 'vitest';
import { envelope, type FxState, MAX_GLITCHES, MAX_HAZES, MAX_SHOCKS } from '../src/sje/fx/fxstate';
import type { EmitterPreset } from '../src/sje/fx/particles';

const dot: EmitterPreset = { count: [5, 5], life: [10, 10], speed: [1, 1], angle: 0, spread: 0, size: [2, 2], colors: ['#ff0000'], alpha: [1, 0], shape: 'dot' };

/** What `make` must give: an effects state that is switched on by the case (a headless one has no GPU, so the case sets `active`). */
export type MakeFx = () => FxState;

export interface StateCase {
  name: string;
  run(fx: FxState): void;
}

export const STATE_CASES: StateCase[] = [
  {
    name: 'inactive: every effect call does nothing',
    run(fx) {
      fx.active = false;
      fx.shock(1, 1);
      fx.haze(1, 1);
      fx.glitch(1, 1);
      fx.dim(0.5);
      fx.flare(1);
      fx.aberrate(3);
      fx.emit(dot, 0, 0);
      let ran = 0;
      fx.later(1, () => ran++);
      fx.update();
      fx.update();
      expect([fx.shocks.length, fx.hazes.length, fx.glitches.length, fx.dimAmount, fx.pulse, fx.aberration, fx.particles.count, ran]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    },
  },
  {
    name: 'spawn: the comfort settings scale them, and motion 0 and intensity 0 switch them off',
    run(fx) {
      fx.active = true;
      fx.motion = 0.5;
      fx.shock(10, 20, { strength: 4 });
      fx.haze(1, 2, { strength: 2 });
      fx.glitch(3, 4, { strength: 8 });
      expect([fx.shocks[0]?.strength, fx.hazes[0]?.strength, fx.glitches[0]?.strength]).toEqual([2, 1, 4]);
      expect([fx.shocks[0]?.x, fx.shocks[0]?.y]).toEqual([10, 20]);
      fx.intensity = 0.5;
      fx.aberrate(4, 7, 9);
      fx.flare(1);
      expect([fx.aberration, fx.aberrationX, fx.aberrationY, fx.pulse]).toEqual([2, 7, 9, 0.5]);
      fx.clear();
      fx.motion = 0;
      fx.intensity = 0;
      fx.shock(0, 0);
      fx.haze(0, 0);
      fx.glitch(0, 0);
      fx.aberrate(3);
      fx.flare(1);
      expect([fx.shocks.length, fx.hazes.length, fx.glitches.length, fx.aberration, fx.pulse]).toEqual([0, 0, 0, 0, 0]);
    },
  },
  {
    name: 'cap: 4 shocks, 4 hazes and 2 glitches; the oldest one goes',
    run(fx) {
      fx.active = true;
      for (let i = 0; i < MAX_SHOCKS + 2; i++) fx.shock(i, 0);
      for (let i = 0; i < MAX_HAZES + 2; i++) fx.haze(i, 0);
      for (let i = 0; i < MAX_GLITCHES + 2; i++) fx.glitch(i, 0);
      expect([fx.shocks.length, fx.hazes.length, fx.glitches.length]).toEqual([4, 4, 2]);
      expect(fx.shocks.map((s) => s.x)).toEqual([2, 3, 4, 5]);
      expect(fx.hazes.map((s) => s.x)).toEqual([2, 3, 4, 5]);
      expect(fx.glitches.map((s) => s.x)).toEqual([2, 3]);
    },
  },
  {
    name: 'envelope: in over fadeIn, out over fadeOut, zero outside the life',
    run() {
      expect(envelope(0, 60, 8, 20)).toBe(0);
      expect(envelope(4, 60, 8, 20)).toBe(0.5);
      expect(envelope(30, 60, 8, 20)).toBe(1);
      expect(envelope(50, 60, 8, 20)).toBe(0.5);
      expect(envelope(60, 60, 8, 20)).toBe(0);
      expect(envelope(-1, 60, 8, 20)).toBe(0);
    },
  },
  {
    name: 'update: effects age and end on their life, the clock runs, the color split and the pulse fade, a slower rate ages less',
    run(fx) {
      fx.active = true;
      fx.shock(0, 0, { life: 10 });
      fx.haze(0, 0, { life: 6 });
      fx.glitch(0, 0, { life: 4 });
      fx.aberrate(3);
      fx.flare(1);
      for (let i = 0; i < 5; i++) fx.update();
      expect([fx.shocks.length, fx.hazes.length, fx.glitches.length, fx.time]).toEqual([1, 1, 0, 5]);
      expect(fx.aberration).toBeLessThan(3);
      expect(fx.pulse).toBeLessThan(1);
      for (let i = 0; i < 5; i++) fx.update();
      expect([fx.shocks.length, fx.hazes.length]).toEqual([0, 0]);
      for (let i = 0; i < 80; i++) fx.update();
      expect([fx.aberration, fx.pulse]).toEqual([0, 0]);
      // A slower clock: the same life lasts twice as many updates.
      fx.rate = 0.5;
      fx.shock(0, 0, { life: 10 });
      for (let i = 0; i < 19; i++) fx.update();
      expect(fx.shocks.length).toBe(1);
      fx.update();
      expect(fx.shocks.length).toBe(0);
    },
  },
  {
    name: 'dim: a deeper dim wins and a shallower one does not, and it ends',
    run(fx) {
      fx.active = true;
      fx.dim(0.5, 60);
      for (let i = 0; i < 30; i++) fx.update();
      expect(fx.dimNow).toBe(0.5);
      fx.dim(0.3, 60);
      expect(fx.dimAmount).toBe(0.5);
      expect(fx.dimT).toBe(30);
      fx.dim(0.8, 40);
      expect([fx.dimAmount, fx.dimT, fx.dimLife]).toEqual([0.8, 0, 40]);
      for (let i = 0; i < 40; i++) fx.update();
      expect([fx.dimAmount, fx.dimLife, fx.dimNow]).toEqual([0, 0, 0]);
    },
  },
  {
    name: 'later: runs on the effects clock after its frames, once; not before',
    run(fx) {
      fx.active = true;
      let ran = 0;
      fx.later(3, () => ran++);
      fx.update();
      fx.update();
      expect(ran).toBe(0);
      fx.update();
      expect(ran).toBe(1);
      for (let i = 0; i < 5; i++) fx.update();
      expect(ran).toBe(1);
      // The effects clock: at rate 0.5 the call waits twice as long.
      fx.rate = 0.5;
      fx.later(2, () => ran++);
      fx.update();
      fx.update();
      fx.update();
      expect(ran).toBe(1);
      fx.update();
      expect(ran).toBe(2);
    },
  },
  {
    name: 'clear: drops every effect, the particles and the delayed calls, the clip and the rate',
    run(fx) {
      fx.active = true;
      let ran = 0;
      fx.shock(0, 0);
      fx.haze(0, 0);
      fx.glitch(0, 0);
      fx.dim(0.5);
      fx.aberrate(3);
      fx.flare(1);
      fx.emit(dot, 0, 0);
      fx.later(2, () => ran++);
      fx.clip = { x: 0, y: 0, w: 10, h: 10 };
      fx.rate = 0.25;
      fx.clear();
      expect([fx.shocks.length, fx.hazes.length, fx.glitches.length, fx.dimAmount, fx.aberration, fx.pulse, fx.particles.count, fx.pendingCalls]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
      expect([fx.clip, fx.rate]).toEqual([null, 1]);
      for (let i = 0; i < 5; i++) fx.update();
      expect(ran).toBe(0);
    },
  },
];

/** Run every case on a fresh state from `make`. Returns the names of the cases that failed (an `expect` threw). */
export function runCases(make: MakeFx): string[] {
  const failed: string[] = [];
  for (const c of STATE_CASES) {
    try {
      c.run(make());
    } catch {
      failed.push(c.name);
    }
  }
  return failed;
}

/** The first word of a case name (`cap`, `clear`, ...), for a mutant control to name its case. */
export const caseNamed = (word: string): string => {
  const c = STATE_CASES.find((x) => x.name.startsWith(`${word}:`));
  if (!c) throw new Error(`no case named ${word}`);
  return c.name;
};
