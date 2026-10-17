/** turnaround.mjs: cell order, the three mirrors, and the printed note when a mirror moves the katana. */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newImage, readPng, writePng } from '../scripts/art/pixkit/index.mjs';
import { buildTurnaround, flipX, ORDER } from '../scripts/art/turnaround.mjs';

const INK = [0x03, 0x01, 0x02, 255];
const KATANA = '#846042';
const KATANA_RGBA = [0x84, 0x60, 0x42, 255];

/** A 32x32 body (a 10 px wide ink box) with a katana mark at x = kx, and one extra ink pixel at (ex, 5), inside the body width to make the image asymmetric. */
const sprite = (kx: number | null, ex: number) => {
  const img = newImage(32, 32);
  for (let y = 10; y < 30; y++) for (let x = 11; x < 21; x++) img.data.set(INK, (y * 32 + x) * 4);
  if (kx !== null) for (let y = 12; y < 16; y++) img.data.set(KATANA_RGBA, (y * 32 + kx) * 4);
  img.data.set(INK, (5 * 32 + ex) * 4);
  return img;
};
const px = (img: { w: number; data: Uint8Array }, x: number, y: number) => [...img.data.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4)];

describe('turnaround strip', () => {
  const given = sprite(12, 11); // katana on the left of the body
  const set = { given, down: sprite(null, 12), right: sprite(null, 13), upRight: sprite(null, 14), up: sprite(null, 16) };

  it('lists the cells in the order down, down-right, right, up-right, up, up-left, left, down-left', () => {
    const { cells } = buildTurnaround(set, [KATANA]);
    const ids = ['down', 'down-right', 'right', 'up-right', 'up', 'up-left', 'left', 'down-left'];
    expect(ORDER.map((c) => c.id)).toEqual(ids);
    expect(cells.map((c) => c.id)).toEqual(ids);
    expect(cells.map((c) => c.mirror)).toEqual([false, false, false, false, false, true, true, true]);
  });

  it('draws each given image as it is and mirrors up-right, right and the given frame', () => {
    const { cells } = buildTurnaround(set, [KATANA]);
    const by = (id: string) => cells.find((c) => c.id === id)?.img;
    expect(by('down')?.data).toEqual(set.down.data);
    expect(by('down-right')?.data).toEqual(set.given.data);
    expect(by('right')?.data).toEqual(set.right.data);
    expect(by('up-right')?.data).toEqual(set.upRight.data);
    expect(by('up')?.data).toEqual(set.up.data);
    expect(by('up-left')?.data).toEqual(flipX(set.upRight).data);
    expect(by('left')?.data).toEqual(flipX(set.right).data);
    expect(by('down-left')?.data).toEqual(flipX(set.given).data);
    // The extra pixel of the given frame at x=11 lands at x=20 in the mirror.
    expect(px(by('down-left') as never, 20, 5)).toEqual(INK);
    expect(px(by('down-left') as never, 11, 5)).toEqual([0, 0, 0, 0]);
  });

  it('prints one note for each mirrored cell where the katana changes shoulder, and none when it does not', () => {
    // The given frame has the katana on the left and mirrors to the right: one note, for down-left.
    const a = buildTurnaround(set, [KATANA]).notes;
    expect(a).toHaveLength(1);
    expect(a[0]).toContain('down-left');
    expect(a[0]).toContain('from the left shoulder to the right shoulder');
    // Katana on all three mirror sources, left of center: three notes.
    const all = buildTurnaround({ ...set, right: sprite(12, 13), upRight: sprite(12, 14) }, [KATANA]).notes;
    expect(all.map((n) => n.split(' ')[1])).toEqual(['up-left', 'left', 'down-left']);
    // A katana at the body center does not change shoulder.
    expect(buildTurnaround({ ...set, given: sprite(15, 11) }, [KATANA]).notes.some((n) => n.includes('down-left'))).toBe(false);
    // No katana colors: no notes.
    expect(buildTurnaround(set, []).notes).toEqual([]);
  });

  it('the strip is one image with the 8 cells at 1x and 4x', () => {
    const { sheet } = buildTurnaround(set, [KATANA]);
    expect(sheet.w).toBe(8 + 8 * (32 * 4 + 8));
    expect(sheet.h).toBeGreaterThan(32 * 4 + 32);
  });

  it('the command line prints the note and writes the strip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'turnaround-'));
    try {
      const file = (n: string, img: ReturnType<typeof sprite>) => {
        writePng(img, join(dir, n));
        return join(dir, n);
      };
      const out = join(dir, 'strip.png');
      const stdout = execFileSync(
        'node',
        ['scripts/art/turnaround.mjs', '--out', out, '--given', file('given.png', given), '--down', file('d.png', set.down), '--up', file('u.png', set.up), '--right', file('r.png', set.right), '--up-right', file('ur.png', set.upRight)],
        { encoding: 'utf8' },
      );
      expect(stdout).toContain('mirror down-left (from down-right): the katana moves from the left shoulder to the right shoulder');
      expect(readPng(out).w).toBe(8 + 8 * (32 * 4 + 8));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('bad command lines exit 2', () => {
    const run = (args: string[]) => spawnSync('node', ['scripts/art/turnaround.mjs', ...args], { encoding: 'utf8' });
    const withFiles = (fn: (f: (n: string, img: ReturnType<typeof sprite>) => string, dir: string) => void) => {
      const dir = mkdtempSync(join(tmpdir(), 'turnaround-'));
      try {
        fn((n, img) => {
          writePng(img, join(dir, n));
          return join(dir, n);
        }, dir);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
    const full = (f: (n: string, img: ReturnType<typeof sprite>) => string) => ['--given', f('g.png', given), '--down', f('d.png', set.down), '--up', f('u.png', set.up), '--right', f('r.png', set.right), '--up-right', f('ur.png', set.upRight)];

    it('a value flag with no value', () => {
      for (const flag of ['--target', '--frame-size', '--out', '--given', '--down', '--up', '--right', '--up-right']) {
        const r = run([flag]);
        expect(r.status).toBe(2);
        expect(r.stderr).toContain(`${flag} needs a value`);
        expect(r.stderr).toContain('usage:');
      }
    });

    it('a --target file that does not exist', () => {
      withFiles((f, dir) => {
        const r = run([...full(f), '--out', join(dir, 's.png'), '--target', join(dir, 'nope.json')]);
        expect(r.status).toBe(2);
        expect(r.stderr.trim().split('\n')).toHaveLength(1);
        expect(r.stderr).toContain('no such file');
      });
    });

    it('an input frame that is not 32x32', () => {
      withFiles((f, dir) => {
        const args = full(f);
        args[args.indexOf('--down') + 1] = f('big.png', newImage(48, 32) as ReturnType<typeof sprite>);
        const r = run([...args, '--out', join(dir, 's.png')]);
        expect(r.status).toBe(2);
        expect(r.stderr.trim().split('\n')).toHaveLength(1);
        expect(r.stderr).toContain('down is 48x32, not 32x32');
      });
    });
  });
});
