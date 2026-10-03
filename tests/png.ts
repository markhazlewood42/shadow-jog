import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import type { Raw } from '../src/art/rig2/sfgeom';

/** A minimal PNG reader for tests: 8-bit RGBA, not interlaced (what Sprite Fusion writes). */
export function readPng(path: string): Raw {
  const b = readFileSync(path);
  let p = 8;
  let w = 0, h = 0;
  const idat: Buffer[] = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString('ascii', p + 4, p + 8);
    if (type === 'IHDR') { w = b.readUInt32BE(p + 8); h = b.readUInt32BE(p + 12); }
    if (type === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = new Uint8ClampedArray(w * h * 4);
  const stride = w * 4;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)] ?? 0;
    for (let x = 0; x < stride; x++) {
      const cur = raw[y * (stride + 1) + 1 + x] ?? 0;
      const left = x >= 4 ? (px[y * stride + x - 4] ?? 0) : 0;
      const up = y > 0 ? (px[(y - 1) * stride + x] ?? 0) : 0;
      const ul = x >= 4 && y > 0 ? (px[(y - 1) * stride + x - 4] ?? 0) : 0;
      let v = cur;
      if (f === 1) v += left;
      else if (f === 2) v += up;
      else if (f === 3) v += Math.floor((left + up) / 2);
      else if (f === 4) {
        const pa = Math.abs(up - ul), pb = Math.abs(left - ul), pc = Math.abs(left + up - 2 * ul);
        v += pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
      }
      px[y * stride + x] = v & 255;
    }
  }
  return { w, h, px };
}

/** The frames of an extracted Sprite Fusion sheet (`extracted/<name>/spritesheet.png` + `metadata.json`). */
export function sheetFrames(dir: string, name: string): Raw[] {
  const meta = JSON.parse(readFileSync(`${dir}/extracted/${name}/metadata.json`, 'utf8')) as { frame_w: number; frame_count: number };
  const s = readPng(`${dir}/extracted/${name}/spritesheet.png`);
  return Array.from({ length: meta.frame_count }, (_, i) => {
    const px = new Uint8ClampedArray(meta.frame_w * s.h * 4);
    for (let y = 0; y < s.h; y++) px.set(s.px.subarray((y * s.w + i * meta.frame_w) * 4, (y * s.w + (i + 1) * meta.frame_w) * 4), y * meta.frame_w * 4);
    return { w: meta.frame_w, h: s.h, px };
  });
}
