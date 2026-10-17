// pixlint: the [script] checks of the pixel-artist-characters pack (PA-xx), plus a facing-consistency check.
//
// CLI:  node scripts/art/pixlint.mjs <image.png> [options]
//   --frame N              lint frame N of a sheet (needs --frame-size)
//   --all                  lint every frame of the sheet, then the animation checks (PA-10) across them
//   --frame-size WxH       frame size of the sheet (default: the whole image is one frame)
//   --palette <file.json>  the palette: a JSON array of "#rrggbb", or an object with walkPalette or palette (target.json works)
//   --palette-key <a.b>    with --palette: read the palette at that dotted path (battleIdle.palette in target.json)
//   --palette-from <png>   the palette is every opaque color of that PNG (all of its frames)
//   --target <target.json> the measured target (docs/spikes/rook-turnaround/target.json)
//   --ref <png> [--ref-frame N]  a reference frame for the facing check; default: the numbers of the given frame in the target
//   --facings <png>,<png>  lint this image as one facing of a set: the list is the other images of the set (the other facings and the given frame).
//                          PA-08 then needs 90 percent of the opaque pixels to use colors found in at least one of them
//   --json                 machine-readable output
// Exit code 1 when any check fails.
//
// Module: lintFrame(img, opts), lintAnimation(frames), lintSheet(...), hasFail(items).
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  bbox,
  colorAt,
  colorsOf,
  edgePixels,
  halfAlpha,
  isOpaque,
  itemSide,
  measureFrame,
  NEAR_BLACK_LUMA,
  orphans,
  outlineRatio,
} from './metrics.mjs';
import { crop, frames as splitFrames, readPng } from './pixkit/png.mjs';

/** Hard lines, from the spike doc's Exit criteria and the pack. */
export const LINES = {
  maxColors: 32, // PA-01 [practice]
  paletteGrowth: 1.25, // PA-01 against the reference color count
  minOutline: 0.93, // PA-03
  sizeTolerance: 1, // PA-07, the facing check
  countFactor: 1.25, // PA-04, PA-09
  baselineTolerance: 1, // PA-06
  widthTolerance: 4, // PA-06
  sharedPixels: 0.9, // PA-08
  bottomRowSpread: 2, // PA-10
};

const item = (id, name, status, value, detail = '') => ({ id, name, status, value, detail });
const fmt = (a) => a.map(([x, y]) => `${x},${y}`).join(' ');

/**
 * List every orphan as x,y with tags: H = in the head area (the top third of the bounding box, the pack's face area),
 * O = on the outline (an edge pixel). The pack asks for orphans on the face and the outline, which need a reason.
 */
function orphanDetail(img, orph, b) {
  const edge = new Set(edgePixels(img).map(([x, y]) => `${x},${y}`));
  const headRows = b ? Math.max(1, Math.floor(b.h / 3)) : 0;
  const tag = ([x, y]) => `${x},${y}${b && y < b.y0 + headRows ? 'H' : ''}${edge.has(`${x},${y}`) ? 'O' : ''}`;
  const head = orph.filter(([, y]) => b && y < b.y0 + headRows).length;
  const out = orph.filter(([x, y]) => edge.has(`${x},${y}`)).length;
  return `${head} in head area (H), ${out} on outline (O); all: ${orph.map(tag).join(' ')}`;
}

/** Turn a palette input into a Set of lower-case "#rrggbb". */
export function paletteSet(list) {
  return new Set(list.map((c) => c.toLowerCase()));
}

/**
 * Lint one frame.
 * opts.palette   Set or array of allowed colors (required)
 * opts.ref       reference numbers { bodyHeight, headWidth, bboxWidth, bottomRow, orphans, smallRegions, colors, itemSide } at the same scale, or null
 * opts.refColors the reference palette (colors of the reference frame or sheet), or null
 * opts.katana    list of the item (katana) colors, or []
 * opts.setColors colors of the other images of a facing set (PA-08 across facings), or null
 * opts.facing    true to run the facing checks (height, head width, item side): only for frames of the reference's size
 * opts.boxWidthReport  true to make the PA-06 box width against the reference a report line (status info) instead of a gate: the v2 grade does this (the width changes with the facing)
 * opts.ranges    for a scale with no single given frame (the battle idle): { orphans: [lo, hi], smallRegions: [lo, hi] }
 */
export function lintFrame(img, opts) {
  const palette = paletteSet([...opts.palette]);
  const ref = opts.ref ?? null;
  const out = [];
  const used = colorsOf(img);
  const b = bbox(img);
  const m = measureFrame(img);

  // PA-01: palette within the target.
  const off = used.filter((c) => !palette.has(c));
  const refColors = ref?.colors ?? opts.ranges?.colors ?? null;
  const limit = refColors ? Math.min(LINES.maxColors, Math.floor(refColors * LINES.paletteGrowth)) : LINES.maxColors;
  out.push(
    item('PA-01', 'color count', used.length <= limit ? 'pass' : 'fail', `${used.length} colors (limit ${limit})`),
    item(
      'PA-01',
      'only palette colors',
      off.length === 0 ? 'pass' : 'fail',
      `${off.length} off-palette colors`,
      off.length ? `first: ${off.slice(0, 4).join(' ')}` : '',
    ),
  );

  // PA-02: alpha is 0 or 255.
  const ha = halfAlpha(img);
  out.push(item('PA-02', 'no half-transparent pixel', ha.count === 0 ? 'pass' : 'fail', `${ha.count} px`, ha.count ? `at ${fmt(ha.at)}` : ''));

  // PA-03: outline at least 93 percent near-black (luminance under 60).
  const oc = outlineRatio(img);
  out.push(
    item(
      'PA-03',
      `outline >= ${(LINES.minOutline * 100).toFixed(0)}% near-black (lum < ${NEAR_BLACK_LUMA})`,
      oc.ratio >= LINES.minOutline ? 'pass' : 'fail',
      `${(oc.ratio * 100).toFixed(1)}% of ${oc.edge} edge px`,
      oc.bad.length ? `light edge px at ${fmt(oc.bad.slice(0, 6))}` : '',
    ),
    item('PA-03', 'no 2 px thick outline run', 'skipped', 'not scriptable', 'a corner is a judgment call; read it on the 8x view'),
  );

  // PA-04: orphans at most 1.25x the reference count.
  const refOrphans = ref ? ref.orphans : opts.ranges ? opts.ranges.orphans[1] : null;
  const orph = orphans(img);
  out.push(
    refOrphans === null
      ? item('PA-04', 'orphan pixels', 'skipped', `${orph.length} orphans`, 'no reference at this scale')
      : item(
          'PA-04',
          `orphans <= ${LINES.countFactor}x reference`,
          orph.length <= LINES.countFactor * refOrphans ? 'pass' : 'fail',
          `${orph.length} (limit ${Math.floor(LINES.countFactor * refOrphans)})`,
          orph.length ? orphanDetail(img, orph, b) : '',
        ),
  );

  // PA-09: squint view, 1-2 px regions at most 1.25x the reference count.
  const refSmall = ref ? ref.smallRegions : opts.ranges ? opts.ranges.smallRegions[1] : null;
  out.push(
    refSmall === null
      ? item('PA-09', 'squint view 1-2 px regions', 'skipped', `${m.smallRegions} regions`, 'no reference at this scale')
      : item(
          'PA-09',
          `squint 1-2 px regions <= ${LINES.countFactor}x reference`,
          m.smallRegions <= LINES.countFactor * refSmall ? 'pass' : 'fail',
          `${m.smallRegions} (limit ${Math.floor(LINES.countFactor * refSmall)})`,
        ),
  );

  // PA-06: inside the cell, baseline and width against the reference (feet bottom row within 1 px, width within 4 px).
  const inCell = b !== null && b.x0 >= 0 && b.y0 >= 0 && b.x1 < img.w && b.y1 < img.h;
  out.push(item('PA-06', 'sprite inside its cell', inCell ? 'pass' : 'fail', b ? `box ${b.x0},${b.y0}..${b.x1},${b.y1}` : 'empty image'));
  if (opts.facing && ref && b) {
    out.push(
      item(
        'PA-06',
        `feet bottom row within ${LINES.baselineTolerance} px of reference`,
        Math.abs(b.y1 - ref.bottomRow) <= LINES.baselineTolerance ? 'pass' : 'fail',
        `bottom row ${b.y1}, reference ${ref.bottomRow}`,
      ),
      item(
        'PA-06',
        `box width within ${LINES.widthTolerance} px of reference`,
        opts.boxWidthReport ? 'info' : Math.abs(b.w - ref.bboxWidth) <= LINES.widthTolerance ? 'pass' : 'fail',
        `width ${b.w}, reference ${ref.bboxWidth}`,
      ),
    );
  } else {
    out.push(item('PA-06', 'baseline and width against reference', 'skipped', 'skipped', 'compares 32x32 frames against the given frame only'));
  }

  // PA-07 and the facing check: height and head width within 1 px of the reference.
  if (opts.facing && ref) {
    out.push(
      item(
        'PA-07',
        `body height within ${LINES.sizeTolerance} px of reference`,
        Math.abs(m.bodyHeight - ref.bodyHeight) <= LINES.sizeTolerance ? 'pass' : 'fail',
        `${m.bodyHeight}, reference ${ref.bodyHeight}`,
      ),
      item(
        'PA-07',
        `head width within ${LINES.sizeTolerance} px of reference`,
        Math.abs(m.headWidth - ref.headWidth) <= LINES.sizeTolerance ? 'pass' : 'fail',
        `${m.headWidth}, reference ${ref.headWidth}`,
      ),
    );
  } else {
    out.push(item('PA-07', 'height and head width against reference', 'skipped', 'skipped', 'compares 32x32 frames against the given frame only'));
  }

  // PA-08: at least 90 percent of the pixels use colors that appear in the reference palette.
  const refPal = opts.refColors ? paletteSet(opts.refColors) : null;
  if (opts.facing && refPal) {
    let total = 0;
    let shared = 0;
    for (let y = 0; y < img.h; y++) {
      for (let x = 0; x < img.w; x++) {
        if (!isOpaque(img, x, y)) continue;
        total++;
        if (refPal.has(colorAt(img, x, y))) shared++;
      }
    }
    const frac = total ? shared / total : 0;
    out.push(
      item(
        'PA-08',
        `>= ${LINES.sharedPixels * 100}% of pixels use reference palette colors`,
        frac >= LINES.sharedPixels ? 'pass' : 'fail',
        `${(frac * 100).toFixed(1)}%`,
      ),
    );
  } else {
    out.push(item('PA-08', 'palette shared with the reference', 'skipped', 'skipped', 'compares 32x32 frames against the walk palette only'));
  }
  if (opts.setColors) {
    const setPal = paletteSet(opts.setColors);
    let total = 0;
    let shared = 0;
    for (let y = 0; y < img.h; y++) {
      for (let x = 0; x < img.w; x++) {
        if (!isOpaque(img, x, y)) continue;
        total++;
        if (setPal.has(colorAt(img, x, y))) shared++;
      }
    }
    const frac = total ? shared / total : 0;
    out.push(
      item(
        'PA-08',
        `>= ${LINES.sharedPixels * 100}% of pixels use colors found in another facing of the set`,
        frac >= LINES.sharedPixels ? 'pass' : 'fail',
        `${(frac * 100).toFixed(1)}% (${shared} of ${total} px)`,
      ),
      item('PA-08', 'same part, same color across facings', 'skipped', 'grader check', 'not scriptable: the grader compares each part (coat, hair, katana) across the facings'),
    );
  } else {
    out.push(item('PA-08', 'same part, same color across facings', 'skipped', 'skipped', 'needs a second facing to compare; step 3 adds it'));
  }

  // PA-21 (facing check): which side the katana is on. Reported, never a gate: a mirror moves it, and Mark judges that.
  if (opts.facing && opts.katana?.length) {
    const side = itemSide(img, opts.katana);
    const refSide = ref?.itemSide ?? null;
    out.push(
      item(
        'PA-21',
        'carried item side (katana)',
        'info',
        side ? `${side.side} (centroid ${side.offset >= 0 ? '+' : ''}${side.offset.toFixed(1)} px from body center, ${side.pixels} px)` : 'katana colors absent',
        refSide ? `reference: ${refSide.side} (${refSide.offset >= 0 ? '+' : ''}${refSide.offset.toFixed(1)})${side && side.side !== refSide.side ? ' - DIFFERENT SIDE' : ''}` : '',
      ),
    );
  } else {
    out.push(item('PA-21', 'carried item side', 'skipped', 'skipped', 'facing check runs on 32x32 frames with katana colors in the target'));
  }

  // PA-10 for a single frame needs an animation.
  out.push(item('PA-10', 'anchor stable over an animation', 'skipped', 'skipped', 'needs several frames: use --all on a sheet'));
  return out;
}

/** The animation check PA-10 across the frames of one sheet: the box bottom row varies by at most 2 px. The planted-foot part is not scriptable. */
export function lintAnimation(frames) {
  const rows = frames.map((f) => bbox(f)?.y1 ?? -1);
  const spread = Math.max(...rows) - Math.min(...rows);
  return [
    item('PA-10', `bottom row varies <= ${LINES.bottomRowSpread} px over ${frames.length} frames`, spread <= LINES.bottomRowSpread ? 'pass' : 'fail', `spread ${spread} (rows ${rows.join(',')})`),
    item('PA-10', 'planted foot shifts <= 1 px per frame', 'skipped', 'not scriptable', 'pack PA-10: "In a walk-in-place, a planted foot shifts at most 1 pixel per frame". The pack names no way to find the planted foot pixel, and none exists on one frame without a pose label. Judge it on the frame strip.'),
  ];
}

/** True if any item failed. */
export function hasFail(items) {
  return items.some((i) => i.status === 'fail');
}

/** Read a palette input (file path of a JSON array or object) into an array of colors. */
export function readPaletteFile(path, key = null) {
  const j = JSON.parse(readFileSync(path, 'utf8'));
  // key is a dotted path into the JSON, for example battleIdle.palette in target.json.
  const keyed = key ? key.split('.').reduce((v, k) => v?.[k], j) : null;
  const list = key ? keyed : Array.isArray(j) ? j : (j.walkPalette ?? j.palette);
  if (!Array.isArray(list)) throw new Error(`${path}: no palette array${key ? ` at ${key}` : ' (expected an array, walkPalette or palette)'}`);
  return list;
}

/** Lint an image file as one frame, a chosen frame, or every frame. Returns [{ label, items }]. */
export function lintFile(path, o = {}) {
  const img = readPng(path);
  const [fw, fh] = o.frameSize ?? [img.w, img.h];
  const frameCount = Math.floor(img.w / fw) * Math.floor(img.h / fh);
  if (o.frame !== undefined && o.frame >= frameCount) throw new Error(`--frame ${o.frame} is past the last frame (${path} has ${frameCount} frames of ${fw}x${fh})`);
  const all = o.frames ?? (o.all ? splitFrames(img, fw, fh) : [crop(img, ((o.frame ?? 0) * fw) % img.w, Math.floor(((o.frame ?? 0) * fw) / img.w) * fh, fw, fh)]);
  const labels = o.all ? all.map((_, i) => `frame ${i}`) : [o.frame !== undefined ? `frame ${o.frame}` : 'image'];
  const target = o.target ?? null;

  let palette = o.palette;
  if (!palette && o.paletteFrom) {
    const src = readPng(o.paletteFrom);
    palette = colorsOf(src);
  }
  if (!palette) throw new Error('give --palette <file> or --palette-from <png>');

  // Pick the reference by frame size: the walk's given frame for 32x32, the battle idle ranges for 79x68.
  let ref = null;
  let refColors = null;
  let ranges = null;
  let facing = false;
  if (target && fw === target.frameSize[0] && fh === target.frameSize[1]) {
    facing = true;
    ref = { ...target.given, colors: target.given.colors };
    refColors = target.walkPalette;
  } else if (target && fw === target.battleIdle.frameSize[0] && fh === target.battleIdle.frameSize[1]) {
    ranges = { ...target.battleIdle.ranges, colors: target.battleIdle.colorCount };
  }
  if (o.refImage) {
    const r = readPng(o.refImage);
    const rf = crop(r, ((o.refFrame ?? 0) * fw) % r.w, 0, fw, fh);
    ref = { ...measureFrame(rf), itemSide: o.katana?.length ? itemSide(rf, o.katana) : null };
    refColors = colorsOf(rf);
    facing = true;
  }
  const katana = o.katana ?? target?.katanaColors ?? [];
  const setColors = o.facings?.length ? [...new Set(o.facings.flatMap((p) => colorsOf(readPng(p))))] : null;
  const results = all.map((f, i) => ({
    label: labels[i] ?? `frame ${i}`,
    items: lintFrame(f, { palette, ref, refColors, katana, facing, ranges, setColors }),
  }));
  if (o.all) results.push({ label: 'animation', items: lintAnimation(all) });
  return results;
}

function parseArgs(argv) {
  const o = { json: false, all: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === '--json') o.json = true;
    else if (a === '--all') o.all = true;
    else if (a === '--frame') {
      o.frame = Number(val());
      if (!Number.isInteger(o.frame) || o.frame < 0) throw new Error('--frame needs a whole number, 0 or more');
    } else if (a === '--frame-size') {
      o.frameSize = (val() ?? '').split('x').map(Number);
      if (o.frameSize.length !== 2 || !o.frameSize.every((n) => Number.isInteger(n) && n > 0)) throw new Error('--frame-size needs WxH, for example 32x32');
    } else if (a === '--palette') o.paletteFile = val();
    else if (a === '--palette-key') o.paletteKey = val();
    else if (a === '--palette-from') o.paletteFrom = val();
    else if (a === '--target') o.targetFile = val();
    else if (a === '--facings') {
      o.facings = (val() ?? '').split(',').filter(Boolean);
      if (!o.facings.length) throw new Error('--facings needs one or more PNG files, separated by commas');
    }
    else if (a === '--ref') o.refImage = val();
    else if (a === '--ref-frame') {
      o.refFrame = Number(val());
      if (!Number.isInteger(o.refFrame) || o.refFrame < 0) throw new Error('--ref-frame needs a whole number, 0 or more');
    }
    else rest.push(a);
  }
  o.file = rest[0];
  return o;
}

function main() {
  let o;
  let results;
  try {
    o = parseArgs(process.argv.slice(2));
    if (!o.file || !existsSync(o.file)) {
      console.error('usage: node scripts/art/pixlint.mjs <image.png> [--frame N | --all] [--frame-size WxH] (--palette <file> [--palette-key a.b] | --palette-from <png>) [--target <target.json>] [--ref <png>] [--facings <png>,<png>...] [--json]');
      process.exit(2);
    }
    for (const f of o.facings ?? []) if (!existsSync(f)) throw new Error(`--facings: no such file ${f}`);
    if (o.paletteFile) o.palette = readPaletteFile(o.paletteFile, o.paletteKey);
    if (o.targetFile) o.target = JSON.parse(readFileSync(o.targetFile, 'utf8'));
    results = lintFile(o.file, o);
  } catch (e) {
    console.error(`pixlint: ${e.message}`);
    process.exit(2);
  }
  const failed = results.some((r) => hasFail(r.items));
  if (o.json) {
    console.log(JSON.stringify({ file: o.file, pass: !failed, results }, null, 2));
  } else {
    for (const r of results) {
      console.log(`${o.file} [${r.label}]  ${hasFail(r.items) ? 'FAIL' : 'PASS'}`);
      for (const i of r.items) console.log(`  ${i.status.toUpperCase().padEnd(7)} ${i.id}  ${i.name}: ${i.value}${i.detail ? `  (${i.detail})` : ''}`);
    }
    console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
