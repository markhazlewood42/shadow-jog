/**
 * The critical path must afford the gear and reach the levels the balance tests assume,
 * without grinding (only the random encounters the route itself walks through).
 */
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/data/items';
import { runEconomy, runEconomyMC, tableValue } from './economy';
import { simulate } from './sim';
import { STAGE_PARTY } from './stages';
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

  // Down rates per table, from the battle simulator with the stage's party.
  const STAGE_OF: Record<string, string> = {
    street: 'street', f_first_fight: 'street', barrens: 'barrens', f_rustyard_gate: 'barrens', f_knuckles: 'knuckles',
    sinkline: 'sinkline', f_lurker: 'lurker', annex: 'annex', f_annex_door: 'annex', f_warden: 'warden',
  };
  const downs = new Map<string, number>();
  const downRate = (table: string) => {
    if (!downs.has(table)) {
      const stage = STAGE_OF[table] ?? 'street';
      downs.set(table, simulate(table, STAGE_PARTY[stage]!, table, table.startsWith('f_') ? 60 : 120).downs);
    }
    return downs.get(table)!;
  };
  const mc = runEconomyMC(ROUTE, 150, { kit: 1, rook: 3 }, 400, 7, downRate);
  const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)]!;

  it('prints the Monte Carlo spread', () => {
    for (const [cp, xs] of mc) console.log(`${cp.padEnd(30)} p10 ${String(Math.round(pct(xs, 0.1))).padStart(5)}¢  median ${String(Math.round(pct(xs, 0.5))).padStart(5)}¢  affordable ${((xs.filter((x) => x >= 0).length / xs.length) * 100).toFixed(0)}%`);
    console.log(`down rates: ${[...downs].map(([t, d]) => `${t} ${d.toFixed(2)}`).join(', ')}`);
  });

  for (const [cp, xs] of mc) {
    it(`${cp}: nine runs in ten afford it, clinic bills and bad luck included`, () => {
      expect(xs.filter((x) => x >= 0).length / xs.length).toBeGreaterThanOrEqual(0.9);
    });
  }

  // A straight-line player who opens no optional chest: the gear is still in reach for most runs
  // without grinding (a few extra fights at worst).
  const lean = runEconomyMC(ROUTE, 150, { kit: 1, rook: 3 }, 400, 11, downRate, true);
  it('prints the minimal-exploration spread', () => {
    for (const [cp, xs] of lean) console.log(`minimal: ${cp.padEnd(30)} p10 ${String(Math.round(pct(xs, 0.1))).padStart(5)}¢  median ${String(Math.round(pct(xs, 0.5))).padStart(5)}¢  affordable ${((xs.filter((x) => x >= 0).length / xs.length) * 100).toFixed(0)}%`);
  });
  for (const [cp, xs] of lean) {
    it(`${cp}: affordable in three runs of four even skipping every optional chest`, () => {
      expect(xs.filter((x) => x >= 0).length / xs.length).toBeGreaterThanOrEqual(0.75);
    });
  }
  it('a straight-line player never walks into a boss behind: p10 ≥ 0 at every checkpoint before one', () => {
    for (const [cp, xs] of lean) {
      if (!/Knuckles|Lurker|Annex|WARDEN/.test(cp)) continue;
      expect(pct(xs, 0.1), cp).toBeGreaterThanOrEqual(0);
    }
  });

  it('the endgame has something worth buying, and exploring still pays: Requisition sells a same-tier alternative to each armory find, never the find itself', async () => {
    const { SHOPS } = await import('../src/data/shops');
    const req = SHOPS.km_requisition!.items;
    const found: Record<string, string> = { kit: 'dragon_fang', rook: 'mono_katana', hex: 'smartpistol', sable: 'focus_rod' };
    for (const [who, find] of Object.entries(found)) {
      expect(req, find).not.toContain(find);
      const alt = req.map((id) => ITEMS[id]!).filter((it) => it.slot === 'weapon' && it.who?.includes(who as never));
      expect(alt.length, who).toBe(1);
      // Same tier: within 15% of the find's price.
      expect(Math.abs(alt[0]!.price - ITEMS[find]!.price) / ITEMS[find]!.price, who).toBeLessThan(0.15);
    }
    expect(req).toContain('km_lace');
    const median = pct(mc.get('CP6 WARDEN')!, 0.5);
    expect(ITEMS.km_lace!.price).toBeGreaterThan(median * 0.8);
  });

  it('the whole chapter takes a sensible number of fights', () => {
    const last = report[report.length - 1]!;
    expect(last.battles).toBeGreaterThan(18);
    expect(last.battles).toBeLessThan(40);
  });
});
