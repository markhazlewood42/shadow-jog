/** Enemy definitions and encounter tables for Chapter 1. */
import type { Element, Family, StatusId } from '../battle/types';

export interface EnemyMove {
  id: string;
  w: number;
  /** Condition gate for the move. */
  when?: 'ally_hurt' | 'shield_ally' | 'no_atk_buff' | 'no_def_buff' | 'no_res_buff' | 'lockon_ready' | 'no_lockon' | 'hp_below_half' | 'every_3';
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
  // Chrome conducts: street muscle is wired, so a taser is the answer to a ganger as much as to a drone.
  human: { shock: 1.25, cyber: 0.6 },
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
  rustfang_medic: E({
    id: 'rustfang_medic', name: 'Rustfang Patcher', family: 'human', sprite: 'medic',
    hp: 30, atk: 10, def: 5, mnd: 12, res: 6, agi: 12, xp: 11, cred: 22,
    drops: [{ id: 'medkit', chance: 0.35 }],
    // Keeps the gang on its feet: take the medic down first or the fight drags on.
    moves: [{ id: 'e_stim', w: 5, when: 'ally_hurt' }, { id: 'attack', w: 2 }],
    lore: 'The gang’s back-alley medic. Patches up bruisers with whatever’s in the bag.',
  }),
  rustfang_punk: E({
    id: 'rustfang_punk', name: 'Rustfang Punk', family: 'human', sprite: 'punk',
    hp: 33, atk: 15, def: 6, mnd: 4, res: 4, agi: 10, xp: 9, cred: 19,
    drops: [{ id: 'gang_colors', chance: 0.25 }, { id: 'medkit', chance: 0.08 }],
    // Cornered punks stop pulling punches.
    moves: [{ id: 'attack', w: 3 }, { id: 'e_chain_whip', w: 2 }, { id: 'e_chain_whip', w: 4, when: 'hp_below_half' }],
    lore: 'Rustfang muscle. Earns his colours one broken window at a time, and wears them in the rain so they run.',
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
    lore: 'Woken sewer rats. The glow is magic. The bite is worse.',
  }),
  scrap_hound: E({
    id: 'scrap_hound', name: 'Scrap Hound', family: 'machine', sprite: 'hound',
    hp: 49, atk: 15, def: 10, mnd: 5, res: 5, agi: 13, xp: 13, cred: 16,
    drops: [{ id: 'scrap_chip', chance: 0.3 }],
    moves: [{ id: 'e_bite', w: 3 }, { id: 'e_howl', w: 1, when: 'no_atk_buff' }],
    lore: 'Kessler-Mori perimeter hounds, auctioned off when the Annex closed. The buyers stopped feeding them. They never stopped guarding.',
  }),
  street_drone: E({
    id: 'street_drone', name: 'Street Drone', family: 'machine', sprite: 'drone',
    hp: 34, atk: 12, def: 8, mnd: 9, res: 8, agi: 15, xp: 12, cred: 26,
    drops: [{ id: 'scrap_chip', chance: 0.25 }, { id: 'drone_optic', chance: 0.05 }],
    moves: [{ id: 'attack', w: 2 }, { id: 'e_taser', w: 2 }],
    lore: 'A Saltreach PD patrol unit written off after the ’71 riots and never switched off. Still issuing citations to anything that moves.',
  }),
  smog_wisp: E({
    id: 'smog_wisp', name: 'Smog Wisp', family: 'spirit', sprite: 'wisp',
    hp: 48, atk: 8, def: 6, mnd: 10, res: 14, agi: 12, xp: 15, cred: 10,
    drops: [{ id: 'ecto_vial', chance: 0.15 }],
    moves: [{ id: 'e_choke', w: 2 }, { id: 'e_wisp_flame', w: 2 }],
    lore: 'A spirit born of exhaust and neglect. Blades pass right through.',
  }),
  knuckles: E({
    id: 'knuckles', name: '“Knuckles” Tran', family: 'human', sprite: 'brute', boss: true, ai: 'knuckles',
    hp: 460, atk: 38, def: 11, mnd: 10, res: 8, agi: 11, xp: 130, cred: 380,
    drops: [{ id: 'lucky_coin', chance: 1 }],
    moves: [{ id: 'attack', w: 3 }, { id: 'e_haymaker', w: 2 }, { id: 'e_rally', w: 2, when: 'no_atk_buff' }, { id: 'e_pipe_bomb', w: 1.5 }],
    lore: 'Rustfang enforcer. Named for his hands, both of which are chrome.',
  }),

  // ------------------------------------------------------------------ the Sinkline
  // (Its own enemies pay about 1.6× what they did: the floor has fewer random fights since the
  // 2026-09-29 retune, and the Lurker's gear still has to be affordable from them.)
  sewer_ghoul: E({
    id: 'sewer_ghoul', name: 'Sewer Ghoul', family: 'ghoul', sprite: 'ghoul',
    hp: 124, atk: 36, def: 10, mnd: 9, res: 8, agi: 9, xp: 26, cred: 32,
    drops: [{ id: 'ghoul_tooth', chance: 0.25 }],
    // Wounded ghouls frenzy.
    moves: [{ id: 'e_claw', w: 3 }, { id: 'e_rot_bite', w: 2 }, { id: 'e_rot_bite', w: 5, when: 'hp_below_half' }],
    lore: 'Infected people who went down into the dark and stayed.',
  }),
  rust_crab: E({
    id: 'rust_crab', name: 'Rust Crab', family: 'beast', sprite: 'crab',
    hp: 98, atk: 31, def: 30, mnd: 5, res: 10, agi: 7, xp: 29, cred: 44, weak: { mana: 1.3 },
    drops: [{ id: 'crab_shell', chance: 0.3 }],
    moves: [{ id: 'e_pincer', w: 3 }, { id: 'e_harden', w: 1, when: 'no_def_buff' }, { id: 'e_shell_wall', w: 4, when: 'shield_ally' }],
    lore: 'Armored like a tank. Techs and magic get under the shell.',
  }),
  maint_drone: E({
    id: 'maint_drone', name: 'Maintenance Drone', family: 'machine', sprite: 'maint',
    hp: 92, atk: 30, def: 14, mnd: 24, res: 12, agi: 12, xp: 24, cred: 40,
    drops: [{ id: 'scrap_chip', chance: 0.35 }],
    moves: [{ id: 'attack', w: 1 }, { id: 'e_welder', w: 2 }, { id: 'e_repair', w: 3, when: 'ally_hurt' }],
    lore: 'Still fixing the tunnels. Views intruders as damage.',
  }),
  drowned_shade: E({
    id: 'drowned_shade', name: 'Drowned Shade', family: 'spirit', sprite: 'shade',
    hp: 80, atk: 13, def: 10, mnd: 23, res: 20, agi: 14, xp: 31, cred: 38,
    drops: [{ id: 'ecto_vial', chance: 0.2 }],
    // Shades wail together on a rhythm: every third round, expect it.
    moves: [{ id: 'e_chill', w: 3 }, { id: 'e_wail', w: 1 }, { id: 'e_wail', w: 8, when: 'every_3' }],
    lore: 'Echoes of commuters caught in the flood of ’61.',
  }),
  gutter_eel: E({
    id: 'gutter_eel', name: 'Gutter Eel', family: 'beast', sprite: 'eel', weak: { shock: 1.5 },
    hp: 94, atk: 35, def: 10, mnd: 20, res: 8, agi: 18, xp: 26, cred: 29,
    moves: [{ id: 'e_bite', w: 2 }, { id: 'e_coil_shock', w: 2 }, { id: 'e_coil_shock', w: 4, when: 'hp_below_half' }],
    lore: 'Two meters of teeth and bioelectric spite.',
  }),
  lurker: E({
    id: 'lurker', name: 'The Lurker', family: 'beast', sprite: 'lurker', boss: true, ai: 'lurker',
    hp: 1560, atk: 43, def: 16, mnd: 32, res: 16, agi: 13, xp: 420, cred: 540,
    // Waterlogged: one clear weakness (shock), and the beast's usual fire weakness drowned out.
    weak: { shock: 1.5, fire: 0.6 }, immune: ['stun'],
    drops: [{ id: 'mana_crystal', chance: 1 }],
    moves: [{ id: 'e_crush_coil', w: 3 }, { id: 'e_tidal', w: 2 }, { id: 'e_biolume', w: 1 }, { id: 'attack', w: 1 }],
    lore: 'Something Woke in the flooded junction and grew fat on what fell in.',
  }),

  // ------------------------------------------------------------------ K-M Annex 7
  km_sentinel: E({
    id: 'km_sentinel', name: 'K-M Sentinel', family: 'human', sprite: 'sentinel',
    hp: 246, atk: 47, def: 26, mnd: 15, res: 16, agi: 15, xp: 48, cred: 63,
    drops: [{ id: 'km_badge', chance: 0.2 }, { id: 'medkit', chance: 0.2 }],
    // Sentinels run a drill: a flashbang is likely every third round.
    moves: [{ id: 'attack', w: 2 }, { id: 'e_burst', w: 2 }, { id: 'e_flashbang', w: 3, when: 'every_3' }],
    lore: 'Kessler-Mori internal security. Their contracts forbid them to remember your face, and they are very good at their contracts.',
  }),
  sentry_turret: E({
    id: 'sentry_turret', name: 'Sentry Turret', family: 'machine', sprite: 'turret', ai: 'turret',
    hp: 208, atk: 52, def: 34, mnd: 10, res: 18, agi: 6, xp: 43, cred: 42,
    drops: [{ id: 'drone_optic', chance: 0.2 }],
    moves: [{ id: 'e_volley', w: 2 }, { id: 'attack', w: 2 }],
    lore: 'Ceiling-mounted autogun. When its barrels glow it is about to sweep the room: jam it, stun it, or brace.',
  }),
  km_arcanist: E({
    id: 'km_arcanist', name: 'K-M Arcanist', family: 'human', sprite: 'arcanist', ai: 'arcanist',
    hp: 196, atk: 18, def: 16, mnd: 38, res: 28, agi: 14, xp: 53, cred: 77,
    drops: [{ id: 'neurotab', chance: 0.25 }, { id: 'mana_crystal', chance: 0.08 }],
    // Hurt arcanists drain to stay alive.
    moves: [{ id: 'e_mana_bolt', w: 3 }, { id: 'e_barrier', w: 1, when: 'no_res_buff' }, { id: 'e_drain', w: 1.5 }, { id: 'e_drain', w: 2, when: 'hp_below_half' }],
    lore: 'Corporate thaumaturge. Every few breaths she pulls the building’s current through her visor; blind her, or hit her hard while she draws it, and it breaks apart.',
  }),
  hunter_drone: E({
    id: 'hunter_drone', name: 'Hunter Drone', family: 'machine', sprite: 'hunter',
    hp: 192, atk: 50, def: 22, mnd: 14, res: 14, agi: 22, xp: 48, cred: 45,
    drops: [{ id: 'drone_optic', chance: 0.25 }],
    moves: [{ id: 'e_lockon', w: 2, when: 'no_lockon' }, { id: 'e_missile', w: 4, when: 'lockon_ready' }, { id: 'attack', w: 1 }],
    lore: 'Paints a target, then erases it. Break the lock or scatter.',
  }),
  bound_spirit: E({
    id: 'bound_spirit', name: 'Bound Spirit', family: 'spirit', sprite: 'bound',
    // Softened for the 2026-09-29 retune: Sable's Crow Spirit, the crew's answer to spirits, now
    // waits for a later chapter.
    hp: 170, atk: 14, def: 14, mnd: 28, res: 26, agi: 15, xp: 55, cred: 25,
    drops: [{ id: 'ecto_vial', chance: 0.3 }],
    moves: [{ id: 'e_anguish', w: 2 }, { id: 'e_chill', w: 2 }, { id: 'e_anguish', w: 2, when: 'hp_below_half' }],
    lore: 'A spirit caged in a corporate ward. It hates everyone equally.',
  }),
  warden: E({
    id: 'warden', name: 'WARDEN', family: 'machine', sprite: 'warden', boss: true, ai: 'warden',
    hp: 1850, atk: 38, def: 30, mnd: 34, res: 22, agi: 12, xp: 0, cred: 0,
    immune: ['stun', 'jammed', 'hijacked'],
    moves: [{ id: 'attack', w: 1 }, { id: 'e_suppression', w: 3 }],
    lore: 'Annex 7 security platform. Its core runs on something that screams.',
  }),
  warden_spirit: E({
    id: 'warden_spirit', name: 'Unbound Warden', family: 'spirit', sprite: 'warden_spirit', boss: true, ai: 'warden_spirit',
    hp: 700, atk: 18, def: 16, mnd: 31, res: 26, agi: 16, xp: 300, cred: 400,
    immune: ['stun'],
    drops: [{ id: 'crow_staff', chance: 1 }],
    moves: [{ id: 'e_grasp', w: 2 }, { id: 'e_siphon', w: 2 }],
    lore: 'The spirit K-M bound into the Warden’s core. Free, and furious.',
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
    { w: 2, e: ['rustfang_punk', 'rustfang_medic'] },
    { w: 3, e: ['glowrat', 'glowrat', 'glowrat'] },
    { w: 2, e: ['street_drone', 'street_drone'] },
    { w: 1, e: ['scrap_hound', 'glowrat'] },
  ],
  barrens: [
    { w: 3, e: ['scrap_hound', 'scrap_hound'] },
    { w: 2, e: ['rustfang_punk', 'rustfang_slinger', 'rustfang_punk'] },
    { w: 2, e: ['rustfang_punk', 'rustfang_medic', 'rustfang_slinger'] },
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
    { w: 1, e: ['rust_crab', 'sewer_ghoul'] },
    { w: 1, e: ['drowned_shade', 'drowned_shade', 'glowrat'] },
    // A mixed pack from the flooded platforms: something for every element, and a hunter.
    { w: 2, e: ['sewer_ghoul', 'gutter_eel', 'glowrat'] },
  ],
  // The last stretch before the Warden: squads, not pairs, so the pressure climbs into the boss
  // instead of dipping (tests/balance.test.ts checks the Annex costs more than the Sinkline).
  annex: [
    { w: 3, e: ['km_sentinel', 'km_sentinel', 'maint_drone'] },
    { w: 2, e: ['km_sentinel', 'km_arcanist'] },
    { w: 1, e: ['km_sentinel', 'km_sentinel'] },
    { w: 2, e: ['hunter_drone', 'maint_drone', 'hunter_drone'] },
    { w: 2, e: ['sentry_turret', 'km_sentinel'] },
    { w: 1, e: ['bound_spirit', 'km_sentinel'] },
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
