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
  /**
   * The level `base` describes (1 for the crew; Rook's 10: a veteran whose stats are set where he
   * is, and who grows slowly from there). Levels below it never happen.
   */
  baseLevel?: number;
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
    id: 'kit', name: 'Kit', role: 'Ki Brawler', color: '#ff8a6a', tpLabel: 'KI',
    bio: '19. Lantern Row born, Rook raised. Her magic came late and came out through her fists.',
    base: { hp: 44, tp: 12, str: 12, mnd: 9, agi: 14, def: 6 },
    growth: { hp: 8.5, tp: 2.2, str: 2.4, mnd: 1.5, agi: 2.1, def: 1.2 },
    startLevel: 1, crit: 8,
    startEquip: { weapon: 'wraps', body: 'street_clothes', head: 'bandana' },
  },
  rook: {
    id: 'rook', name: 'Rook', role: 'Street Samurai', color: '#d8c08a', tpLabel: '—',
    bio: '41. More chrome than conscience, or so he says. Twenty years of runs and one kid he never planned on.',
    // At 10, healthy: the strongest of the crew, not by a mile. Chapter 1 opens with him hurt
    // (party.ts WOUND: less HP, strength and speed until Sable closes it). A veteran has little
    // left to grow; the kids catch up with him over the chapter.
    base: { hp: 130, tp: 0, str: 35, mnd: 8, agi: 19, def: 21 },
    growth: { hp: 5, tp: 0, str: 1.3, mnd: 0.3, agi: 0.7, def: 0.8 },
    startLevel: 10, baseLevel: 10, crit: 5,
    startEquip: { weapon: 'old_katana', body: 'lined_coat', mod: 'dermal_plating' },
  },
  hex: {
    id: 'hex', name: 'Hex', role: 'Deck Jockey', color: '#c3a0ff', tpLabel: 'RAM',
    bio: '34. Dwarf, genius, insomniac. Owes money to people who don’t send reminders.',
    base: { hp: 34, tp: 15, str: 7, mnd: 13, agi: 11, def: 5 },
    growth: { hp: 6.8, tp: 3.3, str: 1.2, mnd: 2.4, agi: 1.8, def: 1.0 },
    startLevel: 3, crit: 3,
    startEquip: { weapon: 'holdout', body: 'armored_jacket', head: 'tac_visor' },
  },
  sable: {
    id: 'sable', name: 'Sable', role: 'Shaman', color: '#efe6cf', tpLabel: 'MANA',
    bio: '24. Orc. Crow-sworn. Doesn’t remember how long he was in the tank.',
    base: { hp: 40, tp: 16, str: 8, mnd: 14, agi: 8, def: 6 },
    growth: { hp: 7.6, tp: 3.6, str: 1.3, mnd: 2.6, agi: 1.2, def: 1.1 },
    startLevel: 5, crit: 3,
    startEquip: { weapon: 'ash_staff', body: 'street_clothes' },
  },
};

/**
 * Total XP required to *reach* `level`. Fitted (after Mark's first playthrough, 2026-09-29) so a
 * player who doesn't grind reaches 2 on the way to the Rustyard, 3 after Knuckles, 4 in the
 * Sinkline, 5 after the Lurker and 6 in Annex 7: Chapter 1 ends around 6, not 9, out of a full
 * game that tops out near 30 (tests/economy.test.ts checks the checkpoints).
 */
export function xpFor(level: number): number {
  if (level <= 1) return 0;
  return 60 * (level - 1) ** 2;
}

export const MAX_LEVEL = 30;

export function levelForXp(xp: number): number {
  let l = 1;
  while (l < MAX_LEVEL && xp >= xpFor(l + 1)) l++;
  return l;
}

/**
 * Growth steps reached at each level (the step count the growth formula below is applied to).
 * Levels are rarer since the 2026-09-29 retune (six in Chapter 1, not nine), so each is worth
 * more: fitted so a crew at each story stage's new level is as strong as it was at the old one,
 * which keeps every fight's tuned difficulty (tests/balance.test.ts). Past 6, a steady step a
 * level, to be tuned with Chapter 2.
 */
const STEPS = [0, 0, 1.5, 3.5, 5, 6, 7];
function growthSteps(level: number): number {
  return level < STEPS.length ? (STEPS[Math.max(1, level)] ?? 0) : 7 + (level - 6);
}

/** Base (unequipped) stats at a level. */
export function baseStatsAt(id: MemberId, level: number): Growth {
  const d = MEMBERS[id];
  // A veteran (baseLevel > 1) is described at his base level and grows a plain step a level after it.
  const n = d.baseLevel ? Math.max(0, level - d.baseLevel) : growthSteps(level);
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
