// The writer kit builder (plan section 3, "The writer kit per facing"). One call builds the whole kit folder for one facing.
//   buildKit({ spec, facing, outDir, img, pm, blank?, neighbors? })
// Kit contents (outDir):
//   template-32x.png     the template at 32x with a grid: part code and light level per cell; locked copy cells show their color
//   template.txt         the same as text: part code map, light level map, outline map, class map
//   template.json        the data render.mjs needs (part ids, levels, outline, ramps, locked cells)
//   card.txt             the structure card
//   given-32x.png, given-letters.txt         the given as a copy source (box cells removed in blanked mode)
//   neighbor-<facing>-32x.png, ...           approved neighbor facings, as copy sources
//   samples/             material sample sheets cut from the given, per part and light level (PNG and samples.txt)
//   classes-32x.png, classes.txt             copy, transform and invent cells (S3) and the list of paint cells
//   grid-template.txt    32 rows; locked copy cells and soft transform cells are pre-filled, every other cell is a dot
//   ramps.txt, legend.png, README.md
//   render.mjs and what it needs (Level T): levelt.mjs, grid32.mjs, lib.mjs, palette.json, pngjs
// The kit holds the given only through the copy source and the sample sheets. It holds no reference and no other facing except approved neighbors.
import { cpSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PARTS } from '../../pipeline/decompose.mjs';
import { FAMILIES, FAMILY_NAMES, legendImage, writePng, zoomGrid } from '../../headtest/lib.mjs';
import { buildCard } from './card.mjs';
import { formatGrid32, gridToImage32 } from './grid32.mjs';
import { approvedSource, classifyCells, givenSource } from './reproject.mjs';
import { classImage, templateKitImage } from './preview.mjs';
import { renderTemplate } from './render.mjs';
import { cutSamples, samplesText, writeSamples } from './samples.mjs';
import { resolveSpec } from './spec.mjs';
import { templateData } from './tdata.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const N = 32;

/** Rows of a per-cell map as text. cellChar(k) -> one character. */
const mapText = (title, cellChar) => {
  const lines = [`# ${title}`, `# column (ones digit):   ${[...Array(N)].map((_, i) => i % 10).join('')}`];
  for (let y = 0; y < N; y++) lines.push(`${String(y).padStart(2, '0')}|${Array.from({ length: N }, (_, x) => cellChar(y * N + x)).join('')}`);
  return lines.join('\n');
};

/** The text version of the template: part codes, light levels (0 shadow, 1 base, 2 lit), outline (1 silhouette edge, 2 interior line), classes. */
export function templateText(td, cls) {
  const lab = (k) => (td.idx[k] >= 0 ? td.labels[td.ids[td.idx[k]]] : null);
  return [
    mapText('part codes (. = transparent)', (k) => (lab(k) ? PARTS[lab(k)].code : '.')),
    mapText('light level (0 shadow, 1 base, 2 lit, . none)', (k) => (td.level[k] >= 0 ? String(td.level[k]) : '.')),
    mapText('outline (1 silhouette edge, 2 interior line, . none)', (k) => (td.outline[k] > 0 ? String(td.outline[k]) : '.')),
    mapText('class (C copy and locked, T transform and pre-filled, I paint)', (k) => (cls.cells[k] ? { copy: 'C', transform: 'T', invent: 'I' }[cls.cells[k].cls] : '.')),
  ].join('\n\n') + '\n';
}

/** The list of paint cells (class I) by row, and the transform cells with their source cell. */
export function classesText(td, cls, facing) {
  const lines = [`# S3 classes for facing ${facing}: copy ${cls.counts.copy}, transform ${cls.counts.transform}, invent ${cls.counts.invent} (invented share ${(100 * cls.share).toFixed(1)} percent)`];
  lines.push('# transform cells: target cell <- source cell (letter). They are pre-filled in grid-template.txt and you may change them.');
  cls.cells.forEach((c, k) => { if (c?.cls === 'transform') lines.push(`  (${k % N}, ${Math.floor(k / N)}) <- ${c.src.name} (${c.src.x}, ${c.src.y})  ${c.letter}`); });
  lines.push('# paint cells (you choose the letter): row: columns');
  for (let y = 0; y < N; y++) {
    const xs = [];
    for (let x = 0; x < N; x++) if (cls.cells[y * N + x]?.cls === 'invent') xs.push(x);
    if (xs.length) lines.push(`  row ${y}: ${xs.join(' ')}`);
  }
  return `${lines.join('\n')}\n`;
}

function rampsText(spec) {
  const lines = ['# Allowed letters per part id. Level T allows a part ramp dilated by 1 px. Letters are the 22 palette letters a to v.', '# id (label): shadow | base | lit | outline'];
  for (const [id, p] of Object.entries(spec.parts)) lines.push(`${id} (${p.label}): ${p.ramp.shadow || '-'} | ${p.ramp.base || '-'} | ${p.ramp.lit || '-'} | ${p.ramp.outline || '-'}`);
  return `${lines.join('\n')}\n`;
}

const READMES = (facing, hasNeighbors, blanked) => `# Writer kit: facing ${facing}

You paint one facing of a 32x32 pixel-art character as a text grid of palette letters. The proxy has already fixed the shape: the part of every cell,
its light level and the outline. You choose the texture letter in every paint cell.${blanked ? '\n\nThis kit is in blanked mode (a held-out test): the given has a box cut out. Every cell in the box is a paint cell.' : ''}

Read only the files in this folder. Do not open any other folder.

## Files (look at these)
- card.txt: the structure card. View angle, head center column, face axis column, eye cells, light, guide rows, outline rule, fold strokes, carried item cells, part layout per row.
- template-32x.png: the template at 32x. Each cell shows a part code and a light level (+ lit, = base, - shadow). A thick black frame marks an outline cell (a purple frame is an interior line).
  A cell with a color and a letter is a locked copy cell. Do not change it. A cell with a color, a letter and a yellow square is a transform cell: it is pre-filled and you may change it.
- template.txt: the same maps as text (part codes, light levels, outline, classes).
- classes-32x.png and classes.txt: which cells are copy (C), transform (T) and paint (I).
- samples/: material samples cut from the given, per part and per light level, with letters (PNG and samples/samples.txt). Copy the texture pattern of the sample of the same part and light level.
- given-32x.png and given-letters.txt: the given frame, a copy source.${hasNeighbors ? '\n- neighbor-*-32x.png and neighbor-*-letters.txt: approved neighbor facings, copy sources.' : ''}
- ramps.txt: the letters each part may use.
- legend.png: each letter, a swatch, the hex, the luminance and the family.
- grid-template.txt: your start file. Locked and transform cells are filled. Every other cell is a dot.

## Letters
The 22 palette colors sorted by luminance, dark to light, are the letters a to v. A dot is a transparent cell.
${FAMILY_NAMES.map((f) => `- ${f}: ${FAMILIES[f].join(' ')}`).join('\n')}

## Grid format
- 32 lines, frame rows 0 to 31. Each line: a two-digit row number, a \`|\`, then exactly 32 characters (columns 0 to 31). A letter a to v, or \`.\` for transparent.
- Lines that start with \`#\` and blank lines are ignored.

## Steps
1. Read the card.
2. Paint the near-black interior lines from the outline map (outline letters of the part ramp, darker on the shadow side).
3. Fill each part from its sample sheet, by light level.
4. Paint the face and hands last, from the card cells.
5. Render, read the conflict list and the picture, and fix. Repeat.
6. Stop at zero conflicts. Render at least 3 times, and make the last render the one with zero conflicts.
7. List the template cells that you think are wrong (a cell you cannot paint within its ramp or level) in a short report. The list does not block.

## Render (the only command you may run)
    node render.mjs my-grid.txt [outBase]
It writes <outBase>.png (32x32), <outBase>-sheet.png (32x, letters, a red frame on each conflict, a yellow square on each warning), <outBase>-sep-<family>.png, <outBase>-poster.png and <outBase>-conflicts.txt.
Exit code 0: zero conflicts. 1: conflicts. 2: a bad grid file (a bad letter, a wrong row count or column count).
A conflict is a letter outside the ramp of the template part dilated by 1 px, a light level more than one step from the template, a letter outside the template silhouette dilated by 1 px,
a template cell left transparent, or a locked cell that you changed. A warning is a seam cell or an outline cell that is not painted with an outline letter.
This is feedback against the template. It is not a truth. Run node on render.mjs only. Do not write or run any other script.
`;

/**
 * Build the kit. neighbors: [{ facing, flat }] approved grids (1024 letters). Returns { files, td, cls, card }.
 * blank = { x0, y0, x1, y1 } builds the blanked kit (T1): the box cells of the given are not in any file, and every box cell is a paint cell.
 */
export function buildKit({ spec: rawSpec, facing, outDir, img, pm, blank = null, neighbors = [], k = 32 }) {
  const spec = resolveSpec(rawSpec);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(`${outDir}/samples`, { recursive: true });
  const t = renderTemplate(spec, { facing });
  const given = givenSource(spec, img, pm, { blank });
  const sources = [given, ...neighbors.map((n) => approvedSource(spec, n.facing, n.flat, `neighbor-${n.facing}`))];
  const cls = classifyCells(spec, t, sources, { blank });
  const td = templateData(spec, t, cls);
  const card = buildCard(spec, t);
  const files = [];
  const put = (name, text) => { writeFileSync(`${outDir}/${name}`, text); files.push(name); };
  const putPng = (name, image) => { writePng(image, `${outDir}/${name}`); files.push(name); };

  putPng('template-32x.png', templateKitImage(td, k));
  put('template.txt', templateText(td, cls));
  put('template.json', `${JSON.stringify(td)}\n`);
  put('card.txt', card.text);
  putPng('classes-32x.png', classImage(t, cls, k));
  put('classes.txt', classesText(td, cls, facing));
  put('ramps.txt', rampsText(spec));
  putPng('legend.png', legendImage());
  putPng('given-32x.png', zoomGrid(blankImage(img, blank), { k, originX: 0, originY: 0 }));
  put('given-letters.txt', formatGrid32(given.letters));
  for (const n of neighbors) {
    putPng(`neighbor-${n.facing}-32x.png`, zoomGrid(gridToImage32(n.flat), { k, originX: 0, originY: 0 }));
    put(`neighbor-${n.facing}-letters.txt`, formatGrid32(n.flat));
  }
  const cut = cutSamples(spec, img, pm, { blank });
  for (const f of writeSamples(`${outDir}/samples`, cut)) files.push(`samples/${f}`);
  writeFileSync(`${outDir}/samples/samples.txt`, samplesText(cut));
  files.push('samples/samples.txt');
  const start = Array(N * N).fill('.');
  cls.cells.forEach((c, i) => { if (c && c.letter && c.cls !== 'invent') start[i] = c.letter; });
  put('grid-template.txt', formatGrid32(start));
  put('README.md', READMES(facing, neighbors.length > 0, !!blank));

  // Level T: render.mjs and what it needs. The import path of the shared kit library is rewritten to the local copy.
  const fix = (name, to) => writeFileSync(`${outDir}/${to}`, readFileSync(`${here}/${name}`, 'utf8').replaceAll("'../../headtest/lib.mjs'", "'./lib.mjs'"));
  fix('levelt-cli.mjs', 'render.mjs');
  fix('levelt.mjs', 'levelt.mjs');
  fix('grid32.mjs', 'grid32.mjs');
  copyFileSync(`${here}/../../headtest/lib.mjs`, `${outDir}/lib.mjs`);
  copyFileSync(`${here}/../../headtest/palette.json`, `${outDir}/palette.json`);
  mkdirSync(`${outDir}/node_modules`, { recursive: true });
  cpSync(`${here}/../../../../node_modules/pngjs`, `${outDir}/node_modules/pngjs`, { recursive: true });
  writeFileSync(`${outDir}/package.json`, '{"type":"module","private":true}\n');
  files.push('render.mjs', 'levelt.mjs', 'grid32.mjs', 'lib.mjs', 'palette.json', 'package.json');
  return { files, td, cls, card };
}

/** The given with the box cells transparent (the picture a blanked kit shows). */
function blankImage(img, blank) {
  const out = { w: img.w, h: img.h, data: new Uint8Array(img.data) };
  if (blank) for (let y = blank.y0; y <= blank.y1; y++) for (let x = blank.x0; x <= blank.x1; x++) out.data.set([0, 0, 0, 0], (y * img.w + x) * 4);
  return out;
}
