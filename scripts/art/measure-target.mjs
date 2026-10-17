// Step 0: measure the Rook walk sheet and the battle idle, write docs/spikes/rook-turnaround/target.json.
// Run: node scripts/art/measure-target.mjs
// Needs media/rook-turnaround/walk/ (unzip spritefusion-tests/rook-overworld-walk.zip there). Run it from the repo root.
// katanaColors and katanaNote in target.json are set by hand; this script keeps what the file already has.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { bbox, colorsOf, isOpaque, itemSide, luminance, measureFrame, NEAR_BLACK_LUMA } from './metrics.mjs';
import { frames, readPng } from './pixkit/png.mjs';

const WALK = 'media/rook-turnaround/walk';
const OUT = 'docs/spikes/rook-turnaround/target.json';
const walkMeta = JSON.parse(readFileSync(`${WALK}/metadata.json`, 'utf8'));
const walk = frames(readPng(`${WALK}/spritesheet.png`), walkMeta.frame_w, walkMeta.frame_h);
if (walk.length !== walkMeta.frame_count) throw new Error(`expected ${walkMeta.frame_count} frames, got ${walk.length}`);

// The walk palette: every opaque color of the whole sheet.
const sheetColors = new Set();
for (const f of walk) for (const c of colorsOf(f)) sheetColors.add(c);
const walkPalette = [...sheetColors].sort();
const nearBlack = walkPalette.filter((c) => luminance(c) < NEAR_BLACK_LUMA);

// The given frame: the frame with the feet closest together. Feet = the bottom 4 rows of the bounding box.
// Score = the horizontal extent (max x - min x + 1) of the opaque pixels in those rows. Smallest wins; a tie goes to the lowest index.
const footExtent = walk.map((f) => {
  const b = bbox(f);
  let lo = f.w;
  let hi = -1;
  for (let y = b.y1 - 3; y <= b.y1; y++) {
    for (let x = 0; x < f.w; x++) {
      if (!isOpaque(f, x, y)) continue;
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
  }
  return hi - lo + 1;
});
const givenFrame = footExtent.indexOf(Math.min(...footExtent));

// Battle idle.
const idleMeta = JSON.parse(readFileSync('public/art/crew/rook/idle/metadata.json', 'utf8'));
const idleFrames = frames(readPng('public/art/crew/rook/idle/spritesheet.png'), idleMeta.frame_w, idleMeta.frame_h);
const idleSet = new Set();
for (const f of idleFrames) for (const c of colorsOf(f)) idleSet.add(c);
const idlePalette = [...idleSet].sort();
const shared = idlePalette.filter((c) => sheetColors.has(c));

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const katana = prev.katanaColors ?? [];
const perFrame = walk.map((f) => ({ ...measureFrame(f, nearBlack), itemSide: katana.length ? itemSide(f, katana) : null }));
const idleMeasured = idleFrames.map((f) => measureFrame(f));
const range = (key) => [Math.min(...perFrame.map((p) => p[key])), Math.max(...perFrame.map((p) => p[key]))];
const target = {
  note: 'Written by scripts/art/measure-target.mjs. Step 2 adds the copy-tripwire baseline; it is left out here on purpose.',
  source: 'spritefusion-tests/rook-overworld-walk.zip (8 frames of 32x32)',
  luminanceFormula: '0.299*R + 0.587*G + 0.114*B (0..255)',
  nearBlackThreshold: NEAR_BLACK_LUMA,
  walkPalette,
  walkPaletteCount: walkPalette.length,
  nearBlack,
  frameSize: [walkMeta.frame_w, walkMeta.frame_h],
  katanaColors: katana,
  katanaNote: prev.katanaNote ?? '',
  definitions: {
    bodyHeight: 'height of the bounding box of opaque pixels',
    headWidth: 'widest opaque row extent (max x - min x + 1) over the top third of the bounding box (rows y0 .. y0 + floor(h/3) - 1)',
    outlineRatio:
      'near-black edge pixels / edge pixels; edge = opaque pixel with a transparent 4-neighbor, out of bounds counts as transparent; near-black = a color in the nearBlack list',
    orphans: 'opaque pixels whose color matches none of the 8 neighbors',
    smallRegions:
      'squint view (pack PA-09): 4 value steps = min(3, floor(luminance/64)); count of 4-connected components of equal step with size 1 or 2. This is the definition behind the spike doc range 60 to 72.',
    smallRegionsSameColor: '4-connected components of equal exact color with size 1 or 2 (the brief wording). Measures 108 to 132 on the walk sheet, so it is not the doc basis.',
    clusterSize: 'min, median, max size of the 4-connected same-color components; regions = their count',
  },
  givenFrame,
  givenFrameMethod: `Feet closest together: smallest horizontal extent (max x - min x + 1) of the opaque pixels in the bottom 4 rows of the bounding box. Extents per frame: [${footExtent.join(', ')}]. A tie goes to the lowest index.`,
  given: perFrame[givenFrame],
  frames: perFrame,
  ranges: {
    bodyHeight: range('bodyHeight'),
    headWidth: range('headWidth'),
    outlineRatio: range('outlineRatio'),
    orphans: range('orphans'),
    smallRegions: range('smallRegions'),
    smallRegionsSameColor: range('smallRegionsSameColor'),
  },
  battleIdle: {
    source: 'public/art/crew/rook/idle/spritesheet.png',
    frameSize: [idleMeta.frame_w, idleMeta.frame_h],
    frameCount: idleFrames.length,
    ranges: {
      outlineRatio: [Math.min(...idleMeasured.map((p) => p.outlineRatio)), Math.max(...idleMeasured.map((p) => p.outlineRatio))],
      orphans: [Math.min(...idleMeasured.map((p) => p.orphans)), Math.max(...idleMeasured.map((p) => p.orphans))],
      smallRegions: [Math.min(...idleMeasured.map((p) => p.smallRegions)), Math.max(...idleMeasured.map((p) => p.smallRegions))],
    },
    palette: idlePalette,
    colorCount: idlePalette.length,
    sharedWithWalkPalette: shared,
    sharesNoColorWithWalk: shared.length === 0,
  },
};
writeFileSync(OUT, `${JSON.stringify(target, null, 2)}\n`);
console.log(
  JSON.stringify(
    { givenFrame, footExtent, walkColors: walkPalette.length, nearBlack, ranges: target.ranges, given: target.given, idleColors: idlePalette.length, shared },
    null,
    1,
  ),
);
