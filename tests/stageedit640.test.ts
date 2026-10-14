/**
 * The Battle Stage Editor on the 640x360 set (ET task 5; the archive's cases ran on the 480x270 fixture and still do, in tests/stageedit*.test.ts).
 *
 * The editor edits the set the game reads: `stages-640.json` and `hud-640.json`. Every limit that was "the screen" in the Phaser spike is the stage's own screen now
 * (`screenOf`), and the 480x270 design that sits in the middle of the 640x360 screen is shifted by 80 and 45. These cases pin that on the frozen 640 fixture
 * (`tests/fixtures/stagedata/`, a copy of the set as it was on 2026-10-13). They are new cases, not archive cases.
 */
import { describe, expect, it } from 'vitest';
import { BG_IDS } from '../src/art/battlebg480';
import { checkStages, type EntryFile, type HudLayout, loadEntries, loadHud, resolveStage, SCREENS, type StageEntry } from '../src/battlestage/config';
import { HUD_REGIONS, hudOverrides, PRESET_IDS, presetValue } from '../src/battlestage/hudpresets';
import { STAGE_KNOWN } from '../src/battlestage/known';
import { layoutBreaks, RULE_LIMITS } from '../src/battlestage/rules';
import { alignAcross, alignBoxes, alignedSlots, cloneStage, copyFromPrevious, moveGroup, setFloorBottom, setHorizon, setHudBox, setRowY, slotFor, standingRange, startsOf } from '../src/dev/stageedit/model';
import { applyPresetOn, hudOverridesOn, presetValueOn, revertRegionOn } from '../src/dev/stageedit/presets';
import { prepareSave, SET_SCREEN } from '../src/dev/stageedit/save';
import type { EditorData } from '../src/dev/stageedit/session';
import { devicePixelsPerGamePixel } from '../src/dev/stageedit/zoom';
import { H, W } from '../src/sje';
import fixtureHud640 from './fixtures/stagedata/hud-640.json';
import fixtureStages640 from './fixtures/stagedata/stages-640.json';
import { fixtureFacing, fixtureHeroes, fixtureStagesJson } from './stagefiles';

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const entries = (): EntryFile => loadEntries(copy(fixtureStages640), BG_IDS, STAGE_KNOWN);
const street = (f = entries()): StageEntry => f.street as StageEntry;
const valid = (s: StageEntry): string[] => checkStages({ [s.id]: s }, BG_IDS, STAGE_KNOWN);

describe('the 640 fixture is the set the editor writes', () => {
  it('loads through the loaders the game uses, and every stage is laid out on the game’s screen', () => {
    const f = entries();
    expect(Object.keys(f).length).toBeGreaterThan(0);
    for (const s of Object.values(f)) expect(s.screen).toEqual({ w: W, h: H });
    expect(SET_SCREEN).toEqual({ w: W, h: H });
    expect(SCREENS[1]).toEqual(SET_SCREEN);
    expect(() => loadHud(copy(fixtureHud640), SET_SCREEN)).not.toThrow();
  });

  it('prepareSave with the set’s screen accepts the 640 files and refuses a stage of the 480 set', () => {
    const body = { stages: copy(fixtureStages640), axes: {}, hud: copy(fixtureHud640).layout };
    expect(prepareSave(body, undefined, { screen: SET_SCREEN }).ok).toBe(true);
    const old = prepareSave({ stages: copy(fixtureStagesJson), axes: {} }, undefined, { screen: SET_SCREEN });
    expect(old.ok).toBe(false);
    expect(!old.ok && old.problems.join(' ')).toMatch(/480x270/);
  });
});

describe('the ground handles stop at the 640x360 screen', () => {
  it('the floor bottom stops at 360, and the horizon, rows and floor stay valid', () => {
    const s = street();
    expect(setFloorBottom(s, 999)).toBe(H);
    expect(setHorizon(s, 400)).toBe(s.rows[0]?.y);
    expect(setRowY(s, 4, 999)).toBe(s.floor.y1);
    expect(valid(s)).toEqual([]);
  });
});

describe('moving fighters keeps each side in its half of the 640 screen', () => {
  const opts = { rows: true, grid: false };
  it('feet dropped on the screen land on the fighter’s own half (0 to 319 and 320 to 640)', () => {
    const s = street();
    expect(slotFor(s, 'party', 600, 190, opts).x).toBe(W / 2 - 1);
    expect(slotFor(s, 'enemy', 100, 190, opts).x).toBe(W / 2);
    expect(slotFor(s, 'enemy', 900, 190, opts).x).toBe(W);
  });

  it('a group dragged far left or right stops at the half’s edge, and the set stays valid', () => {
    const s = street();
    moveGroup(s, 'party', '3', startsOf(s.party, [0, 1, 2, 3]), 999, 0, 0);
    expect(Math.max(...s.party.map((q) => q.x))).toBeLessThanOrEqual(W / 2 - 1);
    moveGroup(s, 'enemy', '3', startsOf(s.enemySets['3'] ?? [], [0, 1, 2]), -999, 0, 0);
    expect(Math.min(...(s.enemySets['3'] ?? []).map((q) => q.x))).toBeGreaterThanOrEqual(W / 2);
    expect(valid(s)).toEqual([]);
  });
});

describe('formations and Align follow the 480 design’s place in the middle of the screen', () => {
  it('the Align button lays the enemy groups out 80 px further right than on 480, and every group stays on the right half', () => {
    const at480 = alignedSlots(5, '3');
    const at640 = alignedSlots(5, '3', W);
    expect(at640.map((q) => q.x)).toEqual(at480.map((q) => q.x + 80));
    expect(at640.map((q) => q.row)).toEqual(at480.map((q) => q.row));
    for (const key of ['1', '2', '3', '4', '5', '6', 'boss', 'boss+1', 'boss+2']) expect(alignedSlots(5, key, W).every((q) => q.x >= W / 2 && q.x <= W)).toBe(true);
    expect(alignedSlots(5, 'boss', W)[0]).toMatchObject({ x: 372 + 80, size: 'boss' });
  });

  it('“Copy from n-1” puts the extra enemy 80 px further right on the 640 screen', () => {
    const s = street();
    expect(copyFromPrevious(s, '4')).toBeNull();
    expect(s.enemySets['4']?.[3]?.x).toBe(404 + 80);
    expect(valid(s)).toEqual([]);
  });

  it('the standing range follows the rules: the nearest enemy edge is 260 + 80 on 640, and the right limit is the screen less the margin', () => {
    expect(standingRange('party', undefined, W)).toEqual({ l: 0, r: W / 2 });
    expect(standingRange('enemy', undefined, W)).toEqual({ l: RULE_LIMITS.nearest + 80, r: W - RULE_LIMITS.edgeMargin });
    // The 55 px gap narrows it the same way as on 480.
    expect(standingRange('party', 340, W)).toEqual({ l: 0, r: 285 });
  });

  it('Align Right on the heroes of the 640 street keeps them inside the left half and the stage valid', () => {
    const s = street();
    const reach = Object.fromEntries(s.party.map((_, i) => [i, { left: 20, right: 20 }]));
    alignAcross(s, 'party', '3', [0, 1, 2, 3], 'right', reach, undefined);
    for (const q of s.party) expect(q.x + 20).toBeLessThanOrEqual(W / 2);
    expect(valid(s)).toEqual([]);
  });
});

describe('HUD boxes stay whole on the 640x360 screen', () => {
  const data = (): EditorData => ({ stages: entries(), axes: {}, hud: loadHud(copy(fixtureHud640), SET_SCREEN), facing: fixtureFacing(), heroes: fixtureHeroes() });

  it('a box dragged far past the right and bottom edges stops inside the screen, and the resolved stage still checks', () => {
    const d = data();
    setHudBox(d, 'street', 'commands', { x: 9999, y: 9999 });
    const c = d.hud.commands;
    expect(c.x + c.w).toBeLessThanOrEqual(W);
    expect(c.y + c.h).toBeLessThanOrEqual(H);
    expect(checkStages({ street: { ...cloneStage(d.stages.street as StageEntry) } }, BG_IDS, STAGE_KNOWN)).toEqual([]);
    expect(resolveStage(d.stages.street as StageEntry, d.hud).hud.commands.x).toBe(c.x);
  });

  it('Align Right on one box lines it up with the screen’s right edge (640), Bottom with its bottom edge (360)', () => {
    const box = { x: 10, y: 10, w: 100, h: 40 };
    expect(alignBoxes({ commands: box }, 'right', { w: W, h: H }).commands).toEqual({ x: W - 100, y: 10 });
    expect(alignBoxes({ commands: box }, 'bottom', { w: W, h: H }).commands).toEqual({ x: 10, y: H - 40 });
  });
});

describe('the zoom table of the 640x360 picture', () => {
  it('2x needs 1280 x 720 px of room, and a display scaled to 125% still gives a whole number', () => {
    expect(devicePixelsPerGamePixel(1279, 900, W, H, 1)).toBe(1);
    expect(devicePixelsPerGamePixel(1280, 720, W, H, 1)).toBe(2);
    expect(devicePixelsPerGamePixel(1320, 900, W, H, 1)).toBe(2);
    expect(devicePixelsPerGamePixel(1280, 720, W, H, 1.25)).toBe(2);
    expect(devicePixelsPerGamePixel(1200, 700, W, H, 1.25)).toBe(2);
    for (const dpr of [1, 1.25, 1.5, 1.75, 2]) expect(Number.isInteger(devicePixelsPerGamePixel(1111, 777, W, H, dpr))).toBe(true);
  });
});

describe('the horizon on a 640 stage keeps the backdrop’s kerb on it', () => {
  it('moving the horizon of the reprojected street sets shiftY to horizon minus the 640 art’s kerb row (176), so the kerb rule holds', () => {
    const s = street();
    expect(s.backdrop.mode).toBe('reproject');
    expect(setHorizon(s, 137)).toBe(137);
    expect(s.backdrop.shiftY).toBe(137 - 176);
    expect(layoutBreaks(resolveStage(s, loadHud(copy(fixtureHud640), SET_SCREEN))).filter((b) => b.rule === 'kerb')).toEqual([]);
  });
});

describe('the HUD presets on the 640x360 screen', () => {
  const layout = (): HudLayout => loadHud(copy(fixtureHud640), SET_SCREEN);

  it('the preset the 640 file uses matches the file: no box counts as moved by hand', () => {
    const hud = layout();
    expect(hud.preset).toBe('action-left');
    expect(hudOverridesOn(hud, SET_SCREEN).filter((o) => o.field === 'x' || o.field === 'y')).toEqual([]);
    // Without the move to the screen the 480 numbers would call every box moved: the control.
    expect(hudOverrides(hud).length).toBeGreaterThan(0);
  });

  it('a preset on 640 is the 480 preset moved by the documented transform: x + 80, a lower-half box + 90, an upper-half box stays', () => {
    expect(presetValueOn(SET_SCREEN, 'timeline-bottom3', 'turnOrder', 'x')).toBe((presetValue('timeline-bottom3', 'turnOrder', 'x') as number) + 80);
    expect(presetValueOn(SET_SCREEN, 'timeline-bottom3', 'turnOrder', 'y')).toBe(presetValue('timeline-bottom3', 'turnOrder', 'y'));
    expect(presetValueOn(SET_SCREEN, 'timeline-bottom3', 'partyStatus', 'y')).toBe((presetValue('timeline-bottom3', 'partyStatus', 'y') as number) + 90);
    // On the 480 screen it is the preset itself.
    expect(presetValueOn({ w: 480, h: 270 }, 'ff-strip', 'commands', 'x')).toBe(presetValue('ff-strip', 'commands', 'x'));
  });

  it('switching preset puts every box inside the 640x360 screen; reverting a box goes back to the preset of this screen', () => {
    const hud = layout();
    for (const id of PRESET_IDS) {
      const copyHud = copy(hud);
      applyPresetOn(SET_SCREEN, copyHud, id, true);
      for (const r of HUD_REGIONS) {
        const b = copyHud[r];
        expect(b.x + b.w, `${id} ${r}`).toBeLessThanOrEqual(W);
        expect(b.y + b.h, `${id} ${r}`).toBeLessThanOrEqual(H);
      }
      expect(hudOverridesOn(copyHud, SET_SCREEN)).toEqual([]);
    }
    const moved = layout();
    moved.commands.x += 5;
    expect(hudOverridesOn(moved, SET_SCREEN).map((o) => `${o.region}.${o.field}`)).toEqual(['commands.x']);
    revertRegionOn(SET_SCREEN, moved, 'commands');
    expect(hudOverridesOn(moved, SET_SCREEN)).toEqual([]);
  });
});
