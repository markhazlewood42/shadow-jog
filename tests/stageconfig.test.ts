import { describe, expect, it } from 'vitest';
import { BG_IDS } from '../src/art/battlebg';
import { ENEMIES } from '../src/data/enemies';
import stagesJson from '../src/data/stages.json';
import { shippedHud, shippedStages } from './stagefiles';
import {
  checkFigures,
  checkLayout,
  checkStages,
  checkStagesWith,
  depthFor,
  enemySlots,
  type FigureBox,
  loadStages,
  type EntryFile,
  type StageEntry,
  MAX_ENEMIES,
  PART,
  partDepth,
  SET_KEYS,
  setKeyFor,
  setSize,
  shadowHeight,
  shadowWidth,
  slotPoint,
  snapSlot,
  sortRow,
  type StageConfig,
  stageOf,
} from '../src/stage/config';
import { CREW_IDS } from '../src/stage/crew';

const known = { enemies: Object.keys(ENEMIES), bosses: Object.keys(ENEMIES).filter((k) => ENEMIES[k]?.boss), crew: CREW_IDS };
/** A fresh copy of the shipped file to break one thing at a time. */
const copy = (): EntryFile => JSON.parse(JSON.stringify(stagesJson)) as EntryFile;
const street = (f: EntryFile): StageEntry => f.street as StageEntry;
const problems = (mutate: (s: StageEntry) => void): string[] => {
  const f = copy();
  mutate(street(f));
  return checkStages(f, BG_IDS, known);
};
const withHud = (hud: NonNullable<StageEntry['hud']>): EntryFile => {
  const f = copy();
  street(f).hud = hud;
  return f;
};
const has = (list: string[], text: string) => expect(list).toEqual(expect.arrayContaining([expect.stringContaining(text)]));

describe('the shipped stage file (the final design: street and sewer)', () => {
  it('is valid, with real backdrops, enemy keys and crew ids', () => {
    expect(checkStages(stagesJson, BG_IDS, known)).toEqual([]);
    expect(Object.keys(loadStages(stagesJson, BG_IDS, known, shippedHud()))).toEqual(['street', 'sewer']);
  });

  it('follows the design’s layout rules: horizon 92 to 112, rows 14 to 24 apart, a light always-on HUD, room above the bottom band', () => {
    for (const [id, s] of Object.entries(shippedStages())) expect({ id, problems: checkLayout(s) }).toEqual({ id, problems: [] });
  });

  it('has an enemy slot set for every group size and a roster that fills each', () => {
    for (const s of Object.values(shippedStages())) {
      for (const key of SET_KEYS) {
        expect(enemySlots(s, key)).toHaveLength(setSize(key));
        expect(s.demo.rosters[key]).toHaveLength(setSize(key));
      }
      // Boss sets put the boss in the first slot, marked as a boss.
      for (const key of ['boss', 'boss+1', 'boss+2']) expect(enemySlots(s, key)[0]?.size).toBe('boss');
    }
  });

  it('puts the party in ref 1’s column: the lead lowest and furthest left, each next one higher and nearer the middle', () => {
    for (const s of Object.values(shippedStages())) {
      const pts = s.party.map((p) => slotPoint(s, p));
      for (let i = 1; i < pts.length; i++) {
        expect(pts[i]?.y).toBeLessThan(pts[i - 1]?.y ?? 0);
        expect(pts[i]?.x).toBeGreaterThan(pts[i - 1]?.x ?? 0);
      }
    }
  });

  it('the street keeps its skyline (reprojected) and the sewer gets its own wall (replaced)', () => {
    const f = shippedStages();
    expect(stageOf(f, 'street').backdrop.mode).toBe('reproject');
    expect(stageOf(f, 'sewer').backdrop.mode).toBe('replace');
    expect(stageOf(f, 'sewer').backdrop.wallId).toBe('sewer-sidewall');
  });
});

describe('group sizes', () => {
  it('maps counts and boss fights to set keys and back', () => {
    expect(SET_KEYS).toHaveLength(MAX_ENEMIES + 3);
    expect([1, 6].map((n) => setKeyFor(n, false))).toEqual(['1', '6']);
    expect([1, 2, 3].map((n) => setKeyFor(n, true))).toEqual(['boss', 'boss+1', 'boss+2']);
    expect(SET_KEYS.map(setSize)).toEqual([1, 2, 3, 4, 5, 6, 1, 2, 3]);
  });

  it('names the sets there are when one is missing', () => {
    expect(() => enemySlots(street(copy()), '7')).toThrow(/no enemy slots for "7"/);
  });
});

describe('slots and the drag snap', () => {
  it('a slot is its row’s y plus its nudge, and the feet stay inside the floor and the screen', () => {
    const s = street(copy());
    expect(slotPoint(s, { row: 2, x: 100 })).toEqual({ x: 100, y: s.rows[2]?.y });
    expect(slotPoint(s, { row: 2, x: 100, dy: 3 }).y).toBe((s.rows[2]?.y ?? 0) + 3);
    s.floor.y0 = 150;
    expect(slotPoint(s, { row: 0, x: 58 }).y).toBe(150);
    s.floor.y1 = 200;
    expect(slotPoint(s, { row: 4, x: 178 }).y).toBe(200);
    expect(slotPoint(s, { row: 1, x: -30 }).x).toBe(0);
    expect(slotPoint(s, { row: 1, x: 900 }).x).toBe(480);
    expect(() => slotPoint(s, { row: 9, x: 5 })).toThrow(/row 9/);
  });

  it('snapSlot picks the nearest row and keeps each side on its own half of the screen', () => {
    const s = street(copy());
    expect(snapSlot(s, 'party', 100, 143)).toEqual({ row: 0, x: 100 });
    expect(snapSlot(s, 'party', 100, 175)).toEqual({ row: 2, x: 100 });
    expect(snapSlot(s, 'party', 100, 400).row).toBe(4);
    expect(snapSlot(s, 'party', 100, 0).row).toBe(0);
    expect(snapSlot(s, 'party', 400, 200).x).toBe(239);
    expect(snapSlot(s, 'enemy', 20, 200).x).toBe(240);
    expect(snapSlot(s, 'enemy', 500, 200).x).toBe(480);
    expect(snapSlot(s, 'enemy', 333.6, 200).x).toBe(334);
  });

  it('snapSlot measures to a row as it is clamped to the floor', () => {
    const s = street(copy());
    s.floor.y0 = 150; // rows 0 and 1 (140, 157) now stand at 150 and 157
    expect(snapSlot(s, 'party', 100, 152).row).toBe(0);
    expect(snapSlot(s, 'party', 100, 156).row).toBe(1);
  });
});

describe('depth sorting: a figure is one unit', () => {
  it('nearer draws on top; on one row the one further from the middle draws first; a hero before an enemy at the same spot', () => {
    expect(depthFor(200, 10)).toBeGreaterThan(depthFor(199, 479));
    expect(depthFor(200, 240)).toBeGreaterThan(depthFor(200, 120));
    expect(depthFor(200, 330)).toBeGreaterThan(depthFor(200, 460));
    expect(depthFor(200, 300, 'enemy')).toBeGreaterThan(depthFor(200, 300, 'party'));
  });

  it('every part of a farther figure stays under every part of a nearer one, whatever their x', () => {
    const order = ['shadow', 'ring', 'body', 'smear', 'bar'] as const;
    for (let i = 1; i < order.length; i++) expect(PART[order[i] as keyof typeof PART]).toBeGreaterThan(PART[order[i - 1] as keyof typeof PART]);
    for (const [xa, xb] of [[0, 480], [240, 240], [480, 0], [30, 330]] as const)
      for (const sa of ['party', 'enemy'] as const)
        for (const sb of ['party', 'enemy'] as const) {
          const far = depthFor(190, xa, sa);
          const near = depthFor(191, xb, sb);
          expect(partDepth(far, 'bar')).toBeLessThan(partDepth(near, 'shadow'));
        }
  });

  it('a lunging attacker borrows its target’s row plus the stage’s margin, only while it lunges', () => {
    const s = street(copy());
    expect(sortRow(s, 208)).toBe(208);
    expect(sortRow(s, 208, 174)).toBe(174 + s.sort.lungeOverTarget);
    expect(depthFor(sortRow(s, 208, 174), 200)).toBeGreaterThan(depthFor(174, 330, 'enemy'));
  });
});

describe('shadows', () => {
  it('width follows the sprite’s width within the stage’s limits, a boss has its own, and none means none', () => {
    const s = street(copy());
    expect(shadowWidth(s, 36, false)).toBe(22); // 36 * 0.6
    expect(shadowWidth(s, 10, false)).toBe(s.shadow.minW);
    expect(shadowWidth(s, 120, false)).toBe(s.shadow.maxW);
    expect(shadowWidth(s, 150, true)).toBe(75); // 150 * 0.5
    expect(shadowWidth(s, 400, true)).toBe(s.shadow.bossMaxW);
    expect(shadowHeight(s, 40)).toBe(10);
    expect(shadowHeight(s, 8)).toBe(4);
    s.shadow.kind = 'none';
    expect(shadowWidth(s, 36, false)).toBe(0);
  });
});

describe('the design’s figure checks (they need the sprites’ sizes, which the browser reports)', () => {
  const heroes: FigureBox[] = [{ x: 172, y: 191, left: 150, right: 200, top: 130, boss: false, side: 'party' }];
  const foe = (left: number, right: number, top: number): FigureBox => ({ x: 356, y: 174, left, right, top, boss: false, side: 'enemy' });

  it('passes a roomy layout', () => {
    expect(checkFigures(shippedStages().street as StageConfig, [...heroes, foe(320, 400, 100)])).toEqual([]);
  });

  it('flags a narrow lane, an enemy too far left, one off the right edge and a sprite in the top band', () => {
    const s = shippedStages().street as StageConfig;
    has(checkFigures(s, [...heroes, foe(240, 300, 100)]), 'lane');
    has(checkFigures(s, [...heroes, foe(250, 300, 100)]), 'left edge');
    has(checkFigures(s, [...heroes, foe(300, 480, 100)]), 'reaches x 480');
    has(checkFigures(s, [...heroes, foe(300, 400, 20)]), 'top HUD band');
  });
});

describe('rejects a bad file, in plain words', () => {
  it('an unknown backdrop, only when the list of known ones is given', () => {
    has(problems((s) => { s.backdrop.id = 'moonbase'; }), 'moonbase');
    const f = copy();
    street(f).backdrop.id = 'moonbase';
    expect(checkStages(f)).toEqual([]);
  });

  it('a stage whose id is not its key, or a version that is not 1', () => {
    has(problems((s) => { s.id = 'avenue'; }), 'must match its key');
    has(problems((s) => { (s as { version: number }).version = 2; }), 'version must be 1');
  });

  it('fractional pixels, a floor that does not start on the horizon, rows outside the floor or out of order', () => {
    has(problems((s) => { s.backdrop.horizonY = 100.5; }), 'horizonY');
    has(problems((s) => { s.floor.y0 = 104; }), 'must equal the backdrop');
    has(problems((s) => { s.rows[3] = { y: 300 }; }), 'outside the floor');
    has(problems((s) => { s.rows[1] = { y: 130 }; }), 'back to front');
    has(problems((s) => { s.rows = s.rows.slice(0, 1); }), '2 to 6 depth rows');
  });

  it('a party that is not four, a slot on a row that does not exist, a hero on the enemy side, two on one spot', () => {
    has(problems((s) => { s.party.pop(); }), 'exactly 4');
    has(problems((s) => { s.party[0] = { row: 9, x: 50 }; }), 'row 9');
    has(problems((s) => { s.party[0] = { row: 0, x: 300 }; }), 'wrong side');
    has(problems((s) => { s.party[1] = { ...(s.party[0] as { row: number; x: number }) }; }), 'same spot');
  });

  it('a missing enemy set, a set of the wrong size, a bad colour, a joint grid that leans too far, a haze that misses a row', () => {
    has(problems((s) => { delete s.enemySets['6']; }), 'enemySets["6"]');
    has(problems((s) => { s.enemySets.boss = []; }), 'enemySets["boss"]');
    has(problems((s) => { s.floor.colors[0] = 'blue'; }), '#rrggbb');
    has(problems((s) => { if (s.floor.grid) s.floor.grid.vanishY = -100; }), 'nearly upright');
    has(problems((s) => { if (s.depthTint) s.depthTint.amounts.pop(); }), 'depthTint.amounts');
    has(problems((s) => { s.shadow.alpha = 3; }), 'shadow.alpha');
  });

  it('a stage’s HUD override that is off the screen, or with a show rule that does not exist (the global HUD file has its own checks in stagehud.test.ts)', () => {
    has(checkStagesWith(withHud({ partyStatus: { x: 400 } }), shippedHud(), BG_IDS, known), 'past the right edge');
    has(problems((s) => { s.hud = { banner: { show: 'sometimes' as never } }; }), 'hud.banner.show');
  });

  it('a lab roster that names a stranger, a lineup that repeats someone or does not match the loadouts, a boss set without the boss first', () => {
    has(problems((s) => { s.demo.rosters['3'] = ['rustfang_punk', 'dragon', 'rustfang_punk']; }), '"dragon" is not one that exists');
    has(problems((s) => { s.demo.lineup[1] = 'kit'; }), 'appears twice');
    has(problems((s) => { s.demo.lineup = ['kit', 'hex', 'rook', 'sable']; }), 'same crew member');
    has(problems((s) => { s.demo.rosters.boss = ['rustfang_punk']; }), 'boss first');
    has(problems((s) => { s.demo.rosters['2'] = ['rustfang_punk']; }), 'exactly 2');
  });

  it('the layout rules catch what the file format allows: a horizon too high, rows too close, a HUD too big', () => {
    const bad = (mutate: (s: StageConfig) => void): string[] => {
      const s = shippedStages().street as StageConfig;
      mutate(s);
      return checkLayout(s);
    };
    has(bad((s) => { s.backdrop.horizonY = 60; s.floor.y0 = 60; }), 'horizon 60');
    has(bad((s) => { s.rows[2] = { y: 150 }; }), 'row gaps');
    has(bad((s) => { s.hud.turnOrder.w = 480; s.hud.turnOrder.h = 60; }), 'always-on HUD');
    has(bad((s) => { s.backdrop.shiftY = -10; }), 'shiftY');
  });

  it('loadStages throws one error listing everything wrong; not an object at all', () => {
    const f = copy();
    street(f).backdrop.horizonY = -5;
    street(f).party.pop();
    expect(() => loadStages(f, undefined, {}, shippedHud())).toThrow(/horizonY[\s\S]*exactly 4/);
    expect(checkStages(null)).toHaveLength(1);
    expect(checkStages({})).toHaveLength(1);
    expect(checkStages({ street: 5 })).toEqual(['stage "street": not an object']);
    expect(() => stageOf(shippedStages(), 'moon')).toThrow(/No stage "moon"/);
  });
});
