/**
 * What a non-grinding player owns and has equipped at each story stage.
 * Shared by the economy test (can they afford it?) and the balance test (is the fight fair with it?).
 */
import type { Loadout } from './sim';

/** Items bought or found (cumulative purchases happen at the matching economy checkpoint). */
export const STAGE_GEAR = {
  barrens: ['iron_knuckles'],
  // Before the depot: a riot helmet for Rook and a jacket for Kit, so the Rustyard stretch has buys.
  knuckles: ['helmet', 'armored_jacket'],
  sinkline: ['vibro_katana', 'heavy_pistol'],
  lurker: ['mono_claws'],
  annex: ['ballistic_vest'],
  // Found in Annex 7 chests: dragon_fang, mono_katana, smartpistol, bone_staff.
  warden: [] as string[],
} satisfies Record<string, string[]>;

/**
 * Levels since the 2026-09-29 retune: Kit 1 → 6 over the chapter; Rook a wounded veteran at 10
 * (his locked skills come back with the story flags each stage carries); Hex joins at 3, Sable at 5.
 */
const TUNED = ['stingray_seated', 'rook_tuned'];
const MENDED = [...TUNED, 'rook_mended'];
export const STAGE_PARTY: Record<string, Loadout[]> = {
  street: [{ id: 'kit', level: 1 }, { id: 'rook', level: 10 }],
  barrens: [
    { id: 'kit', level: 2, equip: { weapon: 'iron_knuckles' } },
    { id: 'rook', level: 10 },
  ],
  knuckles: [
    { id: 'kit', level: 2, equip: { weapon: 'iron_knuckles', body: 'armored_jacket' } },
    { id: 'rook', level: 10, equip: { head: 'helmet' } },
  ],
  sinkline: [
    { id: 'kit', level: 3, equip: { weapon: 'iron_knuckles', body: 'armored_jacket' } },
    { id: 'rook', level: 10, equip: { weapon: 'vibro_katana', head: 'helmet' }, flags: TUNED },
    { id: 'hex', level: 3, equip: { weapon: 'heavy_pistol', mod: 'ghost_lens' } },
  ],
  lurker: [
    { id: 'kit', level: 4, equip: { weapon: 'mono_claws', body: 'armored_jacket', mod: 'grounding_coil' } },
    { id: 'rook', level: 10, equip: { weapon: 'vibro_katana', head: 'helmet' }, flags: TUNED },
    { id: 'hex', level: 4, equip: { weapon: 'heavy_pistol', mod: 'neural_buffer' } },
  ],
  annex: [
    { id: 'kit', level: 5, equip: { weapon: 'mono_claws', body: 'ballistic_vest', mod: 'grounding_coil' } },
    { id: 'rook', level: 10, equip: { weapon: 'vibro_katana', head: 'helmet' }, flags: MENDED },
    { id: 'hex', level: 5, equip: { weapon: 'heavy_pistol', mod: 'neural_buffer' } },
    { id: 'sable', level: 5, equip: { weapon: 'focus_rod', mod: 'ghost_lens' } },
  ],
  warden: [
    { id: 'kit', level: 6, equip: { weapon: 'dragon_fang', body: 'ballistic_vest', mod: 'grounding_coil' } },
    { id: 'rook', level: 11, equip: { weapon: 'mono_katana', head: 'helmet' }, flags: MENDED },
    { id: 'hex', level: 6, equip: { weapon: 'smartpistol', mod: 'neural_buffer' } },
    { id: 'sable', level: 5, equip: { weapon: 'focus_rod', mod: 'ghost_lens' } },
  ],
};
