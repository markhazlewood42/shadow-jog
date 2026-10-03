/**
 * The asset pipeline of the Phaser stage (spike `spike/phaser-stage`): everything the stage draws gets here
 * as a Phaser **texture**, from two very different places.
 *
 *  1. **Our own generated art.** The game paints its backdrops and enemies in code onto HTML canvases
 *     (`src/art/battlebg.ts`, `src/art/enemies.ts`). Phaser can use any canvas as a texture
 *     (`textures.addCanvas(key, canvas)`): the canvas becomes a picture on the graphics card and any number
 *     of sprites can show it. We add each canvas ONCE under a stable key and look it up by key afterwards,
 *     so rebuilding the stage never uploads the same picture twice (a "texture leak").
 *  2. **Mark's Sprite Fusion sheets.** A sprite sheet is one PNG holding every frame of an animation side
 *     by side. Phaser's loader fetches it (`load.spritesheet`) and cuts it into numbered frames from the
 *     frame size in the sheet's `metadata.json`; an **animation** (`anims.create`) then plays those frames
 *     at the sheet's own fps. The files stay in Mark's local folder and are only ever fetched by the dev
 *     server; nothing here copies them.
 *
 * Pixel-art rule for all of it: textures use NEAREST filtering (each source pixel becomes a square block of
 * screen pixels, never a blur). The game config's `pixelArt: true` already makes the renderer sample
 * everything that way; every texture here ALSO says so on itself (`crisp`), so the intent is written down
 * where the texture is made and a test (`isCrisp`) can check it.
 */
import Phaser from 'phaser';
import { battleBg } from '../art/battlebg';
import { enemyArt, type EnemyArt } from '../art/enemies';
import type { Raw } from '../art/rig2/sfgeom';
import { SCREEN_H, SCREEN_W } from './config';
import { cutSheet, footAnchor, type FootAnchor } from './feet';
import type { IdleKind } from './idle';

// ------------------------------------------------------------------ Mark's Sprite Fusion sheets

/** Where the dev server finds Mark's extracted animations (a link to his local folder; never committed). */
const SHEET_BASE = '/spritefusion-tests/extracted/';

/** The crew, back to front: who stands in which party slot. Hex and Sable stand behind the two fighters. */
export const CREW_LINEUP = [
  { id: 'hex', sheet: 'hex-battle-idle' },
  { id: 'sable', sheet: 'sable-battle-idle' },
  { id: 'rook', sheet: 'rook-battle-idle' },
  { id: 'kit', sheet: 'kit-battle-idle' },
] as const;

/** What a sheet's `metadata.json` says (only the fields we use). */
export interface SheetMeta {
  frame_w: number;
  frame_h: number;
  frame_count: number;
  fps: number;
}

const isPositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Fetch and check every crew member's sheet description before the game starts (so a missing file is one readable error, not a blank stage). */
export async function fetchSheetMetas(): Promise<Record<string, SheetMeta>> {
  const out: Record<string, SheetMeta> = {};
  await Promise.all(
    CREW_LINEUP.map(async ({ id, sheet }) => {
      const url = `${SHEET_BASE}${sheet}/metadata.json`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: ${res.status} (is the spritefusion-tests link in place?)`);
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
 * there, so the lab, its tests and CI still run the whole pipeline (animation, feet, depth, shadows). They
 * are blocks, not art, and the page says so. `fetchSheetMetas` fails -> the lab calls these instead.
 */
const STAND_INS: Record<string, { w: number; h: number; height: number; colour: string }> = {
  hex: { w: 64, h: 64, height: 50, colour: '#8a5cc8' },
  sable: { w: 64, h: 64, height: 54, colour: '#b04a3a' },
  rook: { w: 79, h: 68, height: 58, colour: '#6a7a3a' },
  kit: { w: 64, h: 64, height: 52, colour: '#e8883a' },
};

/** The sheet descriptions the stand-ins have (8 frames at 8 fps, like Mark's idles). */
export function standInMetas(): Record<string, SheetMeta> {
  const out: Record<string, SheetMeta> = {};
  for (const [id, s] of Object.entries(STAND_INS)) out[id] = { frame_w: s.w, frame_h: s.h, frame_count: 8, fps: 8 };
  return out;
}

/** Draw the stand-in sheets and add them as sprite sheets (call from `create`, in place of loading Mark's files). */
export function addStandInSheets(textures: Phaser.Textures.TextureManager, metas: Record<string, SheetMeta>): void {
  for (const [id, s] of Object.entries(STAND_INS)) {
    const m = metas[id];
    if (!m || textures.exists(sheetKey(id))) continue;
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
    // addSpriteSheet takes an image, but a canvas has the same width and height Phaser reads from it.
    crisp(textures.addSpriteSheet(sheetKey(id), sheet.canvas as unknown as HTMLImageElement, { frameWidth: m.frame_w, frameHeight: m.frame_h }));
  }
}

export const sheetKey = (id: string): string => `crew-${id}`;
export const idleKey = (id: string): string => `idle-${id}`;

/**
 * Queue every crew sheet on a scene's loader (call from `preload`; Phaser waits for them before `create`).
 * A sheet already in the texture list is skipped, so restarting the scene does not download or add it twice.
 */
export function queueCrewSheets(load: Phaser.Loader.LoaderPlugin, textures: Phaser.Textures.TextureManager, metas: Record<string, SheetMeta>): void {
  for (const { id, sheet } of CREW_LINEUP) {
    if (textures.exists(sheetKey(id))) continue;
    const m = metas[id];
    if (!m) throw new Error(`No metadata for ${id}`);
    load.spritesheet(sheetKey(id), `${SHEET_BASE}${sheet}/spritesheet.png`, { frameWidth: m.frame_w, frameHeight: m.frame_h });
  }
}

/** A loaded sheet's pixels, read back from the texture Phaser made (to find the feet). */
function readSheet(textures: Phaser.Textures.TextureManager, key: string): Raw {
  const img = textures.get(key).getSourceImage() as CanvasImageSource & { width: number; height: number };
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('no 2d canvas to read the sheet with');
  g.drawImage(img, 0, 0);
  return { w: c.width, h: c.height, px: g.getImageData(0, 0, c.width, c.height).data };
}

/**
 * After the sheets have loaded: make each crew member's looping idle animation (at the sheet's own fps)
 * and find where their feet are in the cell. Returns the foot anchors by crew id.
 */
export function registerCrew(textures: Phaser.Textures.TextureManager, anims: Phaser.Animations.AnimationManager, metas: Record<string, SheetMeta>): Record<string, FootAnchor> {
  const anchors: Record<string, FootAnchor> = {};
  for (const { id } of CREW_LINEUP) {
    const m = metas[id];
    if (!m) throw new Error(`No metadata for ${id}`);
    // Animations live in a game-wide list, so a restarted scene must not add the same one twice.
    if (!anims.exists(idleKey(id))) {
      anims.create({
        key: idleKey(id),
        frames: anims.generateFrameNumbers(sheetKey(id), { start: 0, end: m.frame_count - 1 }),
        frameRate: m.fps,
        repeat: -1,
      });
    }
    crisp(textures.get(sheetKey(id)));
    anchors[id] = footAnchor(cutSheet(readSheet(textures, sheetKey(id)), m.frame_w, m.frame_count));
  }
  return anchors;
}

// ------------------------------------------------------------------ the game's own generated art

/** Mark a texture as pixel art: NEAREST sampling, so scaling it up makes square blocks and never a blur. */
function crisp(texture: Phaser.Textures.Texture | null): void {
  texture?.setFilter(Phaser.Textures.FilterMode.NEAREST);
}

/** Add a canvas as a crisp texture once; asking again for the same key reuses it (nothing is uploaded twice). */
export function addCanvasOnce(textures: Phaser.Textures.TextureManager, key: string, canvas: HTMLCanvasElement): string {
  if (!textures.exists(key)) crisp(textures.addCanvas(key, canvas));
  return key;
}

/** A new 2D canvas of this size, and its context. */
function surface(w: number, h: number): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('no 2d canvas');
  g.imageSmoothingEnabled = false;
  return { canvas, g };
}

export interface BackdropTextures {
  /** The painted wall and floor with its neon (`glow`) already laid on, 480x270. */
  back: string;
  /** Dark rails and cables framing the corners, drawn over the fighters; null when the backdrop has none. */
  front: string | null;
  /** The ambient light colour and strength the game washes over enemies standing in this place. */
  tint: string;
  tintAmt: number;
}

/**
 * Turn one of the game's battle backdrops into textures. The game paints it at 240x135 and shows it
 * twice as big; here it is blown up 2x with NEAREST sampling onto a 480x270 canvas (so the Phaser texture
 * is already screen-sized and shows 1:1), the neon glow layer is laid over it as the game does, and the
 * foreground framing becomes a second texture so the scene can put it in front of the fighters.
 */
export function addBackdrop(textures: Phaser.Textures.TextureManager, id: string): BackdropTextures {
  const bg = battleBg(id);
  const back = `backdrop-${id}`;
  const front = `backdrop-fg-${id}`;
  if (!textures.exists(back)) {
    const s = surface(SCREEN_W, SCREEN_H);
    s.g.drawImage(bg.canvas, 0, 0, SCREEN_W, SCREEN_H);
    if (bg.glow) s.g.drawImage(bg.glow, 0, 0, SCREEN_W, SCREEN_H);
    addCanvasOnce(textures, back, s.canvas);
  }
  if (bg.fg && !textures.exists(front)) {
    const s = surface(SCREEN_W, SCREEN_H);
    s.g.drawImage(bg.fg, 0, 0, SCREEN_W, SCREEN_H);
    addCanvasOnce(textures, front, s.canvas);
  }
  return { back, front: bg.fg ? front : null, tint: bg.tint, tintAmt: bg.tintAmt };
}

export interface EnemyTexture {
  key: string;
  /** Art pixels are drawn this many screen pixels wide: 2 for the humans (painted at the game's world scale), 1 for the creatures (painted at screen scale). Always a whole number. */
  displayScale: number;
  /** Size on the screen after `displayScale`. */
  width: number;
  height: number;
  /** Shadow width on the screen (0 for a floating thing with no shadow). */
  shadow: number;
  idle: IdleKind;
}

/**
 * An enemy from the game's own art generator as a texture: the painted body washed with the backdrop's
 * ambient light (as the game's battle does), the glowing bits (eyes, lights) laid on top un-darkened.
 * `copy` picks the individual when a fight has several of one kind (a second punk is a different person).
 * Needs the traced rig data loaded first (the humans are drawn from it).
 */
export function addEnemy(textures: Phaser.Textures.TextureManager, spriteKey: string, copy: number, backdrop: BackdropTextures): EnemyTexture {
  const art: EnemyArt = enemyArt(spriteKey, copy);
  const key = `enemy-${spriteKey}-${copy}-${backdrop.back}`;
  if (!textures.exists(key)) {
    const s = surface(art.canvas.width, art.canvas.height);
    s.g.drawImage(art.canvas, 0, 0);
    if (backdrop.tintAmt > 0) {
      // "source-atop" paints only where the body already is, so the wash tints the sprite and not its empty corners.
      s.g.globalCompositeOperation = 'source-atop';
      s.g.globalAlpha = backdrop.tintAmt;
      s.g.fillStyle = backdrop.tint;
      s.g.fillRect(0, 0, s.canvas.width, s.canvas.height);
      s.g.globalCompositeOperation = 'source-over';
      s.g.globalAlpha = 1;
    }
    if (art.glow) s.g.drawImage(art.glow, 0, 0);
    addCanvasOnce(textures, key, s.canvas);
  }
  // The game draws every enemy through a 2x transform: a human's pixels (res 1) become two screen pixels, a creature's (res 2) one.
  const displayScale = 2 / art.res;
  return { key, displayScale, width: art.canvas.width * displayScale, height: art.canvas.height * displayScale, shadow: art.shadow * 2, idle: art.idle };
}

/**
 * A flat contact shadow as pixel art: a hard-edged ellipse with a stippled rim (every other pixel), which
 * reads as soft without a blur. Black; the sprite using it sets the strength with its alpha.
 */
export function addShadow(textures: Phaser.Textures.TextureManager, width: number, height: number): string {
  const w = Math.max(2, Math.round(width));
  const h = Math.max(2, Math.round(height));
  const key = `shadow-${w}x${h}`;
  if (textures.exists(key)) return key;
  const s = surface(w, h);
  const rx = w / 2;
  const ry = h / 2;
  s.g.fillStyle = '#000000';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = ((x + 0.5 - rx) / rx) ** 2 + ((y + 0.5 - ry) / ry) ** 2;
      // Solid in the middle, stippled in the outer fifth, empty outside.
      if (d <= 0.64 || (d <= 1 && (x + y) % 2 === 0)) s.g.fillRect(x, y, 1, 1);
    }
  }
  addCanvasOnce(textures, key, s.canvas);
  return key;
}

/** Whether every source of a texture is set to NEAREST (crisp) and not LINEAR (blurred). */
export function isCrisp(textures: Phaser.Textures.TextureManager, key: string): boolean {
  return textures.get(key).source.every((s) => s.scaleMode === Phaser.Textures.FilterMode.NEAREST);
}
