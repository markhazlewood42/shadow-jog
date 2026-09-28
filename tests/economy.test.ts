/**
 * The critical path must afford the gear and reach the levels the balance tests assume,
 * without grinding (only the random encounters the route itself walks through).
 */
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/data/items';
import { runEconomy, tableValue, type Leg } from './economy';
import { STAGE_GEAR } from './stages';

const ROUTE: Leg[] = [
  { label: 'Opening fight (Lantern Row)', fixed: ['f_first_fight'], supplies: 20, checkpoint: { name: 'CP1 before the Rustyard trip', levels: { kit: 1, rook: 3 }, buys: STAGE_GEAR.barrens } },
  { label: 'Walk to the Rustyard', walk: [['street', 50, 28]] },
  { label: 'Rustyard gate', fixed: ['f_rustyard_gate'], walk: [['barrens', 35, 16]], cred: 120, checkpoint: { name: 'CP2 Knuckles', levels: { kit: 3, rook: 4 }, buys: STAGE_GEAR.knuckles } },
  { label: 'Knuckles', fixed: ['f_knuckles'] },
  { label: 'Walk back, Hex joins', walk: [['street', 50, 28]], joins: ['hex'], rests: 1, supplies: 120, checkpoint: { name: 'CP3 into the Sinkline', levels: { kit: 4, rook: 5, hex: 4 }, buys: STAGE_GEAR.sinkline } },
  { label: 'Walk to the Sinkline', walk: [['street', 27, 28]] },
  { label: 'Sinkline B1', walk: [['sinkline', 120, 19]], cred: 380, supplies: 120, checkpoint: { name: 'CP4 the Lurker', levels: { kit: 6, rook: 6, hex: 5 }, buys: STAGE_GEAR.lurker } },
  { label: 'The Lurker', fixed: ['f_lurker'], supplies: 100, checkpoint: { name: 'CP5 into Annex 7', levels: { kit: 7, rook: 7, hex: 7 }, buys: STAGE_GEAR.annex } },
  { label: 'Annex 7', fixed: ['f_annex_door'], walk: [['annex', 90, 22]], joins: ['sable'], checkpoint: { name: 'CP6 WARDEN', levels: { kit: 8, rook: 8, hex: 8, sable: 7 }, buys: STAGE_GEAR.warden } },
];

describe('economy', () => {
  const report = runEconomy(ROUTE, 150, { kit: 1, rook: 3 });

  it('prints the route', () => {
    for (const t of ['street', 'barrens', 'sinkline', 'annex']) {
      const v = tableValue(t);
      console.log(`${t.padEnd(10)} cred ${v.cred.toFixed(0).padStart(4)} + loot ${v.loot.toFixed(0).padStart(3)} · xp ${v.xp.toFixed(0)}`);
    }
    for (const r of report) console.log(`${r.label.padEnd(30)} after buys ${String(r.cred).padStart(5)}¢ (spent ${r.spent})  fights ${r.battles}  ${JSON.stringify(r.levels)} ${r.notes.join('; ')}`);
  });

  for (const r of report.filter((x) => x.label.startsWith('CP'))) {
    it(`${r.label}: affordable at the expected level, no grinding`, () => {
      expect(r.ok, r.notes.join('; ')).toBe(true);
    });
  }

  it('every item a balance stage assumes can be obtained (shop or chest)', async () => {
    const { SHOPS } = await import('../src/data/shops');
    const { getMap, mapIds } = await import('../src/data/maps');
    const sold = new Set(Object.values(SHOPS).flatMap((s) => s.items));
    const found = new Set(mapIds().flatMap((id) => (getMap(id).chests ?? []).map((c) => c.item).filter(Boolean) as string[]));
    const starting = new Set(['wraps', 'street_clothes', 'bandana', 'old_katana', 'lined_coat', 'dermal_plating', 'holdout', 'armored_jacket', 'tac_visor', 'ash_staff']);
    for (const [stage, gear] of Object.entries(STAGE_GEAR))
      for (const id of gear) expect(sold.has(id) || found.has(id) || starting.has(id), `${stage}: ${id} (${ITEMS[id]?.name})`).toBe(true);
  });

  it('the whole chapter takes a sensible number of fights', () => {
    const last = report[report.length - 1]!;
    expect(last.battles).toBeGreaterThan(18);
    expect(last.battles).toBeLessThan(40);
  });
});
