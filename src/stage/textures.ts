/**
 * The asset pipeline of the Phaser stage (spike `spike/phaser-stage`): everything the stage draws gets here
 * as a Phaser **texture**, from several very different places.
 *
 *  1. **Our own generated art.** The game paints its backdrops and enemies in code onto HTML canvases
 *     (`src/art/battlebg.ts`, `src/art/enemies.ts`). Phaser can use any canvas as a texture
 *     (`textures.addCanvas(key, canvas)`): the canvas becomes a picture on the graphics card and any number
 *     of sprites can show it. We add each canvas ONCE under a stable key and look it up by key afterwards,
 *     so rebuilding the stage never uploads the same picture twice (a "texture leak"), and never even
 *     re-runs the generator: what we learned about a texture (its feet, its light colour, its face) is stored
 *     on the texture itself (`texture.customData`, a small bag Phaser gives every texture), so a scene
 *     restart does no work beyond making new game objects.
 *  2. **Mark's Sprite Fusion sheets.** A sprite sheet is one PNG holding every frame of an animation side
 *     by side. Phaser's loader fetches it (`load.spritesheet`) and cuts it into numbered frames from the
 *     frame size in the sheet's `metadata.json`; an **animation** (`anims.create`) records the frame list
 *     and the sheet's own fps. The files stay in Mark's local folder and are only ever fetched by the dev
 *     server; nothing here copies them.
 *  3. **The stage itself.** The wall and the floor are painted pixel by pixel from the stage config
 *     (`floor.ts`, `sewerwall.ts`) and baked into ONE 480x270 texture, named after a fingerprint of the
 *     config that made it, so an unchanged config finds its picture again and a changed one makes a new one.
 *  4. **Variants.** The depth haze blends a sprite toward the fog colour, and a hit flashes it white. Both
 *     are baked as copies of the sprite's texture (once each, found again by name) instead of being redone
 *     every frame, which also keeps them working on Phaser's canvas renderer (its tints are WebGL-only).
 *  5. **Small things made from numbers:** contact shadows, rings, faces, the effects layer.
 *
 * This file only MAKES textures. Who stands where, and which enemies are in the fight, is data in
 * `src/data/stages.json` (see `config.ts`).
 *
 * Pixel-art rule for all of it: textures use NEAREST filtering (each source pixel becomes a square block of
 * screen pixels, never a blur). The game config's `pixelArt: true` already makes the renderer sample
 * everything that way; every texture here ALSO says so on itself (`crisp`), so the intent is written down
 * where the texture is made and a test (`isCrisp`) can check it.
 */
import Phaser from 'phaser';
import { battleBg } from '../art/battlebg';
import { enemyArt } from '../art/enemies';
import { boxOf, type Box } from '../art/rig2/sfgeom';
import { SCREEN_H, SCREEN_W, type ShadowStyle, type StageConfig } from './config';
import { sheetFolder } from './crew';
import { cutSheet, footAnchor, type FootAnchor } from './feet';
import { flipRaw } from './facing';
import { cutFace, cutHead, CREW_FACES, defaultHead, ENEMY_FACES, ENEMY_GRAIN, ENEMY_HEADS, type Pt, type Rect } from './faces';
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
 * Fetch and check the sheet description of each crew member in `ids` before the game starts (so a missing
 * file is one readable error, not a blank stage). Without Mark's folder Vite does NOT answer 404: for a path
 * it cannot find it sends the app's own page (200, text/html), because it treats every unknown URL as a
 * single-page-app route. So "the answer is not JSON" counts as missing as well as a real 404, and either
 * way this throws and the lab uses the stand-ins instead.
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
 * Simple code-drawn figures with the same sheet layout (one row of frames), used when Mark's folder is not
 * there, so the lab, its tests and CI still run the whole pipeline (animation, feet, depth, shadows, faces).
 * They are blocks, not art, and the page says so. `fetchSheetMetas` fails -> the lab calls these instead.
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

/**
 * Draw the stand-in sheets (call from `create`, in place of loading Mark's files). A sprite sheet is just a
 * texture with one numbered frame per cell, so we add the canvas as a plain texture and cut the frames out
 * ourselves with `texture.add(name, sourceIndex, x, y, width, height)`; that is all `addSpriteSheet` does
 * for an image, without needing the canvas to pretend to be one.
 */
export function addStandInSheets(textures: Phaser.Textures.TextureManager, metas: Record<string, SheetMeta>): void {
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
    const texture = textures.addCanvas(sheetKey(id), sheet.canvas);
    if (!texture) throw new Error(`Phaser would not add the stand-in sheet for ${id}`);
    for (let i = 0; i < m.frame_count; i++) texture.add(i, 0, i * m.frame_w, 0, m.frame_w, m.frame_h);
    crisp(texture);
  }
}

export const sheetKey = (id: string): string => `crew-${id}`;
export const idleKey = (id: string): string => `idle-${id}`;

/**
 * Queue the crew sheets in `ids` on a scene's loader (call from `preload`; Phaser waits for them before
 * `create`). A sheet already in the texture list is skipped, so restarting the scene does not download or add it twice.
 */
export function queueCrewSheets(load: Phaser.Loader.LoaderPlugin, textures: Phaser.Textures.TextureManager, metas: Record<string, SheetMeta>, ids: readonly string[]): void {
  for (const id of ids) {
    if (textures.exists(sheetKey(id))) continue;
    const m = metas[id];
    if (!m) throw new Error(`No metadata for ${id}`);
    load.spritesheet(sheetKey(id), `${SHEET_BASE}${sheetFolder(id)}/spritesheet.png`, { frameWidth: m.frame_w, frameHeight: m.frame_h });
  }
}

/** A texture's pixels, read back through a 2D canvas (to find the feet, cut a face or bake a variant). */
export function readTexture(textures: Phaser.Textures.TextureManager, key: string): Raw {
  const img = textures.get(key).getSourceImage() as CanvasImageSource & { width: number; height: number };
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('no 2d canvas to read the texture with');
  g.drawImage(img, 0, 0);
  return { w: c.width, h: c.height, px: g.getImageData(0, 0, c.width, c.height).data };
}

/**
 * What the stage knows about one standing figure's art, kept on its texture: the pixels of the picture its face
 * is cut from (frame 0 of a crew sheet, or an enemy's art as drawn), the drawn bounds and the feet in that
 * picture, the face point and the grain (see `faces.ts`).
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

/** What we remember about a crew sheet as Mark drew it, on its texture: the frames cut out and the foot anchor measured on them (read from the graphics card once). */
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
  /** Frame 0 of the baked sheet, its bounds and face (the stage rules, the HUD name tabs and the shadow all read these). */
  fig: FigureArt;
  /** The rows and columns the bake added or dropped, chosen once from frame 0. */
  plan: BakePlan;
  /** The sheet as Mark drew it (frames and foot anchor): what the strike and punch pictures are built from, then baked with `plan`. */
  drawn: { frames: Raw[]; foot: FootAnchor };
  /** How far the re-measured foot is from where the drawn foot anchor went (0 unless a column landed inside the boots): the stills' axes follow it. */
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
export function bakeCrew(textures: Phaser.Textures.TextureManager, id: string, meta: SheetMeta, p: Proportion, standIns: boolean): CrewInfo {
  const key = bakedKey(id, p);
  if (textures.exists(key)) return (textures.get(key).customData as BakedData).info;
  const source = textures.get(sheetKey(id));
  crisp(source);
  const data = source.customData as SheetData;
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
  for (let i = 0; i < sheet.frames.length; i++) texture.add(i, 0, i * cell.w, 0, cell.w, cell.h);
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
  (texture.customData as BakedData).info = info;
  return info;
}

/**
 * After the sheets have loaded: make each crew member's looping idle animation (its frame list at the
 * sheet's own fps) and bake their sheet with their proportions (`heroes`, from `heroes.json`; a hero with no entry is as drawn).
 *
 * Reading a sheet's pixels back through a 2D canvas is the slow part, so it is done once per sheet and the
 * answer is kept in the texture's `customData`; a scene restart finds it there.
 */
export function registerCrew(textures: Phaser.Textures.TextureManager, anims: Phaser.Animations.AnimationManager, metas: Record<string, SheetMeta>, ids: readonly string[], standIns: boolean, heroes: HeroesFile = {}): Record<string, CrewInfo> {
  const out: Record<string, CrewInfo> = {};
  for (const id of ids) {
    const m = metas[id];
    if (!m) throw new Error(`No metadata for ${id}`);
    // Animations live in a game-wide list, so a restarted scene must not add the same one twice.
    // (The stage picks idle frames from its own tick, see `idleFrame`; this animation is the sheet's
    // frame list and fps on record, for the one-shot poses the battle test will play.)
    if (!anims.exists(idleKey(id))) {
      anims.create({
        key: idleKey(id),
        frames: anims.generateFrameNumbers(sheetKey(id), { start: 0, end: m.frame_count - 1 }),
        frameRate: m.fps,
        repeat: -1,
      });
    }
    out[id] = bakeCrew(textures, id, m, heroes[id] ?? AS_DRAWN, standIns);
  }
  return out;
}

// ------------------------------------------------------------------ the game's own generated art

/** Mark a texture as pixel art: NEAREST sampling, so scaling it up makes square blocks and never a blur. */
export function crisp(texture: Phaser.Textures.Texture | null): void {
  texture?.setFilter(Phaser.Textures.FilterMode.NEAREST);
}

/** Add a canvas as a crisp texture once; asking again for the same key reuses it (nothing is uploaded twice). */
export function addCanvasOnce(textures: Phaser.Textures.TextureManager, key: string, canvas: HTMLCanvasElement): Phaser.Textures.Texture {
  const have = textures.exists(key) ? textures.get(key) : null;
  if (have) return have;
  const texture = textures.addCanvas(key, canvas);
  if (!texture) throw new Error(`Phaser would not add the texture "${key}"`);
  crisp(texture);
  return texture;
}

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

// ------------------------------------------------------------------ the stage picture

/** The baked stage picture. */
export interface StageTextures {
  /** The texture key of the baked 480x270 picture (wall, kerb and floor). */
  key: string;
}

/** The old backdrop pictures at 480x270 (the game paints at 240x135 and shows it twice as big), kept so repainting a floor never redraws the sky. */
const sources = new Map<string, Raw>();

/** One of the game's battle backdrops as it is shown in the game: blown up 2x with NEAREST sampling, the neon glow laid over it. */
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
 * The part of a stage config that decides how its picture looks: the backdrop, the floor, the rows and every
 * slot (puddles are kept away from the places people stand, so moving a slot repaints them). The picture's
 * texture is named after this, so an unchanged stage finds its picture again and a changed one gets a new one.
 */
export function stagePictureKey(stage: StageConfig, slotsFrom: StageConfig = stage): string {
  // Only where each slot is matters to the picture (not its draw order), and `slotsFrom` may be an older stage: see `StageScene.applyStage`.
  const spots = (list: ReadonlyArray<{ x: number; row: number; dy?: number }>): number[][] => list.map((q) => [q.x, q.row, q.dy ?? 0]);
  const sets = Object.entries(slotsFrom.enemySets).map(([k, v]) => [k, spots(v)]);
  return `stage-${stage.id}-${fingerprint(JSON.stringify([stage.backdrop, stage.floor, stage.rows, spots(slotsFrom.party), sets]))}`;
}

/**
 * The stage's picture as a texture: the wall (the old backdrop slid into place, or a painted replacement) with
 * the floor painted under it, baked into one 480x270 canvas. Painting runs only when no texture of that name
 * exists. Only the current picture is kept: a dragged horizon would otherwise leave one per step, and switching
 * stages repaints (a few milliseconds) instead of holding half a megabyte per stage.
 */
export function bakeStage(textures: Phaser.Textures.TextureManager, stage: StageConfig, slotsFrom: StageConfig = stage): StageTextures {
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
 * An enemy from the game's own art generator as a texture, with the glowing bits (eyes, lights) laid on top.
 * `copy` picks the individual when a fight has several of one kind (a second punk is a different person).
 * Needs the traced rig data loaded first (the humans are drawn from it).
 *
 * The game's own battle washes enemies with the backdrop's ambient light; the stage design replaces that with
 * the per-row depth haze (`depthTint`), and the crew are never washed, so enemies are drawn in their true
 * colours here and stand in the same light as the heroes. Every enemy in the game today is painted at screen
 * resolution and is drawn 1:1, the same pixel size as the crew.
 */
export function addEnemy(textures: Phaser.Textures.TextureManager, spriteKey: string, copy: number): EnemyTexture {
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
    Object.assign(texture.customData, info);
  }
  return { key, ...(textures.get(key).customData as EnemyData) };
}

// ------------------------------------------------------------------ variants: depth haze and hit flash

/** A copy of a texture with every drawn pixel changed by `change`, frames and all. Made once and found again by `key`. */
function variantOf(textures: Phaser.Textures.TextureManager, baseKey: string, key: string, change: (c: RGB) => RGB): string {
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
  const texture = addCanvasOnce(textures, key, rawToCanvas(raw));
  // The same named frames as the original (a sheet's numbered cells).
  for (const name of base.getFrameNames()) {
    const f = base.get(name);
    texture.add(name, 0, f.cutX, f.cutY, f.cutWidth, f.cutHeight);
  }
  return key;
}

/** The texture of `baseKey` blended toward the fog colour by `amount` (0 = the base itself): the depth haze, baked. */
export function hazedTexture(textures: Phaser.Textures.TextureManager, baseKey: string, fog: string, amount: number): string {
  if (amount <= 0) return baseKey;
  const fogRgb = hexRgb(fog);
  return variantOf(textures, baseKey, `haze-${baseKey}-${fog.slice(1)}-${Math.round(amount * 100)}`, (c) => mix(c, fogRgb, amount));
}

/** The texture of `baseKey` as a near-white silhouette that keeps its dark outline: one frame of a hit flash. */
export function flashTexture(textures: Phaser.Textures.TextureManager, baseKey: string, strength = 1): string {
  // Four steps are enough to read as a fade (and bound the number of baked copies): 1 (the full flash), 0.75, 0.5, 0.25.
  const step = Math.max(1, Math.min(4, Math.round(strength * 4)));
  if (step === 4) return variantOf(textures, baseKey, `flash-${baseKey}`, (c) => (lum(c) >= 40 ? mix(c, [255, 255, 255], 0.85) : c));
  const amount = 0.85 * (step / 4);
  return variantOf(textures, baseKey, `flash${step}-${baseKey}`, (c) => (lum(c) >= 40 ? mix(c, [255, 255, 255], amount) : c));
}

/** The texture of `baseKey` washed with red by `strength` (0 to 1), in steps of a quarter: a hero who has just been hit. */
export function tintTexture(textures: Phaser.Textures.TextureManager, baseKey: string, strength: number, color = '#ff3b3b'): string {
  const step = Math.round(Math.max(0, Math.min(1, strength)) * 4);
  if (step <= 0) return baseKey;
  const rgb = hexRgb(color);
  // Even the full wash keeps the shading (it is a 0.5 mix at most), so the figure is red, not a flat red shape.
  return variantOf(textures, baseKey, `tint${step}-${color.slice(1)}-${baseKey}`, (c) => (lum(c) >= 30 ? mix(c, rgb, 0.5 * (step / 4)) : c));
}

// ------------------------------------------------------------------ shadows, rings, faces, effects

const SHADOW_PREFIX = 'shadow-';
const RING_PREFIX = 'ring-';
const FACE_PREFIX = 'face-';
const FX_PREFIX = 'fx-';

/** A contact shadow `width` wide in the stage's shadow style, as a texture (made once per width and style). */
export function shadowTexture(textures: Phaser.Textures.TextureManager, width: number, style: ShadowStyle): string {
  const key = `${SHADOW_PREFIX}${width}-${style.aspect}-${style.color.slice(1)}-${Math.round(style.alpha * 100)}-${Math.round(style.edgeAlpha * 100)}`;
  if (!textures.exists(key)) addCanvasOnce(textures, key, rawToCanvas(shadowRaw(width, style)));
  return key;
}

/** A one-pixel ring (or dotted ring) `width` wide in a colour, as a texture. */
export function ringTexture(textures: Phaser.Textures.TextureManager, width: number, color: string, dotted = false): string {
  const key = `${RING_PREFIX}${width}-${color.slice(1)}${dotted ? '-dots' : ''}`;
  if (!textures.exists(key)) addCanvasOnce(textures, key, rawToCanvas(ringRaw(width, color, dotted)));
  return key;
}

/** A face chip picture `size` x `size` cut from a figure's art. */
export function faceTexture(textures: Phaser.Textures.TextureManager, name: string, fig: FigureArt, size: number): string {
  const key = `${FACE_PREFIX}${name}-${size}`;
  if (!textures.exists(key)) {
    // A mirrored figure's chip is the ORIGINAL's chip reversed (cut first, so the art's 2x2 blocks are not split by the flip, then flipped).
    const src = fig.mirrorOf ?? fig;
    const cut = src.head ? cutHead(src.raw, src.head, size, src.grain) : cutFace(src.raw, src.face, size, src.grain);
    addCanvasOnce(textures, key, rawToCanvas(fig.mirrorOf ? flipRaw(cut) : cut));
  }
  return key;
}

let fxCount = 0;

/** A one-off full-screen effects picture (path dashes, the hit's slash). The previous ones are removed. */
export function effectsTexture(textures: Phaser.Textures.TextureManager, raw: Raw): string {
  const key = `${FX_PREFIX}${++fxCount}`;
  addCanvasOnce(textures, key, rawToCanvas(raw));
  pruneTextures(textures, FX_PREFIX, new Set([key]));
  return key;
}

/**
 * Remove every texture whose name starts with `prefix` and is not in `inUse`. Shadows, rings, faces and stage
 * pictures are made on demand from numbers, and an editor's slider asks for a new size on every step; without
 * this the texture list would grow with every tick of the slider.
 */
export function pruneTextures(textures: Phaser.Textures.TextureManager, prefix: string, inUse: ReadonlySet<string>): number {
  let removed = 0;
  for (const key of textures.getTextureKeys()) {
    if (key.startsWith(prefix) && !inUse.has(key)) {
      textures.remove(key);
      removed++;
    }
  }
  return removed;
}

export const PREFIX = { shadow: SHADOW_PREFIX, ring: RING_PREFIX, face: FACE_PREFIX, fx: FX_PREFIX } as const;

/** Whether every source of a texture is set to NEAREST (crisp) and not LINEAR (blurred). */
export function isCrisp(textures: Phaser.Textures.TextureManager, key: string): boolean {
  return textures.get(key).source.every((s) => s.scaleMode === Phaser.Textures.FilterMode.NEAREST);
}
