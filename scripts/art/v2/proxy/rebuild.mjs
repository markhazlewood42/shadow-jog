// The rebuild rule (plan section 5): each facing rebuilds from character.json, its template and its grid with one command. No PNG patch is a source.
//   rebuildFacing({ spec, facing, gridText, img, pm, blank?, neighbors?, templateJson? })
// Steps: render the template from the spec, classify it (S3), lay the grid over the locked copy cells (the lock wins), run Level T, return the final letters.
// If templateJson (a stored template.json) is given, its hash must equal the hash of the template that the spec renders now. A mismatch means the spec
// changed after the writer saw the template, so the grid must be repainted from the new template (plan section 5, "Fix rounds change structure, not paint").
import { writeFileSync } from 'node:fs';
import { writePng } from '../../headtest/lib.mjs';
import { flatCells, formatGrid32, gridToImage32, parseGrid32 } from './grid32.mjs';
import { formatLevelT, levelT, levelTSheet } from './levelt.mjs';
import { approvedSource, classifyCells, givenSource } from './reproject.mjs';
import { renderTemplate } from './render.mjs';
import { resolveSpec } from './spec.mjs';
import { templateData } from './tdata.mjs';

export class TemplateMismatch extends Error {}

export function rebuildFacing({ spec: rawSpec, facing, gridText, img, pm, blank = null, neighbors = [], templateJson = null }) {
  const spec = resolveSpec(rawSpec);
  const flat = flatCells(parseGrid32(gridText));
  const t = renderTemplate(spec, { facing });
  const sources = [givenSource(spec, img, pm, { blank }), ...neighbors.map((n) => approvedSource(spec, n.facing, n.flat, `neighbor-${n.facing}`))];
  const cls = classifyCells(spec, t, sources, { blank });
  const td = templateData(spec, t, cls);
  if (templateJson && templateJson.hash !== td.hash) throw new TemplateMismatch(`template hash ${templateJson.hash} does not match the spec (${td.hash}): repaint the facing from the new template`);
  const final = [...flat];
  let lockFixed = 0;
  for (const [k, letter] of Object.entries(td.locked)) if (final[k] !== letter) { final[k] = letter; lockFixed++; }
  const result = levelT(td, final);
  return { td, cls, final, levelT: result, lockFixed, ok: result.conflicts.length === 0, shares: { facing, counts: cls.counts, total: cls.total, share: cls.share } };
}

/** Write the rebuilt facing: <facing>.png (32x32), <facing>-sheet.png, <facing>.txt, <facing>-conflicts.txt, template.json. */
export function writeRebuild(outDir, facing, r) {
  writePng(gridToImage32(r.final), `${outDir}/${facing}.png`);
  writePng(levelTSheet(r.final, r.levelT), `${outDir}/${facing}-sheet.png`);
  writeFileSync(`${outDir}/${facing}.txt`, formatGrid32(r.final));
  writeFileSync(`${outDir}/${facing}-conflicts.txt`, formatLevelT(r.levelT));
  writeFileSync(`${outDir}/template.json`, `${JSON.stringify(r.td)}\n`);
}
