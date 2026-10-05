/**
 * The hack simulation (src/hack3d/sim/hacksim.ts): pure, fixed-step, seeded. Node only, no browser:
 * the simulation never touches Three, Pixi or the DOM, so these tests run like tests/battle.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { DESPAWN_Z, HIT_RADIUS, HackSim, PERSONA_Z, RUN_SPEED, type SimDef, SPAWN_FAR, SPAWN_NEAR } from '../src/hack3d/sim/hacksim';

const DEF: SimDef = { seed: 7, ticks: 900, iceCount: 4, traceLimit: 100, hitCost: 14 };

/** Everything the picture depends on, as plain JSON (so two runs can be compared exactly). */
const state = (s: HackSim) => JSON.stringify({ tick: s.tick, travel: s.travel, trace: s.trace, hits: s.hits, status: s.status, persona: s.persona, ice: s.ice });

describe('determinism: the same seed and the same ticks give the same state', () => {
  it('two simulations of one definition stay identical for 2000 ticks', () => {
    const a = new HackSim({ ...DEF, ticks: 5000 });
    const b = new HackSim({ ...DEF, ticks: 5000 });
    for (let i = 0; i < 2000; i++) {
      a.step();
      b.step();
      if (i % 250 === 0) expect(state(a)).toBe(state(b));
    }
    expect(state(a)).toBe(state(b));
  });

  it('a different seed runs a different hack', () => {
    const a = new HackSim(DEF);
    const b = new HackSim({ ...DEF, seed: 8 });
    a.run(300);
    b.run(300);
    expect(state(a)).not.toBe(state(b));
  });

  it('run(n) is exactly n calls of step()', () => {
    const a = new HackSim(DEF);
    const b = new HackSim(DEF);
    a.run(333);
    for (let i = 0; i < 333; i++) b.step();
    expect(state(a)).toBe(state(b));
  });

  it('golden numbers for seed 7, four pieces of ICE, hit cost 14 (a change here changes the look of every test)', () => {
    const s = new HackSim(DEF);
    const at = (t: number) => {
      s.run(t - s.tick);
      return { tick: s.tick, hits: s.hits, trace: s.tracePercent };
    };
    expect(at(60)).toEqual({ tick: 60, hits: 0, trace: 0 });
    expect(at(120)).toEqual({ tick: 120, hits: 1, trace: 14 });
    expect(at(200)).toEqual({ tick: 200, hits: 2, trace: 28 });
    expect(at(400)).toEqual({ tick: 400, hits: 3, trace: 42 });
    expect(at(600)).toEqual({ tick: 600, hits: 6, trace: 84 });
  });
});

describe('the start: ICE is spread down the grid, all of it ahead of the persona', () => {
  it.each([1, 2, 3, 4, 5])('%i piece(s) of ICE start between the far and the near spawn line, nearest first, strictly ordered', (n) => {
    const zs = new HackSim({ ...DEF, iceCount: n }).ice.map((i) => i.z);
    for (const z of zs) {
      expect(z).toBeLessThanOrEqual(SPAWN_NEAR);
      expect(z).toBeGreaterThan(SPAWN_FAR);
      // Nothing starts behind the persona (z = 0), where it could never score a hit.
      expect(z).toBeLessThan(PERSONA_Z);
    }
    // The first piece is the nearest, each next one is farther down the grid (more negative).
    for (let i = 1; i < zs.length; i++) expect(zs[i] as number).toBeLessThan(zs[i - 1] as number);
  });
});

describe('how a hack ends', () => {
  it('succeeds when its time runs out, on exactly the tick it was given', () => {
    const s = new HackSim({ ...DEF, ticks: 120, traceLimit: 100, hitCost: 0 });
    s.run(119);
    expect(s.status).toBe('running');
    s.step();
    expect(s.status).toBe('success');
    expect(s.tick).toBe(120);
  });

  it('fails the moment TRACE reaches the limit, and at the same tick every time', () => {
    const run = () => {
      const s = new HackSim({ ...DEF, traceLimit: 14 });
      s.run(5000);
      return { status: s.status, tick: s.tick, trace: s.trace };
    };
    const first = run();
    expect(first.status).toBe('fail');
    expect(first.trace).toBeGreaterThanOrEqual(14);
    expect(first.tick).toBeGreaterThan(0);
    expect(first.tick).toBeLessThan(120);
    expect(run()).toEqual(first);
  });

  it('a limit ABOVE 100 can never fail, and TRACE never passes 100', () => {
    const s = new HackSim({ ...DEF, ticks: 20000, traceLimit: 101, hitCost: 60 });
    s.run(20000);
    expect(s.status).toBe('success');
    expect(s.trace).toBe(100);
    expect(s.tracePercent).toBe(100);
  });

  it('a limit of exactly 100 fails the tick TRACE fills up (the boundary of the rule above)', () => {
    const s = new HackSim({ ...DEF, ticks: 20000, traceLimit: 100, hitCost: 60 });
    s.run(20000);
    expect(s.status).toBe('fail');
    expect(s.trace).toBe(100);
    // The same hack with a limit one higher ends in success: the two limits differ by this one point only.
    const above = new HackSim({ ...DEF, ticks: 20000, traceLimit: 101, hitCost: 60 });
    above.run(s.tick);
    expect(above.status).toBe('running');
  });

  it('does nothing after it has ended', () => {
    const s = new HackSim({ ...DEF, ticks: 10 });
    s.run(10);
    expect(s.status).toBe('success');
    const frozen = state(s);
    s.run(50);
    s.step();
    expect(state(s)).toBe(frozen);
  });
});

describe('the persona and the ICE', () => {
  it('the number of pieces of ICE is clamped to 1 through 5, and each has a kind', () => {
    expect(new HackSim({ ...DEF, iceCount: 0 }).ice).toHaveLength(1);
    expect(new HackSim({ ...DEF, iceCount: 3 }).ice).toHaveLength(3);
    expect(new HackSim({ ...DEF, iceCount: 99 }).ice).toHaveLength(5);
    expect(new HackSim({ ...DEF, iceCount: 4 }).ice.map((i) => i.kind)).toEqual(['icosahedron', 'cube', 'chip', 'shard']);
  });

  it('the persona weaves inside the lane, and every number stays finite over 20000 ticks (the world is re-used, not left behind)', () => {
    const s = new HackSim({ ...DEF, ticks: 20000, traceLimit: 1000 });
    for (let i = 0; i < 20000; i++) {
      s.step();
      expect(Math.abs(s.persona.x)).toBeLessThanOrEqual(5.7);
      for (const ice of s.ice) {
        expect(ice.z).toBeLessThanOrEqual(DESPAWN_Z + RUN_SPEED);
        expect(ice.z).toBeGreaterThanOrEqual(SPAWN_FAR - 1);
        expect(Number.isFinite(ice.x + ice.y + ice.z + ice.rx + ice.ry + ice.rz)).toBe(true);
      }
    }
    expect(s.tick).toBe(20000);
  });

  it('ICE comes toward the persona (z grows) and is re-spawned far ahead when it has gone past', () => {
    const s = new HackSim({ ...DEF, ticks: 20000, traceLimit: 1000 });
    const first = s.ice[0];
    if (!first) throw new Error('no ice');
    let respawned = 0;
    let last = first.z;
    for (let i = 0; i < 1200; i++) {
      s.step();
      if (first.z < last) respawned++;
      else expect(first.z - last).toBeCloseTo(RUN_SPEED, 6);
      last = first.z;
    }
    expect(respawned).toBeGreaterThanOrEqual(2);
  });

  it('a hit needs the ICE to cross the persona in the same lane (within the hit radius)', () => {
    // Replay a run and recompute the hits from the positions: it must agree with what the simulation counted.
    const s = new HackSim({ ...DEF, ticks: 3000, traceLimit: 1000, hitCost: 1 });
    let counted = 0;
    const prevZ = s.ice.map((i) => i.z);
    for (let i = 0; i < 3000; i++) {
      s.step();
      s.ice.forEach((ice, k) => {
        const before = prevZ[k] ?? 0;
        // It crossed z = 0 this tick (and was not just re-spawned).
        if (before < PERSONA_Z && ice.z >= PERSONA_Z && Math.abs(ice.x - s.persona.x) < HIT_RADIUS) counted++;
        prevZ[k] = ice.z;
      });
    }
    expect(counted).toBe(s.hits);
    expect(s.hits).toBeGreaterThan(0);
  });
});
