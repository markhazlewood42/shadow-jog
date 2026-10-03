import { describe, expect, it } from 'vitest';
import { BG_IDS } from '../src/art/battlebg';
import stagesJson from '../src/data/stages.json';
import { checkAxes, checkStages, depthFor, loadStages, ORDER_STEP, type StageConfig, type StageFile, setSize, slotPoint } from '../src/stage/config';
import { hitGrip, hitHud, hitLine, resizeBox } from '../src/stage/edit/hit';
import { comboOf, KEYS, matchKey, RESERVED } from '../src/stage/edit/keys';
import {
  addRow,
  alignedSlots,
  alignEnemies,
  cloneStage,
  copyFromPrevious,
  deleteStage,
  duplicateStage,
  moveGroup,
  newStage,
  nudgeSlots,
  previousKey,
  removeRow,
  renameStage,
  setFloorBottom,
  setHorizon,
  setOrder,
  setRowY,
  slotFor,
  startsOf,
  stepOrder,
  uniqueId,
} from '../src/stage/edit/model';
import { formatAxes, formatStages, prepareSave } from '../src/stage/edit/save';
import { type EditorData, Session } from '../src/stage/edit/session';
import { STAGE_KNOWN } from '../src/stage/known';
import { formatJson } from '../src/tools/jsonfmt';

const file = (): StageFile => JSON.parse(JSON.stringify(loadStages(stagesJson))) as StageFile;
const street = (f = file()): StageConfig => f.street as StageConfig;
const valid = (s: StageConfig): string[] => checkStages({ [s.id]: s }, BG_IDS, STAGE_KNOWN);

describe('the ground handles', () => {
  it('the horizon moves the floor top and, on the street, the skyline; it stops above the back row', () => {
    const s = street();
    expect(setHorizon(s, 92)).toBe(92);
    expect([s.backdrop.horizonY, s.floor.y0, s.backdrop.shiftY]).toEqual([92, 92, 92 - 132]);
    expect(setHorizon(s, 400)).toBe(s.rows[0]?.y);
    expect(valid(s)).toEqual([]);
  });

  it('a replaced back wall (the sewer) has no skyline to slide, so its shift stays', () => {
    const sewer = cloneStage(loadStages(stagesJson).sewer as StageConfig);
    const shift = sewer.backdrop.shiftY;
    setHorizon(sewer, 96);
    expect(sewer.backdrop.shiftY).toBe(shift);
    expect(sewer.floor.y0).toBe(96);
  });

  it('the floor bottom stops under the front row and on the screen', () => {
    const s = street();
    expect(setFloorBottom(s, 100)).toBe(s.rows[4]?.y);
    expect(setFloorBottom(s, 999)).toBe(270);
    expect(valid(s)).toEqual([]);
  });

  it('a row stops one pixel short of its neighbours and inside the floor, and fighters on it follow', () => {
    const s = street();
    expect(setRowY(s, 2, 999)).toBe((s.rows[3]?.y ?? 0) - 1);
    expect(setRowY(s, 2, 0)).toBe((s.rows[1]?.y ?? 0) + 1);
    expect(setRowY(s, 0, 0)).toBe(s.floor.y0);
    expect(setRowY(s, 4, 999)).toBe(s.floor.y1);
    const slot = s.party[2];
    expect(slot && slotPoint(s, slot).y).toBe(s.rows[slot?.row ?? 0]?.y);
    expect(valid(s)).toEqual([]);
  });

  it('adds a row at the front and removes one only when nobody stands on it', () => {
    const s = street();
    expect(addRow(s)).toBeNull();
    expect(s.rows).toHaveLength(6);
    expect(s.depthTint?.amounts).toHaveLength(6);
    expect(valid(s)).toEqual([]);
    expect(addRow(s)).toMatch(/at most 6/);
    expect(removeRow(s, 4)).toMatch(/in use by/);
    expect(removeRow(s, 5)).toBeNull();
    expect(s.rows).toHaveLength(5);
    // A row nobody uses in the middle: the rows behind it keep their slots.
    for (const q of [...s.party, ...Object.values(s.enemySets).flat()]) if (q.row === 2) q.row = 3;
    expect(removeRow(s, 2)).toBeNull();
    expect(valid(s)).toEqual([]);
  });
});

describe('moving fighters', () => {
  const opts = { rows: true, grid: false };

  it('feet dropped on the screen become a row, an x on the fighter’s own half and a nudge', () => {
    const s = street();
    expect(slotFor(s, 'party', 100, 143, opts)).toEqual({ x: 100, row: 0, dy: 0 });
    expect(slotFor(s, 'party', 400, 143, opts).x).toBe(239);
    expect(slotFor(s, 'enemy', 100, 143, opts).x).toBe(240);
    expect(slotFor(s, 'party', 101, 143, { rows: true, grid: true }).x).toBe(104);
    expect(slotFor(s, 'party', 100, 148, { rows: false, grid: false })).toEqual({ x: 100, row: 0, dy: 8 });
    expect(slotFor(s, 'party', 100, 148, { rows: true, grid: false }).dy).toBe(0);
  });

  it('a group moves together and keeps its shape; nobody ends up on the same spot', () => {
    const s = street();
    moveGroup(s, 'party', '3', startsOf(s.party, [0, 1]), 20, -1, 0);
    expect(s.party[0]).toMatchObject({ x: 66, row: 3 });
    expect(s.party[1]).toMatchObject({ x: 108, row: 2 });
    // Dropping one exactly on another’s spot slides it a pixel.
    const a = s.party[0];
    const b = s.party[2];
    if (a && b) {
      a.x = b.x + 5;
      a.row = b.row;
    }
    moveGroup(s, 'party', '3', startsOf(s.party, [0]), -5, 0, 0);
    expect(s.party[0]?.x).not.toBe(s.party[2]?.x);
    expect(valid(s)).toEqual([]);
  });

  it('arrow keys nudge pixels sideways and whole rows up and down, never off the ends', () => {
    const s = street();
    nudgeSlots(s, 'party', '3', [0], 8, 0);
    expect(s.party[0]?.x).toBe(54);
    nudgeSlots(s, 'party', '3', [0], 0, -1);
    expect(s.party[0]?.row).toBe(3);
    nudgeSlots(s, 'party', '3', [3], 0, -9);
    expect(s.party[3]?.row).toBe(0);
    nudgeSlots(s, 'party', '3', [0], -999, 0);
    expect(s.party[0]?.x).toBe(0);
    nudgeSlots(s, 'enemy', '3', [0], -999, 0);
    expect(s.enemySets['3']?.[0]?.x).toBe(240);
    expect(valid(s)).toEqual([]);
  });

  it('draw order: forward and back are stored, automatic is stored as nothing, and it never outweighs a row', () => {
    const s = street();
    expect(stepOrder(s, 'party', '3', 1, 1)).toBe(1);
    expect(stepOrder(s, 'party', '3', 1, 1)).toBe(1);
    expect(s.party[1]?.order).toBe(1);
    expect(stepOrder(s, 'party', '3', 1, -1)).toBe(0);
    expect(s.party[1] && 'order' in s.party[1]).toBe(false);
    setOrder(s, 'party', '3', 1, -1);
    expect(s.party[1]?.order).toBe(-1);
    expect(valid(s)).toEqual([]);
    // Forward beats a same-row neighbour at any x, yet a back-row fighter cannot pass a front-row one.
    expect(depthFor(174, 200, 'party', 1)).toBeGreaterThan(depthFor(174, 240, 'party', 0));
    expect(depthFor(157, 240, 'enemy', 1)).toBeLessThan(depthFor(174, 0, 'party', -1));
    expect(ORDER_STEP).toBeLessThan(14 * 1000);
    const first = s.party[0];
    if (first) (first as { order: number }).order = 2;
    expect(valid(s).join()).toMatch(/order must be/);
  });
});

describe('formations', () => {
  it('Align lays every group out evenly with distinct spots on the right half, boss groups with the boss in the middle', () => {
    const s = street();
    for (const key of Object.keys(s.enemySets)) {
      alignEnemies(s, key);
      const set = s.enemySets[key] ?? [];
      expect(set).toHaveLength(setSize(key));
      expect(new Set(set.map((q) => `${q.row}:${q.x}`)).size).toBe(set.length);
      expect(set.every((q) => q.x >= 240)).toBe(true);
      if (key.startsWith('boss')) expect(set[0]).toMatchObject({ size: 'boss', row: 2 });
    }
    expect(valid(s)).toEqual([]);
    expect(alignedSlots(5, '1')).toEqual([{ x: 356, row: 2 }]);
    expect(alignedSlots(5, '2').map((q) => q.row)).toEqual([0, 4]);
  });

  it('Copy from n−1 starts from the smaller group and adds a slot; the smallest groups refuse', () => {
    const s = street();
    expect(previousKey('4')).toBe('3');
    expect(previousKey('boss+2')).toBe('boss+1');
    expect(previousKey('boss+1')).toBe('boss');
    expect(previousKey('1')).toBeNull();
    const three = cloneStage(s.enemySets['3']);
    expect(copyFromPrevious(s, '4')).toBeNull();
    expect(s.enemySets['4']?.slice(0, 3)).toEqual(three);
    expect(s.enemySets['4']).toHaveLength(4);
    expect(copyFromPrevious(s, '1')).toMatch(/smallest/);
    expect(copyFromPrevious(s, 'boss')).toMatch(/smallest/);
    expect(valid(s)).toEqual([]);
  });
});

describe('the stage list', () => {
  it('New and Duplicate give unique ids, Rename keeps the key and the stage’s own id in step, Delete refuses the last one', () => {
    const f = file();
    expect(uniqueId(f, 'Street')).toBe('street-2');
    expect(uniqueId(f, '  Sink Line Gate!')).toBe('sink-line-gate');
    expect(newStage(f, 'street', 'Rooftop')).toEqual({ ok: true, id: 'rooftop' });
    expect(f.rooftop?.name).toBe('Rooftop');
    expect(Object.keys(f)).toEqual(['street', 'sewer', 'rooftop']);
    expect(duplicateStage(f, 'street')).toEqual({ ok: true, id: 'street-copy' });
    expect(Object.keys(f)).toEqual(['street', 'street-copy', 'sewer', 'rooftop']);
    expect(renameStage(f, 'rooftop', 'Roof', 'roof')).toEqual({ ok: true, id: 'roof' });
    expect(f.roof?.id).toBe('roof');
    expect(renameStage(f, 'roof', 'Roof', 'sewer')).toMatchObject({ ok: false });
    expect(renameStage(f, 'roof', 'Roof', 'Bad Id')).toMatchObject({ ok: false });
    expect(checkStages(f, BG_IDS, STAGE_KNOWN)).toEqual([]);
    expect(deleteStage(f, 'street-copy', ['troop sinkline-rats'])).toMatchObject({ ok: false, reason: expect.stringContaining('used by') });
    expect(deleteStage(f, 'street-copy')).toEqual({ ok: true, id: 'sewer' });
    const one: StageFile = { only: street(file()) };
    expect(deleteStage(one, 'only')).toMatchObject({ ok: false });
  });
});

describe('picking things on the stage', () => {
  it('catches the horizon, the floor bottom and the rows within a few screen pixels, the front row first', () => {
    const s = street();
    expect(hitLine(s, 50, 100.5, 1.5)).toEqual({ kind: 'horizon' });
    expect(hitLine(s, 50, 99.5, 1.5)).toEqual({ kind: 'horizon' });
    expect(hitLine(s, 50, 96, 1.5)).toBeNull();
    expect(hitLine(s, 50, 269.5, 1.5)).toEqual({ kind: 'floor' });
    expect(hitLine(s, 50, 157.5, 1.5)).toEqual({ kind: 'row', index: 1 });
    expect(hitLine(s, 50, 150, 1.5)).toBeNull();
  });

  it('finds the smallest HUD box under a point, and the corner grips', () => {
    const s = street();
    expect(hitHud(s, 130, 10)).toBe('turnOrder');
    expect(hitHud(s, 10, 240)).toBe('partyStatus');
    expect(hitHud(s, 240, 100)).toBeNull();
    s.hud.banner.y = 10; // overlaps the turn order: the smaller banner wins where they overlap
    expect(hitHud(s, 150, 12)).toBe('banner');
    expect(hitGrip(s, 'commands', 184, 228, 3)).toBe('nw');
    expect(hitGrip(s, 'commands', 296, 268, 3)).toBe('se');
    expect(hitGrip(s, 'commands', 240, 248, 3)).toBeNull();
  });

  it('resizing a box moves the dragged corner and keeps the opposite one fixed, never below the smallest size', () => {
    const b = { x: 100, y: 100, w: 60, h: 40 };
    expect(resizeBox(b, 'se', 10, 5)).toEqual({ x: 100, y: 100, w: 70, h: 45 });
    expect(resizeBox(b, 'nw', 10, 5)).toEqual({ x: 110, y: 105, w: 50, h: 35 });
    expect(resizeBox(b, 'nw', 500, 500)).toEqual({ x: 144, y: 132, w: 16, h: 8 });
  });
});

describe('the keyboard table', () => {
  it('has no key the browser owns, no combo twice, and finds the right entry for an event', () => {
    const all = KEYS.flatMap((k) => k.combos);
    expect(all.filter((c) => RESERVED.includes(c))).toEqual([]);
    expect(new Set(all).size).toBe(all.length);
    const ev = (key: string, mods: Partial<Record<'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey', boolean>> = {}) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });
    expect(matchKey(ev('s', { ctrlKey: true }))?.id).toBe('save');
    expect(matchKey(ev('z', { ctrlKey: true }))?.id).toBe('undo');
    expect(matchKey(ev('Z', { ctrlKey: true, shiftKey: true }))?.id).toBe('redo');
    expect(matchKey(ev('y', { ctrlKey: true }))?.id).toBe('redo');
    expect(matchKey(ev('ArrowUp', { shiftKey: true }))?.id).toBe('up8');
    expect(matchKey(ev(']', { ctrlKey: true }))?.id).toBe('forward');
    expect(matchKey(ev('[', { ctrlKey: true }))?.id).toBe('back');
    expect(matchKey(ev('g'))?.id).toBe('grid');
    expect(matchKey(ev('F5'))).toBeNull();
    expect(matchKey(ev('r', { ctrlKey: true }))).toBeNull();
    expect(comboOf(ev('Enter', { ctrlKey: true }))).toBe('Ctrl+Enter');
  });
});

describe('the editing session: gestures, undo and the unsaved state', () => {
  const make = (): Session => new Session({ stages: file(), axes: {} } as EditorData, 'street', formatJson);
  const horizon = (_se: Session, y: number) => (d: EditorData) => {
    setHorizon(d.stages.street as StageConfig, y);
  };

  it('a drag is one undo step however many movements it has, and undo/redo restore the data exactly', () => {
    const se = make();
    const start = JSON.stringify(se.data);
    expect(se.dirty).toBe(false);
    for (const y of [150, 130, 120, 112]) se.live(horizon(se, y));
    expect(se.dirty).toBe(true);
    expect(se.end('Move the horizon')).toBe(true);
    expect(se.stage.backdrop.horizonY).toBe(112);
    expect(se.undoStack.depth).toBe(1);
    expect(se.undo()).toBe(true);
    expect(JSON.stringify(se.data)).toBe(start);
    expect(se.dirty).toBe(false);
    expect(se.redo()).toBe(true);
    expect(se.stage.backdrop.horizonY).toBe(112);
    expect(se.change?.label).toBe('redo');
  });

  it('a gesture that changes nothing makes no undo step and does not mark the data unsaved', () => {
    const se = make();
    expect(se.edit('nothing', () => {})).toBe(false);
    expect(se.canUndo).toBe(false);
    expect(se.dirty).toBe(false);
  });

  it('keeps 100 steps; undoing back to the saved state clears the unsaved mark; saving makes the present the reference', () => {
    const se = make();
    for (let i = 0; i < 105; i++) {
      se.edit(`step ${i}`, (d) => {
        for (const q of (d.stages.street as StageConfig).party) q.dy = i % 2 ? 1 : 2;
      });
    }
    expect(se.undoStack.depth).toBe(100);
    const se2 = make();
    se2.edit('a', horizon(se2, 96));
    se2.edit('b', horizon(se2, 92));
    expect(se2.changeCount).toBe(2);
    se2.undo();
    se2.undo();
    expect(se2.dirty).toBe(false);
    se2.redo();
    se2.markSaved();
    expect(se2.dirty).toBe(false);
    expect(se2.changeCount).toBe(0);
    se2.undo();
    expect(se2.dirty).toBe(true);
    expect(se2.savedStage?.backdrop.horizonY).toBe(96);
  });

  it('Esc during a drag puts everything back; the last change records what a gesture changed in the stage text', () => {
    const se = make();
    se.live(horizon(se, 90));
    se.cancel();
    expect(se.stage.backdrop.horizonY).toBe(100);
    se.edit('Move the horizon', horizon(se, 96));
    expect(se.change?.before).not.toBe(se.change?.after);
    expect(se.change?.label).toBe('Move the horizon');
  });

  it('switching the enemy group drops enemy selections but keeps the party’s', () => {
    const se = make();
    se.select([
      { kind: 'fighter', side: 'party', index: 1 },
      { kind: 'fighter', side: 'enemy', index: 2 },
    ]);
    se.showSet('2');
    expect(se.selection).toEqual([{ kind: 'fighter', side: 'party', index: 1 }]);
  });

  it('Revert/load replaces everything and clears the history', () => {
    const se = make();
    se.edit('a', horizon(se, 96));
    se.load({ stages: file(), axes: {} });
    expect(se.dirty).toBe(false);
    expect(se.canUndo).toBe(false);
    expect(se.stage.backdrop.horizonY).toBe(100);
  });

  it('undoing a New stage while viewing it falls back to a stage that exists', () => {
    const se = make();
    se.edit('new', (d) => {
      newStage(d.stages, 'street', 'Rooftop');
    });
    se.showStage('rooftop');
    se.undo();
    expect(se.stageId).toBe('street');
  });
});

describe('what Save writes', () => {
  it('refuses a bad file with plain-words problems and writes nothing; accepts a good one in the stable format', () => {
    const bad = file();
    (street(bad).rows[1] as { y: number }).y = 400;
    const refused = prepareSave({ stages: bad, axes: {} });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.problems.join('\n')).toMatch(/outside the floor|grow/);
    expect(prepareSave({ stages: file(), axes: { rook: { x: 99, y: 0 } } })).toMatchObject({ ok: false });
    const good = prepareSave({ stages: file(), axes: { rook: { x: 1, y: 0 }, kit: { x: 0, y: 0 } } });
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(JSON.parse(good.axesText)).toEqual({ rook: { x: 1, y: 0 } });
      expect(good.stagesText.endsWith('}\n')).toBe(true);
      expect(JSON.parse(good.stagesText)).toEqual(file());
    }
    expect(prepareSave(null).ok).toBe(false);
    expect(checkAxes({ rook: { x: 1.5, y: 0 } })).toHaveLength(1);
  });

  it('the shipped data files are already in the stable format, so saving without a change changes nothing', async () => {
    const { readFileSync } = await import('node:fs');
    const onDisk = readFileSync(new URL('../src/data/stages.json', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(onDisk).toBe(formatStages(stagesJson));
    const axes = readFileSync(new URL('../src/data/axes.json', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(axes).toBe(formatAxes(JSON.parse(axes)));
  });
});
