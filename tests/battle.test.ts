import { describe, expect, it } from 'vitest';
import { Battle } from '../src/battle/engine';
import { enemyParty, partyCombatant } from '../src/battle/setup';
import type { Combatant, Command } from '../src/battle/types';
import { ABILITIES, COMBOS, LEARNSETS } from '../src/data/abilities';
import { ENCOUNTERS, ENEMIES } from '../src/data/enemies';
import { ITEMS } from '../src/data/items';
import { levelForXp, xpFor } from '../src/data/party';
import { createMember, grantXp, knownAbilities, memberStats } from '../src/game/party';
import type { MemberId } from '../src/game/state';
import { Rng } from '../src/engine/rng';

function party(ids: MemberId[], level: number): Combatant[] {
  return ids.map((id, i) => partyCombatant(createMember(id, level), i, i));
}

describe('data integrity', () => {
  it('every referenced ability exists', () => {
    for (const set of Object.values(LEARNSETS)) for (const l of set) expect(ABILITIES[l.id], l.id).toBeDefined();
    for (const c of COMBOS) {
      expect(ABILITIES[c.id], c.id).toBeDefined();
      for (const p of c.parts) expect(ABILITIES[p.ability], p.ability).toBeDefined();
    }
    for (const e of Object.values(ENEMIES)) for (const m of e.moves) expect(ABILITIES[m.id], `${e.id}:${m.id}`).toBeDefined();
  });
  it('every encounter references real enemies and drops reference real items', () => {
    for (const [k, groups] of Object.entries(ENCOUNTERS)) for (const g of groups) for (const id of g.e) expect(ENEMIES[id], `${k}:${id}`).toBeDefined();
    for (const e of Object.values(ENEMIES)) for (const d of e.drops ?? []) expect(ITEMS[d.id], `${e.id}:${d.id}`).toBeDefined();
  });
  it('every combo pairs two different members with abilities they actually learn', () => {
    for (const c of COMBOS) {
      expect(c.parts[0].member, c.id).not.toBe(c.parts[1].member);
      for (const p of c.parts) {
        const learns = LEARNSETS[p.member]!.map((l) => l.id);
        expect(learns, `${c.id}: ${p.member} learns ${p.ability}`).toContain(p.ability);
      }
      expect(ABILITIES[c.id]!.kind, c.id).toBe('combo');
    }
  });
  it('starting equipment is equippable', () => {
    for (const id of ['kit', 'rook', 'hex', 'sable'] as MemberId[]) {
      const m = createMember(id);
      for (const it of Object.values(m.equip)) expect(ITEMS[it!]?.who?.includes(id) ?? true, `${id}:${it}`).toBe(true);
    }
  });
});

describe('progression', () => {
  it('xp curve is monotonic and levelForXp inverts it', () => {
    for (let l = 2; l < 25; l++) {
      expect(xpFor(l)).toBeGreaterThan(xpFor(l - 1));
      expect(levelForXp(xpFor(l))).toBe(l);
      expect(levelForXp(xpFor(l) - 1)).toBe(l - 1);
    }
  });
  it('grantXp levels up, raises stats and teaches abilities', () => {
    const m = createMember('kit', 1);
    const before = memberStats(m);
    const ups = grantXp(m, xpFor(5));
    expect(m.level).toBe(5);
    expect(ups.length).toBe(4);
    expect(memberStats(m).atk).toBeGreaterThan(before.atk);
    expect(knownAbilities(m)).toContain('iron_palm');
    expect(ups.flatMap((u) => u.learned)).toContain('focus_breath');
  });
});

describe('battle engine', () => {
  it('attacks damage and a lopsided fight is won', () => {
    const b = new Battle(party(['kit', 'rook'], 8), enemyParty(['glowrat']), new Rng(1));
    let rounds = 0;
    while (!b.outcome && rounds < 20) {
      const cmds: Command[] = b.alive('party').map((u) => ({ actor: u.uid, type: 'attack', target: -1 }));
      const ev = b.resolveRound(cmds);
      expect(ev.length).toBeGreaterThan(0);
      rounds++;
    }
    expect(b.outcome).toBe('win');
    expect(b.rewards().xp).toBe(ENEMIES.glowrat!.xp);
  });

  it('is deterministic for a seed', () => {
    const run = () => {
      const b = new Battle(party(['kit', 'rook'], 3), enemyParty(['rustfang_punk', 'rustfang_slinger']), new Rng(99));
      const log: string[] = [];
      while (!b.outcome && b.round < 30) {
        const ev = b.resolveRound(b.alive('party').map((u) => ({ actor: u.uid, type: 'attack' as const, target: -1 })));
        log.push(JSON.stringify(ev));
      }
      return log.join('|');
    };
    expect(run()).toBe(run());
  });

  it('detects and fires combos, consuming both resources', () => {
    const p = party(['kit', 'rook'], 5);
    const b = new Battle(p, enemyParty(['rust_crab']), new Rng(7));
    const kit = p[0]!, rook = p[1]!;
    const tp = kit.tp, uses = rook.uses.arc_cut!;
    const cmds: Command[] = [
      { actor: kit.uid, type: 'tech', id: 'flash_step', target: 10 },
      { actor: rook.uid, type: 'skill', id: 'arc_cut', target: 10 },
    ];
    expect(Battle.findCombos(cmds, b.units).map((c) => c.combo)).toEqual(['combo_thunder_rift']);
    const ev = b.resolveRound(cmds);
    expect(ev.some((e) => e.t === 'combo' && e.name === 'Thunder Rift')).toBe(true);
    expect(kit.tp).toBe(tp - ABILITIES.flash_step!.cost!);
    expect(rook.uses.arc_cut).toBe(uses - 1);
  });

  it('cyber programs wreck machines and do nothing to spirits', () => {
    const p = party(['hex'], 5);
    const b = new Battle(p, enemyParty(['street_drone', 'smog_wisp']), new Rng(3));
    const ev = b.resolveRound([{ actor: 0, type: 'tech', id: 'spike', target: 10 }]);
    const hitDrone = ev.find((e) => e.t === 'damage' && e.target === 10);
    expect(hitDrone && hitDrone.t === 'damage' && hitDrone.weak).toBe(true);
    const b2 = new Battle(party(['hex'], 5), enemyParty(['smog_wisp']), new Rng(3));
    const ev2 = b2.resolveRound([{ actor: 0, type: 'tech', id: 'spike', target: 10 }]);
    const hitWisp = ev2.find((e) => e.t === 'damage' && e.target === 10);
    expect(hitWisp && hitWisp.t === 'damage' && hitWisp.amount).toBe(0);
  });

  it('the Warden transforms into its spirit form instead of dying', () => {
    const p = party(['kit', 'rook', 'hex', 'sable'], 10);
    const b = new Battle(p, enemyParty(['warden']), new Rng(5));
    b.enemies[0]!.hp = 1;
    const ev = b.resolveRound(p.map((u) => ({ actor: u.uid, type: 'attack' as const, target: 10 })));
    expect(ev.some((e) => e.t === 'phase' && e.key === 'warden_spirit')).toBe(true);
    expect(b.outcome).toBe(null);
    expect(b.enemies[0]!.key).toBe('warden_spirit');
  });

  it('running from a boss is refused', () => {
    const b = new Battle(party(['kit'], 5), enemyParty(['knuckles']), new Rng(2));
    const ev = b.resolveRound([{ actor: 0, type: 'run' }]);
    expect(ev.some((e) => e.t === 'flee' && !e.ok)).toBe(true);
    expect(b.outcome).not.toBe('fled');
  });
});

describe('hijack', () => {
  it('a hijacked machine turns one of its own damaging moves on its allies', () => {
    const own = new Set(ENEMIES.hunter_drone!.moves.map((m) => ABILITIES[m.id]!).filter((a) => a.effects.some((e) => e.type === 'damage')).map((a) => a.name));
    for (let seed = 1; seed <= 20; seed++) {
      const b = new Battle(party(['kit'], 5), enemyParty(['hunter_drone', 'km_sentinel']), new Rng(seed));
      const [drone, guard] = b.enemies;
      drone!.status.push({ id: 'hijacked', turns: 3 });
      const hpBefore = guard!.hp;
      const ev = b.resolveRound([{ actor: b.party[0]!.uid, type: 'guard' }]);
      const act = ev.find((e) => e.t === 'act' && e.actor === drone!.uid);
      expect(act && act.t === 'act' && act.name.startsWith('Hijacked: ')).toBe(true);
      if (act?.t === 'act') expect(own.has(act.name.slice('Hijacked: '.length))).toBe(true);
      if (act?.t === 'act') expect(act.targets).toEqual([guard!.uid]);
      expect(guard!.hp).toBeLessThanOrEqual(hpBefore);
    }
  });
});

describe('maps', () => {
  it('every prop kind placed on a map has a painter', async () => {
    const { PROPS } = await import('../src/field/props');
    const { getMap, mapIds } = await import('../src/data/maps');
    for (const id of mapIds()) for (const p of getMap(id).props ?? []) expect(PROPS[p.kind], `${id}: ${p.kind}`).toBeDefined();
  });
});
