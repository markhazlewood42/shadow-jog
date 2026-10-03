/**
 * Rook's strike pictures on one shared canvas (Phaser spike `spike/phaser-stage`), as plain pixel arrays: no Phaser, no
 * browser, so a unit test can check on Mark's real PNGs that every frame stands on the same spot.
 *
 * `buildSfStrike` (from the side-view spike) lays Mark's three drawings and the in-between poses it makes on ONE canvas:
 * every frame's soles on the bottom row, every frame's front boot at the same column, and the idle frame laid in at a known
 * place (`readyAt`). The stage then needs just one more fact, WHERE the fighter's feet are on that canvas: it is where
 * the idle loop's own foot anchor (`feet.ts`) falls, because that is the point the stage stands the idle picture on. So:
 *
 *     axis = readyAt + footAnchor(idle loop)
 *
 * and every still of the set stands on its axis. When a move swaps the idle picture for the dip, the wind-up or the
 * follow-through, the front boot does not move a pixel (the squash and lean poses move the head and the back leg,
 * which is the point of them).
 *
 * Without Mark's folder (`art` is null) the same names are drawn from blocks, laid out the same way.
 */
import { boxOf } from '../art/rig2/sfgeom';
import { buildSfPunch, PUNCH_KEYS } from '../art/rig2/sfpunch';
import { blank, buildSfStrike, drawBlade, drawSwipe, put, SF_KEYS, SF_SWIPES, type SfKey } from '../art/rig2/sfstrike';
import type { FootAnchor } from './feet';
import type { Raw } from './pixels';

/** Every frame on one canvas (by name: Rook's `dip`, Kit's `jab`...), and the pixel of that canvas the fighter's feet stand on. */
export interface StrikeSet {
  frames: Record<string, Raw>;
  axisX: number;
  axisY: number;
}

/** Mark's three strike drawings (already cleaned of stray pixels). */
export interface StrikeArt {
  s1: Raw;
  s2: Raw;
  crouch: Raw;
}

/** Build the set for Rook: from Mark's drawings, or (art null) from blocks. `idle` is his idle loop, `foot` its foot anchor. */
export function buildStrikeSet(idle: Raw[], foot: FootAnchor, art: StrikeArt | null): StrikeSet {
  if (!art) return buildStandInStrike(idle, foot);
  const b = buildSfStrike(idle, art.s1, art.s2, art.crouch);
  return { frames: b.frames, axisX: b.readyAt.dx + foot.x, axisY: b.readyAt.dy + foot.y };
}

/** Mark's six drawings of Kit's combo (already cleaned of stray pixels): the run, the load, the jab, the cross, the kick and the crouch. */
export interface PunchArt {
  run: Raw;
  load: Raw;
  jab: Raw;
  cross: Raw;
  kick: Raw;
  low: Raw;
}

/** Build the set for Kit: from Mark's drawings, or (art null) from blocks. */
export function buildKitSet(idle: Raw[], foot: FootAnchor, art: PunchArt | null): StrikeSet {
  if (!art) return buildStandInPunch(idle, foot);
  const b = buildSfPunch(idle, art.run, art.load, art.jab, art.cross, art.kick, art.low);
  return { frames: b.frames, axisX: b.readyAt.dx + foot.x, axisY: b.readyAt.dy + foot.y };
}

// ------------------------------------------------------------------ stand-ins (no Mark's folder)


const BODY = [106, 122, 58] as const;
const LEGS = [16, 16, 24] as const;
const SKIN = [232, 200, 160] as const;

/** A filled rectangle of opaque pixels. */
function rect(r: Raw, x: number, y: number, w: number, h: number, c: readonly number[]): void {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(r, x + i, y + j, c);
}

/** A block figure standing on `soles` with its feet midpoint at column `cx`. Returns the head's top row and a hands point. */
function figure(r: Raw, cx: number, soles: number, height: number, lean = 0): { top: number; hands: [number, number] } {
  const legH = Math.max(6, Math.round(height * 0.26));
  rect(r, cx - 7, soles - legH + 1, 6, legH, LEGS);
  rect(r, cx + 1, soles - legH + 1, 6, legH, LEGS);
  const bodyH = Math.round(height * 0.46);
  rect(r, cx - 9 + Math.round(lean / 2), soles - legH - bodyH + 1, 18, bodyH, BODY);
  const headTop = soles - height + 1;
  rect(r, cx - 5 + lean, headTop, 10, 12, SKIN);
  return { top: headTop, hands: [cx + 10 + Math.round(lean / 2), soles - legH - Math.round(bodyH * 0.6)] };
}

/** The strike's pictures drawn from blocks, on one canvas with the idle laid in so its feet sit on the axis. */
function buildStandInStrike(idle: Raw[], foot: FootAnchor): StrikeSet {
  const W = 170;
  const H = 120;
  const AX = 60;
  const soles = H - 1;
  const idle0 = idle[0] as Raw;
  const S = Math.max(40, boxOf(idle0).y1 - boxOf(idle0).y0 + 1);
  const frames = {} as Record<SfKey, Raw>;
  for (const k of SF_KEYS) frames[k] = blank(W, H);

  // The idle frame laid in so its foot anchor lands on the axis column and its lowest row on the bottom.
  const readyAt = { dx: AX - foot.x, dy: H - foot.y };
  for (let y = 0; y < idle0.h; y++)
    for (let x = 0; x < idle0.w; x++) {
      const i = (y * idle0.w + x) * 4;
      if ((idle0.px[i + 3] ?? 0) > 0) put(frames.ready, x + readyAt.dx, y + readyAt.dy, [idle0.px[i] ?? 0, idle0.px[i + 1] ?? 0, idle0.px[i + 2] ?? 0]);
    }

  figure(frames.dip, AX, soles, Math.round(S * 0.62));
  figure(frames.riseA, AX, soles, Math.round(S * 0.78));
  figure(frames.rise, AX, soles, Math.round(S * 0.9));
  const up = figure(frames.windup, AX, soles, S);
  drawBlade(frames.windup, up.hands[0] - 6, up.top + 6, -118, 38);
  // Two swing frames: the body lower, a crescent about the hands.
  const swinging = (k: 'smearA' | 'mid'): void => {
    const f = figure(frames[k], AX + (k === 'mid' ? 8 : 2), soles, Math.round(S * (k === 'mid' ? 0.7 : 0.86)), k === 'mid' ? 6 : 0);
    drawSwipe(frames[k], f.hands[0], f.hands[1], SF_SWIPES[k]);
    if (SF_SWIPES[k].blade > 0) drawBlade(frames[k], f.hands[0], f.hands[1], SF_SWIPES[k].a1, SF_SWIPES[k].blade);
  };
  swinging('smearA');
  swinging('mid');
  // The low follow-through: crouched far forward, the blade out in front.
  for (const k of ['smearB', 'swingB', 'followFade', 'follow'] as const) {
    const f = figure(frames[k], AX + 22, soles, Math.round(S * 0.64), 8);
    drawBlade(frames[k], f.hands[0], f.hands[1] + 6, 6, 52);
    if (k !== 'follow') drawSwipe(frames[k], f.hands[0], f.hands[1] + 4, SF_SWIPES[k]);
  }
  figure(frames.recover, AX + 8, soles, Math.round(S * 0.9), 3);
  return { frames, axisX: readyAt.dx + foot.x, axisY: readyAt.dy + foot.y };
}

/** Kit's combo drawn from blocks: a figure with a fist, then a longer arm, then a leg, out in front, and gold streaks behind the arm. */
function buildStandInPunch(idle: Raw[], foot: FootAnchor): StrikeSet {
  const W = 150;
  const H = 100;
  const AX = 60;
  const soles = H - 1;
  const idle0 = idle[0] as Raw;
  const S = Math.max(40, boxOf(idle0).y1 - boxOf(idle0).y0 + 1);
  const frames: Record<string, Raw> = {};
  for (const k of PUNCH_KEYS) frames[k] = blank(W, H);
  const ready = frames.ready as Raw;
  const readyAt = { dx: AX - foot.x, dy: H - foot.y };
  for (let y = 0; y < idle0.h; y++)
    for (let x = 0; x < idle0.w; x++) {
      const i = (y * idle0.w + x) * 4;
      if ((idle0.px[i + 3] ?? 0) > 0) put(ready, x + readyAt.dx, y + readyAt.dy, [idle0.px[i] ?? 0, idle0.px[i + 1] ?? 0, idle0.px[i + 2] ?? 0]);
    }
  const GOLD = [255, 196, 64] as const;
  const FIST = [232, 136, 58] as const;
  /** A figure with an arm (length `arm`, thickness `thick`) reaching forward at chest height, and a streak behind it when `streak`. */
  const punch = (k: string, height: number, arm: number, thick: number, streak: boolean, lean = 0): void => {
    const f = figure(frames[k] as Raw, AX + 4, soles, height, lean);
    const y = f.hands[1] - Math.floor(thick / 2);
    if (streak) rect(frames[k] as Raw, AX + 12, y - 3, arm - 4, thick + 6, GOLD);
    rect(frames[k] as Raw, AX + 12, y, arm, thick, FIST);
  };
  /** A figure with a leg out in front at hip height. */
  const kick = (k: string, len: number, streak: boolean): void => {
    const f = figure(frames[k] as Raw, AX + 2, soles, S, -4);
    const y = soles - Math.round(S * 0.3);
    if (streak) rect(frames[k] as Raw, AX + 8, y - 6, len - 4, 14, GOLD);
    rect(frames[k] as Raw, AX + 8, y, len, 5, LEGS);
    void f;
  };
  figure(frames.run as Raw, AX + 6, soles, Math.round(S * 0.92), 8);
  const load = figure(frames.load as Raw, AX + 4, soles, S, 2);
  rect(frames.load as Raw, load.hands[0], load.hands[1] - 8, 6, 6, FIST);
  for (const k of ['jabS', 'jabT', 'jab'] as const) punch(k, S, 26, 4, k !== 'jab');
  for (const k of ['crossS', 'crossT', 'cross'] as const) punch(k, S, 30, 5, k !== 'cross', 4);
  figure(frames.kickC as Raw, AX + 2, soles, S, -2);
  rect(frames.kickC as Raw, AX + 8, soles - Math.round(S * 0.34), 12, 5, LEGS);
  kick('kickS', 30, true);
  kick('kickT', 32, true);
  kick('kick', 32, false);
  kick('kickD', 16, false);
  figure(frames.kickE as Raw, AX + 2, soles, S, 0);
  for (const k of ['lowS', 'lowT', 'low'] as const) punch(k, Math.round(S * 0.6), 28, 5, k !== 'low');
  return { frames, axisX: readyAt.dx + foot.x, axisY: readyAt.dy + foot.y };
}
