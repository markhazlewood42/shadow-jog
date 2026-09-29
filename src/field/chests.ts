/**
 * Loot container sprites (closed / open), plus the closed one's emissive layer: its trim band and
 * lock light, drawn unlit over the scene's darkness so a chest can be spotted from across a room.
 * Made more prominent after Mark's first playthrough (2026-09-29: "chests… blend into the
 * background"): brighter bodies, a lit trim, and (in the field) a slow pulse and the odd glint.
 */
import { surface } from '../engine/canvas';

type Kind = 'crate' | 'locker' | 'case';
export interface ChestArt {
  closed: HTMLCanvasElement;
  open: HTMLCanvasElement;
  /** The closed chest's lit parts only (trim band, lock light), drawn unlit. */
  glow: HTMLCanvasElement;
  /** The trim's colour, for the halo under it. */
  trim: string;
}
const cache = new Map<Kind, ChestArt>();

const LOOK: Record<Kind, { body: string; lid: string; hi: string; trim: string }> = {
  // A supply crate: hazard-yellow bands on steel.
  crate: { body: '#5a6478', lid: '#6a7488', hi: '#9aa4b8', trim: '#ffcc3d' },
  // A maintenance locker: teal enamel.
  locker: { body: '#3e6a74', lid: '#4a7c86', hi: '#8ac4cc', trim: '#3fe0f0' },
  // A hard case: black with a magenta seal.
  case: { body: '#34364a', lid: '#42445a', hi: '#7a7c98', trim: '#ff4fb0' },
};

export function chestSprites(kind: Kind): ChestArt {
  let c = cache.get(kind);
  if (c) return c;
  const L = LOOK[kind];
  const make = (open: boolean, glowOnly: boolean) => {
    const s = surface(16, 16);
    const g = s.ctx;
    const r = (x: number, y: number, w: number, h: number, col: string) => {
      g.fillStyle = col;
      g.fillRect(x, y, w, h);
    };
    if (glowOnly) {
      // Only what shines: the trim band across the front and the lock light.
      r(3, 12, 10, 1, L.trim);
      r(7, 9, 2, 2, L.trim);
      r(7, 9, 1, 1, '#ffffff');
      return s.canvas;
    }
    r(1, 5, 14, 11, '#0f0e17');
    r(2, 8, 12, 7, L.body);
    r(2, 8, 12, 1, L.hi);
    r(2, 14, 12, 1, '#1a1c26');
    if (open) {
      r(1, 1, 14, 5, '#0f0e17');
      r(2, 6, 12, 2, '#12101a');
      r(2, 2, 12, 3, L.lid);
      r(2, 2, 12, 1, L.hi);
      // Opened: the trim goes dark, so the ones you've looted fade back.
      r(3, 12, 10, 1, '#2a2c38');
    } else {
      r(2, 6, 12, 2, L.lid);
      r(2, 6, 12, 1, L.hi);
      if (kind === 'crate') for (let x = 2; x < 14; x += 4) r(x, 6, 2, 2, L.trim);
      r(6, 8, 4, 4, '#14141c');
      r(7, 9, 2, 2, L.trim);
      r(7, 9, 1, 1, '#ffffff');
      r(3, 12, 10, 1, L.trim);
    }
    // Corner rivets.
    r(2, 9, 1, 1, L.hi);
    r(13, 9, 1, 1, L.hi);
    return s.canvas;
  };
  c = { closed: make(false, false), open: make(true, false), glow: make(false, true), trim: L.trim };
  cache.set(kind, c);
  return c;
}

const halos = new Map<string, HTMLCanvasElement>();
/** A soft round halo in a colour (for under a closed chest), cached per colour. */
export function chestHalo(color: string): HTMLCanvasElement {
  let h = halos.get(color);
  if (h) return h;
  const s = surface(40, 28);
  const g = s.ctx;
  const grad = g.createRadialGradient(20, 16, 1, 20, 16, 18);
  grad.addColorStop(0, `${color}66`);
  grad.addColorStop(1, `${color}00`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 40, 28);
  h = s.canvas;
  halos.set(color, h);
  return h;
}
