/** Debug stage presets: jump to a representative point in the chapter (tests, screenshots). */
import type { Dir } from '../art/chars';
import { addMember, fullRestore } from './party';
import { newState, setState, state, type MemberId } from './state';

export interface Stage {
  map: string;
  x: number;
  y: number;
  dir: Dir;
  /** Typical play time to reach this point, for the HUD clock and save metadata. */
  minutes: number;
}

type Kit = { level: number; equip?: Record<string, string> };

function crew(members: Partial<Record<MemberId, Kit>>): void {
  for (const [id, k] of Object.entries(members) as [MemberId, Kit][]) {
    const m = addMember(id, k.level);
    if (k.equip) Object.assign(m.equip, k.equip);
    fullRestore(m);
  }
}

const FLAGS_BEFORE_HEX = { intro: true, first_fight: true, met_dutch: true, objective: 'Find Hex. She lives above Chrome+Circuit, by the canal.' };
const FLAGS_SINKLINE = {
  ...FLAGS_BEFORE_HEX, met_hex: true, rustyard_gate: true, knuckles: true, coprocessor_given: true, hex_joined: true, sinkline_gate: true,
  objective: 'Find a way across the flooded junction.',
};

export const STAGES: Record<string, () => Stage> = {
  start: () => {
    crew({ kit: { level: 1 }, rook: { level: 3 } });
    Object.assign(state.flags, { intro: true, objective: 'Meet Dutch at the Drowned Saint (north side of the street).' });
    state.cred = 150;
    state.battles = 1;
    state.inventory = { medkit: 3 };
    return { map: 'lantern_row', x: 22, y: 8, dir: 'up', minutes: 4 };
  },
  town: () => {
    crew({ kit: { level: 2, equip: { weapon: 'iron_knuckles', body: 'armored_jacket' } }, rook: { level: 3 } });
    Object.assign(state.flags, FLAGS_BEFORE_HEX);
    state.cred = 420;
    state.battles = 7;
    state.inventory = { medkit: 4, detox: 2, iron_knuckles: 1, rat_tail: 3, gang_colors: 2, getaway_chit: 1 };
    return { map: 'lantern_row', x: 27, y: 21, dir: 'down', minutes: 14 };
  },
  sinkline: () => {
    crew({
      kit: { level: 5, equip: { weapon: 'iron_knuckles', body: 'armored_jacket', head: 'bandana' } },
      rook: { level: 5, equip: { weapon: 'vibro_katana' } },
      hex: { level: 4, equip: { weapon: 'heavy_pistol' } },
    });
    Object.assign(state.flags, FLAGS_SINKLINE);
    state.cred = 640;
    state.battles = 16;
    state.inventory = { medkit: 5, trauma_patch: 2, neurotab: 2, detox: 2, smoke_pellet: 1, getaway_chit: 1, scrap_chip: 2 };
    state.combos = ['combo_target_lock'];
    return { map: 'sinkline_1', x: 10, y: 9, dir: 'down', minutes: 42 };
  },
  annex: () => {
    crew({
      kit: { level: 7, equip: { weapon: 'mono_claws', body: 'ballistic_vest', head: 'helmet' } },
      rook: { level: 7, equip: { weapon: 'vibro_katana', body: 'lined_coat' } },
      hex: { level: 7, equip: { weapon: 'heavy_pistol', body: 'lined_coat' } },
      sable: { level: 7 },
    });
    Object.assign(state.flags, { ...FLAGS_SINKLINE, floodgate: true, lurker: true, annex_key: true, sable_joined: true, objective: 'Gear up from the Annex armory, then head for the freight lift in the south wing.' });
    state.cred = 1400;
    state.battles = 29;
    state.inventory = { medkit: 6, trauma_patch: 4, neurotab: 3, adrenal_stim: 2, omni_patch: 1, frag: 2 };
    state.combos = ['combo_target_lock', 'combo_thunder_rift'];
    return { map: 'annex', x: 22, y: 12, dir: 'down', minutes: 78 };
  },
};

export function applyStage(name: string): Stage {
  setState(newState());
  const make = STAGES[name];
  if (!make) throw new Error(`Unknown stage ${name}`);
  return make();
}
