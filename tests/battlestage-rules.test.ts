import { describe, expect, it } from 'vitest';
import * as config from '../src/battlestage/config';
import type { FigureBox, StageConfig } from '../src/battlestage/config';
import { checkFigures, checkLayout, figureBreaks, layoutBreaks, RULE_LIMITS, RULE_WHY, stageWarnings } from '../src/battlestage/rules';
import { fixtureStages, shippedStages } from './stagefiles';

const street = (): StageConfig => fixtureStages().street as StageConfig;
const hero = (left: number, right: number, top = 130): FigureBox => ({ x: (left + right) / 2, y: 191, left, right, top, boss: false, side: 'party' });
const foe = (left: number, right: number, top = 100): FigureBox => ({ x: (left + right) / 2, y: 174, left, right, top, boss: false, side: 'enemy' });

describe('the design rules live in one module that the stage lab test and the editor both read', () => {
  it('config.ts no longer holds a second copy of the checks', () => {
    // If a copy came back, the spec and the editor could drift apart.
    expect('checkLayout' in config).toBe(false);
    expect('checkFigures' in config).toBe(false);
  });

  it('every rule has a plain-words reason for the chip’s tooltip', () => {
    for (const rule of ['horizon', 'kerb', 'rowGaps', 'hudShare', 'bottomBand', 'frontShadow', 'floorShare', 'gap', 'nearest', 'edge', 'topBand'] as const) expect(RULE_WHY[rule].length).toBeGreaterThan(20);
  });

  it('the sentence lists are the structured breaks, text for text', () => {
    const s = street();
    s.backdrop.horizonY = 60;
    expect(checkLayout(s)).toEqual(layoutBreaks(s).map((b) => b.text));
    expect(layoutBreaks(s).map((b) => b.rule)).toContain('horizon');
    const boxes = [hero(150, 200), foe(240, 300, 20)];
    expect(checkFigures(street(), boxes)).toEqual(figureBreaks(street(), boxes).map((b) => b.text));
  });
});

describe('figure rules name who breaks them', () => {
  const s = street();

  it('a roomy layout breaks nothing', () => {
    expect(figureBreaks(s, [hero(150, 200), foe(320, 400)])).toEqual([]);
  });

  it('the gap between the sides: the enemies that are too close, and the heroes that close in on them', () => {
    // Heroes' right-most edge 200, nearest enemy at 240: a gap of 40, under the 55 needed.
    const list = [hero(100, 150), hero(150, 200), foe(240, 300), foe(330, 380)];
    const b = figureBreaks(s, list).find((x) => x.rule === 'gap');
    expect(b?.text).toContain('40 px');
    expect(b?.text).toContain(`need ${RULE_LIMITS.gap}`);
    // Enemy 1 (E1) is within 55 of the heroes, E2 (330) is not. Hero 2 (P2, right edge 200) is within 55 of the nearest enemy, P1 (150) is not.
    expect(b?.culprits).toEqual([
      { side: 'party', index: 1 },
      { side: 'enemy', index: 0 },
    ]);
  });

  it('the nearest enemy must stand at x 260 or further right', () => {
    const b = figureBreaks(s, [hero(100, 150), foe(250, 300), foe(330, 380)]).find((x) => x.rule === 'nearest');
    expect(b?.culprits).toEqual([{ side: 'enemy', index: 0 }]);
  });

  it('no enemy may reach past 4 px from the right edge', () => {
    const b = figureBreaks(s, [hero(100, 150), foe(300, 360), foe(400, 480)]).find((x) => x.rule === 'edge');
    expect(b?.text).toContain('480');
    expect(b?.culprits).toEqual([{ side: 'enemy', index: 1 }]);
  });

  it('nothing may reach into the top HUD band, heroes included, and the count is in the sentence', () => {
    const band = s.hud.turnOrder.y + s.hud.turnOrder.h;
    const list = [hero(100, 150, band - 5), hero(160, 210), foe(300, 360, band - 1), foe(380, 420, band)];
    const b = figureBreaks(s, list).find((x) => x.rule === 'topBand');
    expect(b?.text).toBe(`2 fighters reach into the top HUD band (above y ${band})`);
    expect(b?.culprits).toEqual([
      { side: 'party', index: 0 },
      { side: 'enemy', index: 0 },
    ]);
    expect(figureBreaks(s, [hero(100, 150), foe(300, 360, band - 1)]).find((x) => x.rule === 'topBand')?.text).toBe(`1 fighter reaches into the top HUD band (above y ${band})`);
  });

  it('the stage’s warnings say which enemy count each applies to, and the stage-wide ones none', () => {
    const wide = street();
    wide.backdrop.horizonY = 60;
    const w = stageWarnings(wide, { '2': [hero(150, 200), foe(240, 300)], '3': [hero(100, 150), foe(320, 400)] });
    expect(w.filter((x) => x.setKey === null).map((x) => x.rule)).toContain('horizon');
    expect(w.filter((x) => x.setKey === '2').map((x) => x.rule)).toEqual(expect.arrayContaining(['gap', 'nearest']));
    expect(w.filter((x) => x.setKey === '3')).toEqual([]);
    expect(w.every((x) => x.stageId === 'street')).toBe(true);
  });
});

// Rule 3 of "Tests vs design data" (docs/DEVELOPING.md): the rules are tested on stages and figures built to break each one,
// never on whatever Mark's stage happens to break today. His own data only has to agree with the computation (see the
// editor's end-to-end spec), because a warning is advice and never fails a run.
describe('every rule is covered by a fixture that deliberately breaks it', () => {
  const rulesOf = (s: StageConfig): string[] => layoutBreaks(s).map((b) => b.rule);

  it('the fixture street breaks no layout rule, so each case below is the only change that did it', () => {
    expect(rulesOf(street())).toEqual([]);
  });

  const layoutCases: Array<[string, (s: StageConfig) => void]> = [
    ['horizon', (s) => { s.backdrop.horizonY = 60; }],
    ['kerb', (s) => { s.backdrop.mode = 'reproject'; s.backdrop.shiftY = 1; }],
    ['rowGaps', (s) => { s.rows = s.rows.map((r, i) => ({ ...r, y: r.y + i * 20 })); }],
    ['hudShare', (s) => { s.hud.turnOrder.h = 200; }],
    ['bottomBand', (s) => { s.hud.partyStatus.y = 150; }],
    ['frontShadow', (s) => { s.hud.partyStatus.y = Math.max(...s.rows.map((r) => r.y)) + 3; }],
    ['floorShare', (s) => { s.floor.y0 = s.hud.partyStatus.y - 10; }],
  ];
  for (const [rule, mutate] of layoutCases) {
    it(`${rule}: a stage built to break it is reported, with its sentence`, () => {
      const s = street();
      mutate(s);
      expect(rulesOf(s)).toContain(rule);
      const b = layoutBreaks(s).find((x) => x.rule === rule);
      expect(b?.text.length).toBeGreaterThan(10);
      expect(b?.culprits).toEqual([]);
    });
  }

  const figureCases: Array<[string, FigureBox[]]> = [
    ['gap', [hero(100, 200), foe(240, 320)]],
    ['nearest', [hero(50, 100), foe(250, 300)]],
    ['edge', [hero(50, 100), foe(300, 480)]],
    ['topBand', [hero(50, 100, 0), foe(300, 350)]],
  ];
  for (const [rule, boxes] of figureCases) {
    it(`${rule}: figures built to break it are reported, and who breaks it`, () => {
      const b = figureBreaks(street(), boxes).find((x) => x.rule === rule);
      expect(b, rule).toBeDefined();
      expect(b?.culprits.length).toBeGreaterThan(0);
    });
  }

  it('together the cases cover every rule the module has', () => {
    const covered = [...layoutCases.map(([r]) => r), ...figureCases.map(([r]) => r)].sort();
    expect(covered).toEqual(Object.keys(RULE_WHY).sort());
  });
});

describe('the stage-wide warnings of Mark’s shipped stages agree with the rules module (no list of expected warnings)', () => {
  it('every shipped stage can be checked, and the sentences are the structured breaks, text for text', () => {
    for (const s of Object.values(shippedStages())) {
      expect(checkLayout(s)).toEqual(layoutBreaks(s).map((b) => b.text));
      expect(stageWarnings(s, {}).map((w) => w.text)).toEqual(checkLayout(s));
    }
  });
});
