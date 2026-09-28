/**
 * Battle playback: turns the engine's events into what the player sees and hears (banners, poses,
 * FX, floaters, hitstop, cut-ins), one event at a time. It reaches the scene only through
 * PlaybackView, so it can't touch menus, layout or rendering.
 */
import { music } from '../../audio/music';
import { sfx } from '../../audio/sfx';
import { ABILITIES } from '../../data/abilities';
import { MEMBERS } from '../../data/party';
import { learn, state, type MemberId } from '../../game/state';
import { ENEMY_POSE_T } from './sprites';
import { COMBO_STING, STATUS_LABEL, STATUS_SFX, STATUS_WORD, actionPose, enemyMotion, fxSound, statusName } from './tables';
import type { Game } from '../../engine/game';
import type { Battle } from '../../battle/engine';
import type { BattleEvent, Combatant } from '../../battle/types';
import type { FxLayer, Pt } from '../../battle/fx';
import type { Pose } from '../../art/battlers';
import type { Disp, Floater } from './types';
import { RING_LEAD } from './timing';

/** What playback may do to the scene. */
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
  floatOn(uid: number, text: string, color: string, style: Floater['style']): void;
  say(text: string): void;
  showBanner(text: string, color: string, big?: boolean): void;
  setBanner(b: { text: string; sub?: string; t: number; color: string; big?: boolean }): void;
  /** Clear the banner quickly (a combo's name gives way as its strike lands). */
  endBanner(): void;
  setPose(u: Combatant, pose: Pose, frames: number): void;
  initDisp(u: Combatant): void;
  cutin(c: { key: string; face: string; t: number; fromLeft: boolean; life: number }): void;
  cutinCount(): number;
  /** Freeze the battle for `frames` (a heavy hit landing). */
  hitstop(frames: number): Promise<void>;
  markDead(uid: number): void;
  /** The roster changed (a summon, a phase shift): recompute enemy placement. */
  relayout(): void;
  comboId(name: string): string;
  /** This action offers a timed press whose ring hasn't opened yet. */
  timingArmed(): boolean;
  /** Open the ring: it meets its target `lead` real frames from now. */
  openTiming(lead: number): void;
}

/**
 * Wind up, play the move's effect and wait for its hit. With a timed press armed, the windup is
 * held long enough for the ring to be read (real frames: battle speed can't squeeze the beat) and
 * the ring closes exactly as the effect lands.
 */
async function windupAndHit(v: PlaybackView, fx: string, from: Pt, to: Pt[], windup: number, color?: string): Promise<void> {
  if (v.timingArmed()) {
    const impact = v.fx.impactOf(fx, from, to, color);
    const lead = Math.max(RING_LEAD, windup + impact);
    v.openTiming(lead);
    await v.game.wait(lead - impact);
    v.fx.play(fx, from, to, color);
    sfx(fxSound(fx));
    await v.game.wait(impact);
    return;
  }
  await v.w(windup);
  const timing = v.fx.play(fx, from, to, color);
  sfx(fxSound(fx));
  await v.w(timing.impact);
}

/**
 * Freeze-frames spent in the current action. A blast that lands heavy on three enemies stops time
 * once, on the first; the rest ride the shake, so area attacks punch instead of stuttering.
 */
let actionStops = 0;

export async function playEvent(v: PlaybackView, e: BattleEvent): Promise<void> {
  switch (e.t) {
    case 'act': {
      actionStops = 0;
      const actor = v.battle.unit(e.actor)!;
      v.lastActor = actor;
      const dd = v.d(e.actor);
      const color = actor.side === 'party' ? MEMBERS[actor.key as MemberId].color : '#ff8a8a';
      v.showBanner(e.kind === 'attack' || e.name === 'Attack' ? `${actor.name}` : `${actor.name}: ${e.name}`, color);
      if (actor.side === 'party') {
        const pose = actionPose(actor.key, e.kind, e.targets.map((t) => v.battle.unit(t)?.side), e.fx);
        dd.lunge = pose === 'attack' || pose === 'thrust' ? 14 : 6;
        v.setPose(actor, pose, 34);
        if (e.fx === 'flash_step' || e.fx === 'rain_hits') dd.afterimage = 22;
        sfx(e.kind === 'tech' ? 'cast' : 'swing');
      } else {
        // Enemies act with their bodies: strikes wind up and lunge, guns kick, casters rise and glow.
        const motion = enemyMotion(e.fx);
        v.setPose(actor, motion, ENEMY_POSE_T);
        if (motion !== 'attack') dd.flash = 8;
        sfx('enemy_act');
      }
      const cry = e.kind === 'enemy' ? ABILITIES[e.id]?.cry : undefined;
      if (cry) v.say(cry);
      const windup = actor.side === 'enemy' ? 12 : e.kind === 'attack' ? 8 : 16;
      await windupAndHit(v, e.fx, v.pos(e.actor), e.targets.map((t) => v.pos(t)), windup, e.element === 'shock' ? '#9ae8ff' : undefined);
      break;
    }
    case 'combo': {
      actionStops = 0;
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
      e.actors.forEach((a, i) => {
        const u = v.battle.unit(a)!;
        if (u.side === 'party') v.cutin({ key: u.key, face: 'angry', t: 0, fromLeft: i === 0, life: 70 });
      });
      v.setBanner({ text: `★ ${e.name.toUpperCase()} ★`, sub: first ? `${names}  —  COMBO DISCOVERED!` : names, t: 0, color: '#ffe07a', big: true });
      v.game.flash('#ffffff', 6);
      await v.w(40);
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
      if (tier) v.game.shake(4 + tier * 3, tier + 1 + (e.crit ? 1 : 0));
      if (tier >= 2 && actionStops === 0) {
        actionStops++;
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
      v.floatOn(e.target, `+${e.amount}`, '#86f08c', 'hit');
      sfx('heal');
      await v.w(12);
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
        v.markDead(u.uid);
        state.bestiary[u.key] = (state.bestiary[u.key] ?? 0) + 1;
      } else {
        sfx('ko');
        v.say(`${u.name} is down!`);
      }
      await v.w(u.side === 'enemy' ? 16 : 26);
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
    case 'immune': {
      const u = v.battle.unit(e.target)!;
      v.floatOn(e.target, 'IMMUNE', '#c9b8ff', 'label');
      if (u.side === 'enemy') learn(state.immuneSeen, u.key, e.status);
      v.say(`${u.name} is immune to ${statusName(e.status)}.`);
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
      const weak = Object.entries(u.weak ?? {}).filter(([, v]) => (v ?? 1) > 1).map(([k]) => k.toUpperCase());
      const res = Object.entries(u.weak ?? {}).filter(([, v]) => (v ?? 1) < 1).map(([k]) => k.toUpperCase());
      // Analyze writes what it finds into the crew's notes (bestiary, target cursor).
      if (u.side === 'enemy') {
        for (const el of weak) learn(state.weakSeen, u.key, el.toLowerCase());
        for (const el of res) learn(state.resistSeen, u.key, el.toLowerCase());
        for (const st of u.immune ?? []) learn(state.immuneSeen, u.key, st);
      }
      v.say(`${u.name}: HP ${u.hp}/${u.base.maxHp}${weak.length ? `  WEAK ${weak.join(' ')}` : ''}${res.length ? `  RESISTS ${res.join(' ')}` : ''}`);
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
