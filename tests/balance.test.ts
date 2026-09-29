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

/**
 * Bosses have a ceiling as well as a floor: a competent (not optimal) player should usually win,
 * but not always; one who never loses isn't being tested. The floor is for a player who ignores
 * the timed presses; the ceiling for one who lands about a third of them and guesses wrong on a
 * tenth (TIMED_HANDS).
 */
const BOSS_WIN_MAX = 0.93;
const TIMED_HANDS = { perfect: 0.1, good: 0.25, whiff: 0.1 };
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
  const results = stages.map((s) => {
    const boss = s.table.startsWith('f_');
    const r = simulate(s.label, STAGE_PARTY[s.stage]!, s.table, boss ? 120 : 240);
    const timed = boss ? simulate(`${s.label} (timed)`, STAGE_PARTY[s.stage]!, s.table, 120, 1, true, undefined, TIMED_HANDS) : null;
    return { s, r, timed };
  });
  it('prints the balance table', () => {
    console.log(`\n${results.flatMap(({ r, timed }) => (timed ? [fmt(r), fmt(timed)] : [fmt(r)])).join('\n')}`);
  });
  it('the policy uses every ability learnable by the Warden and every combo', () => {
    const used = new Set(results.flatMap(({ r }) => [...r.used]));
    const lv = Object.fromEntries(STAGE_PARTY.warden!.map((l) => [l.id, l.level]));
    const learnable = Object.entries(LEARNSETS).flatMap(([who, ls]) => ls.filter((l) => l.level <= (lv[who] ?? 0)).map((l) => l.id));
    expect(learnable.filter((id) => !used.has(id))).toEqual([]);
    expect(COMBOS.map((c) => c.id).filter((id) => !used.has(id))).toEqual([]);
  });
  for (const { s, r, timed } of results) {
    it(`${s.label} within targets`, () => {
      expect(r.wins / r.n).toBeGreaterThanOrEqual(s.win);
      if (timed) expect(timed.wins / timed.n).toBeLessThanOrEqual(BOSS_WIN_MAX);
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
    // 120 runs, not 60: the annex's clear rate sits near its floor, and 60 runs swing ±5 points.
    { r: simulateRun('annex x7', STAGE_PARTY.annex!, 'annex', 7, { medkit: 6, stim: 2, detox: 2, neurotab: 2 }, 120), min: 0.85 },
  ];
  it('the pressure climbs into the Warden: the Annex costs at least what the Sinkline did', () => {
    const [, sink, annex] = runs.map(({ r }) => r);
    expect(annex!.medkitsUsed).toBeGreaterThanOrEqual(sink!.medkitsUsed * 0.9);
    expect(annex!.endHpPct).toBeLessThanOrEqual(sink!.endHpPct + 3);
  });
  it('prints the attrition table', () => {
    console.log(['', ...runs.map(({ r }) => fmtRun(r))].join('\n'));
  });
  for (const { r, min } of runs) {
    it(`${r.label}: Rook doesn't end the dungeon on Attack alone`, () => {
      // Combos and his openers draw on his charges; a run that empties them has spent Rook. A
      // guarded blow buys one back each fight, so a careful run should never see him dry.
      expect(r.rookDry).toBeLessThanOrEqual(0.05);
    });
    it(`${r.label} is survivable`, () => {
      expect(r.cleared / r.n).toBeGreaterThanOrEqual(min);
    });
  }
});

describe('alternative builds', () => {
  // The gear the tuned route doesn't buy must still be viable: every mid-tier weapon and mod.
  type Swap = Partial<Record<string, Record<string, string>>>;
  const alts: { stage: string; table: string; swap: Swap }[] = [
    { stage: 'sinkline', table: 'sinkline', swap: { kit: { weapon: 'shock_knuckles', mod: 'lucky_coin' }, hex: { weapon: 'taser_pistol', mod: 'cyber_eye' } } },
    { stage: 'lurker', table: 'f_lurker', swap: { kit: { weapon: 'razor_tekko', mod: 'reflex_booster' }, rook: { weapon: 'nodachi', mod: 'dermal_plating' } } },
    { stage: 'sinkline', table: 'sinkline', swap: { hex: { weapon: 'flechette_pistol' } } },
    { stage: 'lurker', table: 'f_lurker', swap: { hex: { weapon: 'flechette_pistol' } } },
    { stage: 'annex', table: 'annex', swap: { sable: { weapon: 'thorn_rod', mod: 'spirit_fetish' }, rook: { mod: 'adrenal_pump' } } },
    { stage: 'warden', table: 'f_warden', swap: { kit: { mod: 'lucky_coin' }, hex: { mod: 'reflex_booster' }, sable: { weapon: 'bone_staff' } } },
    // Each member's own mod, in place of the general one.
    { stage: 'sinkline', table: 'sinkline', swap: { kit: { mod: 'ki_beads' }, rook: { mod: 'ronin_guard' }, hex: { mod: 'coolant_rig' } } },
    { stage: 'warden', table: 'f_warden', swap: { sable: { mod: 'crow_torc' }, hex: { mod: 'coolant_rig' } } },
    // A crew that skipped the armory and bought from Requisition instead.
    { stage: 'warden', table: 'f_warden', swap: { kit: { weapon: 'arc_gauntlets' }, rook: { weapon: 'thermal_katana' }, hex: { weapon: 'burst_smg' }, sable: { weapon: 'ward_staff' } } },
  ];
  for (const a of alts) {
    const target = stages.find((s) => s.stage === a.stage)!;
    const loadout = STAGE_PARTY[a.stage]!.map((l) => ({ ...l, equip: { ...l.equip, ...(a.swap[l.id] ?? {}) } }));
    const r = simulate(`${a.stage} (alt)`, loadout, a.table, a.table.startsWith('f_') ? 120 : 200);
    it(`${a.stage} with ${Object.values(a.swap).flatMap((s) => Object.values(s ?? {})).join(', ')} holds up`, () => {
      console.log(fmt(r));
      expect(r.wins / r.n).toBeGreaterThanOrEqual(target.win - 0.05);
      expect(r.rounds).toBeLessThanOrEqual(target.rounds[1]);
    });
  }

  it('everything a stage loadout equips can be obtained (shop, chest or starting kit)', async () => {
    const { SHOPS } = await import('../src/data/shops');
    const { getMap, mapIds } = await import('../src/data/maps');
    const { MEMBERS } = await import('../src/data/party');
    const sold = new Set(Object.values(SHOPS).flatMap((s) => s.items));
    const found = new Set(mapIds().flatMap((id) => (getMap(id).chests ?? []).map((c) => c.item).filter(Boolean) as string[]));
    const starting = new Set(Object.values(MEMBERS).flatMap((m) => Object.values(m.startEquip ?? {})));
    for (const [stage, party] of Object.entries(STAGE_PARTY))
      for (const l of party) for (const id of Object.values(l.equip ?? {})) expect(sold.has(id) || found.has(id) || starting.has(id), `${stage}: ${l.id} ${id}`).toBe(true);
  });
});

describe('combos in ordinary fights', () => {
  for (const [stage, table] of [['barrens', 'barrens'], ['sinkline', 'sinkline'], ['annex', 'annex']] as const) {
    it(`${stage}: a crew that fuses finishes sooner or bleeds less than one that doesn't`, () => {
      const withCombos = simulate(stage, STAGE_PARTY[stage]!, table, 200, 5, true);
      const without = simulate(stage, STAGE_PARTY[stage]!, table, 200, 5, false);
      expect(withCombos.combos).toBeGreaterThanOrEqual(0.5);
      expect(withCombos.rounds < without.rounds - 0.2 || withCombos.hpLostPct < without.hpLostPct - 2).toBe(true);
    });
  }
});
