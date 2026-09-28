/** Enemy definitions and encounter tables for Chapter 1. */
import type { Element, Family, StatusId } from '../battle/types';

export interface EnemyMove {
  id: string;
  w: number;
  /** Condition gate for the move. */
  when?: 'ally_hurt' | 'no_atk_buff' | 'no_def_buff' | 'no_res_buff' | 'lockon_ready' | 'no_lockon' | 'hp_below_half' | 'every_3';
}

export interface EnemyDef {
  id: string;
  name: string;
  family: Family;
  sprite: string;
  /** Optional palette tint for sprite variants. */
  tint?: string;
  hp: number;
  atk: number;
  def: number;
  mnd: number;
  res: number;
  agi: number;
  xp: number;
  cred: number;
  drops?: { id: string; chance: number }[];
  weak?: Partial<Record<Element, number>>;
  immune?: StatusId[];
  moves: EnemyMove[];
  boss?: boolean;
  /** Custom AI routine key (bosses). */
  ai?: string;
  /** Bestiary flavor. */
  lore: string;
  /** Basic attack element. */
  element?: Element;
}

export const FAMILY_WEAK: Record<Family, Partial<Record<Element, number>>> = {
  human: { cyber: 0.6 },
  machine: { shock: 1.5, cyber: 2, mana: 0.6, fire: 0.9 },
  beast: { fire: 1.5, cyber: 0.25 },
  spirit: { phys: 0.5, mana: 1.75, shock: 0.6, cyber: 0 },
  ghoul: { fire: 1.75, mana: 1.3, cyber: 0.25 },
};

export const FAMILY_IMMUNE: Record<Family, StatusId[]> = {
  human: ['jammed', 'hijacked'],
  machine: ['poison', 'burn'],
  beast: ['jammed', 'hijacked'],
  spirit: ['poison', 'jammed', 'hijacked', 'blind'],
  ghoul: ['poison', 'jammed', 'hijacked'],
};

const E = (d: EnemyDef) => d;

export const ENEMIES: Record<string, EnemyDef> = {
  // ------------------------------------------------------------------ streets & barrens
  rustfang_punk: E({
    id: 'rustfang_punk', name: 'Rustfang Punk', family: 'human', sprite: 'punk',
    hp: 33, atk: 15, def: 6, mnd: 4, res: 4, agi: 10, xp: 9, cred: 19,
    drops: [{ id: 'gang_colors', chance: 0.25 }, { id: 'medkit', chance: 0.08 }],
    moves: [{ id: 'attack', w: 3 }, { id: 'e_chain_whip', w: 2 }],
    lore: 'Rustfang gang muscle. More teeth than sense.',
  }),
  rustfang_slinger: E({
    id: 'rustfang_slinger', name: 'Rustfang Slinger', family: 'human', sprite: 'slinger',
    hp: 29, atk: 13, def: 5, mnd: 8, res: 5, agi: 13, xp: 10, cred: 22,
    drops: [{ id: 'gang_colors', chance: 0.25 }],
    moves: [{ id: 'e_slingshot', w: 3 }, { id: 'e_molotov', w: 1.5 }],
    lore: 'Hangs back and lobs whatever is on fire.',
  }),
  glowrat: E({
    id: 'glowrat', name: 'Glowrat', family: 'beast', sprite: 'rat',
    hp: 20, atk: 12, def: 3, mnd: 3, res: 3, agi: 16, xp: 5, cred: 5,
    drops: [{ id: 'rat_tail', chance: 0.35 }],
    moves: [{ id: 'attack', w: 2 }, { id: 'e_gnaw', w: 2 }],
    lore: 'Awakened sewer rats. The glow is magic. The bite is worse.',
  }),
  scrap_hound: E({
    id: 'scrap_hound', name: 'Scrap Hound', family: 'machine', sprite: 'hound',
    hp: 49, atk: 15, def: 10, mnd: 5, res: 5, agi: 13, xp: 13, cred: 16,
    drops: [{ id: 'scrap_chip', chance: 0.3 }],
    moves: [{ id: 'e_bite', w: 3 }, { id: 'e_howl', w: 1, when: 'no_atk_buff' }],
    lore: 'Feral security dogs, half chrome. Nobody owns them anymore.',
  }),
  street_drone: E({
    id: 'street_drone', name: 'Street Drone', family: 'machine', sprite: 'drone',
    hp: 34, atk: 12, def: 8, mnd: 9, res: 8, agi: 15, xp: 12, cred: 26,
    drops: [{ id: 'scrap_chip', chance: 0.25 }, { id: 'drone_optic', chance: 0.05 }],
    moves: [{ id: 'attack', w: 2 }, { id: 'e_taser', w: 2 }],
    lore: 'Decommissioned police drone running corrupted patrol code.',
  }),
  smog_wisp: E({
    id: 'smog_wisp', name: 'Smog Wisp', family: 'spirit', sprite: 'wisp',
    hp: 44, atk: 8, def: 6, mnd: 10, res: 14, agi: 12, xp: 15, cred: 10,
    drops: [{ id: 'ecto_vial', chance: 0.15 }],
    moves: [{ id: 'e_choke', w: 2 }, { id: 'e_wisp_flame', w: 2 }],
    lore: 'A spirit born of exhaust and neglect. Blades pass right through.',
  }),
  knuckles: E({
    id: 'knuckles', name: '"Knuckles" Tran', family: 'human', sprite: 'brute', boss: true,
    hp: 310, atk: 21, def: 10, mnd: 10, res: 8, agi: 11, xp: 130, cred: 300,
    drops: [{ id: 'lucky_coin', chance: 1 }],
    moves: [{ id: 'attack', w: 3 }, { id: 'e_haymaker', w: 2 }, { id: 'e_rally', w: 2, when: 'no_atk_buff' }, { id: 'e_pipe_bomb', w: 1.5 }],
    lore: 'Rustfang enforcer. Named for his hands, both of which are chrome.',
  }),

  // ------------------------------------------------------------------ the Sinkline
  sewer_ghoul: E({
    id: 'sewer_ghoul', name: 'Sewer Ghoul', family: 'ghoul', sprite: 'ghoul',
    hp: 112, atk: 29, def: 10, mnd: 9, res: 8, agi: 9, xp: 26, cred: 20,
    drops: [{ id: 'ghoul_tooth', chance: 0.25 }],
    moves: [{ id: 'e_claw', w: 3 }, { id: 'e_rot_bite', w: 2 }],
    lore: 'Infected metahumans who went down into the dark and stayed.',
  }),
  rust_crab: E({
    id: 'rust_crab', name: 'Rust Crab', family: 'beast', sprite: 'crab',
    hp: 94, atk: 27, def: 30, mnd: 5, res: 10, agi: 7, xp: 29, cred: 28, weak: { mana: 1.3 },
    drops: [{ id: 'crab_shell', chance: 0.3 }],
    moves: [{ id: 'e_pincer', w: 3 }, { id: 'e_harden', w: 1, when: 'no_def_buff' }],
    lore: 'Armored like a tank. Techs and magic get under the shell.',
  }),
  maint_drone: E({
    id: 'maint_drone', name: 'Maintenance Drone', family: 'machine', sprite: 'maint',
    hp: 83, atk: 25, def: 14, mnd: 20, res: 12, agi: 12, xp: 24, cred: 40,
    drops: [{ id: 'scrap_chip', chance: 0.35 }],
    moves: [{ id: 'attack', w: 1 }, { id: 'e_welder', w: 2 }, { id: 'e_repair', w: 3, when: 'ally_hurt' }],
    lore: 'Still fixing the tunnels. Views intruders as damage.',
  }),
  drowned_shade: E({
    id: 'drowned_shade', name: 'Drowned Shade', family: 'spirit', sprite: 'shade',
    hp: 76, atk: 13, def: 10, mnd: 20, res: 20, agi: 14, xp: 31, cred: 24,
    drops: [{ id: 'ecto_vial', chance: 0.2 }],
    moves: [{ id: 'e_chill', w: 3 }, { id: 'e_wail', w: 1.5 }],
    lore: 'Echoes of commuters caught in the flood of \'61.',
  }),
  gutter_eel: E({
    id: 'gutter_eel', name: 'Gutter Eel', family: 'beast', sprite: 'eel', weak: { shock: 1.5 },
    hp: 86, atk: 30, def: 10, mnd: 20, res: 8, agi: 18, xp: 26, cred: 18,
    moves: [{ id: 'e_bite', w: 2 }, { id: 'e_coil_shock', w: 2 }],
    lore: 'Two meters of teeth and bioelectric spite.',
  }),
  lurker: E({
    id: 'lurker', name: 'The Lurker', family: 'beast', sprite: 'lurker', boss: true, ai: 'lurker',
    hp: 1500, atk: 43, def: 16, mnd: 32, res: 16, agi: 13, xp: 420, cred: 520,
    weak: { shock: 1.5, fire: 1.25, mana: 1.2 }, immune: ['stun'],
    drops: [{ id: 'mana_crystal', chance: 1 }],
    moves: [{ id: 'e_crush_coil', w: 3 }, { id: 'e_tidal', w: 2 }, { id: 'e_biolume', w: 1 }, { id: 'attack', w: 1 }],
    lore: 'Something Awakened in the flooded junction and grew fat on what fell in.',
  }),

  // ------------------------------------------------------------------ K-M Annex 7
  km_sentinel: E({
    id: 'km_sentinel', name: 'K-M Sentinel', family: 'human', sprite: 'sentinel',
    hp: 246, atk: 49, def: 26, mnd: 15, res: 16, agi: 15, xp: 48, cred: 63,
    drops: [{ id: 'km_badge', chance: 0.2 }, { id: 'medkit', chance: 0.2 }],
    moves: [{ id: 'attack', w: 2 }, { id: 'e_burst', w: 2 }, { id: 'e_flashbang', w: 0.8 }],
    lore: 'Kessler-Mori internal security. Paid well, trained better.',
  }),
  sentry_turret: E({
    id: 'sentry_turret', name: 'Sentry Turret', family: 'machine', sprite: 'turret',
    hp: 208, atk: 53, def: 34, mnd: 10, res: 18, agi: 6, xp: 43, cred: 42,
    drops: [{ id: 'drone_optic', chance: 0.2 }],
    moves: [{ id: 'e_volley', w: 2 }, { id: 'attack', w: 2 }],
    lore: 'Ceiling-mounted autogun. Jam it, or hack it into scrap.',
  }),
  km_arcanist: E({
    id: 'km_arcanist', name: 'K-M Arcanist', family: 'human', sprite: 'arcanist',
    hp: 196, atk: 18, def: 16, mnd: 38, res: 28, agi: 14, xp: 53, cred: 77,
    drops: [{ id: 'neurotab', chance: 0.25 }, { id: 'mana_crystal', chance: 0.08 }],
    moves: [{ id: 'e_mana_bolt', w: 3 }, { id: 'e_barrier', w: 1, when: 'no_res_buff' }, { id: 'e_drain', w: 1.5 }],
    lore: 'Corporate thaumaturge. Magic, licensed and weaponized.',
  }),
  hunter_drone: E({
    id: 'hunter_drone', name: 'Hunter Drone', family: 'machine', sprite: 'hunter',
    hp: 192, atk: 51, def: 22, mnd: 14, res: 14, agi: 22, xp: 48, cred: 45,
    drops: [{ id: 'drone_optic', chance: 0.25 }],
    moves: [{ id: 'e_lockon', w: 2, when: 'no_lockon' }, { id: 'e_missile', w: 4, when: 'lockon_ready' }, { id: 'attack', w: 1 }],
    lore: 'Paints a target, then erases it. Break the lock or scatter.',
  }),
  bound_spirit: E({
    id: 'bound_spirit', name: 'Bound Spirit', family: 'spirit', sprite: 'bound',
    hp: 200, atk: 14, def: 14, mnd: 34, res: 26, agi: 15, xp: 55, cred: 25,
    drops: [{ id: 'ecto_vial', chance: 0.3 }],
    moves: [{ id: 'e_anguish', w: 2 }, { id: 'e_chill', w: 2 }],
    lore: 'A spirit caged in a corporate ward. It hates everyone equally.',
  }),
  warden: E({
    id: 'warden', name: 'WARDEN', family: 'machine', sprite: 'warden', boss: true, ai: 'warden',
    hp: 1800, atk: 38, def: 30, mnd: 34, res: 22, agi: 12, xp: 0, cred: 0,
    immune: ['stun', 'jammed', 'hijacked'],
    moves: [{ id: 'attack', w: 1 }, { id: 'e_suppression', w: 3 }],
    lore: 'Annex 7 security platform. Its core runs on something that screams.',
  }),
  warden_spirit: E({
    id: 'warden_spirit', name: 'Unbound Warden', family: 'spirit', sprite: 'warden_spirit', boss: true, ai: 'warden_spirit',
    hp: 700, atk: 18, def: 16, mnd: 31, res: 26, agi: 16, xp: 1100, cred: 1500,
    immune: ['stun'],
    drops: [{ id: 'crow_staff', chance: 1 }],
    moves: [{ id: 'e_grasp', w: 2 }, { id: 'e_siphon', w: 2 }],
    lore: 'The spirit K-M bound into the Warden\'s core. Free, and furious.',
  }),
};

export interface EncounterGroup {
  w: number;
  e: string[];
}

export const ENCOUNTERS: Record<string, EncounterGroup[]> = {
  street: [
    { w: 3, e: ['rustfang_punk', 'rustfang_punk'] },
    { w: 2, e: ['rustfang_punk', 'rustfang_slinger'] },
    { w: 3, e: ['glowrat', 'glowrat', 'glowrat'] },
    { w: 2, e: ['street_drone', 'street_drone'] },
    { w: 1, e: ['scrap_hound', 'glowrat'] },
  ],
  barrens: [
    { w: 3, e: ['scrap_hound', 'scrap_hound'] },
    { w: 2, e: ['rustfang_punk', 'rustfang_slinger', 'rustfang_punk'] },
    { w: 2, e: ['smog_wisp', 'glowrat', 'glowrat'] },
    { w: 2, e: ['street_drone', 'scrap_hound'] },
    { w: 1, e: ['smog_wisp', 'smog_wisp'] },
  ],
  park: [
    { w: 3, e: ['glowrat', 'glowrat', 'glowrat', 'glowrat'] },
    { w: 2, e: ['smog_wisp', 'glowrat'] },
    { w: 2, e: ['smog_wisp', 'smog_wisp', 'glowrat'] },
  ],
  sinkline: [
    { w: 3, e: ['sewer_ghoul', 'sewer_ghoul'] },
    { w: 2, e: ['rust_crab', 'glowrat', 'glowrat'] },
    { w: 2, e: ['maint_drone', 'maint_drone'] },
    { w: 2, e: ['drowned_shade', 'sewer_ghoul'] },
    { w: 2, e: ['gutter_eel', 'gutter_eel'] },
    { w: 1, e: ['rust_crab', 'maint_drone'] },
    { w: 1, e: ['drowned_shade', 'drowned_shade', 'glowrat'] },
  ],
  annex: [
    { w: 3, e: ['km_sentinel', 'km_sentinel'] },
    { w: 2, e: ['km_sentinel', 'km_arcanist'] },
    { w: 2, e: ['hunter_drone', 'maint_drone'] },
    { w: 2, e: ['sentry_turret', 'km_sentinel'] },
    { w: 1, e: ['bound_spirit', 'km_arcanist'] },
    { w: 1, e: ['hunter_drone', 'hunter_drone'] },
  ],
  // Fixed battles
  f_first_fight: [{ w: 1, e: ['rustfang_punk', 'rustfang_punk'] }],
  f_rustyard_gate: [{ w: 1, e: ['scrap_hound', 'rustfang_punk', 'scrap_hound'] }],
  f_knuckles: [{ w: 1, e: ['rustfang_punk', 'knuckles', 'rustfang_slinger'] }],
  f_lurker: [{ w: 1, e: ['lurker'] }],
  f_annex_door: [{ w: 1, e: ['km_sentinel', 'sentry_turret', 'km_sentinel'] }],
  f_warden: [{ w: 1, e: ['warden'] }],
};
