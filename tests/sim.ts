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

/** Policy: heal when hurt, exploit weaknesses, fire combos in boss fights. */
function policy(b: Battle, useCombos: boolean): Command[] {
  const cmds: Command[] = [];
  const party = b.alive('party');
  const foes = b.alive('enemy');
  const hurt = party.filter((p) => p.hp / p.base.maxHp < 0.45).sort((a, c) => a.hp - c.hp);
  const target = [...foes].sort((a, c) => a.hp - c.hp)[0]!;
  const byKey = (k: string) => party.find((p) => p.key === k);
  const kit = byKey('kit'), rook = byKey('rook');
  const boss = foes.some((f) => f.boss);
  if (useCombos && boss && kit && rook && has(kit, 'flash_step', b) && has(rook, 'arc_cut', b) && foes[0]!.family !== 'spirit') {
    cmds.push({ actor: kit.uid, type: 'tech', id: 'flash_step', target: foes[0]!.uid });
    cmds.push({ actor: rook.uid, type: 'skill', id: 'arc_cut', target: foes[0]!.uid });
  }
  for (const u of party) {
    if (cmds.some((c) => c.actor === u.uid)) continue;
    const machine = foes.find((f) => f.family === 'machine');
    const spirit = foes.find((f) => f.family === 'spirit');
    const push = (type: Command['type'], id?: string, t = target.uid) => cmds.push({ actor: u.uid, type, id, target: t });
    if (u.key === 'sable') {
      if (hurt.length >= 2 && has(u, 'mending_rain', b)) push('tech', 'mending_rain');
      else if (hurt.length && has(u, 'mend', b)) push('tech', 'mend', hurt[0]!.uid);
      else if (spirit && has(u, 'crow_spirit', b)) push('tech', 'crow_spirit');
      else if (has(u, 'firebrand', b) && u.tp > u.base.maxTp * 0.4) push('tech', 'firebrand');
      else push('attack');
    } else if (u.key === 'hex') {
      if (hurt.length && has(u, 'patch', b) && !byKey('sable')) push('tech', 'patch', hurt[0]!.uid);
      else if (machine && foes.filter((f) => f.family === 'machine').length >= 2 && has(u, 'overload', b)) push('tech', 'overload');
      else if (machine && has(u, 'spike', b)) push('tech', 'spike', machine.uid);
      else push('attack');
    } else if (u.key === 'kit') {
      if (u.hp / u.base.maxHp < 0.3 && has(u, 'second_wind', b)) push('skill', 'second_wind');
      else if (spirit && has(u, 'iron_palm', b)) push('tech', 'iron_palm', spirit.uid);
      else if (foes.length >= 3 && has(u, 'hundred_rain', b)) push('tech', 'hundred_rain');
      else if (boss && has(u, 'flash_step', b)) push('tech', 'flash_step');
      else push('attack');
    } else {
      if (foes.length >= 3 && has(u, 'quickdraw', b)) push('skill', 'quickdraw');
      else if (boss && has(u, 'arc_cut', b)) push('skill', 'arc_cut');
      else if (target.hp > 40 && has(u, 'arc_cut', b) && (u.uses.arc_cut ?? 0) > 2) push('skill', 'arc_cut');
      else push('attack');
    }
  }
  return cmds;
}

function buildParty(loadout: Loadout[]): Combatant[] {
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
  const groups = ENCOUNTERS[table]!;
  for (let i = 0; i < n; i++) {
    const g = groups[i % groups.length]!;
    const p = buildParty(loadout);
    const maxHp = p.reduce((s, c) => s + c.base.maxHp, 0);
    const b = new Battle(p, enemyParty(g.e), new Rng(rng.int(1, 1e9)));
    while (!b.outcome && b.round < 60) b.resolveRound(policy(b, useCombos));
    if (b.outcome === 'win') wins++;
    rounds += b.round;
    combos += b.combosUsed.length;
    const hpNow = p.reduce((s, c) => s + Math.max(0, c.hp), 0);
    lost += 1 - hpNow / maxHp;
  }
  return { label, wins, n, rounds: rounds / n, hpLostPct: (lost / n) * 100, combos: combos / n };
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
}

/**
 * Dungeon attrition: `battles` fights in a row with no rest. HP/TP/skill uses carry over.
 * Between fights the player patches anyone under 50% with a medkit (up to `medkits`) and
 * revives with a stim (up to `stims`).
 */
export function simulateRun(label: string, loadout: Loadout[], table: string, battles: number, medkits: number, stims: number, n = 60, seed = 3): RunResult {
  const rng = new Rng(seed);
  const groups = ENCOUNTERS[table]!;
  let cleared = 0, endHp = 0, used = 0, rounds = 0, fights = 0;
  for (let i = 0; i < n; i++) {
    const p = buildParty(loadout);
    let mk = medkits, st = stims, ok = true;
    for (let k = 0; k < battles; k++) {
      const g = rng.pick(groups);
      const b = new Battle(p, enemyParty(g.e), new Rng(rng.int(1, 1e9)));
      while (!b.outcome && b.round < 60) b.resolveRound(policy(b, false));
      rounds += b.round;
      fights++;
      if (b.outcome !== 'win') { ok = false; break; }
      // Field heals first (Sable's Mend / Hex's Patch), keeping a TP reserve for the next fight.
      for (const healer of p.filter((c) => c.hp > 0 && (c.key === 'sable' || c.key === 'hex'))) {
        const id = healer.key === 'sable' ? 'mend' : 'patch';
        const ab = ABILITIES[id]!;
        for (const c of p) {
          while (c.hp > 0 && c.hp < c.base.maxHp * 0.6 && healer.tp - (ab.cost ?? 0) >= healer.base.maxTp * 0.35) {
            healer.tp -= ab.cost ?? 0;
            c.hp = Math.min(c.base.maxHp, c.hp + Math.round(((ab.effects[0] as { power: number }).power ?? 0) + healer.base.mnd * 1.5));
          }
        }
      }
      for (const c of p) {
        c.status = c.status.filter((s) => s.id === 'poison');
        if (c.hp <= 0 && st > 0) { st--; c.hp = Math.round(c.base.maxHp * 0.3); }
        while (c.hp > 0 && c.hp < c.base.maxHp * 0.5 && mk > 0) { mk--; used++; c.hp = Math.min(c.base.maxHp, c.hp + 60); }
      }
    }
    if (ok) cleared++;
    endHp += p.reduce((s, c) => s + Math.max(0, c.hp) / c.base.maxHp, 0) / p.length;
  }
  return { label, cleared, n, endHpPct: (endHp / n) * 100, medkitsUsed: used / n, roundsPerBattle: rounds / fights };
}

export function fmtRun(r: RunResult): string {
  return `${r.label.padEnd(28)} cleared ${((r.cleared / r.n) * 100).toFixed(0).padStart(3)}%  end hp ${r.endHpPct.toFixed(0).padStart(3)}%  medkits ${r.medkitsUsed.toFixed(1)}  rounds/battle ${r.roundsPerBattle.toFixed(1)}`;
}
