/**
 * Party battle sprites: the character rig seen from behind, at the same 2x pixel scale as the
 * humanoid enemies, with action poses built by editing the rig's letter grid (arms raised,
 * braced) plus hand-drawn weapons in front of or behind the body.
 */
import type { KataKey } from './rig2/sidekata';
import type { SfKey } from './rig2/sfstrike';
import type { PunchKey } from './rig2/sfpunch';
import { backGrid, paint, type CharLook } from './chars';
import { rigBattler } from './rig2/battle';
import { Pix, scale2x } from './pix';
import { surface } from '../engine/canvas';

/**
 * 'attack' is the weapon raised to strike; 'strike' is the follow-through a beat later (the blade swept
 * down across the body, the fist punched out to full reach, the pistol kicking), so a swing reads
 * as an arc, not a pose that moves.
 */
export type Pose = 'idle' | 'attack' | 'strike' | 'cast' | 'item' | 'hurt' | 'victory' | 'thrust' | 'brace' | 'aim';
export const POSES: Pose[] = ['idle', 'attack', 'strike', 'cast', 'item', 'hurt', 'victory', 'thrust', 'brace', 'aim'];

export interface Battler {
  frames: Record<Pose, HTMLCanvasElement>;
  /** Additive light (ki flare, muzzle flash, spirit fire) for poses that emit it. */
  glow: Partial<Record<Pose, HTMLCanvasElement>>;
  /** Height from the frame's bottom edge to the top of the head, in battle pixels. */
  headH: number;
  /** Art pixels per battle pixel (1, or 2 for drawn art at the field's pixel size). */
  res?: number | undefined;
  /**
   * The attack frame is a wind-up of its own (rig v2's Raised pose: Rook's sword drawn back over his
   * head), shown from halfway through a swing's gather, not just its brief raise beat.
   */
  windup?: boolean | undefined;
  /**
   * Side-view battle (spike `?battle=side`): looping frames for standing and walking. The idle
   * loop plays in place of the rest frame (in `idleOrder`), the walk while the member steps in. `idleStep` and `walkStep` (render frames per
   * frame of the loop) override the side view's defaults: Sprite Fusion's idles run at 8 fps, 7.5 render frames a frame.
   */
  cycle?: { idle: HTMLCanvasElement[]; idleOrder: readonly number[]; walk: HTMLCanvasElement[]; idleStep?: number; walkStep?: number; settle?: HTMLCanvasElement[]; walkGhosts?: number } | undefined;
  /** Side-view battle, Rook only: his kendo strike, one frame per key of `rig2/sidekata.ts`, each on its own (wider) canvas centred on the body. */
  kata?: Record<KataKey, HTMLCanvasElement> | undefined;
  /** Side-view battle, Sprite Fusion art, Rook only: his strike built from Mark's frames (`rig2/sfstrike.ts`), one canvas per key, all the same size, the slot's axis at the centre column and the soles on the bottom row. */
  sfStrike?: { frames: Record<SfKey, HTMLCanvasElement> } | undefined;
  /** Side-view battle, Sprite Fusion art, Kit only: her punch combo built from Mark's frames (`rig2/sfpunch.ts`), one canvas per key, same size and axis rules as `sfStrike`. */
  sfPunch?: { frames: Record<PunchKey, HTMLCanvasElement> } | undefined;
  /** The same frames without the smear arc, for the speed ghosts. */
  kataPlain?: Record<KataKey, HTMLCanvasElement> | undefined;
}

type Weapon = 'fists' | 'katana' | 'pistol' | 'staff';
const WEAPON: Record<string, Weapon> = { kit: 'fists', rook: 'katana', hex: 'pistol', sable: 'staff' };
const TINT: Record<string, string> = { kit: '#ffa24a', rook: '#ffe07a', hex: '#3fe0f0', sable: '#ff7a3a' };

/** Extra grid columns each side so raised arms can angle outward. */
const GX = 3;
/** Room around the painted rig for weapons (rig pixels). */
const PAD_X = 3, PAD_TOP = 9;

function set(rows: string[], x: number, y: number, c: string): void {
  if (y < 0 || y >= rows.length || x < 0 || x >= rows[y]!.length) return;
  rows[y] = rows[y]!.slice(0, x) + c + rows[y]!.slice(x + 1);
}

interface Rig {
  shoulder: number;
  left: number;
  right: number;
  hand: number;
}

function rigOf(rows: string[]): Rig {
  const shoulder = rows.findIndex((r) => r.includes('k'));
  return { shoulder, left: rows[shoulder]!.indexOf('k'), right: rows[shoulder]!.lastIndexOf('j'), hand: rows.findIndex((r) => r.includes('o')) };
}

/**
 * Lift one arm: out from the shoulder for `spread` cells, then up, two cells thick so it reads at
 * battle scale. Returns the raised hand's inner grid cell.
 */
function raise(rows: string[], rig: Rig, side: 'left' | 'right', height: number, spread = 2): [number, number] {
  const dir = side === 'right' ? 1 : -1;
  const col = side === 'right' ? rig.right : rig.left;
  const [arm, dark, hand] = side === 'right' ? ['j', 'J', 'o'] : ['k', 'K', 'n'];
  for (let y = rig.shoulder; y <= rig.hand; y++) {
    const c = rows[y]![col];
    if (c === arm || c === dark || c === hand) set(rows, col, y, '.');
  }
  for (let i = 0; i < height; i++) {
    const x = col + dir * Math.min(i, spread);
    set(rows, x, rig.shoulder - i, arm);
    set(rows, x + dir, rig.shoulder - i, dark);
  }
  const x = col + dir * Math.min(height, spread), y = rig.shoulder - height;
  set(rows, x, y, hand);
  set(rows, x + dir, y, hand);
  return [side === 'right' ? x : x - 1, y];
}

/** Flinch: the head sinks a row into the shoulders. */
function hunch(rows: string[], rig: Rig): void {
  for (let y = rig.shoulder - 1; y > 0; y--) rows[y] = rows[y - 1]!;
  rows[0] = '.'.repeat(rows[0]!.length);
}

/** Grid cell → pixel in the padded, outlined canvas (rig pixels). */
const px = (x: number, y: number): [number, number] => [x + 1 + PAD_X, y + 1 + PAD_TOP];

function drawWeapon(p: Pix, w: Weapon, pose: Pose, hand: [number, number], rig: Rig, layer: 'back' | 'front'): void {
  const [hx, hy] = hand;
  if (w === 'katana') {
    if (pose === 'idle' || pose === 'hurt' || pose === 'cast' || pose === 'item') {
      // Sheathed across the back: handle over the right shoulder, tip at the left hip.
      if (layer !== 'back') return;
      const [sx, sy] = px(rig.right + 1, rig.shoulder - 3);
      const [ex, ey] = px(rig.left - 1, rig.hand + 1);
      p.line(sx, sy, ex, ey, '#2a2230', 2);
      p.line(sx, sy, sx - 2, sy + 2, '#b58a4a', 1);
      return;
    }
    if (layer !== 'front') return;
    if (pose === 'strike') {
      // The cut, finished: the blade swept down and out across the body, point low on the left.
      p.rect(hx - 1, hy, 3, 1, '#b58a4a');
      for (let i = 1; i <= 11; i++) {
        const x = hx - i, y = hy + Math.round(i * 0.45);
        p.set(x, y, i === 11 ? '#ffffff' : '#e8eef8');
        p.set(x, y + 1, '#8e9ab0');
      }
      return;
    }
    // Drawn blade held high, angled over the head.
    const len = pose === 'victory' ? 11 : 10;
    const dx = pose === 'victory' ? 0 : -1;
    p.rect(hx - 1, hy, 3, 1, '#b58a4a');
    for (let i = 1; i <= len; i++) {
      const x = hx + Math.round(dx * i * 0.55), y = hy - i;
      p.set(x, y, i === len ? '#ffffff' : '#e8eef8');
      p.set(x + 1, y, '#8e9ab0');
    }
    return;
  }
  if (w === 'staff') {
    const top = pose === 'idle' || pose === 'hurt' || pose === 'item' ? hy - 12 : hy - 10;
    const bottom = pose === 'idle' || pose === 'hurt' || pose === 'item' ? hy + 5 : hy + 4;
    if (layer !== 'front') return;
    for (let y = top + 2; y <= bottom; y++) p.set(hx + 1, y, y % 3 ? '#8a5a34' : '#6a4228');
    // Charm head: bone ring and a feather.
    p.rect(hx, top, 3, 2, '#e8e0cc');
    p.set(hx + 1, top + 1, '#2a2020');
    p.set(hx + 3, top + 2, '#d9b36c');
    p.set(hx + 3, top + 3, '#8c2f39');
    return;
  }
  if (w === 'pistol') {
    if (layer !== 'front' || (pose !== 'attack' && pose !== 'strike' && pose !== 'victory')) return;
    p.rect(hx, hy - 3, 2, 3, '#2a2c34');
    p.set(hx, hy - 3, '#5a5e6c');
    return;
  }
  // Fists: knuckle plates on a raised hand.
  if (layer === 'front' && (pose === 'attack' || pose === 'strike' || pose === 'victory')) {
    p.set(hx, hy, '#c8ccd8');
    p.set(hx + 1, hy, '#8a8e9c');
  }
}

function drawGlow(g: Pix, id: string, w: Weapon, pose: Pose, hand: [number, number], other: [number, number] | undefined, headTop: number): boolean {
  const tint = TINT[id] ?? '#ffe07a';
  const [hx, hy] = hand;
  if (pose === 'cast' && other) {
    // Energy gathered above the head, fed from both raised hands.
    const cx = Math.round((hx + other[0] + 1) / 2), cy = headTop - 4;
    g.ellipse(cx, cy, 3, 3, tint);
    g.set(cx, cy, '#ffffff');
    for (const [x, y] of [hand, other]) {
      g.set(x, y, tint);
      g.set(x + 1, y, tint);
      g.set(x + (x < cx ? 1 : 0), y - 1, tint);
    }
    return true;
  }
  if (pose === 'strike') {
    if (w === 'katana' && other) {
      // The cut's trail: an arc from where the blade was raised to where it finished.
      const [cx, cy] = other;
      for (let a = -1.75; a <= -0.1; a += 0.09) {
        const x = Math.round(cx + Math.cos(a + Math.PI) * 12), y = Math.round(cy + Math.sin(a + Math.PI) * -10);
        g.set(x, y, '#7a8aa8');
        g.set(x, y + 1, '#4a5670');
      }
      return true;
    }
    if (w === 'fists' || w === 'pistol') {
      // Full reach: a flare at the fist, or the muzzle's kick.
      const [fx, fy] = w === 'pistol' ? [hx, hy - 5] : [hx, hy - 1];
      g.ellipse(fx, fy, 3, 3, w === 'pistol' ? '#ffe07a' : tint);
      g.set(fx, fy, '#ffffff');
      return true;
    }
    if (w === 'staff') {
      g.ellipse(hx + 1, hy - 10, 3, 3, tint);
      return true;
    }
  }
  if (pose === 'attack') {
    if (w === 'fists') {
      g.ellipse(hx, hy - 1, 2, 2, tint);
      g.set(hx, hy - 1, '#ffffff');
      return true;
    }
    if (w === 'pistol') {
      g.ellipse(hx, hy - 5, 2, 2, '#ffe07a');
      g.set(hx, hy - 5, '#ffffff');
      return true;
    }
    if (w === 'staff') {
      g.ellipse(hx + 1, hy - 10, 2, 2, tint);
      return true;
    }
  }
  if (pose === 'thrust' && other) {
    for (const [x, y] of [hand, other]) {
      g.ellipse(x + 1, y - 1, 2, 2, tint);
      g.set(x + 1, y - 1, '#ffffff');
    }
    return true;
  }
  if (pose === 'aim') {
    g.ellipse(hx, hy - 5, 2, 2, '#ffe07a');
    g.set(hx, hy - 5, '#ffffff');
    return true;
  }
  if (pose === 'victory' && w === 'staff') {
    g.ellipse(hx + 1, hy - 10, 2, 2, tint);
    return true;
  }
  return false;
}

function pose(id: string, look: CharLook, which: Pose): { canvas: HTMLCanvasElement; glow?: HTMLCanvasElement | undefined } {
  const { rows: base, pal } = backGrid(look);
  const rows = base.map((r) => '.'.repeat(GX) + r + '.'.repeat(GX));
  const rig = rigOf(rows);
  const headTop = rows.findIndex((r) => /[^.]/.test(r));
  const weapon = WEAPON[id] ?? 'fists';
  let hand: [number, number] = [rig.right, rig.hand];
  let other: [number, number] | undefined;
  if (which === 'attack') hand = raise(rows, rig, 'right', weapon === 'pistol' ? 5 : 4);
  else if (which === 'strike') {
    // Follow-through: a blade arm comes down and across; a fist reaches to its full height.
    hand = weapon === 'katana' ? raise(rows, rig, 'right', 1, 3) : raise(rows, rig, 'right', weapon === 'pistol' ? 6 : 6, 0);
    // The cut's trail is centred on the shoulder it swings from.
    if (weapon === 'katana') other = [rig.right - 3, rig.shoulder + 1];
  }
  else if (which === 'victory') hand = raise(rows, rig, 'right', 6, 1);
  else if (which === 'item') hand = raise(rows, rig, 'right', 3);
  else if (which === 'cast') {
    hand = raise(rows, rig, 'right', 4);
    other = raise(rows, rig, 'left', 4);
  } else if (which === 'hurt') {
    hunch(rows, rig);
    hand = raise(rows, rig, 'right', 2, 1);
    raise(rows, rig, 'left', 2, 1);
  } else if (which === 'thrust') {
    // Both palms driven forward at chest height.
    hand = raise(rows, rig, 'right', 2, 2);
    other = raise(rows, rig, 'left', 2, 2);
  } else if (which === 'brace') {
    // Arms up close to the head: guarding, steeling, rallying.
    hand = raise(rows, rig, 'right', 3, 0);
    raise(rows, rig, 'left', 3, 0);
  } else if (which === 'aim') {
    hand = raise(rows, rig, 'right', 5, 2);
  }
  if (weapon === 'staff' && which !== 'attack' && which !== 'strike' && which !== 'cast' && which !== 'victory' && which !== 'thrust') hand = [rig.right, rig.hand];
  const body = paint(rows, pal);
  const w = body.width + PAD_X * 2, h = body.height + PAD_TOP;
  const handPx = px(hand[0], hand[1]);
  const back = new Pix(w, h);
  // Aiming always shows a sidearm, whatever the member usually carries.
  const shown: Weapon = which === 'aim' ? 'pistol' : weapon;
  const drawn: Pose = which === 'aim' ? 'attack' : which === 'thrust' || which === 'brace' ? 'idle' : which;
  // The member's own weapon stays where it rests (e.g. Rook's katana on his back) while they aim.
  drawWeapon(back, weapon, which === 'aim' ? 'idle' : drawn, handPx, rig, 'back');
  const front = new Pix(w, h);
  drawWeapon(front, shown, drawn, handPx, rig, 'front');
  if (which === 'item') {
    // A medkit in the raised hand.
    front.rect(handPx[0] - 1, handPx[1] - 3, 3, 3, '#e8ecef');
    front.set(handPx[0], handPx[1] - 2, '#5ad06a');
  }
  const s = surface(w, h);
  s.ctx.drawImage(back.outline().toCanvas(), 0, 0);
  s.ctx.drawImage(body, PAD_X, PAD_TOP);
  s.ctx.drawImage(front.outline().toCanvas(), 0, 0);
  const g = new Pix(w, h);
  const glows = drawGlow(g, id, weapon, which, handPx, other ? px(other[0], other[1]) : undefined, px(0, headTop)[1]);
  return { canvas: scale2x(s.canvas), glow: glows ? scale2x(g.toCanvas()) : undefined };
}

const cache = new Map<string, Battler>();

/**
 * Use drawn frames for this crew member from now on (dev tooling: art-pass options tried in the
 * game, src/dev/artswap.ts). Poses without a drawn frame keep the generated one, scaled up to match.
 */
export function replaceBattler(id: string, look: CharLook, frames: Partial<Record<Pose, HTMLCanvasElement>>, headH: number, res = 2, glow: Partial<Record<Pose, HTMLCanvasElement>> = {}): void {
  const base = battler(id, look);
  const up = (c: HTMLCanvasElement) => {
    const out = document.createElement('canvas');
    out.width = c.width * res;
    out.height = c.height * res;
    const g = out.getContext('2d');
    if (g) {
      g.imageSmoothingEnabled = false;
      g.drawImage(c, 0, 0, out.width, out.height);
    }
    return out;
  };
  const all = {} as Record<Pose, HTMLCanvasElement>;
  for (const p of POSES) all[p] = frames[p] ?? up(base.frames[p]);
  cache.set(id, { frames: all, glow, headH, res });
}

export function battler(id: string, look: CharLook): Battler {
  const hit = cache.get(id);
  if (hit) return hit;
  // Rig v2 (src/art/rig2/battle.ts): built in code from a traced stance, where there is one.
  const rigged = look.rig ? rigBattler(look.rig) : null;
  if (rigged) {
    cache.set(id, rigged);
    return rigged;
  }
  const frames = {} as Record<Pose, HTMLCanvasElement>;
  const glow: Partial<Record<Pose, HTMLCanvasElement>> = {};
  for (const p of POSES) {
    const r = pose(id, look, p);
    frames[p] = r.canvas;
    if (r.glow) glow[p] = r.glow;
  }
  const firstRow = backGrid(look).rows.findIndex((r) => /[^.]/.test(r));
  const headH = frames.idle.height - (PAD_TOP + 1 + firstRow) * 2;
  const b: Battler = { frames, glow, headH };
  cache.set(id, b);
  return b;
}
