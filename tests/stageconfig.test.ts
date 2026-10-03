import { describe, expect, it } from 'vitest';
import { BG_IDS } from '../src/art/battlebg';
import stagesJson from '../src/data/stages.json';
import { checkStages, depthFor, enemySlots, loadStages, rowTint, slotPoint, stageOf, type StageFile } from '../src/stage/config';

/** A fresh copy of the shipped file to break one thing at a time. */
const copy = (): StageFile => JSON.parse(JSON.stringify(stagesJson)) as StageFile;
const street = (f: StageFile) => stageOf(f, 'street');

describe('stage config (the Phaser stage lab, no Phaser involved)', () => {
  it('the shipped src/data/stages.json is valid, and its backdrops exist', () => {
    expect(checkStages(stagesJson, BG_IDS)).toEqual([]);
    expect(Object.keys(loadStages(stagesJson))).toContain('street');
  });

  it('a slot is its row’s y and its own x; party rows climb to the back, enemy sets have the right head-count', () => {
    const s = street(loadStages(stagesJson));
    expect(slotPoint(s, { row: 2, x: 100 })).toEqual({ x: 100, y: s.rows[2]?.y });
    // The first party slot is the rearmost: higher on the screen (smaller y) and further left than the last.
    const first = slotPoint(s, s.party[0] ?? { row: 0, x: 0 });
    const last = slotPoint(s, s.party[3] ?? { row: 0, x: 0 });
    expect(first.y).toBeLessThan(last.y);
    expect(first.x).toBeLessThan(last.x);
    for (let n = 1; n <= 4; n++) expect(enemySlots(s, n)).toHaveLength(n);
    expect(() => enemySlots(s, 5)).toThrow(/no slots for 5/);
  });

  it('nearer draws on top, ties go to the right, and a shadow sits just under its own fighter', () => {
    expect(depthFor(200, 10)).toBeGreaterThan(depthFor(199, 479));
    expect(depthFor(200, 300)).toBeGreaterThan(depthFor(200, 120));
    expect(depthFor(200, 10) - 0.5).toBeGreaterThan(depthFor(199, 479));
  });

  it('row tints become Phaser tint numbers, white when a row has none', () => {
    const s = street(copy());
    s.rows[0] = { y: 176, tint: '#102030' };
    s.rows[1] = { y: 201 };
    expect(rowTint(s, 0)).toBe(0x102030);
    expect(rowTint(s, 1)).toBe(0xffffff);
  });

  it('names stages that do not exist', () => {
    expect(() => stageOf(loadStages(stagesJson), 'moon')).toThrow(/No stage "moon"/);
  });

  describe('rejects a bad file, in plain words', () => {
    const problems = (mutate: (s: StageFile['street']) => void, known: readonly string[] | undefined = BG_IDS): string[] => {
      const f = copy();
      mutate(street(f));
      return checkStages(f, known);
    };

    it('an unknown backdrop, only when the list of known ones is given', () => {
      const bad = (s: StageFile['street']) => {
        s.backdrop = 'moonbase';
      };
      expect(problems(bad)).toEqual(expect.arrayContaining([expect.stringContaining('moonbase')]));
      // Without the list of known backdrops the id is not checked.
      const f = copy();
      street(f).backdrop = 'moonbase';
      expect(checkStages(f)).toEqual([]);
    });

    it('fractional pixels, a floor above the horizon, rows outside the floor or out of order', () => {
      expect(problems((s) => { s.horizon = 120.5; })).toEqual(expect.arrayContaining([expect.stringContaining('horizon')]));
      expect(problems((s) => { s.floor.top = 100; })).toEqual(expect.arrayContaining([expect.stringContaining('above the horizon')]));
      expect(problems((s) => { s.rows[3] = { y: 300 }; })).toEqual(expect.arrayContaining([expect.stringContaining('outside the floor band')]));
      expect(problems((s) => { s.rows[1] = { y: 170 }; })).toEqual(expect.arrayContaining([expect.stringContaining('back to front')]));
    });

    it('a party that is not four, a slot on a row that does not exist, a hero on the enemy side, two on one spot', () => {
      expect(problems((s) => { s.party.pop(); })).toEqual(expect.arrayContaining([expect.stringContaining('exactly 4')]));
      expect(problems((s) => { s.party[0] = { row: 9, x: 50 }; })).toEqual(expect.arrayContaining([expect.stringContaining('row 9')]));
      expect(problems((s) => { s.party[0] = { row: 0, x: 300 }; })).toEqual(expect.arrayContaining([expect.stringContaining('wrong side')]));
      expect(problems((s) => { s.party[1] = { ...(s.party[0] as { row: number; x: number }) }; })).toEqual(expect.arrayContaining([expect.stringContaining('same spot')]));
    });

    it('a missing enemy slot set, a bad tint, a silly shadow', () => {
      expect(problems((s) => { delete s.enemies['3']; })).toEqual(expect.arrayContaining([expect.stringContaining('enemies["3"]')]));
      expect(problems((s) => { s.rows[0] = { y: 176, tint: 'blue' }; })).toEqual(expect.arrayContaining([expect.stringContaining('#rrggbb')]));
      expect(problems((s) => { s.shadow.alpha = 3; })).toEqual(expect.arrayContaining([expect.stringContaining('shadow')]));
    });

    it('loadStages throws one error listing everything wrong', () => {
      const f = copy();
      street(f).horizon = -5;
      street(f).party.pop();
      expect(() => loadStages(f)).toThrow(/horizon[\s\S]*exactly 4/);
    });

    it('not an object at all', () => {
      expect(checkStages(null)).toHaveLength(1);
      expect(checkStages({})).toHaveLength(1);
      expect(checkStages({ street: 5 })).toEqual(['stage "street": not an object']);
    });
  });
});
