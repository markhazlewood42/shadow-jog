/**
 * The HUD presets on the screen of the set the editor edits (ET task 5).
 *
 * `src/battlestage/hudpresets.ts` holds the presets in the numbers of the 480x270 layout (the file is `hud-presets.json`: "no box position is written in this file"
 * for the 640 set, fix round 1 of M3). The 640x360 HUD (`hud-640.json`) is that layout moved by the documented transform of `scripts/stage-640.mjs`: every x moves right by
 * half of what the screen is wider (80), and a box in the lower half moves down by what the screen is taller (90), to the bottom edge; a box in the upper half keeps its y.
 *
 * Without this file the editor would compare a 640 box with the 480 preset, call every box "moved by hand" (white, with a revert arrow), and put a preset's 480 numbers on the
 * 640 screen. These functions are the ones of `hudpresets.ts` with the preset moved to the screen first. For a 480x270 screen they give the preset's own numbers.
 */
import { SCREEN_H, SCREEN_W, type HudLayout, type ScreenSize } from '../../battlestage/config';
import { HUD_FIELDS, HUD_PRESETS, HUD_REGIONS, type HudField, type HudOverride, type HudRegionKey, hudValue, type PresetId, presetValue, setField } from '../../battlestage/hudpresets';

/** What a preset says about one field of one box, on this screen. */
export function presetValueOn(screen: ScreenSize, preset: PresetId, region: HudRegionKey, field: HudField): number | string {
  const v = presetValue(preset, region, field);
  if (typeof v !== 'number') return v;
  if (field === 'x') return v + (screen.w - SCREEN_W) / 2;
  // A box in the lower half of the 480x270 design sits on the bottom edge of the bigger screen; one in the upper half stays on the top edge.
  if (field === 'y') return HUD_PRESETS[preset].regions[region].y >= SCREEN_H / 2 ? v + (screen.h - SCREEN_H) : v;
  return v;
}

/** Every field of every box that differs from the layout's preset on this screen, in inspector order. */
export function hudOverridesOn(hud: HudLayout, screen: ScreenSize): HudOverride[] {
  const out: HudOverride[] = [];
  for (const region of HUD_REGIONS) {
    for (const field of HUD_FIELDS) {
      const value = hudValue(hud, region, field);
      const inherited = presetValueOn(screen, hud.preset, region, field);
      if (value !== inherited) out.push({ region, field, value, inherited });
    }
  }
  return out;
}

/** Put one field back to its preset's value on this screen (edits `hud` in place). */
export function revertFieldOn(screen: ScreenSize, hud: HudLayout, region: HudRegionKey, field: HudField): void {
  setField(hud, region, field, presetValueOn(screen, hud.preset, region, field));
}

/** Put a whole box back to its preset on this screen (edits `hud` in place). */
export function revertRegionOn(screen: ScreenSize, hud: HudLayout, region: HudRegionKey): void {
  for (const field of HUD_FIELDS) revertFieldOn(screen, hud, region, field);
}

/**
 * Switch to another preset on this screen (edits `hud` in place): a box nobody moved takes the new preset's place, a box that was overridden keeps its own values (the same
 * rule as `applyPreset`). Returns the boxes it kept; `clearOverrides` discards them instead.
 */
export function applyPresetOn(screen: ScreenSize, hud: HudLayout, preset: PresetId, clearOverrides = false): HudRegionKey[] {
  const kept: HudRegionKey[] = [];
  for (const region of HUD_REGIONS) {
    for (const field of HUD_FIELDS) {
      const was = hudValue(hud, region, field);
      const overridden = was !== presetValueOn(screen, hud.preset, region, field);
      if (overridden && !clearOverrides) {
        if (!kept.includes(region)) kept.push(region);
        continue;
      }
      setField(hud, region, field, presetValueOn(screen, preset, region, field));
    }
  }
  hud.preset = preset;
  return kept;
}
