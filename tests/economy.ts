/**
 * Economy model: expected XP and cred along Chapter 1's critical path, with no grinding.
 * Random encounters are estimated from the steps the route actually walks and each zone's rate.
 */
import { ENCOUNTERS, ENEMIES } from '../src/data/enemies';
import { ITEMS, sellPrice } from '../src/data/items';
import { levelForXp, MEMBERS, xpFor } from '../src/data/party';
import { innPrice } from '../src/game/party';
import type { MemberId } from '../src/game/state';
import { Rng } from '../src/engine/rng';

/** Expected cred, XP and loot resale value of one fight from a table. */
export function tableValue(table: string): { cred: number; xp: number; loot: number } {
  const groups = ENCOUNTERS[table]!;
  const total = groups.reduce((n, g) => n + g.w, 0);
  let cred = 0, xp = 0, loot = 0;
  for (const g of groups) {
    const p = g.w / total;
    for (const id of g.e) {
      const e = ENEMIES[id]!;
      cred += p * e.cred;
      xp += p * e.xp;
      for (const d of e.drops ?? []) loot += p * d.chance * (ITEMS[d.id]!.kind === 'loot' ? sellPrice(d.id) : sellPrice(d.id) * 0.5);
    }
  }
  return { cred, xp, loot };
}

export interface Leg {
  label: string;
  /** Scripted fights on this leg. */
  fixed?: string[];
  /** [table, steps walked in that zone, zone rate]. */
  walk?: [string, number, number][];
  /** Cred found in chests / rewards on this leg. */
  cred?: number;
  /** Party members joining at the end of this leg. */
  joins?: MemberId[];
  /** Nights at an inn (cost per head). */
  rests?: number;
  /** Consumables bought on this leg (cred). */
  supplies?: number;
  /** Checkpoint: what the balance tests assume the party owns / has reached here. */
  checkpoint?: { name: string; levels: Partial<Record<MemberId, number>>; buys: string[] };
}

export interface Report {
  label: string;
  cred: number;
  spent: number;
  levels: Partial<Record<MemberId, number>>;
  xp: number;
  battles: number;
  ok: boolean;
  notes: string[];
}

/** Walk the route; at checkpoints, buy the assumed gear (cheapest-first) and check levels. */
export function runEconomy(route: Leg[], startCred: number, startParty: Partial<Record<MemberId, number>>): Report[] {
  let cred = startCred;
  let xpPool = 0;
  let battles = 0;
  const party: Partial<Record<MemberId, number>> = {};
  for (const [id, lv] of Object.entries(startParty) as [MemberId, number][]) party[id] = xpFor(lv);
  const out: Report[] = [];
  const owned = new Set<string>();
  for (const leg of route) {
    const fights: string[] = [...(leg.fixed ?? [])];
    let expected = 0;
    for (const [table, steps, rate] of leg.walk ?? []) {
      // Encounters start after 5 safe steps, then 1 in (rate - 5): mean ≈ steps / rate.
      const n = steps / rate;
      expected += n;
      const v = tableValue(table);
      cred += n * (v.cred + v.loot);
      xpPool += n * v.xp;
      for (const id of Object.keys(party) as MemberId[]) party[id]! += n * v.xp;
    }
    for (const f of fights) {
      const v = tableValue(f);
      cred += v.cred + v.loot;
      xpPool += v.xp;
      for (const id of Object.keys(party) as MemberId[]) party[id]! += v.xp;
    }
    battles += fights.length + expected;
    cred += leg.cred ?? 0;
    const avg = Object.values(party).reduce((n, x) => n + levelForXp(x!), 0) / Math.max(1, Object.keys(party).length);
    cred -= (leg.rests ?? 0) * innPrice(10, avg) * Object.keys(party).length;
    cred -= leg.supplies ?? 0;
    for (const id of leg.joins ?? []) {
      const lead = Math.max(...Object.values(party).map((x) => levelForXp(x!)));
      party[id] = xpFor(Math.max(MEMBERS[id].startLevel, lead - 1));
    }
    let spent = 0;
    const notes: string[] = [];
    let ok = true;
    if (leg.checkpoint) {
      for (const it of [...leg.checkpoint.buys].sort((a, b) => ITEMS[a]!.price - ITEMS[b]!.price)) {
        if (owned.has(it)) continue;
        const price = ITEMS[it]!.price;
        spent += price;
        owned.add(it);
      }
      cred -= spent;
      if (cred < 0) {
        ok = false;
        notes.push(`short by ${Math.round(-cred)}¢`);
      }
      for (const [id, want] of Object.entries(leg.checkpoint.levels) as [MemberId, number][]) {
        const have = levelForXp(party[id] ?? 0);
        if (have < want - 1) {
          ok = false;
          notes.push(`${id} Lv${have} < ${want}`);
        } else if (have < want) notes.push(`${id} Lv${have} (≈${want})`);
      }
    }
    out.push({
      label: leg.checkpoint?.name ?? leg.label,
      cred: Math.round(cred),
      spent,
      levels: Object.fromEntries(Object.entries(party).map(([k, v]) => [k, levelForXp(v!)])),
      xp: Math.round(xpPool),
      battles: Math.round(battles * 10) / 10,
      ok,
      notes,
    });
  }
  return out;
}

/** One fight from a table, rolled: a group by weight, each drop by its chance. */
function rollFight(table: string, rng: Rng): { cred: number; xp: number } {
  const groups = ENCOUNTERS[table]!;
  let r = rng.next() * groups.reduce((n, g) => n + g.w, 0);
  let g = groups[groups.length - 1]!;
  for (const x of groups) {
    r -= x.w;
    if (r < 0) {
      g = x;
      break;
    }
  }
  let cred = 0, xp = 0;
  for (const id of g.e) {
    const e = ENEMIES[id]!;
    cred += e.cred;
    xp += e.xp;
    for (const d of e.drops ?? []) if (rng.chance(d.chance)) cred += ITEMS[d.id]!.kind === 'loot' ? sellPrice(d.id) : sellPrice(d.id) * 0.5;
  }
  return { cred, xp };
}

/** Random encounters over a walk, rolled as the field does: 5 safe steps, then 1 in (rate - 5). */
function rollEncounters(steps: number, rate: number, rng: Rng): number {
  let n = 0, since = 0;
  for (let i = 0; i < steps; i++) {
    since++;
    if (since < 6) continue;
    if (rng.chance(1 / Math.max(2, rate - 5))) {
      n++;
      since = 0;
    }
  }
  return n;
}

/**
 * Monte Carlo over the route: encounter counts, groups and drops are rolled, and every crew
 * member a fight leaves down costs a clinic revive (30 + 10 × level). `downRate(table)` is
 * the mean crew down per won fight, from the battle simulator. Returns, per checkpoint, the
 * cred left after its buys in every run.
 */
export function runEconomyMC(route: Leg[], startCred: number, startParty: Partial<Record<MemberId, number>>, runs: number, seed: number, downRate: (table: string) => number): Map<string, number[]> {
  const rng = new Rng(seed);
  const out = new Map<string, number[]>();
  for (let run = 0; run < runs; run++) {
    let cred = startCred;
    const party: Partial<Record<MemberId, number>> = {};
    for (const [id, lv] of Object.entries(startParty) as [MemberId, number][]) party[id] = xpFor(lv);
    const owned = new Set<string>();
    const avgLevel = () => Object.values(party).reduce((n, x) => n + levelForXp(x!), 0) / Math.max(1, Object.keys(party).length);
    const fight = (table: string) => {
      const v = rollFight(table, rng);
      cred += v.cred;
      for (const id of Object.keys(party) as MemberId[]) party[id]! += v.xp;
      const size = Object.keys(party).length, p = Math.min(1, downRate(table) / size);
      for (let i = 0; i < size; i++) if (rng.chance(p)) cred -= 30 + 10 * Math.round(avgLevel());
    };
    for (const leg of route) {
      for (const [table, steps, rate] of leg.walk ?? []) for (let i = rollEncounters(steps, rate, rng); i > 0; i--) fight(table);
      for (const f of leg.fixed ?? []) fight(f);
      cred += leg.cred ?? 0;
      cred -= (leg.rests ?? 0) * innPrice(10, avgLevel()) * Object.keys(party).length;
      cred -= leg.supplies ?? 0;
      for (const id of leg.joins ?? []) {
        const lead = Math.max(...Object.values(party).map((x) => levelForXp(x!)));
        party[id] = xpFor(Math.max(MEMBERS[id].startLevel, lead - 1));
      }
      if (leg.checkpoint) {
        for (const it of leg.checkpoint.buys) {
          if (owned.has(it)) continue;
          owned.add(it);
          cred -= ITEMS[it]!.price;
        }
        const list = out.get(leg.checkpoint.name) ?? [];
        list.push(cred);
        out.set(leg.checkpoint.name, list);
      }
    }
  }
  return out;
}
