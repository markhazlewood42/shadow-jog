/** Display state shared by BattleScene and its playback (per-combatant animation, floaters). */
import type { Pose } from '../../art/battlers';

export interface Disp {
  hp: number;
  tp: number;
  /** What the bars and numbers show: eases toward hp/tp so changes read as motion. */
  shownHp: number;
  shownTp: number;
  /** The pale "damage ghost" segment that trails behind a hit. */
  lagHp: number;
  lagHold: number;
  flash: number;
  shake: number;
  hop: number;
  alpha: number;
  dying: number;
  lunge: number;
  /** Side view: how far (battle-world pixels) a melee strike carries the actor toward its target at the full lunge. */
  reachX?: number;
  reachY?: number;
  /** Side view, Rook's kendo strike: the pose-clock frame the blow lands on, and the pose's length (`rig2/sidekata.ts`). */
  strikeAt?: number | undefined;
  poseLen?: number | undefined;
  /** Side view, Rook's kendo strike: the target's uid (every other enemy his body passes in front of is dimmed while he is on it). */
  target?: number | undefined;
  hidden: boolean;
  /** Party action pose and how many frames it holds (idle when 0). */
  pose: Pose;
  poseT: number;
  /** Frames of speed afterimages left (Flash Step, Hundred Rain). */
  afterimage: number;
}

export interface Floater {
  text: string;
  x: number;
  y: number;
  t: number;
  color: string;
  /** How it moves: a hit number bounces, a DoT tick drips down, a label just rises. */
  style: 'hit' | 'tick' | 'label';
  /** Whose floater it is: stacking is per target, whatever the call site. */
  uid: number;
}
