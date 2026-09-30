/**
 * Trying art-pass options in the game (dev only). `?art=review` swaps in every option marked
 * ★ Best on the review page (/artreview.html, saved in media/art-pass/review.json);
 * `&try=<asset>/<option>,...` swaps in just those. The art lives in media/art-pass/ (git-ignored)
 * and comes through the dev server's /__artpass endpoint (vite.config.ts); scripts/pixellab/
 * generates it. `?art=pixellab` is the older name for Kit's and Rook's picks from the first tests.
 *
 * What can be swapped: field sprites (the crew, named NPCs, one-off NPCs and the townsfolk pool),
 * with their drawn walk cycles; the crew's battle sprites (drawn at the field's pixel size, twice as
 * fine as the battle world); enemies; and portraits. Swaps apply to anything built after them, so
 * boot waits for them before starting a scene.
 */
import { replaceBattler, type Pose } from '../art/battlers';
import { type CharLook, type CharSprite, type Dir, replaceCharSprite } from '../art/chars';
import { replaceEnemyArt } from '../art/enemies';
import { replacePortrait } from '../art/portraits';
import { ENEMIES } from '../data/enemies';
import { LOOKS } from '../data/looks';
import { getMap, mapIds } from '../data/maps';
import { addTerrainOverlay, type TerrainOverlay, TS } from '../field/tiles';

interface Option {
  id: string;
  status?: string;
  rotations?: Record<string, string>;
  anims?: Record<string, { frames?: Record<string, string[]> }>;
  image?: string;
  tiles?: { file: string; corners?: Record<string, string> | null }[];
  /** Battle key poses inpainted onto the standing sprite (scripts/pixellab/poses.mjs): tries per pose. */
  poses?: Record<string, string[]>;
}
/** Mark's flags on an option's frames and pose tries, by "<animation>/<direction>". */
type Flags = Record<string, number[]>;
/** A tileset's place in the game: the map, and which terrain types are its lower and upper. */
interface TerrainPlace {
  map: string;
  lower: string[];
  upper: string[];
  /** Counted as lower for the corners, but left as the game paints them (road markings, grates). */
  keep?: string[];
}
interface Asset {
  id: string;
  kind: string;
  look?: string;
  npc?: string;
  pool?: number;
  terrains?: TerrainPlace | null;
  options: Option[];
}
interface Review {
  assets: Record<string, { options?: Record<string, { verdict?: string | null }> }>;
}

const ROOT = '/media/art-pass/';
/** PixelLab's directions for the game's four facings. */
const FACING: Record<Dir, string> = { down: 'south', right: 'east', up: 'north', left: 'west' };

function loadImage(path: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`couldn't load ${path}`));
    img.src = ROOT + path;
  });
}

function toCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')?.drawImage(img, 0, 0);
  return c;
}

function mirror(c: HTMLCanvasElement): HTMLCanvasElement {
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

/** The lowest row with anything drawn in it (where the feet are). */
function feetRow(c: HTMLCanvasElement): number {
  const g = c.getContext('2d');
  if (!g) return c.height - 1;
  const px = g.getImageData(0, 0, c.width, c.height).data;
  for (let y = c.height - 1; y >= 0; y--) for (let x = 0; x < c.width; x++) if ((px[(y * c.width + x) * 4 + 3] ?? 0) > 0) return y;
  return c.height - 1;
}

/** The topmost row with anything drawn in it. */
function headRow(c: HTMLCanvasElement): number {
  const g = c.getContext('2d');
  if (!g) return 0;
  const px = g.getImageData(0, 0, c.width, c.height).data;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if ((px[(y * c.width + x) * 4 + 3] ?? 0) > 0) return y;
  return 0;
}

/** A field sprite from PixelLab rotations (and a walk cycle, if there is one). */
async function fieldSprite(o: Option): Promise<CharSprite> {
  const rot = o.rotations ?? {};
  const walkFrames = o.anims?.walk?.frames;
  const frames = {} as Record<Dir, HTMLCanvasElement[]>;
  const walk: Partial<Record<Dir, HTMLCanvasElement[]>> = {};
  for (const [dir, pl] of Object.entries(FACING) as [Dir, string][]) {
    const path = rot[pl];
    if (!path) throw new Error(`no ${pl} rotation`);
    const stand = toCanvas(await loadImage(path));
    frames[dir] = [stand, stand, stand];
    const w = walkFrames?.[pl];
    if (w?.length) walk[dir] = await Promise.all(w.map(async (p) => toCanvas(await loadImage(p))));
  }
  // A side view that came back without its walk borrows the other side's, mirrored; anything
  // else without a walk just stands (and glides).
  if (!walk.left && walk.right) walk.left = walk.right.map(mirror);
  if (!walk.right && walk.left) walk.right = walk.left.map(mirror);
  for (const d of Object.keys(FACING) as Dir[]) walk[d] ??= frames[d].slice(0, 1);
  const down = frames.down[0] as HTMLCanvasElement;
  const hasWalk = !!walkFrames;
  return { frames, w: down.width, h: down.height, ax: Math.floor(down.width / 2), ay: feetRow(down), walk: hasWalk ? (walk as Record<Dir, HTMLCanvasElement[]>) : undefined };
}

/** Every look used by a townsperson who isn't a named or one-off NPC (the pool's customers). */
function townsfolkLooks(oneOffs: Set<string>): CharLook[] {
  const named = new Set<CharLook>(Object.values(LOOKS));
  const out: CharLook[] = [];
  for (const mid of mapIds()) for (const n of getMap(mid).npcs ?? []) if (n.look && !named.has(n.look) && !oneOffs.has(`${mid}.${n.id}`)) out.push(n.look);
  return out;
}

const hashLook = (l: CharLook) => [...JSON.stringify(l)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

/** Battle poses from the drawn animations: which animation, and which of its frames. */
const POSE_FROM: Record<Pose, [string, number][]> = {
  idle: [['idle', 0]],
  attack: [['attack', 2], ['special', 2]],
  strike: [['attack', 4], ['attack', 3]],
  cast: [['cast', 3], ['special', 3], ['attack', 2]],
  item: [['item', 3]],
  hurt: [['hurt', 2], ['hurt', 1]],
  victory: [['victory', 3], ['idle', 0]],
  thrust: [['thrust', 4], ['attack', 3]],
  brace: [['attack', 1], ['idle', 2]],
  aim: [['cast', 2], ['attack', 1]],
};

/** The crew's light colours (as src/art/battlers.ts tints their procedural poses). */
const TINT: Record<string, string> = { kit: '#ffa24a', rook: '#ffe07a', hex: '#3fe0f0', sable: '#ff7a3a' };

/** Where a key pose's hand ended up: the topmost pixel that differs from the standing frame. */
function handOf(still: HTMLCanvasElement, pose: HTMLCanvasElement): [number, number] | null {
  const w = still.width;
  const h = still.height;
  const a = still.getContext('2d')?.getImageData(0, 0, w, h).data;
  const b = pose.getContext('2d')?.getImageData(0, 0, w, h).data;
  if (!a || !b) return null;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if ((b[i + 3] ?? 0) > 0 && ((a[i] ?? 0) !== b[i] || (a[i + 1] ?? 0) !== b[i + 1] || (a[i + 2] ?? 0) !== b[i + 2] || (a[i + 3] ?? 0) !== b[i + 3])) return [x, y];
    }
  return null;
}

/**
 * The light a key pose throws, drawn in pixels on a layer the battle renderer adds on top (it
 * pulses it): a spark gathering in a raised hand, or an impact burst at a fist with the arc it swept.
 * Phantasy Star IV sells its 2-3 frame moves the same way.
 */
function poseGlow(w: number, h: number, hand: [number, number], kind: 'raise' | 'strike', tint: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) return c;
  const [x, y] = hand;
  const dot = (px: number, py: number, color: string) => {
    g.fillStyle = color;
    g.fillRect(Math.round(px), Math.round(py), 1, 1);
  };
  const rays = (cx: number, cy: number, from: number, to: number, color: string) => {
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2 + Math.PI / 8;
      for (let r = from; r <= to; r++) dot(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, color);
    }
  };
  const halo = g.createRadialGradient(x, y, 0, x, y, kind === 'raise' ? 11 : 9);
  halo.addColorStop(0, tint);
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo;
  g.fillRect(x - 12, y - 12, 24, 24);
  if (kind === 'raise') {
    // A spark gathering over the open hand.
    rays(x, y - 3, 3, 5, '#ffffff');
    dot(x, y - 3, '#ffffff');
    dot(x - 1, y - 3, tint);
    dot(x + 1, y - 3, tint);
  } else {
    // Impact at the fist, and the arc it swept up from the shoulder.
    rays(x + 1, y - 1, 3, 7, '#ffffff');
    for (let t = 0; t <= 1; t += 0.04) {
      const ax = x - 26 + 26 * t + Math.sin(t * Math.PI) * -6;
      const ay = y + 26 - 26 * t - Math.sin(t * Math.PI) * 8;
      dot(ax, ay, t > 0.5 ? '#ffffff' : tint);
    }
  }
  return c;
}

async function battleFrames(o: Option, member: string, flags: Flags): Promise<{ frames: Partial<Record<Pose, HTMLCanvasElement>>; glow: Partial<Record<Pose, HTMLCanvasElement>> }> {
  const out: Partial<Record<Pose, HTMLCanvasElement>> = {};
  const glow: Partial<Record<Pose, HTMLCanvasElement>> = {};
  // Mark's review (2026-09-30): PixelLab's battle animations are unusable (bodies drift, clothes
  // change, the moves don't read). The battle renderer animates with code anyway (lunge, strike
  // smear, hurt drop, hop, breathing), so every pose uses the standing back view, unless
  // `&frames=anim` asks for the drawn frames.
  const useAnims = new URLSearchParams(location.search).get('frames') === 'anim';
  if (!useAnims && o.rotations?.north) {
    const still = toCanvas(await loadImage(o.rotations.north));
    for (const pose of Object.keys(POSE_FROM) as Pose[]) out[pose] = still;
    // Key poses inpainted onto the standing frame, if there are any: the first try Mark didn't flag.
    const pick = async (name: string) => {
      const bad = new Set(flags[`pose-${name}/north`] ?? []);
      const i = (o.poses?.[name] ?? []).findIndex((_, n) => !bad.has(n));
      const path = i >= 0 ? o.poses?.[name]?.[i] : undefined;
      return path ? toCanvas(await loadImage(path)) : null;
    };
    const tint = TINT[member] ?? '#ffffff';
    const raise = await pick('raise');
    const strike = await pick('strike');
    const raiseHand = raise && handOf(still, raise);
    const strikeHand = strike && handOf(still, strike);
    for (const pose of ['cast', 'item', 'aim', 'victory'] as Pose[]) {
      if (!raise) continue;
      out[pose] = raise;
      if (raiseHand && pose !== 'victory') glow[pose] = poseGlow(still.width, still.height, raiseHand, 'raise', tint);
    }
    for (const pose of ['attack', 'strike', 'thrust'] as Pose[]) {
      if (!strike) continue;
      out[pose] = strike;
      if (strikeHand && pose !== 'attack') glow[pose] = poseGlow(still.width, still.height, strikeHand, 'strike', tint);
    }
    return { frames: out, glow };
  }
  for (const [pose, choices] of Object.entries(POSE_FROM) as [Pose, [string, number][]][]) {
    for (const [anim, i] of choices) {
      const frames = o.anims?.[anim]?.frames?.north;
      if (!frames?.length) continue;
      const path = frames[Math.min(i, frames.length - 1)];
      if (!path) continue;
      out[pose] = toCanvas(await loadImage(path));
      break;
    }
    if (!out[pose] && o.rotations?.north) out[pose] = toCanvas(await loadImage(o.rotations.north));
  }
  return { frames: out, glow };
}

/**
 * Lay a Wang tileset over the terrain it stands for. Every map corner (where four cells meet) is
 * upper when at least half of the covered cells around it are; each covered cell then takes the
 * tile whose four corners match. So where upper meets lower, the lower side's edge cells carry the
 * transition (the curb, the bank), and cells of other terrain are left as the game paints them.
 */
async function terrainOverlay(o: Option, place: TerrainPlace): Promise<TerrainOverlay> {
  const byCorners = new Map<string, HTMLImageElement>();
  for (const t of o.tiles ?? []) {
    const c = t.corners;
    if (c) byCorners.set(`${c.NW}|${c.NE}|${c.SW}|${c.SE}`, await loadImage(t.file));
  }
  const lower = new Set([...place.lower, ...(place.keep ?? [])]);
  const upper = new Set(place.upper);
  const keep = new Set(place.keep ?? []);
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
        const img = byCorners.get(`${corner(x, y)}|${corner(x + 1, y)}|${corner(x, y + 1)}|${corner(x + 1, y + 1)}`);
        if (img) g.drawImage(img, x * TS, y * TS, TS, TS);
      }
  };
}

/** Apply one option. Returns a label for the notice, or throws. */
async function apply(a: Asset, o: Option, pool: Map<number, CharSprite>, flags: Flags): Promise<string> {
  const [, key = ''] = a.id.split('.');
  if (a.kind === 'field' && key in LOOKS) {
    replaceCharSprite(LOOKS[key as keyof typeof LOOKS], await fieldSprite(o));
    return key;
  }
  if (a.kind === 'npc') {
    const sprite = await fieldSprite(o);
    if (a.look && a.look in LOOKS) replaceCharSprite(LOOKS[a.look as keyof typeof LOOKS], sprite);
    else if (a.npc) {
      const [mid = '', nid] = a.npc.split('.');
      const n = getMap(mid).npcs?.find((x) => x.id === nid);
      if (!n) throw new Error(`no NPC ${a.npc}`);
      replaceCharSprite(n.look, sprite);
    } else if (a.pool != null) pool.set(a.pool, sprite);
    return a.id;
  }
  if (a.kind === 'battler' && key in LOOKS) {
    const { frames, glow } = await battleFrames(o, key, flags);
    const idle = frames.idle;
    if (!idle) throw new Error('no idle frame');
    // Head height in battle pixels, for the arrow and the damage numbers.
    replaceBattler(key, LOOKS[key as keyof typeof LOOKS], frames, Math.ceil((feetRow(idle) - headRow(idle)) / 2), 2, glow);
    return `${key} (battle)`;
  }
  if (a.kind === 'enemy' && o.image) {
    const sprite = ENEMIES[key]?.sprite;
    if (!sprite) throw new Error(`no enemy ${key}`);
    replaceEnemyArt(sprite, toCanvas(await loadImage(o.image)));
    return ENEMIES[key]?.name ?? key;
  }
  if (a.kind === 'tileset' && o.tiles?.length) {
    if (!a.terrains) throw new Error('no map uses this terrain yet');
    addTerrainOverlay(await terrainOverlay(o, a.terrains));
    return `${key} terrain`;
  }
  if (a.kind === 'portrait' && o.image) {
    replacePortrait(key, await loadImage(o.image));
    return `${key} (portrait)`;
  }
  throw new Error(`can't try ${a.kind} in the game yet`);
}

/** Swap in the chosen options. Resolves with what was swapped and what couldn't be. */
export async function applyReview(params: URLSearchParams): Promise<{ done: string[]; failed: string[] }> {
  const res = await fetch('/__artpass/data', { cache: 'no-store' });
  const data = (await res.json()) as { ok: boolean; assets: Asset[]; review: Review; problem?: string };
  if (!data.ok) throw new Error(data.problem ?? `art pass: HTTP ${res.status}`);
  const byId = new Map(data.assets.map((a) => [a.id, a]));
  let picks: [string, string][];
  const tryList = params.get('try');
  if (params.get('art') === 'pixellab') picks = [['crew.kit', 'chosen'], ['crew.rook', 'chosen']];
  else if (tryList) picks = tryList.split(',').map((t) => t.split('/') as [string, string]);
  else picks = Object.entries(data.review.assets ?? {}).flatMap(([aid, r]) => Object.entries(r.options ?? {}).filter(([, v]) => v.verdict === 'best').map(([oid]) => [aid, oid] as [string, string]));
  const oneOffs = new Set(data.assets.flatMap((a) => (a.npc ? [a.npc] : [])));
  const pool = new Map<number, CharSprite>();
  const done: string[] = [];
  const failed: string[] = [];
  for (const [aid, oid] of picks) {
    const a = byId.get(aid);
    const o = a?.options.find((x) => x.id === oid);
    // A character still getting its animations can be tried already.
    if (!a || !o || (o.status !== 'done' && !o.rotations)) {
      failed.push(`${aid}/${oid} (not generated)`);
      continue;
    }
    try {
      done.push(await apply(a, o, pool, (data.review.assets?.[aid]?.options?.[oid] as { flags?: Flags } | undefined)?.flags ?? {}));
    } catch (e) {
      failed.push(`${aid}/${oid}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // Townsfolk: every passer-by takes one of the pool looks that were picked (stable per look).
  if (pool.size) {
    const sprites = [...pool.values()];
    for (const look of townsfolkLooks(oneOffs)) {
      const sp = sprites[hashLook(look) % sprites.length];
      if (sp) replaceCharSprite(look, sp);
    }
    done.push(`${pool.size} townsfolk looks`);
  }
  return { done, failed };
}
