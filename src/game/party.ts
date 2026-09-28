/** Party member lifecycle: creation, derived stats, equipment, learning, XP. Pure logic. */
import type { Stats, StatusId } from '../battle/types';
import { ABILITIES, LEARNSETS } from '../data/abilities';
import { ITEMS } from '../data/items';
import { baseStatsAt, levelForXp, MEMBERS, xpFor } from '../data/party';
import type { EquipSlot, MemberId, MemberState } from './state';
import { state } from './state';

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
  return s;
}

/** Ability ids known at the member's level, in learn order. */
export function knownAbilities(m: MemberState, kind?: 'tech' | 'skill'): string[] {
  return (LEARNSETS[m.id] ?? [])
    .filter((l) => l.level <= m.level)
    .map((l) => l.id)
    .filter((id) => !kind || ABILITIES[id]?.kind === kind);
}

export function restoreUses(m: MemberState): void {
  for (const id of knownAbilities(m, 'skill')) m.uses[id] = ABILITIES[id]!.uses ?? 1;
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

export interface LevelUp {
  id: MemberId;
  level: number;
  gains: Partial<Record<'hp' | 'tp' | 'atk' | 'def' | 'mnd' | 'agi', number>>;
  learned: string[];
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
    for (const id of learned) if (ABILITIES[id]!.kind === 'skill') m.uses[id] = ABILITIES[id]!.uses ?? 1;
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
      learned,
    });
  }
  return ups;
}

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
