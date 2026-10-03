import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { type Raw, SF_ENEMY_LANE, SF_KEEP_OUT, SF_MENU_MARGIN, SF_SLOTS, boxOf, loopExtent } from '../src/art/rig2/sfgeom';
import { SF_ENEMY_LEFT } from '../src/scenes/battlekit/sideview';

/**
 * The Sprite Fusion side-view layout against Mark's real sprites (spike side-battle, item F-sf-layout round 2). His PNGs are git-excluded, so this
 * only runs where they are (his machine); elsewhere it is skipped, not failed. Everything is in art pixels: the screen is 480x270, the battle world
 * 240x135 drawn at 2x, so a slot's world x is two art pixels.
 */
const DIR = 'spritefusion-tests/extracted';
const have = existsSync(`${DIR}/kit-battle-idle/spritesheet.png`) && existsSync(`${DIR}/sable-battle-idle/spritesheet.png`);

/** A minimal PNG reader: 8-bit RGBA, not interlaced (what Sprite Fusion writes). */
function readPng(path: string): Raw {
  const b = readFileSync(path);
  let p = 8;
  let w = 0, h = 0;
  const idat: Buffer[] = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString('ascii', p + 4, p + 8);
    if (type === 'IHDR') { w = b.readUInt32BE(p + 8); h = b.readUInt32BE(p + 12); expect(b[p + 16]).toBe(8); expect(b[p + 17]).toBe(6); }
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

function sheet(name: string): Raw[] {
  const meta = JSON.parse(readFileSync(`${DIR}/${name}/metadata.json`, 'utf8')) as { frame_w: number; frame_count: number };
  const s = readPng(`${DIR}/${name}/spritesheet.png`);
  return Array.from({ length: meta.frame_count }, (_, i) => {
    const px = new Uint8ClampedArray(meta.frame_w * s.h * 4);
    for (let y = 0; y < s.h; y++) px.set(s.px.subarray((y * s.w + i * meta.frame_w) * 4, (y * s.w + (i + 1) * meta.frame_w) * 4), y * meta.frame_w * 4);
    return { w: meta.frame_w, h: s.h, px };
  });
}

describe.skipIf(!have)("the Sprite Fusion side layout against Mark's sprites", () => {
  const crew = ['kit', 'rook', 'hex', 'sable'] as const;
  // `describe.skipIf` still RUNS this callback to collect the tests, so without Mark's PNGs (CI) the sheets must not be read here: that threw ENOENT and failed CI's `npm test`.
  const ext = (have ? Object.fromEntries(crew.map((k) => [k, loopExtent(sheet(`${k}-battle-idle`))])) : {}) as Record<(typeof crew)[number], ReturnType<typeof loopExtent>>;
  const box = (i: number) => {
    const e = ext[crew[i] as (typeof crew)[number]];
    const s = SF_SLOTS[i] as { x: number; feet: number };
    // Art pixels: the idle loop's widest reach either side of the feet, from its tallest frame down to the contact shadow (two rows under the soles).
    return { x0: s.x * 2 - e.left, x1: s.x * 2 + e.right, y0: s.feet * 2 - e.height, y1: s.feet * 2 + 2 };
  };

  /** Every opaque pixel of every idle frame of member `i`, placed in screen (art) pixels: a mask of the whole loop. */
  const mask = (i: number): Uint8Array => {
    const k = crew[i] as (typeof crew)[number];
    const frames = sheet(`${k}-battle-idle`);
    const e = ext[k];
    void e;
    const m = new Uint8Array(480 * 270);
    const slot = SF_SLOTS[i] as { x: number; feet: number };
    // The feet axis is the mean feet midpoint over the loop, as the engine anchors it; the bottom row of each frame stands on the slot's feet row.
    const ax = Math.round(frames.reduce((n, f) => n + boxOf(f).feet, 0) / frames.length);
    for (const f of frames) {
      const b = boxOf(f);
      for (let y = 0; y < f.h; y++)
        for (let x = 0; x < f.w; x++)
          if ((f.px[(y * f.w + x) * 4 + 3] ?? 0) > 0) {
            const sx = x - ax + slot.x * 2, sy = y - (b.y1) + slot.feet * 2;
            if (sx >= 0 && sx < 480 && sy >= 0 && sy < 270) m[sy * 480 + sx] = 1;
          }
    }
    return m;
  };

  it('no pixel of any idle frame of a member comes within 3 art pixels of the member in front (the raised blade passes over a head: pixels, not boxes)', () => {
    for (let i = 0; i < 3; i++) {
      const front = mask(i), back = mask(i + 1);
      let nearest = 99;
      for (let y = 3; y < 267; y++)
        for (let x = 3; x < 477; x++) {
          if (!back[y * 480 + x]) continue;
          for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (front[(y + dy) * 480 + x + dx]) nearest = Math.min(nearest, Math.max(Math.abs(dx), Math.abs(dy)));
        }
      expect(nearest, `${crew[i + 1]} against ${crew[i]}`).toBeGreaterThan(3);
    }
  });

  it('no member is cut off by the left edge of the screen', () => {
    for (let i = 0; i < 4; i++) expect(box(i).x0).toBeGreaterThanOrEqual(0);
  });

  it(`every member is at least ${SF_MENU_MARGIN} art pixels from the command menu, the ability list and the target box`, () => {
    for (let i = 0; i < 4; i++) {
      const b = box(i);
      for (const k of SF_KEEP_OUT) {
        const dx = Math.max(k.x0 - b.x1, b.x0 - k.x1, 0);
        const dy = Math.max(k.y0 - b.y1, b.y0 - k.y1, 0);
        expect(Math.max(dx, dy), `${crew[i]} against the ${k.name}`).toBeGreaterThanOrEqual(SF_MENU_MARGIN);
      }
    }
  });

  it(`the nearest enemy starts at least ${SF_ENEMY_LANE} art pixels in front of Kit`, () => {
    expect(SF_ENEMY_LEFT * 2 - box(0).x1).toBeGreaterThanOrEqual(SF_ENEMY_LANE);
  });
});
