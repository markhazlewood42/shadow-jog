/**
 * Giving orders: what each crew member can be told to do this round, and the orders Auto and
 * Repeat fill in. Pure functions of the combatants and the save state, so they are testable
 * without a scene (tests/orders.test.ts); BattleScene owns only the menu flow.
 */
import { Battle } from '../../battle/engine';
import type { Ability, Combatant, Command, Element } from '../../battle/types';
import { ABILITIES } from '../../data/abilities';
import { ITEMS } from '../../data/items';
import { MEMBERS } from '../../data/party';
import { knownAbilities } from '../../game/party';
import { state, type MemberId } from '../../game/state';
import type { ListItem } from '../../ui/list';
import { ELEMENT_COLOR, ELEMENT_ICON } from './tables';

/**
 * The damage type an order deals, or null if it deals none (heals, buffs, statuses): the move's
 * own element, else the item's, else (for Attack) the weapon's, else physical. The engine resolves
 * it the same way (engine.ts, the damage step).
 */
export function damageElement(ab: Ability, a: Combatant, itemId?: string): Element | null {
  const effects = itemId ? (ITEMS[itemId]?.effects ?? []) : ab.effects;
  if (!effects.some((e) => e.type === 'damage')) return null;
  return ab.element ?? (itemId ? ITEMS[itemId]?.element : undefined) ?? (ab.kind === 'attack' ? a.weaponElement : undefined) ?? 'phys';
}

/** A list row's icon for an order's damage type: a blank of the same width when it deals none, so labels line up. */
function elementIcon(el: Element | null): Pick<ListItem<string>, 'icon' | 'iconColor'> {
  return el ? { icon: ELEMENT_ICON[el], iconColor: ELEMENT_COLOR[el] } : { icon: '\uE000', iconColor: undefined };
}

/** Items usable in battle that aren't already promised to an earlier order this round. */
export function battleItems(reserved: Record<string, number>): string[] {
  return Object.keys(state.inventory).filter((id) => ITEMS[id]?.battle && (state.inventory[id] ?? 0) - (reserved[id] ?? 0) > 0);
}

/** A member's command menu: Attack, their tech family (named for them), Skills, Item, Guard. */
export function commandItems(a: Combatant, reserved: Record<string, number>): ListItem<string>[] {
  const m = state.members[a.key as MemberId]!;
  // Attack shows the weapon's damage type; the rest carry a blank so the column lines up.
  const blank = elementIcon(null);
  const items: ListItem<string>[] = [{ label: 'Attack', value: 'attack', ...elementIcon(damageElement(ABILITIES.attack!, a)) }];
  if (knownAbilities(m, 'tech').length) items.push({ label: MEMBERS[a.key as MemberId].tpLabel === 'KI' ? 'Ki Arts' : a.key === 'hex' ? 'Programs' : 'Spirits', value: 'tech', ...blank });
  if (knownAbilities(m, 'skill').length) items.push({ label: 'Skills', value: 'skill', ...blank });
  items.push({ label: 'Item', value: 'item', enabled: battleItems(reserved).length > 0, ...blank });
  items.push({ label: 'Guard', value: 'guard', ...blank });
  return items;
}

/** The techs, skills or items list, with costs and what can't be afforded greyed out. */
export function choiceItems(a: Combatant, kind: 'tech' | 'skill' | 'item', reserved: Record<string, number>): ListItem<string>[] {
  if (kind === 'item') {
    return battleItems(reserved).map((id) => {
      const it = ITEMS[id]!;
      const el = it.effects?.some((e) => e.type === 'damage') ? (it.element ?? 'phys') : null;
      return { label: it.name, value: id, right: `×${(state.inventory[id] ?? 0) - (reserved[id] ?? 0)}`, ...elementIcon(el) };
    });
  }
  const m = state.members[a.key as MemberId]!;
  return knownAbilities(m, kind).map((id) => {
    const ab = ABILITIES[id]!;
    const ok = kind === 'tech' ? a.tp >= (ab.cost ?? 0) : (a.uses[id] ?? 0) > 0;
    const right = kind === 'tech' ? `${ab.cost} ${MEMBERS[a.key as MemberId].tpLabel}` : `${a.uses[id] ?? 0}/${ab.uses}`;
    return { label: ab.name, value: id, right, enabled: ok, ...elementIcon(damageElement(ab, a)) };
  });
}

/** The living crew member worst off, as a fraction of their HP (the default heal target). */
export function mostHurt(party: readonly Combatant[]): number {
  const alive = party.filter((p) => p.hp > 0);
  return [...alive].sort((x, y) => x.hp / x.base.maxHp - y.hp / y.base.maxHp)[0]?.uid ?? -1;
}

/** Auto: everyone attacks, the engine picks targets. */
export function autoOrders(actors: Combatant[]): Command[] {
  return actors.map((a) => ({ actor: a.uid, type: 'attack' as const, target: -1 }));
}

/**
 * Repeat: each member's last order again, where it still can be given (TP, uses, stock; items
 * are reserved as they're assigned, so two orders can't spend the last medkit); otherwise attack.
 */
export function repeatOrders(actors: Combatant[]): Command[] {
  const out: Command[] = [];
  const reserved: Record<string, number> = {};
  for (const a of actors) {
    const o = state.lastOrders[a.key as MemberId];
    let cmd: Command = { actor: a.uid, type: 'attack', target: -1 };
    if (o && o.cmd !== 'run') {
      if (o.cmd === 'tech' && o.id && a.tp >= (ABILITIES[o.id]?.cost ?? 0)) cmd = { actor: a.uid, type: 'tech', id: o.id, target: -1 };
      else if (o.cmd === 'skill' && o.id && (a.uses[o.id] ?? 0) > 0) cmd = { actor: a.uid, type: 'skill', id: o.id, target: -1 };
      else if (o.cmd === 'item' && o.id && (state.inventory[o.id] ?? 0) - (reserved[o.id] ?? 0) > 0) {
        cmd = { actor: a.uid, type: 'item', id: o.id, target: -1 };
        reserved[o.id] = (reserved[o.id] ?? 0) + 1;
      } else if (o.cmd === 'guard') cmd = { actor: a.uid, type: 'guard' };
    }
    out.push(cmd);
  }
  return out;
}

/** The actors whose queued orders fuse into a combo. */
export function comboActors(cmds: Command[], units: Combatant[], into: Set<number>): void {
  into.clear();
  for (const c of Battle.findCombos(cmds, units)) for (const x of c.cmds) into.add(x.actor);
}

/** The ★ hint for choosing `id` now: the combo's name once found, a teaser before. '' if none. */
export function comboHint(cmds: Command[], units: Combatant[], actor: Combatant, kind: 'tech' | 'skill', id: string): string {
  const trial = [...cmds, { actor: actor.uid, type: kind, id, target: -1 } as Command];
  const combos = Battle.findCombos(trial, units).filter((c) => c.cmds.some((x) => x.actor === actor.uid));
  if (!combos.length) return '';
  return state.combos.includes(combos[0]!.combo) ? `★ COMBO: ${ABILITIES[combos[0]!.combo]!.name}` : '★ Something resonates… (combo!)';
}
