import { describe, expect, it } from 'vitest';
import { BG_IDS } from '../src/art/battlebg';
import { checkAxes, checkStages, depthFor, type EntryFile, ORDER_STEP, type StageConfig, type StageEntry, setSize, slotPoint } from '../src/stage/config';
import { hitGrip, hitHud, hitLine, resizeBox } from '../src/stage/edit/hit';
import { comboOf, KEYS, matchKey, RESERVED } from '../src/stage/edit/keys';
import {
  addRow,
  alignAcross,
  alignDepth,
  alignedSlots,
  alignEnemies,
  cloneStage,
  copyFromPrevious,
  deleteStage,
  distributeAcross,
  distributeDepth,
  duplicateStage,
  middleRow,
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
import { formatAxes, formatHud, formatStages, prepareSave } from '../src/stage/edit/save';
import { type EditorData, Session } from '../src/stage/edit/session';
import { applyPreset } from '../src/stage/hudpresets';
import { STAGE_KNOWN } from '../src/stage/known';
import { formatJson } from '../src/tools/jsonfmt';
import { shippedEntries, shippedFacing, shippedHud, shippedStages, stagesJson } from './stagefiles';

const file = (): EntryFile => shippedEntries();
const street = (f = file()): StageEntry => f.street as StageEntry;
/** The street as a battle sees it (the global HUD filled in), for the tests of what the pointer can pick. */
const resolvedStreet = (): StageConfig => {
  const s = shippedStages().street as StageConfig;
  // The design's own HUD layout, so these picking tests do not depend on where Mark has put the boxes in hud.json.
  applyPreset(s.hud, 'timeline-bottom3', true);
  return s;
};
const valid = (s: StageEntry): string[] => checkStages({ [s.id]: s }, BG_IDS, STAGE_KNOWN);

describe('the ground handles', () => {
  it('the horizon moves the floor top and, on the street, the skyline; it stops above the back row', () => {
    const s = street();
    expect(setHorizon(s, 92)).toBe(92);
    expect([s.backdrop.horizonY, s.floor.y0, s.backdrop.shiftY]).toEqual([92, 92, 92 - 132]);
    expect(setHorizon(s, 400)).toBe(s.rows[0]?.y);
    expect(valid(s)).toEqual([]);
  });

  it('a replaced back wall (the sewer) has no skyline to slide, so its shift stays', () => {
    const sewer = cloneStage(file().sewer as StageEntry);
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
    const one: EntryFile = { only: street(file()) };
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
    const s = resolvedStreet();
    expect(hitHud(s, 130, 10)).toBe('turnOrder');
    expect(hitHud(s, 10, 240)).toBe('partyStatus');
    expect(hitHud(s, 240, 100)).toBeNull();
    s.hud.banner.y = 10; // overlaps the turn order: the smaller banner wins where they overlap
    expect(hitHud(s, 150, 12)).toBe('banner');
    expect(hitGrip(s, 'commands', 204, 226, 3)).toBe('nw');
    expect(hitGrip(s, 'commands', 316, 268, 3)).toBe('se');
    expect(hitGrip(s, 'commands', 260, 248, 3)).toBeNull();
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
  const make = (): Session => new Session({ stages: file(), axes: {}, hud: shippedHud(), facing: shippedFacing() }, 'street', formatJson);
  const horizon = (_se: Session, y: number) => (d: EditorData) => {
    setHorizon(d.stages.street as StageEntry, y);
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
    expect(se.change?.label).toBe('Redid Move the horizon');
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
        for (const q of (d.stages.street as StageEntry).party) q.dy = i % 2 ? 1 : 2;
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
    se.load({ stages: file(), axes: {}, hud: shippedHud(), facing: shippedFacing() });
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
    const refused = prepareSave({ stages: bad, axes: {}, hud: shippedHud(), facing: shippedFacing() });
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
    const hudOnDisk = readFileSync(new URL('../src/data/hud.json', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(hudOnDisk).toBe(formatHud(shippedHud()));
    const axes = readFileSync(new URL('../src/data/axes.json', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(axes).toBe(formatAxes(JSON.parse(axes)));
  });
});

describe('the Align bar: fighters line up with their half of the stage, or with each other', () => {
  // How far each fighter's drawn pixels reach either side of its feet (the page measures this from the scene).
  const reach = { 0: { left: 20, right: 20 }, 1: { left: 10, right: 30 }, 2: { left: 15, right: 15 }, 3: { left: 25, right: 25 } };
  const xs = (s: StageEntry): number[] => s.party.map((q) => q.x);

  it('one hero lines up with the left half: his drawn edge touches the edge or the middle line, never crossing it', () => {
    const s = street();
    alignAcross(s, 'party', '3', [1], 'left', reach);
    expect(s.party[1]?.x).toBe(10); // his left edge at the screen's left edge
    alignAcross(s, 'party', '3', [1], 'right', reach);
    expect(s.party[1]?.x).toBe(210); // his right edge at the middle line, 240
    alignAcross(s, 'party', '3', [1], 'centre', reach);
    expect(s.party[1]?.x).toBe(110); // the centre of his drawn body at 120
    expect(valid(s)).toEqual([]);
  });

  it('one enemy lines up with the enemies’ side of the stage, inside the design’s limits (x 260 to 476)', () => {
    const s = street();
    alignAcross(s, 'enemy', '3', [0], 'right', { 0: { left: 30, right: 30 } });
    expect(s.enemySets['3']?.[0]?.x).toBe(446); // its right edge is at 476, the last x rules.ts allows
    alignAcross(s, 'enemy', '3', [0], 'left', { 0: { left: 30, right: 30 } });
    expect(s.enemySets['3']?.[0]?.x).toBe(290); // its left edge is at 260, the nearest an enemy may stand
  });

  it('two or more line up with each other: left edges, right edges or centres', () => {
    // A narrow hero (20 either side of the feet) and a wide one (10 left, 40 right), standing at x 50 and x 100: their drawn pixels span 30 to 140.
    const two = { 0: { left: 20, right: 20 }, 1: { left: 10, right: 40 } };
    const fresh = (): StageEntry => {
      const s = street();
      s.party[0] = { x: 50, row: 4 };
      s.party[1] = { x: 100, row: 3 };
      return s;
    };
    const run = (how: 'left' | 'centre' | 'right'): number[] => {
      const s = fresh();
      alignAcross(s, 'party', '3', [0, 1], how, two);
      expect(valid(s)).toEqual([]);
      return [s.party[0]?.x ?? -1, s.party[1]?.x ?? -1];
    };
    expect(run('left')).toEqual([50, 40]); // both left edges at 30
    expect(run('right')).toEqual([120, 100]); // both right edges at 140
    expect(run('centre')).toEqual([85, 70]); // both centres at 85
  });

  it('depth: one fighter goes to the back, middle or front row; several go to the back-most, front-most or middle of the rows they use', () => {
    const s = street();
    // Middle is the middle row BY COUNT (index floor(rows / 2): row 3 of 5), not the row nearest the middle of the floor band.
    expect(s.rows).toHaveLength(5);
    expect(middleRow(s)).toBe(2);
    alignDepth(s, 'party', '3', [0], 'back');
    expect(s.party[0]?.row).toBe(0);
    alignDepth(s, 'party', '3', [0], 'front');
    expect(s.party[0]?.row).toBe(4);
    alignDepth(s, 'party', '3', [0], 'middle');
    expect(s.party[0]?.row).toBe(2);
    const t = street();
    alignDepth(t, 'party', '3', [0, 1, 3], 'back'); // rows 4, 3, 1
    expect(t.party.map((q) => q.row)).toEqual([1, 1, 2, 1]);
    const u = street();
    alignDepth(u, 'party', '3', [0, 3], 'middle'); // rows 4 and 1: the middle is 2.5, which rounds to 3
    expect([u.party[0]?.row, u.party[3]?.row]).toEqual([3, 3]);
    // Two fighters landing on one row and one x never share a spot: the second is slid over a pixel.
    expect(valid(u)).toEqual([]);
  });

  it('a small up-or-down nudge is cleared when a fighter is aligned to a row', () => {
    const s = street();
    (s.party[0] as { dy?: number }).dy = 4;
    alignDepth(s, 'party', '3', [0], 'back');
    expect('dy' in (s.party[0] ?? {})).toBe(false);
  });

  it('three or more can be spread with equal gaps between their drawn edges, or evenly over their rows', () => {
    const s = street();
    s.party[0] = { x: 30, row: 4 };
    s.party[1] = { x: 70, row: 3 };
    s.party[2] = { x: 200, row: 0 };
    distributeAcross(s, 'party', '3', [0, 1, 2], { 0: { left: 10, right: 10 }, 1: { left: 10, right: 10 }, 2: { left: 10, right: 10 } });
    // the outer two stay; the middle one goes halfway: edges 20..40, 120..140 (gap 80), 190..210
    expect(xs(s).slice(0, 3)).toEqual([30, 115, 200]);
    const t = street();
    t.party[0] = { x: 30, row: 4 };
    t.party[1] = { x: 60, row: 3 };
    t.party[2] = { x: 90, row: 0 };
    distributeDepth(t, 'party', '3', [0, 1, 2]);
    expect([t.party[2]?.row, t.party[1]?.row, t.party[0]?.row]).toEqual([0, 2, 4]);
    // fewer than three change nothing
    const u = street();
    const before = JSON.stringify(u.party);
    distributeAcross(u, 'party', '3', [0, 1], reach);
    distributeDepth(u, 'party', '3', [0, 1]);
    expect(JSON.stringify(u.party)).toBe(before);
  });

  it('one undo step per Align, and the stage still passes the checker', () => {
    const se = new Session({ stages: file(), axes: {}, hud: shippedHud(), facing: shippedFacing() }, 'street', formatJson);
    const start = JSON.stringify(se.data);
    se.edit('Align Rook to the back row', (d) => alignDepth(d.stages.street as StageEntry, 'party', '3', [1], 'back'));
    expect(se.undoStack.depth).toBe(1);
    expect(valid(se.stage)).toEqual([]);
    se.undo();
    expect(JSON.stringify(se.data)).toBe(start);
  });
});

describe('the session knows which of the three files changed', () => {
  const make = (): Session => new Session({ stages: file(), axes: {}, hud: shippedHud(), facing: shippedFacing() }, 'street', formatJson);

  it('a HUD move makes only hud.json unsaved; saving it leaves other changes unsaved; undo and redo cover the HUD too', () => {
    const se = make();
    expect(se.dirtyParts).toEqual([]);
    se.edit('Move the commands', (d) => {
      d.hud.commands.x = 60;
    });
    expect(se.dirtyParts).toEqual(['hud']);
    se.edit('Move the horizon', (d) => {
      setHorizon(d.stages.street as StageEntry, 96);
    });
    expect(se.dirtyParts).toEqual(['stages', 'hud']);
    se.markSaved(['hud']);
    expect(se.dirtyParts).toEqual(['stages']);
    expect(se.savedHud.commands.x).toBe(60);
    expect(se.changeCount).toBe(2); // the horizon is still unsaved, so the count is not reset
    se.undo();
    expect(se.dirtyParts).toEqual([]);
    se.undo();
    expect(se.data.hud.commands.x).toBe(4);
    expect(se.dirtyParts).toEqual(['hud']);
    se.redo();
    expect(se.data.hud.commands.x).toBe(60);
    expect(se.dirtyParts).toEqual([]);
  });

  it('settling drops an empty override without an undo step, and the unsaved mark follows the data', () => {
    const se = make();
    se.edit('Override', (d) => {
      d.stages.street = { ...(d.stages.street as StageEntry), hud: { commands: {} } };
    });
    // An empty “different on this stage” box is not an unsaved change: Save would drop it, so nothing is unsaved.
    expect(se.dirtyParts).toEqual([]);
    const steps = se.undoStack.depth;
    se.settle();
    expect(se.stage.hud).toBeUndefined();
    expect(se.undoStack.depth).toBe(steps);
    expect(se.dirtyParts).toEqual([]);
    // A box that really differs is unsaved.
    se.edit('Move', (d) => {
      d.stages.street = { ...(d.stages.street as StageEntry), hud: { commands: { x: 9 } } };
    });
    expect(se.dirtyParts).toEqual(['stages']);
  });

  it('the resolved stage is the global HUD with this stage’s overrides laid over it', () => {
    const se = make();
    expect(se.resolved.hud.commands.x).toBe(4);
    se.edit('Override', (d) => {
      d.stages.street = { ...(d.stages.street as StageEntry), hud: { commands: { x: 77 } } };
    });
    expect(se.resolved.hud.commands.x).toBe(77);
    se.showStage('sewer');
    expect(se.resolved.hud.commands.x).toBe(4);
  });
});
