/**
 * Balance targets per story stage, measured with the simulator's competent-player policy.
 * Normal fights: near-certain wins, 2–5 rounds, meaningful but recoverable HP loss.
 * Bosses: winnable but costly, 5–14 rounds.
 */
import { describe, expect, it } from 'vitest';
import { fmt, fmtRun, simulate, simulateRun, type Loadout } from './sim';


const stages: { label: string; party: Loadout[]; table: string; win: number; rounds: [number, number]; hp: [number, number] }[] = [
  {
    label: 'street  (Kit1 Rook3)', table: 'street', win: 0.97, rounds: [1.5, 5], hp: [5, 40],
    party: [{ id: 'kit', level: 1 }, { id: 'rook', level: 3 }],
  },
  {
    label: 'barrens (Kit3 Rook4)', table: 'barrens', win: 0.97, rounds: [1.5, 5], hp: [8, 40],
    party: [
      { id: 'kit', level: 3, equip: { weapon: 'iron_knuckles', body: 'armored_jacket' } },
      { id: 'rook', level: 4 },
    ],
  },
  {
    label: 'KNUCKLES (Kit4 Rook5)', table: 'f_knuckles', win: 0.8, rounds: [4, 12], hp: [30, 85],
    party: [
      { id: 'kit', level: 4, equip: { weapon: 'iron_knuckles', body: 'armored_jacket' } },
      { id: 'rook', level: 5 },
    ],
  },
  {
    label: 'sinkline (Kit5 Rook6 Hex5)', table: 'sinkline', win: 0.95, rounds: [2, 6], hp: [10, 50],
    party: [
      { id: 'kit', level: 5, equip: { weapon: 'shock_knuckles', body: 'lined_coat', head: 'bandana' } },
      { id: 'rook', level: 6, equip: { weapon: 'vibro_katana' } },
      { id: 'hex', level: 5, equip: { weapon: 'taser_pistol', body: 'lined_coat' } },
    ],
  },
  {
    label: 'LURKER  (Kit6 Rook7 Hex6)', table: 'f_lurker', win: 0.75, rounds: [5, 14], hp: [30, 90],
    party: [
      { id: 'kit', level: 6, equip: { weapon: 'shock_knuckles', body: 'lined_coat', head: 'bandana' } },
      { id: 'rook', level: 7, equip: { weapon: 'vibro_katana' } },
      { id: 'hex', level: 6, equip: { weapon: 'taser_pistol', body: 'lined_coat' } },
    ],
  },
  {
    label: 'annex   (4x Lv8)', table: 'annex', win: 0.95, rounds: [2, 6], hp: [10, 50],
    party: [
      { id: 'kit', level: 8, equip: { weapon: 'mono_claws', body: 'ballistic_vest', head: 'helmet' } },
      { id: 'rook', level: 8, equip: { weapon: 'vibro_katana', body: 'lined_coat' } },
      { id: 'hex', level: 8, equip: { weapon: 'taser_pistol', body: 'spirit_robe' } },
      { id: 'sable', level: 8, equip: { weapon: 'bone_staff', body: 'lined_coat' } },
    ],
  },
  {
    label: 'WARDEN  (4x Lv10)', table: 'f_warden', win: 0.7, rounds: [8, 22], hp: [35, 95],
    party: [
      { id: 'kit', level: 10, equip: { weapon: 'mono_claws', body: 'ballistic_vest', head: 'helmet' } },
      { id: 'rook', level: 10, equip: { weapon: 'mono_katana', body: 'lined_coat' } },
      { id: 'hex', level: 10, equip: { weapon: 'smartpistol', body: 'spirit_robe' } },
      { id: 'sable', level: 10, equip: { weapon: 'bone_staff', body: 'lined_coat' } },
    ],
  },
];

describe('balance', () => {
  const results = stages.map((s) => ({ s, r: simulate(s.label, s.party, s.table, s.table.startsWith('f_') ? 120 : 240) }));
  it('prints the balance table', () => {
    console.log('\n' + results.map(({ r }) => fmt(r)).join('\n'));
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
  const sink = stages.find((s) => s.table === 'sinkline')!.party;
  const annex = stages.find((s) => s.table === 'annex')!.party;
  const street = stages.find((s) => s.table === 'barrens')!.party;
  const runs = [
    { r: simulateRun('barrens x6, 4 medkits', street, 'barrens', 6, 4, 1), min: 0.9 },
    { r: simulateRun('sinkline x8, 6 medkits', sink, 'sinkline', 8, 6, 1), min: 0.8 },
    { r: simulateRun('annex x8, 6 medkits', annex, 'annex', 8, 6, 2), min: 0.8 },
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
