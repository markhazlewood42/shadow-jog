import { describe, expect, it } from 'vitest';
import stagesJson from '../src/data/stages.json';
import { setHudBox, setHudField } from '../src/stage/edit/model';
import { checkLayout, checkStages, loadStages, type StageConfig } from '../src/stage/config';
import { applyPreset, HUD_PRESETS, HUD_REGIONS, hudOverrides, overriddenRegions, PRESET_IDS, revertField, revertRegion } from '../src/stage/hudpresets';

const street = (): StageConfig => JSON.parse(JSON.stringify(loadStages(stagesJson).street)) as StageConfig;

describe('HUD presets', () => {
  it('the shipped stages sit exactly on the design preset: no box is overridden', () => {
    for (const s of Object.values(loadStages(stagesJson))) expect(hudOverrides(s.hud)).toEqual([]);
  });

  it('every preset places every box inside the screen and keeps to the design’s layout rules', () => {
    for (const id of PRESET_IDS) {
      const s = street();
      applyPreset(s.hud, id, true);
      expect(s.hud.preset).toBe(id);
      expect({ id, problems: checkStages({ street: s }) }).toEqual({ id, problems: [] });
      expect({ id, warnings: checkLayout(s) }).toEqual({ id, warnings: [] });
    }
  });

  it('presets differ from one another, so switching one is visible', () => {
    const boxes = PRESET_IDS.map((id) => JSON.stringify(HUD_REGIONS.map((r) => HUD_PRESETS[id].regions[r])));
    expect(new Set(boxes).size).toBe(PRESET_IDS.length);
  });

  it('a box moved by hand is an override; reverting puts it back to the preset', () => {
    const s = street();
    setHudBox(s, 'commands', { x: 100, y: 200 });
    expect(overriddenRegions(s.hud)).toEqual(['commands']);
    expect(hudOverrides(s.hud).map((o) => o.field)).toEqual(['x', 'y']);
    revertField(s.hud, 'commands', 'x');
    expect(hudOverrides(s.hud).map((o) => o.field)).toEqual(['y']);
    revertRegion(s.hud, 'commands');
    expect(hudOverrides(s.hud)).toEqual([]);
  });

  it('switching preset keeps the boxes moved by hand and says which, and can clear them instead', () => {
    const s = street();
    setHudBox(s, 'turnOrder', { x: 10 });
    const kept = applyPreset(s.hud, 'ff-strip');
    expect(kept).toEqual(['turnOrder']);
    expect(s.hud.turnOrder.x).toBe(10);
    expect(s.hud.partyStatus.x).toBe(HUD_PRESETS['ff-strip'].regions.partyStatus.x);
    // The moved box is still an override, now of the new preset.
    expect(overriddenRegions(s.hud)).toEqual(['turnOrder']);
    applyPreset(s.hud, 'timeline-bottom3', true);
    expect(hudOverrides(s.hud)).toEqual([]);
  });

  it('box edits are kept whole and inside the screen', () => {
    const s = street();
    setHudBox(s, 'combo', { x: 470, y: 260, w: 100, h: 100 });
    const r = s.hud.combo;
    expect(r.x + r.w).toBeLessThanOrEqual(480);
    expect(r.y + r.h).toBeLessThanOrEqual(270);
    setHudField(s, 'banner', 'opacity', 7);
    expect(s.hud.banner.opacity).toBe(1);
    setHudField(s, 'banner', 'show', 'never');
    expect(s.hud.banner.show).toBe('never');
    expect(checkStages({ street: s })).toEqual([]);
  });
});
