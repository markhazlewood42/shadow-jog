// render-rig: render the rig v2 Rook facings (public/art/rig/field.json, key rook) into 32x32 PNGs.
// Run: node scripts/art/render-rig.mjs [--out media/rook-turnaround/rig] [--key <sheet.png>] [--key-frame 4]
// Char rule (src/art/rig2/rig.ts decode): '.' is transparent, any other char is the index of that char in
// '0-9a-z A-Z' (CH), which indexes the facing's pal list.
// Placement: centered horizontally (left = floor((32 - w) / 2)); the facing's `feet` row lands on the lowest opaque row of the given frame.
// Writes rook-<facing>.png for down, right, up, left. Prints one line per facing.
import { readFileSync } from 'node:fs';
import { bbox } from './metrics.mjs';
import { crop, newImage, readPng, unhex, writePng } from './pixkit/png.mjs';

const CH = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const FIELD = 'public/art/rig/field.json';

/** Render one traced facing { w, h, feet, pal, rows } into a size x size image. Returns { img, left, top }. */
export function renderFacing(t, feetRow, size = 32) {
  const img = newImage(size, size);
  const left = Math.floor((size - t.w) / 2);
  const top = feetRow - t.feet;
  for (let y = 0; y < t.h; y++) {
    for (let x = 0; x < t.w; x++) {
      const ch = (t.rows[y] ?? '')[x] ?? '.';
      if (ch === '.') continue;
      const hex = t.pal[CH.indexOf(ch)];
      if (!hex) throw new Error(`char ${ch} has no palette entry`);
      const px = left + x;
      const py = top + y;
      if (px < 0 || py < 0 || px >= size || py >= size) throw new Error(`pixel ${px},${py} falls outside ${size}x${size}`);
      img.data.set([...unhex(hex), 255], (py * size + px) * 4);
    }
  }
  return { img, left, top };
}

function main() {
  const args = process.argv.slice(2);
  const get = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
  const out = get('--out', 'media/rook-turnaround/rig');
  const keyPath = get('--key', 'media/rook-turnaround/walk/spritesheet.png');
  const keyFrame = Number(get('--key-frame', 4));
  const sheet = readPng(keyPath);
  const key = crop(sheet, keyFrame * 32 % sheet.w, 0, 32, 32);
  const feetRow = bbox(key).y1;
  const rook = JSON.parse(readFileSync(FIELD, 'utf8')).rook;
  for (const facing of ['down', 'right', 'up', 'left']) {
    const t = rook[facing];
    const { img, left, top } = renderFacing(t, feetRow, 32);
    writePng(img, `${out}/rook-${facing}.png`);
    console.log(`${facing}: ${t.w}x${t.h}, feet ${t.feet} -> row ${feetRow} (left ${left}, top ${top})`);
  }
}

main();
