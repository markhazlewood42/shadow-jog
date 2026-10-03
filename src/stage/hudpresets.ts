/**
 * HUD layout presets (Phaser spike `spike/phaser-stage`): named starting positions for the battle HUD's six boxes,
 * and the small pure functions the Battle Stage Editor uses to tell which of a stage's boxes were moved by hand.
 *
 * The idea is borrowed from RPG Maker plugins that offer several battle layouts and from Tiled's templates: a
 * stage picks a **preset** (a ready-made arrangement) and then Mark may drag any box on that stage. A box that
 * differs from its preset is **overridden**; one that matches is **inherited**. The editor shows inherited values
 * in grey, overridden ones in white and gives every overridden value a revert arrow back to the preset's.
 *
 * Nothing here draws or touches the browser, so a test can check every preset against the design's layout rules.
 *
 * What a preset decides is the six fields every box shares: where it is (`x`, `y`), how big (`w`, `h`), when it
 * shows (`show`) and how see-through it is (`opacity`). The finer settings (chip sizes, row height, styles) are
 * the stage's own and a preset never touches them.
 */
import type { HudLayout, HudRegion } from './config';

/** The six boxes, in the order an inspector lists them. */
export const HUD_REGIONS = ['turnOrder', 'commands', 'partyStatus', 'enemyInfo', 'banner', 'combo'] as const;
export type HudRegionKey = (typeof HUD_REGIONS)[number];

/** The fields a preset decides for each box. */
export const HUD_FIELDS = ['x', 'y', 'w', 'h', 'show', 'opacity'] as const;
export type HudField = (typeof HUD_FIELDS)[number];

/** Plain-language names (the data name sits beside them in the inspector). */
export const HUD_REGION_NAMES: Record<HudRegionKey, string> = {
  turnOrder: 'Turn order',
  commands: 'Commands',
  partyStatus: 'Party status',
  enemyInfo: 'Enemy info',
  banner: 'Skill banner',
  combo: 'Combo counter',
};

export type PresetId = HudLayout['preset'];

type Box = Pick<HudRegion, 'x' | 'y' | 'w' | 'h' | 'show'> & { opacity: number };

export interface HudPreset {
  id: PresetId;
  name: string;
  about: string;
  regions: Record<HudRegionKey, Box>;
}

const box = (x: number, y: number, w: number, h: number, show: HudRegion['show'], opacity = 0.8): Box => ({ x, y, w, h, show, opacity });

/** The design's own layout: the timeline on top, party / menu / enemies in a band along the bottom. */
const DESIGN: HudPreset['regions'] = {
  turnOrder: box(120, 2, 240, 35, 'always'),
  commands: box(204, 226, 112, 42, 'input'),
  partyStatus: box(4, 226, 196, 42, 'always'),
  enemyInfo: box(320, 226, 156, 42, 'input'),
  banner: box(140, 40, 200, 13, 'action'),
  combo: box(404, 2, 72, 25, 'action'),
};

export const HUD_PRESETS: Record<PresetId, HudPreset> = {
  'timeline-bottom3': {
    id: 'timeline-bottom3',
    name: 'Timeline + bottom three',
    about: 'The final side-view design: the turn timeline on top, the party table, the menu and the enemy box in ONE band along the bottom (framed as a single window with dividers).',
    regions: DESIGN,
  },
  'ff-strip': {
    id: 'ff-strip',
    name: 'Final Fantasy strip',
    about: 'Enemies on the left of the bottom band and the party on the right, the way the classic Final Fantasy battle screens read.',
    regions: { ...DESIGN, partyStatus: box(280, 226, 196, 42, 'always'), commands: box(164, 226, 112, 42, 'input'), enemyInfo: box(4, 226, 156, 42, 'input') },
  },
  'action-left': {
    id: 'action-left',
    name: 'Action, menu on the left',
    about: 'The menu moves to the far left of the bottom band, the party table sits in the middle, and the timeline hugs the top left.',
    regions: {
      turnOrder: box(4, 2, 240, 35, 'always'),
      commands: box(4, 226, 112, 42, 'input'),
      partyStatus: box(120, 226, 196, 42, 'always'),
      enemyInfo: box(320, 226, 156, 42, 'input'),
      banner: box(4, 40, 200, 13, 'action'),
      combo: box(404, 2, 72, 25, 'action'),
    },
  },
  'ps4-panels': {
    id: 'ps4-panels',
    name: 'Phantasy Star IV panels',
    about: 'A wide party panel along the bottom with the menu floating in the lane between the two sides, like the old panel layout (kept for comparison).',
    regions: {
      turnOrder: box(120, 2, 240, 35, 'always', 0.9),
      commands: box(184, 184, 112, 42, 'input', 0.9),
      partyStatus: box(4, 226, 300, 42, 'always', 0.9),
      enemyInfo: box(308, 226, 168, 42, 'input', 0.9),
      banner: box(140, 40, 200, 13, 'action', 0.9),
      combo: box(404, 2, 72, 25, 'action', 0.9),
    },
  },
};

export const PRESET_IDS = Object.keys(HUD_PRESETS) as PresetId[];

/** What a preset says about one field of one box. */
export function presetValue(preset: PresetId, region: HudRegionKey, field: HudField): number | string {
  const b = HUD_PRESETS[preset].regions[region];
  return b[field];
}

/** The value a box has for a field now (opacity defaults to 1 when the file leaves it out, as the widgets read it). */
export function hudValue(hud: HudLayout, region: HudRegionKey, field: HudField): number | string {
  const r = hud[region];
  if (field === 'opacity') return r.opacity ?? 1;
  return r[field];
}

/** One box field that differs from its preset: the thing the inspector draws in white with a revert arrow. */
export interface HudOverride {
  region: HudRegionKey;
  field: HudField;
  value: number | string;
  inherited: number | string;
}

/** Every field of every box that differs from the layout's preset, in inspector order. */
export function hudOverrides(hud: HudLayout): HudOverride[] {
  const out: HudOverride[] = [];
  for (const region of HUD_REGIONS) {
    for (const field of HUD_FIELDS) {
      const value = hudValue(hud, region, field);
      const inherited = presetValue(hud.preset, region, field);
      if (value !== inherited) out.push({ region, field, value, inherited });
    }
  }
  return out;
}

/** The regions that have at least one overridden field. */
export function overriddenRegions(hud: HudLayout): HudRegionKey[] {
  return HUD_REGIONS.filter((r) => hudOverrides(hud).some((o) => o.region === r));
}

/** Put one field back to its preset's value (edits `hud` in place). */
export function revertField(hud: HudLayout, region: HudRegionKey, field: HudField): void {
  setField(hud, region, field, presetValue(hud.preset, region, field));
}

/** Put a whole box back to its preset (edits `hud` in place). */
export function revertRegion(hud: HudLayout, region: HudRegionKey): void {
  for (const field of HUD_FIELDS) revertField(hud, region, field);
}

/** Set one box field (edits `hud` in place). */
export function setField(hud: HudLayout, region: HudRegionKey, field: HudField, value: number | string): void {
  const r = hud[region] as unknown as Record<string, unknown>;
  r[field] = value;
}

/**
 * Switch to another preset (edits `hud` in place). A box nobody moved takes the new preset's place; a box that was
 * overridden keeps its own values, so switching presets never throws away hand work. Returns the boxes it kept, so
 * the editor can say so ("kept 2 moved boxes"); `clearOverrides` discards them instead.
 */
export function applyPreset(hud: HudLayout, preset: PresetId, clearOverrides = false): HudRegionKey[] {
  const kept: HudRegionKey[] = [];
  for (const region of HUD_REGIONS) {
    for (const field of HUD_FIELDS) {
      const was = hudValue(hud, region, field);
      const overridden = was !== presetValue(hud.preset, region, field);
      if (overridden && !clearOverrides) {
        if (!kept.includes(region)) kept.push(region);
        continue;
      }
      setField(hud, region, field, presetValue(preset, region, field));
    }
  }
  hud.preset = preset;
  return kept;
}
