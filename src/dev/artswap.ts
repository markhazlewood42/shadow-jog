/**
 * Trying out drawn sprites in the game (dev only): `?art=pixellab` swaps the listed characters'
 * field sprites for PixelLab sprite sheets, so they can be walked around town before anything is
 * committed. The sheets live in media/pixellab-preview/ (git-ignored), 8 facings in a row as
 * PixelLab exports them: south, south-east, east, north-east, north, north-west, west, south-west.
 *
 * The game uses 4 facings with 3 frames each (stand, step, step). With no walk frames yet, a step
 * is the standing frame lifted 1 px: a bob, not a stride. The sprite's feet sit on the ground point
 * the same way ours do (two rows up from the bottom of the frame).
 */
import { type CharSprite, type Dir, replaceCharSprite } from '../art/chars';
import { LOOKS } from '../data/looks';

/** Who gets which sheet. */
const SHEETS: { look: keyof typeof LOOKS; file: string; bounce?: boolean }[] = [
  { look: 'kit', file: 'kit.png', bounce: true },
  { look: 'rook', file: 'rook.png' },
];

/** The sheet column for each of the game's facings. */
const COLUMN: Record<Dir, number> = { down: 0, right: 2, up: 4, left: 6 };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`couldn't load ${src}`));
    img.src = src;
  });
}

/** One cell of the sheet, optionally lifted `lift` px (the bob). */
function cell(img: HTMLImageElement, col: number, size: number, lift = 0): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (g) {
    g.imageSmoothingEnabled = false;
    g.drawImage(img, col * size, 0, size, size, 0, -lift, size, size);
  }
  return c;
}

function spriteFrom(img: HTMLImageElement, bounce: boolean): CharSprite {
  const size = img.height;
  const frames = {} as Record<Dir, HTMLCanvasElement[]>;
  for (const [dir, col] of Object.entries(COLUMN) as [Dir, number][]) {
    const stand = cell(img, col, size);
    const step = cell(img, col, size, 1);
    frames[dir] = [stand, step, step];
  }
  return { frames, w: size, h: size, ax: Math.floor(size / 2), ay: size - 2, bounce };
}

/** Swap in every sheet that loads; say which didn't. Resolves with the characters swapped. */
export async function applyPixelLab(base = '/media/pixellab-preview/'): Promise<string[]> {
  const done: string[] = [];
  for (const s of SHEETS) {
    try {
      const img = await loadImage(base + s.file);
      replaceCharSprite(LOOKS[s.look], spriteFrom(img, !!s.bounce));
      done.push(s.look);
    } catch (e) {
      console.warn('art swap:', e instanceof Error ? e.message : e);
    }
  }
  return done;
}
