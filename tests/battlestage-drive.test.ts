/**
 * The headless battle driver (src/battlestage/battledrive.ts; M3 task 7, pass lines 3 and 12).
 *
 * Pass line 3: the driver with seed 7 gives a status trace byte-identical to the legacy path (the engine called the way the shipped battle scene calls it), for the
 * street and the sewer. Controls: seed 8 differs; a driver whose display chain is broken (it drops the tp events, or the downs) disagrees with the engine and its
 * trace differs; an empty trace is refused (so "equal" cannot mean "both empty").
 * Pass line 12 (part): `step(n)` is n ticks, however the ticks are split.
 */
import { describe, expect, it } from 'vitest';
import { applyEvent, BattleDrive, battleTrace, type DriveSetup, legacyTrace, makeScript, setupFor } from '../src/battlestage/battledrive';
import type { BattleEvent } from '../src/battle/types';
import { stageOf } from '../src/battlestage/config';
import { fixtureStages, shippedStages } from './stagefiles';

// The frozen fixture, not Mark's files: this is a test of the driver (an algorithm), and he edits the shipped demo rosters in the Battle Stage Editor. The last test of the first group
// checks the same equality on the shipped data, as an invariant (it pins none of his numbers).
const stages = fixtureStages();
const stage = (id: string) => stageOf(stages, id);

/** The fights of the two shipped stages: a mixed group and the boss with helpers. */
const FIGHTS: Array<[string, string]> = [
  ['street', '3'],
  ['sewer', '3'],
  ['street', 'boss+1'],
  ['sewer', 'boss+1'],
];

describe('the status trace (pass line 3)', () => {
  for (const [id, group] of FIGHTS) {
    it(`${id} "${group}": the driver's trace for seed 7 equals the legacy path's, line for line`, () => {
      const setup = setupFor(stage(id), group, 7);
      const legacy = legacyTrace(setup);
      const driven = battleTrace(setup);
      // A comparison of two empty lists would pass for the wrong reason.
      expect(legacy.trace.length).toBeGreaterThan(3);
      expect(driven.trace).toEqual(legacy.trace);
      expect(driven.outcome).toBe(legacy.outcome);
      expect(driven.rounds).toBe(legacy.rounds);
      // The display and the engine never disagreed at the end of an action.
      expect(driven.drift).toBe(0);
    });

    it(`${id} "${group}": control, seed 8 gives another trace (on both paths), so the equality above is about the seed's fight`, () => {
      const a = legacyTrace(setupFor(stage(id), group, 7)).trace.join('\n');
      const b = legacyTrace(setupFor(stage(id), group, 8)).trace.join('\n');
      expect(b).not.toBe(a);
      expect(battleTrace(setupFor(stage(id), group, 8)).trace.join('\n')).not.toBe(battleTrace(setupFor(stage(id), group, 7)).trace.join('\n'));
      // And the driver for seed 8 is still the legacy path for seed 8.
      expect(battleTrace(setupFor(stage(id), group, 8)).trace).toEqual(legacyTrace(setupFor(stage(id), group, 8)).trace);
    });
  }

  it('control: a driver that drops the status events from the display disagrees with the engine, and its trace differs from the legacy one', () => {
    const setup = setupFor(stage('street'), 'boss+1', 7);
    const legacy = legacyTrace(setup);
    for (const dropped of ['status'] as const) {
      const broken: DriveSetup = { ...setup, apply: (disp, e) => (e.t === dropped ? undefined : applyEvent(disp, e)) };
      const driven = battleTrace(broken);
      expect(driven.drift, `dropping ${dropped}`).toBeGreaterThan(0);
      expect(driven.trace, `dropping ${dropped}`).not.toEqual(legacy.trace);
    }
  });

  it('control: a driver with a wrong order policy (the first hero guards) gives another trace than the legacy path with the game\'s Auto', () => {
    const setup = setupFor(stage('street'), '3', 7);
    const guarding: DriveSetup = { ...setup, orders: (b) => b.party.filter((p) => p.hp > 0).map((p, i) => (i === 0 ? { actor: p.uid, type: 'guard' as const } : { actor: p.uid, type: 'attack' as const, target: -1 })) };
    expect(battleTrace(guarding).trace).not.toEqual(legacyTrace(setup).trace);
    // The same wrong policy on both paths is the same trace again (the driver follows the orders it is given, whatever they are).
    expect(battleTrace(guarding).trace).toEqual(legacyTrace(guarding).trace);
  });

  it('the same equality on the shipped stages, as an invariant: whatever Mark has in the demo rosters, the driver and the legacy path agree', () => {
    const shipped = shippedStages();
    for (const id of ['street', 'sewer']) {
      const setup = setupFor(stageOf(shipped, id), '3', 7);
      expect(battleTrace(setup).trace).toEqual(legacyTrace(setup).trace);
    }
  });

  it('a fight ends: win or lose, inside the round cap, and the last line shows it', () => {
    for (const [id, group] of FIGHTS) {
      const r = battleTrace(setupFor(stage(id), group, 7));
      expect(r.outcome === 'win' || r.outcome === 'lose' || r.outcome === null).toBe(true);
      expect(r.rounds).toBeLessThanOrEqual(12);
      expect(r.ticks).toBeGreaterThan(100);
    }
  });
});

describe('step(n) is n ticks (pass line 12, part)', () => {
  // The boss group with a helper: a long fight (about 11 rounds), so every tick count tried below is inside it.
  const setup = (): DriveSetup => setupFor(stage('street'), 'boss+1', 7);

  it('stepping 1 tick at a time n times equals stepping n at once, at every n tried', () => {
    for (const n of [1, 7, 30, 31, 54, 120, 500, 2000]) {
      const one = new BattleDrive(setup());
      for (let i = 0; i < n; i++) one.step(1);
      const many = new BattleDrive(setup()).step(n);
      expect(many.tick, `tick after ${n}`).toBe(n);
      expect(one.tick).toBe(many.tick);
      expect(one.status()).toBe(many.status());
      expect(one.trace).toEqual(many.trace);
    }
  });

  it('step(a) then step(b) equals step(a + b)', () => {
    const split = new BattleDrive(setup()).step(173).step(310);
    const whole = new BattleDrive(setup()).step(483);
    expect(split.tick).toBe(483);
    expect(split.status()).toBe(whole.status());
    expect(split.trace).toEqual(whole.trace);
  });

  it('control: the display really moves with the ticks (a tick count that is too small shows an unfinished fight, a larger one a changed state)', () => {
    const early = new BattleDrive(setup()).step(60).status();
    const later = new BattleDrive(setup()).step(1500).status();
    expect(later).not.toBe(early);
    const done = new BattleDrive(setup()).run();
    expect(done.ticks).toBeGreaterThan(1500);
    // Stepping past the end does nothing more.
    const over = new BattleDrive(setup()).step(500_000);
    expect(over.over).toBe(true);
    expect(over.tick).toBe(done.ticks);
  });

  it('the display lags the engine inside an action: the engine has the whole blow at once, the display gets it wave by wave, and they agree again when the action ends', () => {
    const d = new BattleDrive(setup());
    let lagged = false;
    for (let i = 0; i < 1500 && !lagged; i++) {
      d.step(1);
      lagged = d.battle.units.some((u) => (d.disp.get(u.uid)?.hp ?? u.hp) !== Math.max(0, u.hp) && !(u.hp <= 0 && d.disp.get(u.uid)?.hp === 0));
    }
    expect(lagged).toBe(true);
    expect(d.run().drift).toBe(0);
  });
});

describe('makeScript groups the events of an action into waves', () => {
  const dmg = (target: number, amount: number, hp: number): BattleEvent => ({ t: 'damage', target, amount, crit: false, element: 'phys', weak: false, resist: false, hp });

  it('two hits on different targets are one wave; a second hit on the same target starts the next', () => {
    const s = makeScript([{ t: 'act', actor: 0, id: 'attack', name: 'Attack', kind: 'attack', fx: 'slash', targets: [10, 11] }, dmg(10, 5, 15), dmg(11, 6, 14), dmg(10, 4, 11)]);
    expect(s.waves.map((w) => w.map((i) => i.target))).toEqual([[10, 11], [10]]);
    expect(s.abilityId).toBe('attack');
  });

  it('a down belongs to the hit that caused it', () => {
    const s = makeScript([dmg(10, 20, 0), { t: 'down', target: 10 }]);
    expect(s.waves[0]?.[0]?.down).toBe(true);
    expect(s.after).toEqual([]);
  });

  it('control: applyEvent changes the displayed hp only when its event is applied', () => {
    const disp = new Map([[10, { hp: 20, tp: 0, status: [], down: false, key: 'punk', name: 'Punk', maxHp: 20 }]]);
    applyEvent(disp, dmg(10, 5, 15));
    expect(disp.get(10)?.hp).toBe(15);
    applyEvent(disp, { t: 'down', target: 10 });
    expect(disp.get(10)).toMatchObject({ hp: 0, down: true });
    applyEvent(disp, { t: 'revive', target: 10, hp: 7 });
    expect(disp.get(10)).toMatchObject({ hp: 7, down: false });
  });
});
