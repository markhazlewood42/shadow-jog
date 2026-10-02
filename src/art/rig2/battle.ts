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
  /**
   * With a stance: the upper body leaning from the hips, degrees (> 0: its top to the right), the
   * shoulders (and the arms on them) going with it and the head half as far. Rook's cut coils right
   * on the way up and throws his weight left on the way down (Mark, 2026-10-01, after Chaz in
   * Phantasy Star IV).
   */
  lean?: number;
  /** With a stance: the body this much lower again (the downswing sinking into the cut). */
  drop?: number;
  /**
   * With a stance: where each foot goes, [right, down] pixels from where it stands traced (the
   * shin leaning from the coat to it; down the screen is back, toward us). Without it, the
   * stance's own spread and stagger. Turned right, the left foot is forward and the right back;
   * turned left, the other way round.
   */
  feet?: { left?: [number, number]; right?: [number, number] };
  /**
   * With a stance whose coat comes down over the legs: the coat's hem flared out by [left, right]
   * pixels (widening from the waist down, its outline only, so what's on it keeps its shape), and
   * a vent `split` pixels tall opened up the middle from the hem, an upside-down V between the
   * legs. A wide stance spreads the coat with the legs (Mark's PixelLab reference, 2026-10-01).
   */
  coat?: { flare?: [number, number]; split?: number };
  /**
   * Both hands on the weapon (Rook's two-handed cut; Mark, 2026-10-01): the free arm's hand holds
   * the grip just behind this one, whatever the free arm's own pose, its arm as long as it must be
   * to get there.
   */
  both?: boolean;
  /** With `both`: the free arm's elbow bends the other way; the free arm goes behind the body. */
  freeFlip?: boolean;
  freeBehind?: boolean;
  /**
   * The arm's length in this pose, as a share of its own (1.3: 30% longer). Rook's traced arms are
   * short for his big head: raised overhead, or reaching across behind his body, they need more. A
   * lengthened arm is drawn as sleeves (its traced pixels can't stretch).
   */
  length?: number;
}

/** A hand drawn in code: rows of colour letters (`colors`), pointing up, joined to the wrist at `pivot`. */
export interface DrawnHand {
  rows: string[];
  colors: Record<string, string>;
  pivot: Pt;
}

/** The key poses a battle back has; the battle maps its moves onto these. */
export const KEY_POSES = ['brace', 'windup', 'strike', 'raise', 'victory'] as const;
export type KeyPose = (typeof KEY_POSES)[number];

/** An arm's skeleton (joints at rest, in the 128x128 canvas's coordinates) and where its pixels are. */
export interface ArmRig {
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
  /** The forearm's colour and width when drawn, if not the sleeve's (Rook's chrome forearm under a coat sleeve). */
  fore?: string;
  foreWidth?: number;
  /** A drawn upper sleeve's width at the shoulder, tapering to `width` at the elbow (a coat's shoulder is broad). */
  shoulderWidth?: number;
  /**
   * Drawn sleeves get a dark edge of their own, like the lines inside the traced art: Rook's chrome
   * arm raised over his grey hair, or his coat sleeve over his coat, read as one slab without it
   * (Mark, 2026-10-01).
   */
  outline?: boolean;
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
  /**
   * Where the body's side runs once the arm has gone from it: a line from (x0, y0) down to (x1, y1).
   * Each row is filled from the line in to the body in the sleeve's colour, its outer pixel shaded
   * (Rook's free arm hangs in a sleeve of his coat; lifted, the coat behind it shows).
   */
  side?: [number, number, number, number];
}

/** A crew member's skeleton and poses. */
export interface BattleRig {
  /** The arm the poses move (the weapon arm). */
  arm: ArmRig;
  /**
   * The other arm, in one pose for every pose with one hand on the weapon: out for balance as the
   * weapon arm swings (Rook's Cast and Victory; Mark, 2026-10-01). A pose with `both` puts its hand
   * on the grip instead. Standing, it hangs as traced.
   */
  free?: { arm: ArmRig; pose: ArmPose };
  /**
   * How every pose stands: knees bent, the body `sink` pixels lower, the feet `spread` pixels
   * further apart and the right foot `stagger` pixels forward (up the screen: a fencer's stance),
   * the legs from row `legs` down (where they show under a coat). Standing is as traced.
   */
  stance?: {
    legs: number;
    sink: number;
    spread: number;
    stagger?: number;
    /** Where the body leans from (a pose's `lean`): the hips. */
    hip?: Pt;
    /** Where the head turns on the body (the nape): the head, above it, leans half as far. */
    neck?: Pt;
    /** Where a coat starts to flare (a pose's `coat`): the waist's row. */
    waist?: number;
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
export function nearest(pal: string[], hex: string): number {
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
export function band(a: Pt, b: Pt, width: number, lit: number, shade: number, rim = false, width2 = width): Layer {
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
export const along = (p: Pt, deg: number, len: number): Pt => [p[0] + Math.cos((deg * Math.PI) / 180) * len, p[1] + Math.sin((deg * Math.PI) / 180) * len];

const PISTOL = 7;
/** How far apart two hands hold a two-handed grip (a fist's width), the second behind the first. */
const GRIP = 6;
/**
 * The katana, in pixels along it from the fist that holds it (by the guard): the pommel end of
 * its grip, the guard (tsuba), and the blade's point. The grip has room for both hands.
 */
const KATANA = { pommel: -12, guard: 4, tip: 32 };
/** The katana's size along its length, and whether it is drawn thin (a one-pixel blade, for a small sprite). */
export interface KatanaDims {
  pommel: number;
  guard: number;
  tip: number;
  thin?: boolean;
  /** Three pixels across for the blade: a white lit edge, the steel, a dark spine, and a bright glint at the point (the side-view kendo contact frame). */
  spine?: boolean;
}

/**
 * The centre line of something straight pointing `deg` from (0, 0), from `d0` to `d1` along it:
 * one pixel per step on its longer axis, the other axis rounded. A line drawn this way, then
 * thickened along its shorter axis, looks the same thickness at any angle (a filled band thins to
 * a stair-step on the diagonals: Mark, 2026-10-01, wanted the sword the same in every frame).
 * Each point also carries `d`, its distance along.
 */
function axisPx(deg: number, d0: number, d1: number): { x: number; y: number; d: number }[] {
  const ux = Math.cos((deg * Math.PI) / 180);
  const uy = Math.sin((deg * Math.PI) / 180);
  const steep = Math.abs(uy) > Math.abs(ux);
  const major = steep ? uy : ux;
  const minor = steep ? ux : uy;
  const out: { x: number; y: number; d: number }[] = [];
  for (let m = Math.round(d0 * Math.abs(major)); m <= Math.round(d1 * Math.abs(major)); m++) {
    const a = m * Math.sign(major);
    const b = Math.round((m * minor) / Math.abs(major));
    out.push(steep ? { x: b, y: a, d: m / Math.abs(major) } : { x: a, y: b, d: m / Math.abs(major) });
  }
  return out;
}

/**
 * Rook's katana, held at `hand` pointing `deg`, in its own fixed pixel style: a navy grip three
 * pixels thick with orange wrap diamonds (as the sheathed one on his back), a gold tsuba across it,
 * and a two-pixel steel blade lit on its top-left edge, tapering to a point. The same in every
 * frame whatever its angle; its pixels are laid from the rounded hand, so they don't shimmer
 * between poses either. Returns the layer and the blade's point.
 */
export function katana(hand: Pt, deg: number, pal: string[], dims: KatanaDims = KATANA): { layer: Layer; tip: Pt } {
  const K = dims;
  const thin = dims.thin === true;
  const c = (hex: string) => nearest(pal, hex);
  const steelLit = c('#f2f1f4');
  const steel = c('#9fa0a9');
  const navy = c('#292e47');
  const navyDark = c('#1d1c37');
  const wrap = c('#e39328');
  const gold = c('#fcb533');
  const goldDark = c('#c6661e');
  const px = new Map<string, number>();
  const put = (x: number, y: number, col: number) => px.set(`${x},${y}`, col);
  // Thickening goes along the shorter axis: x for a steep line, y for a shallow one.
  const side = (deg2: number): [number, number] => (Math.abs(Math.sin((deg2 * Math.PI) / 180)) > Math.abs(Math.cos((deg2 * Math.PI) / 180)) ? [1, 0] : [0, 1]);
  const [sx, sy] = side(deg);
  // The grip: three pixels, lit side, middle (a wrap diamond every third step), shade side; the
  // pommel end a step of dark gold.
  // (Counted in steps, not distance: a diagonal takes fewer, longer steps, and the pattern would drift.)
  axisPx(deg, K.pommel, K.guard - 1).forEach((q, i) => {
    const end = i === 0;
    const diamond = i > 0 && i % 3 === 0;
    if (thin) {
      put(q.x, q.y, end ? goldDark : diamond ? wrap : navy);
      put(q.x + sx, q.y + sy, end ? goldDark : navyDark);
      return;
    }
    put(q.x - sx, q.y - sy, end ? goldDark : navy);
    put(q.x, q.y, end ? goldDark : diamond ? wrap : navy);
    put(q.x + sx, q.y + sy, end ? goldDark : navyDark);
  });
  // The blade: two pixels, the lit edge and the steel, one pixel for its last two steps (the point).
  const blade = axisPx(deg, K.guard + 1, K.tip);
  const edge = K.spine ? c('#ffffff') : steelLit;
  const spineCol = c('#4b4e63');
  blade.forEach((q, i) => {
    const point = i >= blade.length - 2;
    put(q.x, q.y, K.spine && i === blade.length - 1 ? c('#ffffff') : edge);
    if (!thin && !point) put(q.x + sx, q.y + sy, steel);
    if (K.spine && !point && i < blade.length - 3) put(q.x + 2 * sx, q.y + 2 * sy, spineCol);
  });
  // The tsuba across it: five pixels by two, gold lit and dark.
  const g = axisPx(deg, K.guard, K.guard).at(0) ?? { x: 0, y: 0, d: 0 };
  const [tx, ty] = side(deg + 90);
  for (const q of axisPx(deg + 90, thin ? -1 : -2, thin ? 1 : 2)) {
    put(g.x + q.x, g.y + q.y, gold);
    if (!thin) put(g.x + q.x + tx, g.y + q.y + ty, goldDark);
  }
  const xs = [...px.keys()].map((k) => Number(k.split(',')[0]));
  const ys = [...px.keys()].map((k) => Number(k.split(',')[1]));
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0 + 1;
  const h = Math.max(...ys) - y0 + 1;
  const out = new Int16Array(w * h).fill(-1);
  for (const [k, col] of px) {
    const [x = 0, y = 0] = k.split(',').map(Number);
    out[(y - y0) * w + (x - x0)] = col;
  }
  const hx = Math.round(hand[0]);
  const hy = Math.round(hand[1]);
  const point = blade.at(-1) ?? { x: 0, y: 0, d: 0 };
  return { layer: { w, h, ox: hx + x0, oy: hy + y0, px: out }, tip: [hx + point.x, hy + point.y] };
}

/** A weapon in the hand, drawn in code from palette colours: its layers and its tip. */
function weapon(w: Weapon, hand: Pt, pal: string[]): { layers: Layer[]; tip: Pt } {
  if (w.kind === 'katana') {
    const k = katana(hand, w.angle, pal);
    return { layers: [k.layer], tip: k.tip };
  }
  const grip = nearest(pal, '#1a1822');
  const tip = along(hand, w.angle, PISTOL);
  return { layers: [band(hand, tip, 3, grip, grip)], tip };
}

/** How far from the wrist a drawn hand's middle is, along the forearm (where it holds a grip). */
const handMiddle = (hand: Layer) => -hand.oy - (hand.h - 1) / 2;

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
    // A long sweep (Rook's two-handed cut, over his whole figure) is drawn solid, and two pixels
    // thick through its middle, a blade's smear; a short one keeps its 50 steps as Mark approved it.
    const len = Math.hypot(cx - sx, cy - sy) + Math.hypot(x - cx, y - cy);
    const long = len > 90;
    // (A short one steps by 0.02 as it always has, which stops just short of the end.)
    const ts = long ? Array.from({ length: Math.ceil(len * 1.5) + 1 }, (_, i) => i / Math.ceil(len * 1.5)) : [];
    if (!long) for (let t = 0; t <= 1; t += 0.02) ts.push(t);
    for (const t of ts) {
      const u = 1 - t;
      const px = u * u * sx + 2 * u * t * cx + t * t * x;
      const py = u * u * sy + 2 * u * t * cy + t * t * y;
      dot(px, py, t > 0.4 ? '#ffffff' : tint);
      if (long && t > 0.3 && t < 0.9) dot(px + 1, py + 1, t > 0.5 ? '#ffffff' : tint);
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
function split(base: Layer, arm: ArmRig): { body: Layer; upper: Layer; fore: Layer; hand: Layer } {
  const { shoulder, elbow, wrist, box, keep, reach, hand } = arm;
  const keepCols = new Set(keep.map(([x, y]) => indexAt(base, x, y)).filter((i) => i >= 0));
  const blank = (): Layer => ({ ...base, px: new Int16Array(base.px.length).fill(-1) });
  const parts = { body: { ...base, px: base.px.slice() }, upper: blank(), fore: blank(), hand: blank() };
  const at = (x: number, y: number) => (y - base.oy) * base.w + (x - base.ox);
  const inBox = (b: Box, x: number, y: number) => x >= b[0] && x < b[2] && y >= b[1] && y < b[3];
  const boxes = [box, ...(arm.more ?? [])];
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
      if (!which && !arm.clear) continue;
      if (which) parts[which].px[at(x, y)] = c;
      parts.body.px[at(x, y)] = -1;
    }
  fillGaps(parts.body, base);
  // Loose bits anywhere in the boxes (their bounds).
  dropIslands(parts.body, [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))]);
  if (arm.fill) widen(parts.body, arm.fill, Math.sign(elbow[0] - shoulder[0]) || 1);
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

/**
 * Fill the body's side back in where an arm left it: each row from the line (x0, y0)-(x1, y1) in to
 * the body (`dir` -1: the line is on the body's left), in `lit` with the outer pixel in `shade`. A
 * row with no body within reach of the line is left alone.
 */
function fillSide(body: Layer, [x0, y0, x1, y1]: [number, number, number, number], dir: number, lit: number, shade: number): void {
  for (let y = y0; y <= y1; y++) {
    const ly = y - body.oy;
    if (ly < 0 || ly >= body.h) continue;
    const edge = Math.round(x0 + ((x1 - x0) * (y - y0)) / Math.max(1, y1 - y0));
    const at = (k: number) => edge - dir * k - body.ox;
    let reach = -1;
    for (let k = 0; k < 16; k++) {
      const lx = at(k);
      if (lx < 0 || lx >= body.w) break;
      if ((body.px[ly * body.w + lx] ?? -1) >= 0) {
        reach = k;
        break;
      }
    }
    for (let k = 0; k < reach; k++) body.px[ly * body.w + at(k)] = k === 0 ? shade : lit;
  }
}

/** A layer with `n` empty pixels added on every side (room to grow into). */
function padded(l: Layer, n: number): Layer {
  const w = l.w + 2 * n;
  const px = new Int16Array(w * (l.h + 2 * n)).fill(-1);
  for (let y = 0; y < l.h; y++) for (let x = 0; x < l.w; x++) px[(y + n) * w + x + n] = l.px[y * l.w + x] ?? -1;
  return { w, h: l.h + 2 * n, ox: l.ox - n, oy: l.oy - n, px };
}

/**
 * A coat's side flared out: a straight edge from where the side is at the waist to `by` pixels
 * past where it is at the hem (`side` -1: the left), each row filled out to it in the row's own
 * colour, its outermost pixel the row's old edge colour. A straight line keeps the A-line clean
 * (moving each row's own uneven edge out left little ledges).
 */
function flare(l: Layer, waist: number, hem: number, by: number, side: number): void {
  const { w, px } = l;
  const edgeAt = (y: number) => {
    const ly = y - l.oy;
    for (let k = 0; k < w; k++) {
      const x = side < 0 ? k : w - 1 - k;
      if ((px[ly * w + x] ?? -1) >= 0) return x;
    }
    return -1;
  };
  const top = edgeAt(waist);
  const bottom = edgeAt(hem);
  if (top < 0 || bottom < 0) return;
  for (let y = waist; y <= hem; y++) {
    const ly = y - l.oy;
    const edge = edgeAt(y);
    if (edge < 0) continue;
    const to = Math.round(top + ((bottom + side * by - top) * (y - waist)) / Math.max(1, hem - waist));
    // Out past the row's own edge only (a bump already further out stays).
    if ((to - edge) * side <= 0) continue;
    const n = new Map<number, number>();
    for (let k = 0; k <= 2; k++) {
      const c = px[ly * w + edge - side * k] ?? -1;
      if (c >= 0) n.set(c, (n.get(c) ?? 0) + 1);
    }
    const main = [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? px[ly * w + edge] ?? -1;
    const rim = px[ly * w + edge] ?? main;
    for (let x = edge; x !== to + side; x += side) if (x >= 0 && x < w) px[ly * w + x] = x === to ? rim : main;
  }
}

/**
 * The body above the legs with its coat in a pose's shape: the hem flared out on each side from
 * the waist down (the outline moved out, in each row's own colours), and a vent opened up the
 * middle from the hem.
 */
function flared(top: Layer, stance: NonNullable<BattleRig['stance']>, pose: ArmPose): Layer {
  const c = pose.coat;
  if (!c || (!c.flare && !c.split)) return top;
  const out = padded(top, 8);
  const hem = stance.legs - 1;
  const waist = stance.waist ?? hem - 20;
  const [fl = 0, fr = 0] = c.flare ?? [];
  if (fl) flare(out, waist, hem, fl, -1);
  if (fr) flare(out, waist, hem, fr, 1);
  const split = c.split ?? 0;
  if (split > 0) {
    const cx = Math.round(stance.hip?.[0] ?? out.ox + out.w / 2);
    for (let y = hem - split + 1; y <= hem; y++) {
      const half = Math.round(((y - (hem - split)) / split) * (split / 3));
      for (let x = cx - half; x <= cx + half; x++) {
        const lx = x - out.ox;
        const ly = y - out.oy;
        if (lx >= 0 && lx < out.w && ly >= 0 && ly < out.h) out.px[ly * out.w + lx] = -1;
      }
    }
  }
  return out;
}

/** `p` turned `deg` degrees (> 0 clockwise on screen) about `c`. */
function rotate(p: Pt, c: Pt, deg: number): Pt {
  const r = (deg * Math.PI) / 180;
  const dx = p[0] - c[0];
  const dy = p[1] - c[1];
  return [c[0] + dx * Math.cos(r) - dy * Math.sin(r), c[1] + dx * Math.sin(r) + dy * Math.cos(r)];
}

/**
 * How a pose carries the upper body: down by the stance's sink and the pose's drop, then leaned
 * about the hips. Applied to the shoulders, so the arms go with it; standing (no stance) it's none.
 */
function bodyMove(stance: BattleRig['stance'], pose: ArmPose): { sink: number; lean: number; hip: Pt; to: (p: Pt) => Pt } {
  if (!stance) return { sink: 0, lean: 0, hip: [0, 0], to: (p) => p };
  const sink = stance.sink + (pose.drop ?? 0);
  const lean = pose.lean ?? 0;
  const hip: Pt = [stance.hip?.[0] ?? 64, (stance.hip?.[1] ?? stance.legs - 12) + sink];
  return { sink, lean, hip, to: (p) => rotate([p[0], p[1] + sink], hip, lean) };
}

/**
 * The body in a stance: the legs (from row `legs` down) with each foot moved (the shin leaning
 * out from the coat to it), and everything above them lower, over their tops, so the knees read
 * as bent; leaned from the hips with the head half as far, when the pose leans.
 */
function stand(body: Layer, stance: BattleRig['stance'], pose: ArmPose): Layer[] {
  if (!stance) return [body];
  const top = cut(body, body.ox, body.oy, body.ox + body.w, stance.legs);
  const legs = cut(body, body.ox, stance.legs, body.ox + body.w, body.oy + body.h);
  const { w, h, px } = legs;
  const solid = (x: number, y: number) => (px[y * w + x] ?? -1) >= 0;
  // Between the feet: the emptiest column near the middle.
  let mid = Math.floor(w / 2);
  let fewest = Infinity;
  for (let x = Math.floor(w * 0.3); x <= Math.ceil(w * 0.7); x++) {
    let n = 0;
    for (let y = 0; y < h; y++) if (solid(x, y)) n++;
    if (n < fewest || (n === fewest && Math.abs(x - w / 2) < Math.abs(mid - w / 2))) {
      fewest = n;
      mid = x;
    }
  }
  let bottom = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (solid(x, y)) bottom = y;
  // Each foot: the pose's, else the stance's spread (out) and stagger (the right one forward, up
  // the screen, its top under the coat). The shin leans toward the foot, more toward the ground;
  // forward or back moves the whole leg.
  const s = stance.spread;
  const feet = { left: pose.feet?.left ?? [-s, 0], right: pose.feet?.right ?? [s, -(stance.stagger ?? 0)] };
  const P = 8;
  const out: Layer = { w: w + 2 * P, h: h + 2 * P, ox: legs.ox - P, oy: legs.oy - P, px: new Int16Array((w + 2 * P) * (h + 2 * P)).fill(-1) };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!solid(x, y)) continue;
      const [fx = 0, fy = 0] = x < mid ? feet.left : feet.right;
      const tx = x + P + Math.round((fx * y) / Math.max(1, bottom));
      const ty = y + P + fy;
      if (tx >= 0 && tx < out.w && ty >= 0 && ty < out.h) out.px[ty * out.w + tx] = px[y * w + x] ?? -1;
    }
  const { sink, lean, hip, to } = bodyMove(stance, pose);
  const upper = moved(flared(top, stance, pose), 0, sink);
  if (!lean) return [out, upper];
  if (!stance.neck) return [out, rotSprite(upper, lean, hip[0], hip[1])];
  // The head rides on the neck and leans half as far (Chaz's stays nearly upright as he cuts);
  // the collar, on the body, laps over its bottom. The head takes a few rows of collar with it, so
  // where the two turn apart there's collar under the seam, not a gap.
  const neck: Pt = [stance.neck[0], stance.neck[1] + sink];
  const head = cut(upper, upper.ox, upper.oy, upper.ox + upper.w, neck[1] + 3);
  const torso = cut(upper, upper.ox, neck[1], upper.ox + upper.w, upper.oy + upper.h);
  const nape = to(stance.neck);
  const headTurned = moved(rotSprite(head, lean / 2, neck[0], neck[1]), Math.round(nape[0] - neck[0]), Math.round(nape[1] - neck[1]));
  return [out, headTurned, rotSprite(torso, lean, hip[0], hip[1])];
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
  /** The free arm's joints, posed (the editor's handles). */
  free?: { shoulder: Pt; elbow: Pt; wrist: Pt };
}

/** An arm's pixels by bone, and what drawing it needs: its sleeve colours, its drawn hands, its bones. */
function armOf(pal: string[], parts: { upper: Layer; fore: Layer; hand: Layer }, arm: ArmRig) {
  const lit = nearest(pal, arm.sleeve);
  const shade = darker({ w: 1, h: 1, ox: 0, oy: 0, px: Int16Array.of(lit) }, pal).px[0] ?? lit;
  const { shoulder, elbow, wrist } = arm;
  const has = (l: Layer) => l.px.some((p) => p >= 0);
  // Which way the elbow bends at rest (the side of the shoulder-wrist line it's on).
  const bend = Math.sign((elbow[0] - shoulder[0]) * (wrist[1] - shoulder[1]) - (elbow[1] - shoulder[1]) * (wrist[0] - shoulder[0])) || 1;
  // The drawn hands, as layers whose (0, 0) is their pivot (where they join the wrist).
  const drawn = (hand: DrawnHand | undefined): Layer | null => {
    if (!hand) return null;
    const { rows, colors, pivot } = hand;
    const fw = Math.max(...rows.map((r) => r.length));
    const index = Object.fromEntries(Object.entries(colors).map(([k, hex]) => [k, nearest(pal, hex)]));
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
  const capShade = darker({ w: 1, h: 1, ox: 0, oy: 0, px: Int16Array.of(capLit) }, pal).px[0] ?? capLit;
  const foreLit = arm.fore ? nearest(pal, arm.fore) : lit;
  const foreShade = darker({ w: 1, h: 1, ox: 0, oy: 0, px: Int16Array.of(foreLit) }, pal).px[0] ?? foreLit;
  return { parts, lit, shade, capLit, capShade, foreLit, foreShade, fist: drawn(arm.fist), open: drawn(arm.open), bend: -bend, upperLen: dist(shoulder, elbow), foreLen: dist(elbow, wrist), hasUpper: has(parts.upper), hasFore: has(parts.fore) };
}
type BuiltArm = ReturnType<typeof armOf>;

function build(id: string, rig: BattleRig) {
  const t = BATTLE_TRACED[id];
  if (!t) return null;
  const base = { ...decode(t), ox: t.ox, oy: t.oy };
  const main = split(base, rig.arm);
  // The free arm comes out of what the weapon arm left.
  const free = rig.free ? split(main.body, rig.free.arm) : null;
  const body = free?.body ?? main.body;
  const arm = armOf(t.pal, main, rig.arm);
  const freeArm = free && rig.free ? armOf(t.pal, free, rig.free.arm) : null;
  // The body's sides back where the arms were (the side away from the body's middle).
  const middle = t.ox + t.w / 2;
  for (const [a, made] of [[rig.arm, arm], [rig.free?.arm, freeArm]] as const)
    if (a?.side && made) fillSide(body, a.side, Math.sign(a.side[0] - middle) || 1, made.lit, made.shade);
  // While a weapon is out, what it replaces (Rook's hilt on his back) goes too.
  const armed = rig.hide ? pick(body, rig.hide.box, rig.hide.keep).rest : body;
  return { t, base, body, armed, arm, free: freeArm };
}
const built = new Map<string, ReturnType<typeof build>>();

/** Forget what was built (the editor changed a skeleton). */
export function resetRig(id?: string): void {
  if (id) built.delete(id);
  else built.clear();
}

/**
 * Where an arm's elbow and wrist go in a pose (two-bone IK, in 3D with depth), with the bones'
 * length factor for the pose. `body`: where the body carries a point (the shoulder goes with it).
 * `reachIt`: the arm grows to get to the hand's spot (a hand on a grip).
 */
function solvePose(arm: ArmRig, b: BuiltArm, pose: ArmPose, body: (p: Pt) => Pt, reachIt = false) {
  const shoulder = body(arm.shoulder);
  const bendSign = pose.flip ? -b.bend : b.bend;
  // The bones in this pose: longer by `length`, or (`reachIt`) long enough to get there with the
  // elbow still a little bent.
  let k = pose.length ?? 1;
  if (reachIt) k = Math.max(k, dist(shoulder, pose.hand) / ((b.upperLen + b.foreLen) * 0.9));
  const upperLen = b.upperLen * k;
  const foreLen = b.foreLen * k;
  let elbow: Pt;
  let wrist: Pt;
  let depth: Posed['depth'];
  if (pose.depth) {
    // In 3D: the elbow bends to the same side as on screen (square to the reach, in the screen's
    // plane), then everything is seen as the battle sees it.
    const hx = pose.hand[0] - shoulder[0], hy = pose.hand[1] - shoulder[1];
    const hl = Math.hypot(hx, hy) || 1;
    depth = solveArm3([shoulder[0], shoulder[1], 0], upperLen, foreLen, [pose.hand[0], pose.hand[1], pose.depth], [(-hy / hl) * bendSign, (hx / hl) * bendSign, 0]);
    elbow = project(depth.elbow);
    wrist = project(depth.wrist);
  } else ({ elbow, wrist } = solveArm(shoulder, upperLen, foreLen, pose.hand, bendSign));
  return { shoulder, elbow, wrist, depth, k };
}

/**
 * One arm in a pose: its layers (and a sleeve to go under the body), where its joints went, its
 * hand, the weapon in it, that weapon's angle and where the hand holds it. `body`: where the body
 * carries a point (the shoulder goes with it). `reachIt`: the arm grows to get to the hand's spot
 * (a hand on a grip).
 */
function poseArm(arm: ArmRig, b: BuiltArm, pose: ArmPose, pal: string[], body: (p: Pt) => Pt, reachIt = false) {
  const { shoulder: restShoulder, elbow: restElbow, wrist: restWrist } = arm;
  const { shoulder, elbow, wrist, depth, k } = solvePose(arm, b, pose, body, reachIt);
  const turnUpper = angleOf(shoulder, elbow) - angleOf(restShoulder, restElbow);
  const turnFore = angleOf(elbow, wrist) - angleOf(restElbow, restWrist);
  // A bone's pixels turned at its joint, then carried to where that joint is now.
  const place = (l: Layer, turn: number, from: Pt, to: Pt) => moved(rotSprite(l, turn, from[0], from[1]), Math.round(to[0] - from[0]), Math.round(to[1] - from[1]));
  // A drawn sleeve, narrowing with depth from `za` at its start to `zc` at its end.
  const sw = arm.shoulderWidth ?? arm.width;
  const sleeve = (a: Pt, c: Pt, za = 0, zc = 0) => band(a, c, sw * sizeAt(za), b.lit, b.shade, true, arm.width * sizeAt(zc));
  const fw = arm.foreWidth ?? arm.width;
  const foreSleeve = (a: Pt, c: Pt, za = 0, zc = 0) => band(a, c, fw * sizeAt(za), b.foreLit, b.foreShade, true, fw * sizeAt(zc));
  // The dark edges (`outline`), all under every fill, so they show only round the arm's outside.
  const edges: Layer[] = [];
  const dark = nearest(pal, '#120e1d');
  const edge = (a: Pt, c: Pt, w1: number, w2: number) => {
    if (arm.outline) edges.push(band(a, c, w1 + 2, dark, dark, false, w2 + 2));
  };
  const ez = depth?.elbow[2] ?? 0;
  const wz = depth?.wrist[2] ?? 0;
  const layers: Layer[] = [];
  const cap = () => {
    const a = Math.atan2(elbow[1] - shoulder[1], elbow[0] - shoulder[0]);
    return band(shoulder, [shoulder[0] + Math.cos(a) * 4, shoulder[1] + Math.sin(a) * 4], Math.max(arm.width, sw) + 2, b.capLit, b.capShade, true);
  };
  // The upper arm: its own traced pixels turned, or (past `drawnFrom` degrees, or with none of
  // its own) a sleeve drawn clean. The shoulder cap, a stub of sleeve under the joint, closes the
  // seam where the jacket meets a turned arm (Mark, 2026-10-01, on Kit); a barely turned arm has
  // no seam to close, and a cap there only bulges over the shoulder.
  const small = (deg: number) => Math.abs(((deg + 540) % 360) - 180) <= (arm.drawnFrom ?? 360);
  // (A lengthened arm is drawn too: its traced pixels are their own length and would come apart.)
  const traced = b.hasUpper && small(turnUpper) && !pose.depth && k === 1;
  if (traced) {
    if (!arm.drawnFrom) layers.push(cap());
    layers.push(place(b.parts.upper, turnUpper, restShoulder, shoulder));
  } else if (b.hasUpper || arm.clear) {
    layers.push(cap(), sleeve(shoulder, elbow, 0, ez));
    edge(shoulder, elbow, sw * sizeAt(0), arm.width * sizeAt(ez));
  }
  // The forearm's sleeve under its own pixels: it covers the joint as the bones turn (not needed
  // while the traced arm barely turns: its own pixels are all there).
  // It stops a sleeve's half-width short of the wrist, so its round end stays inside the hand
  // instead of showing past the fist.
  if (!(traced && arm.drawnFrom && small(turnFore))) {
    const fl = Math.hypot(wrist[0] - elbow[0], wrist[1] - elbow[1]) || 1;
    const f = Math.max(0, 1 - fw / 2 / fl);
    const end: Pt = [elbow[0] + (wrist[0] - elbow[0]) * f, elbow[1] + (wrist[1] - elbow[1]) * f];
    layers.push(foreSleeve(elbow, end, ez, ez + (wz - ez) * f));
    edge(elbow, end, fw * sizeAt(ez), fw * sizeAt(ez + (wz - ez) * f));
  }
  // The forearm's own pixels are its full length: skip them when it's foreshortened (reaching into
  // the screen), and let the drawn sleeve show it. On a lengthened arm they're scaled to its length
  // (Rook's chrome forearm keeps its plating raised overhead; Mark, 2026-10-01).
  if (b.hasFore && dist(elbow, wrist) > b.foreLen * k * 0.85)
    layers.push(moved(rotSprite(b.parts.fore, turnFore, restElbow[0], restElbow[1], k), Math.round(elbow[0] - restElbow[0]), Math.round(elbow[1] - restElbow[1])));
  // The hand: the drawn fist (or open hand) on a big move, turned to point along the forearm;
  // else its own traced pixels.
  const drawnHand = pose.shape === 'open' ? (b.open ?? b.fist) : b.fist;
  const handTurn = turnFore + (pose.grip ?? 0);
  const drawn = drawnHand && !(traced && small(turnFore)) ? drawnHand : null;
  const size = sizeAt(depth?.wrist[2] ?? 0);
  const hand = drawn
    ? moved(rotSprite(drawn, angleOf(elbow, wrist) + 90 + (pose.grip ?? 0), 0, 0, size), Math.round(wrist[0]), Math.round(wrist[1]))
    : place(b.parts.hand, handTurn, restWrist, wrist);
  const aim = angleOf(elbow, wrist) + (pose.grip ?? 0) + (pose.weapon?.angle ?? 0);
  // A sword runs through the middle of a drawn fist, so the fists always cover the same length of
  // its grip; a pistol (Hex) sits at the wrist, as it always has.
  const hold = drawn && pose.weapon?.kind === 'katana' ? along(wrist, angleOf(elbow, wrist) + (pose.grip ?? 0), handMiddle(drawn) * size) : wrist;
  const w = pose.weapon ? weapon({ ...pose.weapon, angle: aim }, hold, pal) : null;
  // The fists wrap a sword's grip, over it; a pistol is held in front of the hand.
  if (w && pose.weapon?.kind === 'katana') layers.push(...w.layers, hand);
  else {
    layers.push(hand);
    if (w) layers.push(...w.layers);
  }
  // An upper arm with no pixels of its own (under hair or a coat) is a sleeve behind the body.
  const under = b.hasUpper || arm.clear ? [] : [sleeve(shoulder, elbow)];
  return { layers: [...edges, ...layers], under, shoulder, elbow, wrist, hand, w, aim, hold, depth };
}

/** A crew member in a pose (null pose: standing) or null without a traced frame and skeleton. `rig`: the editor's, unsaved. */
export function poseFrame(id: string, pose: ArmPose | null, rig = SKELETONS[id]): Posed | null {
  if (!rig) return null;
  // Built once per skeleton (the editor's unsaved ones keyed by their joints).
  const key = rig === SKELETONS[id] ? id : `${id}|${JSON.stringify([rig.arm, rig.free?.arm ?? null, rig.hide ?? null])}`;
  let b = built.get(key);
  if (b === undefined) {
    b = build(id, rig);
    // One unsaved skeleton kept per crew member: dragging a joint makes a new one every move, and
    // keeping them all would grow without end (Copilot review of main, 2026-10-02).
    if (key !== id) for (const k of built.keys()) if (k.startsWith(`${id}|`)) built.delete(k);
    built.set(key, b);
  }
  if (!b) return null;
  if (!pose) {
    const { shoulder, elbow, wrist } = rig.arm;
    return { frame: renderLayers([b.base], b.t.pal, SIZE, SIZE), shoulder, elbow, wrist, tip: wrist };
  }
  // The body's sink and lean carry the shoulders; the free arm's go with it even in its own pose.
  const carry = bodyMove(rig.stance, pose).to;
  const main = poseArm(rig.arm, b.arm, pose, b.t.pal, carry);
  // Both hands on the weapon: the free hand on its grip, a fist's width behind the weapon hand;
  // else the free arm's own pose. Its wrist goes short of the grip by its fist's middle, along its
  // forearm (found by solving once), so the fist itself is on the grip.
  const grip = pose.both && main.w ? along(main.hold, main.aim, -GRIP) : null;
  let fp: ArmPose | undefined = grip ? { hand: grip, ...(pose.freeFlip ? { flip: true } : {}), ...(pose.freeBehind ? { behind: true } : {}) } : rig.free?.pose;
  if (grip && fp && rig.free && b.free?.fist) {
    const first = solvePose(rig.free.arm, b.free, fp, carry, true);
    fp = { ...fp, hand: along(grip, angleOf(first.elbow, first.wrist), -handMiddle(b.free.fist)) };
  }
  const free = rig.free && b.free && fp ? poseArm(rig.free.arm, b.free, fp, b.t.pal, carry, !!grip) : null;
  const body = stand(main.w ? b.armed : b.body, rig.stance, pose);
  // Each arm in front of the body, or (`behind`) behind it; a free hand on the grip goes over the
  // weapon (it holds it), a free arm out for balance under the weapon arm.
  const freeBack = free && fp?.behind ? free.layers : [];
  const freeFront = free && !fp?.behind ? free.layers : [];
  const mainBack = pose.behind ? main.layers : [];
  const mainFront = pose.behind ? [] : main.layers;
  const back = [...mainBack, ...freeBack];
  const front = grip ? [...mainFront, ...freeFront] : [...freeFront, ...mainFront];
  const layers = [...main.under, ...(free?.under ?? []), ...back, ...body, ...front];
  const tip = main.w ? main.w.tip : pose.lightAt === 'top' ? topOf(main.hand) : farEnd(main.hand, main.wrist);
  return {
    frame: renderLayers(layers, b.t.pal, SIZE, SIZE),
    shoulder: main.shoulder,
    elbow: main.elbow,
    wrist: main.wrist,
    tip,
    ...(main.depth ? { depth: main.depth } : {}),
    ...(free ? { free: { shoulder: free.shoulder, elbow: free.elbow, wrist: free.wrist } } : {}),
  };
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
  const windup = posed('windup');
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
    // The swing's raise beat: the Raised pose where there is one.
    attack: frame(windup ?? strike),
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
  // The strike's arc comes from where the Raised pose (or else Ready) left the blade.
  const strikeLight = strike ? poseGlow(rig, strike.p, strike.f, windup?.f ?? from) : undefined;
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
  return { frames, glow, headH, res: 2, ...(windup ? { windup: true } : {}) };
}
