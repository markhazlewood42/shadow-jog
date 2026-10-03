/**
 * Battle Stage Editor, bug-fix round 4 (Phaser spike `spike/phaser-stage`): one test group for each correctness bug the
 * round-3 judges found. Each test was written to FAIL on the round-3 code first.
 *
 *  1. Back / Middle / Front: fighters that do not fit the target row stay EXACTLY where they were.
 *  2. The overlap test uses the furthest right edge so far (a wide fighter can overlap one two places later).
 *  3. Align keeps clear of fighters that are NOT selected but already stand on the row.
 *  4. The Align keys work on a keyboard layout that does not type Latin letters (the key's position is used).
 *  5. A save checks the stages against the HUD that will be on disk afterwards.
 *  6. When the roll-back of a failed save fails too, the message names the files whose state is unknown.
 *  7. A hero aligned Right keeps the 55 px gap to the enemies.
 */
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { StageEntry } from '../src/stage/config';
import { alignStatus } from '../src/stage/edit/alignsay';
import { comboOf, matchKey } from '../src/stage/edit/keys';
import { ALIGN_GAP, alignAcross, alignDepth, type Reach, standingRange } from '../src/stage/edit/model';
import { formatHud, prepareSave } from '../src/stage/edit/save';
import { saveFailureMessage, writeTogether } from '../src/stage/edit/writeset';
import { enemyLeftLimit, heroRightLimit, RULE_LIMITS } from '../src/stage/rules';
import { hudJson, shippedEntries, stagesJson } from './stagefiles';

const street = (): StageEntry => shippedEntries().street as StageEntry;
/** The same reach for fighters 0 .. n-1. */
const reach = (n: number, left = 20, right = 20): Record<number, Reach> => Object.fromEntries(Array.from({ length: n }, (_, i) => [i, { left, right }]));
/** True when two fighters of one row come closer than ALIGN_GAP (drawn edges). */
const touching = (xs: number[], left: number, right: number): boolean => {
  const s = [...xs].sort((a, b) => a - b);
  return s.some((x, i) => i > 0 && x - left < (s[i - 1] ?? 0) + right + ALIGN_GAP);
};

describe('1. Back, Middle and Front: what does not fit stays exactly where it was', () => {
  /** Six enemies 70 px wide whose pictures overlap each other, on different rows. Only 3 of them fit on one row (3 x 70 + 2 x 2 = 214 of 216 px). */
  const six = (): StageEntry => {
    const s = street();
    s.enemySets['6'] = [
      { x: 290, row: 0 },
      { x: 310, row: 1 },
      { x: 330, row: 2 },
      { x: 350, row: 3 },
      { x: 370, row: 4, dy: 3 },
      { x: 400, row: 2, dy: -2 },
    ];
    return s;
  };

  it('the three that do not fit keep their old row, x and dy; the three that fit stand side by side on the back row', () => {
    const s = six();
    const before = (s.enemySets['6'] ?? []).map((q) => ({ ...q }));
    const r = alignDepth(s, 'enemy', '6', [0, 1, 2, 3, 4, 5], 'back', reach(6, 35, 35));
    const after = s.enemySets['6'] ?? [];
    expect(r).toMatchObject({ total: 6, short: 3, moved: 3 });
    // The ones that stayed are identical to before, field by field.
    for (const i of [3, 4, 5]) expect(after[i]).toEqual(before[i]);
    // The ones that moved are on the back row, 2 px apart at least, inside the enemies' range.
    const moved = [0, 1, 2].map((i) => after[i] as { x: number; row: number });
    expect(moved.map((q) => q.row)).toEqual([0, 0, 0]);
    expect(touching(moved.map((q) => q.x), 35, 35)).toBe(false);
    for (const q of moved) {
      expect(q.x - 35).toBeGreaterThanOrEqual(260);
      expect(q.x + 35).toBeLessThanOrEqual(476);
    }
  });

  it('nobody that stayed on the target row is landed on: a fighter that did not fit but already stands on the back row is a wall for the others', () => {
    const s = street();
    // The leftmost (by edge) stands on the back row already but is the 4th in the left-to-right order only after sorting, so make the one on the back row the LAST one.
    s.enemySets['6'] = [
      { x: 290, row: 1 },
      { x: 310, row: 2 },
      { x: 330, row: 3 },
      { x: 350, row: 4 },
      { x: 370, row: 4, dy: 1 },
      { x: 400, row: 0 },
    ];
    alignDepth(s, 'enemy', '6', [0, 1, 2, 3, 4, 5], 'back', reach(6, 35, 35));
    const onBack = (s.enemySets['6'] ?? []).filter((q) => q.row === 0).map((q) => q.x);
    expect(touching(onBack, 35, 35)).toBe(false);
  });

  it('the status line is worked out from where everyone ended up', () => {
    const s = six();
    const r = alignDepth(s, 'enemy', '6', [0, 1, 2, 3, 4, 5], 'back', reach(6, 35, 35));
    const say = alignStatus({ how: 'back', who: '6 enemies', side: 'enemy', result: r });
    expect(say.text).toBe('3 of 6 moved to the back row; 3 stayed: not enough room.');
    expect(say.bad).toBe(true);
  });

  it('"No change" when everything already stands there', () => {
    const s = street();
    s.party = [
      { x: 40, row: 0 },
      { x: 120, row: 0 },
      { x: 200, row: 0 },
    ];
    const r = alignDepth(s, 'party', '3', [0, 1, 2], 'back', reach(3, 20, 20));
    expect(r.moved).toBe(0);
    const say = alignStatus({ how: 'back', who: '3 heroes', side: 'party', result: r });
    expect(say.text).toMatch(/^No change\b/);
    expect(say.bad).toBe(false);
  });

  it('a single hero that is already on the front row says "No change"', () => {
    const s = street();
    const r = alignDepth(s, 'party', '3', [0], 'front', reach(4));
    expect(s.party[0]).toMatchObject({ row: 4, x: 46 });
    expect(alignStatus({ how: 'front', who: 'Rook', side: 'party', result: r }).text).toMatch(/^No change\b/);
  });
});

describe('2. the overlap test uses the furthest right edge so far', () => {
  it('a wide fighter that overlaps one two places later is packed, and the first and the last do not touch afterwards', () => {
    const s = street();
    // Sorted by left edge: the wide one (80 .. 240), a narrow one inside it, and a narrow one further right that only the wide one reaches.
    s.party = [
      { x: 160, row: 0 }, // wide: 80 px each side, 80 .. 240
      { x: 100, row: 1 }, // narrow, 90 .. 110, overlaps the wide one
      { x: 200, row: 2 }, // narrow, 190 .. 210, the previous narrow one's right edge (110) is well clear, the wide one's (240) is not
    ];
    const r: Record<number, Reach> = { 0: { left: 80, right: 80 }, 1: { left: 10, right: 10 }, 2: { left: 10, right: 10 } };
    const out = alignDepth(s, 'party', '3', [0, 1, 2], 'front', r);
    // Every pair on the row is now at least ALIGN_GAP apart (drawn edges), not only neighbours in the sorted order.
    const edges = s.party.map((q, i) => ({ l: q.x - (r[i]?.left ?? 0), r: q.x + (r[i]?.right ?? 0) }));
    for (let i = 0; i < edges.length; i++)
      for (let j = i + 1; j < edges.length; j++) {
        const a = edges[i] as { l: number; r: number };
        const b = edges[j] as { l: number; r: number };
        expect(a.r + ALIGN_GAP <= b.l || b.r + ALIGN_GAP <= a.l).toBe(true);
      }
    expect(out.total).toBe(3);
  });
});

describe('3. Align keeps clear of fighters that are not selected', () => {
  const edgesOf = (xs: number[], l: number, r: number): Array<{ l: number; r: number }> => xs.map((x) => ({ l: x - l, r: x + r }));
  const clear = (a: { l: number; r: number }, b: { l: number; r: number }): boolean => a.r + ALIGN_GAP <= b.l || b.r + ALIGN_GAP <= a.l;

  it('Front for one hero does not land on the hero already standing at that spot of the front row', () => {
    const s = street();
    s.party = [
      { x: 100, row: 0 },
      { x: 100, row: 4 }, // not selected, stands exactly where the selected hero would land
    ];
    const r = alignDepth(s, 'party', '3', [0], 'front', reach(2, 20, 20));
    const [a, b] = edgesOf(s.party.map((q) => q.x), 20, 20);
    if (s.party[0]?.row === 4) expect(clear(a as { l: number; r: number }, b as { l: number; r: number })).toBe(true);
    else expect(r.short).toBe(1); // or it stayed where it was, and said so
    expect(r.fit + r.short).toBe(r.total);
  });

  it('Right packs around a fighter that is not selected, on the same row', () => {
    const s = street();
    s.party = [
      { x: 100, row: 4 }, // selected
      { x: 200, row: 4 }, // not selected, drawn 180 .. 220: in the way of x 220 (Right would put the selected one at 200 .. 240)
    ];
    alignAcross(s, 'party', '3', [0], 'right', reach(2, 20, 20));
    const [a, b] = edgesOf(s.party.map((q) => q.x), 20, 20);
    expect(clear(a as { l: number; r: number }, b as { l: number; r: number })).toBe(true);
    expect(s.party[1]?.x).toBe(200); // the one that was not selected never moves
  });

  it('a fighter that cannot fit between the others stays where it was and is counted as short', () => {
    const s = street();
    s.party = [
      { x: 50, row: 4 }, // selected, 200 px wide: nowhere to go on a row where another fighter stands at 120
      { x: 120, row: 4 },
    ];
    const r = alignAcross(s, 'party', '3', [0], 'left', { 0: { left: 100, right: 100 }, 1: { left: 20, right: 20 } });
    expect(s.party[0]?.x).toBe(50);
    expect(r).toMatchObject({ total: 1, short: 1, moved: 0 });
  });

  it('Back for several heroes packs around a hero that is not selected and already stands on the back-most of their rows', () => {
    const s = street();
    s.party = [
      { x: 100, row: 2 },
      { x: 130, row: 3 },
      { x: 120, row: 2 }, // not selected, on the target row (row 2), in the way of both
    ];
    alignDepth(s, 'party', '3', [0, 1], 'back', reach(3, 20, 20));
    expect(s.party.map((q) => q.row)).toEqual([2, 2, 2]);
    expect(touching(s.party.map((q) => q.x), 20, 20)).toBe(false);
    expect(s.party[2]).toEqual({ x: 120, row: 2 }); // the one that was not selected never moves
  });
});

describe('4. the Align keys work on a layout that does not type Latin letters', () => {
  // The letters a Russian (JCUKEN) keyboard types on the keys at the A, C, D, W, M, S, X and Y positions.
  const cyr: Array<[string, string, string]> = [
    ['ф', 'KeyA', 'alignLeft'],
    ['с', 'KeyC', 'alignCentre'],
    ['в', 'KeyD', 'alignRight'],
    ['ц', 'KeyW', 'alignBack'],
    ['ь', 'KeyM', 'alignMiddle'],
    ['ы', 'KeyS', 'alignFront'],
    ['ч', 'KeyX', 'spreadAcross'],
    ['н', 'KeyY', 'spreadDepth'],
  ];
  const ev = (key: string, code: string, extra: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({ key, code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra });

  it.each(cyr)('Cyrillic %s on %s triggers %s', (key, code, id) => {
    expect(matchKey(ev(key, code))?.id).toBe(id);
  });

  it('a Cyrillic capital (Caps Lock on) does the same', () => {
    expect(matchKey(ev('Ф', 'KeyA'))?.id).toBe('alignLeft');
  });

  it('Ctrl+S still saves with a Cyrillic layout, and the shortcut is written the way the table writes it', () => {
    expect(comboOf(ev('ы', 'KeyS', { ctrlKey: true }))).toBe('Ctrl+S');
    expect(matchKey(ev('ы', 'KeyS', { ctrlKey: true }))?.id).toBe('save');
  });

  it('a Latin layout is read by the letter it types, not by its position (AZERTY: the key at KeyQ types a)', () => {
    expect(matchKey(ev('a', 'KeyQ'))?.id).toBe('alignLeft');
    expect(matchKey(ev('q', 'KeyA'))).toBeNull();
  });

  it('a punctuation key is not turned into a letter (AZERTY: the comma key is at KeyM)', () => {
    expect(matchKey(ev(',', 'KeyM'))).toBeNull();
  });
});

describe('5. a save checks the stages against the HUD that will be on disk afterwards', () => {
  const body = (): { stages: Record<string, StageEntry>; axes: Record<string, never>; hud: { commands: { w: number; x: number } } } => ({
    stages: JSON.parse(JSON.stringify(stagesJson)),
    axes: {},
    hud: (JSON.parse(JSON.stringify(hudJson)) as { layout: { commands: { w: number; x: number } } }).layout,
  });
  const diskText = (): string => formatHud((JSON.parse(JSON.stringify(hudJson)) as { layout: unknown }).layout);

  it('the HUD is NOT written: a posted HUD that would break a stage is ignored, and the save is checked against the file on disk', () => {
    const b = body();
    (b.stages.street as StageEntry).hud = { commands: { x: 300 } };
    b.hud.commands.w = 300; // would break the stage's own box at x 300, if it were saved
    const r = prepareSave({ ...b, write: ['stages', 'axes'] }, diskText());
    expect(r.ok).toBe(true);
    expect(r.ok && r.write).toEqual(['stages', 'axes']);
    expect(r.ok && r.hudText).toBeUndefined();
  });

  it('the HUD is NOT written: a stage that fits only the posted HUD is refused, because the file on disk is what the game will load', () => {
    const b = body();
    // Disk HUD: the shipped one. A stage box that is fine for a 300 wide commands box but not for the shipped width does not exist here, so use the reverse:
    // the posted HUD is fine, and the disk HUD (a wide one) breaks the stage's own box at x 300.
    (b.stages.street as StageEntry).hud = { commands: { x: 300 } };
    const wide = JSON.parse(JSON.stringify(hudJson)) as { layout: { commands: { w: number } } };
    wide.layout.commands.w = 300;
    const r = prepareSave({ ...b, write: ['stages'] }, formatHud(wide.layout));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problems.join(' ')).toMatch(/past the right edge/);
  });

  it('the HUD IS written: the stages are checked against the posted HUD, even if the file on disk would have passed', () => {
    const b = body();
    (b.stages.street as StageEntry).hud = { commands: { x: 300 } };
    b.hud.commands.w = 300;
    const r = prepareSave({ ...b, write: ['stages', 'hud'] }, diskText());
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problems.join(' ')).toMatch(/the HUD layout in this save does not fit a stage's own HUD box/);
  });

  it('the HUD IS written, and it is the one that fits: a disk HUD that would break the stage does not matter', () => {
    const b = body();
    (b.stages.street as StageEntry).hud = { commands: { x: 300 } };
    const wide = JSON.parse(JSON.stringify(hudJson)) as { layout: { commands: { w: number } } };
    wide.layout.commands.w = 300;
    const r = prepareSave({ ...b, write: ['stages', 'hud'] }, formatHud(wide.layout));
    expect(r.ok).toBe(true);
    expect(r.ok && r.write).toEqual(['stages', 'hud']);
  });

  it('a body with no "write" writes everything that was posted, checked against the posted HUD', () => {
    const b = body();
    (b.stages.street as StageEntry).hud = { commands: { x: 300 } };
    b.hud.commands.w = 300;
    expect(prepareSave(b, diskText()).ok).toBe(false);
  });
});

describe('6. a failed roll-back does not claim that no file was changed', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'writeset4-'));
    dirs.push(d);
    return d;
  };

  it('the roll-back fails for a.json: the message names a.json and does not say that no file was changed', () => {
    const d = tmp();
    const a = join(d, 'a.json');
    const b = join(d, 'b.json');
    const c = join(d, 'c.json');
    writeFileSync(a, 'old a');
    writeFileSync(c, 'old c');
    // The rename of b.json fails (after a.json was replaced), and then putting the old text back fails for a.json (a locked file, a disk that went away...).
    const failing = {
      rename: (from: string, to: string): void => {
        if (to === b) throw new Error('EPERM: operation not permitted');
        renameSync(from, to);
      },
      writeFile: (path: string, text: string): void => {
        if (path === a && text === 'old a') throw new Error('EBUSY: resource busy or locked');
        writeFileSync(path, text);
      },
    };
    let caught: unknown;
    try {
      writeTogether(
        [
          { path: a, text: 'new a' },
          { path: b, text: 'new b' },
          { path: c, text: 'new c' },
        ],
        failing,
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = saveFailureMessage(caught);
    expect(message).not.toMatch(/none was changed|no file was changed/i);
    expect(message).toContain('a.json');
    expect(message).not.toContain('c.json'); // c.json was never replaced
    expect(message).toMatch(/unknown/i);
    // And the file really is the new text: the roll-back did fail.
    expect(readFileSync(a, 'utf8')).toBe('new a');
    expect(readFileSync(c, 'utf8')).toBe('old c');
  });

  it('when the roll-back works, the message still says that none was changed', () => {
    const d = tmp();
    writeFileSync(join(d, 'a.json'), 'old a');
    mkdirSync(join(d, 'b.json'));
    writeFileSync(join(d, 'b.json', 'keep.txt'), 'x');
    let caught: unknown;
    try {
      writeTogether([
        { path: join(d, 'a.json'), text: 'new a' },
        { path: join(d, 'b.json'), text: 'new b' },
      ]);
    } catch (e) {
      caught = e;
    }
    expect(saveFailureMessage(caught)).toMatch(/none was changed/);
    expect(readFileSync(join(d, 'a.json'), 'utf8')).toBe('old a');
  });
});

describe('7. a hero aligned Right keeps the 55 px gap to the enemies', () => {
  it('the limits come from rules.ts: heroes up to the nearest enemy’s left edge less 55, enemies from the farthest hero’s right edge plus 55', () => {
    expect(heroRightLimit(260)).toBe(260 - RULE_LIMITS.gap);
    expect(enemyLeftLimit(205)).toBe(205 + RULE_LIMITS.gap);
    expect(standingRange('party', 260)).toEqual({ l: 0, r: 205 });
    expect(standingRange('enemy', 205)).toEqual({ l: 260, r: 476 }); // 260 is the larger of the two limits
    expect(standingRange('enemy', 230)).toEqual({ l: 285, r: 476 });
    // A limit that would leave no room at all is ignored (the stage already breaks the rule).
    expect(standingRange('party', 40)).toEqual({ l: 0, r: 240 });
  });

  it('a single hero aligned Right stops at 205 when the nearest enemy is at 260', () => {
    const s = street();
    s.party = [{ x: 100, row: 4 }];
    const r = alignAcross(s, 'party', '3', [0], 'right', reach(1, 20, 20), 260);
    expect(s.party[0]?.x).toBe(185); // drawn right edge 205
    expect((s.party[0]?.x ?? 0) + 20).toBe(205);
    expect(260 - ((s.party[0]?.x ?? 0) + 20)).toBeGreaterThanOrEqual(RULE_LIMITS.gap);
    expect(r.limited).toBe(true);
    const say = alignStatus({ how: 'right', who: 'Rook', side: 'party', result: r, acrossOne: true });
    expect(say.text).toMatch(/55 px/);
    expect(say.text).toMatch(/205/);
  });

  it('without enemies in the way it still lands on 240', () => {
    const s = street();
    s.party = [{ x: 100, row: 4 }];
    const r = alignAcross(s, 'party', '3', [0], 'right', reach(1, 20, 20));
    expect((s.party[0]?.x ?? 0) + 20).toBe(240);
    expect(r.limited).toBe(false);
  });

  it('several heroes lining up Right stay inside the same limit, and Back / Front packing uses it too', () => {
    const s = street();
    s.party = [
      { x: 60, row: 4 },
      { x: 140, row: 2 },
    ];
    alignAcross(s, 'party', '3', [0, 1], 'right', reach(2, 20, 20), 260);
    expect(Math.max(...s.party.map((q) => q.x)) + 20).toBeLessThanOrEqual(205);
    const t = street();
    t.party = [
      { x: 150, row: 0 },
      { x: 160, row: 1 },
      { x: 170, row: 2 },
    ];
    alignDepth(t, 'party', '3', [0, 1, 2], 'front', reach(3, 20, 20), 260);
    expect(Math.max(...t.party.map((q) => q.x)) + 20).toBeLessThanOrEqual(205);
  });

  it('an enemy aligned Left keeps 55 px from the heroes’ right edge', () => {
    const s = street();
    s.enemySets['1'] = [{ x: 400, row: 2 }];
    alignAcross(s, 'enemy', '1', [0], 'left', reach(1, 30, 30), 230);
    expect((s.enemySets['1']?.[0]?.x ?? 0) - 30).toBe(285); // 230 + 55
  });
});
