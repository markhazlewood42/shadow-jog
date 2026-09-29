/**
 * Round-based battle resolution (Phantasy Star IV style): all commands are entered, then everyone
 * acts in agility order. `resolveRound` mutates the battle state and returns a list of events that
 * the presentation layer replays. Deterministic for a given RNG seed.
 *
 * The scene drives the same round a step at a time: `startRound`, then `next()` declares each
 * action (who, what, at whom) and `land(timing)` resolves it, so a timed press between the two —
 * a strike landed on the beat, a blow braced for — can change the hit. `resolveRound` is that loop
 * with a grader (tests and the balance sim).
 *
 * Initiative is rolled when a round's orders open (`rollInitiative`), so the turn order the menu
 * previews is the order the round plays.
 */
import { must } from '../engine/assert';
import { ABILITIES, COMBOS, ability } from '../data/abilities';

/** Combos, largest first (findCombos matches triples before pairs). */
const COMBOS_BY_SIZE = [...COMBOS].sort((a, b) => b.parts.length - a.parts.length);
import { ENEMIES, FAMILY_IMMUNE, FAMILY_WEAK, type EnemyDef } from '../data/enemies';
import { ITEMS } from '../data/items';
import type { Rng } from '../engine/rng';
import { chooseEnemyAction } from './ai';
import type {
  Ability, BattleEvent, Combatant, Command, Effect, Element, Outcome, Stats, StatusId,
} from './types';

export interface QueuedAction {
  actors: number[];
  ability: Ability;
  /** Item id when the action is an item. */
  item?: string | undefined;
  target: number;
  speed: number;
  combo?: string;
}

export interface BattleOpts {
  canRun?: boolean;
  /** Party inventory accessor so items can be consumed. */
  useItem?: (id: string) => boolean;
  /** Party member regen from equipment (% per round). */
  regen?: Record<number, number>;
}

/**
 * How well a timed press landed. 'none' is no press at all; 'whiff' is a press off the beat, and
 * it costs: an overswing hits softer, a brace tensed at the wrong moment takes more. Not pressing
 * is always safer than guessing.
 */
export type Timing = 'perfect' | 'good' | 'none' | 'whiff';
/**
 * How a move's timing feels. Quick moves (first-strike techs, snap shots) give a tight window
 * and a big payoff; heavy ones (combos, big swings) a wide window and a smaller one; a blow you
 * saw coming (a telegraphed attack) can be braced for hardest.
 */
export type TimingProfile = 'quick' | 'normal' | 'heavy';
/** A timed input the declared action offers: strike harder, or brace against the blow. */
export interface TimingPrompt {
  kind: 'strike' | 'brace';
  profile: TimingProfile;
  actor: number;
  /** The units the ring closes on: the struck enemies, or the party members being hit. */
  targets: number[];
}
/** Damage dealt on a timed strike, and taken on a timed brace, by profile. */
export const STRIKE_MULT: Record<TimingProfile, Record<Timing, number>> = {
  quick: { perfect: 1.3, good: 1.1, none: 1, whiff: 0.85 },
  normal: { perfect: 1.2, good: 1.08, none: 1, whiff: 0.9 },
  heavy: { perfect: 1.15, good: 1.06, none: 1, whiff: 0.94 },
};
export const BRACE_MULT: Record<TimingProfile, Record<Timing, number>> = {
  quick: { perfect: 0.75, good: 0.88, none: 1, whiff: 1.1 },
  normal: { perfect: 0.7, good: 0.85, none: 1, whiff: 1.1 },
  heavy: { perfect: 0.5, good: 0.8, none: 1, whiff: 1.15 },
};

/** The timing profile of a move: its speed class for a strike, its tell for a brace. */
export function timingProfile(ab: Ability, kind: TimingPrompt['kind']): TimingProfile {
  if (kind === 'brace') return ab.telegraphed ? 'heavy' : 'normal';
  if (ab.kind === 'combo') return 'heavy';
  if ((ab.priority ?? 0) > 0) return 'quick';
  const dmg = ab.effects.find((e) => e.type === 'damage');
  const heavy = !!dmg && dmg.type === 'damage' && ((dmg.mult ?? 1) >= 1.6 || (dmg.power ?? 0) >= 60);
  return heavy ? 'heavy' : 'normal';
}

interface Declared {
  actors: Combatant[];
  ab: Ability;
  targets: Combatant[];
  item?: string | undefined;
}

const BUFF_MULT = 1.3;
const DEBUFF_MULT = 0.75;
const UNTIMED = 99;

export function enemyCombatant(defId: string, uid: number, slot: number): Combatant {
  const d = ENEMIES[defId];
  if (!d) throw new Error(`Unknown enemy ${defId}`);
  return {
    uid,
    side: 'enemy',
    key: d.id,
    name: d.name,
    level: 1,
    hp: d.hp,
    tp: 0,
    base: statsFromDef(d),
    status: [],
    uses: {},
    family: d.family,
    weak: { ...FAMILY_WEAK[d.family], ...(d.weak ?? {}) },
    immune: [...FAMILY_IMMUNE[d.family], ...(d.immune ?? [])],
    ai: d.ai,
    boss: d.boss,
    weaponElement: d.element,
    memory: {},
    slot,
  };
}

function statsFromDef(d: EnemyDef): Stats {
  return { maxHp: d.hp, maxTp: 0, atk: d.atk, def: d.def, mnd: d.mnd, res: d.res, agi: d.agi, crit: 3, hit: 0 };
}

export class Battle {
  units: Combatant[];
  round = 0;
  outcome: Outcome = null;
  readonly rng: Rng;
  readonly canRun: boolean;
  private opts: BattleOpts;
  private nextUid = 100;
  /** Enemies defeated (for rewards), including summons and phase forms. */
  defeated: string[] = [];
  /** Combos triggered this battle. */
  combosUsed: string[] = [];
  private ev: BattleEvent[] = [];
  /** The round's action queue and how far through it we are. */
  private queue: QueuedAction[] = [];
  private qi = 0;
  /** The action `next()` declared and `land()` will resolve. */
  private declared: Declared | null = null;
  /** The timed press applying to the damage being resolved now. */
  private graded: { kind: TimingPrompt['kind']; profile: TimingProfile; timing: Timing } | null = null;
  /** Per-unit initiative factor for round `rolledFor` (±15% on agility). */
  private initiative = new Map<number, number>();
  private rolledFor = -1;

  /** Side rosters, kept in step with `units` (only summons add to it) so reads never allocate. */
  private partyList: Combatant[];
  private enemyList: Combatant[];

  constructor(party: Combatant[], enemies: Combatant[], rng: Rng, opts: BattleOpts = {}) {
    this.units = [...party, ...enemies];
    for (const u of this.units) this.byUid.set(u.uid, u);
    this.partyList = [...party];
    this.enemyList = [...enemies];
    this.rng = rng;
    this.canRun = opts.canRun ?? true;
    this.opts = opts;
  }

  get party(): readonly Combatant[] {
    return this.partyList;
  }
  get enemies(): readonly Combatant[] {
    return this.enemyList;
  }
  /**
   * The living on one side. Cached: a read walks the roster to fingerprint who's standing (no
   * allocation) and rebuilds the list only when that changed, since HP is written from many
   * places (the engine, the scene's debug paths, the simulator). Read-only: copy before sorting.
   */
  alive(side: 'party' | 'enemy'): readonly Combatant[] {
    let sig = 0;
    for (const u of this.units) if (u.side === side && u.hp > 0) sig = (sig * 31 + u.uid + 1) | 0;
    const c = side === 'party' ? this.aliveParty : this.aliveEnemy;
    if (c.sig === sig && c.n === this.units.length) return c.list;
    const list = this.units.filter((u) => u.side === side && u.hp > 0);
    if (side === 'party') this.aliveParty = { sig, n: this.units.length, list };
    else this.aliveEnemy = { sig, n: this.units.length, list };
    return list;
  }
  private aliveParty: { sig: number; n: number; list: Combatant[] } = { sig: -1, n: -1, list: [] };
  private aliveEnemy: { sig: number; n: number; list: Combatant[] } = { sig: -1, n: -1, list: [] };
  /** A combatant by uid: an index kept in step with `units`, not a scan (called throughout a round). */
  unit(uid: number): Combatant | undefined {
    return this.byUid.get(uid);
  }
  private byUid = new Map<number, Combatant>();

  // ------------------------------------------------------------------ stats & status
  has(u: Combatant, s: StatusId): boolean {
    return u.status.some((x) => x.id === s);
  }

  eff(u: Combatant): Stats {
    const s = { ...u.base };
    if (this.has(u, 'atk_up')) s.atk = Math.round(s.atk * BUFF_MULT);
    if (this.has(u, 'atk_down')) s.atk = Math.round(s.atk * DEBUFF_MULT);
    if (this.has(u, 'def_up')) s.def = Math.round(s.def * BUFF_MULT);
    if (this.has(u, 'def_down')) s.def = Math.round(s.def * DEBUFF_MULT);
    if (this.has(u, 'res_up')) s.res = Math.round(s.res * BUFF_MULT);
    if (this.has(u, 'agi_up')) s.agi = Math.round(s.agi * BUFF_MULT);
    if (this.has(u, 'agi_down')) s.agi = Math.round(s.agi * DEBUFF_MULT);
    return s;
  }

  private addStatus(u: Combatant, id: StatusId, turns: number, src?: number): boolean {
    if (u.hp <= 0) return false;
    if (u.immune?.includes(id)) return false;
    const existing = u.status.find((s) => s.id === id);
    // Opposing buffs cancel.
    const opp: Partial<Record<StatusId, StatusId>> = { atk_up: 'atk_down', atk_down: 'atk_up', def_up: 'def_down', def_down: 'def_up', agi_up: 'agi_down', agi_down: 'agi_up' };
    const o = opp[id];
    if (o && this.has(u, o)) {
      u.status = u.status.filter((s) => s.id !== o);
      this.ev.push({ t: 'status', target: u.uid, status: o, on: false });
      return true;
    }
    if (existing) {
      existing.turns = Math.max(existing.turns, turns);
      return true;
    }
    u.status.push({ id, turns, src });
    this.ev.push({ t: 'status', target: u.uid, status: id, on: true });
    return true;
  }

  private removeStatus(u: Combatant, id: StatusId): void {
    if (!this.has(u, id)) return;
    u.status = u.status.filter((s) => s.id !== id);
    this.ev.push({ t: 'status', target: u.uid, status: id, on: false });
  }

  // ------------------------------------------------------------------ command planning
  /**
   * Detect combos among the party's commands (used by the UI hint and by resolution). The found
   * orders keep the combo's part order: its first part's member is the blow's striker. Three-part
   * combos are matched first: orders that make a triple aren't split into a pair and a leftover.
   */
  static findCombos(cmds: Command[], units: Combatant[]): { combo: string; cmds: Command[] }[] {
    const out: { combo: string; cmds: Command[] }[] = [];
    const used = new Set<number>();
    for (const c of COMBOS_BY_SIZE) {
      const found: Command[] = [];
      for (const p of c.parts) {
        const cmd = cmds.find((x) => {
          if (used.has(x.actor) || found.includes(x) || x.id !== p.ability || (x.type !== 'tech' && x.type !== 'skill')) return false;
          return units.find((u) => u.uid === x.actor)?.key === p.member;
        });
        if (!cmd) break;
        found.push(cmd);
      }
      if (found.length !== c.parts.length) continue;
      for (const f of found) used.add(f.actor);
      out.push({ combo: c.id, cmds: found });
    }
    return out;
  }

  /**
   * Roll the coming round's initiative (once per round; later calls are no-ops). The scene calls
   * this when the orders open, so the previewed turn order is the real one.
   */
  rollInitiative(): void {
    const r = this.round + 1;
    if (this.rolledFor === r) return;
    this.rolledFor = r;
    this.initiative.clear();
    for (const u of this.units) if (u.hp > 0) this.initiative.set(u.uid, this.rng.range(0.85, 1.15));
  }

  private speedOf(u: Combatant, priority = 0): number {
    return this.eff(u).agi * (this.initiative.get(u.uid) ?? 1) + priority;
  }

  /**
   * Who acts in what order if these orders stand (each entry is one action's actors; a combo is
   * one entry). Enemies appear as their placeholders. Pure: rolls initiative if it isn't yet.
   */
  previewOrder(cmds: Command[]): number[][] {
    this.rollInitiative();
    return this.plan(cmds).map((q) => q.actors);
  }

  private plan(cmds: Command[]): QueuedAction[] {
    const q: QueuedAction[] = [];
    const combos = Battle.findCombos(cmds, this.units);
    const inCombo = new Set<number>();
    for (const c of combos) {
      // A stale uid or an unknown combo id drops the fusion (each order then runs on its own)
      // rather than carrying an undefined into the round.
      const us = c.cmds.map((x) => this.unit(x.actor));
      const ab = ABILITIES[c.combo];
      if (!ab || us.some((u) => !u || u.hp <= 0)) continue;
      const members = us as Combatant[];
      for (const u of members) inCombo.add(u.uid);
      const aimed = c.cmds.find((x) => x.id !== undefined && ABILITIES[x.id]?.target === 'enemy' && (x.target ?? -1) >= 0);
      q.push({
        actors: members.map((u) => u.uid),
        ability: ab,
        target: ab.target === 'enemy' ? (aimed?.target ?? -1) : -1,
        speed: Math.max(...members.map((u) => this.speedOf(u))) + 10 + (ab.priority ?? 0),
        combo: c.combo,
      });
    }
    for (const cmd of cmds) {
      if (inCombo.has(cmd.actor)) continue;
      const u = this.unit(cmd.actor);
      if (!u || u.hp <= 0) continue;
      if (cmd.type === 'guard') {
        q.push({ actors: [u.uid], ability: GUARD, target: u.uid, speed: 10000 });
        continue;
      }
      if (cmd.type === 'item') {
        if (!cmd.id || !ITEMS[cmd.id]) continue;
        q.push({ actors: [u.uid], ability: itemAbility(cmd.id), item: cmd.id, target: cmd.target ?? -1, speed: this.speedOf(u, 25) });
        continue;
      }
      const ab = cmd.type === 'attack' ? ability('attack') : cmd.id ? ABILITIES[cmd.id] : undefined;
      if (!ab) continue;
      q.push({ actors: [u.uid], ability: ab, target: cmd.target ?? -1, speed: this.speedOf(u, ab.priority ?? 0) });
    }
    // Enemies decide at their turn; queue placeholders by speed.
    for (const e of this.alive('enemy')) q.push({ actors: [e.uid], ability: ability('attack'), target: -2, speed: this.speedOf(e) });
    q.sort((a, b) => b.speed - a.speed);
    return q;
  }

  // ------------------------------------------------------------------ round
  /** A whole round at once: every timed prompt graded by `time` (none, if absent). */
  resolveRound(cmds: Command[], time?: (p: TimingPrompt) => Timing): BattleEvent[] {
    const out = this.startRound(cmds);
    for (let s = this.next(); s; s = this.next()) {
      out.push(...s.events, ...this.land(s.prompt && time ? time(s.prompt) : 'none'));
    }
    out.push(...this.endRound());
    return out;
  }

  /** Begin a round with these orders: an escape attempt, then the action queue. */
  startRound(cmds: Command[]): BattleEvent[] {
    this.ev = [];
    this.rollInitiative();
    this.round++;
    this.queue = [];
    this.qi = 0;
    this.declared = null;
    if (cmds.some((c) => c.type === 'run')) {
      if (this.tryRun()) return this.flush();
      // Failed escape: enemies get a free round.
      cmds = [];
    }
    this.queue = this.plan(cmds);
    return this.flush();
  }

  /**
   * Declare the next action: everything up to the moment it's committed (a stun, an enemy's
   * choice, its target). Returns its events and the timed prompt it offers, or null when the
   * round has nothing left to play.
   */
  next(): { events: BattleEvent[]; prompt: TimingPrompt | null } | null {
    const queued = this.outcome ? undefined : this.queue[this.qi++];
    if (!queued) return null;
    this.declare(queued);
    return { events: this.flush(), prompt: this.declared ? this.promptFor(this.declared) : null };
  }

  /** Resolve the declared action, with how the player's timed press landed. */
  land(timing: Timing = 'none'): BattleEvent[] {
    const d = this.declared;
    this.declared = null;
    if (d) {
      const p = this.promptFor(d);
      this.graded = p ? { kind: p.kind, profile: p.profile, timing } : null;
      this.applyEffects(d.actors, d.ab, d.targets, d.item);
      this.graded = null;
    }
    this.checkOutcome();
    return this.flush();
  }

  /** Close the round: damage over time, regen, status timers. */
  endRound(): BattleEvent[] {
    if (!this.outcome) this.endOfRound();
    this.checkOutcome();
    return this.flush();
  }

  /** The timed input a declared action offers: a party member's hit, or a blow at the party. */
  private promptFor(d: Declared): TimingPrompt | null {
    if (!d.targets.length || !d.ab.effects.some((e) => e.type === 'damage')) return null;
    const lead = must(d.actors[0], 'the lead of a declared action');
    if (lead.side === 'party') {
      if (d.ab.kind === 'item') return null;
      const hit = d.targets.filter((t) => t.side === 'enemy');
      return hit.length ? { kind: 'strike', profile: timingProfile(d.ab, 'strike'), actor: lead.uid, targets: hit.map((t) => t.uid) } : null;
    }
    const hit = d.targets.filter((t) => t.side === 'party');
    return hit.length ? { kind: 'brace', profile: timingProfile(d.ab, 'brace'), actor: lead.uid, targets: hit.map((t) => t.uid) } : null;
  }

  private flush(): BattleEvent[] {
    const e = this.ev;
    this.ev = [];
    return e;
  }

  private tryRun(): boolean {
    if (!this.canRun || this.enemies.some((e) => e.boss && e.hp > 0)) {
      this.ev.push({ t: 'msg', text: 'No way out!' });
      this.ev.push({ t: 'flee', ok: false });
      return false;
    }
    const pa = avg(this.alive('party').map((u) => this.eff(u).agi));
    const ea = avg(this.alive('enemy').map((u) => this.eff(u).agi));
    const chance = Math.max(0.3, Math.min(0.95, 0.6 + (pa - ea) * 0.025));
    const ok = this.rng.chance(chance);
    this.ev.push({ t: 'flee', ok });
    if (ok) this.outcome = 'fled';
    return ok;
  }

  private checkOutcome(): void {
    if (this.outcome) return;
    if (this.alive('enemy').length === 0) this.outcome = 'win';
    else if (this.alive('party').length === 0) this.outcome = 'lose';
  }

  private endOfRound(): void {
    for (const u of this.units) {
      if (u.hp <= 0) continue;
      // Damage over time
      for (const s of u.status) {
        if (s.id === 'poison' || s.id === 'burn') {
          const pct = s.id === 'poison' ? 0.06 : 0.08;
          const amt = Math.max(1, Math.round(u.base.maxHp * pct * (u.boss ? 0.35 : 1)));
          u.hp = Math.max(0, u.hp - amt);
          this.ev.push({ t: 'tick', target: u.uid, amount: amt, status: s.id, hp: u.hp });
          if (u.hp <= 0) {
            this.kill(u);
            break;
          }
        }
      }
      if (u.hp <= 0) continue;
      const regenPct = (this.has(u, 'regen') ? 0.06 : 0) + (this.opts.regen?.[u.uid] ?? 0) / 100;
      if (regenPct > 0 && u.hp < u.base.maxHp) {
        const amt = Math.max(1, Math.round(u.base.maxHp * regenPct));
        u.hp = Math.min(u.base.maxHp, u.hp + amt);
        this.ev.push({ t: 'heal', target: u.uid, amount: amt, hp: u.hp });
      }
      // Durations
      for (const s of [...u.status]) {
        if (s.id === 'stun' || s.id === 'jammed' || s.id === 'poison') continue;
        if (s.turns >= UNTIMED) continue;
        s.turns--;
        if (s.turns <= 0) this.removeStatus(u, s.id);
      }
      this.removeStatus(u, 'guard');
      // Rook's cover is for the round he called it; an enemy's lasts its timer (it acts late).
      if (u.side === 'party') this.removeStatus(u, 'cover');
    }
  }

  // ------------------------------------------------------------------ execution
  /** Run an action up to its commitment; a damaging one is left in `declared` for `land()`. */
  private declare(act: QueuedAction): void {
    const actors = act.actors.map((id) => this.unit(id)).filter((u): u is Combatant => !!u);
    const lead = actors[0];
    if (!lead || actors.length !== act.actors.length) return;
    if (actors.some((a) => a.hp <= 0)) {
      if (act.combo) {
        // Fallback: the surviving partner does nothing flashy this round.
        const alive = actors.find((a) => a.hp > 0);
        if (alive) this.ev.push({ t: 'fail', actor: alive.uid, reason: 'The combo fell apart!' });
      }
      return;
    }
    // Disabled?
    for (const a of actors) {
      if (this.has(a, 'stun')) {
        this.removeStatus(a, 'stun');
        this.ev.push({ t: 'fail', actor: a.uid, reason: `${a.name} is stunned!` });
        this.interruptWindup(a);
        return;
      }
      if (this.has(a, 'jammed')) {
        const s = a.status.find((x) => x.id === 'jammed');
        if (s) s.turns--;
        this.ev.push({ t: 'fail', actor: a.uid, reason: `${a.name} is jammed!` });
        if (!s || s.turns <= 0) this.removeStatus(a, 'jammed');
        this.interruptWindup(a);
        return;
      }
    }
    // Enemy decides now.
    if (lead.side === 'enemy' && act.target === -2) {
      if (this.has(lead, 'hijacked')) {
        this.hijackedTurn(lead);
        return;
      }
      const choice = chooseEnemyAction(this, lead);
      if (!choice) return;
      act = { ...act, ability: choice.ability, target: choice.target };
      if (choice.message) this.ev.push({ t: 'msg', text: choice.message });
      if (choice.skip) return;
    }
    const ab = act.ability;
    // Resource costs (Guard is free: it is a stance, not a skill with uses)
    if (lead.side === 'party' && ab.kind !== 'combo' && ab.kind !== 'item' && ab !== GUARD) {
      if (!this.payCost(lead, ab)) {
        this.ev.push({ t: 'fail', actor: lead.uid, reason: ab.kind === 'skill' ? `No uses of ${ab.name} left!` : 'Not enough TP!' });
        return;
      }
    }
    if (act.combo) {
      const parts = COMBOS.find((c) => c.id === act.combo)?.parts ?? [];
      for (const p of parts) {
        const u = actors.find((a) => a.key === p.member);
        const part = ABILITIES[p.ability];
        if (!u || !part || !this.payCost(u, part)) {
          this.ev.push({ t: 'fail', actor: (u ?? lead).uid, reason: 'The combo fell apart!' });
          return;
        }
      }
      if (!this.combosUsed.includes(act.combo)) this.combosUsed.push(act.combo);
    }
    if (act.item) {
      if (this.opts.useItem && !this.opts.useItem(act.item)) {
        this.ev.push({ t: 'fail', actor: lead.uid, reason: 'Out of stock!' });
        return;
      }
    }
    const targets = this.resolveTargets(lead, ab, act.target);
    if (act.combo) this.ev.push({ t: 'combo', name: ab.name, actors: act.actors, fx: ab.fx, targets: targets.map((t) => t.uid) });
    else this.ev.push({ t: 'act', actor: lead.uid, id: ab.id, name: ab.name, kind: ab.kind, fx: ab.fx, targets: targets.map((t) => t.uid), element: ab.element ?? (ab.kind === 'attack' ? lead.weaponElement : undefined) });
    if (ab === GUARD) {
      // What Guard gives back comes from the blow it turns (breathe(), in damage): guarding
      // against nothing earns nothing, so Guard/Attack can't be run as a TP battery.
      this.addStatus(lead, 'guard', 1);
      return;
    }
    this.declared = { actors, ab, targets, item: act.item };
  }

  /** A telegraphed attack (turret spin-up, arcanist surge) is lost if its user loses the turn. */
  private interruptWindup(u: Combatant): void {
    if (u.memory.spin) {
      u.memory.spin = 0;
      this.ev.push({ t: 'msg', text: `${u.name}’s barrels spin down.` });
    }
    if (u.memory.surge) {
      u.memory.surge = 0;
      this.ev.push({ t: 'msg', text: `${u.name}’s surge bleeds away.` });
    }
  }

  private payCost(u: Combatant, ab: Ability): boolean {
    if (ab.kind === 'tech') {
      const c = ab.cost ?? 0;
      if (u.tp < c) return false;
      u.tp -= c;
    } else if (ab.kind === 'skill') {
      const left = u.uses[ab.id] ?? 0;
      if (left <= 0) return false;
      u.uses[ab.id] = left - 1;
    }
    return true;
  }

  private hijackedTurn(u: Combatant): void {
    const victims = this.alive('enemy').filter((e) => e.uid !== u.uid);
    if (!victims.length) {
      this.ev.push({ t: 'fail', actor: u.uid, reason: `${u.name} sparks aimlessly.` });
      return;
    }
    // The machine turns its own weapons on its side: a random damaging move from its kit.
    const own = (ENEMIES[u.key]?.moves ?? [])
      .map((m) => ABILITIES[m.id])
      .filter((ab): ab is Ability => !!ab && ab.effects.some((e) => e.type === 'damage'));
    const ab = own.length ? this.rng.pick(own) : { ...ability('attack'), effects: [{ type: 'damage' as const, stat: 'atk' as const, mult: 1.3 }] };
    const targets = ab.target === 'enemies' || ab.target === 'random_enemies' ? victims : [this.rng.pick(victims)];
    this.ev.push({ t: 'act', actor: u.uid, id: ab.id, name: `Hijacked: ${ab.name}`, kind: 'enemy', fx: ab.fx, targets: targets.map((t) => t.uid), element: ab.element });
    this.applyEffects([u], ab, targets);
  }

  resolveTargets(user: Combatant, ab: Ability, target: number): Combatant[] {
    const foes = this.alive(user.side === 'party' ? 'enemy' : 'party');
    const friends = this.alive(user.side);
    switch (ab.target) {
      case 'none':
        return [];
      case 'self':
        return [user];
      case 'allies':
        return [...friends];
      case 'enemies':
      case 'random_enemies': {
        // Cover only redirects single-target attacks. Say so when a blast hits a covered side,
        // so leaning on Guardian against an area attack isn't a silent non-answer.
        const cover = foes.find((p) => this.has(p, 'cover'));
        if (cover && ab.effects.some((e) => e.type === 'damage')) this.ev.push({ t: 'msg', text: `${cover.name} can’t cover a blast!` });
        return [...foes];
      }
      case 'ally_down': {
        const t = this.unit(target);
        if (t && t.side === user.side && t.hp <= 0) return [t];
        const down = this.units.filter((u) => u.side === user.side && u.hp <= 0);
        return down.slice(0, 1);
      }
      case 'ally': {
        const t = this.unit(target);
        if (t && t.side === user.side && t.hp > 0) return [t];
        // Retarget to the most hurt ally.
        const hurt = [...friends].sort((a, b) => a.hp / a.base.maxHp - b.hp / b.base.maxHp);
        return hurt.slice(0, 1);
      }
      case 'enemy': {
        let t = this.unit(target);
        if (!t || t.hp <= 0 || t.side === user.side) t = foes.length ? this.rng.pick(foes) : undefined;
        if (!t) return [];
        // Cover (Rook's Guardian, a crab's Shell Wall): single-target attacks go to the coverer.
        {
          const cover = this.alive(t.side).find((p) => p !== t && this.has(p, 'cover'));
          if (cover && ab.effects.some((e) => e.type === 'damage')) {
            this.ev.push({ t: 'msg', text: `${cover.name} steps in front!` });
            return [cover];
          }
        }
        return [t];
      }
    }
  }

  private applyEffects(actors: Combatant[], ab: Ability, targets: Combatant[], itemId?: string): void {
    const user = must(actors[0], `a user for ${ab.id}`);
    for (const eff of ab.effects) {
      switch (eff.type) {
        case 'damage': {
          const hits = eff.hits ?? 1;
          if (ab.target === 'random_enemies') {
            // Hits spread across the field: each goes to one of the least-hit targets so far.
            const count = new Map<number, number>();
            for (let h = 0; h < hits; h++) {
              const pool = this.alive(user.side === 'party' ? 'enemy' : 'party');
              if (!pool.length) break;
              const least = Math.min(...pool.map((t) => count.get(t.uid) ?? 0));
              const t = this.rng.pick(pool.filter((p) => (count.get(p.uid) ?? 0) === least));
              count.set(t.uid, (count.get(t.uid) ?? 0) + 1);
              this.damage(actors, ab, eff, t, itemId);
            }
          } else {
            for (const t of targets) for (let h = 0; h < hits; h++) if (t.hp > 0) this.damage(actors, ab, eff, t, itemId);
            const primary = targets[0];
            if (eff.splash && targets.length === 1 && primary) {
              const arc = { ...eff, mult: (eff.mult ?? 1) * eff.splash, critBonus: 0, splash: undefined, hits: 1 };
              for (const o of this.alive(primary.side)) if (o !== primary) this.damage(actors, ab, arc, o, itemId);
            }
          }
          break;
        }
        case 'heal':
          for (const t of targets) {
            if (t.hp <= 0) continue;
            const pow = eff.pct !== undefined ? t.base.maxHp * eff.pct : (eff.power ?? 0) + (itemId ? 0 : this.comboStat(actors, 'mnd') * 1.5);
            const amt = Math.max(1, Math.round(pow * (itemId ? 1 : this.rng.range(0.95, 1.05))));
            t.hp = Math.min(t.base.maxHp, t.hp + amt);
            this.ev.push({ t: 'heal', target: t.uid, amount: amt, hp: t.hp });
          }
          break;
        case 'tp':
          for (const t of targets) {
            if (t.hp <= 0 || t.base.maxTp <= 0) continue;
            const amt = Math.min(eff.amount, t.base.maxTp - t.tp);
            t.tp += amt;
            this.ev.push({ t: 'tp', target: t.uid, amount: amt, tp: t.tp });
          }
          break;
        case 'status':
          for (const t of targets) {
            if (t.hp <= 0) continue;
            if (eff.only && (!t.family || !eff.only.includes(t.family))) continue;
            const chance = t.boss && (eff.status === 'stun' || eff.status === 'hijacked') ? eff.chance * 0.3 : eff.chance;
            // Just out of a stun, a target has its guard up for two rounds: a pack can be frozen
            // once, not held frozen by chaining stuns.
            const wary = eff.status === 'stun' && t.memory.stunAt !== undefined && this.round - t.memory.stunAt <= 2;
            if (t.immune?.includes(eff.status) || wary) {
              this.ev.push({ t: 'immune', target: t.uid, status: eff.status });
              continue;
            }
            if (this.rng.chance(chance)) {
              this.addStatus(t, eff.status, eff.status === 'poison' ? UNTIMED : (eff.turns ?? 3), user.uid);
              if (eff.status === 'stun') t.memory.stunAt = this.round;
            }
            else if (targets.length === 1 && !ab.effects.some((e) => e.type === 'damage')) this.ev.push({ t: 'miss', target: t.uid });
          }
          break;
        case 'buff':
          for (const t of targets) if (t.hp > 0) this.addStatus(t, eff.status, eff.turns);
          break;
        case 'cure':
          for (const t of targets) {
            if (t.hp <= 0) continue;
            const bad: StatusId[] = ['poison', 'burn', 'stun', 'blind', 'jammed', 'atk_down', 'def_down', 'agi_down', 'exposed', 'lockon'];
            const list = eff.statuses === 'all' ? bad : eff.statuses;
            for (const s of list) this.removeStatus(t, s);
          }
          break;
        case 'revive':
          for (const t of targets) {
            if (t.hp > 0) continue;
            t.hp = Math.max(1, Math.round(t.base.maxHp * eff.pct));
            t.status = [];
            this.ev.push({ t: 'revive', target: t.uid, hp: t.hp });
          }
          break;
        case 'analyze':
          for (const t of targets) {
            t.analyzed = true;
            this.ev.push({ t: 'analyze', target: t.uid });
          }
          break;
        case 'escape':
          if (this.enemies.some((e) => e.boss && e.hp > 0) || !this.canRun) {
            this.ev.push({ t: 'msg', text: 'Can’t escape this fight!' });
          } else {
            this.ev.push({ t: 'flee', ok: true });
            this.outcome = 'fled';
          }
          break;
        case 'summon': {
          const living = this.alive('enemy').length;
          const room = Math.max(0, eff.max + 1 - living);
          const spawn = eff.enemies.slice(0, room);
          if (!spawn.length) {
            this.ev.push({ t: 'msg', text: 'But nothing answered.' });
            break;
          }
          const uids: number[] = [];
          const usedSlots = new Set(this.alive('enemy').map((e) => e.slot));
          for (const id of spawn) {
            let slot = 0;
            while (usedSlots.has(slot)) slot++;
            usedSlots.add(slot);
            const c = enemyCombatant(id, this.nextUid++, slot);
            this.units.push(c);
            this.byUid.set(c.uid, c);
            this.enemyList.push(c);
            uids.push(c.uid);
          }
          this.ev.push({ t: 'summon', uids });
          break;
        }
      }
    }
  }

  /** Stat used by an action; combos sum both participants (scaled). */
  private comboStat(actors: Combatant[], stat: 'atk' | 'mnd'): number {
    const solo = actors.length === 1 ? actors[0] : undefined;
    if (solo) return this.eff(solo)[stat];
    return actors.reduce((n, a) => n + this.eff(a)[stat], 0) * 0.62;
  }

  private damage(actors: Combatant[], ab: Ability, eff: Extract<Effect, { type: 'damage' }>, t: Combatant, itemId?: string): void {
    const user = must(actors[0], `a user for ${ab.id}`);
    const ue = this.eff(user);
    const te = this.eff(t);
    const element: Element = ab.element ?? (itemId ? ITEMS[itemId]?.element : undefined) ?? (ab.kind === 'attack' ? user.weaponElement : undefined) ?? 'phys';
    let crit = false;
    let amount: number;
    if (eff.pct !== undefined) {
      amount = t.base.maxHp * eff.pct;
    } else if (eff.stat === 'atk') {
      // Accuracy
      const blind = this.has(user, 'blind') ? 45 : 0;
      const hit = Math.max(25, Math.min(99, 95 + ue.hit - blind - Math.max(0, te.agi - ue.agi) * 0.5));
      if (!this.rng.chance(hit / 100)) {
        this.ev.push({ t: 'miss', target: t.uid });
        return;
      }
      const atk = this.comboStat(actors, 'atk');
      const def = eff.ignoreDef ? 0 : te.def;
      amount = ((atk * atk) / (atk + def)) * (eff.mult ?? 1);
      const critChance = 5 + ue.crit + (eff.critBonus ?? 0);
      if (this.rng.chance(critChance / 100)) {
        crit = true;
        amount *= 1.75;
      }
    } else {
      const mnd = itemId ? 0 : this.comboStat(actors, 'mnd');
      const pow = (eff.power ?? 0) + mnd * 1.2;
      const resist = eff.ignoreDef ? 1 : 80 / (80 + te.res);
      amount = pow * resist * (eff.mult ?? 1);
    }
    amount *= this.rng.range(0.9, 1.1);
    const mult = t.weak?.[element] ?? 1;
    amount *= mult;
    // The Warden vents heat while its cannon charges: a telegraphed window to hit it hard.
    const vented = t.ai === 'warden' && !!t.memory.charging;
    if (vented) amount *= 1.5;
    if (this.has(t, 'exposed')) amount *= 1.25;
    // Bracing for a blow you saw coming is the point of the tells: a quarter, not a half.
    if (this.has(t, 'guard')) amount *= ab.telegraphed ? 0.25 : 0.5;
    // A timed press: a strike landed on the beat bites deeper; a blow braced for on the beat is
    // turned. Stacks with Guard (bracing twice over is the whole point of reading a tell).
    if (this.graded) {
      if (this.graded.kind === 'strike' && t.side === 'enemy') amount *= STRIKE_MULT[this.graded.profile][this.graded.timing];
      else if (this.graded.kind === 'brace' && t.side === 'party') amount *= BRACE_MULT[this.graded.profile][this.graded.timing];
    }
    const final = mult === 0 ? 0 : Math.max(1, Math.round(amount));
    t.hp = Math.max(0, t.hp - final);
    this.ev.push({ t: 'damage', target: t.uid, amount: final, crit, element, weak: mult > 1 || vented, resist: mult < 1, hp: t.hp });
    if (eff.drain && final > 0 && user.hp > 0) {
      const h = Math.round(final * eff.drain);
      user.hp = Math.min(user.base.maxHp, user.hp + h);
      this.ev.push({ t: 'heal', target: user.uid, amount: h, hp: user.hp });
    }
    // Being hit breaks hijack control only on the attacker's own side — ignore.
    if (t.hp <= 0) this.kill(t);
    else if (t.side === 'party' && final > 0 && this.has(t, 'guard') && t.memory.braced !== this.round) this.breathe(t, !!ab.telegraphed);
  }

  /**
   * A blow taken on a guard, turned into breath: TP back (twice as much off a tell you read and
   * braced for), once a round. Rook has no TP; for him it's one spent charge back, once a fight:
   * the old hand finding his feet, and the one way to stretch his charges through a dungeon.
   */
  private breathe(t: Combatant, read: boolean): void {
    t.memory.braced = this.round;
    if (t.base.maxTp > 0) {
      if (t.tp >= t.base.maxTp) return;
      const amt = Math.min(t.base.maxTp - t.tp, Math.max(2, Math.round(t.base.maxTp * (read ? 0.25 : 0.12))));
      t.tp += amt;
      this.ev.push({ t: 'tp', target: t.uid, amount: amt, tp: t.tp });
      return;
    }
    if (t.memory.recharged) return;
    // The charge he's spent most of (by share of its full count).
    let best: string | null = null, gap = 0;
    for (const [id, left] of Object.entries(t.uses)) {
      const full = ABILITIES[id]?.uses ?? 0;
      if (full > 0 && left < full && (full - left) / full > gap) {
        best = id;
        gap = (full - left) / full;
      }
    }
    if (!best) return;
    t.uses[best] = (t.uses[best] ?? 0) + 1;
    t.memory.recharged = 1;
    this.ev.push({ t: 'msg', text: `${t.name} takes it and resets: one more ${ABILITIES[best]?.name ?? best}.` });
  }

  private kill(t: Combatant): void {
    if (t.side === 'enemy' && t.ai === 'warden') {
      this.transformWarden(t);
      return;
    }
    t.hp = 0;
    t.status = [];
    this.ev.push({ t: 'down', target: t.uid });
    if (t.side === 'enemy') this.defeated.push(t.key);
  }

  private transformWarden(t: Combatant): void {
    // The mech shell breaks; its drones power down; the bound spirit tears loose.
    for (const e of this.alive('enemy')) {
      if (e === t) continue;
      e.hp = 0;
      e.status = [];
      this.ev.push({ t: 'down', target: e.uid });
      this.defeated.push(e.key);
    }
    const d = must(ENEMIES.warden_spirit, 'the Warden’s spirit');
    const c = enemyCombatant('warden_spirit', t.uid, t.slot ?? 0);
    Object.assign(t, c);
    t.memory = {};
    t.analyzed = false;
    this.ev.push({ t: 'phase', target: t.uid, key: d.id, name: d.name, hp: t.hp });
  }

  /** Rewards for a won battle. */
  rewards(): { xp: number; cred: number; drops: string[] } {
    let xp = 0, cred = 0;
    const drops: string[] = [];
    for (const k of this.defeated) {
      const d = ENEMIES[k];
      if (!d) continue;
      xp += d.xp;
      cred += d.cred;
      for (const dr of d.drops ?? []) if (this.rng.chance(dr.chance)) drops.push(dr.id);
    }
    return { xp, cred, drops };
  }
}

const GUARD: Ability = { id: 'guard', name: 'Guard', desc: 'Halve damage this round (a quarter from a blow you saw coming). A blow taken on a guard gives TP back; for Rook, a spent charge, once a fight.', kind: 'skill', target: 'self', effects: [], fx: 'guard' };

export function itemAbility(id: string): Ability {
  const it = must(ITEMS[id], `item ${id}`);
  return { id: `item:${id}`, name: it.name, desc: it.desc, kind: 'item', target: it.target ?? 'ally', effects: it.effects ?? [], fx: it.fx ?? 'item', element: it.element };
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
