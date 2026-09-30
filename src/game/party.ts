/** Party member lifecycle: creation, derived stats, equipment, learning, XP. Pure logic. */
import type { Stats, StatusId } from '../battle/types';
import { ABILITIES, LEARNSETS } from '../data/abilities';
import { ITEMS } from '../data/items';
import { baseStatsAt, levelForXp, MAX_LEVEL, MEMBERS, xpFor } from '../data/party';
import type { EquipSlot, MemberId, MemberState } from './state';
import { flags, state } from './state';

export function createMember(id: MemberId, level?: number): MemberState {
  const def = MEMBERS[id];
  const lv = level ?? def.startLevel;
  const m: MemberState = {
    id,
    level: lv,
    xp: xpFor(lv),
    hp: 1,
    tp: 0,
    uses: {},
    equip: { ...def.startEquip },
    ailments: [],
  };
  const s = memberStats(m);
  m.hp = s.maxHp;
  m.tp = s.maxTp;
  restoreUses(m);
  return m;
}

export function memberStats(m: MemberState): Stats {
  const b = baseStatsAt(m.id, m.level);
  const def = MEMBERS[m.id];
  const s: Stats = {
    maxHp: b.hp,
    maxTp: b.tp,
    atk: b.str,
    def: b.def,
    mnd: b.mnd,
    res: Math.round(b.mnd / 2),
    agi: b.agi,
    crit: def.crit,
    hit: 0,
  };
  for (const slot of ['weapon', 'body', 'head', 'mod'] as EquipSlot[]) {
    const id = m.equip[slot];
    if (!id) continue;
    const it = ITEMS[id];
    if (!it) continue;
    s.atk += it.atk ?? 0;
    s.def += it.def ?? 0;
    s.mnd += it.mnd ?? 0;
    s.res += it.res ?? 0;
    s.agi += it.agi ?? 0;
    s.maxHp += it.hp ?? 0;
    s.maxTp += it.tp ?? 0;
    s.crit += it.crit ?? 0;
    s.hit += it.hit ?? 0;
  }
  if (m.id === 'rook') s.maxTp = 0;
  if (isWounded(m.id)) {
    const w = woundNow();
    s.maxHp = Math.round(s.maxHp * w.hp);
    s.atk = Math.round(s.atk * w.atk);
    s.agi = Math.round(s.agi * w.agi);
  }
  return s;
}

/**
 * What Rook's wound costs him, healing in two steps with the story: Hex's re-tune lets his chrome
 * carry half of it (and gives two skills back), then Sable closes it. Early on he's about as
 * strong as the old level-3 Rook was, so the opening fights keep their bite; whole, he's the
 * veteran his level says. Shown on his status page.
 */
export const WOUND = { hp: 0.7, atk: 0.72, agi: 0.85 };
export const WOUND_TUNED = { hp: 0.85, atk: 0.86, agi: 0.92 };
function woundNow(): typeof WOUND {
  return flags.has('rook_tuned') ? WOUND_TUNED : WOUND;
}

/** What the wound costs this member right now (null if they aren't wounded), for the status page. */
export function currentWound(id: MemberId): typeof WOUND | null {
  return isWounded(id) ? woundNow() : null;
}

/** Abilities this member has the level for but the story hasn't unlocked yet (Rook's, while hurt). */
export function lockedAbilities(m: MemberState): string[] {
  return (LEARNSETS[m.id] ?? []).filter((l) => l.level <= m.level && l.flag && !flags.has(l.flag)).map((l) => l.id);
}

/** Ability ids known at the member's level, in learn order. */
export function knownAbilities(m: MemberState, kind?: 'tech' | 'skill'): string[] {
  return (LEARNSETS[m.id] ?? [])
    .filter((l) => l.level <= m.level && (!l.flag || flags.has(l.flag)))
    .map((l) => l.id)
    .filter((id) => !kind || ABILITIES[id]?.kind === kind);
}

/**
 * Rook came into Chapter 1 hurt: until Sable closes the wound he's weaker (WOUND) and each of his
 * skills holds one charge fewer.
 */
export function isWounded(id: MemberId): boolean {
  return id === 'rook' && !flags.has('rook_mended');
}

/** A skill's charges when full: its listed uses, one fewer (at least one) while Rook is wounded. */
export function maxUses(id: MemberId, abilityId: string): number {
  const full = ABILITIES[abilityId]?.uses ?? 1;
  return isWounded(id) ? Math.max(1, full - 1) : full;
}

export function restoreUses(m: MemberState): void {
  for (const id of knownAbilities(m, 'skill')) m.uses[id] = maxUses(m.id, id);
}

export function equipImmunities(m: MemberState): StatusId[] {
  const out: StatusId[] = [];
  for (const id of Object.values(m.equip)) {
    const it = id ? ITEMS[id] : undefined;
    if (it?.immune) out.push(...it.immune);
  }
  return out;
}

export function equipRegen(m: MemberState): number {
  let r = 0;
  for (const id of Object.values(m.equip)) r += (id ? ITEMS[id]?.regen : 0) ?? 0;
  return r;
}

export function weaponElement(m: MemberState) {
  const w = m.equip.weapon ? ITEMS[m.equip.weapon] : undefined;
  return w?.element ?? MEMBERS[m.id].element;
}

export type GrowthStat = 'hp' | 'tp' | 'atk' | 'def' | 'mnd' | 'agi';
export interface LevelUp {
  id: MemberId;
  level: number;
  gains: Partial<Record<GrowthStat, number>>;
  /** Each stat before and after the level (max HP and TP for hp/tp): the panel counts them up. */
  from: Record<GrowthStat, number>;
  to: Record<GrowthStat, number>;
  learned: string[];
}

function growthStats(s: ReturnType<typeof memberStats>): Record<GrowthStat, number> {
  return { hp: s.maxHp, tp: s.maxTp, atk: s.atk, def: s.def, mnd: s.mnd, agi: s.agi };
}

/** Add XP; returns one entry per level gained. HP/TP rise by the gained max. */
export function grantXp(m: MemberState, xp: number): LevelUp[] {
  const ups: LevelUp[] = [];
  m.xp += xp;
  const target = levelForXp(m.xp);
  while (m.level < target) {
    const before = memberStats(m);
    const knownBefore = new Set(knownAbilities(m));
    m.level++;
    const after = memberStats(m);
    m.hp += after.maxHp - before.maxHp;
    m.tp += after.maxTp - before.maxTp;
    const learned = knownAbilities(m).filter((id) => !knownBefore.has(id));
    for (const id of learned) if (ABILITIES[id]!.kind === 'skill') m.uses[id] = maxUses(m.id, id);
    ups.push({
      id: m.id,
      level: m.level,
      gains: {
        hp: after.maxHp - before.maxHp,
        tp: after.maxTp - before.maxTp,
        atk: after.atk - before.atk,
        def: after.def - before.def,
        mnd: after.mnd - before.mnd,
        agi: after.agi - before.agi,
      },
      from: growthStats(before),
      to: growthStats(after),
      learned,
    });
  }
  // A level-up is a full recovery (Mark's playthrough, 2026-09-29): HP, TP and charges, with
  // ailments shaken off. Levels are rare now, so it's a moment, not a free heal every fight.
  if (ups.length) fullRestore(m);
  return ups;
}

/** How the menus and the shop name each equipment slot. */
export const SLOT_NAMES: Record<EquipSlot, string> = { weapon: 'Weapon', body: 'Body', head: 'Head', mod: 'Mod' };

export function canEquip(m: MemberState, itemId: string): boolean {
  const it = ITEMS[itemId];
  if (!it?.slot) return false;
  return !it.who || it.who.includes(m.id);
}

/** Equip from inventory; returns the item that was removed (put back into inventory). */
export function equip(m: MemberState, itemId: string | null, slot: EquipSlot): void {
  const prev = m.equip[slot];
  if (itemId) {
    if (!canEquip(m, itemId) || (state.inventory[itemId] ?? 0) <= 0) return;
    state.inventory[itemId]! -= 1;
    if (state.inventory[itemId] === 0) delete state.inventory[itemId];
    m.equip[slot] = itemId;
  } else delete m.equip[slot];
  if (prev) state.inventory[prev] = (state.inventory[prev] ?? 0) + 1;
  const s = memberStats(m);
  m.hp = Math.min(m.hp, s.maxHp);
  m.tp = Math.min(m.tp, s.maxTp);
}

/**
 * After loading a save: each member's HP and TP within their maximums, and charges (up to full)
 * for every skill they know. A save written before a retune (levels, story unlocks) can have HP
 * over a lower maximum, or no charges at all for a skill it now has.
 */
export function reconcileParty(): void {
  for (const m of Object.values(state.members)) {
    if (!m) continue;
    const s = memberStats(m);
    m.hp = Math.min(m.hp, s.maxHp);
    m.tp = Math.min(m.tp, s.maxTp);
    for (const id of knownAbilities(m, 'skill')) {
      const full = maxUses(m.id, id);
      m.uses[id] = Math.min(m.uses[id] ?? full, full);
    }
  }
}

export function fullRestore(m: MemberState): void {
  const s = memberStats(m);
  m.hp = s.maxHp;
  m.tp = s.maxTp;
  m.ailments = [];
  restoreUses(m);
}

/**
 * A night's sleep: HP, TP and skill uses for everyone still standing. Sleep doesn't revive the
 * downed or clear lingering ailments; that is the clinic's trade (or Rekindle and detox kits).
 */
export function rest(m: MemberState): void {
  if (m.hp <= 0) return;
  const s = memberStats(m);
  m.hp = s.maxHp;
  m.tp = s.maxTp;
  restoreUses(m);
}

/**
 * The crew's level for prices (the inn, the clinic): the average of everyone who levels from 1.
 * Rook's veteran 10 would otherwise double every bill from the first night.
 */
export function crewLevel(): number {
  const peers = partyMembers().filter((m) => (MEMBERS[m.id].baseLevel ?? 1) === 1);
  return peers.length ? peers.reduce((n, m) => n + m.level, 0) / peers.length : 1;
}

/** Capsule price per head: rooms get dearer as the crew's reputation (and level) grows. */
export function innPrice(base: number, avgLevel: number): number {
  return Math.round(base + 4 * avgLevel);
}

export function isDown(m: MemberState): boolean {
  return m.hp <= 0;
}

export function partyMembers(): MemberState[] {
  return state.party.map((id) => state.members[id]!).filter(Boolean);
}

export function addMember(id: MemberId, level?: number): MemberState {
  let m = state.members[id];
  if (!m) {
    m = createMember(id, level);
    state.members[id] = m;
  }
  if (!state.party.includes(id)) state.party.push(id);
  return m;
}

/** How far through the current level an amount of XP is (0..1; 1 at the level cap). */
export function levelProgress(level: number, xp: number): number {
  if (level >= MAX_LEVEL) return 1;
  const lo = xpFor(level), hi = xpFor(level + 1);
  return Math.max(0, Math.min(1, (xp - lo) / (hi - lo)));
}
