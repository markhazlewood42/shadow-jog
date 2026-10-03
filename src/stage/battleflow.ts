/**
 * The Battle Test's brain (Phaser spike `spike/phaser-stage`): a real fight, driven by the game's own battle engine
 * (`src/battle`, unchanged), as plain data. No Phaser, no browser: the unit tests play whole fights through it.
 *
 * WHAT THE ENGINE GIVES US. `Battle` is a pure state machine. A round goes: every hero gets an order (`Command`),
 * `startRound(orders)` plans who acts when, then `next()` declares the next action and `land()` resolves it, which
 * CHANGES THE STATE AT ONCE and returns a list of events ("Rook uses Arc Cut", "9 damage to the punk", "the punk is
 * down"). It knows nothing about animation. Presentation is somebody else's job, and that is this file's other half.
 *
 * WHAT THIS FILE ADDS.
 *  1. **Orders.** A tiny menu state machine (`press`): pick a command with left/right, a skill with up/down, a target
 *     with up/down, Enter to confirm, Esc to step back. `auto` makes the orders for you (so a test can run a fight).
 *  2. **What the player has SEEN.** The engine has already applied the whole action by the time we animate it, so the
 *     health bars must not simply read the engine: the punk's bar should drop when the blade lands, not 40 ticks
 *     earlier. `disp` is the DISPLAYED state of every fighter (health, resource, status, down). It advances only when
 *     the performance reaches an event (`applyEvent`), and after every action it is checked against the engine
 *     (`syncAll`), so it can never drift.
 *  3. **Scripts.** `makeScript` sorts one action's events into what a performer needs: who acts, with what, and the
 *     IMPACTS (damage, heal, miss) grouped into WAVES (one wave = one blow landing on one or more targets at the same
 *     moment; a second hit on the same target starts a new wave).
 *  4. **The HUD's view** (`view`): the same `HudView` the lab's HUD draws, built from the displayed state.
 *
 * Timed presses (the ring that rewards a button press on the beat) are not part of the Battle Test: every action
 * resolves with timing `none`.
 */
import { Battle } from '../battle/engine';
import { enemyParty, partyCombatant } from '../battle/setup';
import type { Ability, BattleEvent, Combatant, Command, Element, StatusState } from '../battle/types';
import { ABILITIES, ability } from '../data/abilities';
import { MEMBERS } from '../data/party';
import { Rng } from '../engine/rng';
import { createMember, knownAbilities, memberStats } from '../game/party';
import type { MemberId } from '../game/state';
import type { DemoMember, StageConfig, StageDemo } from './config';
import { type ActView, costText, foeViews, type HudView, memberView, rotate, withStoryFlags } from './demo';
import { COMMAND_ICONS, type IconKind } from './icons';

// ------------------------------------------------------------------ what the player has seen

/** What one fighter looks like on screen right now (it can lag behind the engine while an action is playing). */
export interface Disp {
  hp: number;
  tp: number;
  status: StatusState[];
  down: boolean;
}

/** One thing that lands on one fighter. */
export interface Impact {
  kind: 'damage' | 'heal' | 'miss' | 'tick';
  target: number;
  amount: number;
  crit: boolean;
  weak: boolean;
  resist: boolean;
  /** Health after this impact (the engine's number). */
  hp: number;
  element: Element;
  /** The fighter went down with this impact. */
  down: boolean;
  /** For a `tick` (poison, burn): the status that did it. */
  status?: string;
}

/** One action of a round, sorted for a performer. */
export interface ActionScript {
  /** The lead actor's uid, or -1 for the end-of-round events. */
  actor: number;
  actors: number[];
  abilityId: string;
  name: string;
  fx: string;
  kind: Ability['kind'] | 'end';
  targets: number[];
  /** Impacts grouped into waves, in order. */
  waves: Impact[][];
  /** Events that apply when the action starts (a resource paid) and when it ends (statuses, rewards, messages). */
  before: BattleEvent[];
  after: BattleEvent[];
  /** Text to show when the action has no `act` event (a stunned fighter loses its turn). */
  messages: string[];
  combo: boolean;
}

/** Sort one action's events (declared and landed) into a script. */
export function makeScript(events: readonly BattleEvent[], battle?: Battle): ActionScript {
  const s: ActionScript = { actor: -1, actors: [], abilityId: '', name: '', fx: '', kind: 'end', targets: [], waves: [], before: [], after: [], messages: [], combo: false };
  let wave: Impact[] = [];
  const flush = (): void => {
    if (wave.length) s.waves.push(wave);
    wave = [];
  };
  const impact = (i: Impact): void => {
    if (wave.some((w) => w.target === i.target)) flush();
    wave.push(i);
  };
  for (const e of events) {
    switch (e.t) {
      case 'act':
        s.actor = e.actor;
        s.actors = [e.actor];
        s.abilityId = e.id;
        s.name = e.name;
        s.fx = e.fx;
        s.kind = e.kind;
        s.targets = e.targets;
        break;
      case 'combo':
        s.actor = e.actors[0] ?? -1;
        s.actors = e.actors;
        s.name = e.name;
        s.fx = e.fx;
        s.kind = 'combo';
        s.targets = e.targets;
        s.combo = true;
        s.abilityId = battle?.combosUsed[battle.combosUsed.length - 1] ?? '';
        break;
      case 'damage':
        impact({ kind: 'damage', target: e.target, amount: e.amount, crit: e.crit, weak: e.weak, resist: e.resist, hp: e.hp, element: e.element, down: false });
        break;
      case 'miss':
        impact({ kind: 'miss', target: e.target, amount: 0, crit: false, weak: false, resist: false, hp: Number.NaN, element: 'phys', down: false });
        break;
      case 'heal':
        impact({ kind: 'heal', target: e.target, amount: e.amount, crit: !!e.crit, weak: false, resist: false, hp: e.hp, element: 'phys', down: false });
        break;
      case 'tick':
        impact({ kind: 'tick', target: e.target, amount: e.amount, crit: false, weak: false, resist: false, hp: e.hp, element: 'phys', down: false, status: e.status });
        break;
      case 'down': {
        const hit = [...s.waves.flat(), ...wave].reverse().find((i) => i.target === e.target && i.kind !== 'heal');
        if (hit) hit.down = true;
        else s.after.push(e);
        break;
      }
      case 'tp':
        if (s.waves.length === 0 && wave.length === 0) s.before.push(e);
        else s.after.push(e);
        break;
      case 'msg':
      case 'fail':
        s.messages.push(e.t === 'msg' ? e.text : e.reason);
        s.after.push(e);
        break;
      case 'turn':
        break;
      default:
        s.after.push(e);
    }
  }
  flush();
  return s;
}

/** Apply one event to the displayed state of the fighters. */
export function applyEvent(disp: ReadonlyMap<number, Disp>, e: BattleEvent): void {
  const d = (uid: number): Disp | undefined => disp.get(uid);
  switch (e.t) {
    case 'damage':
    case 'heal':
    case 'tick': {
      const x = d(e.target);
      if (x) x.hp = e.hp;
      break;
    }
    case 'tp': {
      const x = d(e.target);
      if (x) x.tp = e.tp;
      break;
    }
    case 'status': {
      const x = d(e.target);
      if (!x) break;
      x.status = x.status.filter((s) => s.id !== e.status);
      if (e.on) x.status.push({ id: e.status, turns: 99 });
      break;
    }
    case 'down': {
      const x = d(e.target);
      if (x) {
        x.down = true;
        x.hp = 0;
      }
      break;
    }
    case 'revive': {
      const x = d(e.target);
      if (x) {
        x.down = false;
        x.hp = e.hp;
      }
      break;
    }
    default:
      break;
  }
}

// ------------------------------------------------------------------ the flow

export type Key = 'left' | 'right' | 'up' | 'down' | 'ok' | 'back';
export type Mode = 'command' | 'target' | 'playing' | 'over';

export interface FlowSetup {
  /** Who is in the party (levels and gear) and the story flags that decide which skills they know. */
  demo: StageDemo;
  /** Enemy keys (`ENEMIES`) in slot order. */
  roster: string[];
  seed: number;
  /** Start every fighter at full resource (KI, RAM, MANA, skill uses). The party is built at full health either way. */
  fullResources: boolean;
}

/** What a performer needs to say to the HUD while an action plays. */
export interface PlayInfo {
  /** The acting fighter's uid. */
  actor: number;
  /** The lead target's index among the sides' lists (a foe index for an enemy target, a party index for an ally). */
  targetFoe: number | null;
  banner: string | null;
  act: ActView | null;
}

export class BattleFlow {
  readonly battle: Battle;
  readonly disp = new Map<number, Disp>();
  readonly setup: FlowSetup;
  mode: Mode = 'command';
  /** One-line message for the status line (why a choice was refused). */
  message = '';
  /** The uid of the hero choosing orders. */
  hero = 0;
  menu = 0;
  /** The skill list of the hero choosing: tech and skill ids they know. */
  private skills = new Map<number, string[]>();
  private skillAt = 0;
  private targetAt = 0;
  private orders: Command[] = [];
  /** The ability being aimed (with its candidate targets) in the target mode. */
  private aiming: { ab: Ability; type: Command['type']; candidates: number[] } | null = null;
  autoPlay = false;
  private playing: PlayInfo | null = null;
  private ended = false;
  /** Rounds played, for the log. */
  rounds = 0;

  constructor(setup: FlowSetup) {
    this.setup = setup;
    const party = withStoryFlags(setup.demo, () => {
      const list: Combatant[] = [];
      setup.demo.party.forEach((l, i) => {
        const m = createMember(l.id as MemberId, l.level);
        Object.assign(m.equip, l.equip ?? {});
        const c = partyCombatant(m, i, i);
        c.hp = c.base.maxHp;
        if (setup.fullResources) c.tp = c.base.maxTp;
        list.push(c);
        // The skills this hero knows depend on the story flags, which are only set inside this call.
        this.skills.set(i, knownAbilities(m).filter((id) => ABILITIES[id]?.kind === 'tech' || ABILITIES[id]?.kind === 'skill'));
      });
      return list;
    });
    this.battle = new Battle(party, enemyParty(setup.roster), new Rng(setup.seed), { canRun: false });
    this.syncAll();
    this.beginOrders();
  }

  // ---------------------------------------------------------------- displayed state

  private syncAll(): void {
    for (const u of this.battle.units) this.disp.set(u.uid, { hp: u.hp, tp: u.tp, status: u.status.map((s) => ({ ...s })), down: u.hp <= 0 });
  }

  /** Make what is shown match the engine (after an action's events have all been shown). */
  sync(): void {
    this.syncAll();
  }

  /** A copy of a combatant showing what the player has seen (the HUD builders read a `Combatant`). */
  seen(c: Combatant): Combatant {
    const d = this.disp.get(c.uid);
    return d ? { ...c, hp: d.hp, tp: d.tp, status: d.status } : c;
  }

  get party(): readonly Combatant[] {
    return this.battle.party;
  }
  get foes(): readonly Combatant[] {
    return this.battle.enemies;
  }

  // ---------------------------------------------------------------- orders

  private aliveHeroes(): Combatant[] {
    return this.battle.party.filter((c) => c.hp > 0);
  }

  /** Open a new round's orders: the first living hero chooses. */
  beginOrders(): void {
    this.battle.rollInitiative();
    this.orders = [];
    this.playing = null;
    this.ended = false;
    const first = this.aliveHeroes()[0];
    if (!first) {
      this.mode = 'over';
      return;
    }
    this.mode = 'command';
    this.hero = first.uid;
    this.menu = 0;
    this.skillAt = 0;
    this.message = '';
  }

  /** The skills the choosing hero can pick from, with whether each is affordable. */
  skillList(uid = this.hero): Array<{ id: string; name: string; cost: string; ok: boolean }> {
    const c = this.battle.unit(uid);
    if (!c) return [];
    return (this.skills.get(uid) ?? []).map((id) => {
      const ab = ABILITIES[id] as Ability;
      const ok = ab.kind === 'tech' ? c.tp >= (ab.cost ?? 0) : (c.uses[id] ?? 0) > 0;
      return { id, name: ab.name, cost: costText(c, id), ok };
    });
  }

  /** The command strip's three lines for the HUD: label, cost and which icon is lit. */
  private commandView(): HudView['command'] {
    const kind: IconKind = COMMAND_ICONS[this.menu] ?? 'attack';
    if (kind === 'skill') {
      const sk = this.skillList()[this.skillAt];
      return sk ? { label: sk.name, cost: sk.cost, selected: kind } : { label: 'No skills', cost: '', selected: kind };
    }
    const label: Record<IconKind, string> = { attack: 'Attack', skill: 'Skill', combo: 'Combo', item: 'Item', guard: 'Guard', run: 'Run' };
    return { label: label[kind], cost: '', selected: kind };
  }

  /** Candidate targets for an ability aimed by a hero: foes, allies, or fallen allies. Null when no choice is needed. */
  candidates(ab: Ability): number[] | null {
    switch (ab.target) {
      case 'enemy':
        return this.battle.alive('enemy').map((u) => u.uid);
      case 'ally':
        return this.aliveHeroes().map((u) => u.uid);
      case 'ally_down':
        return this.battle.party.filter((u) => u.hp <= 0).map((u) => u.uid);
      default:
        return null;
    }
  }

  private commit(cmd: Command): void {
    this.orders.push(cmd);
    this.aiming = null;
    const next = this.aliveHeroes().find((c) => !this.orders.some((o) => o.actor === c.uid));
    if (next) {
      this.hero = next.uid;
      this.mode = 'command';
      this.menu = 0;
      this.skillAt = 0;
      this.message = '';
    }
  }

  /** True when every living hero has an order. */
  get ordersDone(): boolean {
    return this.aliveHeroes().every((c) => this.orders.some((o) => o.actor === c.uid));
  }

  /** Aim an ability: ask for a target if it needs one, else file the order. */
  private choose(ab: Ability, type: Command['type']): void {
    const cands = this.candidates(ab);
    if (cands === null) {
      this.commit({ actor: this.hero, type, ...(type === 'attack' ? {} : { id: ab.id }), target: -1 });
    } else if (cands.length === 0) {
      this.message = `${ab.name} has no one to aim at.`;
    } else {
      this.aiming = { ab, type, candidates: cands };
      this.targetAt = 0;
      this.mode = 'target';
    }
  }

  /**
   * One key press in the orders menus. Returns `true` when the last hero has just confirmed (the round is ready to
   * `beginRound`). Left/right choose the command, up/down the skill (or the target), Enter confirms, Esc steps back.
   */
  press(k: Key): boolean {
    this.message = '';
    if (this.mode === 'command') {
      if (k === 'left') this.menu = (this.menu + COMMAND_ICONS.length - 1) % COMMAND_ICONS.length;
      else if (k === 'right') this.menu = (this.menu + 1) % COMMAND_ICONS.length;
      else if ((k === 'up' || k === 'down') && COMMAND_ICONS[this.menu] === 'skill') {
        const n = this.skillList().length;
        if (n) this.skillAt = (this.skillAt + (k === 'down' ? 1 : n - 1)) % n;
      } else if (k === 'back') {
        // Step back to the previous hero's order.
        const prev = [...this.orders].pop();
        if (prev) {
          this.orders.pop();
          this.hero = prev.actor;
          this.menu = 0;
        }
      } else if (k === 'ok') {
        const kind = COMMAND_ICONS[this.menu];
        if (kind === 'attack') this.choose(ability('attack'), 'attack');
        else if (kind === 'guard') this.commit({ actor: this.hero, type: 'guard' });
        else if (kind === 'skill') {
          const sk = this.skillList()[this.skillAt];
          if (!sk) this.message = 'This hero knows no skills yet.';
          else if (!sk.ok) this.message = `${sk.name} is not available (${sk.cost}).`;
          else {
            const ab = ABILITIES[sk.id] as Ability;
            this.choose(ab, ab.kind === 'tech' ? 'tech' : 'skill');
          }
        } else this.message = `${kind === 'combo' ? 'Combos' : 'Items'} are not in the Battle Test yet.`;
      }
    } else if (this.mode === 'target' && this.aiming) {
      const n = this.aiming.candidates.length;
      if (k === 'up' || k === 'left') this.targetAt = (this.targetAt + n - 1) % n;
      else if (k === 'down' || k === 'right') this.targetAt = (this.targetAt + 1) % n;
      else if (k === 'back') this.mode = 'command';
      else if (k === 'ok') {
        const { ab, type, candidates } = this.aiming;
        this.commit({ actor: this.hero, type, ...(type === 'attack' ? {} : { id: ab.id }), target: candidates[this.targetAt] ?? -1 });
      }
    }
    return this.mode !== 'playing' && this.mode !== 'over' && this.ordersDone;
  }

  /** Orders for every hero who has none: Attack the first living enemy, and on every other round the first skill they can afford. */
  autoOrders(): void {
    for (const hero of this.aliveHeroes()) {
      if (this.orders.some((o) => o.actor === hero.uid)) continue;
      const foe = this.battle.alive('enemy')[0];
      const sk = this.skillList(hero.uid).find((s) => s.ok && (ABILITIES[s.id] as Ability).target === 'enemy');
      if (sk && this.rounds % 2 === 1 && foe) {
        const ab = ABILITIES[sk.id] as Ability;
        this.orders.push({ actor: hero.uid, type: ab.kind === 'tech' ? 'tech' : 'skill', id: ab.id, target: foe.uid });
      } else this.orders.push({ actor: hero.uid, type: 'attack', target: foe?.uid ?? -1 });
    }
  }

  // ---------------------------------------------------------------- the round

  /** Start playing the round with the orders given (fills in anyone missing with auto orders). */
  beginRound(): void {
    this.autoOrders();
    this.mode = 'playing';
    this.rounds++;
    this.ended = false;
    this.battle.startRound(this.orders);
  }

  /** The next action of the round, resolved in the engine, as a script; null when the round is over. */
  nextScript(): ActionScript | null {
    if (this.mode !== 'playing') return null;
    const step = this.battle.next();
    if (!step) {
      if (this.ended) return null;
      this.ended = true;
      const events = this.battle.endRound();
      const s = makeScript(events, this.battle);
      return s.waves.length || s.after.length ? s : null;
    }
    const landed = this.battle.land('none');
    return makeScript([...step.events, ...landed], this.battle);
  }

  /** Called when an action has been shown completely: the display catches up with the engine, and the fight may be over. */
  actionShown(): void {
    this.syncAll();
    if (this.battle.outcome) this.mode = 'over';
  }

  /** The round has been played out: back to orders (or the end). */
  endRound(): void {
    if (this.battle.outcome) this.mode = 'over';
    else this.beginOrders();
  }

  get outcome(): 'win' | 'lose' | 'fled' | null {
    return this.battle.outcome;
  }

  /** Set what the HUD should say while an action plays (null between actions). */
  setPlaying(info: PlayInfo | null): void {
    this.playing = info;
  }

  // ---------------------------------------------------------------- the HUD's view

  /** The uids of the order the turn timeline shows (a hero's turn first). */
  private timelineOrder(): number[] {
    const flat = (lists: readonly (readonly number[])[]): number[] => {
      const seen = new Set<number>();
      const out: number[] = [];
      for (const actors of lists)
        for (const u of actors) {
          if (seen.has(u) || this.disp.get(u)?.down) continue;
          seen.add(u);
          out.push(u);
        }
      return out;
    };
    if (this.mode === 'playing' || this.mode === 'over') return flat(this.battle.roundOrder);
    const cmds: Command[] = this.aliveHeroes().map((h) => this.orders.find((o) => o.actor === h.uid) ?? { actor: h.uid, type: 'attack' as const, target: -1 });
    return flat(this.battle.previewOrder(cmds));
  }

  /** The HUD's view of this moment. */
  view(): HudView {
    const party = this.battle.party.map((c) => memberView(this.seen(c)));
    const foes = foeViews(this.battle.enemies.map((c) => this.seen(c)));
    const order = this.timelineOrder();
    const playing = this.mode === 'playing' || this.mode === 'over';
    const lead = playing && this.playing ? this.playing.actor : this.hero;
    const turns = rotate(order, order.includes(lead) ? lead : (order[0] ?? lead));
    if (playing) {
      const p = this.playing;
      const actorIsHero = p ? p.actor < 10 : false;
      return {
        phase: 'act',
        party,
        foes,
        turns,
        active: actorIsHero && p ? p.actor : -1,
        target: p?.targetFoe ?? null,
        command: { label: p?.banner ?? '', cost: '', selected: 'skill' },
        banner: p?.banner ?? null,
        act: p?.act ?? null,
      };
    }
    const hero = this.battle.unit(this.hero);
    const name = hero ? MEMBERS[hero.key as MemberId].name : '';
    const aim = this.mode === 'target' ? this.aiming : null;
    const aimedUid = aim ? (aim.candidates[this.targetAt] ?? null) : null;
    const aimsAtFoe = aim?.ab.target === 'enemy';
    return {
      phase: this.mode === 'target' ? 'target' : 'choose',
      party,
      foes,
      turns,
      active: this.hero,
      target: aimsAtFoe && aimedUid !== null ? aimedUid - 10 : null,
      allyTarget: aim && !aimsAtFoe && aimedUid !== null ? aimedUid : null,
      command: aim ? { label: aim.ab.name, cost: costText(hero as Combatant, aim.ab.id), selected: aim.type === 'attack' ? 'attack' : 'skill' } : this.commandView(),
      banner: aim ? `${name}: pick ${aimsAtFoe ? 'a target' : 'an ally'}` : this.message || null,
      act: null,
    };
  }
}

// ------------------------------------------------------------------ the numbers the Battle Test dialog shows

/** What a loadout comes to in the game's own stat code (the dialog's "Status" panel, like RPG Maker's). */
export interface LoadoutStats {
  name: string;
  level: number;
  maxHp: number;
  maxTp: number;
  resLabel: string;
  atk: number;
  def: number;
  mnd: number;
  agi: number;
  skills: string[];
}

/** Stats for the party member at `index` of `demo.party`, worked out by `memberStats` with the story flags the demo names. */
export function loadoutStats(demo: StageDemo, index: number): LoadoutStats | null {
  const l = demo.party[index];
  if (!l) return null;
  return withStoryFlags(demo, () => {
    const m = createMember(l.id as MemberId, l.level);
    Object.assign(m.equip, l.equip ?? {});
    const s = memberStats(m);
    const def = MEMBERS[l.id as MemberId];
    return {
      name: def.name,
      level: l.level,
      maxHp: s.maxHp,
      maxTp: s.maxTp,
      resLabel: def.tpLabel,
      atk: s.atk,
      def: s.def,
      mnd: s.mnd,
      agi: s.agi,
      skills: knownAbilities(m)
        .filter((id) => ABILITIES[id]?.kind === 'tech' || ABILITIES[id]?.kind === 'skill')
        .map((id) => ABILITIES[id]?.name ?? id),
    };
  });
}

// ------------------------------------------------------------------ what the dialog hands over

/** What the Battle Test dialog hands over. */
export interface BattleTestOptions {
  /** Who fights, in party order (slot 1 first): crew id, level and the gear and story flags from the stage's demo loadout. */
  party: DemoMember[];
  /** The enemies (keys of `ENEMIES`) standing in the stage's slot set for that many (the first a boss for a boss set). */
  roster: string[];
  /** Which slot set: "3", "boss+1"... */
  setKey: string;
  seed: number;
  /** Start every fighter with full KI, RAM, MANA and skill uses. */
  fullResources: boolean;
  /** 1 or 2: game ticks per 1/60 s. */
  speed: 1 | 2;
  /** The computer gives the heroes' orders (so the fight plays itself). */
  auto: boolean;
}

/** Apply the dialog's choices to a stage config: who stands in the party slots and which enemies fill the group. */
export function stageForTest(stage: StageConfig, o: BattleTestOptions): StageConfig {
  const copy = JSON.parse(JSON.stringify(stage)) as StageConfig;
  copy.demo.lineup = o.party.map((m) => m.id);
  copy.demo.party = o.party.map((m) => ({ ...m }));
  copy.demo.rosters[o.setKey] = [...o.roster];
  return copy;
}

