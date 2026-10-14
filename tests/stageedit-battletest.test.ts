/**
 * Battle Test, the parts that are plain code (ET task 6; docs/engine/et-brief.md decision 2, option B). The fight itself is the game's own `BattleScene`, which runs in a browser:
 * `e2e/battletest.spec.ts` plays it. These cases cover the dialog's data and the key forwarding, and two cases come from the archive's `tests/stagebattle.test.ts` (the dialog's
 * status panel and `stageForTest`). The rest of that file tested the spike's own battle flow, which option B does not build (see "Archive cases dropped" in the brief's Record).
 */
import { describe, expect, it } from 'vitest';
import { initialParty, loadoutStats, troopsOf } from '../src/dev/stageedit/battledialog';
import { type BattleTestOptions, forwardKey, stageForTest } from '../src/dev/stageedit/battletest';
import { fixtureStages } from './stagefiles';

const street = fixtureStages().street;
if (!street) throw new Error('the fixture has no street stage');

describe('the dialog’s status panel (archive case, ported)', () => {
  it('reads each loadout through the game’s own stat code', () => {
    const rook = loadoutStats(street.demo, 1);
    expect(rook?.name).toBe('Rook');
    expect(rook?.maxHp).toBeGreaterThan(100);
    expect(rook?.skills).toContain('Arc Cut');
    const kit = loadoutStats(street.demo, 0);
    expect(kit?.resLabel).toBe('KI');
    expect(kit?.maxTp).toBeGreaterThan(0);
    expect(loadoutStats(street.demo, 9)).toBeNull();
  });

  it('a higher level comes to more health (control: the panel is not a constant)', () => {
    const low = structuredClone(street.demo);
    const high = structuredClone(street.demo);
    const rook = (d: typeof low, level: number) => {
      const m = d.party[1];
      if (m) m.level = level;
    };
    rook(low, 3);
    rook(high, 20);
    expect(loadoutStats(high, 1)?.maxHp).toBeGreaterThan(loadoutStats(low, 1)?.maxHp ?? Number.POSITIVE_INFINITY);
  });
});

describe('the stage the test runs on (archive case, ported)', () => {
  it('is built from the dialog’s choices without touching the original', () => {
    const o: BattleTestOptions = { party: [{ id: 'rook', level: 12 }, { id: 'kit', level: 3 }], roster: ['glowrat', 'glowrat'], setKey: '2', seed: 3, fullResources: true, speed: 1, auto: false };
    const before = JSON.stringify(street);
    const t = stageForTest(street, o);
    expect(t.demo.lineup).toEqual(['rook', 'kit']);
    expect(t.demo.party[0]?.level).toBe(12);
    expect(t.demo.rosters['2']).toEqual(['glowrat', 'glowrat']);
    expect(JSON.stringify(street)).toBe(before);
  });
});

describe('the dialog’s troop and party', () => {
  it('lists the enemy groups the stage has slots for, the numbers first and the boss groups last', () => {
    const keys = troopsOf(street).map((t) => t.key);
    expect(keys.length).toBeGreaterThan(2);
    for (const k of keys) expect(k in street.enemySets, k).toBe(true);
    const bossAt = keys.findIndex((k) => k.startsWith('boss'));
    if (bossAt >= 0) expect(keys.slice(bossAt).every((k) => k.startsWith('boss'))).toBe(true);
    expect(keys.filter((k) => !k.startsWith('boss')).map(Number)).toEqual(keys.filter((k) => !k.startsWith('boss')).map(Number).sort((a, b) => a - b));
  });

  it('starts from the stage’s own party, or from the last test when it still makes sense (levels kept in range)', () => {
    const own = initialParty(street, {});
    expect(own.map((m) => m.id)).toEqual(street.demo.party.map((m) => m.id));
    const ids = street.demo.party.map((m) => m.id);
    const remembered = initialParty(street, { party: ids.map((id) => ({ id, level: 5000 })) });
    expect(remembered.every((m) => m.level < 5000)).toBe(true);
    // A remembered party that repeats a member, or has the wrong size, is ignored.
    expect(initialParty(street, { party: [{ id: 'kit', level: 5 }] }).map((m) => m.id)).toEqual(ids);
    expect(initialParty(street, { party: ids.map(() => ({ id: 'kit', level: 5 })) }).map((m) => m.id)).toEqual(ids);
  });
});

describe('forwarding keys to the game’s input', () => {
  class FakeKey extends Event {
    readonly code: string;
    readonly key: string;
    readonly repeat: boolean;
    constructor(type: string, init: { code: string; key: string; repeat: boolean }) {
      super(type);
      this.code = init.code;
      this.key = init.key;
      this.repeat = init.repeat;
    }
  }
  const asKey = (type: string, code: string, mods: { ctrlKey?: boolean } = {}) => ({ type, code, key: code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...mods }) as unknown as KeyboardEvent;

  it('copies a plain key to the target, and leaves a Ctrl, Alt or Meta chord to the page', () => {
    (globalThis as unknown as { KeyboardEvent: unknown }).KeyboardEvent = FakeKey;
    const bus = new EventTarget();
    const heard: string[] = [];
    bus.addEventListener('keydown', (e) => heard.push((e as FakeKey).code));
    expect(forwardKey(bus, asKey('keydown', 'Enter'))).toBe(true);
    expect(heard).toEqual(['Enter']);
    // Control: a chord is not forwarded (the page keeps Ctrl+S, F5...).
    expect(forwardKey(bus, asKey('keydown', 'KeyS', { ctrlKey: true }))).toBe(false);
    expect(heard).toEqual(['Enter']);
  });
});
