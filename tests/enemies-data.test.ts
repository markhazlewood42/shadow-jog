/**
 * M3 task 8 (decision 5): the enemy and encounter data is JSON (`src/data/enemies.json`, `encounters.json`), read by the typed loader
 * in `src/data/enemies.ts`. The proof is a frozen copy of the objects as the old TypeScript file built them
 * (`tests/fixtures/enemies/old-enemies.json`, made before the move): the loaded objects must deep-equal it. Control: a changed field fails.
 */
import { describe, expect, it } from 'vitest';
import axesJson from '../src/data/axes.json';
import encountersJson from '../src/data/encounters.json';
import enemiesJson from '../src/data/enemies.json';
import enemyFacingJson from '../src/data/enemyfacing.json';
import { checkEncounters, checkEnemies, ENCOUNTERS, ENEMIES, ENEMY_LOOKS, loadEncounters, loadEnemies } from '../src/data/enemies';
import old from './fixtures/enemies/old-enemies.json';

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const ids = Object.keys(old.enemies);

describe('enemies.json and encounters.json give back the old objects', () => {
  it('ENEMIES deep-equals the frozen copy of the old enemies.ts objects (21 enemies)', () => {
    expect(Object.keys(ENEMIES)).toHaveLength(21);
    expect(ENEMIES).toEqual(old.enemies);
  });

  it('ENCOUNTERS deep-equals the frozen copy (11 tables, 37 groups)', () => {
    expect(Object.keys(ENCOUNTERS)).toHaveLength(11);
    expect(Object.values(ENCOUNTERS).flat()).toHaveLength(37);
    expect(ENCOUNTERS).toEqual(old.encounters);
  });

  it('CONTROL: one changed field fails the comparison (the test can fail)', () => {
    const bent = copy(enemiesJson);
    (bent.enemies.warden as { hp: number }).hp += 1;
    expect(loadEnemies(bent).enemies).not.toEqual(old.enemies);
    const bentGroups = copy(encountersJson);
    (bentGroups.encounters.street?.[0] as { w: number }).w += 1;
    expect(loadEncounters(bentGroups, ids)).not.toEqual(old.encounters);
  });

  it('the look fields are not in EnemyDef; they are in ENEMY_LOOKS, one per enemy', () => {
    for (const id of ids) {
      expect(ENEMIES[id], id).not.toHaveProperty('picture');
      expect(ENEMIES[id], id).not.toHaveProperty('mirror');
      expect(ENEMIES[id], id).not.toHaveProperty('note');
      expect(ENEMY_LOOKS[id], id).toBeDefined();
    }
  });

  it('the merged look equals the stage files it was merged from (enemyfacing.json by sprite, axes.json by sprite), so the two cannot drift', () => {
    for (const [id, def] of Object.entries(ENEMIES)) {
      const look = ENEMY_LOOKS[id];
      const f = (enemyFacingJson as Record<string, { mirror: boolean; facing: string; note: string }>)[def.sprite];
      expect(look?.mirror, `${id} mirror`).toBe(f?.mirror);
      expect(look?.picture, `${id} picture`).toEqual({ facing: f?.facing, note: f?.note });
      expect(look?.axis, `${id} axis`).toEqual((axesJson as Record<string, { x: number; y: number }>)[def.sprite]);
    }
  });
});

describe('checkEnemies and checkEncounters', () => {
  it('the shipped files have no problem', () => {
    expect(checkEnemies(enemiesJson)).toEqual([]);
    expect(checkEncounters(encountersJson, ids)).toEqual([]);
  });

  it('say what is wrong, in plain words, for each kind of bad edit', () => {
    const bad = (edit: (e: Record<string, Record<string, unknown>>) => void) => {
      const d = copy(enemiesJson) as unknown as { enemies: Record<string, Record<string, unknown>> };
      edit(d.enemies);
      return checkEnemies(d).join('\n');
    };
    expect(bad((e) => { e.warden!.hp = 0; })).toContain('hp must be at least 1');
    expect(bad((e) => { e.warden!.family = 'plant'; })).toContain('family must be one of');
    expect(bad((e) => { e.warden!.id = 'x'; })).toContain('id must be "warden"');
    expect(bad((e) => { e.warden!.speling = 1; })).toContain('"speling" is not a field');
    expect(bad((e) => { e.warden!.moves = []; })).toContain('moves must be a list with at least one move');
    expect(bad((e) => { e.warden!.mirror = 'yes'; })).toContain('mirror must be true or false');
    expect(bad((e) => { e.warden!.picture = { facing: 'up', note: 'x' }; })).toContain('picture.facing');
    expect(bad((e) => { e.warden!.axis = { x: 40, y: 0 }; })).toContain('more than 16 pixels');
    expect(bad((e) => { e.warden!.weak = { water: 2 }; })).toContain('"water" is not an element');
    expect(bad((e) => { e.warden!.immune = ['sleepy']; })).toContain('immune must be a list of status ids');
    expect(bad((e) => { e.warden!.sprite = 'medic'; })).toContain('is also used by');
    expect(checkEnemies({})).toHaveLength(1);
    expect(() => loadEnemies({ enemies: { a: {} } })).toThrow(/enemies\.json is not valid/);
  });

  it('a group naming an unknown enemy, an empty group or a zero weight is rejected', () => {
    const bad = (edit: (e: Record<string, { w: number; e: string[] }[]>) => void) => {
      const d = copy(encountersJson) as unknown as { encounters: Record<string, { w: number; e: string[] }[]> };
      edit(d.encounters);
      return checkEncounters(d, ids).join('\n');
    };
    expect(bad((t) => { t.street![0]!.e = ['ghost']; })).toContain('"ghost" is not an enemy');
    expect(bad((t) => { t.street![0]!.e = []; })).toContain('1 to 4 enemies');
    expect(bad((t) => { t.street![0]!.w = 0; })).toContain('weight w above 0');
    expect(bad((t) => { t.street = []; })).toContain('at least one group');
    expect(() => loadEncounters({ encounters: { street: [{ w: 1, e: ['ghost'] }] } }, ids)).toThrow(/encounters\.json is not valid/);
  });
});
