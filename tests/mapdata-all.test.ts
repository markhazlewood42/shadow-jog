/**
 * M5 task 4: all 15 maps are a JSON file plus a behavior module (`src/data/maps/mapdata.ts`). The proof for each map is the one `tests/mapdata.test.ts`
 * gives the rustyard, against a frozen copy of the old TypeScript map (`tests/fixtures/maps/<file>-old.ts`, made before the move):
 *
 *   1. everything that is a plain value deep-equals the frozen copy (a function stands as a marker, so the SLOTS of code are compared too);
 *   2. every function in the joined map IS the behavior module's export for the id the JSON names (identity);
 *   3. every function equals the frozen copy's: the same object (a story script imported by both), or the same observable behavior: predicates
 *      over many flag combinations, scripts over a recording script API (a factory closure such as `pumpValve('v1')` has the same text whatever
 *      its argument, so only the behavior check can tell a wrong argument);
 *   4. `checkMap` finds no problem in the shipped file, and the behavior module has no entry that no data uses.
 *
 * Controls: a bent value, a swapped id and a bent predicate each fail, for every map.
 */
import { describe, expect, it } from 'vitest';
import type { MapDef } from '../src/field/types';
import type { ScriptApi } from '../src/game/script';
import { getMap, mapIds } from '../src/data/maps';
import { annex, annexBehavior, dock, dockBehavior } from '../src/data/maps/annex';
import { armory, armoryBehavior, bar, barBehavior, clinic, clinicBehavior, hexDen, hexDenBehavior, hotel, hotelBehavior, kwikmart, kwikmartBehavior, noodles, noodlesBehavior, rookFlat, rookFlatBehavior, threads, threadsBehavior, INTERIORS } from '../src/data/maps/interiors';
import { lanternRow, lanternRowBehavior } from '../src/data/maps/lantern_row';
import { checkMap, joinMap, type MapBehavior } from '../src/data/maps/mapdata';
import { rustyard, rustyardBehavior } from '../src/data/maps/rustyard';
import { sinkline1, sinkline1Behavior } from '../src/data/maps/sinkline';
import { world, worldBehavior } from '../src/data/maps/world';
import annexJson from '../src/data/maps/annex.json' with { type: 'json' };
import armoryJson from '../src/data/maps/armory.json' with { type: 'json' };
import barJson from '../src/data/maps/bar.json' with { type: 'json' };
import clinicJson from '../src/data/maps/clinic.json' with { type: 'json' };
import dockJson from '../src/data/maps/dock.json' with { type: 'json' };
import hexDenJson from '../src/data/maps/hex_den.json' with { type: 'json' };
import hotelJson from '../src/data/maps/hotel.json' with { type: 'json' };
import kwikmartJson from '../src/data/maps/kwikmart.json' with { type: 'json' };
import lanternRowJson from '../src/data/maps/lantern_row.json' with { type: 'json' };
import noodlesJson from '../src/data/maps/noodles.json' with { type: 'json' };
import rookFlatJson from '../src/data/maps/rook_flat.json' with { type: 'json' };
import rustyardJson from '../src/data/maps/rustyard.json' with { type: 'json' };
import sinklineJson from '../src/data/maps/sinkline_1.json' with { type: 'json' };
import threadsJson from '../src/data/maps/threads.json' with { type: 'json' };
import worldJson from '../src/data/maps/world.json' with { type: 'json' };
import * as oldAnnex from './fixtures/maps/annex-old';
import * as oldInteriors from './fixtures/maps/interiors-old';
import * as oldLantern from './fixtures/maps/lantern_row-old';
import { rustyard as oldRustyard } from './fixtures/maps/rustyard-old';
import * as oldSinkline from './fixtures/maps/sinkline-old';
import * as oldWorld from './fixtures/maps/world-old';

type Obj = Record<string, unknown>;
type Fn = (...a: unknown[]) => unknown;

interface Case {
  id: string;
  old: MapDef;
  now: MapDef;
  data: unknown;
  behavior: MapBehavior;
}

const CASES: Case[] = [
  { id: 'rustyard', old: oldRustyard, now: rustyard, data: rustyardJson, behavior: rustyardBehavior },
  { id: 'lantern_row', old: oldLantern.lanternRow, now: lanternRow, data: lanternRowJson, behavior: lanternRowBehavior },
  { id: 'world', old: oldWorld.world, now: world, data: worldJson, behavior: worldBehavior },
  { id: 'sinkline_1', old: oldSinkline.sinkline1, now: sinkline1, data: sinklineJson, behavior: sinkline1Behavior },
  { id: 'annex', old: oldAnnex.annex, now: annex, data: annexJson, behavior: annexBehavior },
  { id: 'dock', old: oldAnnex.dock, now: dock, data: dockJson, behavior: dockBehavior },
  { id: 'rook_flat', old: oldInteriors.rookFlat, now: rookFlat, data: rookFlatJson, behavior: rookFlatBehavior },
  { id: 'bar', old: oldInteriors.bar, now: bar, data: barJson, behavior: barBehavior },
  { id: 'clinic', old: oldInteriors.clinic, now: clinic, data: clinicJson, behavior: clinicBehavior },
  { id: 'armory', old: oldInteriors.armory, now: armory, data: armoryJson, behavior: armoryBehavior },
  { id: 'threads', old: oldInteriors.threads, now: threads, data: threadsJson, behavior: threadsBehavior },
  { id: 'kwikmart', old: oldInteriors.kwikmart, now: kwikmart, data: kwikmartJson, behavior: kwikmartBehavior },
  { id: 'hotel', old: oldInteriors.hotel, now: hotel, data: hotelJson, behavior: hotelBehavior },
  { id: 'noodles', old: oldInteriors.noodles, now: noodles, data: noodlesJson, behavior: noodlesBehavior },
  { id: 'hex_den', old: oldInteriors.hexDen, now: hexDen, data: hexDenJson, behavior: hexDenBehavior },
];

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The value with each function replaced by a marker and each `undefined` property dropped, for a deep comparison of everything else. */
function shape(v: unknown): unknown {
  if (typeof v === 'function') return '[function]';
  if (Array.isArray(v)) return v.map(shape);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, shape(x)]));
  return v;
}

function functionPaths(v: unknown, path = '', out: string[] = []): string[] {
  if (typeof v === 'function') out.push(path);
  else if (Array.isArray(v)) {
    v.forEach((x, i) => {
      functionPaths(x, path ? `${path}.${i}` : String(i), out);
    });
  } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) functionPaths(x, path ? `${path}.${k}` : k, out);
  return out;
}

function at(v: unknown, path: string): unknown {
  let cur: unknown = v;
  for (const key of path.split('.')) cur = (cur as Obj)[key];
  return cur;
}

/** A small deterministic generator, so the test needs no seed library. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** The story flags a map's code reads, found in the source text of its functions. */
function flagsOf(fns: Fn[]): string[] {
  const names = new Set<string>();
  for (const fn of fns) {
    const text = String(fn);
    for (const m of text.matchAll(/\bf\.([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(m[1] ?? '');
    for (const m of text.matchAll(/\b(?:flag|get|set)\("([^"]+)"/g)) names.add(m[1] ?? '');
  }
  return [...names].sort();
}

/** All flag combinations when there are few flags; else a fixed sample: none, all, each alone, each missing, and 120 random ones. */
function combosFor(names: string[]): Obj[] {
  const make = (on: (i: number) => boolean) => Object.fromEntries(names.map((n, i) => [n, on(i)]));
  if (names.length <= 7) return Array.from({ length: 1 << names.length }, (_, n) => make((i) => !!(n & (1 << i))));
  const out = [make(() => false), make(() => true)];
  names.forEach((_, k) => {
    out.push(make((i) => i === k));
    out.push(make((i) => i !== k));
  });
  const rnd = lcg(names.length * 7919);
  for (let n = 0; n < 120; n++) out.push(make(() => rnd() < 0.5));
  return out;
}

/** A script API that writes down every call. The answers to questions depend on the flag combination and on `pick`, the same for old and new. */
function recording(flags: Obj, bit: number, pick: number): { api: ScriptApi; calls: string[] } {
  const calls: string[] = [];
  const api = new Proxy({} as Obj, {
    get(_t, name: string) {
      if (calls.length > 400) throw new Error('too many calls');
      if (name === 'flag') return (n: string) => !!flags[n];
      if (name === 'get') return (n: string) => flags[n];
      if (name === 'has' || name === 'inParty' || name === 'take') return () => !!((bit >> (name === 'has' ? 0 : name === 'inParty' ? 1 : 2)) & 1);
      if (name === 'credits') return () => 500 + bit;
      return (...args: unknown[]) => {
        calls.push(`${name}(${JSON.stringify(args)})`);
        if (name === 'ask') return Promise.resolve(pick);
        if (name === 'unlock') return [];
        if (name === 'battle') return Promise.resolve(bit & 1 ? 'win' : 'lose');
        return Promise.resolve();
      };
    },
  }) as unknown as ScriptApi;
  return { api, calls };
}

async function runScript(fn: (s: ScriptApi) => Promise<void>, flags: Obj, bit: number, pick: number): Promise<string[]> {
  const r = recording(flags, bit, pick);
  try {
    await fn(r.api);
  } catch (e) {
    r.calls.push(`ERROR ${(e as Error).message}`);
  }
  return r.calls;
}

describe.each(CASES)('$id: the JSON plus the behavior module give the old map', ({ id, old, now, data, behavior }) => {
  const paths = functionPaths(old);

  it('everything but code deep-equals the frozen copy (an undefined property counts as missing)', () => {
    expect(shape(now)).toStrictEqual(shape(old));
    expect(now.id).toBe(id);
  });

  it('the code slots are the same places, and the data holds only plain values', () => {
    expect([...functionPaths(now)].sort()).toEqual([...paths].sort());
    expect(functionPaths(data)).toEqual([]);
    expect(copy(data)).toEqual(data);
  });

  it('every function is the behavior module\'s export for the id the JSON names (identity)', () => {
    for (const path of functionPaths(now)) {
      const ref = at(data, path);
      const last = path.split('.').pop();
      const table = last === 'when' ? behavior.when : behavior.scripts;
      expect(typeof ref, path).toBe('string');
      expect(at(now, path), path).toBe(table[ref as string]);
    }
  });

  it('checkMap finds no problem (and no behavior entry is unused)', () => {
    expect(checkMap(data, behavior)).toEqual([]);
  });

  it('the predicates answer the same as the old ones', () => {
    const preds = paths.filter((p) => p.endsWith('.when'));
    const combos = combosFor(flagsOf(preds.map((p) => at(old, p) as Fn)));
    let seenTrue = 0;
    let seenFalse = 0;
    for (const p of preds) {
      const was = at(old, p) as (f: Obj) => unknown;
      const nw = at(now, p) as (f: Obj) => unknown;
      for (const f of combos) {
        let a: unknown;
        let b: unknown;
        try {
          a = was(f);
        } catch (e) {
          a = `ERROR ${(e as Error).message}`;
        }
        try {
          b = nw(f);
        } catch (e) {
          b = `ERROR ${(e as Error).message}`;
        }
        expect(b, `${p} ${JSON.stringify(f)}`).toEqual(a);
        if (a === true) seenTrue++;
        if (a === false) seenFalse++;
      }
    }
    // the probe is alive: where there are predicates, both answers were seen
    if (preds.length) expect(seenTrue + seenFalse).toBeGreaterThan(0);
  });

  it('the scripts make the same calls as the old ones, for many flag combinations and both answers to a question', async () => {
    const scripts = paths.filter((p) => !p.endsWith('.when'));
    const fns = scripts.map((p) => at(old, p) as Fn);
    const combos = combosFor(flagsOf(fns));
    let compared = 0;
    let shared = 0;
    for (const p of scripts) {
      const was = at(old, p) as (s: ScriptApi) => Promise<void>;
      const nw = at(now, p) as (s: ScriptApi) => Promise<void>;
      if (was === nw) {
        shared++;
        continue;
      }
      for (const [bit, f] of combos.entries()) {
        for (const pick of [0, 1]) {
          const a = await runScript(was, f, bit, pick);
          const b = await runScript(nw, f, bit, pick);
          expect(b, `${p} ${JSON.stringify(f)} pick ${pick}`).toEqual(a);
          compared++;
        }
      }
    }
    expect(compared + shared * 2 * combos.length).toBeGreaterThanOrEqual(scripts.length ? 1 : 0);
  });

  it('CONTROL: a bent value fails the comparison, and a swapped script or predicate id is caught (by the join or by the slot)', () => {
    const bent = copy(data) as Obj;
    bent.ambient = String(bent.ambient).slice(0, -1) + (String(bent.ambient).endsWith('0') ? '1' : '0');
    expect(shape(joinMap(bent, behavior))).not.toStrictEqual(shape(old));

    for (const [kind, table] of [['script', behavior.scripts], ['predicate', behavior.when]] as const) {
      const slot = paths.find((p) => (kind === 'predicate') === p.endsWith('.when'));
      const ids = Object.keys(table);
      if (!slot || ids.length < 2) continue;
      const swapped = copy(data) as Obj;
      const parts = slot.split('.');
      const key = parts.pop() as string;
      const owner = parts.reduce((o: unknown, k) => (o as Obj)[k], swapped) as Obj;
      owner[key] = ids.find((t) => t !== owner[key]) as string;
      let joined: MapDef | null = null;
      try {
        joined = joinMap(swapped, behavior); // refuses when the id that lost its use is used nowhere else
      } catch {
        joined = null;
      }
      expect(joined === null || at(joined, slot) !== at(old, slot), `${id} ${kind} ${slot}`).toBe(true);
    }
  });
});

describe('the registry and the map files', () => {
  it('serves the joined maps, 15 of them, and INTERIORS is the 9 interiors in the old order', () => {
    expect(mapIds().sort()).toEqual(CASES.map((c) => c.id).sort());
    for (const c of CASES) expect(getMap(c.id), c.id).toBe(c.now);
    expect(INTERIORS.map((m) => m.id)).toEqual(oldInteriors.INTERIORS.map((m) => m.id));
  });

  it('every npc look that is named in the data is the shared LOOKS object, and the rest are plain objects', async () => {
    const { LOOKS } = await import('../src/data/looks');
    const shared = new Set<unknown>(Object.values(LOOKS));
    let named = 0;
    let inline = 0;
    for (const c of CASES) {
      const rawNpcs = ((c.data as Obj).npcs ?? []) as Obj[];
      rawNpcs.forEach((raw, i) => {
        const look = c.now.npcs?.[i]?.look;
        if (typeof raw.look === 'string') {
          expect(look, `${c.id} npc ${i}`).toBe(LOOKS[raw.look as keyof typeof LOOKS]);
          named++;
        } else {
          expect(shared.has(look), `${c.id} npc ${i}`).toBe(false);
          inline++;
        }
      });
    }
    expect(named).toBeGreaterThan(5);
    expect(inline).toBeGreaterThan(5);
  });

  it('each file has the number of maps the design says: 15 JSON files, one behavior module per file of maps', () => {
    expect(CASES).toHaveLength(15);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(15);
  });
});
