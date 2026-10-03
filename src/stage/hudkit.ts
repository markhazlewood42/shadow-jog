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
import { CHIP_PREFIX, HIT_COLOUR, hitKind, hpColor, numberScale, SEE_THROUGH_TOP, UI } from './hudcolours';
import { STATUS_ICON_SIZE, STATUS_LOOK } from './hudstatus';
import type { StatusId } from '../battle/types';
import { hexRgb, mix, type Raw } from './pixels';

// The colours and rules live in `hudcolours.ts` (no Phaser, so unit tests can use them); they are re-exported here for the HUD's other files.
export { CHIP_PREFIX, HIT_COLOUR, hitKind, hpColor, numberScale, SEE_THROUGH_TOP, UI };
export type { HitKind } from './hudcolours';

export const TEXT_PREFIX = 'txt-';
export const WINDOW_PREFIX = 'win-';

/**
 * How a floating damage number is drawn so it holds on any ground, the white Warden included: the letters in the hit's
 * colour, a two-pixel dark outline round them and a soft drop shadow under that.
 */
export const NUMBER_LOOK = { shadow: false, outline: UI.outline, outlineW: 2, drop: 1 } as const;

export interface TextOptions {
  color?: string;
  /** Drop shadow colour (the game's default dark), or false for none. */
  shadow?: string | false;
  /** Whole-number magnification: the glyph pixels become scale x scale blocks. */
  scale?: number;
  /** An outline colour around the (scaled) letters. */
  outline?: string;
  /** How thick that outline is in screen pixels (default 1). A floating damage number uses 2 so it holds on a white target. */
  outlineW?: number;
  /** A soft drop shadow: the outlined letters again, this many pixels down and right, half see-through. */
  drop?: number;
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
  const ow = outline ? (opts.outlineW ?? 1) : 0;
  const drop = opts.drop ?? 0;
  const pad = ow;
  const w = Math.max(1, measure(text) * scale);
  const h = GLYPH_H * scale;
  const cw = w + pad * 2 + (shadow || outline ? 1 : 0) * scale + drop;
  const ch = h + pad * 2 + (shadow || outline ? 1 : 0) * scale + drop;
  const key = `${opts.prefix ?? TEXT_PREFIX}${text}|${color}|${shadow || '-'}|${scale}|${outline ?? '-'}${ow > 1 ? `x${ow}` : ''}${drop ? `d${drop}` : ''}`;
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
      // The outline: the letters' silhouette in the outline colour, stamped on every neighbour within `ow` pixels (a rounded ring, not a square one).
      const sil = surface(body.width, body.height);
      sil.g.drawImage(body, 0, 0);
      sil.g.globalCompositeOperation = 'source-in';
      sil.g.fillStyle = outline;
      sil.g.fillRect(0, 0, sil.canvas.width, sil.canvas.height);
      const ring = surface(cw, ch);
      for (let dy = -ow; dy <= ow; dy++) for (let dx = -ow; dx <= ow; dx++) if (dx * dx + dy * dy <= ow * ow + 1) ring.g.drawImage(sil.canvas, pad + dx, pad + dy);
      if (drop) {
        // The drop shadow is the whole outlined shape, shifted and half see-through.
        out.g.globalAlpha = 0.5;
        out.g.drawImage(ring.canvas, drop, drop);
        out.g.globalAlpha = 1;
      }
      out.g.drawImage(ring.canvas, 0, 0);
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
  // The fill is partly see-through, and more so at the top: about 0.85 of the region's opacity there and the full opacity at the
  // bottom (68% to 80% at the shipped 0.8), so the skyline and the floor read through the panels and the text still sits on dark.
  const alphaTop = alpha * SEE_THROUGH_TOP;
  for (let y = 1; y < h - 1; y++) {
    const c = mix(top, bot, y / Math.max(1, h - 1));
    fill(1, y, w - 2, 1, `rgb(${c[0]},${c[1]},${c[2]})`, alphaTop + (alpha - alphaTop) * (y / Math.max(1, h - 2))); // gradient fill
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

/** How many pixels a chip's picture reaches beyond the square it stands for (its dark outline, and the glow ring outside that). */
export const CHIP_PAD = 2;

export interface ChipOptions {
  /** The chip's square, rim included. The picture is `CHIP_PAD` bigger on every side; place it at (x - CHIP_PAD, y - CHIP_PAD). */
  size: number;
  /** A face texture (see `faceTexture`). */
  faceKey: string;
  /** The rim colour: a hero's own colour, or the enemy red. The rim is lightened a little so it reads against the dark panel. */
  rim: string;
  bg: string;
  foe: boolean;
  /** 0 to 1: how far to darken the chip (turns further away, or the next round's preview). */
  dim?: number;
  /** A glow ring colour around the chip: the one who acts next. */
  glow?: string | null;
}

/**
 * A chip: a square with a dark outline, a one-pixel light rim in the owner's colour and a face inside. An enemy's
 * chip is marked two ways so it never reads as a hero's: a second, darker red rim (so the red is twice as thick) and a
 * deep red ground; a duplicate's A/B letter is a badge the HUD hangs on the corner OUTSIDE the face. `dim` darkens it and `glow` rings it.
 */
export function chipTexture(textures: Phaser.Textures.TextureManager, o: ChipOptions): string {
  const { size, faceKey, rim, bg, foe } = o;
  const dim = Math.round((o.dim ?? 0) * 100);
  const key = `${CHIP_PREFIX}${size}-${faceKey}-${rim}-${bg}-${foe ? 'f' : 'p'}-${dim}-${o.glow ?? '-'}`;
  if (textures.exists(key)) return key;
  const total = size + CHIP_PAD * 2;
  const s = surface(total, total);
  const g = s.g;
  if (o.glow) {
    g.fillStyle = o.glow;
    g.fillRect(0, 0, total, total);
  }
  g.fillStyle = UI.outline;
  g.fillRect(1, 1, total - 2, total - 2);
  const light = hexRgb(rim);
  const lit = mix(light, [255, 255, 255], 0.3);
  g.fillStyle = `rgb(${lit[0]},${lit[1]},${lit[2]})`;
  g.fillRect(CHIP_PAD, CHIP_PAD, size, size);
  let inset = 1;
  if (foe) {
    g.fillStyle = '#7a2535';
    g.fillRect(CHIP_PAD + 1, CHIP_PAD + 1, size - 2, size - 2);
    inset = 2;
  }
  g.fillStyle = bg;
  g.fillRect(CHIP_PAD + inset, CHIP_PAD + inset, size - inset * 2, size - inset * 2);
  const face = textures.get(faceKey).getSourceImage() as CanvasImageSource & { width: number; height: number };
  const inner = size - inset * 2;
  g.save();
  g.beginPath();
  g.rect(CHIP_PAD + inset, CHIP_PAD + inset, inner, inner);
  g.clip();
  // The faces are cut from sprites drawn dark on a dark panel, so they are lifted a little (a foe's more): at 14 px the chips must tell people apart.
  g.filter = foe ? 'brightness(1.45) contrast(1.05)' : 'brightness(1.2)';
  g.drawImage(face, CHIP_PAD + inset + Math.floor((inner - face.width) / 2), CHIP_PAD + inset + Math.floor((inner - face.height) / 2));
  g.filter = 'none';
  g.restore();
  if (dim > 0) {
    g.fillStyle = `rgba(7,6,13,${dim / 100})`;
    g.fillRect(CHIP_PAD, CHIP_PAD, size, size);
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

/** One status icon as a texture: 5x5 lit pixels in the status colour inside a one-pixel dark outline. */
export function statusIconTexture(textures: Phaser.Textures.TextureManager, id: StatusId): string {
  const key = `${CHIP_PREFIX}status-${id}`;
  if (textures.exists(key)) return key;
  const look = STATUS_LOOK[id];
  const s = surface(STATUS_ICON_SIZE, STATUS_ICON_SIZE);
  const lit = (x: number, y: number): boolean => look.rows[y]?.[x] === '#';
  s.g.fillStyle = UI.outline;
  for (let y = -1; y <= 5; y++) for (let x = -1; x <= 5; x++) if (lit(x, y) || lit(x - 1, y) || lit(x + 1, y) || lit(x, y - 1) || lit(x, y + 1)) s.g.fillRect(x + 1, y + 1, 1, 1);
  s.g.fillStyle = look.colour;
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) if (lit(x, y)) s.g.fillRect(x + 1, y + 1, 1, 1);
  addCanvasOnce(textures, key, s.canvas);
  return key;
}
