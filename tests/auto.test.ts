/**
 * The Auto baseline: everyone attacks, as the in-battle Auto command does. Techs, combos and
 * target choice have to matter, so past the opening street Auto must cost clearly more HP and
 * lose fights a competent player wins. The street is the tutorial and may be Auto-able.
 */
import { describe, expect, it } from 'vitest';
import { autoPolicy, simulate } from './sim';
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
