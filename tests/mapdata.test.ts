/**
 * M5 task 3 (decision 1): a map is a JSON file of plain values plus a behavior module, joined by `joinMap` (src/data/maps/mapdata.ts).
 * The sample is `rustyard`. The proof is a frozen copy of the old TypeScript map (`tests/fixtures/maps/rustyard-old.ts`, made before the move):
 *
 *   1. everything that is a plain value deep-equals the frozen copy (a function stands as a marker, so the SLOTS of code are compared too);
 *   2. every function in the joined map IS the behavior module's export for the id the JSON names (identity, so no reference is lost or swapped);
 *   3. every function equals the frozen copy's: the same object (the story scripts imported from `story/chapter1`), or the same source text
 *      (moved word for word) AND the same observable behavior: predicates over every flag combination, scripts over a recording script API.
 *
 * Controls: a changed value, a swapped script id, a missing id and a lost reference each fail.
 */
import { describe, expect, it } from 'vitest';
import type { MapDef } from '../src/field/types';
import type { ScriptApi } from '../src/game/script';
import { getMap, mapIds } from '../src/data/maps';
import { checkMap, joinMap, type MapBehavior } from '../src/data/maps/mapdata';
import { rustyard, rustyardBehavior } from '../src/data/maps/rustyard';
import data from '../src/data/maps/rustyard.json' with { type: 'json' };
import { rustyard as old } from './fixtures/maps/rustyard-old';

type Obj = Record<string, unknown>;
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The value with each function replaced by a marker, for a deep comparison of everything else. */
function shape(v: unknown): unknown {
  if (typeof v === 'function') return '[function]';
  if (Array.isArray(v)) return v.map(shape);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)]));
  return v;
}

/** Every path to a function in `v`. */
function functionPaths(v: unknown, path = '', out: string[] = []): string[] {
  if (typeof v === 'function') out.push(path);
  else if (Array.isArray(v)) {
    v.forEach((x, i) => {
      functionPaths(x, path ? `${path}.${i}` : String(i), out);
    });
  }
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) functionPaths(x, path ? `${path}.${k}` : k, out);
  return out;
}

/** A function's source with the leading whitespace of each line removed. */
const flat = (f: unknown): string => String(f).replace(/^\s+/gm, '');

function at(v: unknown, path: string): unknown {
  let cur: unknown = v;
  for (const key of path.split('.')) cur = (cur as Obj)[key];
  return cur;
}

describe('rustyard: the JSON plus the behavior module give the old map', () => {
  it('everything but code deep-equals the frozen copy (strictly: no extra undefined keys)', () => {
    expect(shape(rustyard)).toStrictEqual(shape(old));
    expect(rustyard.terrain).toHaveLength(28);
    expect(rustyard.npcs).toHaveLength(9);
    expect(rustyard.events).toHaveLength(4);
  });

  it('the code slots are the same places: 18 functions, at the same paths', () => {
    const paths = functionPaths(rustyard);
    expect([...paths].sort()).toEqual(functionPaths(old).sort());
    expect(paths).toHaveLength(18);
  });

  it('every function is the behavior module\'s export for the id the JSON names (identity)', () => {
    for (const path of functionPaths(rustyard)) {
      const ref = at(data, path) as string;
      const last = path.split('.').pop();
      const table = last === 'when' ? rustyardBehavior.when : rustyardBehavior.scripts;
      expect(typeof ref, path).toBe('string');
      expect(at(rustyard, path), path).toBe(table[ref]);
    }
  });

  it('every function equals the frozen copy\'s: the same object, or the same source text and the same behavior', () => {
    let shared = 0;
    let moved = 0;
    for (const path of functionPaths(old)) {
      const was = at(old, path) as (...a: unknown[]) => unknown;
      const now = at(rustyard, path) as (...a: unknown[]) => unknown;
      if (was === now) {
        shared++; // magsReward, knucklesFight, rustyardGate: imported by both
        continue;
      }
      moved++;
      // esbuild indents a function by where it sits: compare the text without the indentation.
      expect(flat(now), path).toBe(flat(was));
    }
    expect([shared, moved]).toEqual([4, 14]);
  });

  /** All combinations of the flags the map reads. */
  const FLAGS = ['tribute_stash', 'rustyard_gate', 'knuckles', 'tribute_hint', 'coprocessor_given', 'camp_kept'];
  const combos = Array.from({ length: 1 << FLAGS.length }, (_, n) => Object.fromEntries(FLAGS.map((f, i) => [f, !!(n & (1 << i))])));

  it('the predicates answer the same as the old ones for all 64 flag combinations', () => {
    let compared = 0;
    for (const path of functionPaths(old).filter((p) => p.endsWith('.when'))) {
      const was = at(old, path) as (f: Obj) => boolean;
      const now = at(rustyard, path) as (f: Obj) => boolean;
      const answers = combos.map((f) => now(f));
      expect(answers, path).toEqual(combos.map((f) => was(f)));
      // not constant: a predicate that always says yes would pass this by luck
      expect(new Set(answers).size, path).toBe(2);
      compared++;
    }
    expect(compared).toBe(10);
  });

  /** A script API that writes down every call. `flag` reads the flags; `ask` answers with `pick`. */
  function recording(flags: Obj, pick: number): { api: ScriptApi; calls: string[] } {
    const calls: string[] = [];
    const api = new Proxy({} as Obj, {
      get(_t, name: string) {
        if (name === 'flag') return (n: string) => !!flags[n];
        return (...args: unknown[]) => {
          calls.push(`${name}(${JSON.stringify(args)})`);
          return name === 'ask' ? Promise.resolve(pick) : Promise.resolve();
        };
      },
    }) as unknown as ScriptApi;
    return { api, calls };
  }

  it('the moved scripts make the same calls as the old ones: 64 flag combinations, both answers to a question', async () => {
    const scriptPaths = functionPaths(old).filter((p) => !p.endsWith('.when'));
    let compared = 0;
    let calling = 0;
    for (const path of scriptPaths) {
      const was = at(old, path) as (s: ScriptApi) => Promise<void>;
      const now = at(rustyard, path) as (s: ScriptApi) => Promise<void>;
      if (was === now) continue;
      for (const f of combos) {
        for (const pick of [0, 1]) {
          const a = recording(f, pick);
          const b = recording(f, pick);
          await was(a.api);
          await now(b.api);
          expect(b.calls, `${path} ${JSON.stringify(f)} pick ${pick}`).toEqual(a.calls);
          if (a.calls.length) calling++;
          compared++;
        }
      }
    }
    expect(compared).toBe(4 * 64 * 2); // tobin, scav_kid, loose_scrap, depot_lock
    expect(calling).toBeGreaterThan(300);
  });

  it('the data is plain values: it survives a JSON round trip unchanged, and holds no function', () => {
    expect(copy(data)).toEqual(data);
    expect(functionPaths(data)).toEqual([]);
  });

  it('the registry gives the joined map, and still lists the 15 maps', () => {
    expect(getMap('rustyard')).toBe(rustyard);
    expect(mapIds()).toHaveLength(15);
    expect(mapIds()).toContain('rustyard');
  });

  it('the npc looks that are named are the shared LOOKS objects (art/drawn.ts compares them by identity)', async () => {
    const { LOOKS } = await import('../src/data/looks');
    const byId = Object.fromEntries((rustyard.npcs ?? []).map((n) => [n.id, n.look]));
    expect(byId.mags).toBe(LOOKS.mags);
    expect(byId.gate_punk).toBe(LOOKS.ganger);
    expect(byId.guard_a).toBe(LOOKS.ganger);
    // The inline ones are plain objects, not in LOOKS.
    expect(Object.values(LOOKS)).not.toContain(byId.knuckles);
    expect(Object.values(LOOKS)).not.toContain(byId.guard_b);
  });
});

describe('rustyard: the controls (the proof can fail)', () => {
  const join = (d: unknown, b: MapBehavior = rustyardBehavior): MapDef => joinMap(d, b);

  it('a changed value fails the deep comparison', () => {
    const bent = copy(data) as Obj;
    ((bent.chests as Obj[])[2] as Obj).cred = 121;
    (bent.terrain as string[])[3] = (bent.terrain as string[])[3]?.replace('r', 'd') ?? '';
    ((bent.lights as Obj[])[0] as Obj).r = 61;
    expect(shape(join(bent))).not.toStrictEqual(shape(old));
    // one change at a time, each on its own
    for (const edit of [
      (d: Obj) => ((d.chests as Obj[])[2] as Obj).cred = 121,
      (d: Obj) => ((d.npcs as Obj[])[0] as Obj).x = 24,
      (d: Obj) => ((d.warps as Obj[])[0] as Obj).tx = 52,
      (d: Obj) => d.ambient = '#605a87',
      (d: Obj) => ((d.props as Obj[])[5] as Obj).color = '#fff',
    ]) {
      const d = copy(data) as Obj;
      edit(d);
      expect(shape(join(d)), String(edit)).not.toStrictEqual(shape(old));
    }
  });

  it('a swapped script id is caught by the identity check (the move cannot lose a reference silently)', () => {
    const swapped = copy(data) as Obj;
    ((swapped.npcs as Obj[])[0] as Obj).talk = 'tobin'; // was mags_reward
    // The script nobody uses any more is named by the check, in plain words, and the join refuses.
    expect(checkMap(swapped, rustyardBehavior)).toEqual([expect.stringContaining('"mags_reward"')]);
    expect(() => join(swapped)).toThrow('"mags_reward"');
    // With that script taken out of the behavior too, the join works, and the slot is no longer the old function.
    const { mags_reward: _gone, ...scripts } = rustyardBehavior.scripts;
    const joined = join(swapped, { when: rustyardBehavior.when, scripts });
    expect(joined.npcs?.[0]?.talk).toBe(rustyardBehavior.scripts.tobin);
    expect(joined.npcs?.[0]?.talk).not.toBe(old.npcs?.[0]?.talk);
  });

  it('a predicate swapped for another gives other answers, so the probe in the test above would fail', () => {
    const swapped = copy(data) as Obj;
    ((swapped.npcs as Obj[])[1] as Obj).when = 'knuckles_alive'; // was gate_unpassed
    const joined = join(swapped);
    const f = { rustyard_gate: true, knuckles: false };
    expect(joined.npcs?.[1]?.when?.(f)).not.toBe(old.npcs?.[1]?.when?.(f));
  });
});

describe('checkMap: the shipped file, and bad edits named in plain words', () => {
  const problems = (edit: (d: Obj) => void, b: MapBehavior = rustyardBehavior): string[] => {
    const d = copy(data) as Obj;
    edit(d);
    return checkMap(d, b);
  };
  const first = (edit: (d: Obj) => void): string => problems(edit)[0] ?? '';

  it('the shipped rustyard has no problem', () => {
    expect(checkMap(data, rustyardBehavior)).toEqual([]);
  });

  it('refuses what is not a map', () => {
    expect(checkMap(null, rustyardBehavior)).toEqual(['map: the file must be an object']);
    expect(checkMap([], rustyardBehavior)).toEqual(['map: the file must be an object']);
  });

  it('names 22 kinds of bad edit', () => {
    const cases: [string, (d: Obj) => void, string][] = [
      ['an unknown field', (d) => { d.colour = 'x'; }, '"colour" is not a field'],
      ['a number for the id', (d) => { d.id = 5; }, 'id must be text'],
      ['a bad kind', (d) => { d.kind = 'cave'; }, 'kind must be one of'],
      ['a bad weather', (d) => { d.weather = 'snow'; }, 'weather must be one of'],
      ['a bad ambient color', (d) => { d.ambient = 'purple'; }, 'ambient must be a color'],
      ['no terrain', (d) => { d.terrain = []; }, 'terrain must be a list of rows'],
      ['a legend terrain that does not exist', (d) => { (d.legend as Obj).J = 'lava'; }, 'is "lava", which is not a terrain'],
      ['a prop kind that does not exist', (d) => { ((d.props as Obj[])[0] as Obj).kind = 'spaceship'; }, 'kind "spaceship" is not a prop'],
      ['a prop off the map', (d) => { ((d.props as Obj[])[0] as Obj).x = 99; }, 'the map is 34 by 28 tiles'],
      ['a prop at a fraction', (d) => { ((d.props as Obj[])[0] as Obj).y = 2.5; }, 'whole numbers'],
      ['a light with no radius', (d) => { ((d.lights as Obj[])[0] as Obj).r = 0; }, 'radius) must be a number above 0'],
      ['a light with a word for a color', (d) => { ((d.lights as Obj[])[0] as Obj).color = 'green'; }, 'color must be a color'],
      ['an npc with an unknown look', (d) => { ((d.npcs as Obj[])[0] as Obj).look = 'nobody'; }, 'look "nobody" is not in LOOKS'],
      ['an npc with a bad dir', (d) => { ((d.npcs as Obj[])[0] as Obj).dir = 'north'; }, 'dir must be one of'],
      ['an npc talk that names no script', (d) => { ((d.npcs as Obj[])[0] as Obj).talk = 'nobody_home'; }, 'talk "nobody_home" is not in the behavior module'],
      ['an npc with an empty talk list', (d) => { ((d.npcs as Obj[])[1] as Obj).talk = []; }, 'talk as a list must be lines'],
      ['a when that names no predicate', (d) => { ((d.npcs as Obj[])[1] as Obj).when = 'maybe'; }, 'when "maybe" is not in the behavior module'],
      ['an event with no run', (d) => { delete ((d.events as Obj[])[0] as Obj).run; }, 'run is needed'],
      ['two events with one id', (d) => { ((d.events as Obj[])[1] as Obj).id = 'loose_scrap'; }, 'two events have the id "loose_scrap"'],
      ['a chest with nothing in it', (d) => { delete ((d.chests as Obj[])[0] as Obj).cred; }, 'needs an item or cred'],
      ['a patch outside the map', (d) => { (((d.patches as Obj[])[0] as Obj).rects as unknown[][])[0] = [40, 0, 3, 2, 'd']; }, 'is outside the map'],
      ['a warp with no target', (d) => { delete ((d.warps as Obj[])[0] as Obj).to; }, 'to must be text'],
    ];
    expect(cases).toHaveLength(22);
    for (const [name, edit, want] of cases) expect(first(edit), name).toContain(want);
  });

  it('a script that no data uses is a problem (a lost reference)', () => {
    const b: MapBehavior = { ...rustyardBehavior, scripts: { ...rustyardBehavior.scripts, orphan: async () => undefined } };
    expect(problems(() => undefined, b)).toEqual([expect.stringContaining('the script "orphan", which no data uses')]);
    const w: MapBehavior = { ...rustyardBehavior, when: { ...rustyardBehavior.when, orphan: () => true } };
    expect(problems(() => undefined, w)).toEqual([expect.stringContaining('the predicate "orphan", which no data uses')]);
  });

  it('joinMap throws with the whole list of problems', () => {
    const d = copy(data) as Obj;
    d.kind = 'cave';
    ((d.npcs as Obj[])[0] as Obj).look = 'nobody';
    expect(() => joinMap(d, rustyardBehavior)).toThrow(/kind must be one of[\s\S]*look "nobody"/);
  });
});
