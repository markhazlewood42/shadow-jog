/**
 * What a non-grinding player owns and has equipped at each story stage.
 * Shared by the economy test (can they afford it?) and the balance test (is the fight fair with it?).
 */
import type { Loadout } from './sim';

/** Items bought or found (cumulative purchases happen at the matching economy checkpoint). */
export const STAGE_GEAR = {
  barrens: ['iron_knuckles'],
  // A riot helmet for Rook before the depot: the one buy in the Rustyard stretch.
  knuckles: ['helmet'],
  sinkline: ['vibro_katana', 'heavy_pistol', 'armored_jacket'],
  lurker: ['mono_claws'],
  annex: ['ballistic_vest'],
  // Found in Annex 7 chests: dragon_fang, mono_katana, smartpistol, bone_staff.
  warden: [] as string[],
} satisfies Record<string, string[]>;

export const STAGE_PARTY: Record<string, Loadout[]> = {
  street: [{ id: 'kit', level: 1 }, { id: 'rook', level: 3 }],
  barrens: [
    { id: 'kit', level: 2, equip: { weapon: 'iron_knuckles' } },
    { id: 'rook', level: 3 },
  ],
  knuckles: [
    { id: 'kit', level: 3, equip: { weapon: 'iron_knuckles' } },
    { id: 'rook', level: 4, equip: { head: 'helmet' } },
  ],
  sinkline: [
    { id: 'kit', level: 5, equip: { weapon: 'iron_knuckles', body: 'armored_jacket' } },
    { id: 'rook', level: 5, equip: { weapon: 'vibro_katana', head: 'helmet' } },
    { id: 'hex', level: 4, equip: { weapon: 'heavy_pistol', mod: 'ghost_lens' } },
  ],
  lurker: [
    { id: 'kit', level: 6, equip: { weapon: 'mono_claws', body: 'armored_jacket', mod: 'grounding_coil' } },
    { id: 'rook', level: 6, equip: { weapon: 'vibro_katana', head: 'helmet' } },
    { id: 'hex', level: 6, equip: { weapon: 'heavy_pistol', mod: 'neural_buffer' } },
  ],
  annex: [
    { id: 'kit', level: 7, equip: { weapon: 'mono_claws', body: 'ballistic_vest', mod: 'grounding_coil' } },
    { id: 'rook', level: 7, equip: { weapon: 'vibro_katana', head: 'helmet' } },
    { id: 'hex', level: 7, equip: { weapon: 'heavy_pistol', mod: 'neural_buffer' } },
    { id: 'sable', level: 7, equip: { weapon: 'focus_rod', mod: 'ghost_lens' } },
  ],
  warden: [
    { id: 'kit', level: 8, equip: { weapon: 'dragon_fang', body: 'ballistic_vest', mod: 'grounding_coil' } },
    { id: 'rook', level: 8, equip: { weapon: 'mono_katana', head: 'helmet' } },
    { id: 'hex', level: 8, equip: { weapon: 'smartpistol', mod: 'neural_buffer' } },
    { id: 'sable', level: 7, equip: { weapon: 'focus_rod', mod: 'ghost_lens' } },
  ],
};
