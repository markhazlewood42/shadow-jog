/** Party member definitions: base stats, growth, starting gear, role blurb. */
import type { Element } from '../battle/types';
import type { EquipSlot, MemberId } from '../game/state';

export interface Growth {
  hp: number;
  tp: number;
  str: number;
  mnd: number;
  agi: number;
  def: number;
}

export interface MemberDef {
  id: MemberId;
  name: string;
  role: string;
  bio: string;
  color: string;
  base: Growth;
  growth: Growth;
  startLevel: number;
  startEquip: Partial<Record<EquipSlot, string>>;
  /** Default basic-attack element if the weapon has none. */
  element?: Element;
  /** Resource label shown in menus. */
  tpLabel: string;
  /** Innate crit bonus %. */
  crit: number;
}

export const MEMBERS: Record<MemberId, MemberDef> = {
  kit: {
    id: 'kit', name: 'Kit', role: 'Physical Adept', color: '#ff8a6a', tpLabel: 'KI',
    bio: '19. Lantern Row born, Rook raised. Her magic came late and came out through her fists.',
    base: { hp: 44, tp: 12, str: 12, mnd: 9, agi: 14, def: 6 },
    growth: { hp: 8.5, tp: 2.2, str: 2.4, mnd: 1.5, agi: 2.1, def: 1.2 },
    startLevel: 1, crit: 8,
    startEquip: { weapon: 'wraps', body: 'street_clothes', head: 'bandana' },
  },
  rook: {
    id: 'rook', name: 'Rook', role: 'Street Samurai', color: '#d8c08a', tpLabel: '—',
    bio: '41. More chrome than conscience, or so he says. Twenty years of runs and one kid he never planned on.',
    base: { hp: 56, tp: 0, str: 15, mnd: 4, agi: 9, def: 9 },
    growth: { hp: 10, tp: 0, str: 2.7, mnd: 0.6, agi: 1.4, def: 1.6 },
    startLevel: 3, crit: 5,
    startEquip: { weapon: 'old_katana', body: 'lined_coat', mod: 'dermal_plating' },
  },
  hex: {
    id: 'hex', name: 'Hex', role: 'Decker', color: '#c3a0ff', tpLabel: 'RAM',
    bio: '34. Dwarf, genius, insomniac. Owes money to people who don\'t send reminders.',
    base: { hp: 34, tp: 15, str: 7, mnd: 13, agi: 11, def: 5 },
    growth: { hp: 6.8, tp: 3.3, str: 1.2, mnd: 2.4, agi: 1.8, def: 1.0 },
    startLevel: 3, crit: 3,
    startEquip: { weapon: 'holdout', body: 'armored_jacket', head: 'tac_visor' },
  },
  sable: {
    id: 'sable', name: 'Sable', role: 'Shaman', color: '#efe6cf', tpLabel: 'MANA',
    bio: '24. Orc. Crow-sworn. Doesn\'t remember how long they were in the tank.',
    base: { hp: 40, tp: 16, str: 8, mnd: 14, agi: 8, def: 6 },
    growth: { hp: 7.6, tp: 3.6, str: 1.3, mnd: 2.6, agi: 1.2, def: 1.1 },
    startLevel: 6, crit: 3,
    startEquip: { weapon: 'ash_staff', body: 'street_clothes' },
  },
};

/** Total XP required to *reach* `level`. */
export function xpFor(level: number): number {
  if (level <= 1) return 0;
  const l = level - 1;
  return Math.floor(15 * Math.pow(l, 2.25) + 20 * l);
}

export const MAX_LEVEL = 30;

export function levelForXp(xp: number): number {
  let l = 1;
  while (l < MAX_LEVEL && xp >= xpFor(l + 1)) l++;
  return l;
}

/** Base (unequipped) stats at a level. */
export function baseStatsAt(id: MemberId, level: number): Growth {
  const d = MEMBERS[id];
  const n = level - 1;
  // Slight acceleration so late levels feel meaty.
  const k = (g: number) => g * n + g * 0.04 * n * n;
  return {
    hp: Math.round(d.base.hp + k(d.growth.hp)),
    tp: Math.round(d.base.tp + k(d.growth.tp)),
    str: Math.round(d.base.str + k(d.growth.str)),
    mnd: Math.round(d.base.mnd + k(d.growth.mnd)),
    agi: Math.round(d.base.agi + k(d.growth.agi)),
    def: Math.round(d.base.def + k(d.growth.def)),
  };
}
