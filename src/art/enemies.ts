/**
 * Enemy battle sprites. Humanoids reuse the character rig (front view) plus weapon overlays so
 * they share the party's pixel scale; creatures are painted procedurally with the Pix kit.
 */
import { buildChar, type CharLook } from './chars';
import { Pix, scale2x } from './pix';
import { surface } from '../engine/canvas';
import { mix, shade } from '../engine/color';

export interface EnemyArt {
  canvas: HTMLCanvasElement;
  /** Optional emissive overlay (eyes, lights) drawn un-darkened. */
  glow?: HTMLCanvasElement | undefined;
  /** Idle motion style. */
  idle: 'bob' | 'hover' | 'sway' | 'breathe' | 'flicker' | 'still';
  /** Ground shadow width (0 = floating/no shadow). */
  shadow: number;
  /** A distinct individual (its own look), not just the base sprite: no palette shift needed. */
  individual?: boolean | undefined;
  /** The strike frame (jaws open, lunging, firing), shown during the attack motion. */
  attack?: { canvas: HTMLCanvasElement; glow?: HTMLCanvasElement | undefined } | undefined;
}

const cache = new Map<string, EnemyArt>();

/** The individual being built (0 = the base look) and for which sprite; read by rigArt and face. */
let V = 0;
let building = '';
/** Which frame a maker is drawing: its idle stance or its strike. */
let POSE: 'idle' | 'attack' = 'idle';
/** Creatures with a drawn strike frame. */
const ATTACK_FRAMES = new Set(['rat', 'hound', 'drone']);

/**
 * Other members of a gang or squad: when two or three of the same enemy share a fight they are
 * different people (hair, gear, expression), not one sprite in three palettes.
 */
const VARIANTS: Record<string, { look: Partial<CharLook>; face?: Partial<Face> }[]> = {
  punk: [
    { look: { hair: '#62e06a', hairStyle: 'spiky', accessories: ['shades'], skin: '#8a5a3a', sleeves: '#8a5a3a' }, face: { mouth: 'grimace', scar: false } },
    { look: { hairStyle: 'bald', skin: '#e0b894', sleeves: '#e0b894', accessories: ['mask'], top: '#3a2430' }, face: { brows: 'heavy', mouth: 'line', scar: false } },
  ],
  slinger: [
    { look: { hair: '#b07cff', hairStyle: 'ponytail', accessories: ['goggles'], goggles: '#ffcc3d', top: '#3a4a5a' }, face: { mouth: 'smirk' } },
    { look: { hairStyle: 'cap', hat: '#5a3a2a', top: '#4a3a2a' }, face: { mouth: 'grimace' } },
  ],
  medic: [
    { look: { hair: '#3a2a22', hairStyle: 'short', skin: '#9a6a4a', accessories: [] }, face: { brows: 'angry', mouth: 'grimace' } },
  ],
  sentinel: [
    { look: { skin: '#8a5a3a' }, face: { mouth: 'grimace', brows: 'flat' } },
    { look: { skin: '#f0c8a8', hat: '#2a2a33' }, face: { mouth: 'smirk' } },
  ],
  arcanist: [
    { look: { hair: '#1a1418', hairStyle: 'bun', skin: '#b88a64', top: '#2a3a5a', coat: '#2a3a5a' }, face: { mouth: 'line' } },
  ],
  ghoul: [
    { look: { skin: '#8a7c6a', sleeves: '#8a7c6a', top: '#2a3438' }, face: { mouth: 'grimace' } },
  ],
};

/**
 * Creatures that pack up get anatomy of their own per individual (their makers read V): a torn
 * ear or a stub tail, not just a tint. (Tint, mirror and markings still layer on in battle.)
 */
const CREATURE_INDIVIDUALS: Record<string, number> = { rat: 3, hound: 3 };

/** How many distinct individuals a sprite has (1 = base only). */
export function individuals(key: string): number {
  return CREATURE_INDIVIDUALS[key] ?? (VARIANTS[key]?.length ?? 0) + 1;
}

// ------------------------------------------------------------------ humanoids (rig based)
function rigArt(look: CharLook, extra?: (p: Pix, w: number, h: number) => void, glowFn?: (p: Pix) => void): EnemyArt {
  if (V) look = { ...look, ...VARIANTS[building]![V - 1]!.look };
  const spr = buildChar(look);
  const base = spr.frames.down[0]!;
  const w = base.width + 12, h = base.height + 6;
  const s = surface(w, h);
  s.ctx.drawImage(base, 6, 4);
  let canvas = s.canvas;
  if (extra) {
    const p = new Pix(w, h);
    extra(p, w, h);
    const ov = p.toCanvas();
    s.ctx.drawImage(ov, 0, 0);
    canvas = s.canvas;
  }
  let glow: HTMLCanvasElement | undefined;
  if (glowFn) {
    const g = new Pix(w, h);
    glowFn(g);
    glow = scale2x(g.toCanvas());
  }
  return { canvas: scale2x(canvas), glow, idle: 'breathe', shadow: 26 };
}

/**
 * Facial features on the front-view rig (canvas coords before Scale2x): brows, mouth, teeth,
 * scars. `big` bodies are reshaped wider, so their face sits 1px right and eyes spread.
 */
interface Face {
  brows?: 'angry' | 'flat' | 'heavy' | undefined;
  mouth?: 'sneer' | 'grimace' | 'maw' | 'line' | 'smirk' | undefined;
  scar?: boolean | undefined;
  big?: boolean | undefined;
}
function face(p: Pix, f: Face): void {
  if (V) f = { ...f, ...VARIANTS[building]![V - 1]!.face };
  const ink = '#1c1216';
  const l = f.big ? 14 : 13; // left eye x
  const r = f.big ? 19 : 16; // right eye x
  const m = Math.round((l + r) / 2); // face centre
  if (f.brows === 'angry') {
    p.set(l - 1, 10, ink); p.set(l, 11, ink);
    p.set(r + 1, 10, ink); p.set(r, 11, ink);
  } else if (f.brows === 'flat') {
    p.rect(l - 1, 11, 2, 1, ink); p.rect(r, 11, 2, 1, ink);
  } else if (f.brows === 'heavy') {
    p.rect(l - 1, 11, r - l + 3, 1, '#4a4a42');
  }
  switch (f.mouth) {
    case 'sneer':
      p.rect(m - 1, 15, 3, 1, ink); p.set(m + 2, 14, ink); p.set(m, 15, '#e8e0cc');
      break;
    case 'grimace':
      p.rect(l, 15, r - l + 1, 1, ink);
      for (let x = l + 1; x < r; x += 2) p.set(x, 15, '#e8e0cc');
      break;
    case 'maw':
      p.rect(l, 15, r - l + 1, 2, '#1a0a0a');
      for (let x = l; x <= r; x += 2) p.set(x, 15, '#d8d0b0');
      p.set(l + 1, 16, '#d8d0b0'); p.set(r - 1, 16, '#d8d0b0');
      break;
    case 'line':
      p.rect(m - 1, 15, 2, 1, ink);
      break;
    case 'smirk':
      p.rect(m - 1, 15, 2, 1, ink); p.set(m + 1, 14, ink);
      break;
  }
  if (f.scar) {
    p.set(r + 1, 13, '#b8484a'); p.set(r + 1, 14, '#b8484a'); p.set(r, 15, '#b8484a');
  }
}

const HUMANS: Record<string, () => EnemyArt> = {
  punk: () =>
    rigArt(
      { skin: '#c28a64', hair: '#e8452e', hairStyle: 'mohawk', top: '#2a2a30', sleeves: '#c28a64', inner: '#3a2a2a', accent: '#e8452e', pants: '#3a3448', boots: '#1a1418', accessories: [] },
      (p) => {
        face(p, { brows: 'angry', mouth: 'sneer', scar: true });
        // Chain whip hanging from the right hand.
        for (let i = 0; i < 8; i++) p.set(20 + (i % 2), 22 + i, i % 2 ? '#8a8e9c' : '#c8ccd8');
        p.rect(21, 30, 2, 2, '#c8ccd8');
      },
    ),
  medic: () =>
    rigArt(
      { skin: '#d8a47e', hair: '#e8452e', hairStyle: 'bun', top: '#c8c4bc', sleeves: '#c8c4bc', inner: '#3a2a2a', accent: '#e8452e', pants: '#3a3448', boots: '#1a1418', accessories: ['goggles'], goggles: '#2a2838' },
      (p) => {
        face(p, { brows: 'flat', mouth: 'line' });
        // Red-cross armband and a battered med bag on the hip.
        p.rect(7, 19, 2, 2, '#e8452e');
        p.set(7, 20, '#ffffff');
        p.rect(20, 23, 5, 4, '#4a3a30');
        p.rect(21, 24, 3, 1, '#e8452e');
        p.set(22, 23, '#e8452e');
        p.set(22, 25, '#e8452e');
      },
    ),
  slinger: () =>
    rigArt(
      { skin: '#d8a47e', hair: '#1a1418', hairStyle: 'hood', top: '#2f5a3a', inner: '#1a2a1e', accent: '#ffcc3d', pants: '#3a3448', boots: '#1a1418', accessories: ['mask'], goggles: '#1a1a22' },
      (p) => {
        face(p, { brows: 'angry' });
        // Molotov in the left hand: bottle + flame.
        p.rect(4, 19, 2, 4, '#5a8a4a');
        p.set(4, 18, '#d8d0c0');
        p.set(4, 17, '#ffcc3d');
        p.set(5, 16, '#ff7a2a');
      },
      (g) => {
        g.set(4, 17, '#ffcc3d');
        g.set(5, 16, '#ff9a4a');
        g.set(4, 15, '#ffe07a');
      },
    ),
  brute: () =>
    rigArt(
      {
        body: 'big', skin: '#b87a52', hair: '#e8452e', hairStyle: 'mohawk', top: '#4a2a2a', sleeves: '#b87a52', inner: '#2a2a30', accent: '#ffcc3d',
        pants: '#2a2a33', boots: '#1a1418', cyberArm: 'right', accessories: ['visor'], visor: '#ff3a3a',
      },
      (p) => {
        face(p, { mouth: 'grimace', big: true });
        // Oversized chrome fists.
        p.ball(7, 24, 3.2, 3, '#b8c0d0');
        p.ball(23, 24, 3.2, 3, '#b8c0d0');
        p.set(6, 23, '#ffffff');
        p.set(22, 23, '#ffffff');
      },
      (g) => {
        for (let x = 10; x < 20; x++) g.set(x, 11, '#ff3a3a');
      },
    ),
  ghoul: () =>
    rigArt(
      {
        body: 'big', skin: '#7c8a78', hair: '#3a3a36', hairStyle: 'bald', top: '#3a3834', sleeves: '#7c8a78', inner: '#2a2824', accent: '#5a5244',
        pants: '#2e2c28', boots: '#5a5a52', eyes: '#e8ff7a',
      },
      (p) => {
        face(p, { brows: 'heavy', mouth: 'maw', big: true });
        // Claws
        for (const [x, y] of [[5, 26], [7, 27], [9, 26], [21, 26], [23, 27], [25, 26]] as const) {
          p.set(x, y, '#e8e0cc');
          p.set(x, y + 1, '#b8b0a0');
        }
        // Torn shirt
        p.set(12, 20, '#7c8a78');
        p.set(17, 22, '#7c8a78');
        p.set(13, 23, '#7c8a78');
      },
      (g) => {
        g.set(12, 11, '#e8ff7a');
        g.set(17, 11, '#e8ff7a');
      },
    ),
  sentinel: () =>
    rigArt(
      {
        skin: '#d8b090', hair: '#20202a', hairStyle: 'cap', hat: '#1f2a44', top: '#2c3b5e', inner: '#2c3b5e', accent: '#9aa3b8',
        pants: '#1f2a44', boots: '#101018', accessories: ['visor'], visor: '#3fe0f0',
      },
      (p) => {
        face(p, { mouth: 'line' });
        // Carbine held across the body.
        p.line(4, 21, 22, 17, '#2a2c34', 2);
        p.line(18, 17, 26, 15, '#4a4e5c', 1);
        p.rect(9, 20, 3, 3, '#3a3d48');
      },
      (g) => {
        for (let x = 10; x < 16; x++) g.set(x, 11, '#3fe0f0');
        g.set(26, 15, '#ff3a3a');
      },
    ),
  arcanist: () =>
    rigArt(
      {
        skin: '#e0c0a8', hair: '#dcd8cf', hairStyle: 'slick', top: '#3a2a5a', coat: '#3a2a5a', inner: '#16161e', accent: '#b07cff',
        pants: '#2a2238', boots: '#16161e', accessories: ['visor'], visor: '#ff6fc8',
      },
      (p) => {
        face(p, { mouth: 'smirk' });
        p.ball(5, 20, 3, 3, '#b07cff');
      },
      (g) => {
        g.ellipse(5, 20, 2, 2, '#e0c8ff');
        g.set(4, 19, '#ffffff');
        for (let x = 10; x < 16; x++) g.set(x, 11, '#ff6fc8');
      },
    ),
};

// ------------------------------------------------------------------ creatures
/** Resolution multiplier for the creature being built (see SCALE). */
let K = 1;
const P = (w: number, h: number) => new Pix(w, h, K);
const SCALE: Record<string, number> = {
  rat: 1.4, hound: 1.6, drone: 1.6, wisp: 1.7, crab: 1.6, maint: 1.6, shade: 1.7, eel: 1.6, turret: 1.7, hunter: 1.6, bound: 1.7, lurker: 1.15,
};
function art(p: Pix, idle: EnemyArt['idle'], shadow: number, glow?: Pix): EnemyArt {
  p.outline();
  return { canvas: p.toCanvas(), glow: glow?.toCanvas(), idle, shadow: Math.round(shadow * p.k) };
}

const CREATURES: Record<string, () => EnemyArt> = {
  rat: () => {
    const p = P(22, 16), g = P(22, 16);
    // V1: the chewed one (a torn ear, a kinked stub of tail, fat with boils).
    // V2: the lean one (ribby, long tail held high, both eyes lit).
    // (In the strike frame the tail is drawn whipped up, below.)
    if (POSE !== 'attack') {
      if (V === 1) p.limb([[18, 11], [20, 10], [21, 8]], 1, 0.8, '#b07080');
      else if (V === 2) p.limb([[18, 10], [19, 6], [21, 3], [21, 1]], 1, 0.5, '#b07080');
      else p.limb([[18, 11], [20, 8], [21, 4]], 1, 0.6, '#b07080');
    }
    const fur = V === 2 ? '#7a6a64' : '#6a5a60';
    const lunge = POSE === 'attack';
    // The strike stretches the body long and low; the tail whips up behind it.
    if (lunge) p.limb([[17, 9], [19, 4], [20, 1]], 1, 0.6, '#b07080');
    if (V === 2) p.ball(lunge ? 13 : 12, lunge ? 10.5 : 10, lunge ? 7.5 : 6.5, lunge ? 3.3 : 3.8, fur);
    else p.ball(lunge ? 13 : 12, lunge ? 10.5 : 10, (V === 1 ? 7.5 : 7) + (lunge ? 1 : 0), (V === 1 ? 5 : 4.5) - (lunge ? 0.7 : 0), fur);
    p.ball(lunge ? 4 : 5, lunge ? 10 : 9, 4, 3.5, fur);
    if (lunge) {
      // Jaws wide: a dark gape, incisors top and bottom, forepaws thrown out ahead.
      p.rect(0, 9, 3, 4, '#2a1418');
      p.rect(0, 9, 2, 1, '#f4ecdc');
      p.rect(0, 12, 2, 1, '#f4ecdc');
      p.rect(2, 14, 4, 1, '#4a3a40');
      p.rect(0, 14, 2, 1, '#4a3a40');
    }
    p.ellipse(4, 5.5, 1.5, 1.8, '#d88a9a');
    if (V === 1) p.set(7, 6, '#d88a9a'); // the torn ear: a nub
    else p.ellipse(7, 5, 1.5, 1.8, '#d88a9a');
    p.set(1, 10, '#d88a9a');
    for (const [x, y] of [[7, 13], [9, 14], [15, 14], [17, 13]] as const) p.rect(x, y, 2, 1, '#4a3a40');
    if (V === 2) for (let x = 10; x < 16; x += 2) p.set(x, 11, '#4a3a40'); // ribs
    const boils = V === 1 ? [[10, 8], [13, 9], [15, 7], [12, 11], [9, 11], [16, 10], [14, 6]] : [[10, 8], [13, 9], [15, 7], [12, 11]];
    for (const [x, y] of boils) g.set(x!, y!, '#9aff6a');
    g.set(3, 8, '#ff4a4a');
    p.set(3, 8, '#ff4a4a');
    if (V === 2) {
      g.set(5, 8, '#ff4a4a');
      p.set(5, 8, '#ff4a4a');
    }
    return art(p, 'breathe', 12, g);
  },
  hound: () => {
    const p = P(32, 26), g = P(32, 26);
    // Legs
    p.limb([[9, 16], [8, 21], [9, 24]], 1.6, 1.2, '#4a4e5c');
    p.limb([[13, 16], [14, 21], [13, 24]], 1.6, 1.2, '#5a5f70');
    p.limb([[22, 16], [23, 21], [22, 24]], 1.6, 1.2, '#4a4e5c');
    p.limb([[26, 15], [27, 20], [28, 24]], 1.6, 1.2, '#5a5f70');
    // V1: the scrapped one (a strut for a hind leg, no tail, rust plates, open ribs).
    // V2: the scout (antenna, twin eyes, lighter plating).
    if (V === 1) p.limb([[26, 15], [27, 20], [28, 24]], 1.2, 1, '#9a7a4a');
    // Tail
    if (V === 1) p.rect(27, 10, 2, 2, '#5a5f70');
    else p.limb([[27, 11], [30, 7], [31, 5]], 1.2, 0.6, '#5a5f70');
    // Body
    p.ball(18, 12, 10, 5.5, V === 2 ? '#8e94a4' : '#7a8090');
    if (V === 1) {
      p.rect(15, 8, 5, 3, '#8a5a3a');
      p.rect(22, 9, 3, 2, '#9a6a3a');
    }
    p.rect(12, 9, 3, 2, '#8a5a3a');
    p.rect(21, 13, 2, 3, '#8a5a3a');
    // Ribs / wires
    for (let x = 14; x < 24; x += V === 1 ? 2 : 3) p.set(x, 14, '#3a3d48');
    if (V === 1) for (let x = 15; x < 23; x += 2) p.set(x, 15, '#2a2d38');
    p.set(17, 16, '#ff6a3a');
    // Head
    p.ball(7, 9, 5.5, 4.5, '#8a90a0');
    if (POSE === 'attack') {
      // The jaw hinges down, teeth bared, the forelegs reaching.
      p.poly([[0, 9], [5, 9], [5, 11], [0, 10]], '#5a5f70');
      p.poly([[0, 13], [5, 12], [5, 15], [1, 16]], '#4a4e5c');
      p.rect(1, 11, 4, 1, '#e8e0cc');
      p.rect(1, 13, 4, 1, '#e8e0cc');
      p.rect(1, 12, 4, 1, '#2a1418');
      p.limb([[9, 16], [5, 20], [3, 23]], 1.6, 1.2, '#5a5f70');
    } else {
      p.poly([[1, 10], [5, 9], [5, 13], [1, 12]], '#5a5f70');
      p.rect(1, 12, 4, 1, '#e8e0cc');
    }
    p.poly([[6, 3], [9, 5], [7, 6]], '#5a5f70');
    p.set(4, 8, '#ff3a3a');
    g.set(4, 8, '#ff5a3a');
    g.set(3, 8, '#ff9a6a');
    if (V === 2) {
      p.line(8, 5, 11, 1, '#3a3d48', 1);
      p.set(11, 1, '#3fe0f0');
      g.set(11, 1, '#3fe0f0');
      p.set(6, 8, '#ff3a3a');
      g.set(6, 8, '#ff5a3a');
    }
    return art(p, 'breathe', 22, g);
  },
  drone: () => {
    const p = P(28, 20), g = P(28, 20);
    // Arms
    p.line(5, 7, 12, 10, '#3a3d48', 2);
    p.line(23, 7, 16, 10, '#3a3d48', 2);
    // Rotors (motion blur ellipses)
    p.ellipse(5, 6, 5, 1.2, '#9aa3b8');
    p.ellipse(23, 6, 5, 1.2, '#9aa3b8');
    p.ellipse(5, 6, 2, 0.8, '#d8dce8');
    p.ellipse(23, 6, 2, 0.8, '#d8dce8');
    // Body
    p.ball(14, 11, 7, 4.5, '#3a4058');
    p.rect(9, 7, 10, 2, '#1a1c28');
    // Light bar
    p.rect(9, 7, 5, 1, '#ff3a3a');
    p.rect(14, 7, 5, 1, '#3a6aff');
    // Camera
    p.ball(14, 14, 2.5, 2.5, '#1a1c28');
    p.set(14, 14, '#ff4a4a');
    g.rect(9, 7, 5, 1, '#ff5a5a');
    g.rect(14, 7, 5, 1, '#6a8aff');
    g.set(14, 14, '#ff6a6a');
    // Taser prongs
    p.line(11, 15, 10, 18, '#8a8e9c');
    p.line(17, 15, 18, 18, '#8a8e9c');
    g.set(10, 18, '#9ae8ff');
    g.set(18, 18, '#9ae8ff');
    if (POSE === 'attack') {
      // Firing: an arc jumps between the prongs and the camera flares white.
      for (const [x, y] of [[11, 19], [12, 18], [13, 19], [14, 18], [15, 19], [16, 18], [17, 19]] as const) {
        p.set(x, y, '#dff8ff');
        g.set(x, y, '#9ae8ff');
      }
      p.ball(14, 14, 3, 3, '#ffffff');
      g.ball(14, 14, 3, 3, '#ffd0d0');
    }
    return art(p, 'hover', 0, g);
  },
  wisp: () => {
    const p = P(26, 32), g = P(26, 32);
    p.ball(13, 20, 8, 8, '#5a5068');
    p.ball(12, 12, 7, 7, '#6a6080');
    p.ball(16, 8, 5, 5, '#7a7090');
    p.ball(8, 17, 4, 4, '#6a6080');
    p.limb([[13, 26], [10, 29], [12, 31]], 3, 0.8, '#4a4058');
    for (let i = 0; i < 20; i++) {
      const x = 6 + ((i * 7) % 14), y = 5 + ((i * 11) % 22);
      if (p.get(x, y)) p.set(x, y, '#8a80a0');
    }
    p.ellipse(10, 12, 1.5, 1, '#1a1020');
    p.ellipse(15, 12, 1.5, 1, '#1a1020');
    // Tell: a sickly ember core glowing through the smog, burning eyes, sparks drifting off it.
    g.ball(12, 19, 3, 3, '#9ad84a');
    g.set(12, 19, '#f4ffd0');
    g.set(13, 18, '#f4ffd0');
    for (const [ex, ey] of [[9, 12], [10, 12], [14, 12], [15, 12]] as const) g.set(ex, ey, '#ffb04a');
    g.set(10, 11, '#ffe07a');
    g.set(15, 11, '#ffe07a');
    for (const [sx, sy] of [[4, 8], [21, 11], [6, 24], [20, 22], [18, 4]] as const) g.set(sx, sy, '#c8ff7a');
    // Smog tendrils curling off the body.
    p.limb([[6, 16], [3, 13], [2, 9]], 1.4, 0.5, '#5a5068');
    p.limb([[19, 18], [22, 15], [23, 11]], 1.4, 0.5, '#5a5068');
    return art(p, 'flicker', 0, g);
  },
  crab: () => {
    const p = P(36, 24), g = P(36, 24);
    // Legs
    for (const x of [8, 12, 24, 28]) p.limb([[x, 15], [x + (x < 18 ? -3 : 3), 20], [x + (x < 18 ? -4 : 4), 23]], 1.2, 0.8, '#6a3420');
    // Claws
    p.limb([[10, 12], [5, 9], [4, 5]], 2, 1.6, '#9a4a2a');
    p.limb([[26, 12], [31, 9], [32, 5]], 2, 1.6, '#9a4a2a');
    p.poly([[1, 1], [6, 2], [5, 6], [2, 6]], '#b85a32');
    p.poly([[35, 1], [30, 2], [31, 6], [34, 6]], '#b85a32');
    p.set(3, 3, '#1a0e0a');
    p.set(32, 3, '#1a0e0a');
    // Shell
    p.ball(18, 13, 11, 6.5, '#9a4a2a');
    for (let x = 10; x < 27; x += 4) p.set(x, 10, '#c86a3a');
    p.rect(12, 16, 12, 1, '#6a3420');
    // Barnacles / rust
    p.set(14, 9, '#5a8a7a');
    p.set(22, 11, '#5a8a7a');
    // Eye stalks
    p.line(15, 7, 14, 3, '#6a3420');
    p.line(21, 7, 22, 3, '#6a3420');
    p.set(14, 2, '#ffe07a');
    p.set(22, 2, '#ffe07a');
    g.set(14, 2, '#ffe07a');
    g.set(22, 2, '#ffe07a');
    return art(p, 'breathe', 26, g);
  },
  maint: () => {
    const p = P(30, 26), g = P(30, 26);
    // Treads
    p.rect(3, 19, 22, 5, '#2a2c34');
    for (let x = 4; x < 25; x += 3) p.set(x, 21, '#5a5f70');
    // Body
    p.rect(5, 8, 18, 12, '#b89a3a');
    p.rect(5, 8, 18, 2, '#d8ba5a');
    for (let x = 5; x < 23; x += 4) {
      p.rect(x, 16, 2, 3, '#1a1820');
    }
    p.rect(5, 19, 18, 1, '#7a6a2a');
    // Head with eye
    p.rect(9, 3, 10, 6, '#6a7080');
    p.rect(9, 3, 10, 1, '#8a90a0');
    p.ellipse(14, 6, 2, 1.5, '#0a1a22');
    p.set(14, 6, '#3fe0f0');
    g.set(14, 6, '#8af0ff');
    g.set(13, 6, '#3fe0f0');
    // Welding arm
    p.limb([[22, 11], [26, 8], [27, 4]], 1.5, 1, '#6a7080');
    p.rect(26, 1, 3, 3, '#3a3d48');
    g.set(27, 0, '#ffffff');
    g.set(28, 1, '#9ae8ff');
    g.set(26, 0, '#9ae8ff');
    return art(p, 'breathe', 24, g);
  },
  shade: () => {
    const p = P(26, 34), g = P(26, 34);
    p.ball(13, 16, 8, 11, '#3a6a78');
    p.ball(13, 8, 5, 5, '#4a7a88');
    // Hat brim (a drowned commuter)
    p.rect(7, 4, 12, 1, '#2a4a58');
    p.rect(9, 1, 8, 3, '#2a4a58');
    // Dripping tail
    for (let i = 0; i < 5; i++) p.limb([[7 + i * 3, 24], [6 + i * 3, 28 + (i % 2) * 2], [7 + i * 3, 32]], 1.6, 0.4, '#2e5a68');
    p.ellipse(10.5, 9, 1.2, 1.6, '#0a141a');
    p.ellipse(15.5, 9, 1.2, 1.6, '#0a141a');
    p.ellipse(13, 13, 1.5, 1, '#0a141a');
    // Briefcase
    p.rect(17, 18, 6, 4, '#2a4048');
    g.set(10, 9, '#9af0ff');
    g.set(15, 9, '#9af0ff');
    return art(p, 'flicker', 0, g);
  },
  eel: () => {
    const p = P(38, 26), g = P(38, 26);
    p.limb([[35, 20], [30, 22], [24, 18], [20, 12], [15, 10], [9, 11]], 1, 4.5, '#2f5a4a');
    // Fin
    p.poly([[18, 9], [24, 13], [22, 7]], '#4a8a6a');
    // Head
    p.ball(7, 10, 6, 4.5, '#3a6a58');
    p.poly([[1, 11], [6, 11], [6, 14], [2, 13]], '#1a2a24');
    for (const x of [2, 4]) p.set(x, 12, '#efe6cf');
    p.set(5, 8, '#ffe07a');
    g.set(5, 8, '#ffe07a');
    for (const [x, y] of [[14, 11], [19, 14], [24, 18], [29, 21]] as const) {
      p.set(x, y, '#9ae8ff');
      g.set(x, y, '#9ae8ff');
    }
    return art(p, 'sway', 20, g);
  },
  turret: () => {
    const p = P(30, 28), g = P(30, 28);
    // Pedestal
    p.rect(10, 18, 10, 8, '#4a4e5c');
    p.rect(7, 25, 16, 3, '#3a3d48');
    p.rect(10, 18, 10, 1, '#6a6e7c');
    // Housing
    p.ball(15, 13, 9, 6, '#5a6070');
    p.rect(8, 11, 14, 2, '#d8b02a');
    // Barrels
    p.rect(0, 12, 8, 2, '#2a2c34');
    p.rect(0, 15, 8, 2, '#2a2c34');
    p.rect(0, 12, 1, 5, '#1a1a20');
    // Hazard chevrons on the pedestal.
    for (let i = 0; i < 16; i += 4) p.rect(7 + i, 25, 2, 3, '#d8b02a');
    // Eye
    p.ellipse(18, 15, 2, 1.5, '#1a0a0a');
    p.set(18, 15, '#ff3a3a');
    // Tell: a live sensor strip across the housing and hot barrel tips.
    p.rect(9, 14, 7, 1, '#6a1a1a');
    for (let x = 9; x < 16; x++) g.set(x, 14, x % 2 ? '#ff3a3a' : '#ff8a6a');
    for (const [ex, ey] of [[18, 15], [17, 15], [19, 15], [18, 14]] as const) g.set(ex, ey, '#ff6a6a');
    for (const y of [12, 13, 15, 16]) g.set(0, y, '#ffb04a');
    return art(p, 'breathe', 20, g);
  },
  hunter: () => {
    const p = P(34, 22), g = P(34, 22);
    p.poly([[2, 11], [14, 5], [30, 7], [33, 11], [30, 15], [14, 16]], '#2a2e3e');
    p.poly([[4, 11], [14, 7], [28, 8], [31, 11]], '#4a5068');
    // Missile pods
    p.rect(12, 16, 10, 3, '#3a3d48');
    p.rect(12, 16, 3, 3, '#e8452e');
    p.rect(17, 16, 3, 3, '#e8452e');
    // Engine glow
    p.rect(30, 9, 3, 4, '#3fe0f0');
    g.rect(30, 9, 3, 4, '#8af0ff');
    g.set(33, 10, '#3fe0f0');
    // Sensor
    p.ellipse(8, 10, 2, 1.5, '#1a0a0a');
    p.set(7, 10, '#ff2a2a');
    g.set(7, 10, '#ff6a6a');
    g.set(5, 10, '#ff2a2a');
    return art(p, 'hover', 0, g);
  },
  bound: () => {
    const p = P(30, 36), g = P(30, 36);
    p.ball(15, 18, 9, 12, '#5a4a8a');
    p.ball(15, 9, 6, 6, '#6a5a9a');
    // Arms reaching
    p.limb([[8, 15], [4, 11], [2, 6]], 2, 1, '#5a4a8a');
    p.limb([[22, 15], [26, 11], [28, 6]], 2, 1, '#5a4a8a');
    // Tail
    p.limb([[15, 28], [12, 32], [15, 35]], 4, 0.5, '#4a3a78');
    // Ward rings (corporate binding glyphs)
    for (const yy of [14, 22]) for (let x = 5; x < 26; x++) if ((x + yy) % 3) p.set(x, yy, '#3fe0f0');
    // Face: anguished
    p.ellipse(12.5, 9, 1.2, 1.8, '#0a0614');
    p.ellipse(17.5, 9, 1.2, 1.8, '#0a0614');
    p.ellipse(15, 13, 1.5, 2, '#0a0614');
    for (const yy of [14, 22]) for (let x = 5; x < 26; x++) if ((x + yy) % 3 && p.get(x, yy)) g.set(x, yy, '#8af0ff');
    g.set(12, 9, '#e0c8ff');
    g.set(17, 9, '#e0c8ff');
    return art(p, 'flicker', 0, g);
  },
  lurker: () => {
    const p = P(120, 84), g = P(120, 84);
    const body = '#2a4a4a';
    // Rear coils breaking the surface
    p.limb([[96, 70], [104, 56], [112, 50], [118, 58], [116, 72]], 5, 3, shade(body, -0.15));
    p.limb([[10, 72], [8, 60], [16, 52], [24, 60], [22, 72]], 5, 4, shade(body, -0.15));
    // Main neck rising
    p.limb([[70, 80], [74, 62], [70, 46], [60, 34], [50, 28]], 14, 9, body);
    // Belly plates
    for (let i = 0; i < 6; i++) p.ellipse(72 - i * 2.5, 70 - i * 7, 6, 2, '#5a7a6a');
    // Head
    p.ball(40, 28, 20, 14, '#2f5252');
    p.poly([[18, 30], [40, 36], [58, 36], [40, 44], [22, 38]], '#1a2a2a');
    // Teeth
    for (let x = 24; x < 54; x += 3) {
      p.poly([[x, 35], [x + 2, 35], [x + 1, 39]], '#e8e0cc');
      p.poly([[x + 1, 43], [x + 3, 43], [x + 2, 39]], '#d8d0bc');
    }
    // Eyes
    p.ellipse(30, 22, 3, 2.5, '#0a1414');
    p.ellipse(48, 21, 3, 2.5, '#0a1414');
    p.set(30, 22, '#ffe07a');
    p.set(48, 21, '#ffe07a');
    // Angler lure
    p.limb([[40, 15], [36, 6], [28, 2], [22, 6]], 1.2, 0.8, '#3a5a5a');
    p.ball(21, 8, 3, 3, '#6affc8');
    // Fins / frills
    p.poly([[56, 18], [70, 10], [66, 24]], '#3a6a6a');
    p.poly([[58, 26], [72, 22], [64, 32]], '#3a6a6a');
    // Bioluminescent spots
    const spots: [number, number][] = [[62, 44], [68, 54], [72, 64], [36, 18], [44, 16], [52, 22], [106, 54], [14, 58], [20, 56]];
    for (const [x, y] of spots) {
      p.set(x, y, '#6affc8');
      g.set(x, y, '#9affe0');
    }
    g.ellipse(21, 8, 2.5, 2.5, '#b8ffe8');
    g.set(30, 22, '#ffe07a');
    g.set(48, 21, '#ffe07a');
    // Waterline foam
    for (let x = 0; x < 120; x++) if (p.get(x, 76) || p.get(x, 74)) p.set(x, 76, '#9ac8d8');
    return art(p, 'sway', 0, g);
  },
  warden: () => {
    const p = P(96, 92), g = P(96, 92);
    const plate = '#c8d0dc', dark = '#3a3f4c';
    // Legs
    p.rect(22, 62, 14, 24, dark);
    p.rect(60, 62, 14, 24, dark);
    p.rect(18, 84, 22, 6, '#2a2e38');
    p.rect(56, 84, 22, 6, '#2a2e38');
    p.rect(24, 64, 10, 3, '#d8b02a');
    p.rect(62, 64, 10, 3, '#d8b02a');
    // Pelvis
    p.rect(26, 56, 44, 10, '#5a6070');
    // Torso
    p.poly([[18, 22], [78, 22], [72, 58], [24, 58]], plate);
    p.poly([[18, 22], [78, 22], [76, 28], [20, 28]], '#e6ecf2');
    p.rect(24, 50, 48, 2, '#8a92a0');
    // Core window with the trapped spirit
    p.ball(48, 40, 11, 10, '#1a1030');
    p.ball(48, 40, 8, 7.5, '#5a3a9a');
    p.ellipse(45, 38, 1.2, 2, '#0a0614');
    p.ellipse(51, 38, 1.2, 2, '#0a0614');
    p.ellipse(48, 44, 2, 2.5, '#0a0614');
    for (let a = 0; a < 12; a++) {
      const x = 48 + Math.cos((a / 12) * Math.PI * 2) * 11, y = 40 + Math.sin((a / 12) * Math.PI * 2) * 10;
      p.set(x, y, '#9aa3b8');
    }
    // Shoulders
    p.ball(16, 26, 10, 9, plate);
    p.ball(80, 26, 10, 9, plate);
    // Arms
    p.rect(6, 32, 10, 24, dark);
    p.rect(80, 32, 10, 20, dark);
    p.rect(4, 54, 14, 8, '#5a6070');
    // Pulse cannon on the right shoulder
    p.rect(74, 8, 20, 12, '#4a5060');
    p.rect(74, 8, 20, 2, '#6a7080');
    p.rect(62, 11, 14, 6, '#2a2e38');
    p.ellipse(62, 14, 2, 3, '#3fe0f0');
    // Head
    p.rect(40, 10, 16, 12, '#5a6070');
    p.rect(40, 10, 16, 2, '#7a8090');
    p.rect(42, 15, 12, 3, '#1a0a0a');
    for (let x = 43; x < 53; x++) p.set(x, 16, '#ff3a3a');
    // K-M mark
    p.rect(30, 30, 3, 8, '#3f8af0');
    p.rect(63, 30, 3, 8, '#3f8af0');
    // Glow
    g.ball(48, 40, 7, 6.5, '#8a6aff');
    g.ellipse(45, 38, 1, 1.5, '#e0d0ff');
    g.ellipse(51, 38, 1, 1.5, '#e0d0ff');
    for (let x = 43; x < 53; x++) g.set(x, 16, '#ff5a5a');
    g.ellipse(62, 14, 1.5, 2.5, '#9af0ff');
    p.outline();
    return { canvas: p.toCanvas(), glow: g.toCanvas(), idle: 'breathe', shadow: 70 };
  },
  warden_spirit: () => {
    const p = P(96, 96), g = P(96, 96);
    const body = '#6a4ab8';
    // Broken shell fragments at the base
    p.poly([[10, 80], [30, 72], [36, 90], [12, 94]], '#8a92a0');
    p.poly([[86, 80], [66, 72], [60, 90], [84, 94]], '#8a92a0');
    // Spectral body
    p.ball(48, 52, 22, 30, body);
    p.limb([[48, 78], [40, 86], [48, 94]], 12, 2, shade(body, -0.2));
    // Arms flung wide
    p.limb([[30, 40], [18, 30], [6, 14]], 6, 2.5, body);
    p.limb([[66, 40], [78, 30], [90, 14]], 6, 2.5, body);
    for (const [x, y] of [[4, 10], [8, 9], [3, 14]] as const) p.line(6, 14, x, y, '#b8a0ff');
    for (const [x, y] of [[92, 10], [88, 9], [93, 14]] as const) p.line(90, 14, x, y, '#b8a0ff');
    // Head
    p.ball(48, 22, 13, 13, mix(body, '#ffffff', 0.15));
    // Screaming face
    p.ellipse(42, 20, 2.5, 3.5, '#0a0614');
    p.ellipse(54, 20, 2.5, 3.5, '#0a0614');
    p.ellipse(48, 30, 4, 6, '#0a0614');
    // Snapping chains
    for (const [x0, y0, x1, y1] of [[20, 52, 4, 60], [76, 52, 92, 60], [30, 70, 18, 84], [66, 70, 78, 84]] as const) {
      const n = 6;
      for (let i = 0; i < n; i++) {
        const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
        p.ellipse(x, y, 1.5, 1.2, '#3fe0f0');
        g.set(x, y, '#9af0ff');
      }
    }
    // Inner glow lines
    for (let y = 36; y < 76; y += 5) for (let x = 36; x < 60; x++) if ((x * 3 + y) % 7 === 0 && p.get(x, y)) g.set(x, y, '#e0d0ff');
    g.ellipse(42, 20, 1.2, 2, '#ffffff');
    g.ellipse(54, 20, 1.2, 2, '#ffffff');
    p.outline();
    return { canvas: p.toCanvas(), glow: g.toCanvas(), idle: 'flicker', shadow: 0 };
  },
};

/** A sprite's art; `dup` picks which individual when several of one kind share a fight. */
export function enemyArt(key: string, dup = 0): EnemyArt {
  const v = dup % individuals(key);
  const id = v ? `${key}#${v}` : key;
  let a = cache.get(id);
  if (a) return a;
  const make = HUMANS[key] ?? CREATURES[key];
  if (!make) throw new Error(`No art for enemy sprite ${key}`);
  K = SCALE[key] ?? 1;
  V = v;
  building = key;
  try {
    a = make();
    if (ATTACK_FRAMES.has(key)) {
      POSE = 'attack';
      const s = make();
      a.attack = { canvas: s.canvas, glow: s.glow };
    }
  } finally {
    K = 1;
    V = 0;
    POSE = 'idle';
  }
  if (v) a.individual = true;
  cache.set(id, a);
  return a;
}

export const ENEMY_ART_KEYS = [...Object.keys(HUMANS), ...Object.keys(CREATURES)];
