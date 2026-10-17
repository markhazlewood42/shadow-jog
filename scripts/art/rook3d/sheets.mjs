// Turn the render's frames into the repo's sheet format, 8x previews and a contact sheet with the given beside the 8 facings.
//   node scripts/art/rook3d/sheets.mjs <render dir> <out dir>
// Sheet format = public/art/crew/<id>/idle/: spritesheet.png (frames in one row) + metadata.json (type, width, height, frame_w, frame_h, frame_count, fps, preview, spritesheet).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadGiven } from '../pipeline/given.mjs';
import { newImage, readPng, writePng } from '../pixkit/png.mjs';

const [src, out] = process.argv.slice(2);
if (!src || !out) throw new Error('usage: sheets.mjs <render dir> <out dir>');
const manifest = JSON.parse(readFileSync(`${src}/manifest.json`, 'utf8'));
const FACINGS = ['s', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw'];
const BG = [74, 98, 74, 255]; // a flat green, so light and dark colors both read

function blit(dst, img, x0, y0, scale = 1) {
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * 4;
      if (img.data[i + 3] === 0) continue;
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) dst.data.set(img.data.subarray(i, i + 4), ((y0 + y * scale + dy) * dst.w + x0 + x * scale + dx) * 4);
    }
}
const scaled = (img, k) => {
  const o = newImage(img.w * k, img.h * k);
  blit(o, img, 0, 0, k);
  return o;
};
const sheetOf = (imgs) => {
  const o = newImage(imgs[0].w * imgs.length, imgs[0].h);
  imgs.forEach((im, i) => blit(o, im, i * im.w, 0));
  return o;
};
const meta = (w, h, n, prompt) => ({ type: 'animation', prompt, width: w * n, height: h, frame_w: w, frame_h: h, frame_count: n, fps: 8, preview: 'preview-8x.png', spritesheet: 'spritesheet.png' });

const frame = (name) => readPng(`${src}/frames/${name}.png`);
const walk = Object.fromEntries(FACINGS.map((f) => [f, [0, 1, 2, 3].map((i) => frame(`${f}_walk${i}`))]));

for (const f of FACINGS) {
  const dir = `${out}/${f}/walk`;
  mkdirSync(dir, { recursive: true });
  const sheet = sheetOf(walk[f]);
  writePng(sheet, `${dir}/spritesheet.png`);
  writePng(scaled(sheet, 8), `${dir}/preview-8x.png`);
  writeFileSync(`${dir}/metadata.json`, `${JSON.stringify(meta(32, 32, 4, `Rook from a 3D model, facing ${f}, 4-frame walk (frame 0 is the passing pose), rendered by scripts/art/rook3d`), null, 2)}\n`);
}
for (const pose of ['ready', 'downSwing']) {
  const dir = `${out}/battle/${pose}`;
  mkdirSync(dir, { recursive: true });
  const im = frame(`battle_${pose}`);
  writePng(im, `${dir}/spritesheet.png`);
  writePng(scaled(im, 8), `${dir}/preview-8x.png`);
  writeFileSync(`${dir}/metadata.json`, `${JSON.stringify(meta(79, 68, 1, `Rook from a 3D model, battle pose ${pose}, rendered by scripts/art/rook3d`), null, 2)}\n`);
}

// Contact sheet: row 1 = the given (left) beside the 8 facings, walk frame 0; row 2 = the same at frame 2 (the other leg passes).
// Scale 4. Row 3 and 4 repeat at scale 1 (the size a player sees).
const given = loadGiven();
const K = 4;
const pad = 4;
const cell = 32 * K + pad;
const cs = newImage(cell * 9 + pad, cell * 2 + pad + 32 + pad * 2);
for (let i = 0; i < cs.w * cs.h; i++) cs.data.set(BG, i * 4);
blit(cs, scaled(given, K), pad, pad);
FACINGS.forEach((f, i) => {
  blit(cs, scaled(walk[f][0], K), pad + cell * (i + 1), pad);
  blit(cs, scaled(walk[f][1], K), pad + cell * (i + 1), pad + cell);
});
blit(cs, given, pad, pad + cell * 2);
FACINGS.forEach((f, i) => blit(cs, walk[f][0], pad + cell * (i + 1), pad + cell * 2));
writePng(cs, `${out}/contact-sheet.png`);

// Battle poses beside the battle idle frame 0 of the repo (the PixelLab-made sheet), 3x.
const idle = readPng('public/art/crew/rook/idle/spritesheet.png');
const idle0 = { w: 79, h: 68, data: new Uint8Array(79 * 68 * 4) };
for (let y = 0; y < 68; y++) for (let x = 0; x < 79; x++) idle0.data.set(idle.data.subarray((y * idle.w + x) * 4, (y * idle.w + x) * 4 + 4), (y * 79 + x) * 4);
const B = 3;
const bs = newImage((79 * B + pad) * 3 + pad, 68 * B + pad * 2);
for (let i = 0; i < bs.w * bs.h; i++) bs.data.set(BG, i * 4);
[idle0, frame('battle_ready'), frame('battle_downSwing')].forEach((im, i) => blit(bs, scaled(im, B), pad + (79 * B + pad) * i, pad));
writePng(bs, `${out}/contact-sheet-battle.png`);
console.log(`wrote sheets, previews and contact sheets to ${out}`);
