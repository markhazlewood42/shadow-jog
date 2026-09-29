/** Items: consumables, equipment, key items and sellable loot. */
import type { Effect, Element, StatusId, TargetKind } from '../battle/types';
import type { EquipSlot, MemberId } from '../game/state';

export type ItemKind = 'use' | 'weapon' | 'body' | 'head' | 'mod' | 'key' | 'loot';

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  desc: string;
  /** Buy price (sell = 50%). 0 = can't be sold. */
  price: number;
  // Consumables
  target?: TargetKind;
  effects?: Effect[];
  battle?: boolean;
  field?: boolean;
  fx?: string;
  /** Special field effects. */
  special?: 'getaway' | 'cab' | 'party_heal';
  // Equipment
  slot?: EquipSlot;
  who?: MemberId[];
  atk?: number;
  def?: number;
  mnd?: number;
  res?: number;
  agi?: number;
  hp?: number;
  tp?: number;
  crit?: number;
  hit?: number;
  element?: Element;
  immune?: StatusId[];
  /** Regen % of max HP per round in battle. */
  regen?: number;
}

const I = (d: ItemDef) => d;
const ALL: MemberId[] = ['kit', 'rook', 'hex', 'sable'];

export const ITEMS: Record<string, ItemDef> = {
  // ------------------------------------------------------------------ consumables
  medkit: I({ id: 'medkit', name: 'Medkit', kind: 'use', price: 20, desc: 'Restores 60 HP.', target: 'ally', effects: [{ type: 'heal', power: 60 }], battle: true, field: true, fx: 'heal' }),
  trauma_patch: I({ id: 'trauma_patch', name: 'Trauma Patch', kind: 'use', price: 65, desc: 'Restores 180 HP.', target: 'ally', effects: [{ type: 'heal', power: 180 }], battle: true, field: true, fx: 'heal' }),
  neurotab: I({ id: 'neurotab', name: 'Neurotab', kind: 'use', price: 45, desc: 'Restores 20 TP.', target: 'ally', effects: [{ type: 'tp', amount: 20 }], battle: true, field: true, fx: 'tp' }),
  adrenal_stim: I({ id: 'adrenal_stim', name: 'Adrenal Stim', kind: 'use', price: 120, desc: 'Revives a downed ally with 30% HP.', target: 'ally_down', effects: [{ type: 'revive', pct: 0.3 }], battle: true, field: true, fx: 'revive' }),
  detox: I({ id: 'detox', name: 'Detox Shot', kind: 'use', price: 12, desc: 'Cures poison.', target: 'ally', effects: [{ type: 'cure', statuses: ['poison'] }], battle: true, field: true, fx: 'cleanse' }),
  optic_flush: I({ id: 'optic_flush', name: 'Optic Flush', kind: 'use', price: 12, desc: 'Cures blindness.', target: 'ally', effects: [{ type: 'cure', statuses: ['blind'] }], battle: true, field: true, fx: 'cleanse' }),
  omni_patch: I({ id: 'omni_patch', name: 'Omni-Patch', kind: 'use', price: 55, desc: 'Cures all ailments.', target: 'ally', effects: [{ type: 'cure', statuses: 'all' }], battle: true, field: true, fx: 'cleanse' }),
  smoke_pellet: I({ id: 'smoke_pellet', name: 'Smoke Pellet', kind: 'use', price: 30, desc: 'Escape from any normal battle.', target: 'none', effects: [{ type: 'escape' }], battle: true, fx: 'smoke' }),
  flashbang: I({ id: 'flashbang', name: 'Flashbang', kind: 'use', price: 40, desc: 'May stun and blind all enemies.', target: 'enemies', effects: [{ type: 'status', status: 'stun', chance: 0.5, turns: 1 }, { type: 'status', status: 'blind', chance: 0.5, turns: 2 }], battle: true, fx: 'flash' }),
  frag: I({ id: 'frag', name: 'Frag Grenade', kind: 'use', price: 55, desc: 'Deals 45 damage to all enemies.', target: 'enemies', element: 'fire', effects: [{ type: 'damage', stat: 'mnd', power: 45, ignoreDef: true }], battle: true, fx: 'explosion' }),
  noodles: I({ id: 'noodles', name: 'Ono’s Noodles', kind: 'use', price: 45, desc: 'Hot, spicy, restorative. Heals 35 HP to the whole party.', target: 'allies', effects: [{ type: 'heal', power: 35 }], battle: true, field: true, fx: 'heal_all' }),
  toxin_dart: I({ id: 'toxin_dart', name: 'Toxin Dart', kind: 'use', price: 30, desc: 'A coated dart. Likely poisons a living target (not machines, spirits or ghouls).', target: 'enemy', effects: [{ type: 'status', status: 'poison', chance: 0.85 }], battle: true, fx: 'shot' }),
  getaway_chit: I({ id: 'getaway_chit', name: 'Getaway Chit', kind: 'use', price: 80, desc: 'A prepaid exit route. Leave a dungeon instantly.', target: 'none', field: true, special: 'getaway' }),
  cab_voucher: I({ id: 'cab_voucher', name: 'Cab Voucher', kind: 'use', price: 110, desc: 'Autocab back to the last town you visited.', target: 'none', field: true, special: 'cab' }),

  // ------------------------------------------------------------------ weapons
  wraps: I({ id: 'wraps', name: 'Hand Wraps', kind: 'weapon', slot: 'weapon', who: ['kit'], price: 20, atk: 4, desc: 'Taped knuckles. Better than nothing.' }),
  iron_knuckles: I({ id: 'iron_knuckles', name: 'Iron Knuckles', kind: 'weapon', slot: 'weapon', who: ['kit'], price: 120, atk: 9, desc: 'Weighted brass for heavier hits.' }),
  shock_knuckles: I({ id: 'shock_knuckles', name: 'Shock Knuckles', kind: 'weapon', slot: 'weapon', who: ['kit'], price: 380, atk: 14, element: 'shock', desc: 'Capacitor gloves. Attacks deal SHOCK damage.' }),
  mono_claws: I({ id: 'mono_claws', name: 'Monowire Claws', kind: 'weapon', slot: 'weapon', who: ['kit'], price: 760, atk: 21, crit: 8, desc: 'Retractable wire claws. +8% critical.' }),
  dragon_fang: I({ id: 'dragon_fang', name: 'Dragon Fang', kind: 'weapon', slot: 'weapon', who: ['kit'], price: 1100, atk: 27, mnd: 6, desc: 'A talisman gauntlet humming with ki. +6 MND.' }),
  // The Annex's requisition stock: same tier as the armory's finds, built the other way, so a
  // crew that skipped a case can still arm up, and one that found it still has a choice to make.
  arc_gauntlets: I({ id: 'arc_gauntlets', name: 'Arc Gauntlets', kind: 'weapon', slot: 'weapon', who: ['kit'], price: 1050, atk: 21, agi: 3, element: 'shock', desc: 'K-M riot gauntlets. Attacks deal SHOCK damage. +3 AGI. Less ki than the Dragon Fang, more bite on chrome.' }),
  thermal_katana: I({ id: 'thermal_katana', name: 'Thermal Katana', kind: 'weapon', slot: 'weapon', who: ['rook'], price: 1100, atk: 23, element: 'fire', desc: 'A heat-edged security blade. Attacks deal FIRE damage, which spirits can’t shrug off the way they do steel.' }),
  burst_smg: I({ id: 'burst_smg', name: 'Burst SMG', kind: 'weapon', slot: 'weapon', who: ['hex'], price: 880, atk: 15, crit: 14, desc: 'A machine pistol locked to three-round bursts. +14% critical; wilder than the Smartpistol.' }),
  ward_staff: I({ id: 'ward_staff', name: 'Ward Staff', kind: 'weapon', slot: 'weapon', who: ['sable'], price: 880, atk: 9, mnd: 7, res: 8, desc: 'A containment officer’s ward-staff. +7 MND, +8 RES: a shield first, a focus second.' }),
  razor_tekko: I({ id: 'razor_tekko', name: 'Razor Tekko', kind: 'weapon', slot: 'weapon', who: ['kit'], price: 380, atk: 12, crit: 12, desc: 'Bladed knuckle-dusters. Lighter than Shock Knuckles, but +12% critical.' }),
  old_katana: I({ id: 'old_katana', name: 'Old Katana', kind: 'weapon', slot: 'weapon', who: ['rook'], price: 40, atk: 10, desc: 'Rook’s blade. Nicked, never dull.' }),
  vibro_katana: I({ id: 'vibro_katana', name: 'Vibro-Katana', kind: 'weapon', slot: 'weapon', who: ['rook'], price: 420, atk: 17, desc: 'Ultrasonic edge.' }),
  nodachi: I({ id: 'nodachi', name: 'Nodachi', kind: 'weapon', slot: 'weapon', who: ['rook'], price: 480, atk: 19, crit: 10, agi: -2, desc: 'A two-meter field sword. Slower than a katana, but its reach finds gaps: +10% critical, -2 AGI.' }),
  mono_katana: I({ id: 'mono_katana', name: 'Mono-Katana', kind: 'weapon', slot: 'weapon', who: ['rook'], price: 1150, atk: 25, crit: 5, desc: 'Monomolecular edge. Cuts steel. +5% critical.' }),
  holdout: I({ id: 'holdout', name: 'Hold-out Pistol', kind: 'weapon', slot: 'weapon', who: ['hex'], price: 30, atk: 5, desc: 'Fits in a boot. Barely a gun.' }),
  // Hex's same-tier choice: the heavy pistol hits harder; needles hit less but crit far more.
  flechette_pistol: I({ id: 'flechette_pistol', name: 'Flechette Pistol', kind: 'weapon', slot: 'weapon', who: ['hex'], price: 210, atk: 8, crit: 12, desc: 'Needle rounds. Lighter hits, far more of them land critical. +12% critical.' }),
  heavy_pistol: I({ id: 'heavy_pistol', name: 'Heavy Pistol', kind: 'weapon', slot: 'weapon', who: ['hex'], price: 200, atk: 11, desc: 'Solid stopping power.' }),
  taser_pistol: I({ id: 'taser_pistol', name: 'Taser Pistol', kind: 'weapon', slot: 'weapon', who: ['hex'], price: 400, atk: 12, element: 'shock', desc: 'Attacks deal SHOCK damage. Great on drones and chromed gangers.' }),
  smartpistol: I({ id: 'smartpistol', name: 'Smartpistol', kind: 'weapon', slot: 'weapon', who: ['hex'], price: 900, atk: 17, hit: 10, desc: 'Linked to Hex’s deck. +10% hit.' }),
  ash_staff: I({ id: 'ash_staff', name: 'Ash Staff', kind: 'weapon', slot: 'weapon', who: ['sable'], price: 40, atk: 6, mnd: 2, desc: 'Carved ash wood. +2 MND.' }),
  bone_staff: I({ id: 'bone_staff', name: 'Bone Fetish Staff', kind: 'weapon', slot: 'weapon', who: ['sable'], price: 420, atk: 10, mnd: 6, desc: 'Strung with charms. +6 MND.' }),
  thorn_rod: I({ id: 'thorn_rod', name: 'Thorn Rod', kind: 'weapon', slot: 'weapon', who: ['sable'], price: 440, atk: 12, mnd: 3, element: 'fire', desc: 'Spirit-hardened thornwood. +3 MND; attacks deal FIRE damage.' }),
  focus_rod: I({ id: 'focus_rod', name: 'K-M Focus Rod', kind: 'weapon', slot: 'weapon', who: ['sable'], price: 900, atk: 11, mnd: 9, res: 3, desc: 'The lab’s own spark-extraction focus, turned around. +9 MND, +3 RES. Found, never sold.' }),
  crow_staff: I({ id: 'crow_staff', name: 'Crow Staff', kind: 'weapon', slot: 'weapon', who: ['sable'], price: 0, atk: 14, mnd: 10, desc: 'Black feathers, black iron. +10 MND.' }),

  // ------------------------------------------------------------------ body
  street_clothes: I({ id: 'street_clothes', name: 'Street Clothes', kind: 'body', slot: 'body', who: ALL, price: 20, def: 2, desc: 'Whatever was clean.' }),
  armored_jacket: I({ id: 'armored_jacket', name: 'Armored Jacket', kind: 'body', slot: 'body', who: ALL, price: 100, def: 6, desc: 'Kevlar-lined synthleather.' }),
  lined_coat: I({ id: 'lined_coat', name: 'Lined Coat', kind: 'body', slot: 'body', who: ALL, price: 260, def: 10, res: 2, desc: 'Long coat with ballistic lining. +2 RES.' }),
  ballistic_vest: I({ id: 'ballistic_vest', name: 'Ballistic Vest', kind: 'body', slot: 'body', who: ['kit', 'rook'], price: 520, def: 15, agi: -1, desc: 'Heavy plates. -1 AGI.' }),
  spirit_robe: I({ id: 'spirit_robe', name: 'Spirit Robe', kind: 'body', slot: 'body', who: ['sable', 'hex'], price: 520, def: 11, res: 8, desc: 'Warded weave. +8 RES.' }),
  formfit: I({ id: 'formfit', name: 'Form-Fit Armor', kind: 'body', slot: 'body', who: ALL, price: 980, def: 18, agi: 1, desc: 'Corporate-grade underarmor. +1 AGI.' }),

  // ------------------------------------------------------------------ head
  bandana: I({ id: 'bandana', name: 'Bandana', kind: 'head', slot: 'head', who: ALL, price: 15, def: 1, desc: 'Keeps the rain out of your eyes.' }),
  helmet: I({ id: 'helmet', name: 'Riot Helmet', kind: 'head', slot: 'head', who: ['kit', 'rook'], price: 150, def: 5, agi: -1, desc: 'Scuffed police surplus. -1 AGI.' }),
  tac_visor: I({ id: 'tac_visor', name: 'Tactical Visor', kind: 'head', slot: 'head', who: ALL, price: 280, def: 3, hit: 12, desc: 'Targeting overlay. +3 DEF, +12% hit.' }),
  // One headpiece per crew member, like the character mods: a sidegrade in their own style.
  sparring_band: I({ id: 'sparring_band', name: 'Sparring Band', kind: 'head', slot: 'head', who: ['kit'], price: 300, def: 1, agi: 3, crit: 4, desc: 'Red cloth, knotted twice at the back. +3 AGI, +4% critical.' }),
  mempo: I({ id: 'mempo', name: 'Iron Mempo', kind: 'head', slot: 'head', who: ['rook'], price: 320, def: 4, hit: 6, desc: 'A lacquered half-mask from a war nobody remembers. +4 DEF, +6% hit.' }),
  trode_net: I({ id: 'trode_net', name: 'Trode Net', kind: 'head', slot: 'head', who: ['hex'], price: 320, mnd: 5, tp: 3, def: -1, desc: 'Electrodes woven into a hairnet: faster than a jack. +5 MND, +3 RAM, -1 DEF.' }),
  feather_circlet: I({ id: 'feather_circlet', name: 'Feather Circlet', kind: 'head', slot: 'head', who: ['sable'], price: 360, mnd: 3, res: 4, immune: ['blind'], desc: 'Crow feathers on braided copper; the crow keeps watch. +3 MND, +4 RES, immune to blindness.' }),
  spirit_band: I({ id: 'spirit_band', name: 'Spirit Band', kind: 'head', slot: 'head', who: ['kit', 'sable'], price: 340, def: 2, mnd: 4, res: 3, desc: '+4 MND, +3 RES.' }),

  // ------------------------------------------------------------------ mods (accessories)
  reflex_booster: I({ id: 'reflex_booster', name: 'Reflex Booster', kind: 'mod', slot: 'mod', who: ALL, price: 380, agi: 6, desc: 'Wired reflexes. +6 AGI.' }),
  dermal_plating: I({ id: 'dermal_plating', name: 'Dermal Plating', kind: 'mod', slot: 'mod', who: ALL, price: 340, def: 6, desc: 'Subdermal armor. +6 DEF.' }),
  // Rook has no TP to buffer: the shop shows him as unable to wear it rather than let it go to waste.
  neural_buffer: I({ id: 'neural_buffer', name: 'Neural Buffer', kind: 'mod', slot: 'mod', who: ['kit', 'hex', 'sable'], price: 360, mnd: 4, tp: 8, desc: '+4 MND, +8 max TP (not for Rook: no TP to buffer).' }),
  lucky_coin: I({ id: 'lucky_coin', name: 'Lucky Coin', kind: 'mod', slot: 'mod', who: ALL, price: 250, crit: 10, desc: 'A Kowloon-era coin. +10% critical.' }),
  // Chest-only finds: not sold anywhere, so exploring pays off in something a shop can't give.
  // The lab's own kit, sold at Requisition: the endgame's cred sink (a player who kept their
  // money has something worth buying before the last fight).
  km_lace: I({ id: 'km_lace', name: 'K-M Neural Lace', kind: 'mod', slot: 'mod', who: ALL, price: 1200, agi: 5, mnd: 5, crit: 5, desc: 'Lab-grade wetware. +5 AGI, +5 MND, +5% critical.' }),
  grounding_coil: I({ id: 'grounding_coil', name: 'Grounding Coil', kind: 'mod', slot: 'mod', who: ALL, price: 460, def: 4, immune: ['stun'], desc: 'Salvaged surge sink. +4 DEF. Immune to stun.' }),
  ghost_lens: I({ id: 'ghost_lens', name: 'Ghost Lens', kind: 'mod', slot: 'mod', who: ALL, price: 420, res: 6, mnd: 3, desc: 'A cracked monocle that sees a little too much. +6 RES, +3 MND.' }),
  adrenal_pump: I({ id: 'adrenal_pump', name: 'Adrenal Pump', kind: 'mod', slot: 'mod', who: ALL, price: 620, regen: 4, desc: 'Regenerate 4% HP each round.' }),
  spirit_fetish: I({ id: 'spirit_fetish', name: 'Spirit Fetish', kind: 'mod', slot: 'mod', who: ALL, price: 300, res: 7, immune: ['poison'], desc: '+7 RES. Immune to poison.' }),
  flood_charm: I({ id: 'flood_charm', name: 'Flood Charm', kind: 'mod', slot: 'mod', who: ALL, price: 0, res: 5, immune: ['poison'], desc: 'A ’61 transit pass on a chain, kept by someone who didn’t get out. +5 RES, immune to poison.' }),
  proto_chip: I({ id: 'proto_chip', name: 'Prototype Chip', kind: 'mod', slot: 'mod', who: ALL, price: 0, agi: 4, crit: 8, desc: 'Unreleased K-M reflex coprocessor, pocketed by a man who knew what was coming. +4 AGI, +8% critical.' }),
  // One mod per crew member that only they can wear, priced against the general ones: each trades
  // something for their own style, so the mod slot is a per-character choice, not a shopping list.
  ki_beads: I({ id: 'ki_beads', name: 'Ki Beads', kind: 'mod', slot: 'mod', who: ['kit'], price: 360, mnd: 6, agi: 2, def: -2, desc: 'Prayer beads wound round the wrist. +6 MND, +2 AGI for Ki Arts; -2 DEF, nothing between you and the hit.' }),
  ronin_guard: I({ id: 'ronin_guard', name: 'Ronin Guard', kind: 'mod', slot: 'mod', who: ['rook'], price: 380, def: 5, res: 3, agi: -2, desc: 'An old bracer plate and a vow. +5 DEF, +3 RES for the one who stands in front; -2 AGI.' }),
  coolant_rig: I({ id: 'coolant_rig', name: 'Coolant Rig', kind: 'mod', slot: 'mod', who: ['hex'], price: 360, mnd: 7, tp: 4, def: -3, desc: 'Liquid-cooled deck. +7 MND, +4 RAM: hotter programs, fragile jockey. -3 DEF.' }),
  crow_torc: I({ id: 'crow_torc', name: 'Crow Torc', kind: 'mod', slot: 'mod', who: ['sable'], price: 360, res: 5, mnd: 5, agi: -1, desc: 'Copper torc hung with crow feathers. +5 RES, +5 MND: the spirits listen. -1 AGI.' }),
  cyber_eye: I({ id: 'cyber_eye', name: 'Cyber Eye', kind: 'mod', slot: 'mod', who: ALL, price: 320, crit: 6, immune: ['blind'], desc: 'Flare-damped optics. Immune to blindness, +6% critical.' }),

  // ------------------------------------------------------------------ key items
  coprocessor: I({ id: 'coprocessor', name: 'Stingray Coprocessor', kind: 'key', price: 0, desc: 'A jockey-grade coprocessor, still in anti-static wrap. For Hex.' }),
  maint_key: I({ id: 'maint_key', name: 'Maintenance Keycard', kind: 'key', price: 0, desc: 'Transit authority card. Opens Sinkline service gates.' }),
  annex_key: I({ id: 'annex_key', name: 'Annex Passkey', kind: 'key', price: 0, desc: 'Kessler-Mori security passkey, lifted from a guard.' }),
  med_case: I({ id: 'med_case', name: 'Doc Yun’s Med-Case', kind: 'key', price: 0, desc: 'A battered surgical case stamped YUN. Somebody at the clinic wants this back.' }),
  pale_chip: I({ id: 'pale_chip', name: 'Job Chip', kind: 'key', price: 0, desc: 'Mr. Pale’s job details. Target: data core, K-M Annex 7, under the Sinkline.' }),

  // ------------------------------------------------------------------ loot (sell only)
  rat_tail: I({ id: 'rat_tail', name: 'Glowrat Tail', kind: 'loot', price: 12, desc: 'Still faintly glowing. Alchemists buy these.' }),
  scrap_chip: I({ id: 'scrap_chip', name: 'Scrap Chip', kind: 'loot', price: 30, desc: 'Salvaged circuitry.' }),
  gang_colors: I({ id: 'gang_colors', name: 'Rustfang Colors', kind: 'loot', price: 20, desc: 'A torn gang jacket patch.' }),
  ghoul_tooth: I({ id: 'ghoul_tooth', name: 'Ghoul Tooth', kind: 'loot', price: 40, desc: 'Grim, but talismans need them.' }),
  crab_shell: I({ id: 'crab_shell', name: 'Rust Crab Shell', kind: 'loot', price: 50, desc: 'Mineral-laced carapace.' }),
  drone_optic: I({ id: 'drone_optic', name: 'Drone Optic', kind: 'loot', price: 70, desc: 'High-grade camera module.' }),
  ecto_vial: I({ id: 'ecto_vial', name: 'Ectoplasm Vial', kind: 'loot', price: 80, desc: 'Captured spirit residue. Cold to touch.' }),
  km_badge: I({ id: 'km_badge', name: 'K-M ID Badge', kind: 'loot', price: 110, desc: 'Fences love corporate IDs.' }),
  mana_crystal: I({ id: 'mana_crystal', name: 'Mana Crystal', kind: 'loot', price: 160, desc: 'Solidified magic. Worth a fortune in the right shop.' }),
};

export function item(id: string): ItemDef {
  const d = ITEMS[id];
  if (!d) throw new Error(`Unknown item ${id}`);
  return d;
}

export function sellPrice(id: string): number {
  const d = ITEMS[id];
  if (!d || d.kind === 'key') return 0;
  if (d.kind === 'loot') return d.price;
  return Math.floor(d.price / 2);
}
