/**
 * Hacks are data (editor contract item a and b, pass line 3 of docs/engine/m7-brief.md): `src/data/hacks.json`, read through `checkHacks`
 * (the condition of decision E3). The file is plain JSON, so a tool can edit it and a round trip changes nothing.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkHacks, HACKS, hackDef, makeHackDef } from '../src/hack3d/data';
import type { HackDef } from '../src/hack3d/result';

const ROOT = join(import.meta.dirname, '..');
const raw: unknown = JSON.parse(readFileSync(join(ROOT, 'src/data/hacks.json'), 'utf8'));
const first = (): HackDef => {
  const h = HACKS[0];
  if (!h) throw new Error('hacks.json is empty');
  return h;
};
/** One definition as plain JSON, with `over` merged in, wrapped in the file shape. */
const file = (over: Record<string, unknown>): unknown => ({ transition: (raw as { transition: unknown }).transition, hacks: [{ ...JSON.parse(JSON.stringify(first())), ...over }] });

describe('src/data/hacks.json', () => {
  it('passes checkHacks, and the loader returns exactly the file’s definitions', () => {
    expect(checkHacks(raw)).toEqual([]);
    expect(HACKS).toEqual((raw as { hacks: unknown[] }).hacks);
    expect(HACKS.length).toBeGreaterThanOrEqual(3);
  });

  it('a JSON round trip changes nothing (the editor contract)', () => {
    expect(JSON.parse(JSON.stringify(raw))).toEqual(raw);
    expect(checkHacks(JSON.parse(JSON.stringify(raw)))).toEqual([]);
  });

  it('every id is unique, and the test scene’s definition is in the file', () => {
    const ids = HACKS.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('test-hack');
    expect(hackDef('test-hack')).toEqual(HACKS.find((h) => h.id === 'test-hack'));
  });

  it('hackDef(id) throws on an id that is not in the file, naming the ids it knows', () => {
    expect(() => hackDef('no-such-hack')).toThrow(/no-such-hack.*test-hack/);
  });

  it('hackDef(id, over) and makeHackDef(over) merge fields without changing the file’s data', () => {
    const before = JSON.stringify(HACKS);
    expect(hackDef('test-hack', { seed: 99 }).seed).toBe(99);
    expect(makeHackDef({ ticks: 12 }).ticks).toBe(12);
    expect(makeHackDef().id).toBe('test-hack');
    expect(JSON.stringify(HACKS)).toBe(before);
  });
});

describe('checkHacks rejects a bad file', () => {
  it('a function field (JSON cannot hold one, but a data object in code can)', () => {
    expect(checkHacks(file({ seed: () => 7 })).join('\n')).toMatch(/seed/);
  });
  it('NaN, Infinity and a string where a number belongs', () => {
    expect(checkHacks(file({ ticks: Number.NaN })).join('\n')).toMatch(/ticks/);
    expect(checkHacks(file({ hitCost: Number.POSITIVE_INFINITY })).join('\n')).toMatch(/hitCost/);
    expect(checkHacks(file({ traceLimit: '100' })).join('\n')).toMatch(/traceLimit/);
  });
  it('a negative count, a zero length, and a count the simulation would clamp', () => {
    expect(checkHacks(file({ iceCount: -1 })).join('\n')).toMatch(/iceCount/);
    expect(checkHacks(file({ iceCount: 6 })).join('\n')).toMatch(/iceCount/);
    expect(checkHacks(file({ iceCount: 2.5 })).join('\n')).toMatch(/iceCount/);
    expect(checkHacks(file({ ticks: 0 })).join('\n')).toMatch(/ticks/);
    expect(checkHacks(file({ hitCost: -3 })).join('\n')).toMatch(/hitCost/);
  });
  it('an unknown key, in a definition and at the top of the file', () => {
    expect(checkHacks(file({ colour: 'pink' })).join('\n')).toMatch(/colour/);
    expect(checkHacks({ hacks: [], extra: 1 }).join('\n')).toMatch(/extra/);
  });
  it('a missing field, a bad id, a duplicate id and a bad policy', () => {
    const missing = JSON.parse(JSON.stringify(first())) as Record<string, unknown>;
    delete missing.seed;
    expect(checkHacks({ hacks: [missing] }).join('\n')).toMatch(/seed/);
    expect(checkHacks(file({ id: 'Bad Id' })).join('\n')).toMatch(/id/);
    expect(checkHacks({ hacks: [first(), first()] }).join('\n')).toMatch(/duplicate/i);
    expect(checkHacks(file({ policy: { aborted: 'whatever', unsupported: 'fail' } })).join('\n')).toMatch(/policy/);
    expect(checkHacks(file({ policy: { aborted: 'fail' } })).join('\n')).toMatch(/policy/);
  });
  it('a file that is not the right shape at all', () => {
    expect(checkHacks(null)).not.toEqual([]);
    expect(checkHacks([])).not.toEqual([]);
    expect(checkHacks({ hacks: 'no' })).not.toEqual([]);
  });
  it('control: a good definition with a valid policy passes (the checker is not just rejecting everything)', () => {
    expect(checkHacks(file({ policy: { aborted: 'succeed', unsupported: 'alternative' } }))).toEqual([]);
  });
});

describe('the test scene reads its definition from the file', () => {
  it('hackscene.ts and the entry point of the 3D chunk name no literal definition: no `iceCount:` or `traceLimit:` outside data.ts and the sim', () => {
    for (const f of ['src/hack3d/hackscene.ts', 'src/hack3d/index.ts', 'src/hack3d/door.ts', 'src/game/hackseam.ts']) {
      const text = readFileSync(join(ROOT, f), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      expect(text, f).not.toMatch(/\b(iceCount|traceLimit|hitCost)\s*:/);
    }
  });
  it('makeHackDef is named by the data loader alone in src/', () => {
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/\.(ts|tsx)$/.test(e.name) && readFileSync(join(ROOT, rel), 'utf8').includes('makeHackDef')) found.push(rel);
      }
    };
    walk('src');
    expect(found).toEqual(['src/hack3d/data.ts']);
  });
});
