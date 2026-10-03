/**
 * Battle Stage Editor, polish round 2 (Phaser spike `spike/phaser-stage`): the pure parts of what Mark's judges asked
 * for. Align that packs fighters sharing a row, the middle row by count, shortcuts that avoid the browser's own keys,
 * undo labels, Shift/Ctrl+click on the selection, and the server's check of a stage against the global HUD on disk.
 */
import { describe, expect, it } from 'vitest';
import type { StageEntry } from '../src/stage/config';
import { ALIGN_GAP, alignAcross, alignDepth, middleRow, type Reach } from '../src/stage/edit/model';
import { comboOf, KEYS, matchKey, MOUSE, RESERVED, shown } from '../src/stage/edit/keys';
import { prepareSave } from '../src/stage/edit/save';
import { type Item, Session, toggleInSelection } from '../src/stage/edit/session';
import { formatJson } from '../src/tools/jsonfmt';
import { hudJson, shippedEntries, shippedHud, stagesJson } from './stagefiles';

const street = (): StageEntry => shippedEntries().street as StageEntry;
const reach = (n: number, left = 20, right = 20): Record<number, Reach> => Object.fromEntries(Array.from({ length: n }, (_, i) => [i, { left, right }]));
const overlaps = (xs: number[], left = 20, right = 20): boolean => xs.some((x, i) => i > 0 && x - left < (xs[i - 1] ?? 0) + right + ALIGN_GAP);

describe('Middle means the middle row by count', () => {
  it('row 3 of 5, whatever the rows’ heights', () => {
    const s = street();
    expect(s.rows).toHaveLength(5);
    expect(middleRow(s)).toBe(2);
    // Squash the rows toward the front: the row NEAREST the middle of the floor would change, the middle row by count does not.
    s.rows.forEach((r, i) => {
      r.y = 150 + i * 16;
    });
    expect(middleRow(s)).toBe(2);
    alignDepth(s, 'party', '3', [0], 'middle');
    expect(s.party[0]?.row).toBe(2);
    s.rows.pop();
    expect(middleRow(s)).toBe(2); // row 3 of 4
  });
});

describe('Align left, centre and right pack fighters that share a row', () => {
  const three = (): StageEntry => {
    const s = street();
    // Three enemies on the same row, standing at x 360, 300 and 420 (so the left-to-right order is the 2nd, the 1st, the 3rd).
    s.enemySets['3'] = [
      { x: 360, row: 1 },
      { x: 300, row: 1 },
      { x: 420, row: 1 },
    ];
    return s;
  };
  const xsOf = (s: StageEntry): number[] => (s.enemySets['3'] ?? []).map((q) => q.x);

  it('Left packs them against the left edge of the group, in their old order, with the minimum gap', () => {
    const s = three();
    const r = alignAcross(s, 'enemy', '3', [0, 1, 2], 'left', reach(3));
    // The group's left drawn edge is 280. In order: slot 1 (300), slot 0 (360), slot 2 (420).
    expect(xsOf(s)).toEqual([342, 300, 384]);
    expect(r).toEqual({ packed: 3, packedRows: 1 });
    const left = xsOf(s).sort((a, b) => a - b);
    expect(overlaps(left)).toBe(false);
    expect(left[1] ?? 0).toBe((left[0] ?? 0) + 20 + 20 + ALIGN_GAP);
  });

  it('Right packs them against the right edge, keeping the order', () => {
    const s = three();
    alignAcross(s, 'enemy', '3', [0, 1, 2], 'right', reach(3));
    expect(xsOf(s)).toEqual([378, 336, 420]);
    expect(Math.max(...xsOf(s)) + 20).toBe(440); // the group's right drawn edge stayed where it was
  });

  it('Centre packs them as one block around the middle of the group', () => {
    const s = three();
    alignAcross(s, 'enemy', '3', [0, 1, 2], 'centre', reach(3));
    expect(xsOf(s)).toEqual([360, 318, 402]);
    expect(overlaps(xsOf(s).sort((a, b) => a - b))).toBe(false);
  });

  it('fighters on different rows still share one edge exactly as before; only a shared row is packed', () => {
    const s = three();
    (s.enemySets['3'] ?? [])[2] = { x: 420, row: 3 };
    const r = alignAcross(s, 'enemy', '3', [0, 1, 2], 'left', reach(3));
    const [a, b, c] = xsOf(s);
    expect([b, a]).toEqual([300, 342]); // the two on row 1: packed
    expect(c).toBe(300); // the one alone on row 3: its left edge (280) is the shared edge
    expect(r).toEqual({ packed: 2, packedRows: 1 });
  });

  it('with every fighter alone on a row, nothing is packed and the answer says so', () => {
    const s = street();
    const r = alignAcross(s, 'party', '3', [0, 1], 'left', reach(2));
    expect(r).toEqual({ packed: 0, packedRows: 0 });
  });

  it('a block that would leave its half of the screen moves as one, and keeps its gaps', () => {
    const s = street();
    s.enemySets['2'] = [
      { x: 250, row: 2 },
      { x: 260, row: 2 },
    ];
    // Two wide enemies (30 either side of the feet) near the middle line: packing against the right edge (290) would put the first
    // one on the left half. The pair slides right together until the first stands at the middle line, 240.
    alignAcross(s, 'enemy', '2', [0, 1], 'right', reach(2, 30, 30));
    const [a, b] = (s.enemySets['2'] ?? []).map((q) => q.x);
    expect(a).toBe(240);
    expect(b).toBe(240 + 30 + 30 + ALIGN_GAP);
  });
});

describe('the shortcuts avoid the browser’s own keys', () => {
  it('no shortcut takes a key from the reserved list (Alt+D, Alt+F, Alt+E, Ctrl+L, Ctrl+T, Ctrl+N, Ctrl+W, F5, Ctrl+R, F12...)', () => {
    for (const k of KEYS) for (const c of k.combos) expect({ id: k.id, combo: c, reserved: RESERVED.includes(c) }).toEqual({ id: k.id, combo: c, reserved: false });
    for (const must of ['Alt+D', 'Alt+F', 'Alt+E', 'Ctrl+L', 'Ctrl+T', 'Ctrl+N', 'Ctrl+W', 'F5', 'Ctrl+R', 'F12']) expect(RESERVED).toContain(must);
  });

  it('no combo is used twice', () => {
    const all = KEYS.flatMap((k) => k.combos);
    expect(new Set(all).size).toBe(all.length);
  });

  it('the Align keys are Ctrl+Alt+letter and a plain Alt+letter does nothing', () => {
    const press = (key: string, o: { alt?: boolean; ctrl?: boolean; shift?: boolean } = {}) => matchKey({ key, code: `Key${key.toUpperCase()}`, altKey: !!o.alt, ctrlKey: !!o.ctrl, metaKey: false, shiftKey: !!o.shift });
    expect(press('d', { alt: true, ctrl: true })?.id).toBe('alignRight');
    expect(press('a', { alt: true, ctrl: true })?.id).toBe('alignLeft');
    expect(press('h', { alt: true, ctrl: true, shift: true })?.id).toBe('spreadAcross');
    expect(press('v', { alt: true, ctrl: true, shift: true })?.id).toBe('spreadDepth');
    expect(press('d', { alt: true })).toBeNull(); // the address bar belongs to the browser
    expect(press('l', {})?.id).toBe('lock');
    expect(press('l', { ctrl: true })).toBeNull();
    expect(comboOf({ key: 'd', code: 'KeyD', altKey: true, ctrlKey: true, metaKey: false, shiftKey: false })).toBe('Ctrl+Alt+D');
  });

  it('the Keys list shows the table’s own key, and has a Mouse group with the three tricks', () => {
    expect(shown(KEYS.find((k) => k.id === 'alignRight')?.combos[0] ?? '')).toBe('Ctrl+Alt+D');
    const text = MOUSE.map((m) => `${m.gesture} ${m.label}`).join('\n');
    expect(text).toMatch(/Shift\+click[^\n]*selection/);
    expect(text).toMatch(/Shift\+drag[^\n]*sideways or up and down/);
    expect(text).toMatch(/Ctrl\+drag[^\n]*snap/);
  });
});

describe('undo and redo say what they did', () => {
  const make = (): Session => new Session({ stages: shippedEntries(), axes: {}, hud: shippedHud() }, 'street', formatJson);

  it('the next undo and redo names are the gestures’ names, in order', () => {
    const se = make();
    expect(se.nextUndoLabel).toBe('');
    se.edit('Move Rook', (d) => {
      (d.stages.street as StageEntry).party[1] = { x: 77, row: 2 };
    });
    se.edit('Move the horizon', (d) => {
      (d.stages.street as StageEntry).backdrop.horizonY = 98;
    });
    expect(se.nextUndoLabel).toBe('Move the horizon');
    expect(se.undo()).toBe(true);
    expect(se.nextRedoLabel).toBe('Move the horizon');
    expect(se.nextUndoLabel).toBe('Move Rook');
    se.undo();
    expect(se.nextUndoLabel).toBe('');
    expect(se.redo()).toBe(true);
    expect(se.nextUndoLabel).toBe('Move Rook');
    // A new change ends the redo history.
    se.edit('Move Kit', (d) => {
      (d.stages.street as StageEntry).party[0] = { x: 21, row: 2 };
    });
    expect(se.nextRedoLabel).toBe('');
    se.load({ stages: shippedEntries(), axes: {}, hud: shippedHud() });
    expect(se.nextUndoLabel).toBe('');
  });
});

describe('Shift+click and Ctrl+click add to and remove from the selection', () => {
  const hero = (index: number): Item => ({ kind: 'fighter', side: 'party', index });
  const foe = (index: number): Item => ({ kind: 'fighter', side: 'enemy', index });

  it('adds, removes, and starts over when the kind or side does not fit', () => {
    let sel: Item[] = [hero(0)];
    sel = toggleInSelection(sel, hero(2));
    expect(sel).toEqual([hero(0), hero(2)]);
    sel = toggleInSelection(sel, hero(0));
    expect(sel).toEqual([hero(2)]);
    sel = toggleInSelection(sel, foe(1)); // heroes and enemies are not selected together
    expect(sel).toEqual([foe(1)]);
    sel = toggleInSelection(sel, { kind: 'hud', region: 'commands' });
    expect(sel).toEqual([{ kind: 'hud', region: 'commands' }]);
    sel = toggleInSelection(sel, { kind: 'hud', region: 'turnOrder' });
    expect(sel).toHaveLength(2);
    // A line handle is never added to: it is selected alone.
    expect(toggleInSelection([hero(0)], { kind: 'horizon' })).toEqual([{ kind: 'horizon' }]);
  });
});

describe('the server checks a stage against the global HUD that is on disk', () => {
  const body = (): { stages: unknown; axes: unknown } => ({ stages: JSON.parse(JSON.stringify(stagesJson)), axes: {} });
  const hudText = (): string => JSON.stringify(hudJson);

  it('a stage without overrides is fine, with or without the HUD text', () => {
    expect(prepareSave(body()).ok).toBe(true);
    expect(prepareSave(body(), hudText()).ok).toBe(true);
  });

  it('an override that was fine against the old HUD but does not fit the one on disk is refused', () => {
    const b = body() as { stages: Record<string, StageEntry> };
    // The override moves the commands box to x 300 and leaves its width to the global HUD...
    (b.stages.street as StageEntry).hud = { commands: { x: 300 } };
    const wide = JSON.parse(hudText()) as { layout: { commands: { w: number } } };
    // ...which fits while the global box is narrow,
    wide.layout.commands.w = 100;
    expect(prepareSave(b, JSON.stringify(wide)).ok).toBe(true);
    // and runs off the screen once the global box has been widened (the global HUD was saved first, so the disk copy is the new one).
    wide.layout.commands.w = 300;
    const refused = prepareSave(b, JSON.stringify(wide));
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.problems.join(' ')).toMatch(/street/);
  });

  it('the HUD on disk is what counts, even when the page posts another one', () => {
    const b = { ...(body() as { stages: Record<string, StageEntry>; axes: unknown }), hud: JSON.parse(hudText()).layout as unknown };
    (b.stages.street as StageEntry).hud = { commands: { x: 300 } };
    const wide = JSON.parse(hudText()) as { layout: { commands: { w: number } } };
    wide.layout.commands.w = 300;
    expect(prepareSave(b).ok).toBe(true); // checked against the posted HUD only
    expect(prepareSave(b, JSON.stringify(wide)).ok).toBe(false); // the server passes the file on disk
  });

  it('an unreadable HUD file is one clear problem, not a crash', () => {
    const r = prepareSave(body(), '{ not json');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problems[0]).toMatch(/hud\.json on disk is not valid JSON/);
    const bad = prepareSave(body(), JSON.stringify({ version: 1, layout: {} }));
    expect(bad.ok).toBe(false);
  });
});
