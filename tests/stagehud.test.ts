import { describe, expect, it } from 'vitest';
import { BG_IDS } from '../src/art/battlebg';
import { checkHudFile, checkStages, checkStagesWith, type HudLayout, loadHud, loadStages, mergeHud, resolveStage, resolveStages } from '../src/stage/config';
import { checkLayout } from '../src/stage/rules';
import {
  alignBoxes,
  clearOverride,
  type EditorData,
  hudNow,
  isOverridden,
  overrideRegion,
  revertOverrideField,
  setHudBox,
  setHudField,
  settleData,
  stageOverrides,
} from '../src/stage/edit/model';
import { formatHud, prepareHudSave, prepareSave } from '../src/stage/edit/save';
import { applyPreset, HUD_PRESETS, HUD_REGIONS, hudOverrides, overriddenRegions, PRESET_IDS, revertField, revertRegion } from '../src/stage/hudpresets';
import { STAGE_KNOWN } from '../src/stage/known';
import { hudJson, shippedEntries, shippedFacing, shippedHeroes, shippedHud, shippedStages } from './stagefiles';

/** The global layout and the stage entries as one piece of editor data. */
const data = (): EditorData => ({ stages: shippedEntries(), axes: {}, hud: shippedHud(), facing: shippedFacing(), heroes: shippedHeroes() });

describe('the global HUD file (hud.json)', () => {
  it('is valid, is the action-left preset, and every stage uses it as it is (no stage carries a HUD override)', () => {
    expect(checkHudFile(hudJson)).toEqual([]);
    expect(shippedHud().preset).toBe('action-left');
    // Mark's region positions (commit 6364bb5) are the action-left preset's own, so nothing is moved by hand.
    expect(hudOverrides(shippedHud())).toEqual([]);
    for (const s of Object.values(shippedEntries())) expect(s.hud).toBeUndefined();
  });

  it('keeps Mark’s positions on both stages', () => {
    for (const s of Object.values(shippedStages())) {
      expect([s.hud.turnOrder.x, s.hud.turnOrder.y, s.hud.commands.x, s.hud.commands.y, s.hud.partyStatus.x, s.hud.enemyInfo.x, s.hud.banner.x, s.hud.combo.x]).toEqual([4, 2, 4, 226, 120, 320, 4, 404]);
    }
  });

  it('is refused in plain words when a box is off the screen, a show rule does not exist, or the version is wrong', () => {
    const bad = (mutate: (l: HudLayout) => void, version = 1): string[] => {
      const layout = shippedHud();
      mutate(layout);
      return checkHudFile({ version, layout });
    };
    expect(bad((l) => { l.partyStatus.x = 400; }).join('\n')).toContain('past the right edge');
    expect(bad((l) => { (l.banner as { show: string }).show = 'sometimes'; }).join('\n')).toContain('layout.banner.show');
    expect(bad(() => {}, 2).join('\n')).toContain('version must be 1');
    expect(checkHudFile(null)).toHaveLength(1);
    expect(() => loadHud({ version: 1 })).toThrow(/hud.json is not valid/);
  });

  it('is written as { version, layout } in the stable format, and the endpoint’s check refuses what the loader refuses', () => {
    const made = prepareHudSave(shippedHud());
    expect(made.ok).toBe(true);
    if (made.ok) {
      expect(JSON.parse(made.text)).toEqual({ version: 1, layout: shippedHud() });
      expect(made.text).toBe(formatHud(shippedHud()));
    }
    const broken = shippedHud();
    broken.combo.w = 900;
    expect(prepareHudSave(broken)).toMatchObject({ ok: false });
    expect(prepareHudSave(undefined)).toMatchObject({ ok: false });
  });
});

describe('a stage’s HUD overrides and the merge', () => {
  it('a stage with no override resolves to the global layout; one with an override changes only that box and field', () => {
    const entries = shippedEntries();
    const hud = shippedHud();
    expect(resolveStage(entries.street as never, hud).hud).toEqual(hud);
    const e = entries.street;
    if (!e) throw new Error('no street');
    e.hud = { commands: { x: 60 }, banner: { show: 'never', opacity: 0.5 } };
    const r = resolveStage(e, hud).hud;
    expect(r.commands).toEqual({ ...hud.commands, x: 60 });
    expect(r.banner).toEqual({ ...hud.banner, show: 'never', opacity: 0.5 });
    expect(r.partyStatus).toEqual(hud.partyStatus);
    // The merge never edits the global layout it was given.
    expect(hud.commands.x).toBe(4);
    expect(mergeHud(hud, e.hud).commands.x).toBe(60);
  });

  it('the loader checks the overrides: unknown boxes and fields, values out of range, and a merged box that leaves the screen', () => {
    const f = shippedEntries() as unknown as Record<string, Record<string, unknown>>;
    const run = (hud: unknown): string[] => {
      const copy = JSON.parse(JSON.stringify(f)) as Record<string, Record<string, unknown>>;
      (copy.street as Record<string, unknown>).hud = hud;
      return checkStagesWith(copy, shippedHud(), BG_IDS, STAGE_KNOWN);
    };
    expect(run({ commands: { x: 60 } })).toEqual([]);
    expect(run({ commands: {} })).toEqual([]);
    expect(run({ moon: { x: 1 } }).join('\n')).toContain('is not a HUD box');
    expect(run({ commands: { style: 'list' } }).join('\n')).toContain('can only override');
    expect(run({ commands: { x: -3 } }).join('\n')).toContain('hud.commands.x');
    expect(run({ banner: { show: 'sometimes' } }).join('\n')).toContain('hud.banner.show');
    expect(run({ combo: { opacity: 2 } }).join('\n')).toContain('hud.combo.opacity');
    expect(run('big')).toHaveLength(1);
    // x 460 is fine alone; with the global width 72 the box would reach x 532.
    expect(run({ combo: { x: 460 } }).join('\n')).toContain('past the right edge');
  });

  it('loadStages resolves every stage against the global HUD; a layout that cannot be used throws one readable error', () => {
    const stages = loadStages(JSON.parse(JSON.stringify(shippedEntries())), BG_IDS, STAGE_KNOWN, shippedHud());
    expect(Object.keys(stages)).toEqual(['street', 'sewer']);
    expect(stages.street?.hud.preset).toBe('action-left');
    const entries = shippedEntries();
    if (entries.sewer) entries.sewer.hud = { turnOrder: { w: 900 } };
    expect(() => loadStages(entries, BG_IDS, STAGE_KNOWN, shippedHud())).toThrow(/stages.json is not valid/);
    // checkStages on its own judges the file’s shape; it does not need the global layout.
    expect(checkStages(shippedEntries(), BG_IDS, STAGE_KNOWN)).toEqual([]);
  });

  it('the design’s layout rules pass for the resolved stages, with and without an override', () => {
    for (const s of Object.values(shippedStages())) expect(checkLayout(s)).toEqual([]);
    const entries = shippedEntries();
    const e = entries.street;
    if (!e) throw new Error('no street');
    e.hud = { turnOrder: { w: 480, h: 60 } };
    expect(checkLayout(resolveStages(entries, shippedHud()).street as never).join('\n')).toContain('always-on HUD');
  });
});

describe('editing the HUD: where an edit lands', () => {
  it('a box this stage does not override is edited in the global layout, so every stage follows', () => {
    const d = data();
    setHudBox(d, 'street', 'commands', { x: 100, y: 200 });
    expect(d.hud.commands.x).toBe(100);
    expect(d.stages.street?.hud).toBeUndefined();
    expect(hudNow(d, 'sewer', 'commands', 'x')).toBe(100);
    expect(resolveStage(d.stages.sewer as never, d.hud).hud.commands.x).toBe(100);
    expect(overriddenRegions(d.hud)).toEqual(['commands']);
  });

  it('a box this stage overrides is edited on this stage only, and only the fields that differ are kept', () => {
    const d = data();
    overrideRegion(d, 'street', 'commands');
    expect(isOverridden(d.stages.street as never, 'commands')).toBe(true);
    expect(stageOverrides(d, 'street')).toEqual([]);
    setHudBox(d, 'street', 'commands', { x: 60 });
    expect(d.stages.street?.hud).toEqual({ commands: { x: 60 } });
    expect(d.hud.commands.x).toBe(4);
    expect(hudNow(d, 'street', 'commands', 'x')).toBe(60);
    expect(hudNow(d, 'sewer', 'commands', 'x')).toBe(4);
    expect(stageOverrides(d, 'street')).toEqual([{ region: 'commands', field: 'x', value: 60, global: 4 }]);
    // Typing the global value back drops the field again.
    setHudField(d, 'street', 'commands', 'x', 4);
    expect(d.stages.street?.hud).toEqual({ commands: {} });
    setHudField(d, 'street', 'banner', 'opacity', 0.3);
    expect(d.hud.banner.opacity).toBe(0.3);
  });

  it('reverting one override field, or the whole box, goes back to the global value', () => {
    const d = data();
    overrideRegion(d, 'street', 'combo');
    setHudBox(d, 'street', 'combo', { x: 300, y: 50 });
    revertOverrideField(d, 'street', 'combo', 'x');
    expect(d.stages.street?.hud?.combo).toEqual({ y: 50 });
    clearOverride(d, 'street', 'combo');
    expect(d.stages.street?.hud).toBeUndefined();
    expect(hudNow(d, 'street', 'combo', 'y')).toBe(2);
  });

  it('settling drops empty overrides and fields that equal the global value, so a stage carries no HUD unless it differs', () => {
    const d = data();
    overrideRegion(d, 'street', 'commands');
    overrideRegion(d, 'sewer', 'banner');
    if (d.stages.sewer?.hud?.banner) Object.assign(d.stages.sewer.hud.banner, { x: 4, show: 'never' });
    expect(settleData(d)).toBe(true);
    expect(d.stages.street?.hud).toBeUndefined();
    expect(d.stages.sewer?.hud).toEqual({ banner: { show: 'never' } });
    expect(settleData(d)).toBe(false);
  });

  it('the global preset switch keeps boxes moved by hand and leaves stage overrides alone', () => {
    const d = data();
    setHudBox(d, 'street', 'turnOrder', { x: 10 });
    overrideRegion(d, 'sewer', 'commands');
    setHudBox(d, 'sewer', 'commands', { x: 99 });
    const kept = applyPreset(d.hud, 'ff-strip');
    expect(kept).toEqual(['turnOrder']);
    expect(d.hud.turnOrder.x).toBe(10);
    expect(d.stages.sewer?.hud?.commands?.x).toBe(99);
    expect(d.hud.partyStatus.x).toBe(HUD_PRESETS['ff-strip'].regions.partyStatus.x);
  });

  it('box edits are kept whole and inside the screen, wherever they land', () => {
    const d = data();
    setHudBox(d, 'street', 'combo', { x: 470, y: 260, w: 100, h: 100 });
    const r = d.hud.combo;
    expect(r.x + r.w).toBeLessThanOrEqual(480);
    expect(r.y + r.h).toBeLessThanOrEqual(270);
    setHudField(d, 'street', 'banner', 'opacity', 7);
    expect(d.hud.banner.opacity).toBe(1);
    setHudField(d, 'street', 'banner', 'show', 'never');
    expect(d.hud.banner.show).toBe('never');
    expect(prepareHudSave(d.hud)).toMatchObject({ ok: true });
    expect(prepareSave({ stages: d.stages, axes: {}, hud: d.hud })).toMatchObject({ ok: true });
  });
});

describe('HUD presets (on the global layout)', () => {
  it('every preset places every box inside the screen and keeps to the design’s layout rules', () => {
    for (const id of PRESET_IDS) {
      const hud = shippedHud();
      applyPreset(hud, id, true);
      expect(hud.preset).toBe(id);
      expect({ id, problems: checkHudFile({ version: 1, layout: hud }) }).toEqual({ id, problems: [] });
      const entries = shippedEntries();
      expect({ id, warnings: checkLayout(resolveStages(entries, hud).street as never) }).toEqual({ id, warnings: [] });
    }
  });

  it('presets differ from one another, so switching one is visible', () => {
    const boxes = PRESET_IDS.map((id) => JSON.stringify(HUD_REGIONS.map((r) => HUD_PRESETS[id].regions[r])));
    expect(new Set(boxes).size).toBe(PRESET_IDS.length);
  });

  it('a box moved by hand is an override of the preset; reverting puts it back', () => {
    const d = data();
    setHudBox(d, 'street', 'commands', { x: 100, y: 200 });
    expect(overriddenRegions(d.hud)).toEqual(['commands']);
    expect(hudOverrides(d.hud).map((o) => o.field)).toEqual(['x', 'y']);
    revertField(d.hud, 'commands', 'x');
    expect(hudOverrides(d.hud).map((o) => o.field)).toEqual(['y']);
    revertRegion(d.hud, 'commands');
    expect(hudOverrides(d.hud)).toEqual([]);
  });

  it('switching preset can clear the hand-moved boxes instead', () => {
    const d = data();
    setHudBox(d, 'street', 'turnOrder', { x: 10 });
    applyPreset(d.hud, 'timeline-bottom3', true);
    expect(hudOverrides(d.hud)).toEqual([]);
  });
});

describe('aligning HUD boxes', () => {
  const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

  it('one box lines up with the screen', () => {
    const b = { commands: box(50, 100, 112, 42) };
    expect(alignBoxes(b, 'left')).toEqual({ commands: { x: 0, y: 100 } });
    expect(alignBoxes(b, 'right')).toEqual({ commands: { x: 368, y: 100 } });
    expect(alignBoxes(b, 'centre')).toEqual({ commands: { x: 184, y: 100 } });
    expect(alignBoxes(b, 'top')).toEqual({ commands: { x: 50, y: 0 } });
    expect(alignBoxes(b, 'bottom')).toEqual({ commands: { x: 50, y: 228 } });
    expect(alignBoxes(b, 'middle')).toEqual({ commands: { x: 50, y: 114 } });
  });

  it('two or more line up with each other; a box that is already there is left out', () => {
    const b = { commands: box(50, 100, 100, 40), banner: box(200, 20, 60, 10) };
    expect(alignBoxes(b, 'left')).toEqual({ banner: { x: 50, y: 20 } });
    expect(alignBoxes(b, 'right')).toEqual({ commands: { x: 160, y: 100 } });
    expect(alignBoxes(b, 'bottom')).toEqual({ banner: { x: 200, y: 130 } });
    expect(alignBoxes(b, 'top')).toEqual({ commands: { x: 50, y: 20 } });
  });

  it('three or more can be spread with equal gaps; fewer than three cannot', () => {
    const b = { turnOrder: box(0, 0, 40, 10), commands: box(100, 0, 40, 10), banner: box(260, 0, 40, 10) };
    expect(alignBoxes(b, 'spreadAcross')).toEqual({ commands: { x: 130, y: 0 } });
    expect(alignBoxes({ turnOrder: b.turnOrder, banner: b.banner }, 'spreadAcross')).toEqual({});
    const v = { turnOrder: box(0, 0, 10, 20), commands: box(0, 30, 10, 20), banner: box(0, 100, 10, 20) };
    expect(alignBoxes(v, 'spreadDown')).toEqual({ commands: { x: 0, y: 50 } });
  });
});
