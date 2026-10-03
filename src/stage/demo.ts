/**
 * The lab's example fight, made from the game's REAL data (Phaser spike `spike/phaser-stage`).
 *
 * The stage lab shows a battle HUD, and a HUD full of invented numbers would prove nothing. So every number on
 * it comes from the game: the crew's hit points and resources are what `memberStats` gives a character of that
 * level and gear, the enemies' hit points and names are their definitions in `src/data/enemies.ts`, the turn
 * order is what the battle engine itself plans for a round, and the damage in the "acting" state is what the
 * engine really dealt, with the same seed, every time.
 *
 * This file makes no pictures and imports no Phaser: it builds a plain `HudView` (who is on screen, with what
 * numbers, in what phase), which the HUD widgets draw. It runs in a unit test as well as in the browser.
 *
 * Three phases of a player's turn are shown, as in the design's mockups:
 *   - **choose**: the party's first actor has the command menu open (the timeline's NOW chip is that hero);
 *   - **target**: the second hero has picked a skill and is choosing whom to hit (banner "Hex: pick a target",
 *     the enemy box shows the highlighted foe's details and weak spot);
 *   - **act**: an action is playing: the skill's name on the banner, the hit counter, the damage number.
 */
import { Battle } from '../battle/engine';
import { enemyParty, partyCombatant } from '../battle/setup';
import type { BattleEvent, Combatant, Element, Command, StatusId } from '../battle/types';
import { ABILITIES } from '../data/abilities';
import { ENEMIES } from '../data/enemies';
import { MEMBERS } from '../data/party';
import { Rng } from '../engine/rng';
import { createMember, knownAbilities } from '../game/party';
import { flags } from '../game/state';
import type { MemberId } from '../game/state';
import type { ShownHit } from './combo';
import { setSize, type DemoAct, type StageDemo } from './config';
import type { IconKind } from './icons';

export type Phase = 'choose' | 'target' | 'act';

/** One hero's row of the party table. */
export interface HudMemberView {
  id: string;
  name: string;
  /** The hero's own colour (their name's colour in the table and on the timeline chip). */
  color: string;
  hp: number;
  maxHp: number;
  /** "KI", "RAM", "MANA", or "—" for a hero with no resource (Rook). */
  resLabel: string;
  res: number;
  /** 0 when the hero has no resource: the table then draws a dash. */
  resMax: number;
  /** The statuses on the hero (the battle engine's own ids, as displayed now): the table draws an icon for each. */
  status: StatusId[];
}

export interface HudTag {
  text: string;
  tone: 'cyan' | 'amber';
}

/** One enemy as the HUD shows it. */
export interface HudFoeView {
  /** The enemy definition id (`ENEMIES`). */
  defId: string;
  /** Its art key (`def.sprite`), which says which face to cut. */
  sprite: string;
  /** Its name, with " A", " B"... when several of one kind are in the fight. */
  name: string;
  /** The letter alone ("A", "B"...) when several of one kind are in the fight, else "". Every place that marks a duplicate (the timeline chip, the lists, the target box) reads this, so they cannot disagree. */
  tag: string;
  hp: number;
  maxHp: number;
  boss: boolean;
  tags: HudTag[];
  /** The statuses on the foe (the engine's own ids), drawn as the same icons the party table uses. */
  status: StatusId[];
}

/** One chip of the turn timeline: a hero or an enemy, by index in `party` / `foes`. */
export interface TurnChipView {
  side: 'party' | 'enemy';
  index: number;
}

/** What an action that is playing shows. */
export interface ActView {
  attacker: number;
  target: number;
  skillName: string;
  fx: DemoAct['fx'];
  /** Damage of the featured hit, and whether it was a critical. */
  dmg: number;
  crit: boolean;
  /** The featured hit struck a weak spot (its number is drawn in cyan). */
  weak?: boolean;
  /**
   * The hits the combo counter counts, each one a damage number on the stage. The counter's "N HIT" and its total are worked out
   * from this list (`comboOf`) and nothing else, so they cannot disagree with the numbers shown.
   */
  hitList: ShownHit[];
  /** Live battle only: the stage draws its own floating numbers, so the HUD must not draw this one. */
  liveNumbers?: boolean;
  /** Live battle only: how much of the combo window is left (0 to 1). The lab shows a fixed share. */
  windowLeft?: number;
}

/** Everything the HUD widgets and the stage's markers need to draw one moment of the fight. */
export interface HudView {
  phase: Phase;
  party: HudMemberView[];
  foes: HudFoeView[];
  /** The timeline: `turns[0]` is the NOW chip. */
  turns: TurnChipView[];
  /** The hero choosing or acting (an index into `party`). */
  active: number;
  /** The enemy being aimed at or hit, if any (an index into `foes`). */
  target: number | null;
  /** The command strip: its label line (a skill's name or "Attack"), its cost text, and which icon is lit. */
  command: { label: string; cost: string; selected: IconKind };
  /** The skill banner's text: a prompt while a target is picked, the skill's name while it plays. */
  banner: string | null;
  act: ActView | null;
  /** Live battle only: the ally a support skill is aimed at (an index into `party`); the stage rings that hero in amber. */
  allyTarget?: number | null;
}

/**
 * Run `fn` with the story flags the demo party's loadouts name switched on (they decide what Rook's wound costs him
 * and which skills the crew know), and switch back off exactly the ones this call turned on. Safe to nest.
 */
export function withStoryFlags<T>(demo: StageDemo, fn: () => T): T {
  const turnedOn: string[] = [];
  for (const m of demo.party) for (const f of m.flags ?? []) {
      if (flags.has(f)) continue;
      flags.set(f);
      turnedOn.push(f);
    }
  try {
    return fn();
  } finally {
    for (const f of turnedOn) flags.clear(f);
  }
}

/** The party as real combatants, at full health, built the way the game builds them (level + gear, through `memberStats`). */
export function demoParty(demo: StageDemo): Combatant[] {
  return withStoryFlags(demo, () =>
    demo.party.map((l, i) => {
      const m = createMember(l.id as MemberId, l.level);
      Object.assign(m.equip, l.equip ?? {});
      const c = partyCombatant(m, i, i);
      c.hp = c.base.maxHp;
      c.tp = c.base.maxTp;
      return c;
    }),
  );
}

/** The words for the weak spot a foe has against an element, "WEAK: SHOCK". The strongest weakness above 1, or none. */
function weakTag(c: Combatant): HudTag | null {
  let best: [Element, number] | null = null;
  for (const [el, mult] of Object.entries(c.weak ?? {}) as Array<[Element, number]>) if (mult > 1 && (!best || mult > best[1])) best = [el, mult];
  return best ? { text: `WEAK: ${best[0].toUpperCase()}`, tone: 'cyan' } : null;
}

const STATUS_WORDS: Record<string, string> = { shield: 'SHIELD UP', stun: 'STUNNED', burn: 'BURNING', poison: 'POISONED' };

/** The tags under the target's name: its current states, then its weak spot. */
export function tagsFor(c: Combatant): HudTag[] {
  const tags: HudTag[] = c.status.map((s) => ({ text: STATUS_WORDS[s.id] ?? s.id.toUpperCase().replace(/_/g, ' '), tone: 'amber' as const }));
  const w = weakTag(c);
  if (w) tags.push(w);
  return tags;
}

export function memberView(c: Combatant): HudMemberView {
  const def = MEMBERS[c.key as MemberId];
  return { id: c.key, name: def.name, color: def.color, hp: c.hp, maxHp: c.base.maxHp, resLabel: def.tpLabel, res: c.tp, resMax: c.base.maxTp, status: c.status.map((s) => s.id) };
}

const DUPLICATE_TAGS = 'ABCDEF';

/** Enemy views, with " A", " B" on repeats of one kind. */
export function foeViews(foes: readonly Combatant[]): HudFoeView[] {
  const total = new Map<string, number>();
  for (const f of foes) total.set(f.key, (total.get(f.key) ?? 0) + 1);
  const seen = new Map<string, number>();
  return foes.map((f) => {
    const n = (seen.get(f.key) ?? 0) + 1;
    seen.set(f.key, n);
    const letter = (total.get(f.key) ?? 0) > 1 ? (DUPLICATE_TAGS[n - 1] ?? '') : '';
    const tag = letter ? ` ${letter}` : '';
    return { defId: f.key, sprite: ENEMIES[f.key]?.sprite ?? f.key, name: f.name + tag, tag: letter, hp: f.hp, maxHp: f.base.maxHp, boss: !!f.boss, tags: tagsFor(f), status: f.status.map((s) => s.id) };
  });
}

/** A skill's cost as the command strip prints it: "KI 4", "5 left". */
export function costText(owner: Combatant, abilityId: string): string {
  const ab = ABILITIES[abilityId];
  if (!ab) return '';
  if (ab.kind === 'tech') return `${MEMBERS[owner.key as MemberId].tpLabel} ${ab.cost ?? 0}`;
  return `${owner.uses[abilityId] ?? ab.uses ?? 0} left`;
}

/** The first tech, else the first skill a hero knows: what the "target" phase shows them aiming. */
function firstSkill(c: Combatant): string | null {
  const known = knownAbilities({ id: c.key as MemberId, level: c.level } as never);
  return known.find((id) => ABILITIES[id]?.kind === 'tech') ?? known.find((id) => ABILITIES[id]?.kind === 'skill') ?? null;
}

/** The party's actors in the order the engine plans a round where everyone attacks (a whole round of the example fight). */
function roundOrder(party: Combatant[], foes: Combatant[], seed: number): number[] {
  const b = new Battle(party, foes, new Rng(seed));
  b.startRound(party.map((c) => ({ actor: c.uid, type: 'attack' as const, target: -1 })));
  const seen = new Set<number>();
  const order: number[] = [];
  for (const actors of b.roundOrder)
    for (const uid of actors) {
      if (seen.has(uid)) continue;
      seen.add(uid);
      order.push(uid);
    }
  return order;
}

/** The chips of a timeline that starts at `uid`: the rest of this round in order, then the ones that have already acted (next round, in the same order). */
export function rotate(order: number[], uid: number): TurnChipView[] {
  const at = Math.max(0, order.indexOf(uid));
  return [...order.slice(at), ...order.slice(0, at)].map((u) => (u < 10 ? { side: 'party' as const, index: u } : { side: 'enemy' as const, index: u - 10 }));
}

/**
 * Play the featured action of the example round in the real engine: everyone attacks except the attacker, who uses
 * their skill on their target; stop when it has landed. Returns what it did and the state of everyone at that moment.
 * When `chain` is false the others guard instead of attacking: a small group (one punk) would be dead before the
 * featured hero's turn, and the action would never happen.
 */
function playAct(demo: StageDemo, roster: string[], seed: number, chain: boolean): { party: Combatant[]; foes: Combatant[]; act: ActView } | null {
  const party = demoParty(demo);
  const foes = enemyParty(roster);
  const attacker = party.find((c) => c.key === demo.act.attacker);
  const target = foes[demo.act.target];
  const ab = ABILITIES[demo.act.skill];
  if (!attacker || !target || !ab) return null;
  const cmds: Command[] = party.map((c) => (c === attacker ? { actor: c.uid, type: ab.kind === 'tech' ? 'tech' : 'skill', id: ab.id, target: target.uid } : chain ? { actor: c.uid, type: 'attack', target: -1 } : { actor: c.uid, type: 'guard' }));
  const b = new Battle(party, foes, new Rng(seed));
  b.startRound(cmds);
  for (let step = b.next(); step; step = b.next()) {
    const lead = step.events.find((e): e is Extract<BattleEvent, { t: 'act' }> => e.t === 'act');
    const events = [...step.events, ...b.land('none')];
    const damage = events.filter((e): e is Extract<BattleEvent, { t: 'damage' }> => e.t === 'damage');
    if (!lead || lead.actor !== attacker.uid) continue; // the lab's still shows ONE action, so its counter counts that action's hits
    const onFoes = damage.filter((d) => d.target >= 10);
    const hitList: ShownHit[] = onFoes.map((d) => ({ target: foes.findIndex((f) => f.uid === d.target), amount: d.amount, crit: !!d.crit, weak: !!d.weak }));
    const hit = onFoes.find((d) => d.target === target.uid) ?? onFoes[0];
    return { party, foes, act: { attacker: attacker.uid, target: demo.act.target, skillName: ab.name, fx: demo.act.fx, dmg: hit?.amount ?? 0, crit: !!hit?.crit, weak: !!hit?.weak, hitList } };
  }
  return null;
}

/**
 * The featured action, played so that it LANDS: the lab's still shows a hit, so an action that misses with the file's seed (the
 * engine rolled a miss) is played again with the next seeds, in order, until one deals damage. Deterministic, and the same as
 * before for every group where the first seed already lands.
 */
function playLandingAct(demo: StageDemo, roster: string[]): { party: Combatant[]; foes: Combatant[]; act: ActView } | null {
  let first: { party: Combatant[]; foes: Combatant[]; act: ActView } | null = null;
  for (let k = 0; k < 40; k++) {
    const played = playAct(demo, roster, demo.seed + k, true) ?? playAct(demo, roster, demo.seed + k, false);
    first ??= played;
    if (played && played.act.hitList.length > 0) return played;
  }
  return first;
}

/** Whose turn it is in the "target" phase: the second hero in the planned order (the first is the one choosing in "choose"). */
function secondHero(order: number[]): number {
  return order.filter((u) => u < 10)[1] ?? 0;
}

/**
 * The HUD's data for one moment: `phase` of the example round on this stage's lab party, against `roster` (the
 * enemy keys standing in the shown group, boss first for a boss set; defaults to the stage's own roster for that set).
 */
export function buildHudView(demo: StageDemo, setKey: string, phase: Phase, roster: string[] = demo.rosters[setKey] ?? []): HudView {
  return withStoryFlags(demo, () => buildView(demo, setKey, phase, roster));
}

function buildView(demo: StageDemo, setKey: string, phase: Phase, roster: string[]): HudView {
  if (roster.length !== setSize(setKey)) throw new Error(`A roster of ${roster.length} does not fit the set "${setKey}"`);
  const party = demoParty(demo);
  const foes = enemyParty(roster);
  const order = roundOrder(party, foes, demo.seed);
  const firstHero = order.find((u) => u < 10) ?? 0;

  if (phase === 'act') {
    const played = playLandingAct(demo, roster);
    if (!played) throw new Error('The example action could not be played (check demo.act in the stage file)');
    const { act } = played;
    return {
      phase,
      party: played.party.map(memberView),
      foes: foeViews(played.foes),
      turns: rotate(order, act.attacker),
      active: act.attacker,
      target: act.target,
      command: { label: act.skillName, cost: '', selected: 'skill' },
      banner: `${MEMBERS[played.party[act.attacker]?.key as MemberId].name}: ${act.skillName}`,
      act,
    };
  }

  const heroUid = phase === 'choose' ? firstHero : secondHero(order);
  const hero = party[heroUid];
  if (!hero) throw new Error('The example party has no hero to act');
  const skill = phase === 'target' ? firstSkill(hero) : null;
  const name = MEMBERS[hero.key as MemberId].name;
  return {
    phase,
    party: party.map(memberView),
    foes: foeViews(foes),
    turns: rotate(order, heroUid),
    active: heroUid,
    target: phase === 'target' ? 0 : null,
    command: skill ? { label: ABILITIES[skill]?.name ?? 'Skill', cost: costText(hero, skill), selected: 'skill' } : { label: 'Attack', cost: '', selected: 'attack' },
    banner: phase === 'target' ? `${name}: pick a target` : null,
    act: null,
  };
}
