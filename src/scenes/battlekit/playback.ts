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
import { SF, SIDE_LUNGE_MAX, SIDE_LUNGE_STOP, SIDE_VIEW } from './sideview';
import { KATA_BITE_FRAC, KATA_EFFECT_SHIFT, KATA_KNOCK, KATA_LOW_BELOW, KATA_MEASURED, KATA_MEASURED_LOW, KATA_WINDUP, kataLength } from '../../art/rig2/sidekata';
import { SF_HIT_HEIGHT, SF_KNOCK, SF_LANE_DOWN, SF_LANE_SHARE, SF_LANE_UP, SF_MEASURED, SF_PIERCE, SF_SOLES_ABOVE, SF_SPARK_BODY, SF_WINDUP, sfLength } from '../../art/rig2/sfstrike';
import { MEN_R, PUNCH_R } from '../../battle/fx';
import { PUNCH_FINISHER, PUNCH_HIT_MAX, PUNCH_KNOCK, PUNCH_LOW_AT, PUNCH_LOW_BELOW, PUNCH_MEASURED, PUNCH_SOFT_DROP, PUNCH_PIERCE, punchHits, punchLead, punchLength, punchWindup, type PunchBlow } from '../../art/rig2/sfpunch';
import { gpuCast, gpuDown, gpuHeal, gpuHit, gpuPhase, gpuSpell } from './gpufx';
import type { TimingProfile } from '../../battle/engine';

/**
 * Rook's lane for the dash (battle-world pixels): his soles `KATA_LANE_DROP` below the target's, so he runs in FRONT of the enemy line on a row of his own
 * and is drawn over whoever he passes; nobody is dimmed or made transparent (round 3). It never rises more than `KATA_LANE_RISE` above his own place.
 */
const KATA_LANE_DROP = 7;
const KATA_LANE_RISE = 12;
const KATA_LANE_DROP_MAX = 6;
/** The stop leaves this much between the blade's point and the target's front edge at most: the body is never inside the target's (art px to world px: halved). */
const KATA_FALLBACK_STOP = 22;

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
  /** Side view: an enemy's opaque columns and its soles row (battle-world pixels), for a lunge to be routed round the others. */
  enemyBox(uid: number): { x0: number; x1: number; feet: number; h: number; body0: number } | null;
  /** Side view: the row a party member's soles stand on (battle-world pixels). */
  feetOf(uid: number): number;
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
async function windupAndHit(v: PlaybackView, fx: string, from: Pt, to: Pt[], windup: number, color?: string, onStart?: (at: number) => void, play = true): Promise<void> {
  // Pose-clock frames per real frame, to tell a body how long it has before the effect starts (it reads `at` once, up front).
  const perReal = 100 / v.anim(100);
  // The power gathers at the caster through the windup (GPU effects; most moves have no cast).
  gpuCast(fx, from);
  const profile = v.timingArmed();
  if (profile) {
    const impact = v.anim(v.fx.impactOf(fx, from, to, color));
    const lead = Math.max(WINDOWS[profile].lead, v.anim(windup) + impact);
    v.openTiming(lead);
    onStart?.((lead - impact) * perReal);
    await v.game.wait(lead - impact);
    // Silent: the caller plays the effect itself once the engine has said hit or miss (Kit's combo).
    if (!play) return;
    const t = v.fx.play(fx, from, to, color);
    gpuSpell(fx, to, t.impact);
    sfx(fxSound(fx));
    await v.game.wait(impact);
    return;
  }
  onStart?.(v.anim(windup) * perReal);
  await v.game.wait(v.anim(windup));
  if (!play) return;
  const timing = v.fx.play(fx, from, to, color);
  gpuSpell(fx, to, timing.impact);
  sfx(fxSound(fx));
  await v.game.wait(v.anim(timing.impact));
}

/**
 * One blow of a multi-hit action, as data: the pose frame it lands on (counted from the first blow), the spark's size and ring colour, the screen shake (size, frames), the hit pause (frames), the
 * frames of the target's recoil table it plays, and how far past the contact point the spark is drawn. Kit's combo is a row of these (`PUNCH_BLOW`); another multi-hit move is another row.
 */
interface BlowSpec {
  at: number;
  power: number;
  ring: string;
  shake: [number, number];
  stop: number;
  knock: number;
  past: number;
}
/**
 * Kit's blows: the jab light (a star about the size of her fist), the cross one and a half times that with a white ring, a 4 px shove, a 1 px shake and two more frames of hitstop than the jab's,
 * the kick the biggest (the engine's own damage hit follows it). `knock` is frames of the recoil table; `past` is world px of the spark past the fist or toe, so the star sits in FRONT of the
 * knuckles and does not cover the wrap (round 3 drew it on the chest where the fist ends).
 */
const PUNCH_BLOW: Record<PunchBlow, Omit<BlowSpec, 'at'>> = {
  jab: { power: 0.5, ring: '#ffd9a0', shake: [3, 2], stop: 2, knock: PUNCH_KNOCK.jab, past: 3 },
  cross: { power: 0.85, ring: '#ffffff', shake: [6, 2], stop: 5, knock: PUNCH_KNOCK.cross, past: 4 },
  kick: { power: 1.3, ring: '#ffb454', shake: [8, 3], stop: 4, knock: 0, past: 5 },
  low: { power: 0.6, ring: '#ffd9a0', shake: [3, 2], stop: 2, knock: PUNCH_KNOCK.jab, past: 3 },
  low2: { power: 0.7, ring: '#ffffff', shake: [6, 3], stop: 4, knock: PUNCH_KNOCK.cross, past: 4 },
};
/** Her soles go this many world px below the feet of any enemy her run passes: she runs in front of the others on a lane of her own and is drawn over them (round 4: nothing fades any more), and the lane may go this far below her own place. */
const PUNCH_LANE_AHEAD = 10;
const PUNCH_LANE_DOWN = 14;

/** Wait until the pose clock is `k` pose frames in (the pose and the script run on one clock; a hit pause holds both). */
async function untilPose(v: PlaybackView, uid: number, k: number): Promise<void> {
  const dd = v.d(uid);
  for (let i = 0; i < 240 && dd.poseT > 0 && (dd.poseLen ?? 0) - dd.poseT < k; i++) await v.game.wait(1);
}

/**
 * A multi-hit melee action on one pose clock, driven by a table of blows (`BlowSpec`): the first blow goes through the usual wind-up (and the timing ring, if one is armed: it closes on it) but its
 * effect is NOT played yet. The script then stops and the engine resolves the action, and the actor's `followUp` is called by the event that follows: `damage` plays every blow (sparks, GPU hits,
 * shoves, hit pauses, each keyed to the pose clock; the LAST only plays its spark, the engine's one real damage event lands the number, the shake and the pause), `miss` plays a whiff instead
 * (a dull puff and an air-cut a little short of the target, no star, no shake, no pause), calls the rest off and lets the target lean out of it. So a miss never shows a hit.
 */
async function multiHit(v: PlaybackView, actor: number, target: number, from: Pt, pts: Pt[], specs: BlowSpec[], first: number, element: Element | undefined): Promise<void> {
  const at = v.pos(target);
  const dd = v.d(actor);
  const last = specs.length - 1;
  const react = async (i: number): Promise<void> => {
    const b = specs[i] as BlowSpec;
    const t = v.d(target);
    t.flash = 1;
    t.knock = b.knock;
    sfx('hit');
    gpuHit(pts[i] as Pt, from, element ?? 'phys', 0, { crit: false, weak: false, combo: false });
    v.game.shake(b.shake[0], b.shake[1], direction(from, at));
    await v.hitstop(b.stop);
  };
  dd.followUp = {
    target,
    hit: async () => {
      dd.poseHold = false;
      for (let i = 0; i <= last; i++) {
        const b = specs[i] as BlowSpec;
        await untilPose(v, actor, first + b.at);
        PUNCH_R.power = b.power;
        PUNCH_R.soft = i < last;
        PUNCH_R.ring = b.ring;
        const t = v.fx.play('punch_r', from, [pts[i] as Pt]);
        gpuSpell('punch_r', [pts[i] as Pt], t.impact);
        await v.game.wait(v.anim(t.impact));
        if (i < last) await react(i);
      }
    },
    miss: async () => {
      dd.poseHold = false;
      await untilPose(v, actor, first);
      const p = pts[0] as Pt;
      v.fx.play('punch_whiff', from, [{ x: p.x - PUNCH_BLOW.jab.past + 2, y: p.y }]);
      sfx('swing');
      dd.punchStop = (dd.poseLen ?? 0) - dd.poseT;
      v.d(target).knock = PUNCH_KNOCK.cross;
    },
  };
  // With no timing press the engine answers only after the ring's late window, so the first blow's frame would sit on the target for about 8 ticks before its spark. Hold the pose clock at that frame
  // (the fist at full reach, like a hit pause) until the answer comes; a press near the beat answers first and nothing is held.
  void (async () => {
    await untilPose(v, actor, first);
    if (dd.followUp && dd.followUp.target === target) {
      dd.poseHold = true;
      for (let i = 0; i < 90 && dd.followUp; i++) await v.game.wait(1);
      dd.poseHold = false;
    }
  })();
}

/** Kit's combo in Sprite Fusion art: the jab, the cross and the kick (or two low blows for a short target), as a table of blows on `punchHits`' clock (see `multiHit`). */
async function punchCombo(v: PlaybackView, actor: number, target: number, from: Pt, pts: Pt[], low: boolean, windup: number, element: Element | undefined, onStart: ((at: number) => void) | undefined): Promise<void> {
  const hits = punchHits(PUNCH_FINISHER, low);
  const dd = v.d(actor);
  await windupAndHit(v, 'punch_r', from, [pts[0] as Pt], windup, undefined, onStart, false);
  const first = Math.max(Math.round(dd.strikeAt ?? 0), punchLead(dd.reachX ?? 0, low));
  await multiHit(v, actor, target, from, pts, hits.map((h) => ({ ...PUNCH_BLOW[h.key], at: h.at })), first, element);
}

/**
 * Freeze-frames spent in the current action. A blast that lands heavy on three enemies stops time
 * once, on the first; the rest ride the shake, so area attacks punch instead of stuttering.
 */
let actionStops = 0;
/** The action being played is Rook's kendo strike or (Sprite Fusion art) Kit's punch combo in the side view: its hit gets a recoil, a short flash, a screen shake and a hitstop of its own. */
let kataAction = false;
/** The action being played is Kit's punch combo (her hurt flash is shorter than Rook's: the target's eyes and tail must read through it). */
let punchAction = false;
/** Sprite Fusion's strike: where the blade's point ends (battle-world pixels), the one point the spark, the GPU hit and the numbers key to. */
let kataPoint: Pt | null = null;
/** The action being played is a combo (its first heavy hit gets the impact frame). */
let comboAction = false;

export async function playEvent(v: PlaybackView, e: BattleEvent): Promise<void> {
  switch (e.t) {
    case 'act': {
      actionStops = 0;
      comboAction = false;
      kataAction = false;
      punchAction = false;
      kataPoint = null;
      const actor = v.battle.unit(e.actor)!;
      let kata = false;
      let kataTarget: { x: number; bladeY: number } | null = null;
      /** Kit's combo (Sprite Fusion art): where each blow lands (battle-world pixels), one point per `punchHits()`. */
      let punchPts: Pt[] | null = null;
      v.lastActor = actor;
      const dd = v.d(e.actor);
      const color = actor.side === 'party' ? MEMBERS[actor.key as MemberId].color : '#ff8a8a';
      v.showBanner(e.kind === 'attack' || e.name === 'Attack' ? v.label(actor) : `${v.label(actor)}: ${e.name}`, color);
      if (actor.side === 'party') {
        const pose = actionPose(actor.key, e.kind, e.targets.map((t) => v.battle.unit(t)?.side), e.fx);
        // Melee poses move by their swing beats (motion.ts); the rest just rise a little.
        dd.lunge = pose === 'attack' || pose === 'thrust' ? 0 : 6;
        // Side view: a melee strike carries the actor most of the way to its target (data: SIDE_LUNGE_MAX, SIDE_LUNGE_STOP).
        dd.reachX = 0;
        dd.reachY = 0;
        dd.strikeAt = undefined;
        dd.poseLen = undefined;
        dd.strikeLow = undefined;
        dd.punchStop = undefined;
        dd.poseHold = false;
        dd.followUp = undefined;
        // Rook's kendo strike has its own timeline and a longer blade, so he stops further off.
        // Under Sprite Fusion art his strike is Mark's own frames (rig2/sfstrike.ts); the same flag drives both, the geometry below differs.
        kata = SIDE_VIEW && actor.key === 'rook' && pose === 'attack';
        // Kit's basic attack under Sprite Fusion art is a combo from Mark's own frames (rig2/sfpunch.ts): the jab, the cross and the kick, each its own blow on the target.
        const punch = SIDE_VIEW && SF && actor.key === 'kit' && pose === 'attack' && e.kind === 'attack';
        const aim = e.targets[0] === undefined ? null : v.pos(e.targets[0]);
        dd.target = undefined;
        if (SIDE_VIEW && aim && (pose === 'attack' || pose === 'thrust')) {
          const from = v.pos(e.actor);
          const box = (kata || punch) && e.targets[0] !== undefined ? v.enemyBox(e.targets[0]) : null;
          if (punch && box) {
            // Kit: the tip of every blow (the fist of the jab and the cross, the toe of the kick, all on one column by construction) ends `PUNCH_PIERCE` inside the target's body front. She
            // stands on a lane of her own: the target's floor, or `PUNCH_LANE_AHEAD` below the feet of any enemy nearer than the target (so she runs in front of it, never through it). A target
            // under `PUNCH_LOW_BELOW` tall (a Glowrat) gets the crouch. The spark and the GPU hit are drawn `PUNCH_SPARK_PAST` px past the fist, so the fist stays visible at contact.
            const tipAt = box.body0 + PUNCH_PIERCE;
            dd.reachX = Math.max(0, Math.min(SIDE_LUNGE_MAX, tipAt - PUNCH_MEASURED.tipDx / 2 - from.x));
            const feet = v.feetOf(e.actor);
            let lane = box.feet + 1;
            for (const o of v.battle.alive('enemy')) {
              const ob = o.uid === e.targets[0] ? null : v.enemyBox(o.uid);
              if (ob && ob.x0 < tipAt) lane = Math.max(lane, ob.feet + PUNCH_LANE_AHEAD);
            }
            dd.reachY = Math.max(-SF_LANE_UP, Math.min(PUNCH_LANE_DOWN, lane - feet));
            dd.target = e.targets[0];
            dd.strikeLow = box.h < PUNCH_LOW_BELOW;
            const soles = feet + dd.reachY;
            // A low blow (a short target) lands at the body's centre, about 0.7 of its height up its feet, so the spark and the target's flash line up; a standing blow at the height of the fist or the toe.
            punchPts = punchHits(PUNCH_FINISHER, dd.strikeLow).map((h) => ({
              x: tipAt + PUNCH_BLOW[h.key].past,
              y: dd.strikeLow ? box.feet - Math.max(3, box.h * PUNCH_LOW_AT) : Math.max(box.feet - box.h * PUNCH_HIT_MAX, Math.min(box.feet - 2, soles - PUNCH_MEASURED.up[h.key === 'low2' ? 'low' : h.key] / 2 + (h.key === 'kick' ? 0 : PUNCH_SOFT_DROP))),
            }));
            kataPoint = punchPts[punchPts.length - 1] ?? null;
          } else if (kata && SF && box) {
            // Sprite Fusion art (round 3): the point of the blade (SF_MEASURED.tipDx art px in front of his slot's axis at the follow-through) ends `SF_PIERCE` inside the target's BODY
            // (its front column, not the club's or tail's). He stands on the TARGET'S floor, not a ledge above it: his soles are at most `SF_SOLES_ABOVE` world px above its soles (less for a
            // small target, `SF_HIT_HEIGHT` of its height), so the point lands on its leg and the cut line, aimed from higher up, carries the blow through the body. His row moves from his own
            // place by at most `SF_LANE_UP` up or `SF_LANE_DOWN` down.
            const tipAt = box.body0 + SF_PIERCE;
            dd.reachX = Math.max(0, Math.min(SIDE_LUNGE_MAX, tipAt - SF_MEASURED.tipDx / 2 - from.x));
            const feet = v.feetOf(e.actor);
            dd.reachY = Math.max(-SF_LANE_UP, Math.min(SF_LANE_DOWN, box.feet - Math.min(SF_SOLES_ABOVE, box.h * SF_LANE_SHARE) - feet));
            dd.target = e.targets[0];
            dd.strikeLow = false;
            // The cut line (men_r) runs down and to the right and ends on the blade's point, so the steel, the line and the spark are one stroke: its middle is placed from that end.
            // Round 4: the cut and the spark land at the middle of the target's body (`SF_HIT_HEIGHT` of its height), not at the blade's point (which is at its shin): the line crosses
            // the torso, and its end is `SF_PIERCE` inside the body front. The spark's size follows the body's width, so a Glowrat is not buried under it.
            const hitY = box.feet - box.h * SF_HIT_HEIGHT;
            kataPoint = { x: tipAt, y: hitY };
            kataTarget = { x: tipAt - MEN_R.dx, bladeY: hitY - MEN_R.dy };
            MEN_R.spark = Math.max(0.4, Math.min(1, ((box.x1 - box.x0) * SF_SPARK_BODY) / 9));
          } else if (kata && box) {
            // Rook's blade must meet the target: stop with the point `KATA_BITE_FRAC` of the way from its centre to its front edge (its weapon may reach further than its body). The lane is a row in front of the enemy line
            // (never up the street, behind Kit), so the dash passes in front of the others, who stay opaque. A target under `KATA_LOW_BELOW` px tall (a Glowrat) gets the blade angled down onto it.
            const low = box.h * 2 < KATA_LOW_BELOW;
            const m = low ? KATA_MEASURED_LOW : KATA_MEASURED;
            const tipAt = (box.x0 + box.x1) / 2 + ((box.x1 - box.x0) / 2) * KATA_BITE_FRAC;
            const cx = Math.min(tipAt + m.tipReach / 2, from.x);
            dd.reachX = Math.max(-SIDE_LUNGE_MAX, cx - from.x);
            const feet = v.feetOf(e.actor);
            dd.reachY = Math.max(-KATA_LANE_RISE, Math.min(KATA_LANE_DROP_MAX, box.feet + KATA_LANE_DROP - feet));
            dd.target = e.targets[0];
            dd.strikeLow = low;
            kataTarget = { x: (box.x0 + box.x1) / 2, bladeY: Math.max(box.feet - box.h + 2, Math.min(box.feet - 2, feet + dd.reachY - m.tipUp / 2)) };
          } else {
            // Code art: the enemies are on the left, so the lunge is negative; Sprite Fusion art faces right, the lunge is positive and stops short of the target on its left side.
            dd.reachX = SF ? Math.min(SIDE_LUNGE_MAX, Math.max(0, aim.x - SIDE_LUNGE_STOP - from.x)) : Math.max(-SIDE_LUNGE_MAX, Math.min(0, aim.x + (kata ? KATA_FALLBACK_STOP : SIDE_LUNGE_STOP) - from.x));
            dd.reachY = Math.max(-4, Math.min(4, (aim.y - from.y) * 0.3));
          }
        }
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
      const punching = punchPts !== null;
      const windup = actor.side === 'enemy' ? 12 : punching ? punchWindup(dd.reachX ?? 0, dd.strikeLow === true) : kata ? (SF ? SF_WINDUP : KATA_WINDUP) : e.kind === 'attack' ? 8 : 16;
      const onStart = kata
        ? (at: number) => {
            dd.strikeAt = at;
            dd.poseLen = dd.poseT = SF ? sfLength(at) : kataLength(at, dd.strikeLow);
          }
        : punching
          ? (at: number) => {
              dd.strikeAt = at;
              dd.poseLen = dd.poseT = punchLength(at, dd.reachX ?? 0, dd.strikeLow === true);
            }
          : undefined;
      // Rook's effect is anchored a little toward him from the target's centre, so the blade's point shows beside the flash.
      // The cut's own effect ('men': a hard slash line through the target along the blade, two frames, a small hot spark) replaces the stock slash, whose star and burst covered the whole body.
      // The effect sits a little toward Rook from the target's centre (his side of it: right of it for the left-facing code art, left of it for Sprite Fusion's).
      const shift = SF ? 0 : KATA_EFFECT_SHIFT;
      const to = e.targets.map((t, i) => (kata ? { x: kataTarget && i === 0 ? kataTarget.x + shift : v.pos(t).x + shift, y: kataTarget && i === 0 ? kataTarget.bladeY : v.pos(t).y } : v.pos(t)));
      kataAction = kata || punching;
      punchAction = punching;
      if (punchPts && e.targets[0] !== undefined) {
        await punchCombo(v, e.actor, e.targets[0], v.pos(e.actor), punchPts, dd.strikeLow === true, windup, e.element, onStart);
        break;
      }
      await windupAndHit(v, kata && e.fx === 'slash' ? (SF ? 'men_r' : 'men') : e.fx, v.pos(e.actor), to, windup, e.element === 'shock' ? '#9ae8ff' : undefined, onStart);
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
        v.d(a).strikeAt = undefined;
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
      // Kit's combo: the engine has said the first blow hit, so the rest of the combo plays out before the number lands.
      const fu = v.lastActor ? v.d(v.lastActor.uid).followUp : undefined;
      if (fu && fu.target === e.target) {
        v.d(v.lastActor!.uid).followUp = undefined;
        await fu.hit();
      }
      const dd = v.d(e.target);
      const u = v.battle.unit(e.target)!;
      dd.hp = e.hp;
      dd.shake = 12;
      // Sprite Fusion's cut: the target blinks white over its own pixels for the hit (and holds it through the hitstop, as a freeze-frame does).
      dd.flash = u.side === 'enemy' ? (kataAction ? (SF ? (punchAction ? 2 : 5) : 0) : 5) : 8;
      // Rook's cut pushes the body back 4 px for two frames and shakes the screen, whatever the damage; the target's body shows through (no white flash: it would hold through the hitstop).
      if (kataAction && u.side === 'enemy') {
        dd.knock = SF ? SF_KNOCK.length : KATA_KNOCK.length;
        v.game.shake(SF ? 11 : 8, SF ? 4 : 3, v.lastActor ? direction(v.pos(v.lastActor.uid), v.pos(e.target)) : undefined);
      }
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
      if (e.amount > 0) gpuHit(kataAction && kataPoint ? kataPoint : v.pos(e.target), from, e.element, kataAction ? Math.min(1, tier) : tier, { crit: !!e.crit, weak: !!e.weak, combo: comboAction && tier >= 2 && actionStops === 0 });
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
      } else if (kataAction && u.side === 'enemy' && actionStops === 0) {
        // A light cut still stops time for a beat: the blade is held in the target.
        actionStops++;
        await v.hitstop(SF ? 4 : 2);
      }
      await v.w(14);
      break;
    }
    case 'miss':
      {
        // The first blow whiffed: a dull puff short of the target, nothing more is thrown, she recovers where she is and the target leans out of it (the recoil table, no flash).
        const fu = v.lastActor ? v.d(v.lastActor.uid).followUp : undefined;
        if (fu && fu.target === e.target) {
          v.d(v.lastActor!.uid).followUp = undefined;
          await fu.miss();
        }
      }
      v.floatOn(e.target, 'MISS', '#ffe27a', 'label');
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
