/** Bridges persistent party state and battle combatants. */
import { MEMBERS } from '../data/party';
import { equipImmunities, knownAbilities, maxUses, memberStats, weaponElement } from '../game/party';
import type { MemberState } from '../game/state';
import { enemyCombatant } from './engine';
import type { Combatant, StatusId } from './types';

const PERSIST: StatusId[] = ['poison'];

export function partyCombatant(m: MemberState, uid: number, order: number): Combatant {
  const s = memberStats(m);
  return {
    uid,
    side: 'party',
    key: m.id,
    name: MEMBERS[m.id].name,
    level: m.level,
    hp: Math.min(m.hp, s.maxHp),
    tp: Math.min(m.tp, s.maxTp),
    base: s,
    status: m.ailments.filter((a): a is StatusId => PERSIST.includes(a as StatusId)).map((id) => ({ id, turns: 99 })),
    uses: { ...m.uses },
    maxUses: Object.fromEntries(knownAbilities(m, 'skill').map((id) => [id, maxUses(m.id, id)])),
    immune: equipImmunities(m),
    weaponElement: weaponElement(m),
    memory: {},
    order,
  };
}

export function writeBack(c: Combatant, m: MemberState): void {
  m.hp = Math.max(0, c.hp);
  m.tp = Math.max(0, c.tp);
  m.uses = { ...c.uses };
  m.ailments = c.hp > 0 ? c.status.filter((s) => PERSIST.includes(s.id)).map((s) => s.id) : [];
}

export function enemyParty(ids: string[]): Combatant[] {
  return ids.map((id, i) => enemyCombatant(id, 10 + i, i));
}
