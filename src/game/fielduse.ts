/** Applying items and techs outside of battle. Pure state logic. */
import type { Effect, StatusId } from '../battle/types';
import { memberStats } from './party';
import type { MemberState } from './state';

export interface UseResult {
  ok: boolean;
  text: string;
}

/** Apply field-usable effects to one member. `mnd` scales tech heals (0 for items). */
export function applyEffects(effects: Effect[], m: MemberState, mnd: number, name: string): UseResult {
  const s = memberStats(m);
  let did = false;
  const parts: string[] = [];
  for (const e of effects) {
    switch (e.type) {
      case 'heal': {
        if (m.hp <= 0 || m.hp >= s.maxHp) break;
        const amt = Math.round(e.pct !== undefined ? s.maxHp * e.pct : (e.power ?? 0) + mnd * 1.5);
        const before = m.hp;
        m.hp = Math.min(s.maxHp, m.hp + amt);
        parts.push(`${name} recovers {g}${m.hp - before}{/} HP.`);
        did = true;
        break;
      }
      case 'tp': {
        if (m.hp <= 0 || s.maxTp <= 0 || m.tp >= s.maxTp) break;
        const before = m.tp;
        m.tp = Math.min(s.maxTp, m.tp + e.amount);
        parts.push(`${name} recovers {c}${m.tp - before}{/} TP.`);
        did = true;
        break;
      }
      case 'cure': {
        if (m.hp <= 0 || !m.ailments.length) break;
        const list = e.statuses === 'all' ? null : (e.statuses as StatusId[]);
        const before = m.ailments.length;
        m.ailments = list ? m.ailments.filter((a) => !list.includes(a as StatusId)) : [];
        if (m.ailments.length < before) {
          parts.push(`${name} feels clean again.`);
          did = true;
        }
        break;
      }
      case 'revive': {
        if (m.hp > 0) break;
        m.hp = Math.max(1, Math.round(s.maxHp * e.pct));
        m.ailments = [];
        parts.push(`${name} is back on their feet!`);
        did = true;
        break;
      }
      default:
        break;
    }
  }
  return did ? { ok: true, text: parts.join(' ') } : { ok: false, text: 'It would have no effect.' };
}
