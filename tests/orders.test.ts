/** Giving orders (src/scenes/battlekit/orders.ts): menus, Auto, Repeat, heal targeting. */
import { beforeEach, describe, expect, it } from 'vitest';
import { partyCombatant } from '../src/battle/setup';
import type { Combatant } from '../src/battle/types';
import { addMember } from '../src/game/party';
import * as stateMod from '../src/game/state';
import { autoOrders, choiceItems, commandItems, mostHurt, repeatOrders } from '../src/scenes/battlekit/orders';

let kit: Combatant, rook: Combatant;

beforeEach(() => {
  stateMod.setState(stateMod.newState());
  kit = partyCombatant(addMember('kit', 3), 0, 0);
  rook = partyCombatant(addMember('rook', 4), 1, 1);
  stateMod.state.inventory = {};
});

describe('orders', () => {
  it('Auto has everyone attack, targets left to the engine', () => {
    expect(autoOrders([kit, rook])).toEqual([
      { actor: 0, type: 'attack', target: -1 },
      { actor: 1, type: 'attack', target: -1 },
    ]);
  });

  it('Repeat gives the last order again, and never spends one medkit twice', () => {
    stateMod.state.inventory = { medkit: 1 };
    stateMod.state.lastOrders = { kit: { cmd: 'item', id: 'medkit' }, rook: { cmd: 'item', id: 'medkit' } };
    const [a, b] = repeatOrders([kit, rook]);
    expect(a).toEqual({ actor: 0, type: 'item', id: 'medkit', target: -1 });
    expect(b).toEqual({ actor: 1, type: 'attack', target: -1 });
  });

  it('Repeat falls back to attacking when the tech can no longer be paid for', () => {
    stateMod.state.lastOrders = { kit: { cmd: 'tech', id: 'flash_step' } };
    kit.tp = 0;
    expect(repeatOrders([kit])[0]).toEqual({ actor: 0, type: 'attack', target: -1 });
    kit.tp = 99;
    expect(repeatOrders([kit])[0]).toEqual({ actor: 0, type: 'tech', id: 'flash_step', target: -1 });
  });

  it('greys out what can’t be afforded, with the cost shown', () => {
    kit.tp = 0;
    const flash = choiceItems(kit, 'tech', {}).find((i) => i.value === 'flash_step')!;
    expect(flash.enabled).toBe(false);
    expect(flash.right).toMatch(/KI/);
  });

  it('offers Item only while there is an unreserved battle item', () => {
    expect(commandItems(kit, {}).find((i) => i.value === 'item')!.enabled).toBe(false);
    stateMod.state.inventory = { medkit: 1 };
    expect(commandItems(kit, {}).find((i) => i.value === 'item')!.enabled).toBe(true);
    expect(commandItems(kit, { medkit: 1 }).find((i) => i.value === 'item')!.enabled).toBe(false);
    expect(commandItems(kit, {}).map((i) => i.label)).toContain('Ki Arts');
  });

  it('points heals at whoever is worst off, by fraction of their HP', () => {
    kit.hp = Math.round(kit.base.maxHp * 0.5);
    rook.hp = Math.round(rook.base.maxHp * 0.3);
    expect(mostHurt([kit, rook])).toBe(rook.uid);
    rook.hp = 0; // down: not a heal target
    expect(mostHurt([kit, rook])).toBe(kit.uid);
  });
});
