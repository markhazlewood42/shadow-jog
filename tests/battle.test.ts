import { describe, expect, it } from 'vitest';
import { BRACE_MULT, Battle, STRIKE_MULT } from '../src/battle/engine';
import { enemyParty, partyCombatant } from '../src/battle/setup';
import type { Combatant, Command } from '../src/battle/types';
import { ABILITIES, CH1_STORY_FLAGS, COMBOS, LEARNSETS } from '../src/data/abilities';
import { ENCOUNTERS, ENEMIES, FAMILY_WEAK } from '../src/data/enemies';
import { ITEMS } from '../src/data/items';
import { levelForXp, xpFor } from '../src/data/party';
import { createMember, grantXp, isWounded, knownAbilities, maxUses, memberStats } from '../src/game/party';
import { flags, type MemberId } from '../src/game/state';
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
      expect(new Set(c.parts.map((p) => p.member)).size, c.id).toBe(c.parts.length);
      expect(c.parts.map((p) => p.member), `${c.id} caller`).toContain(c.call.member);
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
    expect(ups.flatMap((u) => u.learned)).toContain('hundred_rain');
  });

  it('a level-up is a full recovery: HP, TP and charges', () => {
    const m = createMember('kit', 1);
    m.hp = 1;
    m.tp = 0;
    m.uses.second_wind = 0;
    grantXp(m, xpFor(2));
    const s = memberStats(m);
    expect(m.hp).toBe(s.maxHp);
    expect(m.tp).toBe(s.maxTp);
    expect(m.uses.second_wind).toBe(ABILITIES.second_wind!.uses);
  });

  it('new abilities are rare: Chapter 1 teaches three by level, the rest by story', () => {
    // Levels 1 to 6 (where Chapter 1 ends): what each member learns on a level-up, not on joining.
    const joins: Record<string, number> = { kit: 1, hex: 3, sable: 5 };
    const byLevel = Object.entries(joins).flatMap(([who, from]) => (LEARNSETS[who] ?? []).filter((l) => !l.flag && l.level > from && l.level <= 6));
    expect(byLevel.map((l) => l.id).sort()).toEqual(['hundred_rain', 'iron_palm', 'scramble']);
  });

  it('Rook starts a wounded veteran: locked skills and a charge short, until the story mends him', () => {
    for (const f of CH1_STORY_FLAGS) flags.clear(f);
    try {
      const rook = createMember('rook');
      expect(rook.level).toBe(10);
      expect(knownAbilities(rook, 'skill').sort()).toEqual(['arc_cut', 'quickdraw']);
      expect(isWounded('rook')).toBe(true);
      expect(maxUses('rook', 'arc_cut')).toBe((ABILITIES.arc_cut!.uses ?? 1) - 1);
      const hurt = memberStats(rook);
      flags.set('rook_tuned');
      expect(knownAbilities(rook, 'skill')).toEqual(expect.arrayContaining(['suppress', 'incendiary']));
      expect(knownAbilities(rook, 'skill')).not.toContain('guardian');
      flags.set('rook_mended');
      expect(isWounded('rook')).toBe(false);
      expect(knownAbilities(rook, 'skill')).toEqual(expect.arrayContaining(['guardian', 'stim_rush']));
      expect(knownAbilities(rook, 'skill')).not.toContain('moonfall');
      const whole = memberStats(rook);
      expect(whole.maxHp).toBeGreaterThan(hurt.maxHp);
      expect(whole.atk).toBeGreaterThan(hurt.atk);
    } finally {
      for (const f of CH1_STORY_FLAGS) flags.clear(f);
    }
  });

  it('a new game starts Kit at 1 and Rook at his veteran 10, wounded (round 13 found it starting him at 3)', async () => {
    const { freshGame } = await import('../src/game/newgame');
    // Through the module: freshGame replaces the state object, so a destructured copy would be stale.
    const st = await import('../src/game/state');
    freshGame();
    expect(st.state.members.kit!.level).toBe(1);
    expect(st.state.members.rook!.level).toBe(10);
    expect(st.state.members.rook!.xp).toBe(xpFor(10));
    expect(isWounded('rook')).toBe(true);
    expect(st.state.members.rook!.hp).toBe(memberStats(st.state.members.rook!).maxHp);
  });

  it('the Stingray unlocks Overload, not a level', () => {
    for (const f of CH1_STORY_FLAGS) flags.clear(f);
    try {
      const hex = createMember('hex', 6);
      expect(knownAbilities(hex)).not.toContain('overload');
      flags.set('stingray_seated');
      expect(knownAbilities(hex)).toContain('overload');
    } finally {
      for (const f of CH1_STORY_FLAGS) flags.clear(f);
    }
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

describe('support roles and field notes', () => {
  it('a Shell Wall crab takes single-target hits aimed at its packmate', () => {
    const b = new Battle(party(['kit'], 6), enemyParty(['rust_crab', 'sewer_ghoul']), new Rng(4));
    const [crab, ghoul] = b.enemies;
    crab!.status.push({ id: 'cover', turns: 2 });
    const ev = b.resolveRound([{ actor: b.party[0]!.uid, type: 'attack', target: ghoul!.uid }]);
    const hit = ev.find((e) => e.t === 'damage' && b.unit(e.target)?.side === 'enemy');
    expect(hit?.t === 'damage' && hit.target).toBe(crab!.uid);
    expect(ev.some((e) => e.t === 'msg' && e.text.includes('steps in front'))).toBe(true);
  });

  it('the crab only raises Shell Wall once a packmate is hurt', () => {
    let walls = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const b = new Battle(party(['kit'], 6), enemyParty(['rust_crab', 'sewer_ghoul']), new Rng(seed));
      const ev = b.resolveRound([{ actor: b.party[0]!.uid, type: 'guard' }]);
      expect(ev.some((e) => e.t === 'act' && e.name === 'Shell Wall')).toBe(false); // everyone healthy
      b.enemies[1]!.hp = 10;
      const ev2 = b.resolveRound([{ actor: b.party[0]!.uid, type: 'guard' }]);
      if (ev2.some((e) => e.t === 'act' && e.name === 'Shell Wall')) walls++;
    }
    expect(walls).toBeGreaterThan(10);
  });

  it('a status an enemy is immune to reports a structured immune event', () => {
    // Spirits can't be blinded: Crow Spirit's blind rider bounces off every time, not by chance.
    const b = new Battle(party(['sable'], 8), enemyParty(['drowned_shade', 'drowned_shade']), new Rng(2));
    for (const e of b.enemies) e.hp = 5000;
    const ev = b.resolveRound([{ actor: b.party[0]!.uid, type: 'tech', id: 'crow_spirit', target: -1 }]);
    const immune = ev.filter((e) => e.t === 'immune');
    expect(immune.length).toBe(2);
    expect(immune.every((e) => e.t === 'immune' && e.status === 'blind')).toBe(true);
  });
});

describe('enemy wind-ups', () => {
  const guardAll = (b: Battle): Command[] => b.alive('party').map((u) => ({ actor: u.uid, type: 'guard' as const }));

  it('a turret spins up (telegraphed), then sweeps the whole crew next turn', () => {
    const b = new Battle(party(['kit', 'rook'], 8), enemyParty(['sentry_turret']), new Rng(3));
    const all: string[] = [];
    for (let r = 0; r < 4 && !b.outcome; r++) {
      for (const e of b.resolveRound(guardAll(b))) if (e.t === 'msg' || e.t === 'act') all.push(e.t === 'msg' ? e.text : e.name);
    }
    const spin = all.findIndex((t) => t.includes('spins up'));
    expect(spin).toBeGreaterThanOrEqual(0);
    expect(all.slice(spin + 1)).toContain('Full Auto');
  });

  it('jamming a spinning turret spins it down: no sweep', () => {
    const b = new Battle(party(['kit', 'rook'], 8), enemyParty(['sentry_turret']), new Rng(3));
    b.resolveRound(guardAll(b));
    b.resolveRound(guardAll(b)); // turn 2: spins up
    const turret = b.enemies[0]!;
    expect(turret.memory.spin).toBe(1);
    turret.status.push({ id: 'jammed', turns: 1 });
    const ev = b.resolveRound(guardAll(b));
    expect(ev.some((e) => e.t === 'msg' && e.text.includes('spin down'))).toBe(true);
    expect(ev.some((e) => e.t === 'act' && e.name === 'Full Auto')).toBe(false);
  });

  it('Knuckles names his mark a turn ahead, then swings the wound-up haymaker at exactly them', () => {
    let seen = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const b = new Battle(party(['kit', 'rook'], 4), enemyParty(['knuckles']), new Rng(seed));
      b.enemies[0]!.hp = 99999;
      let marked: string | null = null;
      for (let r = 0; r < 6 && !b.outcome; r++) {
        for (const p of b.party) p.hp = p.base.maxHp;
        const ev = b.resolveRound(b.party.map((p) => ({ actor: p.uid, type: 'guard' as const })));
        const hit = ev.find((e) => e.t === 'act' && e.name === 'Wound-Up Haymaker');
        if (hit && hit.t === 'act') {
          expect(marked, `seed ${seed}: swung without squaring up first`).not.toBeNull();
          expect(b.unit(hit.targets[0]!)?.name).toBe(marked);
          seen++;
          marked = null;
        }
        const tell = ev.find((e) => e.t === 'msg' && e.text.includes('squares up to'));
        if (tell && tell.t === 'msg') marked = tell.text.replace(/.*squares up to (.*)\.$/, '$1');
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('the Arcanist’s surge breaks under enough damage while she draws it', () => {
    const b = new Battle(party(['kit', 'rook'], 8), enemyParty(['km_arcanist']), new Rng(3));
    const arc = b.enemies[0]!;
    arc.hp = arc.base.maxHp;
    let broke = false, fired = false;
    for (let r = 0; r < 12 && !b.outcome; r++) {
      for (const p of b.party) p.hp = p.base.maxHp;
      const drawing = !!arc.memory.surge;
      // While she draws, knock a quarter off her; otherwise leave her be.
      if (drawing) arc.hp = Math.max(1, arc.hp - Math.ceil(arc.base.maxHp * 0.25));
      const ev = b.resolveRound(b.party.map((p) => ({ actor: p.uid, type: 'guard' as const })));
      if (ev.some((e) => e.t === 'msg' && e.text.includes('surge breaks apart'))) broke = true;
      if (ev.some((e) => e.t === 'act' && e.name === 'Mana Surge')) fired = true;
      arc.hp = Math.max(arc.hp, Math.ceil(arc.base.maxHp * 0.6));
    }
    expect(broke).toBe(true);
    expect(fired).toBe(false);
  });

  it('Guard pays TP back only off a blow it actually takes', () => {
    let hits = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const b = new Battle(party(['hex'], 6), enemyParty(['glowrat']), new Rng(seed));
      const hex = b.party[0]!;
      b.enemies[0]!.hp = 9999;
      for (let r = 0; r < 4; r++) {
        hex.hp = hex.base.maxHp;
        hex.tp = 0;
        const ev = b.resolveRound([{ actor: hex.uid, type: 'guard' }]);
        const hit = ev.some((e) => e.t === 'damage' && e.target === hex.uid && e.amount > 0);
        const tp = ev.some((e) => e.t === 'tp' && e.target === hex.uid && e.amount >= 2);
        expect(tp, `seed ${seed} round ${r}`).toBe(hit);
        if (hit) hits++;
      }
    }
    expect(hits).toBeGreaterThan(0);
  });

  it('orders naming a missing unit are dropped, not carried into the round', () => {
    const b = new Battle(party(['kit', 'rook'], 6), enemyParty(['glowrat']), new Rng(2));
    const [kit, rook] = b.party;
    expect(() =>
      b.resolveRound([
        { actor: 999, type: 'tech', id: 'flash_step', target: -1 },
        { actor: rook!.uid, type: 'skill', id: 'arc_cut', target: 12345 },
        { actor: kit!.uid, type: 'attack', target: -1 },
      ]),
    ).not.toThrow();
  });

  it('Guardian says so when a blast hits the crew it can’t cover', () => {
    // The Warden favours Suppression Grid (party-wide): over a few rounds it will fire one.
    let said = false;
    for (let seed = 1; seed <= 10 && !said; seed++) {
      const b = new Battle(party(['rook', 'kit'], 12), enemyParty(['warden']), new Rng(seed));
      for (let r = 0; r < 4 && !said && !b.outcome; r++) {
        const rook = b.party[0]!;
        rook.hp = rook.base.maxHp;
        b.party[1]!.hp = b.party[1]!.base.maxHp;
        const ev = b.resolveRound([{ actor: rook.uid, type: 'skill', id: 'guardian' }, { actor: b.party[1]!.uid, type: 'guard' }]);
        said = ev.some((e) => e.t === 'msg' && e.text.includes('can’t cover a blast'));
        rook.uses.guardian = 3;
      }
    }
    expect(said).toBe(true);
  });

  it('guarding against nothing earns nothing: Guard/Attack is not a TP battery', () => {
    const b = new Battle(party(['hex'], 6), enemyParty(['glowrat']), new Rng(1));
    const hex = b.party[0]!;
    const rat = b.enemies[0]!;
    rat.hp = 9999;
    hex.tp = 0;
    for (let r = 0; r < 6; r++) {
      // The rat is held (stunned) every round: nothing ever lands on the guard.
      rat.status = [{ id: 'stun', turns: 2 }];
      const cmd: Command = r % 2 ? { actor: hex.uid, type: 'attack', target: rat.uid } : { actor: hex.uid, type: 'guard' };
      const ev = b.resolveRound([cmd]);
      expect(ev.some((e) => e.t === 'tp' && e.target === hex.uid)).toBe(false);
    }
    expect(hex.tp).toBe(0);
  });

  it('Rook, who has no TP, gets one spent charge back off a guarded blow, once a fight', () => {
    let got = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const b = new Battle(party(['rook'], 8), enemyParty(['glowrat']), new Rng(seed));
      const rook = b.party[0]!;
      b.enemies[0]!.hp = 9999;
      rook.uses.arc_cut = 0;
      let backs = 0;
      for (let r = 0; r < 5; r++) {
        rook.hp = rook.base.maxHp;
        const ev = b.resolveRound([{ actor: rook.uid, type: 'guard' }]);
        if (ev.some((e) => e.t === 'msg' && e.text.includes('one more'))) backs++;
      }
      expect(backs).toBeLessThanOrEqual(1);
      if (backs) expect(rook.uses.arc_cut).toBe(1);
      got += backs;
    }
    expect(got).toBeGreaterThan(0);
  });

  it('a target just out of a stun can’t be stunned again for two rounds', () => {
    const b = new Battle(party(['kit'], 12), enemyParty(['glowrat', 'glowrat']), new Rng(4));
    const kit = b.party[0]!;
    for (const e of b.enemies) e.hp = 9999;
    const stunnedEach: number[][] = [];
    for (let r = 0; r < 6; r++) {
      kit.uses.killing_intent = 2;
      kit.hp = kit.base.maxHp;
      const ev = b.resolveRound([{ actor: kit.uid, type: 'skill', id: 'killing_intent' }]);
      stunnedEach.push(ev.filter((e) => e.t === 'status' && e.status === 'stun' && e.on).map((e) => (e as { target: number }).target));
    }
    for (const e of b.enemies) {
      const rounds = stunnedEach.flatMap((uids, r) => (uids.includes(e.uid) ? [r] : []));
      for (let i = 1; i < rounds.length; i++) expect(rounds[i]! - rounds[i - 1]!, `${e.uid} restunned`).toBeGreaterThan(2);
    }
  });

  it('a press off the beat costs: a softer strike, a harder blow taken', () => {
    for (const p of ['quick', 'normal', 'heavy'] as const) {
      expect(STRIKE_MULT[p].whiff).toBeLessThan(1);
      expect(BRACE_MULT[p].whiff).toBeGreaterThan(1);
      expect(STRIKE_MULT[p].perfect).toBeGreaterThan(STRIKE_MULT[p].good);
    }
  });

  it('every enemy family has at least one elemental weakness to find', () => {
    for (const [fam, w] of Object.entries(FAMILY_WEAK)) {
      expect(Object.values(w).some((m) => m > 1), fam).toBe(true);
    }
  });

  it('the Warden pays out: breaking the mech always frees the spirit, and the spirit carries the reward', () => {
    const b = new Battle(party(['kit', 'rook'], 12), enemyParty(['warden']), new Rng(3));
    const mech = b.enemies[0]!;
    mech.hp = 1;
    const hitAll = () => b.resolveRound(b.alive('party').map((u) => ({ actor: u.uid, type: 'attack' as const, target: b.alive('enemy')[0]?.uid ?? -1 })));
    for (let i = 0; i < 6 && !b.alive('enemy').some((e) => e.key === 'warden_spirit'); i++) hitAll();
    // Killing the mech is not a win: the phase change fires first.
    expect(b.outcome).toBeNull();
    const spirit = b.alive('enemy').find((e) => e.key === 'warden_spirit');
    expect(spirit).toBeDefined();
    expect(b.rewards().xp).toBe(0);
    spirit!.hp = 1;
    for (let i = 0; i < 12 && !b.outcome; i++) {
      for (const p of b.party) p.hp = p.base.maxHp;
      hitAll();
    }
    expect(b.outcome).toBe('win');
    expect(b.rewards().xp).toBe(ENEMIES.warden_spirit!.xp);
    expect(b.rewards().cred).toBe(ENEMIES.warden_spirit!.cred);
  });

  it('a random multi-hit spreads across targets before doubling up', () => {
    const b = new Battle(party(['kit'], 12), enemyParty(['sewer_ghoul', 'sewer_ghoul', 'sewer_ghoul']), new Rng(5));
    for (const e of b.enemies) e.hp = 9999;
    const kit = b.party[0]!;
    kit.tp = 99;
    const ev = b.resolveRound([{ actor: kit.uid, type: 'tech', id: 'hundred_rain', target: -1 }]);
    const hits = ev.filter((e) => e.t === 'damage' && b.unit(e.target)?.side === 'enemy').map((e) => (e.t === 'damage' ? e.target : -1));
    const per = b.enemies.map((u) => hits.filter((h) => h === u.uid).length);
    expect(Math.max(...per) - Math.min(...per)).toBeLessThanOrEqual(1);
  });
});

describe('maps', () => {
  it('every prop kind placed on a map has a painter', async () => {
    const { PROPS } = await import('../src/field/props');
    const { getMap, mapIds } = await import('../src/data/maps');
    for (const id of mapIds()) for (const p of getMap(id).props ?? []) expect(PROPS[p.kind], `${id}: ${p.kind}`).toBeDefined();
  });
});
