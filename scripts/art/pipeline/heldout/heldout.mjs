// Held-out invention test (plan 6a), the kit side: build a writer kit for a blanked box, score a writer's grid, check isolation.
//   node scripts/art/pipeline/heldout/heldout.mjs kit    <hairWing|coat|all> [--root dir]
//   node scripts/art/pipeline/heldout/heldout.mjs score  <hairWing|coat> <grid.txt> [--out base] [--root dir] [--json]
//   node scripts/art/pipeline/heldout/heldout.mjs check  <hairWing|coat|all> [--root dir] [--kit dir]
//   node scripts/art/pipeline/heldout/heldout.mjs truth  <hairWing|coat|all> [--root dir]      writes <root>/<box>/truth/truth-grid.txt
//   node scripts/art/pipeline/heldout/heldout.mjs sanity <hairWing|coat|all> [--root dir]      scores an empty grid (must FAIL) and the truth grid (must PASS)
// Root default: C:/Users/markh/AppData/Local/Temp/rook-6a (env ROOK_6A_OUT). Layout under <root>/<box>/:
//   kit/     what a writer may read (pictures and text, no hidden pixel)
//   truth/   the true region grid for the sanity run (orchestrator only)
//   score/   scorer pictures (they hold the truth; for graders only)
// Reuses: region.mjs (box derivation, scoreRegion, formatRegion), decompose.mjs (part map, motifOf with blank), headtest/lib.mjs (letters, zoomGrid, legend).
import { copyFileSync, cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isOpaque } from '../../metrics.mjs';
import {
  FAMILIES, drawText, familiesJson, legendImage, letterAt, newImage, paste, readPng, scaled, writePng,
} from '../../headtest/lib.mjs';
import { PARTS, blankBoxImage, buildPartMap, labelsOf, motifOf, validatePartMap } from '../decompose.mjs';
import { loadGiven, readTarget, WALK_ZIP } from '../given.mjs';
import { BANDS, PASS, deriveBoxes, formatRegion, scoreRegion } from '../region.mjs';
import {
  AXIS, FAMILY_LIST, MASK_RGB, OUTLINE_BOX, OUTLINE_MIRROR_HOME, box32, boxGridToImage, boxH, boxW, composite, emptyBoxCells, formatBoxGrid, frame32,
  frameScaled, mirrorBox, mirrorImage, parseBoxGrid,
} from './boxkit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export { newImage, paste, readPng, writePng } from '../../headtest/lib.mjs';
export const ROOT = process.env.ROOK_6A_OUT ?? 'C:/Users/markh/AppData/Local/Temp/rook-6a';
export const BOX_NAMES = ['hairWing', 'coat'];
export const KIT_LIB = "'./lib.mjs'";
/** Where the truth lives. The main session must forbid a writer to read any of these. */
export const TRUTH_PATHS = [
  'spritefusion-tests/rook-overworld-walk.zip (repo): frame 4 of the walk sheet IS the given, with the hidden box in it',
  'public/art/crew/rook/** (repo): Mark\'s Rook art, the same character',
  'C:/Users/markh/AppData/Local/Temp/rook-step3/input/given.png: the given frame as a PNG, with the box in it',
  'C:/Users/markh/AppData/Local/Temp/rook-step3/** and rook-step2/**: earlier rounds and the given',
  'C:/Users/markh/AppData/Local/Temp/rook-head/**: the head test refs (ref-head-32x.png etc. show x10..25 y0..13, which holds the whole hair-wing box), features.md, keys/',
  'C:/Users/markh/AppData/Local/Temp/rook-pipeline*/**: given24.png, parts-32x.png, parts.json, masks and classes of the given',
  'docs/spikes/rook-turnaround/target.json (repo): pipeline.partMap rows give the part of every cell of the box; pipeline.masks and pipeline.classes too',
  'docs/spikes/rook-turnaround/records.md and art-pipeline-plan.md (repo): describe the given head in words',
  'scripts/art/pipeline/overrides.json (repo): per-cell part names',
  'C:/Users/markh/AppData/Local/Temp/rook-6a/<box>/truth/ and score/: the true grid and the scorer pictures',
];

export const boxPaths = (name, root = ROOT) => ({ dir: `${root}/${name}`, kit: `${root}/${name}/kit`, truth: `${root}/${name}/truth`, score: `${root}/${name}/score` });

let boxCache = null;
/** The named box: from target.json pipeline.regions.boxes, else derived from the part map. */
export function getBox(name, img = loadGiven()) {
  if (!BOX_NAMES.includes(name)) throw new Error(`box must be one of ${BOX_NAMES.join(', ')}, not '${name}'`);
  const t = readTarget().pipeline?.regions?.boxes?.[name];
  if (t) return t;
  boxCache ??= deriveBoxes(img, buildPartMap(img));
  return boxCache[name];
}

/** The true box as letters. */
export const truthCells = (img, box) => Array.from({ length: boxH(box) }, (_, y) => Array.from({ length: boxW(box) }, (_, x) => letterAt(img, box.x0 + x, box.y0 + y)));
/** The blanked given: what the writers see. */
export const blankedGiven = (img, box) => blankBoxImage(img, box);
/** The box mask picture's source: MASK_RGB where the given is opaque, transparent elsewhere. No true color goes in. */
export function maskImage(img, box) {
  const out = newImage(boxW(box), boxH(box));
  for (let y = 0; y < out.h; y++)
    for (let x = 0; x < out.w; x++) if (isOpaque(img, box.x0 + x, box.y0 + y)) out.data.set([...MASK_RGB, 255], (y * out.w + x) * 4);
  return out;
}

// ---- rules text: measured from the cells outside the box ----
/** Motif numbers per part from the cells OUTSIDE the box only (motifOf with the box blanked). */
export const boxMotif = (img, pm, box) => motifOf(img, pm, { blank: box });
const letterList = (letters) => Object.entries(letters ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l, n]) => `${l}${n}`).join(' ');

/** The opaque cells of the box: the mask count. The only number about the inside of the box that the kit text carries. */
export const maskCount = (img, box) => hiddenCells(img, box).length;
/** The parts to describe: the box's named part, and every part with a cell that touches the box from outside (the 8-neighbor rim). Read from the blanked given only. */
export function nearParts(blank, pm, box) {
  const labels = labelsOf(pm);
  const found = new Set(box.part ? [box.part] : []);
  for (let y = box.y0 - 1; y <= box.y1 + 1; y++)
    for (let x = box.x0 - 1; x <= box.x1 + 1; x++) {
      if (x < 0 || y < 0 || x >= blank.w || y >= blank.h) continue;
      if (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1) continue;
      const p = labels[y * pm.w + x]?.[0];
      if (p) found.add(p);
    }
  return Object.keys(PARTS).filter((p) => found.has(p));
}
/**
 * The rules text. Built from the blanked given only: the box is blanked, then the part map is built from what is left,
 * so no label, letter or number comes from inside the box. The opaque count is the mask count.
 */
export function rulesText(img, box) {
  const blank = blankBoxImage(img, box);
  const pm = buildPartMap(blank);
  const opaque = maskCount(img, box);
  const motif = boxMotif(blank, pm, box);
  const parts = nearParts(blank, pm, box);
  const fam = (f) => `${f} (${FAMILIES[f].join(' ')})`;
  const L = [];
  L.push(`RULES for the ${box.name} box: frame x${box.x0}..${box.x1}, y${box.y0}..${box.y1}`);
  L.push('The parts and the numbers below were read from the frame with the box blanked, so they come from cells outside the box only. The one number about the inside is the opaque cell count, which is the mask.');
  L.push('');
  L.push('THE BOX');
  L.push(`- ${boxW(box)} columns by ${boxH(box)} rows = ${boxW(box) * boxH(box)} cells. The mask picture (mask-32x.png) shows the ${opaque} opaque cells. Write '.' in every other cell.`);
  L.push('- Letters a to v run dark to light by luminance. See legend.png. A dot is transparent.');
  L.push('');
  L.push(`PARTS TO DESCRIBE: ${parts.join(', ')}`);
  L.push(`These are the box's named part (${box.part}) and the parts that touch the box from outside. The box may hold cells of any of them. How many, and where, is yours to decide from the pictures.`);
  L.push('');
  L.push('RAMP LOCK AND MOTIF PER PART (cells outside the box)');
  L.push('A part uses only the letters of its ramp families plus near-black. T = color changes between touching cells, per cell. S = share of cells in small (1 to 2 px) color clusters. D = near-black share of interior cells. orphans = single cells with no same-color neighbor.');
  for (const p of parts) {
    const spec = PARTS[p];
    const m = motif[p];
    L.push('');
    L.push(`${p}`);
    L.push(`- ramp lock: ${[...new Set(['near-black', ...(spec?.families ?? [])])].map(fam).join('; ')}`);
    if (!m?.cells) {
      L.push('- no cells outside the box: no motif measured. Use the ramp lock and the neighbors in the pictures.');
      continue;
    }
    L.push(`- ${m.cells} cells outside the box${m.cells < 12 ? ' (few cells: a weak measure)' : ''}. Letters used: ${letterList(m.letters)} (letter, then count).`);
    L.push(`- longest horizontal run of one letter: ${m.runs.max}. T ${m.T}, S ${m.S}, D ${m.D}, orphans ${m.orphans}.`);
  }
  L.push('');
  L.push('WHAT THE SCORER LOOKS AT');
  L.push(`- Exact letter match at least ${PASS.exact} percent of the box cells, and same-family-within-one-step match at least ${PASS.tolerant} percent.`);
  L.push(`- Texture of the box against the real box: T ${BANDS.T[0]}x to ${BANDS.T[1]}x, S ${BANDS.S[0]}x to ${BANDS.S[1]}x, orphans ${BANDS.orphans[0]}x to ${BANDS.orphans[1]}x, D within ${BANDS.D}. A flat or striped fill fails T and S.`);
  L.push('- Cells just outside the box are real and fixed. Your box must join them: lines and color changes that cross the box edge continue inside.');
  return `${L.join('\n')}\n`;
}

// ---- kit text ----
const kitReadme = (box, mb, opaque) => `# Held-out test 6a, box ${box.name}: writer folder

A part of a 32x32 pixel-art character is hidden. You draw the hidden part as a text grid of palette letters.
The hidden box is frame x ${box.x0} to ${box.x1}, y ${box.y0} to ${box.y1}: ${boxW(box)} columns by ${boxH(box)} rows, ${boxW(box) * boxH(box)} cells. ${opaque} of them are opaque (see mask-32x.png).
The 32x32 frame is the same character everywhere else. You see all of it except the box.

## Pictures (look at these)
- legend.png: each letter, a swatch, the hex, the luminance and the family.
- given-blank-32x.png: the frame with the box blanked, at 32x. A grid line on every pixel. Numbers are frame coordinates (columns on top, rows at the left). The box is a gray checker inside a cyan outline. Elsewhere the light checker means transparent.
- given-blank-sep-<family>.png: the same picture with only one family in color (near-black, hair, skin, orange-gold, coat). All other pixels are dimmed over a magenta checker. The box is still the gray checker.
- given-blank-frame-4x.png and given-blank-frame-8x.png: the whole frame at 4x and 8x, no grid, box blanked (gray checker, cyan outline).
- given-blank-mirror-32x.png: the blanked frame mirrored left to right (see below).
- mask-32x.png: the box alone at 32x. Blue = opaque, checker = transparent. The numbers are frame coordinates.

## The mirror (what it shows, and what it hides)
The character is close to left-right symmetric about the line between columns 17 and 18, so the picture on the left of that line often helps the right, and the reverse. The mirror maps column x to column ${AXIS} - x (row stays). The picture is made from the BLANKED frame, so it can not show a hidden cell:
- The mirrored box is columns ${mb.x0}..${mb.x1}, rows ${box.y0}..${box.y1}. It is blank (gray checker, cyan outline). It holds the mirror of the hidden cells and nothing else.
- Your box sits at columns ${box.x0}..${box.x1}. In the mirror picture a yellow outline marks that place. The cells inside the yellow outline are the real cells from columns ${AXIS - box.x1}..${AXIS - box.x0} of the frame, mirrored. They are real and visible. They are the other side of the character, not your box. The given is not symmetric, so they are a guide and not a copy.
- Cells of the mirror whose source column is outside the frame are transparent.
Why it is built this way: a mirror of the unblanked frame would put the hidden pixels at the mirrored box. This mirror blanks them there, and the mirror of the real cells that lie next to the box is allowed.

## Letters
The 22 palette colors sorted by luminance, dark to light, are the letters a to v. A dot is a transparent pixel.
Families (dark to light inside each):
${Object.entries(FAMILIES).map(([f, l]) => `- ${f}: ${l.join(' ')}`).join('\n')}

## Rules
rules.txt holds the rules, measured from the cells outside the box: the parts to describe (the box's named part and the parts that touch it), the ramp lock, the letters, the run lengths and the texture numbers of each part. Read it before you draw.

## Grid format
- A text file. One line per row, ${boxH(box)} rows (frame y ${box.y0} to ${box.y1}), in order.
- Each row line is: a two-digit row number, then \`|\`, then exactly ${boxW(box)} characters. One character per pixel, left to right (frame x ${box.x0} to ${box.x1}).
- Each character is a letter a to v, or \`.\` for transparent. No spaces inside the characters.
- Lines that start with \`#\` and blank lines are ignored. The row number must match the line's position.
- Start from grid-template.txt (all dots).

## Render (the only command you may run)
    node render.mjs my-grid.txt [outBase]
It puts your grid into the blanked frame and writes pictures only: <outBase>.png (the box at 1x), <outBase>-box-32x.png, <outBase>-sheet.png (the whole frame at 32x, same grid and numbers as given-blank-32x.png), <outBase>-sep-<family>.png, <outBase>-frame-4x.png and <outBase>-frame-8x.png.
It gives no score. It exits with code 2 and a message if a letter is not a to v or a dot, or if a row has the wrong number of columns, or the row count is not ${boxH(box)}.
Open the images and compare them with the given-blank images side by side. Fix rows that do not blend into their neighbors, then render again.
Run node on render.mjs only. Do not write or run any other script.
`;

const orchestratorReadme = (box, root) => `# Orchestrator notes: 6a box ${box.name} (NOT for writers)

Writers read ONLY ${root}/${box.name}/kit/ (IN) and write only to their own OUT folder. This file and the folders next to kit/ hold the truth.

## Folders
- kit/ : the writer kit. Built by \`node scripts/art/pipeline/heldout/heldout.mjs kit ${box.name}\`. Checked by \`... check ${box.name}\`.
- truth/ : truth-grid.txt, the real box as a grid. Sanity only.
- score/ : scorer pictures (given beside candidate). They show the truth. Give them to graders, never to writers.
- Put each writer's OUT folder outside ${root}/${box.name}/ (for example ${root}/${box.name}-out/w1), so that no writer folder sits next to truth/.

## Commands (repo root)
- Score a grid: \`node scripts/art/pipeline/heldout/heldout.mjs score ${box.name} <grid.txt> [--out base]\`. Exit 0 = every row PASS, 1 = a row FAIL, 2 = bad grid. Default pictures go to ${root}/${box.name}/score/<grid name>-*.png.
- Isolation check: \`node scripts/art/pipeline/heldout/heldout.mjs check ${box.name}\`. Exit 1 if any kit file shows a hidden cell's true color at its true position, at any scale.

## Writer rules (put these in the prompt of every writer)
- Level 0: no score and no feedback in round 1. The writer reads only pictures and text under IN. It reads no pixel value.
- Forbid every path below (the truth). Read-forbid, glob-forbid, grep-forbid:
${TRUTH_PATHS.map((p) => `  - ${p}`).join('\n')}
- A writer runs \`node IN/render.mjs\` only.
- Rules, the mask and the pictures are all that the writer gets. The kit has no feature list for the box, because a feature list lists cells. Graders may have one made from the truth.

## The box
- ${box.name}: x${box.x0}..${box.x1}, y${box.y0}..${box.y1}. Walk zip: ${WALK_ZIP.replace(/^.*\/(?=spritefusion-tests)/, '')}.
`;

/** Copy a kit-safe module into the kit with its lib import pointing at the kit's own lib.mjs. */
function copyRewriting(src, dst) {
  writeFileSync(dst, readFileSync(src, 'utf8').replaceAll("'../../headtest/lib.mjs'", KIT_LIB));
}

/** Build <root>/<name>/kit/. Returns { dir, files }. Never touches truth/ or score/. */
export function buildKit(name, { root = ROOT, img = loadGiven(), validate = true } = {}) {
  const box = getBox(name, img);
  if (validate && !validatePartMap(img, buildPartMap(img)).ok) throw new Error('part map invalid; run decompose.mjs');
  const { kit } = boxPaths(name, root);
  rmSync(kit, { recursive: true, force: true });
  mkdirSync(kit, { recursive: true });
  const blank = blankedGiven(img, box);
  const mb = mirrorBox(box);
  const mirror = blankBoxImage(mirrorImage(blank), mb);
  const fillBox = [{ box, fill: true, color: OUTLINE_BOX }];
  writePng(legendImage(), `${kit}/legend.png`);
  // 1. the blanked given: 32x with grid, five separations, 4x and 8x
  writePng(frame32(blank, fillBox), `${kit}/given-blank-32x.png`);
  for (const f of FAMILY_LIST) writePng(frame32(blank, fillBox, f), `${kit}/given-blank-sep-${f}.png`);
  for (const k of [4, 8]) writePng(frameScaled(blank, fillBox, k), `${kit}/given-blank-frame-${k}x.png`);
  // 2. the mirror of the blanked given
  writePng(frame32(mirror, [{ box: mb, fill: true, color: OUTLINE_BOX }, { box, fill: false, color: OUTLINE_MIRROR_HOME }]), `${kit}/given-blank-mirror-32x.png`);
  // 3. the mask
  writePng(box32(maskImage(img, box), box), `${kit}/mask-32x.png`);
  // 4. rules
  writeFileSync(`${kit}/rules.txt`, rulesText(img, box));
  // 5. grid template and legend
  writeFileSync(`${kit}/grid-template.txt`, formatBoxGrid(emptyBoxCells(box), box));
  writeFileSync(`${kit}/families.json`, `${JSON.stringify(familiesJson(), null, 2)}\n`);
  // render support: the blanked given at 1x, the box, the shared lib, the renderer
  writePng(blank, `${kit}/given-blank.png`);
  writeFileSync(`${kit}/box.json`, `${JSON.stringify({ name, x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1, w: boxW(box), h: boxH(box) }, null, 2)}\n`);
  copyFileSync(`${here}/../../headtest/lib.mjs`, `${kit}/lib.mjs`);
  copyFileSync(`${here}/../../headtest/palette.json`, `${kit}/palette.json`);
  copyRewriting(`${here}/boxkit.mjs`, `${kit}/boxkit.mjs`);
  copyRewriting(`${here}/kit-render.mjs`, `${kit}/render.mjs`);
  mkdirSync(`${kit}/node_modules`, { recursive: true });
  cpSync(`${here}/../../../../node_modules/pngjs`, `${kit}/node_modules/pngjs`, { recursive: true });
  writeFileSync(`${kit}/package.json`, '{"type":"module","private":true}\n');
  const opaque = maskCount(img, box);
  writeFileSync(`${kit}/README.md`, kitReadme(box, mb, opaque));
  // 7. writer brief
  const tpl = readFileSync(`${here}/writer-brief-6a.template.md`, 'utf8');
  const fill = { BOX: name, IN: kit, W: boxW(box), H: boxH(box), X0: box.x0, X1: box.x1, Y0: box.y0, Y1: box.y1, CELLS: boxW(box) * boxH(box) };
  writeFileSync(`${kit}/writer-brief-6a.md`, tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(fill[k])));
  writeFileSync(`${boxPaths(name, root).dir}/ORCHESTRATOR.md`, orchestratorReadme(box, root));
  return { dir: kit, files: listFiles(kit).map((f) => f.slice(kit.length + 1)) };
}

// ---- score ----
function sideBySide(given, cand, k) {
  const gap = 16;
  const top = 12;
  const w = given.w * k;
  const out = newImage(w * 2 + gap, given.h * k + top, [20, 20, 26, 255]);
  drawText(out, 'GIVEN', 2, 3, [225, 228, 235, 255], 1);
  drawText(out, 'CANDIDATE', w + gap + 2, 3, [225, 228, 235, 255], 1);
  paste(out, scaled(given, k), 0, top);
  paste(out, scaled(cand, k), w + gap, top);
  return out;
}
/** Parse a grid and score it against the true box. Throws GridError on a bad grid. */
export function scoreGrid(name, gridText, { img = loadGiven() } = {}) {
  const box = getBox(name, img);
  const cells = parseBoxGrid(gridText, box);
  const cand = boxGridToImage(cells, box);
  const res = scoreRegion(cand, img, box);
  let outside = 0;
  let missing = 0;
  for (let y = 0; y < cand.h; y++)
    for (let x = 0; x < cand.w; x++) {
      const t = isOpaque(img, box.x0 + x, box.y0 + y);
      const c = cells[y]?.[x] !== '.';
      if (c && !t) outside++;
      if (t && !c) missing++;
    }
  return { box, cand, cells, res, mask: { outside, missing } };
}
/** Write the candidate frame (1x), and the given beside the candidate at 4x and 16x, for the graders. */
export function writeScoreViews(base, img, box, cand) {
  mkdirSync(dirname(base), { recursive: true });
  const frame = composite(img, cand, box);
  writePng(frame, `${base}-cand.png`);
  writePng(sideBySide(img, frame, 4), `${base}-vs-given-4x.png`);
  writePng(sideBySide(img, frame, 16), `${base}-vs-given-16x.png`);
  writePng(box32(cand, box), `${base}-cand-box-32x.png`);
  return [`${base}-cand.png`, `${base}-vs-given-4x.png`, `${base}-vs-given-16x.png`, `${base}-cand-box-32x.png`];
}
export function formatScore(name, s, title = '') {
  const lines = [formatRegion(s.res, title || `${name} box x${s.box.x0}..${s.box.x1} y${s.box.y0}..${s.box.y1}`)];
  lines.push(`info: ${s.mask.outside} candidate letters on cells that are transparent in the real box; ${s.mask.missing} real opaque cells left transparent`);
  lines.push(`RESULT ${s.res.ok ? 'PASS' : `FAIL (${s.res.failed.join(', ')})`}   [plan 4 and 6a: exact >= ${PASS.exact}, tolerant >= ${PASS.tolerant}, T/S/D/orphans in band]`);
  return lines.join('\n');
}

// ---- isolation check ----
const TEXT_EXT = new Set(['.txt', '.md', '.json', '.mjs', '.html', '.csv']);
export function listFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out.sort();
}
/** Hidden cells: the opaque cells of the box with their true color. */
export function hiddenCells(img, box) {
  const out = [];
  for (let y = box.y0; y <= box.y1; y++)
    for (let x = box.x0; x <= box.x1; x++) if (isOpaque(img, x, y)) out.push({ x, y, rgb: [img.data[(y * img.w + x) * 4], img.data[(y * img.w + x) * 4 + 1], img.data[(y * img.w + x) * 4 + 2]] });
  return out;
}
const sameRgb = (im, X, Y, rgb) => {
  if (X < 0 || Y < 0 || X >= im.w || Y >= im.h) return false;
  const i = (Y * im.w + X) * 4;
  return im.data[i + 3] === 255 && im.data[i] === rgb[0] && im.data[i + 1] === rgb[1] && im.data[i + 2] === rgb[2];
};
/** The picture layouts that the kit builder uses (zoomGrid margins 28 and 16). Strict: any hidden cell at its true place is a leak. */
export function knownLayouts(box) {
  const out = [];
  for (const k of [1, 4, 8, 16, 32]) out.push({ name: `frame ${k}x plain`, w: 32 * k, h: 32 * k, ox: 0, oy: 0, k, X0: 0, Y0: 0 });
  out.push({ name: 'frame 32x grid', w: 28 + 32 * 32 + 1, h: 16 + 32 * 32 + 1, ox: 28, oy: 16, k: 32, X0: 0, Y0: 0 });
  out.push({ name: 'box 32x grid', w: 28 + boxW(box) * 32 + 1, h: 16 + boxH(box) * 32 + 1, ox: 28, oy: 16, k: 32, X0: box.x0, Y0: box.y0 });
  for (const k of [1, 4, 8, 16, 32]) out.push({ name: `box ${k}x plain`, w: boxW(box) * k, h: boxH(box) * k, ox: 0, oy: 0, k, X0: box.x0, Y0: box.y0 });
  return out;
}
/**
 * Does a picture show the hidden cells? Three tests:
 *  1. strict: the picture has the size of a layout the kit uses, and any hidden cell shows its true color at its true place.
 *  2. sweep: for every scale k 1..48, every offset 0..48 and both origins (frame, box), at least 80 percent of the hidden cells (those that the mirror does not explain), and at least 80 percent of those that differ from the commonest hidden color, show their true color. This catches a leak in a layout the kit does not use.
 * Returns a list of findings (empty = no leak).
 */
export function pngFindings(im, hidden, box, { sweep = true } = {}) {
  const findings = [];
  for (const L of knownLayouts(box)) {
    if (im.w !== L.w || im.h !== L.h) continue;
    const hits = hidden.filter((c) => sameRgb(im, L.ox + (c.x - L.X0) * L.k + (L.k >> 1), L.oy + (c.y - L.Y0) * L.k + (L.k >> 1), c.rgb));
    if (hits.length) findings.push({ kind: 'strict', layout: L.name, hits: hits.length, first: `x${hits[0].x} y${hits[0].y}` });
  }
  if (!sweep || !hidden.length) return findings;
  const count = {};
  for (const c of hidden) count[c.rgb.join()] = (count[c.rgb.join()] ?? 0) + 1;
  const common = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0];
  const minority = hidden.filter((c) => c.rgb.join() !== common);
  const needAll = Math.ceil(hidden.length * 0.8);
  const needMin = Math.ceil(minority.length * 0.8);
  const maxDx = (X0) => Math.max(...hidden.map((c) => c.x - X0));
  const maxDy = (Y0) => Math.max(...hidden.map((c) => c.y - Y0));
  const tally = (cells, need, k, ox, oy, X0, Y0) => {
    let miss = 0;
    const allow = cells.length - need;
    let hit = 0;
    for (const c of cells) {
      if (sameRgb(im, ox + (c.x - X0) * k + (k >> 1), oy + (c.y - Y0) * k + (k >> 1), c.rgb)) hit++;
      else if (++miss > allow) return false;
    }
    return hit >= need;
  };
  for (const [oname, X0, Y0] of [['frame', 0, 0], ['box', box.x0, box.y0]]) {
    const mx = maxDx(X0);
    const my = maxDy(Y0);
    for (let k = 1; k <= 48; k++)
      for (let ox = 0; ox <= 48 && ox + mx * k + (k >> 1) < im.w; ox++)
        for (let oy = 0; oy <= 48 && oy + my * k + (k >> 1) < im.h; oy++)
          if (tally(hidden, needAll, k, ox, oy, X0, Y0) && (minority.length === 0 || tally(minority, needMin, k, ox, oy, X0, Y0)))
            findings.push({ kind: 'sweep', layout: `${oname} origin, ${k}x, offset ${ox},${oy}` });
  }
  return findings.slice(0, 5);
}
/** Text leak: a line that holds a true row of the box (3 or more letters), or a grid line whose cells match the truth in 3 or more opaque cells. */
export function textFindings(text, img, box) {
  const findings = [];
  const rows = truthCells(img, box).map((r) => r.join(''));
  const w = boxW(box);
  for (const [n, line] of text.split(/\r?\n/).entries()) {
    rows.forEach((row, ry) => {
      if (row.replaceAll('.', '').length >= 3 && line.includes(row)) findings.push({ kind: 'text-row', line: n + 1, row: box.y0 + ry });
    });
    const m = /^\s*(\d+)\s*\|(.*)$/.exec(line);
    if (m) {
      const ry = Number(m[1]) - box.y0;
      const body = m[2] ?? '';
      const truth = rows[ry];
      if (truth && body.length >= w) {
        for (const off of [0, box.x0]) {
          let hits = 0;
          for (let i = 0; i < w; i++) if (truth[i] !== '.' && body[off + i] === truth[i]) hits++;
          if (hits >= 3) findings.push({ kind: 'text-grid', line: n + 1, row: Number(m[1]), hits });
        }
      }
    }
  }
  return findings.slice(0, 5);
}
/** Scan every file of a kit folder. ok = no finding. Unknown file types fail closed. */
export function checkKit(kitDir, { img = loadGiven(), box } = {}) {
  const hidden = hiddenCells(img, box);
  // A hidden cell whose mirror source (a real, visible cell) has the same color is explained by the mirror: a picture may show that color at the box place or at the mirrored place without a leak.
  // Every picture is checked, whatever its name, for the other cells at both places: the true place and the mirrored place.
  const blank = blankBoxImage(img, box);
  const open = hidden.filter((c) => !sameRgb(blank, AXIS - c.x, c.y, c.rgb));
  const openMirrored = open.map((c) => ({ ...c, x: AXIS - c.x }));
  const findings = [];
  const files = listFiles(kitDir);
  for (const f of files) {
    const rel = f.slice(kitDir.length + 1);
    const ext = extname(f).toLowerCase();
    if (/^(given|truth)\.|true|score/i.test(basename(f)) && !/^given-blank/.test(basename(f))) findings.push({ file: rel, kind: 'name' });
    if (ext === '.png') {
      const im = readPng(f);
      for (const x of pngFindings(im, open, box)) findings.push({ file: rel, place: 'true', ...x });
      for (const x of pngFindings(im, openMirrored, mirrorBox(box))) findings.push({ file: rel, place: 'mirrored', ...x });
    }
    else if (TEXT_EXT.has(ext)) for (const x of textFindings(readFileSync(f, 'utf8'), img, box)) findings.push({ file: rel, ...x });
    else findings.push({ file: rel, kind: 'unknown-type' });
  }
  return { ok: findings.length === 0, files: files.length, hidden: hidden.length, findings };
}

// ---- CLI ----
const names = (arg) => (arg === 'all' ? BOX_NAMES : [arg]);
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
  const root = opt('--root', ROOT);
  const [cmd, which, gridPath] = a;
  const img = loadGiven();
  let code = 0;
  try {
    if (!cmd || !which || !['kit', 'score', 'check', 'truth', 'sanity'].includes(cmd)) {
      console.error('usage: heldout.mjs kit|check|truth|sanity <hairWing|coat|all> | score <hairWing|coat> <grid.txt> [--out base] [--json]  (--root dir)');
      process.exit(2);
    }
    for (const name of names(which)) {
      const box = getBox(name, img);
      const p = boxPaths(name, root);
      if (cmd === 'kit') {
        const r = buildKit(name, { root, img });
        console.log(`${name}: kit at ${r.dir}\n  ${r.files.join('\n  ')}`);
        const c = checkKit(r.dir, { img, box });
        console.log(`${name}: isolation check ${c.ok ? 'PASS' : 'FAIL'} (${c.files} files, ${c.hidden} hidden cells)`);
        if (!c.ok) { console.log(JSON.stringify(c.findings, null, 1)); code = 1; }
      } else if (cmd === 'check') {
        const c = checkKit(opt('--kit', p.kit), { img, box });
        console.log(`${name}: isolation check ${c.ok ? 'PASS' : 'FAIL'} (${c.files} files, ${c.hidden} hidden cells)`);
        if (!c.ok) { console.log(JSON.stringify(c.findings, null, 1)); code = 1; }
      } else if (cmd === 'truth') {
        mkdirSync(p.truth, { recursive: true });
        writeFileSync(`${p.truth}/truth-grid.txt`, formatBoxGrid(truthCells(img, box), box));
        console.log(`${name}: wrote ${p.truth}/truth-grid.txt`);
      } else if (cmd === 'sanity') {
        mkdirSync(p.truth, { recursive: true });
        const truthFile = `${p.truth}/truth-grid.txt`;
        writeFileSync(truthFile, formatBoxGrid(truthCells(img, box), box));
        const emptyFile = `${p.truth}/empty-grid.txt`;
        writeFileSync(emptyFile, formatBoxGrid(emptyBoxCells(box), box));
        for (const [label, f, want] of [['empty grid (must FAIL)', emptyFile, false], ['truth grid (must PASS, exact 100)', truthFile, true]]) {
          const s = scoreGrid(name, readFileSync(f, 'utf8'), { img });
          writeScoreViews(`${p.score}/${basename(f, '.txt')}`, img, box, s.cand);
          console.log(formatScore(name, s, `${name}: ${label}`));
          const exact = s.res.rows.find((r) => r.name === 'exact')?.value;
          if (s.res.ok !== want || (want && exact !== 100)) { console.log(`SANITY BROKEN for ${label}`); code = 1; }
        }
      } else if (cmd === 'score') {
        if (!gridPath) { console.error('score needs a grid file'); process.exit(2); }
        const s = scoreGrid(name, readFileSync(gridPath, 'utf8'), { img });
        const base = opt('--out', `${p.score}/${basename(gridPath, extname(gridPath))}`);
        const pics = writeScoreViews(base, img, box, s.cand);
        if (a.includes('--json')) console.log(JSON.stringify({ box: name, ok: s.res.ok, failed: s.res.failed, rows: s.res.rows, mask: s.mask, pictures: pics }, null, 2));
        else console.log(`${formatScore(name, s, `${gridPath} in ${name}`)}\npictures: ${pics.join(', ')}`);
        code = s.res.ok ? 0 : 1;
      }
    }
  } catch (e) {
    if (e?.constructor?.name === 'GridError' || e?.code === 'ENOENT') {
      console.error(`heldout.mjs: ${e.message}`);
      process.exit(2);
    }
    throw e;
  }
  process.exit(code);
}
