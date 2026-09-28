/**
 * The Auto baseline: everyone attacks, as the in-battle Auto command does. Techs, combos and
 * target choice have to matter, so past the opening street Auto must cost clearly more HP and
 * lose fights a competent player wins. The street is the tutorial and may be Auto-able.
 */
import { describe, expect, it } from 'vitest';
import { autoPolicy, policy, simulate } from './sim';
import { STAGE_PARTY } from './stages';

const trash = [
  ['barrens', 'barrens'],
  ['sinkline', 'sinkline'],
  ['annex', 'annex'],
] as const;
const bosses = [
  ['knuckles', 'f_knuckles'],
  ['lurker', 'f_lurker'],
  ['warden', 'f_warden'],
] as const;

describe('Auto baseline underperforms a competent player', () => {
  for (const [stage, table] of trash) {
    it(`${stage}: Auto loses more fights and at least 1.8× the HP`, () => {
      const good = simulate(stage, STAGE_PARTY[stage]!, table, 240);
      const auto = simulate(stage, STAGE_PARTY[stage]!, table, 240, 1, true, (b) => autoPolicy(b));
      expect(auto.wins / auto.n).toBeLessThanOrEqual(good.wins / good.n - 0.05);
      expect(auto.hpLostPct).toBeGreaterThanOrEqual(good.hpLostPct * 1.8);
    });
  }
  for (const [stage, table] of bosses) {
    it(`${stage}: attacking alone rarely wins`, () => {
      const auto = simulate(stage, STAGE_PARTY[stage]!, table, 120, 1, true, (b) => autoPolicy(b));
      expect(auto.wins / auto.n).toBeLessThanOrEqual(0.3);
    });
  }
});

describe('timed presses pay, without making the bosses a formality', () => {
  // A player landing about half their presses (a fifth of them perfect).
  const hands = { perfect: 0.2, good: 0.3 };
  for (const [stage, table] of bosses) {
    it(`${stage}: timing wins more and costs less HP; a boss still isn't a sure thing`, () => {
      const plain = simulate(stage, STAGE_PARTY[stage]!, table, 200, 5);
      const timed = simulate(stage, STAGE_PARTY[stage]!, table, 200, 5, true, undefined, hands);
      expect(timed.wins).toBeGreaterThanOrEqual(plain.wins);
      expect(timed.hpLostPct).toBeLessThan(plain.hpLostPct - 4);
      expect(timed.rounds).toBeLessThan(plain.rounds);
      expect(timed.wins / timed.n).toBeLessThanOrEqual(0.985);
    });
  }
});

describe('reading the tells pays', () => {
  it('the Warden: a crew that braces for the named cannon and wards the scream wins clearly more', () => {
    const reads = simulate('warden', STAGE_PARTY.warden!, 'f_warden', 200, 3);
    const blind = simulate('warden', STAGE_PARTY.warden!, 'f_warden', 200, 3, true, (b, bag) => policy(b, true, bag, false, false));
    expect(reads.wins / reads.n).toBeGreaterThanOrEqual(blind.wins / blind.n + 0.15);
    expect(reads.hpLostPct).toBeLessThan(blind.hpLostPct - 10);
  });
});
