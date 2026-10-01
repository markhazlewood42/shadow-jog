/**
 * Battle playback: turns the engine's events into what the player sees and hears (banners, poses,
 * FX, floaters, hitstop, cut-ins), one event at a time. It reaches the scene only through
 * PlaybackView, so it can't touch menus, layout or rendering.
 */
import { music } from '../../audio/music';
import { sfx } from '../../audio/sfx';
import { ABILITIES, COMBOS } from '../../data/abilities';
import { MEMBERS } from '../../data/party';
import { learn, state, type MemberId } from '../../game/state';
import { ENEMY_POSE_T } from './sprites';
import { COMBO_STING, ELEMENT_TAG, STATUS_LABEL, STATUS_SFX, STATUS_WORD, actionPose, elementMark, enemyMotion, fxSound, statusName } from './tables';
import type { Game } from '../../engine/game';
import type { Battle } from '../../battle/engine';
import type { BattleEvent, Combatant, Element } from '../../battle/types';
import type { FxLayer, Pt } from '../../battle/fx';
import type { Pose } from '../../art/battlers';
import type { Disp, Floater } from './types';
import { WINDOWS } from './timing';
import { PARTY_POSE_T } from './motion';
import { direction } from '../../engine/shake';
import { gpuCast, gpuDown, gpuHeal, gpuHit, gpuPhase, gpuSpell } from './gpufx';
import type { TimingProfile } from '../../battle/engine';

/** What playback may do to the scene. */
/** A face sliding in over a big moment; `line` is what they say, `row` stacks a third above. */
export interface Cutin {
  key: string;
  face: string;
  t: number;
  fromLeft: boolean;
  life: number;
  line?: string;
  row?: number;
}

export interface PlaybackView {
  readonly battle: Battle;
  readonly fx: FxLayer;
  readonly game: Game;
  /** The actor of the event being played (for crit cut-ins). */
  lastActor: Combatant | null;
  d(uid: number): Disp;
  pos(uid: number): Pt;
  /** Wait `frames`, scaled by the battle speed setting. */
  w(frames: number): Promise<void>;
  /** Real frames that `frames` of animation (poses and effects, on the effect clock) take now. */
  anim(frames: number): number;
  /** What the UI calls a combatant (two of a kind get a letter). */
  label(u: Combatant): string;
  /** Hex's deck pops up over her card while a program runs. */
  deckCutin(): void;
  floatOn(uid: number, text: string, color: string, style: Floater['style']): void;
  say(text: string): void;
  /** Pin an enemy's tell on screen until that enemy has acted on it. */
  tell(text: string, actor: number): void;
  showBanner(text: string, color: string, big?: boolean): void;
  setBanner(b: { text: string; sub?: string; t: number; color: string; big?: boolean }): void;
  /** Clear the banner quickly (a combo's name gives way as its strike lands). */
  endBanner(): void;
  setPose(u: Combatant, pose: Pose, frames: number): void;
  initDisp(u: Combatant): void;
  cutin(c: Cutin): void;
  cutinCount(): number;
  /** Freeze the battle for `frames` (a heavy hit landing). */
  hitstop(frames: number): Promise<void>;
  markDead(uid: number): void;
  /** The roster changed (a summon, a phase shift): recompute enemy placement. */
  relayout(): void;
  comboId(name: string): string;
  /** This action offers a timed press whose ring hasn't opened yet: its profile, or null. */
  timingArmed(): TimingProfile | null;
  /** Open the ring: it meets its target `lead` real frames from now. */
  openTiming(lead: number): void;
  /** A hit that ends things: the camera pushes in and, on an enemy, an impact frame cuts in. */
  impact(uid: number, color: string): void;
}

/**
 * Wind up, play the move's effect and wait for its hit. The windup and the effect are animation
 * (effect frames: the pose and the effect run on the same clock, see BattleScene FX_PACE), so
 * they're converted to real frames at the current rate. With a timed press armed, the windup is
 * held long enough for the ring to be read (real frames: battle speed can't squeeze the beat) and
 * the ring closes exactly as the effect lands.
 */
async function windupAndHit(v: PlaybackView, fx: string, from: Pt, to: Pt[], windup: number, color?: string): Promise<void> {
  // The power gathers at the caster through the windup (GPU effects; most moves have no cast).
  gpuCast(fx, from);
  const profile = v.timingArmed();
  if (profile) {
    const impact = v.anim(v.fx.impactOf(fx, from, to, color));
    const lead = Math.max(WINDOWS[profile].lead, v.anim(windup) + impact);
    v.openTiming(lead);
    await v.game.wait(lead - impact);
    const t = v.fx.play(fx, from, to, color);
    gpuSpell(fx, to, t.impact);
    sfx(fxSound(fx));
    await v.game.wait(impact);
    return;
  }
  await v.game.wait(v.anim(windup));
  const timing = v.fx.play(fx, from, to, color);
  gpuSpell(fx, to, timing.impact);
  sfx(fxSound(fx));
  await v.game.wait(v.anim(timing.impact));
}

/**
 * Freeze-frames spent in the current action. A blast that lands heavy on three enemies stops time
 * once, on the first; the rest ride the shake, so area attacks punch instead of stuttering.
 */
let actionStops = 0;
/** The action being played is a combo (its first heavy hit gets the impact frame). */
let comboAction = false;

export async function playEvent(v: PlaybackView, e: BattleEvent): Promise<void> {
  switch (e.t) {
    case 'act': {
      actionStops = 0;
      comboAction = false;
      const actor = v.battle.unit(e.actor)!;
      v.lastActor = actor;
      const dd = v.d(e.actor);
      const color = actor.side === 'party' ? MEMBERS[actor.key as MemberId].color : '#ff8a8a';
      v.showBanner(e.kind === 'attack' || e.name === 'Attack' ? v.label(actor) : `${v.label(actor)}: ${e.name}`, color);
      if (actor.side === 'party') {
        const pose = actionPose(actor.key, e.kind, e.targets.map((t) => v.battle.unit(t)?.side), e.fx);
        // Melee poses move by their swing beats (motion.ts); the rest just rise a little.
        dd.lunge = pose === 'attack' || pose === 'thrust' ? 0 : 6;
        v.setPose(actor, pose, PARTY_POSE_T);
        if (e.fx === 'flash_step' || e.fx === 'rain_hits') dd.afterimage = 22;
        sfx(e.kind === 'tech' ? 'cast' : 'swing');
        // Hex's programs run on her deck: show it (Mark's playthrough: "I want to see it!").
        if (actor.key === 'hex' && e.kind === 'tech') v.deckCutin();
      } else {
        // Enemies act with their bodies: strikes wind up and lunge, guns kick, casters rise and glow.
        const motion = enemyMotion(e.fx);
        v.setPose(actor, motion, ENEMY_POSE_T);
        if (motion !== 'attack') dd.flash = 8;
        sfx('enemy_act');
      }
      // Enemies call their moves; the crew calls its big ones.
      const cry = ABILITIES[e.id]?.cry;
      if (cry && (e.kind === 'enemy' || actor.side === 'party')) v.say(cry);
      const windup = actor.side === 'enemy' ? 12 : e.kind === 'attack' ? 8 : 16;
      await windupAndHit(v, e.fx, v.pos(e.actor), e.targets.map((t) => v.pos(t)), windup, e.element === 'shock' ? '#9ae8ff' : undefined);
      break;
    }
    case 'combo': {
      actionStops = 0;
      comboAction = true;
      const names = e.actors.map((a) => v.battle.unit(a)!.name).join(' + ');
      const first = !state.combos.includes(v.comboId(e.name));
      if (first) state.combos.push(v.comboId(e.name));
      for (const a of e.actors) {
        v.d(a).hop = 10;
        const u = v.battle.unit(a)!;
        if (u.side === 'party') v.setPose(u, u.key === 'hex' || u.key === 'sable' ? 'cast' : 'attack', 70);
      }
      sfx('combo');
      // Each combo lands with its own voice under the shared fanfare.
      const sting = COMBO_STING[v.comboId(e.name)];
      if (sting) void v.game.wait(10).then(() => sfx(sting));
      // The caller says the word on their cut-in; a third partner's slides in on the row above.
      const call = COMBOS.find((c) => c.id === v.comboId(e.name))?.call;
      e.actors.forEach((a, i) => {
        const u = v.battle.unit(a)!;
        if (u.side !== 'party') return;
        const line = call?.member === u.key ? call.line : undefined;
        // As long as the name card holds (below), so the crew is in view again when the blow lands.
        v.cutin({ key: u.key, face: line ? 'angry' : 'smirk', t: 0, fromLeft: i % 2 === 0, life: 56, row: i >> 1, ...(line ? { line } : {}) });
      });
      v.setBanner({ text: `★ ${e.name.toUpperCase()} ★`, sub: first ? `${names}  —  COMBO DISCOVERED!` : names, t: 0, color: '#ffe07a', big: true });
      v.game.flash('#ffffff', 6);
      // Held long enough to read the name and the call (longer since the 2026-09-29 playthrough).
      await v.w(56);
      // The name clears before the hits land, so the numbers never appear under it.
      v.endBanner();
      await windupAndHit(v, e.fx, v.pos(e.actors[0]!), e.targets.map((t) => v.pos(t)), 0);
      break;
    }
    case 'damage': {
      const dd = v.d(e.target);
      const u = v.battle.unit(e.target)!;
      dd.hp = e.hp;
      dd.shake = 12;
      dd.flash = u.side === 'enemy' ? 5 : 8;
      if (u.side === 'enemy' && e.hp > 0 && (e.crit || e.amount >= u.base.maxHp * 0.12)) v.setPose(u, 'hurt', 16);
      if (u.side === 'party' && e.hp > 0) v.setPose(u, 'hurt', 16);
      if (e.amount === 0) v.floatOn(e.target, 'NO EFFECT', '#8b8fa8', 'label');
      else {
        v.floatOn(e.target, String(e.amount), e.crit ? '#ffe07a' : e.weak ? '#ffa24a' : e.resist ? '#b8bcd0' : u.side === 'party' ? '#ff9a9a' : '#ffffff', 'hit');
        if (e.crit) v.floatOn(e.target, 'CRITICAL', '#ffe07a', 'label');
        else if (e.weak) v.floatOn(e.target, 'WEAK!', '#ffa24a', 'label');
        else if (e.resist) v.floatOn(e.target, 'RESIST', '#b8bcd0', 'label');
        // Field notes: what the crew learns the hard way sticks (target info, bestiary).
        if (u.side === 'enemy') {
          if (e.weak) learn(state.weakSeen, u.key, e.element);
          else if (e.resist) learn(state.resistSeen, u.key, e.element);
        }
      }
      sfx(e.crit ? 'crit' : u.side === 'party' ? 'hurt' : 'hit');
      // A critical on a boss gets the striker's face.
      if (e.crit && u.boss && v.lastActor?.side === 'party' && !v.cutinCount()) {
        v.cutin({ key: v.lastActor.key, face: 'smirk', t: 0, fromLeft: true, life: 45 });
      }
      // Weight by share of the target's max HP: light taps barely move the camera, big hits stop time.
      const share = e.amount / u.base.maxHp;
      const tier = e.crit || share >= 0.4 ? 3 : share >= 0.2 ? 2 : share >= 0.08 ? 1 : 0;
      // The frame kicks the way the blow travelled, then springs back.
      const from = v.lastActor && v.lastActor.uid !== e.target ? v.pos(v.lastActor.uid) : null;
      if (tier) v.game.shake(6 + tier * 3, tier + 1 + (e.crit ? 1 : 0), from ? direction(from, v.pos(e.target)) : undefined);
      // GPU effects (when on): the damage type's burst, and for the big ones a shockwave.
      if (e.amount > 0) gpuHit(v.pos(e.target), from, e.element, tier, { crit: !!e.crit, weak: !!e.weak, combo: comboAction && tier >= 2 && actionStops === 0 });
      if (tier >= 2 && actionStops === 0) {
        actionStops++;
        // A critical or a combo landing is a different kind of moment: push in, cut to the impact.
        if (u.side === 'enemy' && (e.crit || comboAction)) v.impact(e.target, e.crit ? '#ffe07a' : '#ff9ae0');
        // A big blow on the crew lands as hard as one of theirs: the camera pushes in on who took
        // it, and a crushing one flashes the frame red.
        if (u.side === 'party') {
          v.impact(e.target, '#ff5a5a');
          if (tier === 3) v.game.flash('#ff2a4a', 4);
        }
        await v.hitstop(tier === 3 ? 5 : 3);
      }
      await v.w(14);
      break;
    }
    case 'miss':
      v.floatOn(e.target, 'MISS', '#b8bcd0', 'label');
      sfx('miss');
      await v.w(14);
      break;
    case 'heal':
      v.d(e.target).hp = e.hp;
      // A perfect press on a healing skill: a brighter number, and a chime on top of the heal.
      v.floatOn(e.target, `+${e.amount}`, e.crit ? '#d8ffc8' : '#86f08c', 'hit');
      gpuHeal(v.pos(e.target), !!e.crit);
      sfx('heal');
      if (e.crit) {
        v.d(e.target).flash = 10;
        sfx('sting_life');
      }
      await v.w(e.crit ? 18 : 12);
      break;
    case 'tp':
      v.d(e.target).tp = e.tp;
      v.floatOn(e.target, `+${e.amount} TP`, '#6ff3ff', 'label');
      sfx('heal');
      await v.w(12);
      break;
    case 'status': {
      const word = STATUS_WORD[e.status];
      if (word && e.status !== 'guard' && e.status !== 'cover') {
        const col = STATUS_LABEL[e.status]?.[1] ?? '#ffffff';
        if (e.on) v.floatOn(e.target, word, col, 'label');
        if (e.on) sfx(STATUS_SFX[e.status] ?? (e.status.endsWith('_up') || e.status === 'regen' ? 'buff' : 'debuff'));
        await v.w(e.on ? 12 : 2);
      }
      break;
    }
    case 'down': {
      const u = v.battle.unit(e.target)!;
      const dd = v.d(e.target);
      dd.hp = 0;
      if (u.side === 'enemy') {
        dd.flash = 10;
        dd.dying = 1;
        sfx('enemy_die');
        gpuDown(v.pos(e.target), !!u.boss);
        v.markDead(u.uid);
        state.bestiary[u.key] = (state.bestiary[u.key] ?? 0) + 1;
      } else {
        sfx('ko');
        v.say(`${u.name} is down!`);
      }
      // An enemy's dissolve is animation (28 effect frames): wait most of it out.
      await v.game.wait(u.side === 'enemy' ? v.anim(22) : v.anim(26));
      break;
    }
    case 'revive':
      v.d(e.target).hp = e.hp;
      v.floatOn(e.target, 'REVIVED', '#ffe07a', 'label');
      sfx('revive');
      await v.w(18);
      break;
    case 'msg':
      v.say(e.text);
      await v.w(40);
      break;
    case 'tell':
      // A tell is the fight's most important line: time to read it before anything moves (and it
      // stays pinned after; see BattleScene.tell). Mark's playthrough: "impossible to read".
      v.tell(e.text, e.actor);
      sfx('alert');
      await v.w(40 + Math.round(e.text.length * 1.2));
      break;
    case 'immune': {
      const u = v.battle.unit(e.target)!;
      v.floatOn(e.target, 'IMMUNE', '#c9b8ff', 'label');
      if (u.side === 'enemy') learn(state.immuneSeen, u.key, e.status);
      v.say(`${v.label(u)} is immune to ${statusName(e.status)}.`);
      sfx('miss');
      await v.w(24);
      break;
    }
    case 'fail':
      v.say(e.reason);
      v.d(e.actor).shake = 6;
      await v.w(32);
      break;
    case 'flee':
      if (e.ok) {
        v.say('The crew slips away!');
        sfx('flee');
        for (const p of v.battle.party) v.d(p.uid).hidden = false;
      } else {
        v.say('Couldn’t get away!');
        sfx('buzz');
      }
      await v.w(40);
      break;
    case 'summon':
      for (const uid of e.uids) {
        const u = v.battle.unit(uid)!;
        v.initDisp(u);
      }
      sfx('summon');
      for (let t = 0; t < 20; t++) {
        for (const uid of e.uids) v.d(uid).alpha = t / 20;
        await v.game.wait(1);
      }
      await v.w(10);
      break;
    case 'phase': {
      v.relayout();
      const dd = v.d(e.target);
      sfx('phase');
      gpuPhase(v.pos(e.target));
      v.game.flash('#ffffff', 20);
      v.game.shake(30, 4);
      v.showBanner(`${e.name}!`, '#b89aff', true);
      dd.hp = e.hp;
      dd.alpha = 0;
      dd.dying = 0;
      music(null, 10);
      for (let t = 0; t < 30; t++) {
        dd.alpha = t / 30;
        await v.game.wait(1);
      }
      music('boss2', 0, 1.6);
      await v.w(20);
      break;
    }
    case 'analyze': {
      const u = v.battle.unit(e.target)!;
      const weak = Object.entries(u.weak ?? {}).filter(([, v]) => (v ?? 1) > 1).map(([k]) => k as Element);
      const res = Object.entries(u.weak ?? {}).filter(([, v]) => (v ?? 1) < 1).map(([k]) => k as Element);
      // Analyze writes what it finds into the crew's notes (bestiary, target cursor).
      if (u.side === 'enemy') {
        for (const el of weak) learn(state.weakSeen, u.key, el);
        for (const el of res) learn(state.resistSeen, u.key, el);
        for (const st of u.immune ?? []) learn(state.immuneSeen, u.key, st);
      }
      // Symbol and word together: this is where the damage-type symbols get taught.
      const named = (els: Element[]) => els.map((el) => `${elementMark(el)} ${ELEMENT_TAG[el]}`).join('  ');
      v.say(`${v.label(u)}: HP ${u.hp}/${u.base.maxHp}${weak.length ? `  WEAK ${named(weak)}` : ''}${res.length ? `  RESISTS ${named(res)}` : ''}`);
      await v.w(70);
      break;
    }
    case 'tick': {
      const dd = v.d(e.target);
      dd.hp = e.hp;
      dd.shake = 6;
      const col = STATUS_LABEL[e.status]?.[1] ?? '#ffffff';
      v.floatOn(e.target, `-${e.amount}`, col, 'tick');
      sfx('tick');
      await v.w(12);
      break;
    }
    case 'turn':
      break;
  }
}
