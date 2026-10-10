/**
 * The headless battle driver of the battle stage (M3 task 7; docs/engine/m3-brief.md sections 4 and 5): a REAL fight, played by the game's own battle engine
 * (`src/battle`, unchanged), as plain data. No Pixi, no browser, no scene. It is the pure half of the Phaser spike's Battle Test brain (`src/stage/battleflow.ts`):
 * the parts that sort an action's events into what a performer needs (`makeScript`) and keep the DISPLAYED state of every fighter (`Disp`, `applyEvent`). The
 * menus (`press`) and the dialog belong to the Battle Test scene and the Battle Stage Editor, which are milestone ET, and are not here.
 *
 * WHAT THE ENGINE GIVES US. `Battle` is a pure state machine. A round goes: initiative is rolled, every hero gets an order (`Command`), `startRound(orders)` plans
 * who acts when, then `next()` declares the next action and `land()` resolves it, which CHANGES THE STATE AT ONCE and returns a list of events ("Rook uses Arc Cut",
 * "9 damage to the punk", "the punk is down"). It knows nothing about animation. Presentation is somebody else's job.
 *
 * WHAT THIS FILE ADDS.
 *  1. **What the player has SEEN.** The engine has already applied the whole action by the time we animate it, so a health bar must not read the engine: the
 *     punk's bar should drop when the blade lands, not 40 ticks earlier. `Disp` is the DISPLAYED state of every fighter. It advances only when the performance
 *     reaches an event (`applyEvent`), and after every action it is compared with the engine (`drift`) before it catches up (`sync`).
 *  2. **Scripts.** `makeScript` sorts one action's events into who acts, with what, and the IMPACTS grouped into WAVES (one wave is one blow landing on one or more
 *     targets at the same moment; a second hit on the same target starts a new wave).
 *  3. **Ticks.** `BattleDrive` plays a seeded fight on a fixed timetable of ticks (60 a second of game time, like the stage), so `step(n)` is exactly n ticks and a test
 *     can stop the fight at any tick. The timetable (`PACE`) is a test fixture, not the look of the battle: the shipped battle takes its pace from `battle.ts`.
 *  4. **The status trace.** After every action the displayed state of every fighter is written as one line of text. The same seed gives the same lines, and
 *     `legacyTrace` makes the lines from the engine alone, the way the shipped battle scene calls it (`BattleScene.executeRound`), so a test can hold the two equal.
 *
 * Timed presses (the ring that rewards a button press on the beat) are not part of this: every action resolves with timing `none`.
 */
import { Battle } from '../battle/engine';
import { enemyParty } from '../battle/setup';
import type { BattleEvent, Combatant, Command, Element, StatusState } from '../battle/types';
import { autoOrders } from '../scenes/battlekit/orders';
import { Rng } from '../sje';
import type { StageConfig, StageDemo } from './config';
import { demoParty } from './demo';

// ------------------------------------------------------------------ what the player has seen

/** What one fighter looks like on screen right now (it can lag behind the engine while an action is playing). */
export interface Disp {
  hp: number;
  tp: number;
  status: StatusState[];
  down: boolean;
  /**
   * Which form the player has seen: an enemy's key, name and top health. A boss phase change (the Warden's shell breaks and the spirit inside is loose) swaps these in
   * the ENGINE at once, but the stage should keep the old name and bar until the picture changes too.
   */
  key: string;
  name: string;
  maxHp: number;
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
  kind: string;
  targets: number[];
  /** Impacts grouped into waves, in order. */
  waves: Impact[][];
  /** New enemies the action calls in (uids, one list per summon), shown when the performer reaches the cast's release. */
  summons: number[][];
  /** Bosses that change form: who, and the key and name of what they become. */
  phases: Array<{ target: number; key: string; name: string; hp: number }>;
  /** Events that apply when the action starts (a resource paid) and when it ends (statuses, rewards, messages). */
  before: BattleEvent[];
  after: BattleEvent[];
  /** Text to show when the action has no `act` event (a stunned fighter loses its turn). */
  messages: string[];
  combo: boolean;
}

/** Sort one action's events (declared and landed) into a script. */
export function makeScript(events: readonly BattleEvent[], battle?: Battle): ActionScript {
  const s: ActionScript = { actor: -1, actors: [], abilityId: '', name: '', fx: '', kind: 'end', targets: [], waves: [], summons: [], phases: [], before: [], after: [], messages: [], combo: false };
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
      case 'summon':
        s.summons.push([...e.uids]);
        break;
      case 'phase':
        s.phases.push({ target: e.target, key: e.key, name: e.name, hp: e.hp });
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
        // The engine clears every status of a fighter that goes down (`Battle.kill`) and says nothing more about it, so the display clears them here.
        x.status = [];
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

// ------------------------------------------------------------------ the status trace

/** The ids of a fighter's statuses, sorted (the engine and the display may hold them in a different order). */
function statusIds(list: readonly StatusState[]): string {
  return list
    .map((s) => s.id)
    .sort()
    .join('+');
}

/** One fighter as a trace word: `key hp/maxHp tp status down`. */
function word(key: string, name: string, hp: number, maxHp: number, tp: number, status: readonly StatusState[], down: boolean): string {
  return `${key}:${name}:${hp}/${maxHp}:${tp}:${statusIds(status) || '-'}${down ? ':down' : ''}`;
}

/** The engine's state of every fighter as a trace line body (party first, then the enemies in the engine's list). */
function engineWords(battle: Battle): string {
  return battle.units.map((u) => word(u.key, u.name, Math.max(0, u.hp), u.base.maxHp, u.tp, u.status, u.hp <= 0)).join(' ');
}

/** What an action is called in the trace: the lead event of its declaration. */
function headOf(events: readonly BattleEvent[]): string {
  for (const e of events) {
    if (e.t === 'act') return `act:${e.actor}:${e.id}`;
    if (e.t === 'combo') return `combo:${e.actors.join(',')}:${e.name}`;
  }
  return 'none';
}

// ------------------------------------------------------------------ a seeded fight

/** What to fight: the party and the enemies, and the seed that decides every roll. */
export interface DriveSetup {
  /** Who is in the party (levels and gear) and the story flags that decide which skills they know. */
  demo: StageDemo;
  /** Enemy keys (`ENEMIES`) in slot order. */
  roster: string[];
  seed: number;
  /** The most rounds to play (a fight that stalls is stopped: a guard for tests, not a rule of the game). */
  maxRounds?: number;
  /** Start every fighter at full resource (KI, RAM, MANA, skill uses). The party is built at full health either way. */
  fullResources?: boolean;
  /** The orders for a round. Default: the game's own Auto (`autoOrders`, everyone attacks). */
  orders?: (battle: Battle) => Command[];
  /** How one event reaches the displayed state. Default `applyEvent`; a test puts a broken one here to see that the trace notices. */
  apply?: (disp: ReadonlyMap<number, Disp>, e: BattleEvent) => void;
}

const DEFAULT_ROUNDS = 12;

/** The party as the game builds it (level, gear, flags), at full health. */
function buildFight(setup: DriveSetup): Battle {
  const party = demoParty(setup.demo);
  if (setup.fullResources) for (const c of party) c.tp = c.base.maxTp;
  return new Battle(party, enemyParty(setup.roster), new Rng(setup.seed), { canRun: false });
}

/** The default orders: the game's own Auto. */
function autoFor(battle: Battle): Command[] {
  return autoOrders(battle.party.filter((p) => p.hp > 0));
}

/** The timetable of the driver, in ticks. A test fixture: it only has to be fixed. */
export const PACE = {
  /** The orders are open this long. */
  orders: 30,
  /** From one wave of a blow to the next, and from the declaration to the first wave. */
  wave: 24,
  /** After an action, before the next one. */
  gap: 18,
} as const;

/** The result of a played fight. */
export interface DriveResult {
  trace: string[];
  outcome: Battle['outcome'];
  rounds: number;
  ticks: number;
  /** How many fighters the display disagreed with the engine about, summed over every action (0 when the display chain is right). */
  drift: number;
}

type Mode = 'orders' | 'acting' | 'gap' | 'over';

/**
 * A fight played on a fixed timetable of ticks. `step(n)` advances n ticks; the same seed gives the same trace however the ticks are split.
 * The displayed state (`disp`) moves only when a wave of a blow lands, as it would on the stage.
 */
export class BattleDrive {
  readonly battle: Battle;
  readonly disp = new Map<number, Disp>();
  readonly trace: string[] = [];
  private mode: Mode = 'orders';
  private wait: number = PACE.orders;
  private ticks = 0;
  private rounds = 0;
  private drifted = 0;
  private script: ActionScript | null = null;
  private head = '';
  private wave = 0;
  private ended = false;
  private readonly maxRounds: number;
  private readonly apply: (disp: ReadonlyMap<number, Disp>, e: BattleEvent) => void;

  constructor(readonly setup: DriveSetup) {
    this.battle = buildFight(setup);
    this.maxRounds = setup.maxRounds ?? DEFAULT_ROUNDS;
    this.apply = setup.apply ?? applyEvent;
    this.syncAll();
    this.battle.rollInitiative();
  }

  get tick(): number {
    return this.ticks;
  }
  get over(): boolean {
    return this.mode === 'over';
  }
  get outcome(): Battle['outcome'] {
    return this.battle.outcome;
  }
  get drift(): number {
    return this.drifted;
  }

  /** The displayed state of every fighter as a trace line body. */
  status(): string {
    return this.battle.units.map((u) => this.wordOf(u)).join(' ');
  }

  private wordOf(u: Combatant): string {
    const d = this.disp.get(u.uid);
    return d ? word(d.key, d.name, Math.max(0, d.hp), d.maxHp, d.tp, d.status, d.down) : `${u.key}:unseen`;
  }

  /** Make what is shown match the engine (after an action's events have all been shown). */
  private syncAll(): void {
    for (const u of this.battle.units) this.disp.set(u.uid, { hp: u.hp, tp: u.tp, status: u.status.map((s) => ({ ...s })), down: u.hp <= 0, key: u.key, name: u.name, maxHp: u.base.maxHp });
  }

  /** How many fighters the display and the engine disagree about. Fighters called in by a summon that is not shown yet are not counted. */
  private countDrift(): number {
    let n = 0;
    for (const u of this.battle.units) {
      const d = this.disp.get(u.uid);
      if (!d) continue;
      if (word(d.key, d.name, Math.max(0, d.hp), d.maxHp, d.tp, d.status, d.down) !== word(u.key, u.name, Math.max(0, u.hp), u.base.maxHp, u.tp, u.status, u.hp <= 0)) n++;
    }
    return n;
  }

  /** Advance n ticks (1/60 s of game time each). The fight stops by itself when it is over. */
  step(n = 1): this {
    for (let i = 0; i < n && this.mode !== 'over'; i++) this.tickOnce();
    return this;
  }

  /** Play the fight to its end (or to `maxTicks`). */
  run(maxTicks = 200_000): DriveResult {
    while (this.mode !== 'over' && this.ticks < maxTicks) this.tickOnce();
    return this.result();
  }

  result(): DriveResult {
    return { trace: [...this.trace], outcome: this.battle.outcome, rounds: this.rounds, ticks: this.ticks, drift: this.drifted };
  }

  private tickOnce(): void {
    this.ticks++;
    if (--this.wait > 0) return;
    switch (this.mode) {
      case 'orders':
        this.beginRound();
        return;
      case 'acting':
        this.nextWave();
        return;
      case 'gap':
        this.nextAction();
        return;
      case 'over':
        return;
    }
  }

  private beginRound(): void {
    this.rounds++;
    this.ended = false;
    this.battle.startRound((this.setup.orders ?? autoFor)(this.battle));
    this.nextAction();
  }

  /** Declare and resolve the next action of the round (the engine changes at once; the display follows wave by wave). */
  private nextAction(): void {
    let events: BattleEvent[];
    const step = this.battle.next();
    if (step) {
      events = [...step.events, ...this.battle.land('none')];
      this.head = headOf(events);
    } else if (!this.ended) {
      this.ended = true;
      events = this.battle.endRound();
      this.head = 'end';
    } else {
      this.finishRound();
      return;
    }
    const script = makeScript(events, this.battle);
    this.script = script;
    this.wave = 0;
    for (const e of script.before) this.apply(this.disp, e);
    this.mode = 'acting';
    this.wait = PACE.wave;
  }

  /** One wave of the blow lands on the display; after the last the action's events end, the line is written and the display catches up. */
  private nextWave(): void {
    const s = this.script;
    if (!s) return;
    const wave = s.waves[this.wave];
    if (wave) {
      for (const i of wave) {
        const d = this.disp.get(i.target);
        if (!d) continue;
        if (i.kind !== 'miss') d.hp = i.hp;
        if (i.down) {
          d.down = true;
          d.hp = 0;
          d.status = [];
        }
      }
      this.wave++;
      this.wait = PACE.wave;
      return;
    }
    for (const e of s.after) this.apply(this.disp, e);
    // Called in by a summon and changed by a phase: shown when the action ends.
    for (const uids of s.summons)
      for (const uid of uids) {
        const c = this.battle.unit(uid);
        if (c) this.disp.set(uid, { hp: c.hp, tp: c.tp, status: c.status.map((x) => ({ ...x })), down: c.hp <= 0, key: c.key, name: c.name, maxHp: c.base.maxHp });
      }
    for (const p of s.phases) {
      const d = this.disp.get(p.target);
      if (d) {
        d.key = p.key;
        d.name = p.name;
        d.maxHp = this.battle.unit(p.target)?.base.maxHp ?? d.maxHp;
        d.hp = p.hp;
      }
    }
    this.drifted += this.countDrift();
    this.trace.push(`r${this.battle.round} ${this.head} | ${this.status()}`);
    this.syncAll();
    this.script = null;
    this.mode = 'gap';
    this.wait = PACE.gap;
  }

  private finishRound(): void {
    if (this.battle.outcome || this.rounds >= this.maxRounds) {
      this.mode = 'over';
      return;
    }
    this.battle.rollInitiative();
    this.mode = 'orders';
    this.wait = PACE.orders;
  }
}

/** Play a seeded fight to its end on the driver's timetable and return what happened. */
export function battleTrace(setup: DriveSetup): DriveResult {
  return new BattleDrive(setup).run();
}

/**
 * The same fight, made from the engine alone, in the order the shipped battle scene calls it (`BattleScene.executeRound`: `rollInitiative`, `startRound`, then
 * `next` and `land` until the round is done, then `endRound`), with no display, no timetable and no scripts in between. The lines are the engine's own state after
 * each action, so they are what the driver's displayed state must equal.
 */
export function legacyTrace(setup: DriveSetup): DriveResult {
  const battle = buildFight(setup);
  const trace: string[] = [];
  const max = setup.maxRounds ?? DEFAULT_ROUNDS;
  let rounds = 0;
  while (!battle.outcome && rounds < max) {
    battle.rollInitiative();
    rounds++;
    battle.startRound((setup.orders ?? autoFor)(battle));
    for (let step = battle.next(); step; step = battle.next()) {
      const events = [...step.events, ...battle.land('none')];
      trace.push(`r${battle.round} ${headOf(events)} | ${engineWords(battle)}`);
    }
    battle.endRound();
    trace.push(`r${battle.round} end | ${engineWords(battle)}`);
  }
  return { trace, outcome: battle.outcome, rounds, ticks: 0, drift: 0 };
}

// ------------------------------------------------------------------ the shipped stages' own fights

/** The party and the enemies of a stage's own demo for one enemy group ("3", "boss+1"...). */
export function setupFor(stage: StageConfig, setKey: string, seed: number): DriveSetup {
  const roster = stage.demo.rosters[setKey];
  if (!roster) throw new Error(`The stage "${stage.id}" has no enemy group "${setKey}"`);
  return { demo: stage.demo, roster: [...roster], seed, fullResources: true };
}
