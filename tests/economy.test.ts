/**
 * The critical path must afford the gear and reach the levels the balance tests assume,
 * without grinding (only the random encounters the route itself walks through).
 */
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/data/items';
import { runEconomy, tableValue } from './economy';
import { ROUTE } from './route';
import { STAGE_GEAR } from './stages';

describe('economy', () => {
  const report = runEconomy(ROUTE, 150, { kit: 1, rook: 3 });

  it('prints the route', () => {
    for (const leg of ROUTE) if (leg.walk) console.log(`${leg.label.padEnd(30)} walks ${leg.walk.map(([t, n, r]) => `${n} steps of ${t} (1 in ${r})`).join(', ')}`);
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
