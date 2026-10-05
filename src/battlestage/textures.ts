/**
 * The asset pipeline of the battle stage on the Shadow Jog Engine (step B1 of the engine-platform spike): everything
 * the stage draws gets here as a `TextureManager` texture. This file is the Phaser spike's `src/stage/textures.ts`
 * run through the translation table (docs/engine/migration.md section 6). The logic is the spike's; only the
 * texture calls changed (`textures.addCanvas`, `addFrames`, the data bag, `prune`).
 *
 *  1. **Our own generated art.** The game paints its backdrops and enemies in code onto HTML canvases
 *     (`src/art/battlebg.ts`, `src/art/enemies.ts`). A canvas becomes a texture with `textures.addCanvas(key, canvas)`.
 *     Each canvas is added ONCE under a stable key and found again by key afterwards, so rebuilding the stage never
 *     uploads the same picture twice (a texture leak). What we learned about a texture (its feet, its face) is kept in
 *     the texture's data bag (`texture.data`, Phaser's `customData`), so a scene restart only makes new game objects.
 *  2. **Mark's Sprite Fusion sheets.** A sheet is one PNG with every frame side by side. The engine has no loader
 *     yet (it is built on demand, M1), so `loadSheetTextures` fetches the PNG, draws it on a canvas and adds the
 *     canvas plus one named frame per cell (`addFrames`). The files stay in Mark's git-ignored folder.
 *  3. **The stage itself.** The wall and the floor are painted pixel by pixel from the stage config (`floor.ts`,
 *     `sewerwall.ts`) and baked into ONE 480x270 texture, named after a fingerprint of the config that made it.
 *  4. **Variants.** The depth haze blends a figure toward the fog colour, and a hit flashes it white. Both are baked as
 *     copies of the figure's texture (once each, found again by name) instead of being redone every frame.
 *  5. **Small things made from numbers:** contact shadows and rings.
 *
 * Not ported yet (the HUD is off in this slice): the face chips (`faceTexture`) and the effects picture.
 *
 * Tags (docs/engine/conventions.md): `addCanvasOnce`, `variantOf`, `readTexture` and `dropCrewTextures` are game-side helpers (ours). The engine's TextureManager
 * says it will get `addCanvasOnce` and `variantOf` at M3 (on demand); until then they live here, and nothing in this file needs more of the engine than the
 * public `TextureManager` (`addCanvas`, `addFrames`, `get`, `exists`, `prune`, `remove`).
 *
 * Pixel-art rule: textures use NEAREST filtering. The engine makes that the default for every texture it creates
 * (`TextureStyle.defaultOptions.scaleMode`), so the spike's per-texture `crisp()` calls are gone.
 *
 * Why a texture's pixels are read back through its CANVAS (`readTexture`): the spike read them back through a 2D
 * canvas too (`getSourceImage()` then `drawImage`). A canvas stores colour premultiplied by alpha, so a half
 * transparent pixel loses a little precision each time it passes through one. Doing the same here keeps every baked
 * variant bit for bit what the spike made.
 */
import type { SjTexture, TextureManager } from '../sje';
import { battleBg } from '../art/battlebg';
import { enemyArt } from '../art/enemies';
import { boxOf, type Box } from '../art/rig2/sfgeom';
import { SCREEN_H, SCREEN_W, type ShadowStyle, type StageConfig } from './config';
import { sheetFolder } from './crew';
import { cutSheet, footAnchor, type FootAnchor } from './feet';
import { CREW_FACES, defaultHead, ENEMY_FACES, ENEMY_GRAIN, ENEMY_HEADS, type Pt, type Rect } from './faces';
import { paintFloor, reprojectWall } from './floor';
import type { IdleKind } from './idle';
import { hexRgb, lum, mix, type Raw, type RGB } from './pixels';
import { ringRaw, shadowRaw } from './shadow';
import { bakeSheet, type BakePlan, type HeroesFile, type Proportion, planFor, proportionTag } from './proportions';
import { paintWall } from './sewerwall';

// ------------------------------------------------------------------ Mark's Sprite Fusion sheets

/** Where the dev server finds Mark's extracted animations (a link to his local folder; never committed). */
const SHEET_BASE = '/spritefusion-tests/extracted/';

/** What a sheet's `metadata.json` says (only the fields we use). */
export interface SheetMeta {
  frame_w: number;
  frame_h: number;
  frame_count: number;
  fps: number;
}

const isPositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Fetch and check the sheet description of each crew member in `ids` before the game starts (so a missing file is one
 * readable error, not a blank stage). Without Mark's folder Vite does NOT answer 404: for a path it cannot find it
 * sends the app's own page (200, text/html). So "the answer is not JSON" counts as missing as well as a real 404, and
 * either way this throws and the lab uses the stand-ins instead.
 */
export async function fetchSheetMetas(ids: readonly string[]): Promise<Record<string, SheetMeta>> {
  const out: Record<string, SheetMeta> = {};
  await Promise.all(
    ids.map(async (id) => {
      const url = `${SHEET_BASE}${sheetFolder(id)}/metadata.json`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: ${res.status} (is the spritefusion-tests link in place?)`);
      if (!(res.headers.get('content-type') ?? '').includes('json')) throw new Error(`${url}: answered with ${res.headers.get('content-type') ?? 'no type'}, not JSON (is the spritefusion-tests link in place?)`);
      const m = (await res.json()) as Partial<SheetMeta>;
      if (!isPositive(m.frame_w) || !isPositive(m.frame_h) || !isPositive(m.frame_count) || !isPositive(m.fps)) throw new Error(`${url}: frame_w, frame_h, frame_count and fps must be positive numbers`);
      out[id] = { frame_w: m.frame_w, frame_h: m.frame_h, frame_count: m.frame_count, fps: m.fps };
    }),
  );
  return out;
}

// ------------------------------------------------------------------ stand-in crew (machines without Mark's folder)

/**
 * Simple code-drawn figures with the same sheet layout (one row of frames), used when Mark's folder is not there, so the
 * lab, its tests and CI still run the whole pipeline (animation, feet, depth, shadows). They are blocks, not art.
 */
const STAND_INS: Record<string, { w: number; h: number; height: number; colour: string }> = {
  hex: { w: 64, h: 64, height: 50, colour: '#8a5cc8' },
  sable: { w: 64, h: 64, height: 54, colour: '#b04a3a' },
  rook: { w: 79, h: 68, height: 58, colour: '#6a7a3a' },
  kit: { w: 64, h: 64, height: 52, colour: '#e8883a' },
};

/** The sheet descriptions the stand-ins have (8 frames at 8 fps, like Mark's idles). */
export function standInMetas(ids: readonly string[]): Record<string, SheetMeta> {
  const out: Record<string, SheetMeta> = {};
  for (const id of ids) {
    const s = STAND_INS[id];
    if (!s) throw new Error(`No stand-in figure for crew member "${id}"`);
    out[id] = { frame_w: s.w, frame_h: s.h, frame_count: 8, fps: 8 };
  }
  return out;
}

/** A stand-in's face point in frame 0 (the middle of its head block). */
function standInFace(id: string): Pt {
  const s = STAND_INS[id];
  if (!s) throw new Error(`No stand-in figure for crew member "${id}"`);
  return { x: Math.round(s.w / 2), y: s.h - 2 - s.height + 6 };
}

export const sheetKey = (id: string): string => `crew-${id}`;

/** Add one named frame per cell of a one-row sheet: frame `i` is the i-th cell. (Phaser: `texture.add(i, 0, x, y, w, h)`.) */
function addCells(textures: TextureManager, key: string, cellW: number, cellH: number, count: number): void {
  const frames: Record<number, [number, number, number, number]> = {};
  for (let i = 0; i < count; i++) frames[i] = [i * cellW, 0, cellW, cellH];
  textures.addFrames(key, frames);
}

/** Draw the stand-in sheets (in place of loading Mark's files). A sheet already added is skipped, so a restart does not add it twice. */
export function addStandInSheets(textures: TextureManager, metas: Record<string, SheetMeta>): void {
  for (const [id, m] of Object.entries(metas)) {
    const s = STAND_INS[id];
    if (!s || textures.exists(sheetKey(id))) continue;
    const sheet = surface(m.frame_w * m.frame_count, m.frame_h);
    for (let i = 0; i < m.frame_count; i++) {
      const bob = i % 4 < 2 ? 0 : -1; // the idle bounce: up one pixel for half the loop
      const cx = i * m.frame_w + Math.round(m.frame_w / 2);
      const feet = m.frame_h - 2 + bob;
      const g = sheet.g;
      g.fillStyle = '#101018';
      g.fillRect(cx - 7, feet - 14, 6, 14); // legs
      g.fillRect(cx + 1, feet - 14, 6, 14);
      g.fillStyle = s.colour;
      g.fillRect(cx - 9, feet - s.height + 12, 18, s.height - 28); // body
      g.fillStyle = '#e8c8a0';
      g.fillRect(cx - 5, feet - s.height, 10, 12); // head
    }
    addCanvasOnce(textures, sheetKey(id), sheet.canvas);
    addCells(textures, sheetKey(id), m.frame_w, m.frame_h, m.frame_count);
  }
}

/**
 * Load Mark's sheets in `ids` as textures. Replaces Phaser's `load.spritesheet` (deviation: the engine has no loader yet, it is built on demand at M1): fetch
 * the PNG, draw it on a canvas, add the canvas and its cells. A sheet already in the texture list is skipped.
 * A plain `drawImage` of the decoded picture is what the spike's read-back did too, so the pixels are the same.
 */
export async function loadSheetTextures(textures: TextureManager, metas: Record<string, SheetMeta>, ids: readonly string[]): Promise<void> {
  await Promise.all(
    ids.map(async (id) => {
      if (textures.exists(sheetKey(id))) return;
      const m = metas[id];
      if (!m) throw new Error(`No metadata for ${id}`);
      const url = `${SHEET_BASE}${sheetFolder(id)}/spritesheet.png`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`A file did not load: ${url} (is the spritefusion-tests link in place?)`);
      const image = await createImageBitmap(await res.blob());
      const sheet = surface(image.width, image.height);
      sheet.g.drawImage(image, 0, 0);
      image.close();
      // Another call may have added it while this one waited for the network.
      if (textures.exists(sheetKey(id))) return;
      addCanvasOnce(textures, sheetKey(id), sheet.canvas);
      addCells(textures, sheetKey(id), m.frame_w, m.frame_h, m.frame_count);
    }),
  );
}

/** Remove every texture made from a crew sheet (the sheets, the baked sheets, and the haze copies of them). Used when the lab switches between Mark's art and the stand-ins. */
export function dropCrewTextures(textures: TextureManager): void {
  for (const key of textures.getTextureKeys()) if (key.includes('crew')) textures.remove(key);
}

/** A texture's pixels, read back through its canvas (to find the feet, cut a face or bake a variant). */
export function readTexture(textures: TextureManager, key: string): Raw {
  return canvasToRaw(canvasOf(textures.get(key)));
}

/** The canvas a texture was made from, kept in its data bag by `addCanvasOnce`. */
function canvasOf(texture: SjTexture): HTMLCanvasElement {
  const canvas = texture.data.canvas;
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error(`texture "${texture.key}" has no canvas in its data bag (was it added with addCanvasOnce?)`);
  return canvas;
}

/**
 * What the stage knows about one standing figure's art, kept on its texture: the pixels of the picture its face is cut
 * from (frame 0 of a crew sheet, or an enemy's art as drawn), the drawn bounds and the feet in that picture, the face
 * point and the grain (see `faces.ts`).
 */
export interface FigureArt {
  /** Frame 0's pixels (crew) or the whole art (enemy), un-tinted. */
  raw: Raw;
  /** The drawn bounds in `raw`. */
  box: Box;
  /** Where the feet are in `raw`: x is the middle of the boots, y the row under the lowest sole. */
  foot: FootAnchor;
  /** The face point in `raw`'s own pixels. */
  face: Pt;
  /** The head's crop rectangle in `raw`'s own pixels (enemies; the HUD's portraits are cut from it). The crew's faces are cut round `face`. */
  head?: Rect;
  /** Screen pixels per art pixel (1 for the crew, 2 for the shipped enemies). */
  grain: number;
  /** Set on a figure that is the MIRROR IMAGE of another (`mirrorFigure` in `facing.ts`): the figure it was made from. */
  mirrorOf?: FigureArt;
}

/** What we remember about a crew sheet as Mark drew it, on its texture: the frames cut out and the foot anchor measured on them (read from the canvas once). */
interface SheetData {
  drawn?: { frames: Raw[]; foot: FootAnchor };
}

/** The proportions a hero has when nothing says otherwise: the art as drawn. */
export const AS_DRAWN: Proportion = { height: 1, build: 1 };

/** The texture name of a hero's sheet baked with these proportions (the bracket ends the name, so one name is never the start of another). */
export const bakedKey = (id: string, p: Proportion): string => `crewb-${id}[${proportionTag(p)}]`;

/** The measurements of a crew member's BAKED sheet (see `proportions.ts`): where they stand and what they look like on the stage. */
export interface CrewInfo {
  /** The baked sheet's texture (a numbered cell for each idle frame). */
  texture: string;
  /** The size of one cell of the baked sheet. */
  frameW: number;
  frameH: number;
  /** Where the feet are in a baked cell, measured again from the baked frames. */
  foot: FootAnchor;
  /** Frame 0 of the baked sheet, its bounds and face (the stage rules, the shadow and the name tabs all read these). */
  fig: FigureArt;
  /** The rows and columns the bake added or dropped, chosen once from frame 0. */
  plan: BakePlan;
  /** The sheet as Mark drew it (frames and foot anchor): what the strike and punch pictures are built from, then baked with `plan`. */
  drawn: { frames: Raw[]; foot: FootAnchor };
  /** How far the re-measured foot is from where the drawn foot anchor went (0 unless a column landed inside the boots). */
  footDelta: { x: number; y: number };
}

/** What a baked sheet's texture remembers. */
interface BakedData {
  info: CrewInfo;
}

/**
 * A crew member's idle sheet baked with these proportions: whole rows and columns added to or dropped from every frame
 * (see `proportions.ts`), laid out as a new sheet texture, with the feet, bounds and face measured again from the baked
 * frames. Made once per set of numbers (the name carries them); asking again finds it.
 */
export function bakeCrew(textures: TextureManager, id: string, meta: SheetMeta, p: Proportion, standIns: boolean): CrewInfo {
  const key = bakedKey(id, p);
  if (textures.exists(key)) return textures.get(key).data.info as BakedData['info'];
  const source = textures.get(sheetKey(id));
  const data = source.data as SheetData;
  if (!data.drawn) {
    const frames = cutSheet(readTexture(textures, sheetKey(id)), meta.frame_w, meta.frame_count);
    data.drawn = { frames, foot: footAnchor(frames) };
  }
  const drawn = data.drawn;
  const first = drawn.frames[0];
  if (!first) throw new Error(`The sheet for ${id} has no frames`);
  const face = standIns ? standInFace(id) : CREW_FACES[id];
  if (!face) throw new Error(`No face point is known for crew member "${id}"`);
  // The picks are made once, on frame 0, and laid on every frame.
  const plan = planFor(first, drawn.foot, p);
  const sheet = bakeSheet(drawn.frames, drawn.foot, plan);
  const cell = sheet.frames[0];
  const baked0 = sheet.baked[0];
  if (!cell || !baked0) throw new Error(`The baked sheet for ${id} has no frames`);
  // One sheet picture, the cells side by side, like the one Mark's files come in.
  const wide: Raw = { w: cell.w * sheet.frames.length, h: cell.h, px: new Uint8ClampedArray(cell.w * sheet.frames.length * cell.h * 4) };
  sheet.frames.forEach((f, i) => {
    for (let y = 0; y < f.h; y++) wide.px.set(f.px.subarray(y * f.w * 4, (y + 1) * f.w * 4), (y * wide.w + i * f.w) * 4);
  });
  const texture = addCanvasOnce(textures, key, rawToCanvas(wide));
  addCells(textures, key, cell.w, cell.h, sheet.frames.length);
  const foot = footAnchor(sheet.frames);
  const info: CrewInfo = {
    texture: key,
    frameW: cell.w,
    frameH: cell.h,
    foot,
    fig: { raw: cell, box: boxOf(cell), foot, face: { x: baked0.mapX(face.x), y: baked0.mapY(face.y) }, grain: 1 },
    plan,
    drawn,
    footDelta: { x: foot.x - sheet.anchor.x, y: foot.y - sheet.anchor.y },
  };
  (texture.data as unknown as BakedData).info = info;
  return info;
}

/**
 * After the sheets are in: bake each crew member's sheet with their proportions (`heroes`, from `heroes.json`; a hero
 * with no entry is as drawn). Reading a sheet's pixels back is the slow part, so it is done once per sheet and the
 * answer is kept in the texture's data bag; a scene restart finds it there.
 *
 * (The spike also made a Phaser animation here, `anims.create`, as "the sheet's frame list and fps on record". The
 * stage never played it: frames come from the tick (`idleFrame`). The engine has no animation manager, so that is gone.)
 */
export function registerCrew(textures: TextureManager, metas: Record<string, SheetMeta>, ids: readonly string[], standIns: boolean, heroes: HeroesFile = {}): Record<string, CrewInfo> {
  const out: Record<string, CrewInfo> = {};
  for (const id of ids) {
    const m = metas[id];
    if (!m) throw new Error(`No metadata for ${id}`);
    out[id] = bakeCrew(textures, id, m, heroes[id] ?? AS_DRAWN, standIns);
  }
  return out;
}

// ------------------------------------------------------------------ canvases

/** A new 2D canvas of this size, and its context. */
export function surface(w: number, h: number): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('no 2d canvas');
  g.imageSmoothingEnabled = false;
  return { canvas, g };
}

/** A picture's pixels as a canvas. */
export function rawToCanvas(raw: Raw): HTMLCanvasElement {
  const s = surface(raw.w, raw.h);
  s.g.putImageData(new ImageData(new Uint8ClampedArray(raw.px), raw.w, raw.h), 0, 0);
  return s.canvas;
}

/** A canvas's pixels. */
export function canvasToRaw(canvas: HTMLCanvasElement | OffscreenCanvas): Raw {
  const c = document.createElement('canvas');
  c.width = canvas.width;
  c.height = canvas.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('no 2d canvas');
  g.drawImage(canvas, 0, 0);
  return { w: c.width, h: c.height, px: g.getImageData(0, 0, c.width, c.height).data };
}

/** Add a canvas as a texture once; asking again for the same key reuses it (nothing is uploaded twice). The canvas is kept in the data bag (see `readTexture`). */
export function addCanvasOnce(textures: TextureManager, key: string, canvas: HTMLCanvasElement): SjTexture {
  if (textures.exists(key)) return textures.get(key);
  const texture = textures.addCanvas(key, canvas);
  texture.data.canvas = canvas;
  return texture;
}

// ------------------------------------------------------------------ the stage picture

/** The baked stage picture. */
export interface StageTextures {
  /** The texture key of the baked 480x270 picture (wall, kerb and floor). */
  key: string;
}

/** The old backdrop pictures at 480x270 (the game paints at 240x135 and shows it twice as big), kept so repainting a floor never redraws the sky. */
const sources = new Map<string, Raw>();

/**
 * One of the game's battle backdrops as it is shown in the game: blown up 2x with NEAREST sampling, the neon glow laid
 * over it. This is the ONE place the 240x135 world layer meets the 480x270 grid: the 2x blow-up is baked here, once, on a
 * canvas, so the engine only ever sees a 480x270 picture (scene-graph.md section 7, "mixed grains": no scaled container is needed).
 */
function backdropSource(id: string): Raw {
  const have = sources.get(id);
  if (have) return have;
  const bg = battleBg(id);
  const s = surface(SCREEN_W, SCREEN_H);
  s.g.drawImage(bg.canvas, 0, 0, SCREEN_W, SCREEN_H);
  if (bg.glow) s.g.drawImage(bg.glow, 0, 0, SCREEN_W, SCREEN_H);
  const made = canvasToRaw(s.canvas);
  sources.set(id, made);
  return made;
}

/** A short fingerprint (FNV-1a) of a string: the same text always gives the same name. */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/**
 * The part of a stage config that decides how its picture looks: the backdrop, the floor, the rows and every slot
 * (puddles are kept away from the places people stand, so moving a slot repaints them). The picture's texture is named
 * after this, so an unchanged stage finds its picture again and a changed one gets a new one.
 */
export function stagePictureKey(stage: StageConfig, slotsFrom: StageConfig = stage): string {
  // Only where each slot is matters to the picture (not its draw order), and `slotsFrom` may be an older stage.
  const spots = (list: ReadonlyArray<{ x: number; row: number; dy?: number }>): number[][] => list.map((q) => [q.x, q.row, q.dy ?? 0]);
  const sets = Object.entries(slotsFrom.enemySets).map(([k, v]) => [k, spots(v)]);
  return `stage-${stage.id}-${fingerprint(JSON.stringify([stage.backdrop, stage.floor, stage.rows, spots(slotsFrom.party), sets]))}`;
}

/**
 * The stage's picture as a texture: the wall (the old backdrop slid into place, or a painted replacement) with the
 * floor painted under it, baked into one 480x270 canvas. Painting runs only when no texture of that name exists. Only
 * the current picture is kept: switching stages repaints (a few milliseconds) instead of holding half a megabyte per stage.
 */
export function bakeStage(textures: TextureManager, stage: StageConfig, slotsFrom: StageConfig = stage): StageTextures {
  const key = stagePictureKey(stage, slotsFrom);
  const src = backdropSource(stage.backdrop.id);
  if (!textures.exists(key)) {
    const wall = stage.backdrop.mode === 'replace' ? paintWall(stage.backdrop.wallId ?? '', stage.backdrop.horizonY) : reprojectWall(src, stage);
    addCanvasOnce(textures, key, rawToCanvas(paintFloor(wall, slotsFrom === stage ? stage : { ...stage, party: slotsFrom.party, enemySets: slotsFrom.enemySets })));
    pruneTextures(textures, 'stage-', new Set([key]));
  }
  return { key };
}

// ------------------------------------------------------------------ enemies

export interface EnemyTexture {
  key: string;
  /** Size of the art in its own pixels. */
  width: number;
  height: number;
  /** The art's own ground-shadow width on the screen (0 for a floating thing with no shadow); the stage's `shadow` block is what draws shadows, this is for reference. */
  idleShadow: number;
  idle: IdleKind;
  /** Where the feet are, the drawn bounds, the face (see `FigureArt`). */
  fig: FigureArt;
}

/** What we remember about an enemy texture. */
type EnemyData = Omit<EnemyTexture, 'key'>;

/**
 * An enemy from the game's own art generator as a texture, with the glowing bits (eyes, lights) laid on top. `copy`
 * picks the individual when a fight has several of one kind (a second punk is a different person). Needs the traced
 * rig data loaded first (the humans are drawn from it).
 *
 * The game's own battle washes enemies with the backdrop's ambient light; the stage design replaces that with the
 * per-row depth haze (`depthTint`), so enemies are drawn in their true colours here and stand in the same light as the
 * heroes. Every enemy in the game today is painted at screen resolution and is drawn 1:1, like the crew.
 */
export function addEnemy(textures: TextureManager, spriteKey: string, copy: number): EnemyTexture {
  const key = `enemy-${spriteKey}-${copy}`;
  if (!textures.exists(key)) {
    const art = enemyArt(spriteKey, copy);
    const s = surface(art.canvas.width, art.canvas.height);
    s.g.drawImage(art.canvas, 0, 0);
    if (art.glow) s.g.drawImage(art.glow, 0, 0);
    const raw = canvasToRaw(s.canvas);
    const texture = addCanvasOnce(textures, key, s.canvas);
    const box = boxOf(raw);
    const face = ENEMY_FACES[spriteKey];
    // The head crop: the table's rectangle (measured from the drawn bounds), else a default from the top of the figure.
    const table = ENEMY_HEADS[spriteKey];
    const rel = table ?? defaultHead(raw, box);
    const head: Rect = { x: box.x0 + rel.x, y: box.y0 + rel.y, w: rel.w, h: rel.h };
    const info: EnemyData = {
      width: art.canvas.width,
      height: art.canvas.height,
      idleShadow: art.shadow * 2,
      idle: art.idle,
      fig: {
        raw,
        box,
        foot: footAnchor([raw]),
        face: face ? { x: box.x0 + face.x, y: box.y0 + face.y } : { x: Math.round((box.x0 + box.x1) / 2), y: box.y0 + Math.round((box.y1 - box.y0) / 6) },
        head,
        grain: ENEMY_GRAIN,
      },
    };
    Object.assign(texture.data, info);
  }
  // (Explicit fields: the data bag also holds the canvas, which is not part of what an enemy texture says about itself.)
  const { width, height, idleShadow, idle, fig } = textures.get(key).data as unknown as EnemyData;
  return { key, width, height, idleShadow, idle, fig };
}

// ------------------------------------------------------------------ variants: depth haze and hit flash

/** A copy of a texture with every drawn pixel changed by `change`, frames and all. Made once and found again by `key`. */
function variantOf(textures: TextureManager, baseKey: string, key: string, change: (c: RGB) => RGB): string {
  if (textures.exists(key)) return key;
  const base = textures.get(baseKey);
  const raw = readTexture(textures, baseKey);
  for (let i = 0; i < raw.px.length; i += 4) {
    if ((raw.px[i + 3] ?? 0) === 0) continue;
    const c = change([raw.px[i] ?? 0, raw.px[i + 1] ?? 0, raw.px[i + 2] ?? 0]);
    raw.px[i] = c[0];
    raw.px[i + 1] = c[1];
    raw.px[i + 2] = c[2];
  }
  addCanvasOnce(textures, key, rawToCanvas(raw));
  // The same named frames as the original (a sheet's numbered cells).
  const frames: Record<string | number, [number, number, number, number]> = {};
  for (const [name, f] of base.frames) frames[name] = [f.x, f.y, f.w, f.h];
  textures.addFrames(key, frames);
  return key;
}

/** The texture of `baseKey` blended toward the fog colour by `amount` (0 = the base itself): the depth haze, baked. */
export function hazedTexture(textures: TextureManager, baseKey: string, fog: string, amount: number): string {
  if (amount <= 0) return baseKey;
  const fogRgb = hexRgb(fog);
  return variantOf(textures, baseKey, `haze-${baseKey}-${fog.slice(1)}-${Math.round(amount * 100)}`, (c) => mix(c, fogRgb, amount));
}

/** The texture of `baseKey` as a near-white silhouette that keeps its dark outline: one frame of a hit flash. */
export function flashTexture(textures: TextureManager, baseKey: string, strength = 1): string {
  // Four steps are enough to read as a fade (and bound the number of baked copies): 1 (the full flash), 0.75, 0.5, 0.25.
  const step = Math.max(1, Math.min(4, Math.round(strength * 4)));
  if (step === 4) return variantOf(textures, baseKey, `flash-${baseKey}`, (c) => (lum(c) >= 40 ? mix(c, [255, 255, 255], 0.85) : c));
  const amount = 0.85 * (step / 4);
  return variantOf(textures, baseKey, `flash${step}-${baseKey}`, (c) => (lum(c) >= 40 ? mix(c, [255, 255, 255], amount) : c));
}

/** The texture of `baseKey` washed with red by `strength` (0 to 1), in steps of a quarter: a hero who has just been hit. */
export function tintTexture(textures: TextureManager, baseKey: string, strength: number, color = '#ff3b3b'): string {
  const step = Math.round(Math.max(0, Math.min(1, strength)) * 4);
  if (step <= 0) return baseKey;
  const rgb = hexRgb(color);
  // Even the full wash keeps the shading (it is a 0.5 mix at most), so the figure is red, not a flat red shape.
  return variantOf(textures, baseKey, `tint${step}-${color.slice(1)}-${baseKey}`, (c) => (lum(c) >= 30 ? mix(c, rgb, 0.5 * (step / 4)) : c));
}

// ------------------------------------------------------------------ shadows and rings

const SHADOW_PREFIX = 'shadow-';
const RING_PREFIX = 'ring-';

/** A contact shadow `width` wide in the stage's shadow style, as a texture (made once per width and style). */
export function shadowTexture(textures: TextureManager, width: number, style: ShadowStyle): string {
  const key = `${SHADOW_PREFIX}${width}-${style.aspect}-${style.color.slice(1)}-${Math.round(style.alpha * 100)}-${Math.round(style.edgeAlpha * 100)}`;
  if (!textures.exists(key)) addCanvasOnce(textures, key, rawToCanvas(shadowRaw(width, style)));
  return key;
}

/** A one-pixel ring (or dotted ring) `width` wide in a colour, as a texture. */
export function ringTexture(textures: TextureManager, width: number, color: string, dotted = false): string {
  const key = `${RING_PREFIX}${width}-${color.slice(1)}${dotted ? '-dots' : ''}`;
  if (!textures.exists(key)) addCanvasOnce(textures, key, rawToCanvas(ringRaw(width, color, dotted)));
  return key;
}

/**
 * Remove every texture whose name starts with `prefix` and is not in `inUse`. Shadows, rings and stage pictures are made
 * on demand from numbers, and an editor's slider asks for a new size on every step; without this the texture list would
 * grow with every tick of the slider. (The engine's `TextureManager.prune`, under the spike's old name.)
 */
export function pruneTextures(textures: TextureManager, prefix: string, inUse: ReadonlySet<string>): number {
  return textures.prune(prefix, inUse);
}

export const PREFIX = { shadow: SHADOW_PREFIX, ring: RING_PREFIX } as const;

