// Path C command: render the facings from transplant plus code painter only (no model, no reference), and write the sheets.
//   node scripts/art/v2/proxy/pathc.mjs [--out dir] [--facings s,n,se,sw,e,ne,nw,w] [--seed 1] [--spec f]
// Per facing it writes <facing>.png (the paint), <facing>-parts.png (each part one flat color, from the layout), <facing>-prov.png (where each cell came from),
// <facing>.txt (the letter grid), <facing>-labels.txt (the part codes of the candidate from the layout, for the grade command --parts), and for the whole set sheet-paint.png and sheet-parts.png (the contact-sheet tool: 1x, 8x with grid, gray, silhouette, context, beside the given).
// Provenance colors: copied green, flipped teal, relit yellow, painted red, outline purple, given-facing cells (identity) green.
// At the given facing there is nothing to invent: the picture is the given itself (the transplant reproduces it at 100 percent, and no cell is painted).
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Grid } from '../../pixkit/grid.mjs';
import { writePng } from '../../pixkit/png.mjs';
import { buildSheet } from '../../contact-sheet.mjs';
import { HEX_OF, newImage, setPx } from '../../headtest/lib.mjs';
import { PARTS, buildPartMap } from '../../pipeline/decompose.mjs';
import { loadGiven } from '../../pipeline/given.mjs';
import { codePaint, levelsOfLetters, selOutline } from './codepaint.mjs';
import { detailMask } from './detailmask.mjs';
import { givenLabels } from './fit.mjs';
import { formatGrid32 } from './grid32.mjs';
import { effectiveLabels, layoutFor, loadFacingRules } from './layout.mjs';
import { PART_COLORS } from './preview.mjs';
import { transplant, lettersOfImage } from './transplant.mjs';
import { loadSpec, resolveSpec } from './spec.mjs';

const N = 32;
export const DEFAULT_OUT = 'C:/Users/markh/AppData/Local/Temp/rook-v2/pathc/r1';
const DEFAULT_SPEC = fileURLToPath(new URL('./rook.character.json', import.meta.url));
export const ALL_FACINGS = ['s', 'n', 'se', 'sw', 'e', 'ne', 'nw', 'w'];
export const PROV_COLORS = { copied: [60, 160, 90], flipped: [40, 170, 190], relit: [230, 200, 50], painted: [210, 60, 60], outline: [150, 70, 190] };

/**
 * One facing from the given: transplant, then the code painter on the cells inside the layout silhouette that no layer reached, then selout.
 * opts: { letters (the given, 1024), labels (the given's part label per cell), facing, seed, rules, givenLayout }
 * Returns { facing, letters, prov, transplant, painted: [k], outlined: [k], detail, invented (transplant stage), inventedFinal, layout }.
 */
export function buildFacing(rawSpec, { letters, labels, facing, seed = 1, rules = loadFacingRules(), givenLayout = null }) {
  const spec = resolveSpec(rawSpec);
  const G = givenLayout ?? layoutFor(spec, spec.givenFacing, { rules });
  const tp = transplant(spec, { letters, labels, facing, rules, givenLayout: G });
  const T = tp.layout.template;
  // the part label and the light level of each cell: the layout where it has a part, else the part that drew the cell
  const eff = effectiveLabels(tp.layout);
  const cellLabel = Array.from({ length: N * N }, (_, k) => eff[k] ?? (tp.origin[k] ? spec.parts[tp.origin[k].part].label : null));
  const cellLevel = Array.from({ length: N * N }, (_, k) => (T.level[k] >= 0 ? T.level[k] : 1));
  const prov = tp.prov.slice();
  let out = tp.letters;
  let painted = [];
  let outlined = [];
  if (facing !== spec.givenFacing) {
    const mask = tp.prov.map((p) => (p === 'empty' ? 1 : 0));
    const cp = codePaint(spec, { letters: out, mask, labels: cellLabel, levels: cellLevel, source: { letters, labels, levels: levelsOfLetters(spec, letters, labels) }, seed, edge: Array.from(T.outline, (v) => (v === 1 ? 1 : 0)) });
    painted = cp.filled;
    out = cp.letters;
    for (const k of painted) prov[k] = 'painted';
    // selout: painted cells, and moved cells that were inside the figure in the given and now touch the edge
    const edgeCandidates = [...painted];
    for (let k = 0; k < N * N; k++) if (tp.origin[k] && tp.origin[k].srcEdge === false) edgeCandidates.push(k);
    const so = selOutline(spec, out, { labels: cellLabel, levels: cellLevel, cells: edgeCandidates });
    out = so.letters;
    outlined = so.changed;
    for (const k of outlined) prov[k] = 'outline';
  }
  const inventedFinal = (() => {
    let n = 0, tot = 0;
    for (let k = 0; k < N * N; k++) if (out[k] !== '.') { tot++; if (prov[k] === 'painted' || prov[k] === 'outline') n++; }
    return tot ? Math.round((n / tot) * 10000) / 10000 : 0;
  })();
  const detail = detailMask({ letters: out, labels: cellLabel, prov, origin: tp.origin, rules });
  return { facing, letters: out, prov, transplant: tp, painted, outlined, detail, invented: tp.invented, inventedFinal, layout: tp.layout, cellLabel };
}

/** The candidate's own part labels as rows of part codes ('.' for a transparent cell): the --parts file of the grade command, so S-RAMP has labels by construction (C3). */
export function labelRows(res) {
  return Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
    const k = y * N + x;
    return res.letters[k] === '.' || !res.cellLabel[k] ? '.' : PARTS[res.cellLabel[k]].code;
  }).join('')).join('\n');
}

/** Letters to an image through the pixkit Grid, so an off-palette letter throws (the palette lock). */
export function lettersToImage(letters) {
  const g = new Grid(N, N, Object.values(HEX_OF));
  letters.forEach((l, k) => { if (l !== '.') g.set(k % N, Math.floor(k / N), HEX_OF[l]); });
  return g.toImage();
}
function colorImage(cellFn) {
  const img = newImage(N, N, [0, 0, 0, 0]);
  for (let k = 0; k < N * N; k++) { const c = cellFn(k); if (c) setPx(img, k % N, Math.floor(k / N), [...c, 255]); }
  return img;
}
export const partsImage = (template) => colorImage((k) => (template.label[k] ? PART_COLORS[template.label[k]] : null));
export const provImage = (res) => colorImage((k) => (res.letters[k] === '.' ? null : (PROV_COLORS[res.prov[k]] ?? PROV_COLORS.copied)));

export function main(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  const out = o.out ?? DEFAULT_OUT;
  const facings = (o.facings ?? ALL_FACINGS.join(',')).split(',');
  const seed = Number(o.seed ?? 1);
  const spec = loadSpec(o.spec ?? DEFAULT_SPEC);
  const rules = loadFacingRules();
  const img = loadGiven();
  const letters = lettersOfImage(img);
  const labels = givenLabels(buildPartMap(img));
  const G = layoutFor(spec, spec.givenFacing, { rules });
  mkdirSync(out, { recursive: true });
  writePng(img, `${out}/given.png`);
  const lines = [];
  const paintPaths = [];
  const partsPaths = [];
  for (const f of facings) {
    const r = buildFacing(spec, { letters, labels, facing: f, seed, rules, givenLayout: G });
    writePng(lettersToImage(r.letters), `${out}/${f}.png`);
    writePng(partsImage(r.layout.template), `${out}/${f}-parts.png`);
    writePng(provImage(r), `${out}/${f}-prov.png`);
    writeFileSync(`${out}/${f}.txt`, formatGrid32(r.letters));
    writeFileSync(`${out}/${f}-labels.txt`, `${labelRows(r)}\n`);
    paintPaths.push(`${out}/${f}.png`);
    partsPaths.push(`${out}/${f}-parts.png`);
    const c = r.transplant.counts;
    lines.push(`${f.padEnd(2)} copied ${c.copied} flipped ${c.flipped} relit ${c.relit} empty ${c.empty} | invented at transplant ${(100 * r.invented).toFixed(1)}% | painted ${r.painted.length} outline ${r.outlined.length} | final invented ${(100 * r.inventedFinal).toFixed(1)}% | detail mask ${r.detail.count}/${r.detail.opaque} (${(100 * r.detail.share).toFixed(1)}%)`);
  }
  writePng(buildSheet({ inputs: paintPaths, given: `${out}/given.png` }), `${out}/sheet-paint.png`);
  writePng(buildSheet({ inputs: partsPaths, given: `${out}/given.png` }), `${out}/sheet-parts.png`);
  writeFileSync(`${out}/summary.txt`, `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
  console.log(`sheets: ${out}/sheet-paint.png ${out}/sheet-parts.png`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
