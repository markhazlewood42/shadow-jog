/**
 * The HUD's building blocks as Phaser textures (spike `spike/phaser-stage`): text in the game's own bitmap font,
 * window frames in the game's own `drawWindow` look, and the little chips the turn timeline is made of.
 *
 * Why textures and not Phaser's Text objects? Phaser's `Text` draws with the browser's fonts, which are
 * anti-aliased and would not match the game's pixel font at all. The game already has a bitmap font
 * (`src/engine/font.ts`: each letter is a few pixels, written out as text). So a string is drawn with the
 * game's own `drawText` onto a tiny canvas, the canvas becomes a texture, and a Phaser **Image** shows it.
 * That keeps every letter exactly as the game draws it. Textures are named after what they show, so the same
 * string is made once; `Hud` removes the ones it stopped using (`pruneTextures`).
 *
 * Window frames are the same idea: the game's frame look (a dark gradient fill, faint scanlines, a dark outline,
 * a lit inner frame, little tick marks, optional accent corners) is drawn once per size onto a canvas.
 * The fill is semi-transparent (the region's `opacity`), the outline is solid, so the stage shows through.
 */
import type Phaser from 'phaser';
import { drawText, GLYPH_H, measure } from '../engine/font';
import { rawToCanvas, surface, addCanvasOnce } from './textures';
import { hexRgb, mix, type Raw } from './pixels';

/** The game's UI colours (from `drawWindow` and the HUD mockups). */
export const UI = {
  outline: '#07060d',
  frame: '#4a4f86',
  frameLit: '#7a80c4',
  fillTop: '#1c1a3a',
  fillBot: '#0d0c1f',
  inner: '#2c2a58',
  cyan: '#3fe0f0',
  pink: '#ff4fb0',
  amber: '#ffcc3d',
  green: '#62e06a',
  red: '#ff5a5a',
  violet: '#b07cff',
  dim: '#8b8fa8',
  text: '#f4f1ff',
  disabled: '#5d6080',
  foe: '#ff6a6a',
  foeBg: '#2a0f18',
  chipBg: '#12101f',
  barBack: '#241f3a',
  tabBg: '#12112a',
} as const;

export const TEXT_PREFIX = 'txt-';
export const WINDOW_PREFIX = 'win-';
export const CHIP_PREFIX = 'chip-';

/** The colour of a health bar for a share of full: green, then amber under half, then red under a quarter. */
export function hpColor(ratio: number): string {
  return ratio > 0.5 ? UI.green : ratio > 0.25 ? UI.amber : UI.red;
}

export interface TextOptions {
  color?: string;
  /** Drop shadow colour (the game's default dark), or false for none. */
  shadow?: string | false;
  /** Whole-number magnification: the glyph pixels become scale x scale blocks. */
  scale?: number;
  /** A one-pixel outline colour around the (scaled) letters. */
  outline?: string;
  /** The texture-name prefix. The default is the HUD's own, whose textures the HUD removes when it stops using them; floating numbers use their own so that clean-up leaves them alone. */
  prefix?: string;
}

export interface TextImage {
  key: string;
  w: number;
  h: number;
}

/** The width in pixels a string takes in the game's font at a scale (without the shadow's extra pixel). */
export function textWidth(text: string, scale = 1): number {
  return measure(text) * scale;
}

/**
 * A string as a texture (made once per distinct string and look). The picture has a transparent margin of
 * `pad` pixels on the left/top (room for the outline) and the right/bottom (outline and shadow), so a caller
 * placing it at (x, y) subtracts `pad` to line the letters up where it wants them.
 */
export function textTexture(textures: Phaser.Textures.TextureManager, text: string, opts: TextOptions = {}): TextImage & { pad: number } {
  const color = opts.color ?? UI.text;
  const shadow = opts.shadow === undefined ? '#0a0913' : opts.shadow;
  const scale = opts.scale ?? 1;
  const outline = opts.outline;
  const pad = outline ? 1 : 0;
  const w = Math.max(1, measure(text) * scale);
  const h = GLYPH_H * scale;
  const cw = w + pad * 2 + (shadow || outline ? 1 : 0) * scale;
  const ch = h + pad * 2 + (shadow || outline ? 1 : 0) * scale;
  const key = `${opts.prefix ?? TEXT_PREFIX}${text}|${color}|${shadow || '-'}|${scale}|${outline ?? '-'}`;
  if (!textures.exists(key)) {
    // 1. The letters (and their shadow) at the game's own size.
    const small = surface(measure(text) + 1, GLYPH_H + 1);
    drawText(small.g, text, 0, 0, { color, shadow });
    // 2. Magnified by a whole number (nearest-neighbour) if asked.
    let body = small.canvas;
    if (scale > 1) {
      const big = surface(small.canvas.width * scale, small.canvas.height * scale);
      big.g.drawImage(small.canvas, 0, 0, big.canvas.width, big.canvas.height);
      body = big.canvas;
    }
    const out = surface(cw, ch);
    if (outline) {
      // The outline: the letters' silhouette in the outline colour, stamped on all eight neighbours.
      const sil = surface(body.width, body.height);
      sil.g.drawImage(body, 0, 0);
      sil.g.globalCompositeOperation = 'source-in';
      sil.g.fillStyle = outline;
      sil.g.fillRect(0, 0, sil.canvas.width, sil.canvas.height);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) out.g.drawImage(sil.canvas, pad + dx, pad + dy);
    }
    out.g.drawImage(body, pad, pad);
    addCanvasOnce(textures, key, out.canvas);
  }
  return { key, w: cw, h: ch, pad };
}

/** Where to put a text picture so the first letter's top-left lands at (x, y), for the given alignment (x is then the left, centre or right edge of the letters). */
export function textAt(img: { pad: number; w: number }, text: string, x: number, y: number, align: 'left' | 'center' | 'right', scale = 1): { x: number; y: number } {
  const w = measure(text) * scale;
  const left = align === 'left' ? x : align === 'center' ? x - Math.floor(w / 2) : x - w;
  return { x: left - img.pad, y: y - img.pad };
}

/**
 * The game's window look (its `drawWindow`) as a texture: a drop shadow two pixels down and right, a dark
 * gradient fill with faint scanlines, an outline, a lit inner frame, tick marks along the bottom, and (unless
 * `plain`) accent-coloured corner pieces. `alpha` is how solid the fill is (the outline and frame are always solid).
 * The picture is 2 px wider and taller than the window because of the shadow.
 */
export function windowTexture(textures: Phaser.Textures.TextureManager, w: number, h: number, accent: string, alpha: number, plain: boolean): string {
  const key = `${WINDOW_PREFIX}${w}x${h}-${accent}-${Math.round(alpha * 100)}-${plain ? 'p' : 'a'}`;
  if (textures.exists(key)) return key;
  const s = surface(w + 2, h + 2);
  const g = s.g;
  const fill = (x: number, y: number, rw: number, rh: number, color: string, a = 1): void => {
    g.globalAlpha = a;
    g.fillStyle = color;
    g.fillRect(x, y, rw, rh);
  };
  fill(2, 2, w, h, UI.outline, 0.45 * alpha); // drop shadow
  const top = hexRgb(UI.fillTop);
  const bot = hexRgb(UI.fillBot);
  for (let y = 1; y < h - 1; y++) {
    const c = mix(top, bot, y / Math.max(1, h - 1));
    fill(1, y, w - 2, 1, `rgb(${c[0]},${c[1]},${c[2]})`, alpha); // gradient fill
  }
  for (let y = 3; y < h - 2; y += 2) fill(2, y, w - 4, 1, '#000000', 0.07 * alpha); // scanlines
  for (const [x, y, rw, rh] of [[0, 0, w, 1], [0, h - 1, w, 1], [0, 0, 1, h], [w - 1, 0, 1, h]] as const) fill(x, y, rw, rh, UI.outline); // outline
  for (const [x, y, rw, rh] of [[1, 1, w - 2, 1], [1, h - 2, w - 2, 1], [1, 1, 1, h - 2], [w - 2, 1, 1, h - 2]] as const) fill(x, y, rw, rh, UI.frame); // frame
  fill(2, 2, w - 4, 1, UI.inner);
  if (w >= 40) for (let x = 12; x < w - 12; x += 16) fill(x, h - 2, 2, 1, UI.frameLit); // ticks
  if (!plain) {
    for (const [x, y, rw, rh] of [[1, 1, 7, 1], [1, 1, 1, 5], [w - 8, h - 2, 7, 1], [w - 2, h - 6, 1, 5]] as const) fill(x, y, rw, rh, accent); // accent corners
  }
  addCanvasOnce(textures, key, s.canvas);
  return key;
}

/**
 * A chip: a square with a dark outline, a coloured border and a face inside; enemy chips get a pink mark in
 * the top-right corner so they never read as party chips. `faceKey` is a face texture (see `faceTexture`).
 */
export function chipTexture(textures: Phaser.Textures.TextureManager, size: number, faceKey: string, border: string, bg: string, foe: boolean): string {
  const key = `${CHIP_PREFIX}${size}-${faceKey}-${border}-${bg}-${foe ? 'f' : 'p'}`;
  if (textures.exists(key)) return key;
  const s = surface(size, size);
  const g = s.g;
  g.fillStyle = UI.outline;
  g.fillRect(0, 0, size, size);
  g.fillStyle = bg;
  g.fillRect(1, 1, size - 2, size - 2);
  const face = textures.get(faceKey).getSourceImage() as CanvasImageSource & { width: number; height: number };
  g.drawImage(face, Math.floor((size - face.width) / 2), Math.floor((size - face.height) / 2));
  g.fillStyle = border;
  for (const [x, y, rw, rh] of [[0, 0, size, 1], [0, size - 1, size, 1], [0, 0, 1, size], [size - 1, 0, 1, size]] as const) g.fillRect(x, y, rw, rh);
  if (foe) {
    g.fillStyle = UI.pink;
    for (let k = 0; k < 4; k++) g.fillRect(size - 1 - k, 0, k + 1, 1);
  }
  addCanvasOnce(textures, key, s.canvas);
  return key;
}

/** An icon picture as a texture (the pixel pictures in `icons.ts`). */
export function iconTexture(textures: Phaser.Textures.TextureManager, name: string, raw: Raw): string {
  const key = `${CHIP_PREFIX}icon-${name}`;
  if (!textures.exists(key)) addCanvasOnce(textures, key, rawToCanvas(raw));
  return key;
}
