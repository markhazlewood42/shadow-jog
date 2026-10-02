import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { type Raw, SF_ENEMY_LANE, SF_KEEP_OUT, SF_MENU_MARGIN, SF_SLOTS, loopExtent } from '../src/art/rig2/sfgeom';
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
  const ext = Object.fromEntries(crew.map((k) => [k, loopExtent(sheet(`${k}-battle-idle`))])) as Record<(typeof crew)[number], ReturnType<typeof loopExtent>>;
  const box = (i: number) => {
    const e = ext[crew[i] as (typeof crew)[number]];
    const s = SF_SLOTS[i] as { x: number; feet: number };
    // Art pixels: the idle loop's widest reach either side of the feet, from its tallest frame down to the contact shadow (two rows under the soles).
    return { x0: s.x * 2 - e.left, x1: s.x * 2 + e.right, y0: s.feet * 2 - e.height, y1: s.feet * 2 + 2 };
  };

  it('every idle frame of neighbouring members is at least 4 art pixels apart (no blade through the next member)', () => {
    for (let i = 0; i < 3; i++) {
      const front = box(i), back = box(i + 1);
      expect(front.x0 - back.x1, `${crew[i + 1]} to ${crew[i]}`).toBeGreaterThanOrEqual(4);
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
