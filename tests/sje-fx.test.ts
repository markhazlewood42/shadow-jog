/**
 * M2 effects, in Node with no GPU (docs/engine/m2-brief.md pass lines 2 and 16):
 *  1. The shared state table (tests/fxstate-cases.ts) runs on the new `FxSystem`, and on the old `postfx` once it is routed to an `FxSystem`.
 *     Controls: a mutant of the shared logic (a cap off by one, a `clear` that forgets the delayed calls) fails the matching case, on the old
 *     class and on the new one.
 *  2. Routing (src/sje/fx/route.ts): a call on `postfx` is a call on the system; one `update()` ages the effects once; `ui` marks the UI layer.
 *     Control: after the undo, `postfx` is itself again and the system sees nothing.
 *  3. The editor contract, the parts that need the check messages: `loadData` returns what `checkFx` says.
 * The drawing itself is checked in the browser (e2e/sje-fx.spec.ts).
 */
import { describe, expect, it } from 'vitest';
import { FX } from '../src/data/fx';
import { PostFx } from '../src/engine/postfx';
import { checkFx, type FxData } from '../src/sje/fx/fxdata';
import { FxSystem } from '../src/sje/fx/fxsystem';
import { type FxState, MAX_SHOCKS, type Shock } from '../src/sje/fx/fxstate';
import { routePostfx } from '../src/sje/fx/route';
import { caseNamed, runCases } from './fxstate-cases';

/** The shock of `FxState`, with the cap one too high (the mutant). */
function shockOffByOne(fx: FxState, x: number, y: number, o: { strength?: number; reach?: number; life?: number; width?: number } = {}): void {
  if (!fx.active || fx.motion <= 0) return;
  const s: Shock = { x, y, t: 0, life: o.life ?? 26, strength: (o.strength ?? 3) * fx.motion, width: o.width ?? 10, reach: o.reach ?? 90 };
  if (fx.shocks.length > MAX_SHOCKS) fx.shocks.shift();
  fx.shocks.push(s);
}

class OldCapMutant extends PostFx {
  override shock(x: number, y: number, o?: { strength?: number; reach?: number; life?: number; width?: number }): void {
    shockOffByOne(this, x, y, o);
  }
}
class NewCapMutant extends FxSystem {
  override shock(x: number, y: number, o?: { strength?: number; reach?: number; life?: number; width?: number }): void {
    shockOffByOne(this, x, y, o);
  }
}

// The delayed-call list is private to FxState: the mutant keeps a copy and puts it back after `clear`.
function keepPending(fx: FxState): { calls: unknown[] } {
  return { calls: [...(fx as unknown as { pending: unknown[] }).pending] };
}
function restorePending(fx: FxState, saved: { calls: unknown[] }): void {
  (fx as unknown as { pending: unknown[] }).pending.push(...saved.calls);
}
class OldClearMutant extends PostFx {
  override clear(): void {
    const saved = keepPending(this);
    super.clear();
    restorePending(this, saved);
  }
}
class NewClearMutant extends FxSystem {
  override clear(): void {
    const saved = keepPending(this);
    super.clear();
    restorePending(this, saved);
  }
}

const newSystem = (): FxSystem => new FxSystem({ seed: 1 });

describe('the shared state table', () => {
  it('every case passes on the new FxSystem, and on the old postfx routed to an FxSystem', () => {
    expect(runCases(newSystem)).toEqual([]);
    expect(runCases(() => {
      const local = new PostFx();
      const target = newSystem();
      routePostfx(local, () => target);
      return local;
    })).toEqual([]);
  });

  it('control: a cap off by one fails the cap case, on the old class and on the new one, and nothing else', () => {
    expect(runCases(() => new OldCapMutant())).toEqual([caseNamed('cap')]);
    expect(runCases(() => new NewCapMutant())).toEqual([caseNamed('cap')]);
  });

  it('control: a clear that forgets the delayed calls fails the clear case, on the old class and on the new one', () => {
    expect(runCases(() => new OldClearMutant())).toEqual([caseNamed('clear')]);
    expect(runCases(() => new NewClearMutant())).toEqual([caseNamed('clear')]);
  });
});

describe('routing postfx to the FxSystem', () => {
  it('a call on postfx is a call on the system; fields read and write through; update ages once; ui marks the layer (control: after the undo, none of it)', () => {
    const local = new PostFx();
    const target = newSystem();
    target.active = true;
    const undo = routePostfx(local, () => target);
    // The state is the system's, reached through the old name.
    expect(local.active).toBe(true);
    local.shock(5, 6, { life: 10 });
    expect(target.shocks.length).toBe(1);
    expect(local.shocks).toBe(target.shocks);
    local.motion = 0.5;
    expect(target.motion).toBe(0.5);
    // A moment layer waiting on the delay (the system's own `update` runs them) fires once, after exactly its frames: one update per tick.
    target.loadData(FX);
    target.playMoment('cast.fire', 100, 100); // its second layer waits 10 frames
    expect(target.snapshot().delayed.length).toBe(1);
    const before = target.time;
    for (let i = 0; i < 9; i++) local.update();
    expect(target.time).toBe(before + 9);
    expect(target.snapshot().delayed.length).toBe(1); // aged once per call: still waiting after 9
    local.update();
    expect(target.snapshot().delayed.length).toBe(0); // and fired on the 10th
    target.playMoment('cast.fire', 100, 100);
    // `ui`: the system's accessor runs (a scene that reads the UI layer is about to draw into it), and a layer can be set through the old name.
    const ctx = {} as CanvasRenderingContext2D;
    local.ui = ctx;
    expect(target.ui).toBe(ctx);
    expect(local.ui).toBe(ctx);
    // The method the system overrides is the one that runs: `clear` also drops the delayed moment layers, which the base class does not know.
    local.clear();
    expect(target.snapshot().delayed).toEqual([]);

    undo();
    local.active = false;
    expect(target.active).toBe(true);
    local.active = true;
    local.shock(1, 1);
    expect(local.shocks).not.toBe(target.shocks);
    expect(target.shocks.length).toBe(0);
  });

  it('the control for the delayed layers: without routing, the old postfx does not run them (so the check above can fail)', () => {
    const local = new PostFx();
    const target = newSystem();
    target.active = true;
    target.loadData(FX);
    target.playMoment('cast.fire', 100, 100);
    const waiting = target.snapshot().delayed.length;
    local.active = true;
    for (let i = 0; i < 200; i++) local.update();
    expect(target.snapshot().delayed.length).toBe(waiting);
  });
});

describe('loadData reports what checkFx reports', () => {
  it('bad data returns the same messages as checkFx, and good data returns none (control)', () => {
    const fx = newSystem();
    const bad = JSON.parse(JSON.stringify(FX)) as FxData;
    bad.moments.crit?.layers.push({ emit: 'no_such_preset' });
    expect(checkFx(bad).length).toBeGreaterThan(0);
    expect(fx.loadData(bad)).toEqual(checkFx(bad));
    expect(fx.data).toBeNull();
    expect(fx.loadData(FX)).toEqual([]);
    expect(fx.data).toBe(FX);
  });
});
