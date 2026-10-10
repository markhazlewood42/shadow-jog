/**
 * Which way each enemy's picture faces, and whether the stage mirrors it (Phaser spike `spike/phaser-stage`).
 *
 * The heroes stand on the LEFT and face right. The enemies stand on the RIGHT and must face LEFT, toward the heroes.
 * The enemy art was drawn for another battle layout, so some pictures face the wrong way: a club held out to the
 * right of the picture would swing AWAY from the heroes. The fix is a **mirror** (a horizontal flip): in Phaser it is
 * `sprite.setFlipX(true)`, which draws the same picture left-to-right reversed without making a second copy of it.
 *
 * Which enemy is mirrored is DATA, not code: `src/data/enemyfacing.json`, one entry per enemy SPRITE (not per enemy:
 * every appearance of the sprite shares it, so a Rustfang Punk is mirrored everywhere or nowhere). The Battle Stage
 * Editor has a "Mirror (face the heroes)" switch for it and saves the file together with the other stage files.
 *
 *   { "punk": { "mirror": true, "facing": "front", "note": "..." }, ... }
 *
 *  - `mirror`  whether the stage flips this sprite. This is the value the editor switches.
 *  - `facing`  which way the picture AS DRAWN faces: "left", "right", or "front" (straight at the camera). It is a
 *              description for people (and for the editor to show); it never changes what is drawn.
 *  - `note`    one plain sentence: why the sprite is (not) mirrored.
 *
 * This file also holds `mirrorFigure`, the pure maths that turns a figure's measurements (feet, drawn bounds, face,
 * pixels) into the measurements of its mirror image. The stage uses the mirrored measurements everywhere it reads the
 * figure (where its left edge is, where a blow lands on it, which part of the picture is its face), so nothing has to
 * ask "is this one flipped?" again. No Phaser in here, so a unit test can run it.
 */
import { ENEMIES } from '../data/enemies';
import type { Raw } from './pixels';
import type { Pt, Rect } from './faces';
import type { FigureArt } from './textures';

/** Which way a sprite's picture faces as drawn. */
export type Facing = 'left' | 'right' | 'front';

/** What the file says about one sprite. */
export interface FacingEntry {
  mirror: boolean;
  facing: Facing;
  note: string;
}

/** The facing file: an entry for every enemy sprite key. */
export type FacingFile = Record<string, FacingEntry>;

/** The enemy sprite keys the game uses (`ENEMIES[...].sprite`), each once: the entries a facing file must have. */
export const ENEMY_SPRITES: readonly string[] = [...new Set(Object.values(ENEMIES).map((e) => e.sprite))];

const FACINGS: readonly Facing[] = ['left', 'right', 'front'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Everything wrong with a facing file, one problem per line in plain words (empty when it is fine). `sprites` is the
 * list of keys that must have an entry (the game's enemy sprites); an entry for anything else is also a problem, since
 * it would silently do nothing.
 */
export function checkFacing(data: unknown, sprites: readonly string[] = ENEMY_SPRITES): string[] {
  if (!isObj(data)) return ['enemy facing: must be an object with one entry per enemy sprite'];
  const out: string[] = [];
  for (const key of sprites) if (!(key in data)) out.push(`enemy facing: no entry for the sprite "${key}" (every enemy sprite needs one)`);
  for (const [key, v] of Object.entries(data)) {
    if (!sprites.includes(key)) {
      out.push(`enemy facing "${key}": no enemy uses this sprite`);
      continue;
    }
    if (!isObj(v)) {
      out.push(`enemy facing "${key}": must be an object with mirror, facing and note`);
      continue;
    }
    if (typeof v.mirror !== 'boolean') out.push(`enemy facing "${key}": mirror must be true or false`);
    if (typeof v.facing !== 'string' || !FACINGS.includes(v.facing as Facing)) out.push(`enemy facing "${key}": facing must be "left", "right" or "front"`);
    if (typeof v.note !== 'string' || !v.note.trim()) out.push(`enemy facing "${key}": note must say in a sentence why`);
  }
  return out;
}

/** The facing file, checked (throws a readable error listing every problem). */
export function loadFacing(data: unknown, sprites: readonly string[] = ENEMY_SPRITES): FacingFile {
  const problems = checkFacing(data, sprites);
  if (problems.length) throw new Error(`enemyfacing.json is not valid:\n - ${problems.join('\n - ')}`);
  return data as FacingFile;
}

/** Does the stage mirror this sprite? An unknown sprite is not mirrored. */
export function isMirrored(file: FacingFile, sprite: string): boolean {
  return file[sprite]?.mirror === true;
}

// ------------------------------------------------------------------ mirroring a figure's measurements

/** A picture's pixels reversed left-to-right (a new array; the original is not touched). */
export function flipRaw(src: Raw): Raw {
  const px = new Uint8ClampedArray(src.px.length);
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const from = (y * src.w + x) * 4;
      const to = (y * src.w + (src.w - 1 - x)) * 4;
      px[to] = src.px[from] ?? 0;
      px[to + 1] = src.px[from + 1] ?? 0;
      px[to + 2] = src.px[from + 2] ?? 0;
      px[to + 3] = src.px[from + 3] ?? 0;
    }
  }
  return { w: src.w, h: src.h, px };
}

/** The mirror image of a rectangle of a picture `w` wide. */
const flipRect = (r: Rect, w: number): Rect => ({ x: w - r.x - r.w, y: r.y, w: r.w, h: r.h });
/** The mirror image of a pixel position in a picture `w` wide. */
const flipPt = (p: Pt, w: number): Pt => ({ x: w - 1 - p.x, y: p.y });

/** Mirrored figures already made, so a figure is flipped once however often it is asked for. */
const MADE = new WeakMap<FigureArt, FigureArt>();

/**
 * The measurements of a figure's MIRROR IMAGE: the same picture reversed left-to-right about its feet.
 *
 * A flipped Phaser sprite fills the same rectangle as the unflipped one with its contents reversed, so a pixel column
 * `c` of a picture `w` wide is drawn where column `w - 1 - c` would be. The foot (a position BETWEEN pixels, the middle
 * of the boots) goes to `w - foot.x`. Drawn with its origin on that mirrored foot, the flipped figure stands exactly
 * where the unflipped one stood and its left edge is where the unflipped right edge was, as far from the feet. That is
 * "mirrored about the feet": it never shifts sideways.
 *
 * `mirrorOf` remembers the figure this came from, so a face chip can be cut from the original (art painted in 2x2
 * blocks keeps its blocks) and reversed afterwards.
 */
export function mirrorFigure(fig: FigureArt): FigureArt {
  const made = MADE.get(fig);
  if (made) return made;
  const w = fig.raw.w;
  const b = fig.box;
  const out: FigureArt = {
    raw: flipRaw(fig.raw),
    box: { x0: w - 1 - b.x1, x1: w - 1 - b.x0, y0: b.y0, y1: b.y1, feet: w - b.feet },
    foot: { x: w - fig.foot.x, y: fig.foot.y },
    face: flipPt(fig.face, w),
    grain: fig.grain,
    mirrorOf: fig,
    ...(fig.head ? { head: flipRect(fig.head, w) } : {}),
  };
  MADE.set(fig, out);
  return out;
}

/** The figure as the stage draws it: mirrored when the facing file says so. */
export function figureFor(fig: FigureArt, mirror: boolean): FigureArt {
  return mirror ? mirrorFigure(fig) : fig;
}
