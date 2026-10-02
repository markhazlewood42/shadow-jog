/**
 * The crew from Mark's own Sprite Fusion sprites, for the side-on battle (spike `spike/side-battle`, `?battle=side`, DEV only).
 *
 * The files are Mark's raw generations, so they stay out of git and out of `public/`: they are fetched from the dev server's project root
 * (`/spritefusion-tests/...`, the sheets from the `extracted/` folder next to the zips) and nothing here copies or writes them. What this file does:
 *
 *   1. Loads every PNG and sprite sheet the crew need into pixel arrays (`loadSfArt`).
 *   2. Colour clean-up (`&clean=0` turns it off): Sprite Fusion output carries ~1,000 near-identical shades a sprite (AI, not a palette). One palette is
 *      built per character from ALL their frames together (shades within `CLEAN_DISTANCE` of a commoner shade fold into it, most frequent first) and every
 *      pixel snaps to its nearest palette entry, so a shade cannot drift between two poses of the same person. Outlines are left alone: the merge is
 *      by colour distance only, and a dark outline pixel is nowhere near a mid-tone.
 *   3. Anchoring: a frame is drawn by its canvas centre on the character's slot and its bottom row on the street, so every frame of a loop is cut onto
 *      a canvas whose centre is the feet's midpoint (the mean over the loop, so the soles do not slide) and whose bottom is the soles' row.
 *   4. The party battler: idle loop, a walk-in, and a frame for each pose the engine asks for. Poses Mark has not made are filled with the stance
 *      (placeholders, listed in `SF_PLACEHOLDERS` and in the spike notes).
 *
 * Sprite Fusion faces everything right, so nothing is mirrored. All four crew have Sprite Fusion art; `mirrorBattler` (the first loop's traced crew, flipped) stays only for a member who has none.
 */
import type { Battler, Pose } from '../battlers';
import { POSES } from '../battlers';
import { bootsMid, boxOf, type Raw } from './sfgeom';
import { buildSfPunch, dropStrays, PUNCH_KEYS, PUNCH_MEASURED, type PunchKey } from './sfpunch';
import { buildSfStrike, SF_KEYS, SF_MEASURED, type SfKey } from './sfstrike';

const BASE = '/spritefusion-tests/';
/** `&clean=0` shows the raw art (sideview.ts documents the flags; read here too so the two modules do not import each other). */
const SF_CLEAN = typeof location === 'undefined' || new URLSearchParams(location.search).get('clean') !== '0';

/** How far apart (RGB distance) two shades may be and still count as one. At 16, about 1,000 shades fold to 80 to 120 with no change you can see at 1x; at 24 the steel-blue and the jeans lose their shading. */
export const CLEAN_DISTANCE = 16;

const RAW = new Map<string, Raw[]>();
let loaded = false;

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`${url} did not load`));
    img.src = url;
  });

async function readPng(url: string): Promise<Raw> {
  const img = await loadImage(url);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('no 2d canvas');
  g.drawImage(img, 0, 0);
  return { w: c.width, h: c.height, px: g.getImageData(0, 0, c.width, c.height).data };
}

const cut = (r: Raw, x0: number, w: number): Raw => {
  const px = new Uint8ClampedArray(w * r.h * 4);
  for (let y = 0; y < r.h; y++) px.set(r.px.subarray((y * r.w + x0) * 4, (y * r.w + x0 + w) * 4), y * w * 4);
  return { w, h: r.h, px };
};

/** A decoded sprite as a canvas (a copy: the pixel array is not shared). */
const toCanvas = (r: Raw): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = r.w;
  c.height = r.h;
  c.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(r.px), r.w, r.h), 0, 0);
  return c;
};

/** Single-frame PNGs the crew use, by file name (without `.png`). */
const STILLS = [
  'kit-battle-reference', 'kit-battle-punch1', 'kit-battle-punch2', 'kit-battle-punch3', 'kit-battle-kick', 'kit-battle-crouched', 'kit-battle-injured', 'kit-battle-running', 'kit-battle-victory',
  'rook-battle-reference', 'rook-battle-strike1', 'rook-battle-strike2', 'rook-battle-crouched',
  'hex-battle-reference',
  'sable-battle-reference',
];
/** Sprite sheets (one row of frames, described by metadata.json), by folder name under `extracted/`. */
const SHEETS = ['kit-battle-idle', 'rook-battle-idle', 'hex-battle-idle', 'sable-battle-idle'];

/** Fetch everything. Rejects if any file is missing, so the caller can say so and fall back. */
export async function loadSfArt(): Promise<void> {
  if (loaded) return;
  await Promise.all([
    ...STILLS.map(async (n) => RAW.set(n, [dropStrays(await readPng(`${BASE}${n}.png`))])),
    ...SHEETS.map(async (n) => {
      const meta = (await (await fetch(`${BASE}extracted/${n}/metadata.json`)).json()) as { frame_w: number; frame_count: number };
      const sheet = await readPng(`${BASE}extracted/${n}/spritesheet.png`);
      RAW.set(n, Array.from({ length: meta.frame_count }, (_, i) => cut(sheet, i * meta.frame_w, meta.frame_w)));
    }),
  ]);
  loaded = true;
}

export const sfLoaded = (): boolean => loaded;

const frames = (name: string): Raw[] => {
  const f = RAW.get(name);
  if (!f?.length) throw new Error(`Sprite Fusion art "${name}" is not loaded`);
  return f;
};

// ------------------------------------------------------------------------------------------------ colour clean-up

/** One palette for a set of frames: shades folded into a commoner shade within `dist` (most frequent first), then every pixel snapped to the nearest entry. Returns new frames. */
export function cleanColours(all: Raw[], dist: number): { frames: Raw[]; before: number; after: number } {
  const count = new Map<number, number>();
  for (const r of all)
    for (let i = 0; i < r.px.length; i += 4)
      if ((r.px[i + 3] ?? 0) > 0) {
        const k = ((r.px[i] ?? 0) << 16) | ((r.px[i + 1] ?? 0) << 8) | (r.px[i + 2] ?? 0);
        count.set(k, (count.get(k) ?? 0) + 1);
      }
  const pal: [number, number, number][] = [];
  for (const [k] of [...count.entries()].sort((a, b) => b[1] - a[1])) {
    const c: [number, number, number] = [(k >> 16) & 255, (k >> 8) & 255, k & 255];
    if (!pal.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) <= dist)) pal.push(c);
  }
  const map = new Map<number, [number, number, number]>();
  for (const [k] of count) {
    const r = (k >> 16) & 255, g = (k >> 8) & 255, b = k & 255;
    let best: [number, number, number] = pal[0] ?? [r, g, b];
    let bd = Number.POSITIVE_INFINITY;
    for (const p of pal) {
      const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    map.set(k, best);
  }
  const out = all.map((r) => {
    const px = new Uint8ClampedArray(r.px);
    for (let i = 0; i < px.length; i += 4) {
      if ((px[i + 3] ?? 0) === 0) continue;
      const m = map.get(((px[i] ?? 0) << 16) | ((px[i + 1] ?? 0) << 8) | (px[i + 2] ?? 0));
      if (m) { px[i] = m[0]; px[i + 1] = m[1]; px[i + 2] = m[2]; }
    }
    return { w: r.w, h: r.h, px };
  });
  return { frames: out, before: count.size, after: pal.length };
}

// ------------------------------------------------------------------------------------------------ anchoring

/**
 * Frames of one loop (or one pose) cut onto canvases of equal width: the centre column is the mean feet midpoint over the loop, the bottom row the
 * lowest sole, so the member stands on the same spot in every frame. `lift` raises a frame by that many art pixels (a bob): the engine puts a canvas's
 * bottom edge on the street, so a canvas with transparent rows under the sprite shows it that much higher. `top` is the first opaque row (the arrow's height).
 */
export function anchored(group: Raw[], lift: number[] = [], boots = false): { canvases: HTMLCanvasElement[]; top: number } {
  const boxes = group.map(boxOf);
  const ax = Math.round(group.reduce((n, r, i) => n + (boots ? bootsMid(r) : (boxes[i]?.feet ?? 0)), 0) / boxes.length);
  const left = Math.min(...boxes.map((b) => b.x0));
  const right = Math.max(...boxes.map((b) => b.x1 + 1));
  const half = Math.max(ax - left, right - ax);
  const bottom = Math.max(...boxes.map((b) => b.y1)) + 1;
  const canvases = group.map((r, i) => {
    const c = document.createElement('canvas');
    c.width = half * 2;
    c.height = bottom + (lift[i] ?? 0);
    const g = c.getContext('2d');
    if (g) {
      const src = document.createElement('canvas');
      src.width = r.w;
      src.height = r.h;
      src.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(r.px), r.w, r.h), 0, 0);
      g.drawImage(src, 0, 0, r.w, Math.min(r.h, bottom), half - ax, 0, r.w, Math.min(r.h, bottom));
    }
    return c;
  });
  return { canvases, top: Math.min(...boxes.map((b) => b.y0)) };
}

// ------------------------------------------------------------------------------------------------ the crew

/** What the engine needs from a member: the loops and the pose frames, named by the files they come from. */
interface SfSpec {
  idle: string;
  /**
   * The walk-in: frames (a sheet is played as it is, a still is repeated), `lift` the rows each frame is raised (the bob, cycled over the frames), `step`
   * render frames (60 a second) per frame, `ghosts` the speed ghosts trailing it. Round 3: Kit dashes on `kit-battle-running`, Rook on his low lunge
   * `rook-battle-crouched` (both then skid into the stance); Hex and Sable have no run frame, so they list none and step in on their idle loop (the
   * distance, delay and fade are `SF_WALK` in sfgeom.ts), until Mark makes walk frames.
   */
  walk: { names: string[]; lift: number[]; step: number; ghosts?: number; boots?: boolean };
  /** Frames shown over the last few pixels of the walk, easing from the run into the stance (a skid), if the run pose is not the stance. */
  settle?: string[];
  /** The frame per pose; a pose not listed here is filled with `rest` (a placeholder). A sheet's first frame is used. */
  poses: Partial<Record<Pose, string>>;
  rest: string;
  /** Rook: the two-handed strike is built from his idle and the two strike frames (rig2/sfstrike.ts). */
  strike?: boolean;
  /** Kit: the punch combo is built from her idle, run and the punch and kick frames (rig2/sfpunch.ts). */
  punch?: boolean;
  /** Render frames per idle frame: 60 / the sheet's fps (all the idles are 8 fps). */
  idleStep: number;
}

const SPECS: Record<string, SfSpec> = {
  kit: {
    idle: 'kit-battle-idle',
    walk: { names: ['kit-battle-running', 'kit-battle-running', 'kit-battle-running', 'kit-battle-running'], lift: [0, 2, 0, 2], step: 4, ghosts: 2 },
    settle: ['kit-battle-reference'],
    poses: { attack: 'kit-battle-punch1', strike: 'kit-battle-punch3', thrust: 'kit-battle-punch2', brace: 'kit-battle-crouched', hurt: 'kit-battle-injured', victory: 'kit-battle-victory' },
    rest: 'kit-battle-reference',
    punch: true,
    idleStep: 7.5,
  },
  rook: {
    idle: 'rook-battle-idle',
    // `boots`: the dash frame is anchored by his boots, not the half-way point to the blade tip 50 px behind them (round 4).
    walk: { names: ['rook-battle-crouched', 'rook-battle-crouched'], lift: [0, 1], step: 4, ghosts: 2, boots: true },
    settle: ['rook-battle-idle'],
    // Brace is his low crouch, never the sword-on-his-back art (the blade would teleport). Round 3: hurt is no longer the crouch (it read as a lunge, not a hit):
    // it is the sword-drawn stance under the engine's recoil and white flash, until Mark makes a hurt frame. Everything else he has no frame for is the stance too.
    poses: { attack: 'rook-battle-strike1', strike: 'rook-battle-strike2', thrust: 'rook-battle-strike2', brace: 'rook-battle-crouched' },
    rest: 'rook-battle-idle',
    strike: true,
    idleStep: 7.5,
  },
  hex: {
    idle: 'hex-battle-idle',
    // Round 4: no run frame, so she scurries in on her idle loop with a 2 px bob per step and one speed ghost (the runners' mechanism), no fade.
    walk: { names: ['hex-battle-idle'], lift: [0, 2, 0, 2, 0, 2, 0, 2], step: 4, ghosts: 1 },
    settle: ['hex-battle-idle'],
    poses: {},
    rest: 'hex-battle-reference',
    idleStep: 7.5,
  },
  sable: {
    idle: 'sable-battle-idle',
    walk: { names: ['sable-battle-idle'], lift: [0, 2, 0, 2, 0, 2, 0, 2], step: 4, ghosts: 1 },
    settle: ['sable-battle-idle'],
    poses: {},
    rest: 'sable-battle-reference',
    idleStep: 7.5,
  },
};

/** Poses with no frame of their own from Mark: the stance stands in (for the notes). */
export const SF_PLACEHOLDERS: Record<string, Pose[]> = Object.fromEntries(Object.entries(SPECS).map(([k, s]) => [k, POSES.filter((p) => p !== 'idle' && !s.poses[p])]));
/** How the colour clean-up went, per member, for the console and the notes. */
export const SF_CLEAN_LOG: Record<string, { before: number; after: number }> = {};

export function sfBattler(key: string): Battler | null {
  const spec = SPECS[key];
  if (!spec || !loaded) return null;
  // One palette over everything this character has, so a shade cannot differ between two poses.
  const names = [...new Set([spec.idle, spec.rest, ...spec.walk.names, ...(spec.settle ?? []), ...Object.values(spec.poses), ...(spec.punch ? ['kit-battle-kick'] : [])])];
  const all = names.flatMap((n) => frames(n).map((r) => ({ n, r })));
  let rawOf = (n: string): Raw[] => frames(n);
  if (SF_CLEAN) {
    const cleaned = cleanColours(all.map((a) => a.r), CLEAN_DISTANCE);
    SF_CLEAN_LOG[key] = { before: cleaned.before, after: cleaned.after };
    console.info(`Sprite Fusion colour clean-up, ${key}: ${cleaned.before} shades -> ${cleaned.after}`);
    const byName = new Map<string, Raw[]>();
    for (const [i, a] of all.entries()) byName.set(a.n, [...(byName.get(a.n) ?? []), cleaned.frames[i] as Raw]);
    rawOf = (n) => byName.get(n) ?? frames(n);
  }
  const idle = anchored(rawOf(spec.idle));
  const walkFrames = spec.walk.names.flatMap(rawOf);
  const walk = walkFrames.length ? anchored(walkFrames, walkFrames.map((_, i) => spec.walk.lift[i % spec.walk.lift.length] ?? 0), spec.walk.boots) : { canvases: [] as HTMLCanvasElement[], top: 0 };
  const settle = spec.settle ? anchored(spec.settle.map((n) => rawOf(n)[0] as Raw)).canvases : undefined;
  const poseFrames = {} as Record<Pose, HTMLCanvasElement>;
  const first = idle.canvases[0] as HTMLCanvasElement;
  for (const p of POSES) {
    const name = spec.poses[p];
    poseFrames[p] = p === 'idle' ? first : (anchored([rawOf(name ?? spec.rest)[0] as Raw]).canvases[0] as HTMLCanvasElement);
  }
  // Rook's strike (round 1 of G-sf-rook-strike): the frames laid on one canvas size by their front boot, plus the smear arcs.
  let sfStrike: Battler['sfStrike'];
  if (spec.strike) {
    const built = buildSfStrike(rawOf(spec.idle), rawOf('rook-battle-strike1')[0] as Raw, rawOf('rook-battle-strike2')[0] as Raw, rawOf('rook-battle-crouched')[0] as Raw);
    Object.assign(SF_MEASURED, built.measured);
    const fr = {} as Record<SfKey, HTMLCanvasElement>;
    for (const k of SF_KEYS) fr[k] = toCanvas(built.frames[k]);
    sfStrike = { frames: fr };
  }
  // Kit's punch combo (H-sf-kit-punch): her idle, the run, load, jab, cross and kick laid on one canvas size by their planted boot, plus the smears.
  let sfPunch: Battler['sfPunch'];
  if (spec.punch) {
    const one = (n: string): Raw => rawOf(n)[0] as Raw;
    const built = buildSfPunch(rawOf(spec.idle), one('kit-battle-running'), one('kit-battle-punch1'), one('kit-battle-punch2'), one('kit-battle-punch3'), one('kit-battle-kick'));
    Object.assign(PUNCH_MEASURED, built.measured);
    const fr = {} as Record<PunchKey, HTMLCanvasElement>;
    for (const k of PUNCH_KEYS) fr[k] = toCanvas(built.frames[k]);
    sfPunch = { frames: fr };
  }
  return {
    frames: poseFrames,
    glow: {},
    ...(sfStrike ? { sfStrike } : {}),
    ...(sfPunch ? { sfPunch } : {}),
    headH: Math.ceil((first.height - idle.top) / 2),
    res: 2,
    cycle: { idle: idle.canvases, idleOrder: idle.canvases.map((_, i) => i), walk: walk.canvases, idleStep: spec.idleStep, walkStep: spec.walk.step, ...(settle ? { settle } : {}), ...(spec.walk.ghosts ? { walkGhosts: spec.walk.ghosts } : {}) },
  };
}

// ------------------------------------------------------------------------------------------------ the one without Sprite Fusion art

const flip = (c: HTMLCanvasElement): HTMLCanvasElement => {
  const o = document.createElement('canvas');
  o.width = c.width;
  o.height = c.height;
  const g = o.getContext('2d');
  if (g) {
    g.translate(c.width, 0);
    g.scale(-1, 1);
    g.imageSmoothingEnabled = false;
    g.drawImage(c, 0, 0);
  }
  return o;
};

/** A code-drawn battler (the first loop's, facing left) turned to face right: every frame flipped. Rook's kata frames are dropped (his strike is Mark's own art here). */
export function mirrorBattler(b: Battler): Battler {
  const memo = new Map<HTMLCanvasElement, HTMLCanvasElement>();
  const f = (c: HTMLCanvasElement): HTMLCanvasElement => {
    let o = memo.get(c);
    if (!o) {
      o = flip(c);
      memo.set(c, o);
    }
    return o;
  };
  const poseFrames = {} as Record<Pose, HTMLCanvasElement>;
  for (const p of POSES) poseFrames[p] = f(b.frames[p]);
  const out: Battler = { frames: poseFrames, glow: {}, headH: b.headH, res: b.res };
  if (b.cycle) out.cycle = { idle: b.cycle.idle.map(f), idleOrder: b.cycle.idleOrder, walk: b.cycle.walk.map(f) };
  return out;
}
