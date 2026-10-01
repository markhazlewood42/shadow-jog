/**
 * Battle backs by rig v2: a crew member seen from behind, built in code from one traced frame,
 * Phantasy Star IV style: a few key poses, held, with the battle's own motion (lunge, smear, shake)
 * and drawn light (a spark, an impact, a swept arc, a muzzle flash) selling the move.
 *
 * Each pose moves only what it must. The moving part (a fist; a hand and its staff; a chrome
 * forearm) is picked out by colour inside its box, so hair, coat and jacket stay whole. It moves
 * (and may turn, by RotSprite) to where the pose wants it, a forearm is drawn in code from the
 * elbow to it, and a weapon the frame doesn't have (Rook's drawn katana, Hex's pistol) is drawn in
 * code in the hand. A hit tips the whole stance back. Everything else is the traced frame,
 * identical in every pose. Poses are directed per character in SPECS (Mark, 2026-09-30: Kit's
 * strike starts in her stance and ends fist out in it).
 */
import type { Battler, Pose } from '../battlers';
import { type Layer, byColour, cut, darker, decode, renderLayers, rotSprite } from './rig';
import { BATTLE_TRACED } from './traced-battle';

/** The canvas battle backs are drawn on (art pixels; the battle shows them at twice its resolution). */
const SIZE = 128;

type Pt = readonly [number, number];
type Box = readonly [number, number, number, number];

/** A weapon drawn in code in the hand: which, pointing which way (degrees, 0 = right, -90 = up). */
interface Weapon {
  kind: 'katana' | 'pistol';
  angle: number;
}

/** Where the moving part goes in a pose, and what comes with it. */
interface PoseDef {
  /** Where the part's anchor (the hand) goes. */
  at: Pt;
  /** Turn the part about the hand, in degrees (> 0 swings its far end clockwise). */
  turn?: number;
  /** Draw a forearm from the elbow to the hand. */
  limb?: boolean;
  weapon?: Weapon;
  /**
   * The light this pose throws, and where: at the hand; at the tip (a blade's point, a muzzle, the
   * far end of the part); or at the part's top (a staff's head).
   */
  light?: 'spark' | 'impact' | 'shot';
  lightAt?: 'hand' | 'tip' | 'top';
}

/**
 * A crew member's poses, in the 128x128 canvas's coordinates. `part`: the box the moving part sits
 * in at rest, `notPart`: points that are surely something else (their colours stay with the body),
 * `anchor`: the hand. `limb`: the forearm's colour. `hide`: what goes while a weapon is out.
 */
interface Spec {
  part: Box;
  notPart: readonly Pt[];
  anchor: Pt;
  elbow: Pt;
  limb: string;
  limbWidth: number;
  hide?: { box: Box; notPart: readonly Pt[] };
  light: string;
  brace: PoseDef;
  strike: PoseDef;
  raise: PoseDef;
  /** Which of the three a ranged aim uses (Hex aims her pistol). */
  aim?: 'strike' | 'raise';
}

const SPECS: Record<string, Spec> = {
  // Kit: guard up, left foot leading; the right (rear) hand is thrown up past her head toward the
  // enemy, from her stance.
  kit: {
    part: [74, 37, 87, 57],
    notPart: [[60, 20], [66, 30], [72, 44], [62, 60], [70, 62], [56, 58], [64, 80], [66, 50]],
    anchor: [80.5, 47],
    elbow: [84, 61],
    limb: '#bf725a',
    limbWidth: 5,
    light: '#ffa24a',
    brace: { at: [83, 50], limb: true },
    strike: { at: [89, 33], limb: true, light: 'impact', lightAt: 'hand' },
    raise: { at: [89, 4], limb: true, light: 'spark', lightAt: 'hand' },
  },
  // Rook: the chrome right arm draws the katana from his back (the hilt there goes while it's out),
  // holds it ready, and cuts across overhead.
  rook: {
    part: [77, 54, 93, 82],
    notPart: [[70, 60], [72, 76], [64, 50], [60, 84], [74, 88]],
    anchor: [85, 75],
    elbow: [84, 55],
    limb: '#9a9aa8',
    limbWidth: 6,
    hide: { box: [30, 20, 48, 46], notPart: [[52, 46], [58, 40], [48, 52], [46, 60]] },
    light: '#ffe07a',
    brace: { at: [93, 60], limb: true, weapon: { kind: 'katana', angle: -70 } },
    strike: { at: [97, 30], limb: true, weapon: { kind: 'katana', angle: -150 }, light: 'impact', lightAt: 'tip' },
    raise: { at: [92, 38], limb: true, weapon: { kind: 'katana', angle: -95 }, light: 'spark', lightAt: 'tip' },
  },
  // Hex: the right hand draws a pistol and aims it at the enemy; a program goes up from a raised
  // hand.
  hex: {
    part: [81, 74, 96, 88],
    notPart: [[80, 70], [86, 66], [74, 80], [78, 86]],
    anchor: [88, 81],
    elbow: [88, 66],
    limb: '#7a3aa8',
    limbWidth: 6,
    light: '#3fe0f0',
    brace: { at: [92, 70], limb: true, weapon: { kind: 'pistol', angle: -100 } },
    strike: { at: [92, 42], limb: true, weapon: { kind: 'pistol', angle: -80 }, light: 'shot', lightAt: 'tip' },
    raise: { at: [90, 16], limb: true, light: 'spark', lightAt: 'hand' },
    aim: 'strike',
  },
  // Sable: the staff, in the left hand, is lifted to call fire, and swung at the enemy.
  sable: {
    part: [18, 4, 49, 114],
    notPart: [[52, 70], [56, 60], [60, 90], [50, 100]],
    anchor: [41, 61],
    elbow: [48, 58],
    limb: '#8a9a6a',
    limbWidth: 6,
    light: '#ff7a3a',
    brace: { at: [39, 66], turn: -10 },
    strike: { at: [46, 50], turn: 38, limb: true, light: 'impact', lightAt: 'tip' },
    raise: { at: [43, 54], turn: 6, limb: true, light: 'spark', lightAt: 'top' },
  },
};

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

/** A band from `a` to `b`, `width` wide with round ends, lit on the side facing the top left. */
function band(a: Pt, b: Pt, width: number, lit: number, shade: number): Layer {
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
      if (dx * dx + dy * dy > (width / 2) ** 2) continue;
      px[y * w + x] = dx * nx + dy * ny > 0 ? lit : shade;
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
function poseLight(at: Pt, from: Pt, kind: 'spark' | 'impact' | 'shot', tint: string): HTMLCanvasElement {
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
    // The arc it swept, from where it started.
    for (let t = 0; t <= 1; t += 0.02) {
      const ax = from[0] + (x - from[0]) * t + Math.sin(t * Math.PI) * 8;
      const ay = from[1] + (y - from[1]) * t - Math.sin(t * Math.PI) * 6;
      dot(ax, ay, t > 0.4 ? '#ffffff' : tint);
    }
  }
  return c;
}

/** The crew member's battle back from their traced frame, or null if they haven't one yet. */
export function rigBattler(id: string): Battler | null {
  const t = BATTLE_TRACED[id];
  const spec = SPECS[id];
  if (!t || !spec) return null;
  const base = { ...decode(t), ox: t.ox, oy: t.oy };
  const { part, rest: body } = pick(base, spec.part, spec.notPart);
  // While a weapon is out, what it replaces (Rook's hilt on his back) goes too.
  const armed = spec.hide ? pick(body, spec.hide.box, spec.hide.notPart).rest : body;
  const limbLit = nearest(t.pal, spec.limb);
  const limbShade = darker({ w: 1, h: 1, ox: 0, oy: 0, px: Int16Array.of(limbLit) }, t.pal).px[0] ?? limbLit;
  const draw = (layers: Layer[]) => renderLayers(layers, t.pal, SIZE, SIZE);

  /** One pose: its frame, and where its hand and tip ended up (for the light). */
  const pose = (d: PoseDef) => {
    let p = moved(part, Math.round(d.at[0] - spec.anchor[0]), Math.round(d.at[1] - spec.anchor[1]));
    if (d.turn) p = rotSprite(p, d.turn, d.at[0], d.at[1]);
    const w = d.weapon ? weapon(d.weapon, d.at, t.pal) : null;
    const layers: Layer[] = [w ? armed : body];
    if (d.limb) layers.push(band(spec.elbow, d.at, spec.limbWidth, limbLit, limbShade));
    layers.push(p);
    if (w) layers.push(...w.layers);
    const tip = w ? w.tip : d.lightAt === 'top' ? topOf(p) : farEnd(p, d.at);
    return { frame: draw(layers), tip, hand: d.at };
  };
  const brace = pose(spec.brace);
  const strike = pose(spec.strike);
  const raise = pose(spec.raise);
  const stance = draw([body, part]);
  // A hit: the stance tipped back about the feet, a few degrees, and sunk a little.
  const hurt = draw([moved(rotSprite(base, -6, t.ox + t.w / 2, t.oy + t.feet), 0, 2)]);
  const aim = spec.aim === 'strike' ? strike : raise;

  const frames: Record<Pose, HTMLCanvasElement> = {
    idle: stance,
    brace: brace.frame,
    attack: strike.frame,
    strike: strike.frame,
    thrust: strike.frame,
    cast: raise.frame,
    item: raise.frame,
    aim: aim.frame,
    victory: raise.frame,
    hurt,
  };
  const lightOf = (d: PoseDef, at: { tip: Pt; hand: Pt }, from: { tip: Pt; hand: Pt }) =>
    d.light ? poseLight(d.lightAt === 'hand' || !d.lightAt ? at.hand : at.tip, d.lightAt === 'hand' || !d.lightAt ? from.hand : from.tip, d.light, spec.light) : undefined;
  const glow: Partial<Record<Pose, HTMLCanvasElement>> = {};
  const strikeLight = lightOf(spec.strike, strike, brace);
  const raiseLight = lightOf(spec.raise, raise, brace);
  if (strikeLight) {
    glow.strike = strikeLight;
    glow.thrust = strikeLight;
  }
  if (raiseLight) glow.cast = raiseLight;
  const aimLight = spec.aim === 'strike' ? strikeLight : raiseLight;
  if (aimLight) glow.aim = aimLight;
  // Head height in battle pixels (the art is at twice the battle's resolution).
  const top = t.rows.findIndex((r) => /[^.]/.test(r));
  const headH = Math.ceil((t.feet - Math.max(0, top)) / 2);
  return { frames, glow, headH, res: 2 };
}
