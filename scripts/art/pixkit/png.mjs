// PNG read and write through pngjs. An image here is { w, h, data } with data as RGBA bytes (Uint8Array, 4 per pixel).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PNG } from 'pngjs';

/** Read a PNG file into { w, h, data }. */
export function readPng(path) {
  const png = PNG.sync.read(readFileSync(path));
  return { w: png.width, h: png.height, data: new Uint8Array(png.data) };
}

/** Write { w, h, data } to a PNG file. Makes the folder if needed. */
export function writePng(img, path) {
  const png = new PNG({ width: img.w, height: img.h });
  png.data = Buffer.from(img.data);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, PNG.sync.write(png));
}

/** A new image, fully transparent (or filled with one RGBA color). */
export function newImage(w, h, rgba = [0, 0, 0, 0]) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return { w, h, data };
}

/** Copy a rectangle out of an image. Pixels outside the source stay transparent. */
export function crop(img, x, y, w, h) {
  const out = newImage(w, h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const sx = x + i;
      const sy = y + j;
      if (sx < 0 || sy < 0 || sx >= img.w || sy >= img.h) continue;
      const s = (sy * img.w + sx) * 4;
      out.data.set(img.data.subarray(s, s + 4), (j * w + i) * 4);
    }
  }
  return out;
}

/** Split a sheet into frames of frameW x frameH (row-major). */
export function frames(img, frameW, frameH) {
  const out = [];
  for (let y = 0; y + frameH <= img.h; y += frameH) {
    for (let x = 0; x + frameW <= img.w; x += frameW) out.push(crop(img, x, y, frameW, frameH));
  }
  return out;
}

/** "#rrggbb" for an RGB triple. */
export function hex(r, g, b) {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** [r, g, b] for "#rrggbb". */
export function unhex(s) {
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) throw new Error(`bad color ${s}`);
  return [Number.parseInt(s.slice(1, 3), 16), Number.parseInt(s.slice(3, 5), 16), Number.parseInt(s.slice(5, 7), 16)];
}
