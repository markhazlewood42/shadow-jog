/**
 * M2 effects, in Node with no GPU (docs/engine/m2-brief.md pass lines 2 and 16):
 *  1. The shared state table (tests/fxstate-cases.ts) runs on the `FxSystem`.
 *     Controls: a mutant of the shared logic (a cap off by one, a `clear` that forgets the delayed calls) fails the matching case.
 *  2. The state step: fields read and write; one `update()` ages the effects once; `ui` marks the UI layer; `clear` drops the delayed layers.
 *     Control: another system's `update` does not age this one.
 *  3. The editor contract, the parts that need the check messages: `loadData` returns what `checkFx` says.
 * The drawing itself is checked in the browser (e2e/sje-fx.spec.ts).
 */
import { describe, expect, it } from 'vitest';
import { FX } from '../src/data/fx';
import { checkFx, type FxData } from '../src/sje/fx/fxdata';
import { FxSystem } from '../src/sje/fx/fxsystem';
import { type FxState, MAX_SHOCKS, type Shock } from '../src/sje/fx/fxstate';
import { caseNamed, runCases } from './fxstate-cases';

/** The shock of `FxState`, with the cap one too high (the mutant). */
function shockOffByOne(fx: FxState, x: number, y: number, o: { strength?: number; reach?: number; life?: number; width?: number } = {}): void {
  if (!fx.active || fx.motion <= 0) return;
  const s: Shock = { x, y, t: 0, life: o.life ?? 26, strength: (o.strength ?? 3) * fx.motion, width: o.width ?? 10, reach: o.reach ?? 90 };
  if (fx.shocks.length > MAX_SHOCKS) fx.shocks.shift();
  fx.shocks.push(s);
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
class NewClearMutant extends FxSystem {
  override clear(): void {
    const saved = keepPending(this);
    super.clear();
    restorePending(this, saved);
  }
}

const newSystem = (): FxSystem => new FxSystem({ seed: 1 });

describe('the shared state table', () => {
  it('every case passes on the FxSystem', () => {
    expect(runCases(newSystem)).toEqual([]);
  });

  it('control: a cap off by one fails the cap case, and nothing else', () => {
    expect(runCases(() => new NewCapMutant())).toEqual([caseNamed('cap')]);
  });

  it('control: a clear that forgets the delayed calls fails the clear case', () => {
    expect(runCases(() => new NewClearMutant())).toEqual([caseNamed('clear')]);
  });
});

describe('the state step of the FxSystem', () => {
  it('fields read and write; update ages once per call; ui marks the layer; clear drops the delayed layers (control: the update of another system changes nothing)', () => {
    const target = newSystem();
    target.active = true;
    target.shock(5, 6, { life: 10 });
    expect(target.shocks.length).toBe(1);
    target.motion = 0.5;
    expect(target.motion).toBe(0.5);
    // A moment layer waiting on the delay (the system's own `update` runs them) fires once, after exactly its frames: one update per tick.
    target.loadData(FX);
    target.playMoment('cast.fire', 100, 100); // its second layer waits 10 frames
    expect(target.snapshot().delayed.length).toBe(1);
    const before = target.time;
    for (let i = 0; i < 9; i++) target.update();
    expect(target.time).toBe(before + 9);
    expect(target.snapshot().delayed.length).toBe(1); // aged once per call: still waiting after 9
    target.update();
    expect(target.snapshot().delayed.length).toBe(0); // and fired on the 10th
    target.playMoment('cast.fire', 100, 100);
    // `ui`: a layer can be set, and it reads back.
    const ctx = {} as CanvasRenderingContext2D;
    target.ui = ctx;
    expect(target.ui).toBe(ctx);
    // `clear` also drops the delayed moment layers, which the base class does not know.
    target.clear();
    expect(target.snapshot().delayed).toEqual([]);
  });

  it('the control for the delayed layers: the update of another system does not age this one (so the check above can fail)', () => {
    const other = newSystem();
    const target = newSystem();
    target.active = true;
    other.active = true;
    target.loadData(FX);
    target.playMoment('cast.fire', 100, 100);
    const waiting = target.snapshot().delayed.length;
    for (let i = 0; i < 200; i++) other.update();
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
