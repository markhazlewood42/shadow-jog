/** Battle presentation tables and small pure helpers: status labels, elements, poses, sounds, encounter picks. */
import type { Pose } from '../../art/battlers';
import type { Ability, Combatant, StatusId } from '../../battle/types';
import { ENCOUNTERS } from '../../data/enemies';
import { streams } from '../../engine/rng';

export const STATUS_LABEL: Partial<Record<StatusId, [string, string]>> = {
  poison: ['PSN', '#b07cff'], burn: ['BRN', '#ff8a4a'], stun: ['STN', '#ffe07a'], blind: ['BLD', '#8b8fa8'],
  jammed: ['JAM', '#3fe0f0'], exposed: ['EXP', '#ff6fc8'], regen: ['RGN', '#86f08c'], hijacked: ['HAX', '#3fe0f0'],
  atk_up: ['ATK↑', '#ffcc3d'], def_up: ['DEF↑', '#6ff3ff'], res_up: ['RES↑', '#b99bff'], agi_up: ['AGI↑', '#86f08c'],
  atk_down: ['ATK↓', '#ff6b6b'], def_down: ['DEF↓', '#ff6b6b'], agi_down: ['AGI↓', '#ff6b6b'], guard: ['GRD', '#6ff3ff'], lockon: ['LOCK', '#ff3a3a'], cover: ['COVR', '#d8c08a'],
};

export const STATUS_SFX: Partial<Record<StatusId, string>> = {
  poison: 'st_poison', burn: 'st_burn', stun: 'st_stun', blind: 'st_blind', jammed: 'st_jammed', hijacked: 'st_jammed',
};

/** A status id as the crew would say it. */
export function statusName(st: string): string {
  return st === 'hijacked' ? 'HIJACK' : st.replace('_', ' ').toUpperCase();
}

/** Offsets and opacity of the speed ghosts behind a dashing party member. */
export const AFTERIMAGES: [number, number, number][] = [[-7, 5, 0.35], [7, 9, 0.22], [0, 13, 0.14]];

/** Short element tags and colours for the weakness readout. */
export const ELEMENTS = ['phys', 'fire', 'shock', 'cyber', 'mana'] as const;
export const ELEMENT_TAG: Record<(typeof ELEMENTS)[number], string> = { phys: 'PHYS', fire: 'FIRE', shock: 'SHOCK', cyber: 'CYBER', mana: 'MANA' };
export const ELEMENT_COLOR: Record<(typeof ELEMENTS)[number], string> = { phys: '#e0dcd0', fire: '#ffa24a', shock: '#9ae8ff', cyber: '#3fe0f0', mana: '#b99bff' };
/**
 * The damage-type symbols (font glyphs): shown beside every attack, tech, skill and item in the
 * battle menus and in the weakness readouts, so "this is fire" and "weak to fire" read the same.
 */
export const ELEMENT_ICON: Record<(typeof ELEMENTS)[number], string> = { phys: '\uE001', fire: '\uE002', shock: '\uE003', cyber: '\uE004', mana: '\uE005' };
/** A symbol in its element's colour, as inline text (the font's colour code for any hex). */
export function elementMark(el: (typeof ELEMENTS)[number]): string {
  return `{#${ELEMENT_COLOR[el].slice(1)}}${ELEMENT_ICON[el]}{/}`;
}

/**
 * A symbol and its colour reset just before a name: that name is already marked. A regex literal,
 * not a string: the range's ends are code points, not text to draw (tests/glyphs.test.ts).
 */
const MARKED = /[-]\{\/\}\s?/.source;
/** A damage type's name in capitals, unless its symbol already comes first. */
const ELEMENT_WORD = new RegExp(`(?<!${MARKED})\\b(${ELEMENTS.map((e) => e.toUpperCase()).join('|')})\\b`, 'g');

/**
 * Every damage type written by name (FIRE, SHOCK...) gets its symbol in front, in its colour
 * (Mark's playthrough: "whenever you write out a damage type by name, include the icon"). Damage
 * types are written in capitals wherever one is meant, so an item called "Shock Knuckles" isn't
 * touched; a name that already has its symbol isn't marked twice.
 */
export function markElements(text: string): string {
  return text.replace(ELEMENT_WORD, (word: string) => `${elementMark(word.toLowerCase() as (typeof ELEMENTS)[number])}${word}`);
}

/** An ability's name with its damage type's symbol in front (PHYS included), when it deals damage. */
export function abilityLabel(ab: Pick<Ability, 'name' | 'element' | 'effects'>): string {
  if (!ab.effects.some((e) => e.type === 'damage')) return ab.name;
  return `${elementMark(ab.element ?? 'phys')} ${ab.name}`;
}


export const STATUS_WORD: Partial<Record<StatusId, string>> = {
  poison: 'POISONED', burn: 'BURNING', stun: 'STUNNED', blind: 'BLINDED', jammed: 'JAMMED', exposed: 'EXPOSED', regen: 'REGEN',
  hijacked: 'HIJACKED', atk_up: 'ATK UP', def_up: 'DEF UP', res_up: 'RES UP', agi_up: 'AGI UP', atk_down: 'ATK DOWN', def_down: 'DEF DOWN',
  agi_down: 'SLOWED', lockon: 'LOCKED ON', guard: 'GUARD', cover: 'COVERING',
};

// ------------------------------------------------------------------ helpers
export function pickGroup(encounter: string): string[] {
  const groups = ENCOUNTERS[encounter];
  if (!groups?.length) throw new Error(`Unknown encounter ${encounter}`);
  const total = groups.reduce((n, g) => n + g.w, 0);
  let r = streams.battle.next() * total;
  for (const g of groups) {
    r -= g.w;
    if (r <= 0) return g.e;
  }
  return groups[0]!.e;
}

export function groupNames(es: readonly Combatant[]): string {
  const counts = new Map<string, number>();
  for (const e of es) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
  const parts = [...counts.entries()].map(([n, c]) => (c > 1 ? `${c} ${n}s` : n));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]!;
}

export function summarize(names: string[]): string[] {
  const m = new Map<string, number>();
  for (const n of names) m.set(n, (m.get(n) ?? 0) + 1);
  return [...m.entries()].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n));
}

/** An enemy move's body motion, from its effect: melee strikes, gunfire, or casting. */
export function enemyMotion(fx: string): Pose {
  if (['slash', 'claw', 'whip', 'punch', 'bite', 'crush', 'coil', 'palm'].includes(fx)) return 'attack';
  if (['gunfire', 'shot', 'beam', 'bolt', 'zap', 'lightning', 'target_lock'].includes(fx)) return 'aim';
  return 'cast';
}

/** A signature sting per combo, layered under the shared combo fanfare. */
export const COMBO_STING: Record<string, string> = {
  combo_thunder_rift: 'sting_rift',
  combo_target_lock: 'sting_lock',
  combo_ghost_circuit: 'sting_circuit',
  combo_pyre_storm: 'sting_pyre',
  combo_spirit_walk: 'sting_crow',
  combo_lifeline: 'sting_life',
  combo_crows_wing: 'sting_ward',
  combo_blackout: 'sting_circuit',
  combo_clean_job: 'sting_rift',
};

export function fxSound(fx: string): string {
  if (['slash', 'claw', 'whip', 'arc_cut', 'moonfall', 'flash_step', 'clean_job'].includes(fx)) return 'slash';
  if (['gunfire', 'shot', 'target_lock', 'blackout'].includes(fx)) return 'gun';
  if (['lightning', 'zap', 'thunder_rift', 'pyre_storm'].includes(fx)) return 'zap';
  if (['fire', 'fire_all', 'explosion'].includes(fx)) return 'fire';
  if (['code', 'glitch', 'scan', 'ghost_circuit'].includes(fx)) return 'code';
  if (['heal', 'heal_all', 'heal_self', 'revive', 'cleanse', 'tp', 'lifeline'].includes(fx)) return 'heal';
  if (['punch', 'bite', 'crush', 'palm', 'coil', 'rain_hits'].includes(fx)) return 'punch';
  if (['crow', 'spirit_walk', 'crows_wing', 'dark', 'wail', 'smog'].includes(fx)) return 'spirit';
  if (fx === 'beam') return 'beam';
  if (fx === 'wave') return 'wave';
  return 'hit';
}

/** Which battle pose a party action plays: blades and fists strike, programs and spirits are cast. */
export function actionPose(key: string, kind: Ability['kind'], targets: (string | undefined)[], fx = ''): Pose {
  if (kind === 'item') return 'item';
  if (fx === 'palm' || fx === 'coil') return 'thrust';
  if (fx === 'gunfire' || fx === 'shot') return 'aim';
  if (fx === 'shield' || fx === 'buff' || fx === 'guard' || fx === 'roar' || fx === 'crows_wing') return 'brace';
  if (kind === 'attack' || kind === 'skill') return 'attack';
  const onAllies = targets.length > 0 && targets.every((t) => t === 'party');
  if (key === 'kit' && !onAllies) return 'attack';
  return 'cast';
}
