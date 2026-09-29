/** Every action in battle: party techs & skills, combos, enemy moves. */
import type { Ability } from '../battle/types';

const A = (a: Ability): Ability => a;

export const ABILITIES: Record<string, Ability> = {
  // ------------------------------------------------------------------ basic
  attack: A({ id: 'attack', name: 'Attack', desc: 'Weapon attack.', kind: 'attack', target: 'enemy', effects: [{ type: 'damage', stat: 'atk', mult: 1 }], fx: 'slash' }),

  // ------------------------------------------------------------------ KIT (adept)
  flash_step: A({
    id: 'flash_step', name: 'Flash Step', kind: 'tech', cost: 3, target: 'enemy', priority: 40,
    desc: 'Blur forward and strike first. High critical chance.',
    effects: [{ type: 'damage', stat: 'atk', mult: 1.35, critBonus: 35 }], fx: 'flash_step',
  }),
  iron_palm: A({
    id: 'iron_palm', name: 'Iron Palm', kind: 'tech', cost: 4, target: 'enemy', element: 'mana',
    desc: 'Ki strike that ignores armor. Devastating to spirits.',
    effects: [{ type: 'damage', stat: 'mnd', power: 20, ignoreDef: true }], fx: 'palm',
  }),
  focus_breath: A({
    id: 'focus_breath', name: 'Focus Breath', kind: 'tech', cost: 5, target: 'self', field: true,
    desc: 'Restore 35% HP and shake off poison and blindness.',
    effects: [{ type: 'heal', pct: 0.35 }, { type: 'cure', statuses: ['poison', 'blind', 'burn'] }], fx: 'heal_self',
  }),
  hundred_rain: A({
    id: 'hundred_rain', name: 'Hundred Rain', kind: 'tech', cost: 9, target: 'random_enemies',
    cry: 'Kit: “Keep up with this!”',
    desc: 'A storm of blows: 5 hits on random enemies.',
    effects: [{ type: 'damage', stat: 'atk', mult: 0.62, hits: 5 }], fx: 'rain_hits',
  }),
  dragon_coil: A({
    id: 'dragon_coil', name: 'Dragon Coil', kind: 'tech', cost: 12, target: 'enemies', element: 'mana',
    cry: 'Kit: “Everything I’ve got!”',
    desc: 'Unleash a spiral of ki through every enemy.',
    effects: [{ type: 'damage', stat: 'mnd', power: 34, ignoreDef: true }], fx: 'coil',
  }),
  second_wind: A({
    id: 'second_wind', name: 'Second Wind', kind: 'skill', uses: 2, target: 'self',
    desc: 'Catch your breath: heal 50% HP.',
    effects: [{ type: 'heal', pct: 0.5 }], fx: 'heal_self',
  }),
  killing_intent: A({
    id: 'killing_intent', name: 'Killing Intent', kind: 'skill', uses: 2, target: 'enemies',
    cry: 'Kit: “Walk away. Now.”',
    desc: 'A glare that freezes the weak-willed. May stun all enemies.',
    effects: [{ type: 'status', status: 'stun', chance: 0.45, turns: 1 }], fx: 'glare',
  }),

  // ------------------------------------------------------------------ ROOK (street samurai)
  arc_cut: A({
    id: 'arc_cut', name: 'Arc Cut', kind: 'skill', uses: 5, target: 'enemy',
    desc: 'A committed two-handed slash. Heavy damage.',
    effects: [{ type: 'damage', stat: 'atk', mult: 1.8 }], fx: 'arc_cut',
  }),
  incendiary: A({
    id: 'incendiary', name: 'Incendiary Round', kind: 'skill', uses: 3, target: 'enemy', element: 'fire',
    desc: 'A dragon-breath shell from Rook’s sidearm. Fire damage; may set the target burning.',
    effects: [{ type: 'damage', stat: 'atk', mult: 1.05 }, { type: 'status', status: 'burn', chance: 0.5, turns: 3 }], fx: 'shot',
  }),
  quickdraw: A({
    id: 'quickdraw', name: 'Quickdraw', kind: 'skill', uses: 4, target: 'enemies', priority: 20,
    desc: 'Smartgun burst across every enemy.',
    effects: [{ type: 'damage', stat: 'atk', mult: 0.75 }], fx: 'gunfire',
  }),
  suppress: A({
    id: 'suppress', name: 'Suppression', kind: 'skill', uses: 3, target: 'enemies',
    desc: 'Pin them down: light damage and lowers enemy speed.',
    effects: [{ type: 'damage', stat: 'atk', mult: 0.5 }, { type: 'status', status: 'agi_down', chance: 0.8, turns: 3 }], fx: 'gunfire',
  }),
  stim_rush: A({
    id: 'stim_rush', name: 'Stim Rush', kind: 'skill', uses: 2, target: 'self',
    desc: 'Combat stims: heal 40% HP and raise attack.',
    effects: [{ type: 'heal', pct: 0.4 }, { type: 'buff', status: 'atk_up', turns: 3 }], fx: 'buff',
  }),
  guardian: A({
    id: 'guardian', name: 'Guardian', kind: 'skill', uses: 3, target: 'self', priority: 60,
    cry: 'Rook: “Not while I’m standing.”',
    desc: 'Rook takes single-target hits aimed at allies this round, at half damage. Blasts still hit everyone.',
    effects: [{ type: 'buff', status: 'cover', turns: 1 }, { type: 'buff', status: 'guard', turns: 1 }], fx: 'buff',
  }),
  moonfall: A({
    id: 'moonfall', name: 'Moonfall', kind: 'skill', uses: 2, target: 'enemy',
    cry: 'Rook: “Stay down.”',
    desc: 'Iaido masterstroke. Enormous damage to one enemy.',
    effects: [{ type: 'damage', stat: 'atk', mult: 3.2, critBonus: 15 }], fx: 'moonfall',
  }),

  // ------------------------------------------------------------------ HEX (deck jockey)
  spike: A({
    id: 'spike', name: 'Spike', kind: 'tech', cost: 3, target: 'enemy', element: 'cyber',
    desc: 'Attack program. Fries machines; barely tickles flesh.',
    effects: [{ type: 'damage', stat: 'mnd', power: 26 }], fx: 'code',
  }),
  scramble: A({
    id: 'scramble', name: 'Scramble', kind: 'tech', cost: 4, target: 'enemy',
    desc: 'Jam a machine for 2 turns, or glitch cyber-eyes to blind a person.',
    effects: [{ type: 'status', status: 'jammed', chance: 0.8, turns: 2, only: ['machine'] }, { type: 'status', status: 'blind', chance: 0.7, turns: 3, only: ['human'] }], fx: 'glitch',
  }),
  patch: A({
    id: 'patch', name: 'Patch', kind: 'tech', cost: 4, target: 'ally', field: true,
    desc: 'Nanite repair swarm. Restores HP to one ally.',
    effects: [{ type: 'heal', power: 32 }], fx: 'heal',
  }),
  firewall: A({
    id: 'firewall', name: 'Firewall', kind: 'tech', cost: 6, target: 'allies',
    desc: 'Defensive countermeasures. Raises party DEF and RES.',
    effects: [{ type: 'buff', status: 'def_up', turns: 3 }, { type: 'buff', status: 'res_up', turns: 3 }], fx: 'shield',
  }),
  overload: A({
    id: 'overload', name: 'Overload', kind: 'tech', cost: 8, target: 'enemies', element: 'shock',
    desc: 'Dump the grid into everything nearby. Shock damage to all.',
    effects: [{ type: 'damage', stat: 'mnd', power: 22 }], fx: 'lightning',
  }),
  hijack: A({
    id: 'hijack', name: 'Hijack', kind: 'tech', cost: 10, target: 'enemy',
    cry: 'Hex: “You work for me now.”',
    desc: 'Seize control of a machine. It fights for you for 3 turns.',
    effects: [{ type: 'status', status: 'hijacked', chance: 0.75, turns: 3, only: ['machine'] }], fx: 'glitch',
  }),
  analyze: A({
    id: 'analyze', name: 'Analyze', kind: 'skill', uses: 5, target: 'enemy', priority: 30,
    desc: 'Scan a target: reveals HP and weaknesses, and exposes it (+25% damage taken).',
    effects: [{ type: 'analyze' }, { type: 'status', status: 'exposed', chance: 1, turns: 3 }], fx: 'scan',
  }),

  // ------------------------------------------------------------------ SABLE (shaman)
  mend: A({
    id: 'mend', name: 'Mend', kind: 'tech', cost: 3, target: 'ally', field: true,
    desc: 'Spirit-healing for one ally.',
    effects: [{ type: 'heal', power: 38 }], fx: 'heal',
  }),
  firebrand: A({
    id: 'firebrand', name: 'Firebrand', kind: 'tech', cost: 4, target: 'enemy', element: 'fire',
    desc: 'Hurl spirit-fire at one enemy. May burn.',
    effects: [{ type: 'damage', stat: 'mnd', power: 28 }, { type: 'status', status: 'burn', chance: 0.35, turns: 3 }], fx: 'fire',
  }),
  purge: A({
    id: 'purge', name: 'Purge', kind: 'tech', cost: 3, target: 'ally', field: true,
    desc: 'Cleanse all ailments from one ally.',
    effects: [{ type: 'cure', statuses: 'all' }], fx: 'cleanse',
  }),
  mending_rain: A({
    id: 'mending_rain', name: 'Mending Rain', kind: 'tech', cost: 8, target: 'allies', field: true,
    desc: 'Healing rain falls on the whole crew.',
    effects: [{ type: 'heal', power: 30 }], fx: 'heal_all',
  }),
  crow_spirit: A({
    id: 'crow_spirit', name: 'Crow Spirit', kind: 'tech', cost: 9, target: 'enemies', element: 'mana',
    cry: 'Sable: “Crow. Eat.”',
    desc: 'Call Sable’s totem. Mana damage to all; may blind.',
    effects: [{ type: 'damage', stat: 'mnd', power: 26 }, { type: 'status', status: 'blind', chance: 0.3, turns: 3 }], fx: 'crow',
  }),
  rekindle: A({
    id: 'rekindle', name: 'Rekindle', kind: 'tech', cost: 12, target: 'ally_down', field: true,
    cry: 'Sable: “Not yet. Come back.”',
    desc: 'Call a fallen ally back to their body with 40% HP.',
    effects: [{ type: 'revive', pct: 0.4 }], fx: 'revive',
  }),
  wildfire: A({
    id: 'wildfire', name: 'Wildfire', kind: 'tech', cost: 14, target: 'enemies', element: 'fire',
    cry: 'Sable: “Burn, then.”',
    desc: 'A roaring spirit-blaze. Fire damage to all.',
    effects: [{ type: 'damage', stat: 'mnd', power: 40 }, { type: 'status', status: 'burn', chance: 0.25, turns: 3 }], fx: 'fire_all',
  }),
  spirit_ward: A({
    id: 'spirit_ward', name: 'Spirit Ward', kind: 'skill', uses: 2, target: 'allies',
    desc: 'Ancestral ward: raises party RES and grants regeneration.',
    effects: [{ type: 'buff', status: 'res_up', turns: 3 }, { type: 'buff', status: 'regen', turns: 3 }], fx: 'shield',
  }),

  // ------------------------------------------------------------------ COMBOS
  combo_thunder_rift: A({
    id: 'combo_thunder_rift', name: 'Thunder Rift', kind: 'combo', target: 'enemy', element: 'shock',
    desc: 'Kit blurs in, Rook cuts through the gap; the rift arcs through the pack. Stuns.',
    effects: [{ type: 'damage', stat: 'atk', mult: 3.6, critBonus: 20, splash: 0.15 }, { type: 'status', status: 'stun', chance: 0.6, turns: 1 }], fx: 'thunder_rift',
  }),
  combo_target_lock: A({
    id: 'combo_target_lock', name: 'Target Lock', kind: 'combo', target: 'enemies',
    desc: 'Hex paints every target; Rook’s smartgun does the rest.',
    effects: [{ type: 'status', status: 'exposed', chance: 1, turns: 3 }, { type: 'damage', stat: 'atk', mult: 1.25, critBonus: 60 }], fx: 'target_lock',
  }),
  combo_ghost_circuit: A({
    id: 'combo_ghost_circuit', name: 'Ghost Circuit', kind: 'combo', target: 'enemy', element: 'mana',
    desc: 'Code and ki braided together. Ignores all resistance.',
    effects: [{ type: 'damage', stat: 'mnd', power: 95, ignoreDef: true }], fx: 'ghost_circuit',
  }),
  combo_pyre_storm: A({
    id: 'combo_pyre_storm', name: 'Pyre Storm', kind: 'combo', target: 'enemies', element: 'fire',
    desc: 'Spirit-fire rides Hex’s power surge through every enemy.',
    effects: [{ type: 'damage', stat: 'mnd', power: 70 }, { type: 'status', status: 'burn', chance: 0.6, turns: 3 }], fx: 'pyre_storm',
  }),
  combo_spirit_walk: A({
    id: 'combo_spirit_walk', name: 'Spirit Walk', kind: 'combo', target: 'random_enemies', element: 'mana',
    desc: 'Kit moves with the crow’s wings. Eight mana-charged strikes.',
    effects: [{ type: 'damage', stat: 'atk', mult: 0.9, hits: 8, ignoreDef: true }], fx: 'spirit_walk',
  }),
  combo_crows_wing: A({
    id: 'combo_crows_wing', name: 'Crow’s Wing', kind: 'combo', target: 'allies', priority: 100,
    desc: 'The crow spreads its wings over the whole crew: everyone braces, and gains RES and regen.',
    effects: [{ type: 'buff', status: 'guard', turns: 1 }, { type: 'buff', status: 'res_up', turns: 3 }, { type: 'buff', status: 'regen', turns: 3 }], fx: 'crows_wing',
  }),
  combo_blackout: A({
    id: 'combo_blackout', name: 'Blackout', kind: 'combo', target: 'enemies',
    desc: 'Rook pins them down, Hex kills the lights: slows all, blinds people, jams machines.',
    effects: [
      { type: 'damage', stat: 'atk', mult: 0.6 },
      { type: 'status', status: 'agi_down', chance: 0.9, turns: 3 },
      { type: 'status', status: 'blind', chance: 0.75, turns: 3, only: ['human'] },
      { type: 'status', status: 'jammed', chance: 0.8, turns: 2, only: ['machine'] },
    ],
    fx: 'blackout',
  }),
  combo_clean_job: A({
    id: 'combo_clean_job', name: 'Clean Job', kind: 'combo', target: 'enemy', element: 'shock',
    desc: 'Hex finds the seam, Kit opens it, Rook finishes: reads the target, a huge cut, may stun.',
    effects: [{ type: 'analyze' }, { type: 'damage', stat: 'atk', mult: 4.6, critBonus: 25, splash: 0.15 }, { type: 'status', status: 'stun', chance: 0.6, turns: 1 }],
    fx: 'clean_job',
  }),
  combo_lifeline: A({
    id: 'combo_lifeline', name: 'Lifeline', kind: 'combo', target: 'allies',
    desc: 'Nanites carry the spirit’s blessing. Full heal, cleanse and regen for all.',
    effects: [{ type: 'heal', pct: 1 }, { type: 'cure', statuses: 'all' }, { type: 'buff', status: 'regen', turns: 3 }], fx: 'lifeline',
  }),

  // ------------------------------------------------------------------ ENEMY MOVES
  e_chain_whip: A({ id: 'e_chain_whip', name: 'Chain Whip', kind: 'enemy', target: 'enemy', desc: '', effects: [{ type: 'damage', stat: 'atk', mult: 1.25 }], fx: 'whip' }),
  e_slingshot: A({ id: 'e_slingshot', name: 'Slingshot', kind: 'enemy', target: 'enemy', desc: '', effects: [{ type: 'damage', stat: 'atk', mult: 1.1 }], fx: 'shot' }),
  e_molotov: A({ id: 'e_molotov', name: 'Molotov', kind: 'enemy', target: 'enemy', element: 'fire', desc: '', effects: [{ type: 'damage', stat: 'mnd', power: 6 }, { type: 'status', status: 'burn', chance: 0.4, turns: 3 }], fx: 'fire' }),
  e_gnaw: A({ id: 'e_gnaw', name: 'Gnaw', kind: 'enemy', target: 'enemy', desc: '', effects: [{ type: 'damage', stat: 'atk', mult: 1 }, { type: 'status', status: 'poison', chance: 0.25 }], fx: 'bite' }),
  e_bite: A({ id: 'e_bite', name: 'Bite', kind: 'enemy', target: 'enemy', desc: '', effects: [{ type: 'damage', stat: 'atk', mult: 1.15 }], fx: 'bite' }),
  e_howl: A({ id: 'e_howl', name: 'Howl', kind: 'enemy', target: 'allies', desc: '', effects: [{ type: 'buff', status: 'atk_up', turns: 3 }], fx: 'roar' }),
  e_taser: A({ id: 'e_taser', name: 'Taser', kind: 'enemy', target: 'enemy', element: 'shock', desc: '', effects: [{ type: 'damage', stat: 'mnd', power: 6 }, { type: 'status', status: 'stun', chance: 0.25, turns: 1 }], fx: 'zap' }),
  e_choke: A({ id: 'e_choke', name: 'Choking Smog', kind: 'enemy', target: 'enemies', desc: '', effects: [{ type: 'damage', stat: 'mnd', power: 0 }, { type: 'status', status: 'poison', chance: 0.3 }], fx: 'smog' }),
  e_wisp_flame: A({ id: 'e_wisp_flame', name: 'Wisp Flame', kind: 'enemy', target: 'enemy', element: 'fire', desc: '', effects: [{ type: 'damage', stat: 'mnd', power: 6 }], fx: 'fire' }),
  e_haymaker: A({ id: 'e_haymaker', name: 'Haymaker', kind: 'enemy', target: 'enemy', desc: '', cry: 'Lights out!', effects: [{ type: 'damage', stat: 'atk', mult: 1.9 }, { type: 'status', status: 'stun', chance: 0.2, turns: 1 }], fx: 'punch' }),
  e_rally: A({ id: 'e_rally', name: 'Rally', kind: 'enemy', target: 'allies', desc: '', cry: 'Rustfangs, BITE!', effects: [{ type: 'buff', status: 'atk_up', turns: 3 }], fx: 'roar' }),
  e_pipe_bomb: A({ id: 'e_pipe_bomb', name: 'Pipe Bomb', kind: 'enemy', target: 'enemies', element: 'fire', desc: '', effects: [{ type: 'damage', stat: 'mnd', power: 8 }], fx: 'explosion' }),
  e_claw: A({ id: 'e_claw', name: 'Claw', kind: 'enemy', target: 'enemy', desc: '', effects: [{ type: 'damage', stat: 'atk', mult: 1.1 }], fx: 'claw' }),
  e_rot_bite: A({ id: 'e_rot_bite', name: 'Rotten Bite', kind: 'enemy', target: 'enemy', desc: '', effects: [{ type: 'damage', stat: 'atk', mult: 1 }, { type: 'status', status: 'poison', chance: 0.45 }], fx: 'bite' }),
  e_pincer: A({ id: 'e_pincer', name: 'Pincer', kind: 'enemy', target: 'enemy', desc: '', effects: [{ type: 'damage', stat: 'atk', mult: 1.3 }], fx: 'claw' }),
  e_shell_wall: A({ id: 'e_shell_wall', name: 'Shell Wall', kind: 'enemy', target: 'self', desc: '', effects: [{ type: 'buff', status: 'cover', turns: 2 }, { type: 'buff', status: 'def_up', turns: 3 }], fx: 'shield' }),
  e_harden: A({ id: 'e_harden', name: 'Harden Shell', kind: 'enemy', target: 'self', desc: '', effects: [{ type: 'buff', status: 'def_up', turns: 3 }], fx: 'shield' }),
  e_welder: A({ id: 'e_welder', name: 'Arc Welder', kind: 'enemy', target: 'enemy', element: 'fire', desc: '', effects: [{ type: 'damage', stat: 'mnd', power: 10 }, { type: 'status', status: 'burn', chance: 0.3, turns: 3 }], fx: 'zap' }),
  e_stim: A({ id: 'e_stim', name: 'Combat Stim', kind: 'enemy', target: 'ally', desc: '', cry: 'Hold still, you idiot!', effects: [{ type: 'heal', power: 26 }], fx: 'heal' }),
  e_repair: A({ id: 'e_repair', name: 'Repair Protocol', kind: 'enemy', target: 'ally', desc: '', effects: [{ type: 'heal', power: 30 }], fx: 'heal' }),
  e_chill: A({ id: 'e_chill', name: 'Chill Touch', kind: 'enemy', target: 'enemy', element: 'mana', desc: '', effects: [{ type: 'damage', stat: 'mnd', power: 10, drain: 0.5 }], fx: 'dark' }),
  e_wail: A({ id: 'e_wail', name: 'Drowned Wail', kind: 'enemy', target: 'enemies', element: 'mana', desc: '', effects: [{ type: 'damage', stat: 'mnd', power: 4 }, { type: 'status', status: 'blind', chance: 0.3, turns: 3 }], fx: 'wail' }),
  e_coil_shock: A({ id: 'e_coil_shock', name: 'Coil Shock', kind: 'enemy', target: 'enemy', element: 'shock', desc: '', effects: [{ type: 'damage', stat: 'mnd', power: 8 }, { type: 'status', status: 'stun', chance: 0.2, turns: 1 }], fx: 'zap' }),
  e_crush_coil: A({ id: 'e_crush_coil', name: 'Crushing Coil', kind: 'enemy', target: 'enemy', desc: '', cry: 'The water heaves…', effects: [{ type: 'damage', stat: 'atk', mult: 1.8 }, { type: 'status', status: 'stun', chance: 0.35, turns: 1 }], fx: 'crush' }),
  e_tidal: A({ id: 'e_tidal', name: 'Tidal Surge', kind: 'enemy', target: 'enemies', desc: '', effects: [{ type: 'damage', stat: 'atk', mult: 0.85 }], fx: 'wave' }),
  e_biolume: A({ id: 'e_biolume', name: 'Bioluminescence', kind: 'enemy', target: 'enemies', desc: '', effects: [{ type: 'status', status: 'blind', chance: 0.55, turns: 3 }], fx: 'flash' }),
  e_burst: A({ id: 'e_burst', name: 'Burst Fire', kind: 'enemy', target: 'random_enemies', desc: '', effects: [{ type: 'damage', stat: 'atk', mult: 0.7, hits: 2 }], fx: 'gunfire' }),
  e_flashbang: A({ id: 'e_flashbang', name: 'Flashbang', kind: 'enemy', target: 'enemies', desc: '', effects: [{ type: 'status', status: 'blind', chance: 0.45, turns: 2 }, { type: 'status', status: 'stun', chance: 0.12, turns: 1 }], fx: 'flash' }),
  e_full_auto: A({ id: 'e_full_auto', name: 'Full Auto', kind: 'enemy', telegraphed: true, target: 'enemies', desc: '', cry: 'TARGETS ACQUIRED.', effects: [{ type: 'damage', stat: 'atk', mult: 1.9 }], fx: 'gunfire' }),
  e_mana_storm: A({ id: 'e_mana_storm', name: 'Mana Surge', kind: 'enemy', telegraphed: true, target: 'enemies', element: 'mana', desc: '', effects: [{ type: 'damage', stat: 'mnd', power: 44 }, { type: 'status', status: 'atk_down', chance: 0.4, turns: 2 }], fx: 'wave' }),
  e_volley: A({ id: 'e_volley', name: 'Volley', kind: 'enemy', target: 'enemies', desc: '', effects: [{ type: 'damage', stat: 'atk', mult: 0.7 }], fx: 'gunfire' }),
  e_mana_bolt: A({ id: 'e_mana_bolt', name: 'Mana Bolt', kind: 'enemy', target: 'enemy', element: 'mana', desc: '', effects: [{ type: 'damage', stat: 'mnd', power: 20 }], fx: 'bolt' }),
  e_barrier: A({ id: 'e_barrier', name: 'Barrier', kind: 'enemy', target: 'allies', desc: '', effects: [{ type: 'buff', status: 'res_up', turns: 3 }, { type: 'buff', status: 'def_up', turns: 3 }], fx: 'shield' }),
  e_drain: A({ id: 'e_drain', name: 'Spark Drain', kind: 'enemy', target: 'enemy', element: 'mana', desc: '', effects: [{ type: 'damage', stat: 'mnd', power: 20, drain: 1 }], fx: 'dark' }),
  e_lockon: A({ id: 'e_lockon', name: 'Target Acquired', kind: 'enemy', target: 'enemy', desc: '', effects: [{ type: 'status', status: 'lockon', chance: 1, turns: 2 }], fx: 'scan' }),
  e_missile: A({ id: 'e_missile', name: 'Micro-Missile', kind: 'enemy', target: 'enemy', element: 'fire', desc: '', effects: [{ type: 'damage', stat: 'atk', mult: 2.1 }], fx: 'explosion' }),
  e_anguish: A({ id: 'e_anguish', name: 'Anguish', kind: 'enemy', target: 'enemies', element: 'mana', desc: '', effects: [{ type: 'damage', stat: 'mnd', power: 18 }], fx: 'wail' }),
  e_pulse_cannon: A({ id: 'e_pulse_cannon', name: 'Pulse Cannon', kind: 'enemy', telegraphed: true, target: 'enemy', element: 'shock', desc: '', cry: 'CHARGING…', effects: [{ type: 'damage', stat: 'mnd', power: 105 }], fx: 'beam' }),
  e_suppression: A({ id: 'e_suppression', name: 'Suppression Grid', kind: 'enemy', target: 'enemies', desc: '', effects: [{ type: 'damage', stat: 'atk', mult: 0.8 }, { type: 'status', status: 'agi_down', chance: 0.4, turns: 3 }], fx: 'gunfire' }),
  e_deploy: A({ id: 'e_deploy', name: 'Deploy Drones', kind: 'enemy', target: 'none', desc: '', cry: 'DEPLOYING SUPPORT UNITS', effects: [{ type: 'summon', enemies: ['hunter_drone'], max: 2 }], fx: 'summon' }),
  e_soul_scream: A({ id: 'e_soul_scream', name: 'Soul Scream', kind: 'enemy', telegraphed: true, target: 'enemies', element: 'mana', desc: '', cry: 'LET ME GO!', effects: [{ type: 'damage', stat: 'mnd', power: 36 }, { type: 'status', status: 'blind', chance: 0.3, turns: 2 }], fx: 'wail' }),
  e_grasp: A({ id: 'e_grasp', name: 'Grasp of the Bound', kind: 'enemy', target: 'enemy', element: 'mana', desc: '', effects: [{ type: 'damage', stat: 'mnd', power: 24 }, { type: 'status', status: 'stun', chance: 0.35, turns: 1 }], fx: 'dark' }),
  e_siphon: A({ id: 'e_siphon', name: 'Siphon', kind: 'enemy', target: 'enemy', element: 'mana', desc: '', effects: [{ type: 'damage', stat: 'mnd', power: 18, drain: 1 }], fx: 'dark' }),
  e_spark_swarm: A({ id: 'e_spark_swarm', name: 'Spark Swarm', kind: 'enemy', target: 'enemies', element: 'shock', desc: '', effects: [{ type: 'damage', stat: 'mnd', power: 12 }], fx: 'lightning' }),
};

export interface Learn {
  level: number;
  id: string;
}

/** Abilities learned per member by level. */
export const LEARNSETS: Record<string, Learn[]> = {
  kit: [
    { level: 1, id: 'flash_step' },
    { level: 1, id: 'second_wind' },
    { level: 2, id: 'iron_palm' },
    { level: 5, id: 'focus_breath' },
    { level: 7, id: 'killing_intent' },
    { level: 8, id: 'hundred_rain' },
    { level: 12, id: 'dragon_coil' },
  ],
  rook: [
    { level: 1, id: 'arc_cut' },
    { level: 1, id: 'quickdraw' },
    { level: 2, id: 'incendiary' },
    { level: 4, id: 'suppress' },
    { level: 5, id: 'stim_rush' },
    { level: 7, id: 'guardian' },
    { level: 10, id: 'moonfall' },
  ],
  hex: [
    { level: 1, id: 'spike' },
    { level: 1, id: 'analyze' },
    { level: 2, id: 'scramble' },
    { level: 3, id: 'patch' },
    { level: 5, id: 'firewall' },
    { level: 6, id: 'overload' },
    { level: 10, id: 'hijack' },
  ],
  sable: [
    { level: 1, id: 'mend' },
    { level: 1, id: 'firebrand' },
    { level: 3, id: 'purge' },
    { level: 5, id: 'mending_rain' },
    { level: 6, id: 'spirit_ward' },
    { level: 7, id: 'crow_spirit' },
    { level: 9, id: 'rekindle' },
    { level: 11, id: 'wildfire' },
  ],
};

export interface ComboDef {
  id: string;
  /** Two or three (member, ability) pairs, order-independent; each member at most once. */
  parts: { member: string; ability: string }[];
  hint: string;
  /** Who calls it, and what they say (on the combo's cut-in). */
  call: { member: string; line: string };
}

export const COMBOS: ComboDef[] = [
  {
    id: 'combo_thunder_rift',
    parts: [{ member: 'kit', ability: 'flash_step' }, { member: 'rook', ability: 'arc_cut' }],
    hint: 'Old runners say Rook’s crew had a move: one blurs in, the blade follows.',
    call: { member: 'kit', line: 'Rook, now! Through the gap!' },
  },
  {
    id: 'combo_target_lock',
    parts: [{ member: 'hex', ability: 'analyze' }, { member: 'rook', ability: 'quickdraw' }],
    hint: 'A smartgun fed live target data never misses.',
    call: { member: 'hex', line: 'Painted. All yours, old man.' },
  },
  {
    id: 'combo_ghost_circuit',
    parts: [{ member: 'hex', ability: 'spike' }, { member: 'kit', ability: 'iron_palm' }],
    hint: 'Code and ki, striking the same point at once.',
    call: { member: 'kit', line: 'Same spot, Hex. On three.' },
  },
  {
    id: 'combo_pyre_storm',
    parts: [{ member: 'sable', ability: 'firebrand' }, { member: 'hex', ability: 'overload' }],
    hint: 'Spirit-fire, carried on a power surge.',
    call: { member: 'sable', line: 'Give me your current, Hex.' },
  },
  {
    id: 'combo_spirit_walk',
    parts: [{ member: 'sable', ability: 'crow_spirit' }, { member: 'kit', ability: 'hundred_rain' }],
    hint: 'When the crow flies, the fists follow.',
    call: { member: 'sable', line: 'Run with the crow, Kit.' },
  },
  {
    id: 'combo_crows_wing',
    parts: [{ member: 'rook', ability: 'guardian' }, { member: 'sable', ability: 'spirit_ward' }],
    hint: 'The old soldier plants his feet; the crow spreads its wings over him.',
    call: { member: 'rook', line: 'Everybody behind me.' },
  },
  {
    id: 'combo_lifeline',
    parts: [{ member: 'sable', ability: 'mending_rain' }, { member: 'hex', ability: 'patch' }],
    hint: 'Nanites and spirits, mending together.',
    call: { member: 'hex', line: 'Nanites up. Sable, bless them.' },
  },
  {
    id: 'combo_blackout',
    parts: [{ member: 'rook', ability: 'suppress' }, { member: 'hex', ability: 'scramble' }],
    hint: 'Pin them down, then take their eyes: a street crew’s oldest trick.',
    call: { member: 'rook', line: 'Heads down. Hex, lights.' },
  },
  {
    // The crew's old signature, from before Hex's code met Kit's fists: three of them, one job.
    id: 'combo_clean_job',
    // Kit first: the lead part's striker sets the blow's accuracy and crit, as in Thunder Rift.
    parts: [{ member: 'kit', ability: 'flash_step' }, { member: 'rook', ability: 'arc_cut' }, { member: 'hex', ability: 'analyze' }],
    hint: 'Rook’s old crew ran it three-handed: one finds the seam, one opens it, one finishes.',
    call: { member: 'rook', line: 'Like the old days. Clean.' },
  },
];
