/** pixlint (scripts/art/pixlint.mjs): passes the 8 Rook walk frames and the battle idle, fails the warden and a half-transparent image. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import target from '../docs/spikes/rook-turnaround/target.json';
import { newImage, writePng } from '../scripts/art/pixkit/index.mjs';
import { hasFail, lintFile, lintFrame } from '../scripts/art/pixlint.mjs';

const WALK_ZIP = 'spritefusion-tests/rook-overworld-walk.zip';
const IDLE = 'public/art/crew/rook/idle/spritesheet.png';
const WARDEN = 'public/art/enemies/warden.png';
const INK = [0x03, 0x01, 0x02, 255];

/** Read one file out of a zip with Node built-ins only (central directory, stored or deflated). */
function unzipEntry(zipPath: string, name: string): Buffer {
  const z = readFileSync(zipPath);
  const eocd = z.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = z.readUInt32LE(eocd + 16);
  for (let n = z.readUInt16LE(eocd + 10); n > 0; n--) {
    const method = z.readUInt16LE(p + 10);
    const size = z.readUInt32LE(p + 20);
    const nameLen = z.readUInt16LE(p + 28);
    const extraLen = z.readUInt16LE(p + 30);
    const commentLen = z.readUInt16LE(p + 32);
    const local = z.readUInt32LE(p + 42);
    if (z.toString('utf8', p + 46, p + 46 + nameLen) === name) {
      const start = local + 30 + z.readUInt16LE(local + 26) + z.readUInt16LE(local + 28);
      const data = z.subarray(start, start + size);
      return method === 0 ? data : inflateRawSync(data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${name} not in ${zipPath}`);
}

/** The walk sheet is committed as a zip. Write its spritesheet.png to the temp folder once. */
function walkSheet(): string {
  const dir = join(tmpdir(), 'pixlint-walk-sheet');
  const sheet = join(dir, 'spritesheet.png');
  if (!existsSync(sheet)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(sheet, unzipEntry(WALK_ZIP, 'spritesheet.png'));
  }
  return sheet;
}

const failing = (items: { status: string; id: string; name: string }[]) => items.filter((i) => i.status === 'fail').map((i) => `${i.id} ${i.name}`);

describe('pixlint pass line', () => {
  it('passes all 8 walk frames against the walk palette', () => {
    const results = lintFile(walkSheet(), { all: true, frameSize: [32, 32], palette: target.walkPalette, target });
    const frames = results.filter((r) => r.label.startsWith('frame'));
    expect(frames).toHaveLength(8);
    for (const r of frames) expect(failing(r.items)).toEqual([]);
    expect(results.find((r) => r.label === 'animation')?.items[0]?.status).toBe('pass');
    // The given frame has 32 orphans, so the limit is floor(1.25 * 32) = 40.
    expect(frames[4]?.items.find((i) => i.id === 'PA-04')?.value).toBe('32 (limit 40)');
    expect(frames[4]?.items.find((i) => i.id === 'PA-21')?.value).toContain('left');
  });

  it('passes the battle idle against its own palette and skips the facing checks', () => {
    const results = lintFile(IDLE, { all: true, frameSize: [79, 68], paletteFrom: IDLE, target });
    const frames = results.filter((r) => r.label.startsWith('frame'));
    expect(frames).toHaveLength(8);
    for (const r of frames) {
      expect(failing(r.items)).toEqual([]);
      expect(r.items.find((i) => i.id === 'PA-07')?.status).toBe('skipped');
      expect(r.items.find((i) => i.id === 'PA-21')?.status).toBe('skipped');
    }
  });

  it('fails the warden against the walk palette', () => {
    const items = lintFile(WARDEN, { palette: target.walkPalette, target })[0]?.items ?? [];
    expect(items.find((i) => i.id === 'PA-01' && i.name === 'only palette colors')?.status).toBe('fail');
    expect(items.find((i) => i.id === 'PA-01' && i.name === 'color count')?.value).toContain('5548 colors');
    expect(hasFail(items)).toBe(true);
  });

  it('fails a half-transparent test image and passes the same image made opaque', () => {
    const pal = target.walkPalette;
    const img = newImage(32, 32);
    for (let y = 8; y < 24; y++) for (let x = 8; x < 24; x++) img.data.set(INK, (y * 32 + x) * 4);
    const opaque = { ...img, data: img.data.slice() };
    img.data.set([0x03, 0x01, 0x02, 128], (10 * 32 + 10) * 4);
    expect(lintFrame(opaque, { palette: pal }).find((i) => i.id === 'PA-02')?.status).toBe('pass');
    const a = lintFrame(img, { palette: pal }).find((i) => i.id === 'PA-02');
    expect(a?.status).toBe('fail');
    expect(a?.value).toBe('1 px');
    const dir = mkdtempSync(join(tmpdir(), 'pixlint-half-'));
    try {
      writePng(img, join(dir, 'half.png'));
      expect(hasFail(lintFile(join(dir, 'half.png'), { palette: pal, target })[0]?.items ?? [])).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails a facing that is 2 px too tall, and one with an off-palette color', () => {
    const pal = target.walkPalette;
    const body = (h: number) => {
      const img = newImage(32, 32);
      for (let y = 31 - h; y < 31; y++) for (let x = 6; x < 25; x++) img.data.set(INK, (y * 32 + x) * 4);
      return img;
    };
    const opts = { palette: pal, ref: { ...target.given, bodyHeight: 20 }, refColors: pal, katana: target.katanaColors, facing: true };
    const height = (h: number) => lintFrame(body(h), opts).find((i) => i.id === 'PA-07' && i.name.startsWith('body height'));
    expect(height(20)?.status).toBe('pass');
    expect(height(21)?.status).toBe('pass');
    expect(height(22)?.status).toBe('fail');
    const odd = body(20);
    odd.data.set([255, 0, 0, 255], (25 * 32 + 10) * 4);
    expect(lintFrame(odd, opts).find((i) => i.name === 'only palette colors')?.status).toBe('fail');
  });
});
