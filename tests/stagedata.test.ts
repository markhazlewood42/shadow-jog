import { describe, expect, it } from 'vitest';
import { BG_IDS } from '../src/art/battlebg';
import stagesJson from '../src/data/stages.json';
import { ENEMIES } from '../src/data/enemies';
import { checkStages, enemyScaleFor, enemyShadowWidth, loadStages, slotPoint, snapSlot, stageOf, type StageFile } from '../src/stage/config';
import { idleFrame } from '../src/stage/idle';
import { CREW_IDS } from '../src/stage/crew';

/** A fresh copy of the shipped file to break one thing at a time. */
const copy = (): StageFile => JSON.parse(JSON.stringify(stagesJson)) as StageFile;
const street = (f: StageFile) => stageOf(f, 'street');
const known = { enemies: Object.keys(ENEMIES), crew: CREW_IDS };
const problems = (mutate: (s: StageFile['street']) => void): string[] => {
  const f = copy();
  mutate(street(f));
  return checkStages(f, BG_IDS, known);
};

describe('stage config: who stands where, enemy size, floor limits and the drag snap (no Phaser)', () => {
  it('the shipped file passes with the real enemy keys and crew ids', () => {
    expect(checkStages(stagesJson, BG_IDS, known)).toEqual([]);
    const s = street(loadStages(stagesJson, BG_IDS, known));
    expect(s.lineup).toEqual(['hex', 'sable', 'rook', 'kit']);
    expect(s.fight.length).toBeGreaterThan(0);
  });

  it('a lineup that is not four, repeats someone or names a stranger', () => {
    expect(problems((s) => { s.lineup.pop(); })).toEqual(expect.arrayContaining([expect.stringContaining('lineup: needs exactly 4')]));
    expect(problems((s) => { s.lineup[1] = 'hex'; })).toEqual(expect.arrayContaining([expect.stringContaining('appears twice')]));
    expect(problems((s) => { s.lineup[0] = 'nobody'; })).toEqual(expect.arrayContaining([expect.stringContaining('"nobody" is not one that exists')]));
  });

  it('a fight of 0 or 5 enemies, or of an enemy that does not exist', () => {
    expect(problems((s) => { s.fight = []; })).toEqual(expect.arrayContaining([expect.stringContaining('fight: needs 1 to 4')]));
    expect(problems((s) => { s.fight = ['glowrat', 'glowrat', 'glowrat', 'glowrat', 'glowrat']; })).toEqual(expect.arrayContaining([expect.stringContaining('fight: needs 1 to 4')]));
    expect(problems((s) => { s.fight = ['dragon']; })).toEqual(expect.arrayContaining([expect.stringContaining('"dragon" is not one that exists')]));
  });

  it('the same enemy may stand in the fight twice (a gang)', () => {
    expect(problems((s) => { s.fight = ['rustfang_punk', 'rustfang_punk']; })).toEqual([]);
  });

  it('enemyScale takes whole numbers 1 to 4; shadow.enemyScale a number 0 to 3', () => {
    expect(problems((s) => { s.enemyScale = { punk: 2, '*': 1 }; })).toEqual([]);
    expect(problems((s) => { s.enemyScale = { '*': 1.5 }; })).toEqual(expect.arrayContaining([expect.stringContaining('whole number from 1 to 4')]));
    expect(problems((s) => { s.enemyScale = { '*': 0 }; })).toEqual(expect.arrayContaining([expect.stringContaining('whole number from 1 to 4')]));
    expect(problems((s) => { s.shadow.enemyScale = 5; })).toEqual(expect.arrayContaining([expect.stringContaining('enemyScale 0-3')]));
    expect(problems((s) => { s.shadow.enemyScale = 0.5; })).toEqual([]);
  });

  it('enemyScaleFor prefers the named kind, then "*", then the art’s own scale; the shadow follows shadow.enemyScale', () => {
    const s = street(copy());
    delete s.enemyScale;
    expect(enemyScaleFor(s, 'punk', 1)).toBe(1);
    expect(enemyScaleFor(s, 'punk', 2)).toBe(2);
    s.enemyScale = { '*': 3, punk: 2 };
    expect(enemyScaleFor(s, 'punk', 1)).toBe(2);
    expect(enemyScaleFor(s, 'rat', 1)).toBe(3);
    s.shadow.enemyScale = 1;
    expect(enemyShadowWidth(s, 52)).toBe(52);
    s.shadow.enemyScale = 0.5;
    expect(enemyShadowWidth(s, 52)).toBe(26);
    s.shadow.enemyScale = 0;
    expect(enemyShadowWidth(s, 52)).toBe(0);
    delete s.shadow.enemyScale;
    expect(enemyShadowWidth(s, 52)).toBe(52);
  });

  it('slotPoint keeps the feet inside the floor band and the screen, so floor.top and floor.bottom do their job', () => {
    const s = street(copy());
    // Row 0 is at 176; move the floor's top below it and that row's feet are pushed down onto the band.
    s.floor.top = 190;
    expect(slotPoint(s, { row: 0, x: 58 }).y).toBe(190);
    s.floor.bottom = 240;
    expect(slotPoint(s, { row: 3, x: 178 }).y).toBe(240);
    expect(slotPoint(s, { row: 1, x: -30 }).x).toBe(0);
    expect(slotPoint(s, { row: 1, x: 900 }).x).toBe(480);
  });

  it('snapSlot picks the nearest row and keeps each side on its own half of the screen', () => {
    const s = street(copy());
    expect(snapSlot(s, 'party', 100, 180)).toEqual({ row: 0, x: 100 });
    expect(snapSlot(s, 'party', 100, 222)).toEqual({ row: 2, x: 100 });
    expect(snapSlot(s, 'party', 100, 400).row).toBe(3);
    expect(snapSlot(s, 'party', 100, 0).row).toBe(0);
    // A hero dragged to the enemy half stops at the middle; an enemy dragged to the hero half stops there too.
    expect(snapSlot(s, 'party', 400, 200).x).toBe(239);
    expect(snapSlot(s, 'enemy', 20, 200).x).toBe(240);
    expect(snapSlot(s, 'enemy', 500, 200).x).toBe(480);
    expect(snapSlot(s, 'enemy', 333.6, 200).x).toBe(334);
  });

  it('snapSlot measures to a row as it is clamped to the floor', () => {
    const s = street(copy());
    s.floor.top = 190; // row 0 now stands at 190, not 176
    expect(snapSlot(s, 'party', 100, 185).row).toBe(0); // 5 from 190, 16 from 201
    expect(snapSlot(s, 'party', 100, 196).row).toBe(1); // 11 from 190, 5 from 201
  });
});

describe('idleFrame (the heroes’ sheet frame, chosen from the fixed tick)', () => {
  it('plays the sheet at its own fps against the 60 a second tick, and loops', () => {
    // 8 frames at 8 fps: a new frame every 7.5 ticks.
    expect([0, 7, 8, 15, 16, 59, 60].map((t) => idleFrame(t, 8, 8))).toEqual([0, 0, 1, 2, 2, 7, 0]);
    expect(idleFrame(60 * 10, 8, 8)).toBe(0);
  });

  it('is a pure function of the tick, and the phase starts a hero part-way round the loop', () => {
    expect(idleFrame(123, 12, 6, 2)).toBe(idleFrame(123, 12, 6, 2));
    expect(idleFrame(0, 8, 8, 3)).toBe(3);
    expect(idleFrame(0, 8, 8, 11)).toBe(3);
  });

  it('never goes out of range, and the same tick always shows the same frame (so a hit-pause holds every figure still)', () => {
    for (let t = 0; t < 500; t += 7) {
      const f = idleFrame(t, 11, 5, 4);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(5);
    }
    expect(idleFrame(40, 8, 8)).toBe(idleFrame(40, 8, 8));
  });
});
