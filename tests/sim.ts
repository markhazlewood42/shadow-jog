/** Headless combat simulator with a "competent player" policy, for balance checks. */
import { Battle } from '../src/battle/engine';
import { enemyParty, partyCombatant } from '../src/battle/setup';
import type { Combatant, Command } from '../src/battle/types';
import { ABILITIES } from '../src/data/abilities';
import { ENCOUNTERS } from '../src/data/enemies';
import { createMember, knownAbilities } from '../src/game/party';
import type { EquipSlot, MemberId, MemberState } from '../src/game/state';
import { Rng } from '../src/engine/rng';

export interface Loadout {
  id: MemberId;
  level: number;
  equip?: Partial<Record<EquipSlot, string>>;
}

export interface SimResult {
  label: string;
  wins: number;
  n: number;
  rounds: number;
  hpLostPct: number;
  combos: number;
  /** Abilities and combos the policy used at least once. */
  used: Set<string>;
}

function has(c: Combatant, id: string, b: Battle): boolean {
  const ab = ABILITIES[id];
  if (!ab) return false;
  if (!knownAbilities({ id: c.key as MemberId, level: c.level } as MemberState).includes(id)) return false;
  if (ab.kind === 'tech') return c.tp >= (ab.cost ?? 0);
  if (ab.kind === 'skill') return (c.uses[id] ?? 0) > 0;
  void b;
  return true;
}

export interface Bag {
  medkit: number;
}

const hasStatus = (c: Combatant, id: string) => c.status.some((s) => s.id === id);
const frac = (c: Combatant) => c.hp / c.base.maxHp;

/**
 * "Competent player" policy. Heals when hurt, reads the enemy family (Iron Palm and Crow Spirit
 * for spirits, Spike/Overload for machines, Scramble for gunmen), buffs before a boss hits hard,
 * and in boss fights sets up combos on purpose. Every learnable ability and all six combos get used
 * somewhere across the stage table (see the ability-coverage test).
 */
export function policy(b: Battle, useCombos: boolean, bag: Bag = { medkit: 0 }, conserve = false): Command[] {
  const cmds: Command[] = [];
  const party = b.alive('party');
  const foes = b.alive('enemy');
  const boss = foes.find((f) => f.boss);
  const spirit = foes.find((f) => f.family === 'spirit');
  const machines = foes.filter((f) => f.family === 'machine');
  const humans = foes.filter((f) => f.family === 'human');
  const hurt = party.filter((p) => frac(p) < 0.45).sort((a, c) => a.hp - c.hp);
  const weakest = [...foes].sort((a, c) => a.hp - c.hp)[0]!;
  const focus = boss ?? weakest;
  const solid = (spirit ? foes.find((f) => f.family !== 'spirit') : undefined) ?? focus;
  const byKey = (k: string) => party.find((p) => p.key === k);
  const kit = byKey('kit'), rook = byKey('rook'), hex = byKey('hex'), sable = byKey('sable');
  const free = (u: Combatant | undefined) => !!u && !cmds.some((c) => c.actor === u.uid);
  const give = (u: Combatant | undefined, type: Command['type'], id?: string, target = focus.uid) => {
    if (u && free(u)) cmds.push({ actor: u.uid, type, id, target });
  };
  const kind = (id: string): Command['type'] => (ABILITIES[id]!.kind === 'skill' ? 'skill' : 'tech');
  // Mid-dungeon, TP goes only where nothing else will do (spirits, healing, machine packs).
  const luxury = conserve ? new Set(['hundred_rain', 'firebrand', 'wildfire', 'dragon_coil', 'flash_step', ...(spirit ? [] : ['crow_spirit'])]) : new Set<string>();
  const can = (u: Combatant | undefined, id: string) => free(u) && !luxury.has(id) && has(u!, id, b);
  const pair = (u1: Combatant | undefined, a1: string, u2: Combatant | undefined, a2: string, target = focus.uid) => {
    if (!can(u1, a1) || !can(u2, a2)) return;
    give(u1, kind(a1), a1, target);
    give(u2, kind(a2), a2, target);
  };

  // Emergency medkit: one per round, for anyone below 30% HP, used by the healthiest member.
  const critical = party.filter((p) => frac(p) < 0.3).sort((x, y) => x.hp - y.hp)[0];
  if (critical && bag.medkit > 0 && !(sable && sable.tp >= 3)) {
    const user = [...party].sort((x, y) => frac(y) - frac(x))[0]!;
    give(user, 'item', 'medkit', critical.uid);
  }

  // Deliberate combos when they matter: bosses, or big packs.
  if (useCombos && (boss || foes.length >= 3)) {
    if (hurt.length >= 2) pair(sable, 'mending_rain', hex, 'patch', hurt[0]!.uid);
    if (spirit && boss) pair(hex, 'spike', kit, 'iron_palm', spirit.uid);
    if (foes.length >= 3) pair(sable, 'crow_spirit', kit, 'hundred_rain');
    if (machines.length >= 2 || (boss && machines.length)) pair(sable, 'firebrand', hex, 'overload');
    if (boss && boss.family !== 'spirit') pair(kit, 'flash_step', rook, 'arc_cut');
    if (foes.length >= 3 && !hasStatus(foes[0]!, 'exposed')) pair(hex, 'analyze', rook, 'quickdraw', foes[0]!.uid);
  }

  // A telegraphed party-wide attack is coming: ward up, and the badly hurt brace.
  if (boss?.memory.breath) {
    if (!party.some((p) => hasStatus(p, 'res_up')) && can(sable, 'spirit_ward')) give(sable, 'skill', 'spirit_ward');
    for (const p of party) if (p !== sable && frac(p) < 0.5) give(p, 'guard');
  }

  for (const u of party) {
    if (!free(u)) continue;
    if (u.key === 'sable') {
      const down = b.party.find((p) => p.hp <= 0);
      const sick = party.find((p) => hasStatus(p, 'poison') || hasStatus(p, 'blind'));
      if (down && can(u, 'rekindle')) give(u, 'tech', 'rekindle', down.uid);
      else if (hurt.length >= 2 && can(u, 'mending_rain')) give(u, 'tech', 'mending_rain');
      else if (hurt.length && can(u, 'mend')) give(u, 'tech', 'mend', hurt[0]!.uid);
      else if (sick && can(u, 'purge')) give(u, 'tech', 'purge', sick.uid);
      else if (boss?.family === 'spirit' && !party.some((p) => hasStatus(p, 'res_up')) && can(u, 'spirit_ward')) give(u, 'skill', 'spirit_ward');
      else if ((spirit || foes.length >= 3) && can(u, 'wildfire')) give(u, 'tech', 'wildfire');
      else if ((spirit || foes.length >= 3) && can(u, 'crow_spirit')) give(u, 'tech', 'crow_spirit');
      else if (can(u, 'firebrand') && u.tp > u.base.maxTp * 0.4 && focus.family !== 'machine') give(u, 'tech', 'firebrand');
      else give(u, 'attack', undefined, solid.uid);
    } else if (u.key === 'hex') {
      const drone = machines.find((m) => !m.boss);
      if (hurt.length && can(u, 'patch') && !sable) give(u, 'tech', 'patch', hurt[0]!.uid);
      else if (boss && !boss.analyzed && can(u, 'analyze')) give(u, 'skill', 'analyze', boss.uid);
      else if (boss && boss.family === 'machine' && !party.some((p) => hasStatus(p, 'def_up')) && can(u, 'firewall')) give(u, 'tech', 'firewall');
      else if (drone && can(u, 'hijack')) give(u, 'tech', 'hijack', drone.uid);
      else if (machines.length >= 2 && can(u, 'overload')) give(u, 'tech', 'overload');
      else if (machines.length && can(u, 'spike')) give(u, 'tech', 'spike', (boss && boss.family === 'machine' ? boss : machines[0]!).uid);
      else if (humans.length >= 2 && b.round === 1 && can(u, 'scramble')) give(u, 'tech', 'scramble', humans[0]!.uid);
      else give(u, 'attack', undefined, solid.uid);
    } else if (u.key === 'kit') {
      if (frac(u) < 0.3 && can(u, 'second_wind')) give(u, 'skill', 'second_wind');
      else if (frac(u) < 0.45 && !sable && can(u, 'focus_breath')) give(u, 'tech', 'focus_breath');
      else if (foes.length >= 2 && !boss && b.round === 1 && can(u, 'killing_intent')) give(u, 'skill', 'killing_intent');
      else if (spirit && can(u, 'iron_palm')) give(u, 'tech', 'iron_palm', spirit.uid);
      else if (boss && boss.hp > 200 && can(u, 'dragon_coil')) give(u, 'tech', 'dragon_coil');
      else if (foes.length >= 3 && can(u, 'hundred_rain')) give(u, 'tech', 'hundred_rain');
      else if (boss && can(u, 'flash_step')) give(u, 'tech', 'flash_step');
      else give(u, 'attack', undefined, solid.uid);
    } else {
      const ward = party.find((p) => p !== u && frac(p) < 0.35);
      if (boss && ward && can(u, 'guardian')) give(u, 'skill', 'guardian');
      else if (boss && frac(u) < 0.5 && can(u, 'stim_rush')) give(u, 'skill', 'stim_rush');
      else if (boss && boss.hp > 250 && can(u, 'moonfall')) give(u, 'skill', 'moonfall');
      else if (foes.length >= 3 && can(u, 'quickdraw')) give(u, 'skill', 'quickdraw');
      else if (foes.length >= 2 && b.round === 1 && humans.length && can(u, 'suppress')) give(u, 'skill', 'suppress');
      else if (boss && can(u, 'arc_cut')) give(u, 'skill', 'arc_cut');
      else if (weakest.hp > 40 && can(u, 'arc_cut') && (u.uses.arc_cut ?? 0) > 2) give(u, 'skill', 'arc_cut', weakest.uid);
      else give(u, 'attack', undefined, solid.uid);
    }
  }
  return cmds;
}

export function buildParty(loadout: Loadout[]): Combatant[] {
  return loadout.map((l, i) => {
    const m = createMember(l.id, l.level);
    if (l.equip) Object.assign(m.equip, l.equip);
    // Recompute HP/TP to max after gear.
    const c = partyCombatant(m, i, i);
    c.hp = c.base.maxHp;
    c.tp = c.base.maxTp;
    return c;
  });
}

export function simulate(label: string, loadout: Loadout[], table: string, n = 200, seed = 1, useCombos = true): SimResult {
  const rng = new Rng(seed);
  let wins = 0, rounds = 0, lost = 0, combos = 0;
  const used = new Set<string>();
  const groups = ENCOUNTERS[table]!;
  for (let i = 0; i < n; i++) {
    const g = groups[i % groups.length]!;
    const p = buildParty(loadout);
    const maxHp = p.reduce((s, c) => s + c.base.maxHp, 0);
    const bag: Bag = { medkit: 2 };
    const b = new Battle(p, enemyParty(g.e), new Rng(rng.int(1, 1e9)), { useItem: () => (bag.medkit > 0 ? (bag.medkit--, true) : false) });
    while (!b.outcome && b.round < 60) {
      const cmds = policy(b, useCombos, bag);
      for (const c of cmds) if ((c.type === 'tech' || c.type === 'skill') && c.id) used.add(c.id);
      b.resolveRound(cmds);
    }
    for (const c of b.combosUsed) used.add(c);
    if (b.outcome === 'win') wins++;
    rounds += b.round;
    combos += b.combosUsed.length;
    const hpNow = p.reduce((s, c) => s + Math.max(0, c.hp), 0);
    lost += 1 - hpNow / maxHp;
  }
  return { label, wins, n, rounds: rounds / n, hpLostPct: (lost / n) * 100, combos: combos / n, used };
}

export function fmt(r: SimResult): string {
  return `${r.label.padEnd(28)} win ${((r.wins / r.n) * 100).toFixed(0).padStart(3)}%  rounds ${r.rounds.toFixed(1).padStart(4)}  hp lost ${r.hpLostPct.toFixed(0).padStart(3)}%  combos/battle ${r.combos.toFixed(2)}`;
}

export interface RunResult {
  label: string;
  cleared: number;
  n: number;
  endHpPct: number;
  medkitsUsed: number;
  roundsPerBattle: number;
  /** Where runs ended: "group @fight outcome" → count. */
  fails: Record<string, number>;
}

/** What the player carries into a dungeon. */
export interface Supplies {
  medkit: number;
  stim: number;
  detox?: number;
  neurotab?: number;
}

/**
 * Dungeon attrition: `battles` fights in a row with no rest. HP/TP/skill uses carry over, and
 * the policy conserves TP for what needs it. Between fights the player field-heals (Mend /
 * Patch, keeping a reserve), cures poison (Purge or a Detox Shot), revives with a stim, medkits
 * anyone under 65%, and tops up an empty Kit or Sable with a Neurotab.
 */
export function simulateRun(label: string, loadout: Loadout[], table: string, battles: number, kit: Supplies, n = 60, seed = 3): RunResult {
  const rng = new Rng(seed);
  const groups = ENCOUNTERS[table]!;
  let cleared = 0, endHp = 0, used = 0, rounds = 0, fights = 0;
  const fails: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const p = buildParty(loadout);
    const bag = { ...kit, detox: kit.detox ?? 0, neurotab: kit.neurotab ?? 0 };
    let ok = true;
    for (let k = 0; k < battles; k++) {
      const g = rng.pick(groups);
      const b = new Battle(p, enemyParty(g.e), new Rng(rng.int(1, 1e9)), { useItem: () => (bag.medkit > 0 ? (bag.medkit--, used++, true) : false) });
      while (!b.outcome && b.round < 60) b.resolveRound(policy(b, false, bag, true));
      rounds += b.round;
      fights++;
      if (b.outcome !== 'win') {
        const f = `${g.e.join('+')} @${k + 1} ${b.outcome ?? 'stalled'}`;
        fails[f] = (fails[f] ?? 0) + 1;
        ok = false;
        break;
      }
      for (const c of p) if (c.hp <= 0 && bag.stim > 0) { bag.stim--; c.hp = Math.round(c.base.maxHp * 0.3); }
      // Field heals first (Sable's Mend / Hex's Patch), keeping a TP reserve for the next fight.
      for (const healer of p.filter((c) => c.hp > 0 && (c.key === 'sable' || c.key === 'hex'))) {
        const id = healer.key === 'sable' ? 'mend' : 'patch';
        if (healer.level < (id === 'patch' ? 3 : 1)) continue;
        const ab = ABILITIES[id]!;
        for (const c of p) {
          while (c.hp > 0 && c.hp < c.base.maxHp * 0.7 && healer.tp - (ab.cost ?? 0) >= healer.base.maxTp * 0.3) {
            healer.tp -= ab.cost ?? 0;
            c.hp = Math.min(c.base.maxHp, c.hp + Math.round(((ab.effects[0] as { power: number }).power ?? 0) + healer.base.mnd * 1.5));
          }
        }
      }
      const sable = p.find((c) => c.key === 'sable' && c.hp > 0 && c.level >= 3);
      for (const c of p) {
        c.status = c.status.filter((s) => s.id === 'poison');
        if (c.status.length && sable && sable.tp - 3 >= sable.base.maxTp * 0.3) { sable.tp -= 3; c.status = []; }
        else if (c.status.length && bag.detox > 0) { bag.detox--; c.status = []; }
        while (c.hp > 0 && c.hp < c.base.maxHp * 0.65 && bag.medkit > 0) { bag.medkit--; used++; c.hp = Math.min(c.base.maxHp, c.hp + 60); }
        if ((c.key === 'kit' || c.key === 'sable') && c.hp > 0 && c.tp < c.base.maxTp * 0.25 && bag.neurotab > 0) { bag.neurotab--; c.tp = Math.min(c.base.maxTp, c.tp + 20); }
      }
    }
    if (ok) cleared++;
    endHp += p.reduce((s, c) => s + Math.max(0, c.hp) / c.base.maxHp, 0) / p.length;
  }
  return { label, cleared, n, endHpPct: (endHp / n) * 100, medkitsUsed: used / n, roundsPerBattle: rounds / fights, fails };
}

export function fmtRun(r: RunResult): string {
  const fails = Object.entries(r.fails).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(', ');
  return `${r.label.padEnd(28)} cleared ${((r.cleared / r.n) * 100).toFixed(0).padStart(3)}%  end hp ${r.endHpPct.toFixed(0).padStart(3)}%  medkits ${r.medkitsUsed.toFixed(1)}  rounds/battle ${r.roundsPerBattle.toFixed(1)}${fails ? `\n    lost to: ${fails}` : ''}`;
}
