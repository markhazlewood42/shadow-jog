/**
 * Small pixel helpers shared by the engine lab pages' test hooks (`hook.ts` for /sjelab.html, `stagehook.ts` for /sjestage.html): a
 * frame fingerprint, the 4x4 block count, and a PNG of a frame. They run inside the page, so a test does not have to ship half a
 * megabyte of pixels through Playwright for every check. Dev and tests only: the shipped game never loads this file.
 */
import type { Pixels } from '../sje';

export interface BlockStats {
  /** The zoom the canvas is at (whole device pixels per game pixel). */
  k: number;
  /** The canvas size in device pixels. */
  canvasW: number;
  canvasH: number;
  /** How many k-by-k blocks there are, and how many are NOT one flat colour. */
  blocks: number;
  bad: number;
  samples: Array<{ x: number; y: number }>;
}

/** A 53-bit string hash (cyrb53) over 32-bit words. Not secure: just a fast fingerprint of a frame. */
export function fingerprint(words: Uint32Array): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < words.length; i++) {
    const w = words[i] ?? 0;
    h1 = Math.imul(h1 ^ w, 2654435761);
    h2 = Math.imul(h2 ^ w, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** A picture's pixels as 32-bit words (one per pixel). */
export const words = (p: Pixels): Uint32Array => new Uint32Array(p.data.buffer, p.data.byteOffset, p.w * p.h);

/** Count the k-by-k blocks of an image that are not one flat colour. */
export function countBlocks(px: Pixels, k: number): BlockStats {
  const all = new Uint32Array(px.data.buffer, px.data.byteOffset, px.w * px.h);
  const stats: BlockStats = { k, canvasW: px.w, canvasH: px.h, blocks: 0, bad: 0, samples: [] };
  for (let by = 0; by < Math.floor(px.h / k); by++) {
    for (let bx = 0; bx < Math.floor(px.w / k); bx++) {
      stats.blocks++;
      const first = all[by * k * px.w + bx * k];
      let flat = true;
      for (let dy = 0; dy < k && flat; dy++) {
        const row = (by * k + dy) * px.w + bx * k;
        for (let dx = 0; dx < k; dx++) {
          if (all[row + dx] !== first) {
            flat = false;
            break;
          }
        }
      }
      if (!flat) {
        stats.bad++;
        if (stats.samples.length < 8) stats.samples.push({ x: bx, y: by });
      }
    }
  }
  return stats;
}

/** A picture, scaled up by a whole number, as a PNG data URL. */
export function toPng(p: Pixels, scale: number): string {
  const small = document.createElement('canvas');
  small.width = p.w;
  small.height = p.h;
  small.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.w, p.h), 0, 0);
  const big = document.createElement('canvas');
  big.width = p.w * scale;
  big.height = p.h * scale;
  const c = big.getContext('2d');
  if (!c) throw new Error('no 2D context');
  c.imageSmoothingEnabled = false;
  c.drawImage(small, 0, 0, big.width, big.height);
  return big.toDataURL('image/png');
}

/** The pixels as base64 text (RGBA, top row first), the way a test reads them out of the page. */
export function toBase64(p: Pixels): string {
  let bin = '';
  for (let i = 0; i < p.data.length; i += 0x8000) bin += String.fromCharCode(...p.data.subarray(i, i + 0x8000));
  return btoa(bin);
}
