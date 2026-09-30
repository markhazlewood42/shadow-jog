/**
 * Drawn art: the PixelLab art pass's picks, loaded at startup in place of the art the game draws in
 * code. `scripts/pixellab/export-picks.mjs` writes them to `public/art/` (shipped with the build)
 * with a manifest; `loadDrawnArt()` reads it and hands each piece to its art cache's replace hook
 * (characters, the crew's battle sprites, enemies, terrain, props). Anything that doesn't load keeps
 * the code-drawn art, and says so. `?art=classic` skips all of it (for comparing).
 *
 * The helpers below are shared with the review tool's in-game try (`src/dev/artswap.ts`).
 */
import { replaceBattler } from './battlers';
import { type CharLook, type CharSprite, type Dir, replaceCharSprite } from './chars';
import { replaceEnemyArt } from './enemies';
import { FACES, replacePortrait } from './portraits';
import { LOOKS } from '../data/looks';
import { getMap, mapIds } from '../data/maps';
import { replacePropArt } from '../field/props';
import { addTerrainOverlay, type TerrainOverlay, TS } from '../field/tiles';
import type { PropKind } from '../field/types';

/** A tileset's place in the game: its map, and which terrain types are its lower and upper. */
export interface TerrainPlace {
  map: string;
  lower: string[];
  upper: string[];
  /** Counted as lower for the corners, but left as the game paints them (road markings, grates). */
  keep?: string[] | undefined;
  /** Draw cells that are all upper (false: only the lower terrain and its edges, e.g. canal banks). */
  drawUpper?: boolean | undefined;
}

interface Manifest {
  version: number;
  chars: { id: string; file: string; cell: number; frames: number; look?: string; npc?: string; pool?: number }[];
  battlers: Record<string, { file: string }>;
  enemies: Record<string, { file: string }>;
  tilesets: (TerrainPlace & { id: string; file: string; corners: (string | null)[] })[];
  props: Record<string, { file: string }>;
  /** Dialogue portraits: a file per expression; a missing expression uses the neutral face. */
  portraits?: Record<string, Record<string, string>>;
  /** Every one-off NPC the pass covered (map.id), picked or not: they're never townsfolk. */
  oneOffs?: string[];
}

// ------------------------------------------------------------------ shared helpers

export function toCanvas(img: CanvasImageSource & { width: number; height: number }, sx = 0, sy = 0, w = img.width, h = img.height): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')?.drawImage(img, sx, sy, w, h, 0, 0, w, h);
  return c;
}

export function mirror(c: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = c.width;
  out.height = c.height;
  const g = out.getContext('2d');
  if (g) {
    g.scale(-1, 1);
    g.drawImage(c, -c.width, 0);
  }
  return out;
}

function alphaRows(c: HTMLCanvasElement): number[] {
  const g = c.getContext('2d');
  if (!g) return [];
  const px = g.getImageData(0, 0, c.width, c.height).data;
  const rows: number[] = [];
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if ((px[(y * c.width + x) * 4 + 3] ?? 0) > 0) {
    rows.push(y);
    break;
  }
  return rows;
}

/** The lowest row with anything drawn in it (where the feet are). */
export function feetRow(c: HTMLCanvasElement): number {
  return alphaRows(c).at(-1) ?? c.height - 1;
}

/** The topmost row with anything drawn in it. */
export function headRow(c: HTMLCanvasElement): number {
  return alphaRows(c)[0] ?? 0;
}

/** A field sprite from standing frames and (optionally) a walk cycle per facing. */
export function spriteFrom(stand: Record<Dir, HTMLCanvasElement>, walks: Partial<Record<Dir, HTMLCanvasElement[]>> | null, bounce = false): CharSprite {
  const frames = {} as Record<Dir, HTMLCanvasElement[]>;
  for (const d of Object.keys(stand) as Dir[]) frames[d] = [stand[d], stand[d], stand[d]];
  let walk: Record<Dir, HTMLCanvasElement[]> | undefined;
  if (walks) {
    // A side view without its walk borrows the other side's, mirrored; anything else stands.
    const w = { ...walks };
    if (!w.left?.length && w.right?.length) w.left = w.right.map(mirror);
    if (!w.right?.length && w.left?.length) w.right = w.left.map(mirror);
    walk = {} as Record<Dir, HTMLCanvasElement[]>;
    for (const d of Object.keys(stand) as Dir[]) walk[d] = w[d]?.length ? w[d] : [stand[d]];
  }
  const down = stand.down;
  return { frames, w: down.width, h: down.height, ax: Math.floor(down.width / 2), ay: feetRow(down), walk, bounce };
}

/** Every look used by a townsperson who isn't a named or one-off NPC (the townsfolk pool's customers). */
export function townsfolkLooks(oneOffs: Set<string>): CharLook[] {
  const named = new Set<CharLook>(Object.values(LOOKS));
  const out: CharLook[] = [];
  for (const mid of mapIds()) for (const n of getMap(mid).npcs ?? []) if (n.look && !named.has(n.look) && !oneOffs.has(`${mid}.${n.id}`)) out.push(n.look);
  return out;
}

/** A stable number per look, to spread the passers-by over the pool. */
export const hashLook = (l: CharLook) => [...JSON.stringify(l)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

/**
 * Lay a Wang tileset over the terrain it stands for. Every map corner (where four cells meet) is
 * upper when at least half of the covered cells around it are; each covered cell then takes the
 * tile whose four corners match. So where upper meets lower, the lower side's edge cells carry the
 * transition (the curb, the bank), and cells of other terrain are left as the game paints them.
 */
export function wangOverlay(byCorners: Map<string, CanvasImageSource>, place: TerrainPlace): TerrainOverlay {
  const lower = new Set([...place.lower, ...(place.keep ?? [])]);
  const upper = new Set(place.upper);
  const keep = new Set(place.keep ?? []);
  const drawUpper = place.drawUpper !== false;
  return (g, q) => {
    const kind = (x: number, y: number) => {
      const id = q.at(x, y);
      return upper.has(id) ? 1 : lower.has(id) ? 0 : -1;
    };
    const corner = (vx: number, vy: number) => {
      let up = 0;
      let n = 0;
      for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
        const k = kind(vx + dx, vy + dy);
        if (k < 0) continue;
        n++;
        up += k;
      }
      return n && up * 2 >= n ? 'upper' : 'lower';
    };
    for (let y = 0; y < q.h; y++)
      for (let x = 0; x < q.w; x++) {
        if (kind(x, y) < 0 || keep.has(q.at(x, y))) continue;
        const cs = [corner(x, y), corner(x + 1, y), corner(x, y + 1), corner(x + 1, y + 1)];
        if (!drawUpper && cs.every((c) => c === 'upper')) continue;
        const img = byCorners.get(cs.join('|'));
        if (img) g.drawImage(img, x * TS, y * TS, TS, TS);
      }
  };
}

// ------------------------------------------------------------------ loading the picks

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`couldn't load ${src}`));
    img.src = src;
  });
}

/** Game facings, in the order the export lays out a character sheet's rows. */
const ROWS: Dir[] = ['down', 'right', 'up', 'left'];

/**
 * Load the drawn art and swap it in. Resolves with what was swapped and what wasn't (with why);
 * it never rejects for a missing piece, which just keeps its code-drawn art.
 */
/** The kinds of drawn art, each of which can be loaded or left code-drawn. */
export type DrawnKind = 'chars' | 'battlers' | 'enemies' | 'tilesets' | 'props' | 'portraits';
export const ALL_DRAWN: readonly DrawnKind[] = ['chars', 'battlers', 'enemies', 'tilesets', 'props', 'portraits'];
/**
 * What the game loads by default (Mark, 2026-09-30): the PixelLab tilesets and props he liked; the
 * characters, enemies and portraits went back to code-drawn art (to be upgraded in code).
 */
export const DEFAULT_DRAWN: readonly DrawnKind[] = ['tilesets', 'props'];

export async function loadDrawnArt(base = 'art/', kinds: readonly DrawnKind[] = DEFAULT_DRAWN): Promise<{ done: number; failed: string[] }> {
  const res = await fetch(`${base}manifest.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`no drawn art (${res.status})`);
  const full = (await res.json()) as Manifest;
  // Only the kinds asked for; the rest keep their code-drawn art.
  const on = new Set(kinds);
  const m: Manifest = {
    ...full,
    chars: on.has('chars') ? full.chars : [],
    battlers: on.has('battlers') ? full.battlers : {},
    enemies: on.has('enemies') ? full.enemies : {},
    tilesets: on.has('tilesets') ? full.tilesets : [],
    props: on.has('props') ? full.props : {},
    portraits: on.has('portraits') ? (full.portraits ?? {}) : {},
  };
  const failed: string[] = [];
  let done = 0;
  const each = async <T>(items: [string, T][], fn: (key: string, item: T) => Promise<void>) => {
    await Promise.all(
      items.map(async ([key, item]) => {
        try {
          await fn(key, item);
          done++;
        } catch (e) {
          failed.push(`${key}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }),
    );
  };
  // Characters: a sheet per character, a row per facing (standing frame, then the walk).
  const oneOffs = new Set(m.oneOffs ?? []);
  const pool: CharSprite[] = [];
  await each(
    m.chars.map((c) => [c.id, c] as [string, (typeof m.chars)[number]]),
    async (_id, c) => {
      const sheet = await loadImage(base + c.file);
      const stand = {} as Record<Dir, HTMLCanvasElement>;
      const walks: Partial<Record<Dir, HTMLCanvasElement[]>> = {};
      ROWS.forEach((d, row) => {
        stand[d] = toCanvas(sheet, 0, row * c.cell, c.cell, c.cell);
        walks[d] = Array.from({ length: c.frames - 1 }, (_, k) => toCanvas(sheet, (k + 1) * c.cell, row * c.cell, c.cell, c.cell));
      });
      const look: CharLook | undefined = c.look ? LOOKS[c.look as keyof typeof LOOKS] : undefined;
      const sprite = spriteFrom(stand, c.frames > 1 ? walks : null, look?.idle === 'bounce');
      if (look) replaceCharSprite(look, sprite);
      else if (c.npc) {
        const [mid = '', nid] = c.npc.split('.');
        const n = getMap(mid).npcs?.find((x) => x.id === nid);
        if (!n) throw new Error(`no NPC ${c.npc}`);
        replaceCharSprite(n.look, sprite);
      } else if (c.pool != null) pool.push(sprite);
    },
  );
  // Townsfolk: every passer-by takes one of the pool's looks (stable per look).
  if (pool.length) for (const look of townsfolkLooks(oneOffs)) replaceCharSprite(look, pool[hashLook(look) % pool.length] as CharSprite);
  // The crew in battle: the standing back view for every pose; the battle animates it in code.
  await each(Object.entries(m.battlers), async (key, b) => {
    const look = LOOKS[key as keyof typeof LOOKS];
    if (!look) throw new Error('not a crew member');
    const still = toCanvas(await loadImage(base + b.file));
    const frames = { idle: still, attack: still, strike: still, cast: still, item: still, hurt: still, victory: still, thrust: still, brace: still, aim: still };
    // Head height in battle pixels (the art is at twice the battle world's resolution).
    replaceBattler(key, look, frames, Math.ceil((feetRow(still) - headRow(still)) / 2));
  });
  await each(Object.entries(m.enemies), async (sprite, e) => replaceEnemyArt(sprite, toCanvas(await loadImage(base + e.file))));
  // Tilesets, in the manifest's order (the canal's banks go over the street and plaza they meet).
  const overlays: TerrainOverlay[] = [];
  await each(
    m.tilesets.map((t, i) => [t.id, { t, i }] as [string, { t: (typeof m.tilesets)[number]; i: number }]),
    async (_id, { t, i }) => {
      const sheet = await loadImage(base + t.file);
      const byCorners = new Map<string, CanvasImageSource>();
      t.corners.forEach((c, k) => {
        if (c) byCorners.set(c, toCanvas(sheet, (k % 4) * TS, Math.floor(k / 4) * TS, TS, TS));
      });
      overlays[i] = wangOverlay(byCorners, t);
    },
  );
  for (const o of overlays) if (o) addTerrainOverlay(o);
  await each(Object.entries(m.props), async (kind, p) => replacePropArt(kind as PropKind, toCanvas(await loadImage(base + p.file))));
  await each(Object.entries(m.portraits ?? {}), async (key, files) => {
    const neutral = files.neutral;
    if (!neutral) throw new Error('no neutral face');
    // Every expression without its own drawing uses the neutral one, all in the new style.
    replacePortrait(key, await loadImage(base + neutral));
    for (const face of FACES) {
      const f = files[face];
      if (f && face !== 'neutral') replacePortrait(key, await loadImage(base + f), [face]);
    }
  });
  return { done, failed };
}
