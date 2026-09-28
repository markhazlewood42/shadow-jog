/**
 * Content integrity: every id one table names exists in the table it names. A renamed or
 * mistyped id fails here, instead of surfacing as an undefined mid-battle or a missing shelf.
 */
import { describe, expect, it } from 'vitest';
import { ENEMY_ART_KEYS } from '../src/art/enemies';
import { ABILITIES, COMBOS, LEARNSETS } from '../src/data/abilities';
import { ENCOUNTERS, ENEMIES } from '../src/data/enemies';
import { ITEMS } from '../src/data/items';
import { getMap, mapIds } from '../src/data/maps';
import { SHOPS } from '../src/data/shops';

const missing = (ids: string[], table: Record<string, unknown>) => ids.filter((id) => !(id in table));

describe('content integrity', () => {
  it('enemies: every move is an ability, every drop an item, every sprite has art', () => {
    const moves = Object.values(ENEMIES).flatMap((e) => e.moves.map((m) => m.id).filter((id) => id !== 'attack'));
    expect(missing(moves, ABILITIES)).toEqual([]);
    expect(missing(Object.values(ENEMIES).flatMap((e) => (e.drops ?? []).map((d) => d.id)), ITEMS)).toEqual([]);
    expect(Object.values(ENEMIES).map((e) => e.sprite).filter((k) => !ENEMY_ART_KEYS.includes(k))).toEqual([]);
  });

  it('encounters name real enemies; maps name real encounter tables', () => {
    expect(missing(Object.values(ENCOUNTERS).flatMap((gs) => gs.flatMap((g) => g.e)), ENEMIES)).toEqual([]);
    const tables = mapIds().flatMap((id) => (getMap(id).encounters ?? []).map((z) => z.table));
    expect(missing(tables, ENCOUNTERS)).toEqual([]);
  });

  it('abilities: learnsets and combos name real abilities; every combo is itself an ability', () => {
    expect(missing(Object.values(LEARNSETS).flatMap((ls) => ls.map((l) => l.id)), ABILITIES)).toEqual([]);
    expect(missing(COMBOS.flatMap((c) => [c.id, ...c.parts.map((p) => p.ability)]), ABILITIES)).toEqual([]);
  });

  it('shops and chests stock real items; warps lead to real maps', () => {
    expect(missing(Object.values(SHOPS).flatMap((s) => s.items), ITEMS)).toEqual([]);
    const chestItems = mapIds().flatMap((id) => (getMap(id).chests ?? []).flatMap((c) => (c.item ? [c.item] : [])));
    expect(missing(chestItems, ITEMS)).toEqual([]);
    const targets = mapIds().flatMap((id) => (getMap(id).warps ?? []).map((w) => w.to));
    expect(targets.filter((t) => !mapIds().includes(t))).toEqual([]);
  });

  it('the ids the battle engine names directly exist', () => {
    expect(missing(['attack'], ABILITIES)).toEqual([]);
    expect(missing(['warden', 'warden_spirit'], ENEMIES)).toEqual([]);
  });
});
