/**
 * Content that the wider view shows (decision D17 of docs/PIVOT-640.md): things that were off screen
 * at 480x270 and now appear, are cropped, or are seen before their cue. The WP3 walk found a short
 * list (media/pivot-640/wp3/popins.md, with pictures). Each item has two code-only fixes, and a
 * third that is map or story data (option c, which needs Mark's written yes and is not built):
 *
 * - **a**, limit the camera: a box that the camera's origin must stay in (`camera`). It can only
 *   keep the view away from a place, so it works when the thing sits near the map's edge. A camera
 *   range may reach beyond the map's own edge, which shows the surround (fieldkit/surround.ts).
 * - **b**, fade the beat: a dark curtain over a box of the map, either until the player gets near
 *   (`near`) or for the length of one event, lifted when a script pans the camera (`event`); or a
 *   hold, which keeps a pan on its target for a while (`hold`).
 *
 * Every item ships `none`: nothing here changes what the player sees until Mark picks per item at
 * Review 3. The table is the one place the choices live (the editor rule of docs/IDEAS.md, entry 1):
 * plain values keyed by item id, in code for now because PL6 forbids data edits in this package. It
 * moves into the map data once Mark gives his written yes. The dev review switch `?popin=P1:b,P2:a`
 * (or `?popin=all:b`) forces options for the pictures; a production build ignores it.
 */
import { reviewSwitch } from './devswitch';

export type PopinOption = 'none' | 'a' | 'b';

/** Limits on where the camera's origin (the view's top-left corner, in map pixels) may go. A side left out keeps the default (the map's own edge). */
export interface CameraBox { minX?: number; maxX?: number; minY?: number; maxY?: number }

/** A rectangle in map pixels. */
export interface MapRect { x: number; y: number; w: number; h: number }

/**
 * A dark curtain over `box`. `near`: it is closed while the leader is farther than `radius` from
 * `focus` and opens over `fade` more pixels as they come closer. `event`: it is closed while one of
 * `events` (event ids of the map) runs, until a script pans the camera, and eases over `fade` frames.
 */
export type Curtain = { box: MapRect; fade: number } & (
  | { mode: 'near'; focus: { x: number; y: number }; radius: number }
  | { mode: 'event'; events: string[] }
);

export interface PopinEntry {
  /** The map the item is on. */
  map: string;
  /** One line: what shows. The pop-in list says more. */
  what: string;
  /** What ships: always `none` until Mark picks. */
  option: PopinOption;
  /** Option a. Null when no camera limit can hide the thing; `aWhy` then says why. */
  a: CameraBox | null;
  aWhy?: string;
  /** Option b: a curtain, a hold, or both. */
  b: { curtain?: Curtain; hold?: { pan: [number, number]; frames: number } } | null;
}

export const POPINS: Readonly<Record<string, PopinEntry>> = {
  // The Annex's first screen already shows the cryo wing, where Sable's pod is the story's reveal.
  P1: {
    map: 'annex',
    what: 'The cryo wing and its pods show on the first screen of the Annex, long before the story walks there.',
    option: 'none',
    a: null,
    aWhy: 'The view at the map corner already spans x 0 to 640 and the pods stand at x 520 to 640. Hiding them needs a camera 120 px left of the map, a void.',
    b: { curtain: { mode: 'near', box: { x: 496, y: 0, w: 208, h: 272 }, focus: { x: 576, y: 88 }, radius: 208, fade: 96 } },
  },
  // Relays B and C stand within 640 px of the lattice, so cycling them shows the beams change.
  P2: {
    map: 'annex',
    what: 'From relay B or C the lattice is on screen, so the cycle shows what the relay feeds (Hex says he cannot see it).',
    option: 'none',
    a: null,
    aWhy: 'At relay B and relay C the view spans x 0 to 640 and the lattice stands at x 480. No camera box can leave it out.',
    b: { curtain: { mode: 'event', events: ['relay_b', 'relay_c'], box: { x: 448, y: 0, w: 256, h: 272 }, fade: 12 } },
  },
  // The lattice shutdown pans the camera 64 px, because the lattice is already in view.
  P3: {
    map: 'annex',
    what: 'The lattice shutdown pan slides the camera only 64 px, so “the camera finds the lattice” no longer reveals anything.',
    option: 'none',
    a: null,
    aWhy: 'The camera already moves its whole range (x 0 to 64). A limit could only make the pan shorter.',
    b: { hold: { pan: [30, 7], frames: 40 } },
  },
  // From the Rustyard's entrance the camera's top edge cuts through Knuckles' crew.
  P4: {
    map: 'rustyard',
    what: 'From the lot’s entrance the top of the screen shows Knuckles’ crew, cropped by the edge, before the story sends the player there.',
    option: 'none',
    a: { maxY: 128 },
    b: { curtain: { mode: 'near', box: { x: 0, y: 0, w: 544, h: 150 }, focus: { x: 272, y: 150 }, radius: 120, fade: 80 } },
  },
};

/** The review switch: `P1:b,P2:a`, `all:b`, `none`. Returns the forced options by item id. */
export function parsePopinSwitch(raw: string | null, ids: readonly string[] = Object.keys(POPINS)): Record<string, PopinOption> {
  const out: Record<string, PopinOption> = {};
  if (!raw) return out;
  for (const part of raw.split(',')) {
    const [id, opt] = part.split(':');
    const option = opt === 'a' || opt === 'b' ? opt : 'none';
    if (id === 'all') for (const each of ids) out[each] = option;
    else if (id && ids.includes(id)) out[id] = option;
  }
  return out;
}

/** The option of every item. */
export type PopinOptions = Readonly<Record<string, PopinOption>>;

/** The option each item runs with now: what ships, with the review switch applied. */
export function currentOptions(): PopinOptions {
  const forced = parsePopinSwitch(reviewSwitch('popin'));
  return Object.fromEntries(Object.entries(POPINS).map(([id, e]) => [id, forced[id] ?? e.option]));
}

/** The entries of a map that run with one option. */
function activeOn(map: string, option: 'a' | 'b', options: PopinOptions): PopinEntry[] {
  return Object.entries(POPINS).filter(([id, e]) => e.map === map && options[id] === option).map(([, e]) => e);
}

/** The camera limits in force on a map (option a items), merged: the widest range wins on each side. Null when none. */
export function cameraBoxFor(map: string, options: PopinOptions = currentOptions()): CameraBox | null {
  const boxes = activeOn(map, 'a', options).flatMap((e) => (e.a ? [e.a] : []));
  if (!boxes.length) return null;
  const merged: CameraBox = {};
  for (const b of boxes) {
    if (b.minX !== undefined) merged.minX = Math.min(merged.minX ?? b.minX, b.minX);
    if (b.maxX !== undefined) merged.maxX = Math.max(merged.maxX ?? b.maxX, b.maxX);
    if (b.minY !== undefined) merged.minY = Math.min(merged.minY ?? b.minY, b.minY);
    if (b.maxY !== undefined) merged.maxY = Math.max(merged.maxY ?? b.maxY, b.maxY);
  }
  return merged;
}

/** The curtains in force on a map (option b items). */
export function curtainsFor(map: string, options: PopinOptions = currentOptions()): Curtain[] {
  return activeOn(map, 'b', options).flatMap((e) => (e.b?.curtain ? [e.b.curtain] : []));
}

/** Frames to hold after a pan to tile (tx, ty) on a map, from the option b items in force. 0 when none. */
export function holdFor(map: string, tx: number, ty: number, options: PopinOptions = currentOptions()): number {
  let frames = 0;
  for (const e of activeOn(map, 'b', options)) if (e.b?.hold && e.b.hold.pan[0] === tx && e.b.hold.pan[1] === ty) frames = Math.max(frames, e.b.hold.frames);
  return frames;
}

/**
 * How closed a curtain is, 0 (open) to 1 (closed). `near`: from the leader's distance to the focus.
 * `event`: 1 while a listed event runs (the caller eases it), else 0.
 */
export function curtainClosed(c: Curtain, leader: { x: number; y: number }, runningEvent: string | null): number {
  if (c.mode === 'event') return runningEvent !== null && c.events.includes(runningEvent) ? 1 : 0;
  const d = Math.hypot(leader.x - c.focus.x, leader.y - c.focus.y);
  return Math.max(0, Math.min(1, (d - c.radius) / c.fade));
}
