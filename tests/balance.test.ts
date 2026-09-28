/**
 * Balance targets per story stage, measured with the simulator's competent-player policy,
 * using the levels and gear a non-grinding player actually has (tests/stages.ts, checked by
 * tests/economy.test.ts). Normal fights: near-certain wins, 2–5 rounds, meaningful HP loss.
 * Bosses: winnable but costly.
 */
import { describe, expect, it } from 'vitest';
import { fmt, fmtRun, simulate, simulateRun } from './sim';
import { STAGE_PARTY } from './stages';
import { COMBOS, LEARNSETS } from '../src/data/abilities';

const stages: { label: string; stage: string; table: string; win: number; rounds: [number, number]; hp: [number, number] }[] = [
  { label: 'street  (opening)', stage: 'street', table: 'street', win: 0.97, rounds: [1.5, 5], hp: [5, 40] },
  { label: 'barrens (to Rustyard)', stage: 'barrens', table: 'barrens', win: 0.95, rounds: [1.5, 5], hp: [8, 45] },
  { label: 'KNUCKLES', stage: 'knuckles', table: 'f_knuckles', win: 0.75, rounds: [4, 12], hp: [30, 90] },
  { label: 'sinkline', stage: 'sinkline', table: 'sinkline', win: 0.95, rounds: [2, 6], hp: [10, 50] },
  { label: 'LURKER', stage: 'lurker', table: 'f_lurker', win: 0.75, rounds: [5, 14], hp: [30, 90] },
  { label: 'annex', stage: 'annex', table: 'annex', win: 0.95, rounds: [2, 6], hp: [10, 50] },
  { label: 'WARDEN', stage: 'warden', table: 'f_warden', win: 0.7, rounds: [8, 22], hp: [35, 95] },
];

describe('balance', () => {
  const results = stages.map((s) => ({ s, r: simulate(s.label, STAGE_PARTY[s.stage]!, s.table, s.table.startsWith('f_') ? 120 : 240) }));
  it('prints the balance table', () => {
    console.log(`\n${results.map(({ r }) => fmt(r)).join('\n')}`);
  });
  it('the policy uses every ability learnable by the Warden and all six combos', () => {
    const used = new Set(results.flatMap(({ r }) => [...r.used]));
    const lv = Object.fromEntries(STAGE_PARTY.warden!.map((l) => [l.id, l.level]));
    const learnable = Object.entries(LEARNSETS).flatMap(([who, ls]) => ls.filter((l) => l.level <= (lv[who] ?? 0)).map((l) => l.id));
    expect(learnable.filter((id) => !used.has(id))).toEqual([]);
    expect(COMBOS.map((c) => c.id).filter((id) => !used.has(id))).toEqual([]);
  });
  for (const { s, r } of results) {
    it(`${s.label} within targets`, () => {
      expect(r.wins / r.n).toBeGreaterThanOrEqual(s.win);
      expect(r.rounds).toBeGreaterThanOrEqual(s.rounds[0]);
      expect(r.rounds).toBeLessThanOrEqual(s.rounds[1]);
      expect(r.hpLostPct).toBeGreaterThanOrEqual(s.hp[0]);
      expect(r.hpLostPct).toBeLessThanOrEqual(s.hp[1]);
    });
  }
});

describe('dungeon attrition', () => {
  const runs = [
    { r: simulateRun('barrens x4', STAGE_PARTY.barrens!, 'barrens', 4, { medkit: 4, stim: 0, detox: 2 }), min: 0.9 },
    { r: simulateRun('sinkline x6', STAGE_PARTY.sinkline!, 'sinkline', 6, { medkit: 6, stim: 1, detox: 2, neurotab: 1 }), min: 0.85 },
    { r: simulateRun('annex x5', STAGE_PARTY.annex!, 'annex', 5, { medkit: 6, stim: 2, detox: 2, neurotab: 2 }), min: 0.85 },
  ];
  it('prints the attrition table', () => {
    console.log(['', ...runs.map(({ r }) => fmtRun(r))].join('\n'));
  });
  for (const { r, min } of runs) {
    it(`${r.label} is survivable`, () => {
      expect(r.cleared / r.n).toBeGreaterThanOrEqual(min);
    });
  }
});
