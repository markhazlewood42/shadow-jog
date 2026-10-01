/**
 * Battle backs by rig v2: a crew member seen from behind, built in code from one traced frame
 * (their fighting stance), Phantasy Star IV style: a few key poses, held, with the battle's own
 * motion (lunge, smear, shake) and drawn light (sparks, an impact, a swept arc) selling the move.
 *
 * Each pose moves only what it must. The striking hand is picked out by colour (wraps and skin, so
 * hair and jacket stay whole), lifted to where the pose wants it, and a forearm is drawn in code
 * from the elbow to it. A hit tips the whole stance back (RotSprite). The rest of the character
 * is the traced frame, identical in every pose. Poses are directed per character below (Mark,
 * 2026-09-30: Kit's strike starts in her stance and ends fist out in it).
 */
import type { Battler, Pose } from '../battlers';
import { type Layer, byColour, cut, darker, decode, renderLayers, rotSprite } from './rig';
import { BATTLE_TRACED } from './traced-battle';

/** The canvas battle backs are drawn on (art pixels; the battle shows them at twice its resolution). */
const SIZE = 128;

type Pt = readonly [number, number];
/**
 * A crew member's poses, in the 128x128 canvas's coordinates. `hand`: the box the striking hand
 * sits in at rest (only its hand colours move). `elbow`: where its forearm starts. `strike` and
 * `raise`: where the hand goes. `light`: their colour for drawn light.
 */
interface PoseSpec {
  hand: readonly [number, number, number, number];
  /** The forearm's skin colour (the nearest in the palette is used, with its shade). */
  skin: string;
  /** Points that are surely hair, jacket or anything else that isn't the hand (their colours stay). */
  notHand: readonly Pt[];
  elbow: Pt;
  /** The fist pulled back (wind-up), thrown (strike), raised overhead (cast, item, victory). */
  brace: Pt;
  strike: Pt;
  raise: Pt;
  light: string;
}

const SPECS: Record<string, PoseSpec> = {
  // Kit: guard up, left foot leading; she throws the right (rear) hand, up past her head toward
  // the enemy, from her stance.
  kit: {
    hand: [74, 37, 87, 57],
    skin: '#bf725a',
    notHand: [[60, 20], [66, 30], [72, 44], [62, 60], [70, 62], [56, 58], [64, 80], [66, 50]],
    elbow: [84, 61],
    brace: [83, 50],
    strike: [89, 33],
    raise: [89, 4],
    light: '#ffa24a',
  },
};

/** Palette index of a colour (exact), or -1. */
function indexAt(l: Layer, x: number, y: number): number {
  const lx = x - l.ox;
  const ly = y - l.oy;
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

/** The layer shifted by (dx, dy). */
const moved = (l: Layer, dx: number, dy: number): Layer => ({ ...l, ox: l.ox + dx, oy: l.oy + dy });

/**
 * A forearm drawn in code from `a` to `b`: a round-ended band `width` wide, lit on the side facing
 * the top left and shaded on the other, in the hand's own skin colours.
 */
function limb(a: Pt, b: Pt, width: number, lit: number, shade: number): Layer {
  const x0 = Math.floor(Math.min(a[0], b[0]) - width);
  const y0 = Math.floor(Math.min(a[1], b[1]) - width);
  const w = Math.ceil(Math.abs(a[0] - b[0]) + 2 * width) + 1;
  const h = Math.ceil(Math.abs(a[1] - b[1]) + 2 * width) + 1;
  const px = new Int16Array(w * h).fill(-1);
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy || 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const qx = x0 + x + 0.5 - a[0];
      const qy = y0 + y + 0.5 - a[1];
      const t = Math.max(0, Math.min(1, (qx * vx + qy * vy) / len2));
      const dx = qx - t * vx;
      const dy = qy - t * vy;
      if (dx * dx + dy * dy > (width / 2) ** 2) continue;
      // Which side of the arm: toward the light (top left) or away.
      const side = vx * qy - vy * qx;
      const towardLight = (side > 0) === vy < 0 || (vy === 0 && qy < 0);
      px[y * w + x] = towardLight ? lit : shade;
    }
  return { w, h, ox: x0, oy: y0, px };
}

/** A canvas of the drawn light a pose throws: a spark in a raised hand, or an impact and its arc. */
function poseLight(hand: Pt, from: Pt, kind: 'raise' | 'strike', tint: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const g = c.getContext('2d');
  if (!g) return c;
  const [x, y] = hand;
  const dot = (px: number, py: number, color: string) => {
    g.fillStyle = color;
    g.fillRect(Math.round(px), Math.round(py), 1, 1);
  };
  const rays = (cx: number, cy: number, r0: number, r1: number, color: string) => {
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2 + Math.PI / 8;
      for (let r = r0; r <= r1; r++) dot(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, color);
    }
  };
  const halo = g.createRadialGradient(x, y, 0, x, y, kind === 'raise' ? 12 : 10);
  halo.addColorStop(0, tint);
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo;
  g.fillRect(x - 13, y - 13, 26, 26);
  if (kind === 'raise') {
    rays(x, y - 3, 3, 6, '#ffffff');
    dot(x, y - 3, '#ffffff');
  } else {
    rays(x + 1, y - 1, 3, 8, '#ffffff');
    // The arc the fist swept, from where it started.
    for (let t = 0; t <= 1; t += 0.03) {
      const ax = from[0] + (x - from[0]) * t + Math.sin(t * Math.PI) * 7;
      const ay = from[1] + (y - from[1]) * t - Math.sin(t * Math.PI) * 3;
      dot(ax, ay, t > 0.45 ? '#ffffff' : tint);
    }
  }
  return c;
}

/** The crew member's battle back from their traced stance, or null if they haven't one yet. */
export function rigBattler(id: string): Battler | null {
  const t = BATTLE_TRACED[id];
  const spec = SPECS[id];
  if (!t || !spec) return null;
  const base = { ...decode(t), ox: t.ox, oy: t.oy };
  // The hand's colours: everything in its box that isn't one of the sure-not-hand colours.
  const notHand = new Set(spec.notHand.map(([x, y]) => indexAt(base, x, y)).filter((i) => i >= 0));
  const [hx0, hy0, hx1, hy1] = spec.hand;
  const box = cut(base, hx0, hy0, hx1, hy1);
  const handCols = new Set<number>();
  for (const p of box.px) if (p >= 0 && !notHand.has(p)) handCols.add(p);
  const hand = byColour(box, handCols, true);
  // The body without that hand (only inside its box).
  const body: Layer = { ...base, px: base.px.slice() };
  for (let y = hy0; y < hy1; y++)
    for (let x = hx0; x < hx1; x++) {
      const i = (y - body.oy) * body.w + (x - body.ox);
      if (x >= body.ox && y >= body.oy && x < body.ox + body.w && y < body.oy + body.h && handCols.has(body.px[i] ?? -1)) body.px[i] = -1;
    }
  // Bits of the hand left behind (dark knuckle lines share the hair's darkest colour): specks in
  // the hand's box with fewer than two neighbours go, twice over.
  for (let pass = 0; pass < 2; pass++)
    for (let y = hy0; y < hy1; y++)
      for (let x = hx0; x < hx1; x++) {
        if (indexAt(body, x, y) < 0) continue;
        const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx = 0, dy = 0]) => indexAt(body, x + dx, y + dy) >= 0).length;
        if (n < 2) body.px[(y - body.oy) * body.w + (x - body.ox)] = -1;
      }
  // Skin for the drawn forearm: the palette's nearest to the spec's colour, and its shade.
  const skin = nearest(t.pal, spec.skin);
  const skinDark = darker({ w: 1, h: 1, ox: 0, oy: 0, px: Int16Array.of(skin) }, t.pal).px[0] ?? skin;
  // The hand's own centre (where it is at rest), to move it by.
  const rest: Pt = [(hx0 + hx1) / 2, (hy0 + hy1) / 2];
  const handAt = (to: Pt): Layer => moved(hand, Math.round(to[0] - rest[0]), Math.round(to[1] - rest[1]));
  const reach = (to: Pt): Layer[] => [body, limb(spec.elbow, to, 5, skin, skinDark), handAt(to)];
  const draw = (layers: Layer[]) => renderLayers(layers, t.pal, SIZE, SIZE);

  const stance = draw([body, hand]);
  const wind = draw(reach(spec.brace));
  const strike = draw(reach(spec.strike));
  const raise = draw(reach(spec.raise));
  // A hit: the stance tipped back about the feet, a few degrees, and sunk a little.
  const feetMid: Pt = [t.ox + t.w / 2, t.oy + t.feet];
  const hurt = draw([moved(rotSprite({ ...base }, -6, feetMid[0], feetMid[1]), 0, 2)]);

  const frames: Record<Pose, HTMLCanvasElement> = {
    idle: stance,
    brace: wind,
    attack: strike,
    strike,
    thrust: strike,
    cast: raise,
    item: raise,
    aim: raise,
    victory: raise,
    hurt,
  };
  const glow: Partial<Record<Pose, HTMLCanvasElement>> = {
    strike: poseLight(spec.strike, spec.brace, 'strike', spec.light),
    thrust: poseLight(spec.strike, spec.brace, 'strike', spec.light),
    cast: poseLight(spec.raise, spec.elbow, 'raise', spec.light),
    aim: poseLight(spec.raise, spec.elbow, 'raise', spec.light),
  };
  // Head height in battle pixels (the art is at twice the battle's resolution).
  const headH = Math.ceil((t.feet - (t.rows.findIndex((r) => /[^.]/.test(r)) ?? 0)) / 2);
  return { frames, glow, headH, res: 2 };
}
