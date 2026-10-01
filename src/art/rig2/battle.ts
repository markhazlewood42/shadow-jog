/**
 * Battle backs by rig v2, on a skeleton: a crew member seen from behind, built in code from one
 * traced frame, Phantasy Star IV style: a few key poses, held, with the battle's own motion (lunge,
 * smear, shake) and drawn light (a spark, an impact, a swept arc, a muzzle flash) selling the move.
 *
 * The moving arm is three bones, shoulder to elbow to wrist to hand, with fixed lengths: a pose is
 * where the wrist goes (and which way the elbow bends), the elbow is worked out (two-bone IK), and
 * each bone's pixels turn rigidly at its joint, so a limb can't stretch (rig v2's first battle
 * poses drew the forearm as a band to wherever the hand went, and it did). The arm's pixels are
 * picked out of the traced frame (its colours inside its box, near its bones); where the arm leaves
 * the body, the gap is filled from the body around it. A bone with no pixels of its own (Kit's upper
 * arm, under her hair) is drawn as a sleeve of its fixed length. Weapons are drawn in code in the
 * hand. A hit tips the whole stance back. Everything else is the traced frame, identical in every
 * pose.
 *
 * The skeleton and the poses are data (`public/art/rig/skeleton.json`), set in the animation editor
 * (`/rigedit.html`, dev only): the joints once per character, the poses by dragging the hand.
 */
import type { Battler, Pose } from '../battlers';
import { type Layer, byColour, cut, darker, decode, renderLayers, rotSprite } from './rig';
import { BATTLE_TRACED, SKELETONS } from './data';

/** The canvas battle backs are drawn on (art pixels; the battle shows them at twice its resolution). */
const SIZE = 128;

type Pt = readonly [number, number];
type Box = readonly [number, number, number, number];

/** A weapon drawn in code in the hand: which, and its angle from the forearm (degrees, > 0 clockwise). */
export interface Weapon {
  kind: 'katana' | 'pistol';
  angle: number;
}

/** One key pose of the arm. */
export interface ArmPose {
  /** Where the wrist goes (the 128x128 canvas's coordinates); out of reach, the arm points at it. */
  hand: Pt;
  /** The elbow bends the other way from the rest pose. */
  flip?: boolean;
  /** The hand (and what it holds) turned at the wrist, degrees (> 0 clockwise). */
  grip?: number;
  weapon?: Weapon;
  /** The light the pose throws, and where: the hand, the tip (a blade's point, a muzzle) or the top (a staff's head). */
  light?: 'spark' | 'impact' | 'shot';
  lightAt?: 'hand' | 'tip' | 'top';
  /**
   * The impact's swept arc, placed by hand (the editor's arc handles): where it starts, and the
   * point it curves toward (a quadratic curve's control point). Without it the arc runs from where
   * the hand was in the pose before, bowed a little up and out.
   */
  arc?: { from: Pt; bend: Pt };
  /** The drawn hand to show: the fist (the default) or the open hand, fingers out (a cast). */
  shape?: 'fist' | 'open';
  /**
   * How far the hand reaches into the screen, toward the enemy, in pixels (negative: back toward
   * us). The arm is then solved in 3D and seen as the battle sees it: reaching forward lifts the
   * hand a little on screen, the arm foreshortens, the hand gets a little smaller ("2.5D": Mark,
   * 2026-10-01, wanting Kit's strike to reach forward). `hand` is then its spot before that lift.
   */
  depth?: number;
  /** The arm behind the body, not in front of it. */
  behind?: boolean;
}

/** A hand drawn in code: rows of colour letters (`colors`), pointing up, joined to the wrist at `pivot`. */
export interface DrawnHand {
  rows: string[];
  colors: Record<string, string>;
  pivot: Pt;
}

/** The key poses a battle back has; the battle maps its moves onto these. */
export const KEY_POSES = ['brace', 'strike', 'raise', 'victory'] as const;
export type KeyPose = (typeof KEY_POSES)[number];

/** A crew member's skeleton (joints at rest, in the 128x128 canvas's coordinates) and poses. */
export interface BattleRig {
  arm: {
    shoulder: Pt;
    elbow: Pt;
    wrist: Pt;
    /** Where the arm's pixels can be. */
    box: Box;
    /**
     * More of it, when one rectangle can't fit the arm: Rook's coat sleeve is wide at the shoulder
     * and his chrome arm narrow below it, beside his coat (Mark, 2026-10-01).
     */
    more?: Box[];
    /** Points on the body whose colours are never the arm's (hair, coat). */
    keep: Pt[];
    /** How far from the upper arm and the forearm their pixels reach (0: the bone is drawn instead). */
    reach: [number, number];
    /** Pixels in here are the hand (and what it holds). */
    hand: Box;
    /** The sleeve drawn for a bone with no pixels of its own, and its width. */
    sleeve: string;
    width: number;
    /**
     * The side of the body to build back when the arm leaves it (its pixels went with the arm):
     * rows y0 to y1, the edge pushed out `top` pixels at y0 tapering to `bottom` at y1, in the
     * body's own colours (Mark, 2026-10-01: Kit's chest looked cut out with her arm extended).
     */
    fill?: [number, number, number, number];
    /**
     * Everything in the box (but the kept colours) leaves the body with the arm, even what no bone
     * claims; then an upper arm with no pixels of its own is drawn as a sleeve in front of the body
     * (Kit: her whole sleeve moves, drawn clean, instead of a foreshortened lump turned).
     */
    clear?: boolean;
    /**
     * Past this many degrees of turn the upper arm is drawn (a clean sleeve); below it, its own
     * traced pixels turn with it, folds and shading and all, and so does the forearm (Kit's Ready
     * pose barely moves the arm and looked flat drawn; Mark, 2026-10-01). Needs `reach` for the
     * upper arm, to have pixels to show.
     */
    drawnFrom?: number;
    /**
     * A hand drawn in code for the arm's big moves (with `drawnFrom`): a little pixel grid
     * pointing up, knuckles first, a letter per pixel from `colors` ('.' empty), turned with the
     * forearm and joined to it at `pivot` (grid coordinates). The traced hand stays for the small
     * moves. Kit's traced fist is seen edge-on in her guard and read as a thin blob held out
     * (Mark, 2026-10-01: "bigger, more round").
     */
    fist?: DrawnHand;
    /** An open hand, fingers out, drawn the same way: for poses with `shape: 'open'` (Kit's cast). */
    open?: DrawnHand;
  };
  /** What goes while a weapon is out (Rook's hilt on his back). */
  hide?: { box: Box; keep: Pt[] };
  /** The colour of the light the poses throw. */
  light: string;
  /** Which pose a ranged aim uses (Hex aims her pistol). */
  aim?: 'strike' | 'raise';
  poses: Partial<Record<KeyPose, ArmPose>>;
  /** Mark's notes on a pose, for Claude to work through. */
  notes?: Partial<Record<KeyPose, string>>;
}

/** The palette index of the pixel at a canvas point, or -1. */
function indexAt(l: Layer, x: number, y: number): number {
  const lx = Math.floor(x - l.ox);
  const ly = Math.floor(y - l.oy);
  if (lx < 0 || ly < 0 || lx >= l.w || ly >= l.h) return -1;
  return l.px[ly * l.w + lx] ?? -1;
}

/** The palette index nearest a colour. */
function nearest(pal: string[], hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  let best = 0;
  let bd = Infinity;
  pal.forEach((c, i) => {
    const m = Number.parseInt(c.slice(1), 16);
    const d = (((m >> 16) & 255) - ((n >> 16) & 255)) ** 2 + (((m >> 8) & 255) - ((n >> 8) & 255)) ** 2 + ((m & 255) - (n & 255)) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

const moved = (l: Layer, dx: number, dy: number): Layer => ({ ...l, ox: l.ox + dx, oy: l.oy + dy });

/** The part of `l` inside `box` whose colours aren't those at the `not` points; and `l` without it. */
function pick(l: Layer, box: Box, not: readonly Pt[]): { part: Layer; rest: Layer } {
  const notCols = new Set(not.map(([x, y]) => indexAt(l, x, y)).filter((i) => i >= 0));
  const [x0, y0, x1, y1] = box;
  const inBox = cut(l, x0, y0, x1, y1);
  const cols = new Set<number>();
  for (const p of inBox.px) if (p >= 0 && !notCols.has(p)) cols.add(p);
  const part = byColour(inBox, cols, true);
  const rest: Layer = { ...l, px: l.px.slice() };
  const clear = (x: number, y: number) => {
    rest.px[(y - rest.oy) * rest.w + (x - rest.ox)] = -1;
  };
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (cols.has(indexAt(rest, x, y))) clear(x, y);
  // Bits left behind (fine lines that share a colour with the body): specks in the box with fewer
  // than two neighbours go, twice over.
  for (let pass = 0; pass < 2; pass++)
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        if (indexAt(rest, x, y) < 0) continue;
        const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx = 0, dy = 0]) => indexAt(rest, x + dx, y + dy) >= 0).length;
        if (n < 2) clear(x, y);
      }
  return { part, rest };
}

/**
 * A band from `a` to `b`, `width` wide with round ends, lit on the side facing the top left: half
 * shaded, or (`rim`, for cloth) only its outermost pixel on the shadow side. `width2` tapers it to
 * that width at `b` (a sleeve narrowing as it reaches away into the screen).
 */
function band(a: Pt, b: Pt, width: number, lit: number, shade: number, rim = false, width2 = width): Layer {
  const x0 = Math.floor(Math.min(a[0], b[0]) - width);
  const y0 = Math.floor(Math.min(a[1], b[1]) - width);
  const w = Math.ceil(Math.abs(a[0] - b[0]) + 2 * width) + 1;
  const h = Math.ceil(Math.abs(a[1] - b[1]) + 2 * width) + 1;
  const px = new Int16Array(w * h).fill(-1);
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy || 1;
  // The band's normal that points toward the top left: the lit side.
  let nx = -vy;
  let ny = vx;
  if (nx + ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const qx = x0 + x + 0.5 - a[0];
      const qy = y0 + y + 0.5 - a[1];
      const t = Math.max(0, Math.min(1, (qx * vx + qy * vy) / len2));
      const dx = qx - t * vx;
      const dy = qy - t * vy;
      const d2 = dx * dx + dy * dy;
      const r = (width + (width2 - width) * t) / 2;
      if (d2 > r * r) continue;
      const shadowSide = dx * nx + dy * ny <= 0;
      px[y * w + x] = shadowSide && (!rim || d2 > (r - 1.2) ** 2) ? shade : lit;
    }
  return { w, h, ox: x0, oy: y0, px };
}

/** The point `len` from `p` in direction `deg` (0 = right, -90 = up). */
const along = (p: Pt, deg: number, len: number): Pt => [p[0] + Math.cos((deg * Math.PI) / 180) * len, p[1] + Math.sin((deg * Math.PI) / 180) * len];

const KATANA = 34;
const PISTOL = 7;

/** A weapon in the hand, drawn in code from palette colours: its layers and its tip. */
function weapon(w: Weapon, hand: Pt, pal: string[]): { layers: Layer[]; tip: Pt } {
  const steel = nearest(pal, '#d8dce6');
  const steelDark = nearest(pal, '#8a8e9e');
  const grip = nearest(pal, '#1a1822');
  const gold = nearest(pal, '#d0a040');
  if (w.kind === 'katana') {
    const guard = along(hand, w.angle, 3);
    const tip = along(hand, w.angle, KATANA);
    const pommel = along(hand, w.angle, -5);
    const across = (d: number) => along(guard, w.angle + d, 2);
    return { layers: [band(pommel, guard, 3, grip, grip), band(guard, tip, 2, steel, steelDark), band(across(90), across(-90), 2, gold, gold)], tip };
  }
  const tip = along(hand, w.angle, PISTOL);
  return { layers: [band(hand, tip, 3, grip, grip)], tip };
}

/** The topmost pixel of a part (a staff's head). */
function topOf(l: Layer): Pt {
  for (let y = 0; y < l.h; y++)
    for (let x = 0; x < l.w; x++) if ((l.px[y * l.w + x] ?? -1) >= 0) return [l.ox + x, l.oy + y];
  return [l.ox, l.oy];
}

/** The far end of a part from its anchor (the staff's head, the fist). */
function farEnd(l: Layer, from: Pt): Pt {
  let best: Pt = from;
  let bd = -1;
  for (let y = 0; y < l.h; y++)
    for (let x = 0; x < l.w; x++) {
      if ((l.px[y * l.w + x] ?? -1) < 0) continue;
      const d = (l.ox + x - from[0]) ** 2 + (l.oy + y - from[1]) ** 2;
      if (d > bd) {
        bd = d;
        best = [l.ox + x, l.oy + y];
      }
    }
  return best;
}

/** A canvas of the light a pose throws: a spark, an impact with the arc it swept, or a muzzle flash. */
function poseLight(at: Pt, from: Pt, kind: 'spark' | 'impact' | 'shot', tint: string, arc?: { from: Pt; bend: Pt }): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const g = c.getContext('2d');
  if (!g) return c;
  const [x, y] = at;
  const dot = (px: number, py: number, color: string) => {
    g.fillStyle = color;
    g.fillRect(Math.round(px), Math.round(py), 1, 1);
  };
  const rays = (cx: number, cy: number, r0: number, r1: number, color: string, n = 8) => {
    for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2 + Math.PI / n;
      for (let r = r0; r <= r1; r++) dot(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, color);
    }
  };
  const halo = g.createRadialGradient(x, y, 0, x, y, kind === 'shot' ? 8 : 12);
  halo.addColorStop(0, tint);
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo;
  g.fillRect(x - 13, y - 13, 26, 26);
  if (kind === 'spark') {
    rays(x, y - 3, 3, 6, '#ffffff');
    dot(x, y - 3, '#ffffff');
  } else if (kind === 'shot') {
    rays(x, y, 2, 5, '#ffffff', 6);
    dot(x, y, '#ffffff');
  } else {
    rays(x, y, 3, 8, '#ffffff');
    // The arc it swept: a curve from where it started, through its bend, to the impact.
    const [sx, sy] = arc?.from ?? from;
    const [cx, cy] = arc?.bend ?? defaultBend(arc?.from ?? from, at);
    for (let t = 0; t <= 1; t += 0.02) {
      const u = 1 - t;
      dot(u * u * sx + 2 * u * t * cx + t * t * x, u * u * sy + 2 * u * t * cy + t * t * y, t > 0.4 ? '#ffffff' : tint);
    }
  }
  return c;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const angleOf = (a: Pt, b: Pt) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;

/** Distance from p to the segment a-b, and how far along it p falls (0 at a, 1 at b). */
function toSegment(p: Pt, a: Pt, b: Pt): { d: number; t: number } {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy || 1);
  const c = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(p[0] - a[0] - c * vx, p[1] - a[1] - c * vy), t };
}

/** A point with depth: x, y as on screen, z into the screen (toward the enemy). */
export type V3 = [number, number, number];
/** How far up the screen a point moves per pixel it goes into it (the battle looks down a little). */
export const TILT = 0.5;
/** How much smaller per pixel into the screen (a little perspective, for the hand). */
const PERSPECTIVE = 1 / 160;
/** A point in depth as the battle sees it. */
export const project = (v: V3): Pt => [v[0], v[1] - v[2] * TILT];
/** How big something at depth `z` looks. */
const sizeAt = (z: number) => 1 / Math.max(0.5, 1 + z * PERSPECTIVE);

/**
 * Two-bone IK in 3D: the elbow and the wrist for the wrist to reach `target` from `shoulder`, the
 * elbow bending toward `pole` (a direction). Out of reach, the arm points straight at it.
 */
export function solveArm3(shoulder: V3, upper: number, fore: number, target: V3, pole: V3): { elbow: V3; wrist: V3 } {
  const v: V3 = [target[0] - shoulder[0], target[1] - shoulder[1], target[2] - shoulder[2]];
  const len = Math.hypot(v[0], v[1], v[2]) || 1e-6;
  const d = Math.max(Math.abs(upper - fore) + 0.01, Math.min(upper + fore - 0.01, len));
  const u: V3 = [v[0] / len, v[1] / len, v[2] / len];
  // The bend direction, square to the reach.
  const pd = pole[0] * u[0] + pole[1] * u[1] + pole[2] * u[2];
  let p: V3 = [pole[0] - u[0] * pd, pole[1] - u[1] * pd, pole[2] - u[2] * pd];
  const pl = Math.hypot(p[0], p[1], p[2]);
  p = pl > 1e-6 ? [p[0] / pl, p[1] / pl, p[2] / pl] : [-u[1], u[0], 0];
  // The law of cosines again: how far along the reach the elbow sits, and how far out.
  const a = (upper * upper - fore * fore + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, upper * upper - a * a));
  const elbow: V3 = [shoulder[0] + u[0] * a + p[0] * h, shoulder[1] + u[1] * a + p[1] * h, shoulder[2] + u[2] * a + p[2] * h];
  return { elbow, wrist: [shoulder[0] + u[0] * d, shoulder[1] + u[1] * d, shoulder[2] + u[2] * d] };
}

/**
 * Two-bone IK: where the elbow goes for the wrist to reach `target` from `shoulder` with bones of
 * these lengths; out of reach, the arm points straight at it. Returns the elbow and the wrist.
 */
export function solveArm(shoulder: Pt, upper: number, fore: number, target: Pt, bend: number): { elbow: Pt; wrist: Pt } {
  const d = Math.max(Math.abs(upper - fore) + 0.01, Math.min(upper + fore - 0.01, dist(shoulder, target)));
  const a = Math.atan2(target[1] - shoulder[1], target[0] - shoulder[0]);
  // The law of cosines: the angle at the shoulder between the reach and the upper arm.
  const k = Math.acos(Math.max(-1, Math.min(1, (upper * upper + d * d - fore * fore) / (2 * upper * d))));
  const u = a + bend * k;
  const elbow: Pt = [shoulder[0] + Math.cos(u) * upper, shoulder[1] + Math.sin(u) * upper];
  return { elbow, wrist: [shoulder[0] + Math.cos(a) * d, shoulder[1] + Math.sin(a) * d] };
}

/** The arm's pixels split by bone, and the body without them (the gaps filled from around them). */
function split(base: Layer, rig: BattleRig): { body: Layer; upper: Layer; fore: Layer; hand: Layer } {
  const { shoulder, elbow, wrist, box, keep, reach, hand } = rig.arm;
  const keepCols = new Set(keep.map(([x, y]) => indexAt(base, x, y)).filter((i) => i >= 0));
  const blank = (): Layer => ({ ...base, px: new Int16Array(base.px.length).fill(-1) });
  const parts = { body: { ...base, px: base.px.slice() }, upper: blank(), fore: blank(), hand: blank() };
  const at = (x: number, y: number) => (y - base.oy) * base.w + (x - base.ox);
  const inBox = (b: Box, x: number, y: number) => x >= b[0] && x < b[2] && y >= b[1] && y < b[3];
  const boxes = [box, ...(rig.arm.more ?? [])];
  const done = new Set<number>();
  for (const bx of boxes)
  for (let y = bx[1]; y < bx[3]; y++)
    for (let x = bx[0]; x < bx[2]; x++) {
      if (done.has(at(x, y))) continue;
      done.add(at(x, y));
      const c = indexAt(base, x, y);
      if (c < 0 || keepCols.has(c)) continue;
      const p: Pt = [x + 0.5, y + 0.5];
      const u = toSegment(p, shoulder, elbow);
      const f = toSegment(p, elbow, wrist);
      const which = inBox(hand, x, y) ? 'hand' : f.d <= reach[1] && f.d <= u.d ? 'fore' : u.d <= reach[0] ? 'upper' : null;
      if (!which && !rig.arm.clear) continue;
      if (which) parts[which].px[at(x, y)] = c;
      parts.body.px[at(x, y)] = -1;
    }
  fillGaps(parts.body, base);
  // Loose bits anywhere in the boxes (their bounds).
  dropIslands(parts.body, [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))]);
  if (rig.arm.fill) widen(parts.body, rig.arm.fill, Math.sign(elbow[0] - shoulder[0]) || 1);
  return parts;
}

/**
 * Build the body's side back out where the arm took it: on each row of the span, the edge facing the
 * arm (`side` 1: right, -1: left) moves out, the new pixels in the row's main colour with its old
 * edge colour on the outside, so the side keeps its shading.
 */
function widen(body: Layer, [y0, y1, top, bottom]: [number, number, number, number], side: number): void {
  const { w, px } = body;
  for (let y = y0; y <= y1; y++) {
    const ly = y - body.oy;
    if (ly < 0 || ly >= body.h) continue;
    let edge = -1;
    for (let x = side > 0 ? w - 1 : 0; side > 0 ? x >= 0 : x < w; x -= side)
      if ((px[ly * w + x] ?? -1) >= 0) {
        edge = x;
        break;
      }
    if (edge < 0) continue;
    // The row's colour at its edge: the commonest of the last three pixels (wider, a trim running
    // across the back could win, and the fill came out as a gold bar; Mark, 2026-10-01).
    const n = new Map<number, number>();
    for (let k = 0; k <= 2; k++) {
      const c = px[ly * w + edge - side * k] ?? -1;
      if (c >= 0) n.set(c, (n.get(c) ?? 0) + 1);
    }
    const main = [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? px[ly * w + edge] ?? -1;
    const rimC = px[ly * w + edge] ?? main;
    const out = Math.round(top + ((bottom - top) * (y - y0)) / Math.max(1, y1 - y0));
    for (let k = 0; k <= out; k++) {
      const x = edge + side * k;
      if (x < 0 || x >= w) break;
      px[ly * w + x] = k === out ? rimC : main;
    }
  }
}

/**
 * Bits of the body the arm cut loose (a line of its outline, a fleck of sleeve), which would float
 * where the arm was: small pieces, in the arm's box, joined to nothing.
 */
function dropIslands(body: Layer, box: Box): void {
  const { w, h, px } = body;
  const seen = new Uint8Array(w * h);
  for (let y = Math.max(0, box[1] - body.oy); y < Math.min(h, box[3] - body.oy); y++)
    for (let x = Math.max(0, box[0] - body.ox); x < Math.min(w, box[2] - body.ox); x++) {
      const i0 = y * w + x;
      if (seen[i0] || (px[i0] ?? -1) < 0) continue;
      const piece = [i0];
      seen[i0] = 1;
      // (The whole piece, however big: stopping early would leave the rest to be mistaken for an island.)
      for (let k = 0; k < piece.length; k++) {
        const i = piece[k] ?? 0;
        const cx = i % w;
        for (const j of [i - 1, i + 1, i - w, i + w]) {
          if (j < 0 || j >= w * h || seen[j] || (px[j] ?? -1) < 0 || Math.abs((j % w) - cx) > 1) continue;
          seen[j] = 1;
          piece.push(j);
        }
      }
      if (piece.length <= 24) for (const i of piece) px[i] = -1;
    }
}

/**
 * Fill the gaps the arm left in the body where the body is on all four sides of them (within a few
 * pixels): each takes the commonest colour of its filled neighbours, working in from the edges.
 */
function fillGaps(body: Layer, base: Layer): void {
  const { w, h, px } = body;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && (px[y * w + x] ?? -1) >= 0;
  const gap: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (solid(x, y) || (base.px[y * w + x] ?? -1) < 0) continue;
      const near = (dx: number, dy: number) => {
        for (let k = 1; k <= 10; k++) if (solid(x + dx * k, y + dy * k)) return true;
        return false;
      };
      if (near(1, 0) && near(-1, 0) && near(0, 1) && near(0, -1)) gap.push(y * w + x);
    }
  for (let pass = 0; pass < 12 && gap.length; pass++) {
    const filled: [number, number][] = [];
    for (const i of gap) {
      const x = i % w;
      const y = (i - x) / w;
      const n = new Map<number, number>();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (!solid(x + dx, y + dy)) continue;
        const c = px[(y + dy) * w + x + dx] ?? -1;
        n.set(c, (n.get(c) ?? 0) + 1);
      }
      const best = [...n].sort((a, b) => b[1] - a[1])[0];
      if (best) filled.push([i, best[0]]);
    }
    for (const [i, c] of filled) px[i] = c;
    const done = new Set(filled.map(([i]) => i));
    for (let k = gap.length - 1; k >= 0; k--) if (done.has(gap[k] ?? -1)) gap.splice(k, 1);
  }
}

/** One posed frame of a crew member, and where its joints and its tip ended up (for the editor and the light). */
export interface Posed {
  frame: HTMLCanvasElement;
  shoulder: Pt;
  elbow: Pt;
  wrist: Pt;
  tip: Pt;
  /** With depth: the elbow and the wrist in 3D (the editor's side view). */
  depth?: { elbow: V3; wrist: V3 };
}

function build(id: string, rig: BattleRig) {
  const t = BATTLE_TRACED[id];
  if (!t) return null;
  const base = { ...decode(t), ox: t.ox, oy: t.oy };
  const parts = split(base, rig);
  // While a weapon is out, what it replaces (Rook's hilt on his back) goes too.
  const armed = rig.hide ? pick(parts.body, rig.hide.box, rig.hide.keep).rest : parts.body;
  const lit = nearest(t.pal, rig.arm.sleeve);
  const shade = darker({ w: 1, h: 1, ox: 0, oy: 0, px: Int16Array.of(lit) }, t.pal).px[0] ?? lit;
  const { shoulder, elbow, wrist } = rig.arm;
  const has = (l: Layer) => l.px.some((p) => p >= 0);
  // Which way the elbow bends at rest (the side of the shoulder-wrist line it's on).
  const bend = Math.sign((elbow[0] - shoulder[0]) * (wrist[1] - shoulder[1]) - (elbow[1] - shoulder[1]) * (wrist[0] - shoulder[0])) || 1;
  // The drawn hands, as layers whose (0, 0) is their pivot (where they join the wrist).
  const drawn = (hand: DrawnHand | undefined): Layer | null => {
    if (!hand) return null;
    const { rows, colors, pivot } = hand;
    const fw = Math.max(...rows.map((r) => r.length));
    const index = Object.fromEntries(Object.entries(colors).map(([k, hex]) => [k, nearest(t.pal, hex)]));
    const fpx = new Int16Array(fw * rows.length).fill(-1);
    rows.forEach((r, y) => {
      [...r].forEach((ch, x) => {
        fpx[y * fw + x] = index[ch] ?? -1;
      });
    });
    return { w: fw, h: rows.length, ox: -Math.round(pivot[0]), oy: -Math.round(pivot[1]), px: fpx };
  };
  // The shoulder cap's colour: what the upper arm is made of right at the shoulder (Rook's coat,
  // Kit's jacket), else the sleeve colour.
  let capLit = lit;
  if (has(parts.upper)) {
    const n = new Map<number, number>();
    for (let y = Math.round(shoulder[1]) - 4; y <= Math.round(shoulder[1]) + 4; y++)
      for (let x = Math.round(shoulder[0]) - 4; x <= Math.round(shoulder[0]) + 4; x++) {
        const c = indexAt(parts.upper, x, y);
        if (c >= 0) n.set(c, (n.get(c) ?? 0) + 1);
      }
    capLit = [...n].sort((p, q) => q[1] - p[1])[0]?.[0] ?? lit;
  }
  const capShade = darker({ w: 1, h: 1, ox: 0, oy: 0, px: Int16Array.of(capLit) }, t.pal).px[0] ?? capLit;
  return { t, base, parts, armed, lit, shade, capLit, capShade, fist: drawn(rig.arm.fist), open: drawn(rig.arm.open), bend: -bend, upperLen: dist(shoulder, elbow), foreLen: dist(elbow, wrist), hasUpper: has(parts.upper), hasFore: has(parts.fore) };
}
const built = new Map<string, ReturnType<typeof build>>();

/** Forget what was built (the editor changed a skeleton). */
export function resetRig(id?: string): void {
  if (id) built.delete(id);
  else built.clear();
}

/** A crew member in a pose (null pose: standing) or null without a traced frame and skeleton. `rig`: the editor's, unsaved. */
export function poseFrame(id: string, pose: ArmPose | null, rig = SKELETONS[id]): Posed | null {
  if (!rig) return null;
  // Built once per skeleton (the editor's unsaved ones keyed by their joints).
  const key = rig === SKELETONS[id] ? id : `${id}|${JSON.stringify([rig.arm, rig.hide ?? null])}`;
  let b = built.get(key);
  if (b === undefined) {
    b = build(id, rig);
    built.set(key, b);
  }
  if (!b) return null;
  const { shoulder, elbow: restElbow, wrist: restWrist } = rig.arm;
  if (!pose) return { frame: renderLayers([b.base], b.t.pal, SIZE, SIZE), shoulder, elbow: restElbow, wrist: restWrist, tip: restWrist };
  const bendSign = pose.flip ? -b.bend : b.bend;
  let elbow: Pt;
  let wrist: Pt;
  let depth: Posed['depth'];
  if (pose.depth) {
    // In 3D: the elbow bends to the same side as on screen (square to the reach, in the screen's
    // plane), then everything is seen as the battle sees it.
    const hx = pose.hand[0] - shoulder[0], hy = pose.hand[1] - shoulder[1];
    const hl = Math.hypot(hx, hy) || 1;
    depth = solveArm3([shoulder[0], shoulder[1], 0], b.upperLen, b.foreLen, [pose.hand[0], pose.hand[1], pose.depth], [(-hy / hl) * bendSign, (hx / hl) * bendSign, 0]);
    elbow = project(depth.elbow);
    wrist = project(depth.wrist);
  } else ({ elbow, wrist } = solveArm(shoulder, b.upperLen, b.foreLen, pose.hand, bendSign));
  const turnUpper = angleOf(shoulder, elbow) - angleOf(shoulder, restElbow);
  const turnFore = angleOf(elbow, wrist) - angleOf(restElbow, restWrist);
  // A bone's pixels turned at its joint, then carried to where that joint is now.
  const place = (l: Layer, turn: number, from: Pt, to: Pt) => moved(rotSprite(l, turn, from[0], from[1]), Math.round(to[0] - from[0]), Math.round(to[1] - from[1]));
  // A drawn sleeve, narrowing with depth from `za` at its start to `zc` at its end.
  const sleeve = (a: Pt, c: Pt, za = 0, zc = 0) => band(a, c, rig.arm.width * sizeAt(za), b.lit, b.shade, true, rig.arm.width * sizeAt(zc));
  const ez = depth?.elbow[2] ?? 0;
  const wz = depth?.wrist[2] ?? 0;
  const arm: Layer[] = [];
  const cap = () => {
    const a = Math.atan2(elbow[1] - shoulder[1], elbow[0] - shoulder[0]);
    return band(shoulder, [shoulder[0] + Math.cos(a) * 4, shoulder[1] + Math.sin(a) * 4], rig.arm.width + 2, b.capLit, b.capShade, true);
  };
  // The upper arm: its own traced pixels turned, or (past `drawnFrom` degrees, or with none of
  // its own) a sleeve drawn clean. The shoulder cap, a stub of sleeve under the joint, closes the
  // seam where the jacket meets a turned arm (Mark, 2026-10-01, on Kit); a barely turned arm has
  // no seam to close, and a cap there only bulges over the shoulder.
  const small = (deg: number) => Math.abs(((deg + 540) % 360) - 180) <= (rig.arm.drawnFrom ?? 360);
  const traced = b.hasUpper && small(turnUpper) && !pose.depth;
  if (traced) {
    if (!rig.arm.drawnFrom) arm.push(cap());
    arm.push(place(b.parts.upper, turnUpper, shoulder, shoulder));
  } else if (b.hasUpper || rig.arm.clear) arm.push(cap(), sleeve(shoulder, elbow, 0, ez));
  // The forearm's sleeve under its own pixels: it covers the joint as the bones turn (not needed
  // while the traced arm barely turns: its own pixels are all there).
  // It stops a sleeve's half-width short of the wrist, so its round end stays inside the hand
  // instead of showing past the fist.
  if (!(traced && rig.arm.drawnFrom && small(turnFore))) {
    const fl = Math.hypot(wrist[0] - elbow[0], wrist[1] - elbow[1]) || 1;
    const k = Math.max(0, 1 - rig.arm.width / 2 / fl);
    arm.push(sleeve(elbow, [elbow[0] + (wrist[0] - elbow[0]) * k, elbow[1] + (wrist[1] - elbow[1]) * k], ez, ez + (wz - ez) * k));
  }
  // The forearm's own pixels are its full length: skip them when it's foreshortened (reaching into
  // the screen), and let the drawn sleeve show it.
  if (b.hasFore && dist(elbow, wrist) > b.foreLen * 0.85) arm.push(place(b.parts.fore, turnFore, restElbow, elbow));
  // The hand: the drawn fist (or open hand) on a big move, turned to point along the forearm;
  // else its own traced pixels.
  const drawnHand = pose.shape === 'open' ? (b.open ?? b.fist) : b.fist;
  const handTurn = turnFore + (pose.grip ?? 0);
  const hand =
    drawnHand && !(traced && small(turnFore))
      ? moved(rotSprite(drawnHand, angleOf(elbow, wrist) + 90 + (pose.grip ?? 0), 0, 0, sizeAt(depth?.wrist[2] ?? 0)), Math.round(wrist[0]), Math.round(wrist[1]))
      : place(b.parts.hand, handTurn, restWrist, wrist);
  arm.push(hand);
  const w = pose.weapon ? weapon({ ...pose.weapon, angle: angleOf(elbow, wrist) + (pose.grip ?? 0) + pose.weapon.angle }, wrist, b.t.pal) : null;
  if (w) arm.push(...w.layers);
  const body = w ? b.armed : b.parts.body;
  // An upper arm with no pixels of its own (under hair or a coat) is a sleeve behind the body.
  const under = b.hasUpper || rig.arm.clear ? [] : [sleeve(shoulder, elbow)];
  const layers = pose.behind ? [...under, ...arm, body] : [...under, body, ...arm];
  const tip = w ? w.tip : pose.lightAt === 'top' ? topOf(hand) : farEnd(hand, wrist);
  return { frame: renderLayers(layers, b.t.pal, SIZE, SIZE), shoulder, elbow, wrist, tip, ...(depth ? { depth } : {}) };
}

/** The light a pose throws, from where the previous pose left the hand (for a strike's swept arc). */
export function poseGlow(rig: BattleRig, pose: ArmPose, at: Posed, from: Posed): HTMLCanvasElement | undefined {
  if (!pose.light) return undefined;
  const onHand = pose.lightAt === 'hand' || !pose.lightAt;
  return poseLight(onHand ? at.wrist : at.tip, onHand ? from.wrist : from.tip, pose.light, rig.light, pose.arc);
}

/** The arc's default bend: off the middle of its line, up and out (as the arc always bowed). */
export function defaultBend(from: Pt, at: Pt): Pt {
  return [(from[0] + at[0]) / 2 + 16, (from[1] + at[1]) / 2 - 12];
}

/** Where a pose's light lands and where its arc starts by default (the editor's arc handles). */
export function arcEnds(pose: ArmPose, at: Posed, from: Posed): { to: Pt; from: Pt } {
  const onHand = pose.lightAt === 'hand' || !pose.lightAt;
  return { to: onHand ? at.wrist : at.tip, from: onHand ? from.wrist : from.tip };
}

/** The crew member's battle back from their traced frame and skeleton, or null without both. */
export function rigBattler(id: string): Battler | null {
  const rig = SKELETONS[id];
  const t = BATTLE_TRACED[id];
  const idle = poseFrame(id, null);
  if (!rig || !t || !idle) return null;
  const posed = (k: KeyPose) => {
    const p = rig.poses[k];
    const f = p && poseFrame(id, p);
    return p && f ? { p, f } : null;
  };
  const brace = posed('brace');
  const strike = posed('strike');
  const raise = posed('raise');
  const victory = posed('victory') ?? raise;
  const aim = rig.aim === 'strike' ? strike : raise;
  const frame = (x: { f: Posed } | null) => (x ? x.f.frame : idle.frame);
  // A hit: the stance tipped back about the feet, a few degrees, and sunk a little.
  const hurt = renderLayers([moved(rotSprite({ ...decode(t), ox: t.ox, oy: t.oy }, -6, t.ox + t.w / 2, t.oy + t.feet), 0, 2)], t.pal, SIZE, SIZE);
  const frames: Record<Pose, HTMLCanvasElement> = {
    idle: idle.frame,
    brace: frame(brace),
    attack: frame(strike),
    strike: frame(strike),
    thrust: frame(strike),
    cast: frame(raise),
    item: frame(raise),
    aim: frame(aim),
    victory: frame(victory),
    hurt,
  };
  const from = brace?.f ?? idle;
  const lightOf = (x: { p: ArmPose; f: Posed } | null) => (x ? poseGlow(rig, x.p, x.f, from) : undefined);
  const glow: Partial<Record<Pose, HTMLCanvasElement>> = {};
  const strikeLight = lightOf(strike);
  const raiseLight = lightOf(raise);
  if (strikeLight) {
    glow.strike = strikeLight;
    glow.thrust = strikeLight;
  }
  if (raiseLight) glow.cast = raiseLight;
  const aimLight = rig.aim === 'strike' ? strikeLight : raiseLight;
  if (aimLight) glow.aim = aimLight;
  // Head height in battle pixels (the art is at twice the battle's resolution).
  const top = t.rows.findIndex((r) => /[^.]/.test(r));
  const headH = Math.ceil((t.feet - Math.max(0, top)) / 2);
  return { frames, glow, headH, res: 2 };
}
