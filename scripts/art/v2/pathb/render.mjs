// Path B previews: part map and light map of a sheet as PNG at 8x, with a gutter that marks the guide rows.
import { newImage, writePng } from '../../pixkit/png.mjs';
import { LEVEL, lightMap } from './maps.mjs';
import { SIZE } from './sheet.mjs';

export const SCALE = 8;
const GUTTER = 20;
const PART_RGB = {
  hair: [112, 78, 160], skin: [232, 184, 150], lenses: [236, 168, 40], beard: [160, 110, 80], coat: [70, 110, 150], sleeves: [96, 140, 120],
  zipper: [200, 205, 210], hands: [214, 140, 110], legs: [60, 62, 90], boots: [120, 72, 40], sheath: [170, 130, 70], guard: [240, 214, 90], wrap: [150, 40, 60],
};
const LEVEL_RGB = [[0, 0, 0], [58, 52, 96], [150, 150, 160], [250, 238, 160]];
const GUIDE_RGB = [255, 90, 90];

const fill = (img, x, y, w, h, rgb) => {
  for (let j = y; j < y + h; j++)
    for (let i = x; i < x + w; i++) {
      if (i < 0 || j < 0 || i >= img.w || j >= img.h) continue;
      img.data.set([...rgb, 255], (j * img.w + i) * 4);
    }
};
function canvas(data, paint) {
  const img = newImage(GUTTER + SIZE * SCALE, SIZE * SCALE, [24, 24, 28, 255]);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) paint(x, y, (rgb) => fill(img, GUTTER + x * SCALE, y * SCALE, SCALE, SCALE, rgb));
  // guide rows: a tick in the gutter and a thin line at the top of the row
  for (const row of Object.values(data.character.rows)) {
    fill(img, 0, row * SCALE, GUTTER - 4, 2, GUIDE_RGB);
    fill(img, GUTTER, row * SCALE, SIZE * SCALE, 1, GUIDE_RGB);
  }
  return img;
}
export const partMapImage = (data, sheet) =>
  canvas(data, (x, y, put) => {
    const p = sheet.labels[y * SIZE + x];
    if (p) put(PART_RGB[p] ?? [255, 0, 255]);
  });
export function lightMapImage(data, sheet, light = lightMap(data, sheet)) {
  return canvas(data, (x, y, put) => {
    const v = light[y * SIZE + x];
    if (v !== LEVEL.none) put(LEVEL_RGB[v]);
  });
}
export const writePreview = (img, path) => writePng(img, path);
