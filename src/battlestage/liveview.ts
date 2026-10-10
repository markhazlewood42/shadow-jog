/**
 * The HUD's view of a LIVE battle (M3 task 6): the `HudView` the stage's HUD draws, made from the state of the shipped battle scene (`scenes/battle.ts`) instead of from the lab's example
 * turn (`demo.ts`) or the Battle Test's flow (`battledrive.ts`). Pure: it reads a `LiveSource` (the few public members of the scene it needs) and returns plain data, so a
 * unit test can run it with a made-up source.
 *
 * What it shows is what the OLD battle shows, in the stage's design: a hero's health and resource are the DISPLAYED values (`Disp.shownHp`, `shownTp`: they ease toward the engine's, so
 * a bar moves instead of jumping), the turn timeline is the engine's own plan (`previewOrder` while orders are given, `roundOrder` while the round plays), a foe's tags are its
 * states and the weak spots the crew KNOWS (analyzed, or learned by a weak hit: the old target box's rule), not the whole chart. The command strip is not part of it: the menus are the
 * game's own until M4, so `command` is a stand-in the HUD (`menus: 'game'`) never draws.
 */
import type { Battle } from '../battle/engine';
import type { Combatant, Command, Element } from '../battle/types';
import { state } from '../game/state';
import type { Disp } from '../scenes/battlekit/types';
import { foeViews, type HudFoeView, type HudMemberView, type HudTag, type HudView, memberView, type Phase, rotate } from './demo';

/** The modes of the battle scene (its private `Mode` type, named here because the scene does not export it). */
export type LiveMode = 'intro' | 'round' | 'command' | 'list' | 'target' | 'play' | 'end';

/** What the view needs from the battle scene. `BattleScene` has all of it as public members. */
export interface LiveSource {
  readonly battle: Battle;
  readonly mode: LiveMode;
  /** The member giving orders (command, list and target modes). */
  readonly actor: Combatant | undefined;
  readonly cmds: readonly Command[];
  readonly targetList: readonly number[];
  readonly targetIdx: number;
  readonly banner: { text: string; big?: boolean | undefined } | null;
  d(uid: number): Disp;
  actors(): Combatant[];
}

/** The phase of the HUD's design that each mode of the battle is in. */
export function phaseOf(mode: LiveMode): Phase {
  switch (mode) {
    case 'target':
      return 'target';
    case 'play':
    case 'end':
    case 'intro':
      return 'act';
    default:
      return 'choose';
  }
}

/** The stage's number for a fighter: a hero is 0 to 3, an enemy is 10 plus its place in the engine's list of enemies (a summoned one has a uid of 100 and up, so the uid will not do). */
export function slotOf(battle: Battle, uid: number): number {
  if (uid < 10) return uid;
  const at = battle.enemies.findIndex((c) => c.uid === uid);
  return at >= 0 ? 10 + at : uid;
}

/** The uids of the order the timeline shows, as stage numbers: fighters who are down are left out. Empty while there is no plan (the intro, the end). */
export function timelineOrder(s: LiveSource): number[] {
  const flat = (lists: readonly (readonly number[])[]): number[] => {
    const seen = new Set<number>();
    const out: number[] = [];
    for (const actors of lists)
      for (const u of actors) {
        if (seen.has(u) || (s.battle.unit(u)?.hp ?? 0) <= 0) continue;
        seen.add(u);
        out.push(slotOf(s.battle, u));
      }
    return out;
  };
  if (s.mode === 'play') return flat(s.battle.roundOrder);
  if (s.mode === 'intro' || s.mode === 'end') return [];
  // The orders given so far, and everyone else assumed to attack (the old strip's rule): the plan the round will have if nothing changes.
  const given = new Set(s.cmds.map((c) => c.actor));
  const rest: Command[] = s.actors().filter((p) => !given.has(p.uid)).map((p) => ({ actor: p.uid, type: 'attack' as const, target: -1 }));
  return flat(s.battle.previewOrder([...s.cmds, ...rest]));
}

const STATUS_WORDS: Record<string, string> = { shield: 'SHIELD UP', stun: 'STUNNED', burn: 'BURNING', poison: 'POISONED' };

/** The elements a foe is known to be weak to: all of them once analyzed, else the ones the crew has learned the hard way. */
export function knownWeak(c: Combatant): Element[] {
  if (c.analyzed) return Object.entries(c.weak ?? {}).filter(([, v]) => (v ?? 1) > 1).map(([k]) => k as Element);
  return (state.weakSeen[c.key] ?? []) as Element[];
}

/** The tags under a foe's name in the foe box: its current states, then the weak spots the crew knows. */
export function liveTags(c: Combatant): HudTag[] {
  const tags: HudTag[] = c.status.filter((s) => s.id !== 'guard').map((s) => ({ text: STATUS_WORDS[s.id] ?? s.id.toUpperCase().replace(/_/g, ' '), tone: 'amber' as const }));
  const weak = knownWeak(c);
  if (weak.length) tags.push({ text: `WEAK: ${weak.map((e) => e.toUpperCase()).join(' ')}`, tone: 'cyan' });
  return tags;
}

/** A combatant as the player sees it now: the displayed health and resource, the engine's states. */
function seen(c: Combatant, d: Disp): Combatant {
  return { ...c, hp: d.hp <= 0 ? 0 : Math.max(0, Math.round(d.shownHp)), tp: Math.max(0, Math.round(d.shownTp)) };
}

/** The HUD's view of this moment of the live battle. */
export function liveView(s: LiveSource): HudView {
  const b = s.battle;
  const party: HudMemberView[] = b.party.map((c) => memberView(seen(c, s.d(c.uid))));
  // A foe's bar and number are the displayed ones; a fallen foe reads 0.
  const foes: HudFoeView[] = foeViews(b.enemies.map((c) => seen(c, s.d(c.uid)))).map((v, i) => ({ ...v, tags: liveTags(b.enemies[i] as Combatant) }));
  const order = timelineOrder(s);
  const phase = phaseOf(s.mode);
  let lead = -1;
  if (s.mode === 'command' || s.mode === 'list' || s.mode === 'target') lead = s.actor ? s.actor.uid : -1;
  else if (s.mode === 'play') {
    const first = (b.roundOrder[b.roundAt] ?? [])[0];
    lead = first === undefined ? -1 : slotOf(b, first);
  }
  const turns = rotate(order, order.includes(lead) ? lead : (order[0] ?? lead));
  const active = lead >= 0 && lead < 10 ? lead : -1;
  // Aiming: an enemy under the cursor is the foe box's aimed foe; an ally under the cursor is rung in amber on the stage.
  const aimedUid = s.mode === 'target' ? s.targetList[s.targetIdx] : undefined;
  const aimed = aimedUid === undefined ? undefined : b.unit(aimedUid);
  const target = aimed?.side === 'enemy' ? slotOf(b, aimed.uid) - 10 : null;
  const allyTarget = aimed && aimed.side === 'party' ? aimed.uid : null;
  const banner = s.banner && !s.banner.big ? s.banner.text : null;
  return { phase, party, foes, turns, active, target, allyTarget, command: { label: '', cost: '', selected: 'attack' }, banner, act: null };
}

/**
 * A short text that changes whenever anything the HUD shows changes, so the stage rebuilds the HUD's objects only then (rebuilding is the costly part). It reads the same numbers the view does.
 */
export function viewSignature(v: HudView): string {
  let sig = `${v.phase}|${v.active}|${v.target}|${v.allyTarget ?? ''}|${v.banner ?? ''}|`;
  for (const m of v.party) sig += `${m.hp}/${m.maxHp},${m.res},${m.status.join('+')};`;
  sig += '|';
  for (const f of v.foes) sig += `${f.name}:${f.hp}/${f.maxHp},${f.status.join('+')},${f.tags.map((t) => t.text).join('+')};`;
  sig += '|';
  for (const t of v.turns) sig += `${t.side[0]}${t.index},`;
  return sig;
}
