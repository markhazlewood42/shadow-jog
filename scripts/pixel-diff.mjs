#!/usr/bin/env node
/**
 * Pixel diff of two screenshot sets: the "same pixels" check (PL2) of docs/PIVOT-640.md.
 *
 *   node scripts/pixel-diff.mjs <dirA> <dirB> [--mask <file>] [--write-mask <file>] [--quiet]
 *
 * Pairs every PNG under <dirA> with the file of the same relative path under <dirB> (for example
 * `maps/annex.png`). Two files with the same bytes (the same SHA-1) are "same" without decoding.
 * The rest are decoded (scripts/lib/png.mjs) and compared pixel by pixel; a pixel differs when any
 * of its four channels differs. Prints one row per shot and a total.
 *
 *   --mask <file>        a JSON file with the shot names (no .png) that may differ. The "Autosaved"
 *                        badge shows the wall clock, so two runs of one build differ there. Either
 *                        a plain array or an object with a "shots" array.
 *   --write-mask <file>  write the names of the shots that differ to this JSON file (the baseline
 *                        step of WP0 makes the mask list this way).
 *   --quiet              print only the shots that differ and the total.
 *
 * Exit code 1 when a shot not on the mask list differs or is missing on either side, else 0.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { decodePng } from './lib/png.mjs';

const HELP = `pixel-diff: compare two screenshot sets pixel by pixel (PL2 of docs/PIVOT-640.md).

  node scripts/pixel-diff.mjs <dirA> <dirB> [--mask <file>] [--write-mask <file>] [--quiet]

  --mask <file>        JSON with the shot names (no .png) that may differ (an array, or { "shots": [...] })
  --write-mask <file>  write the names of the shots that differ to this JSON file
  --quiet              print only the shots that differ, and the total

Exit code 1 when a shot not on the mask list differs or is missing, else 0.`;

const args = process.argv.slice(2);
const positional = [];
let maskFile = null, writeMaskFile = null, quiet = false, help = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--mask') maskFile = args[++i];
  else if (a === '--write-mask') writeMaskFile = args[++i];
  else if (a === '--quiet') quiet = true;
  else if (a === '--help' || a === '-h') help = true;
  else positional.push(a);
}
if (help || positional.length !== 2) {
  console.log(HELP);
  process.exit(help ? 0 : 2);
}
const [dirA, dirB] = positional;
for (const d of [dirA, dirB]) {
  if (!existsSync(d) || !statSync(d).isDirectory()) {
    console.error(`not a directory: ${d}`);
    process.exit(2);
  }
}

/** Shot names a mask file lists. */
function readMask(file) {
  if (!file) return new Set();
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const list = Array.isArray(json) ? json : json.shots;
  if (!Array.isArray(list)) throw new Error(`${file}: expected an array or an object with "shots"`);
  return new Set(list);
}

/** Every PNG under `dir`, as names relative to it, with forward slashes and no extension. */
function shotNames(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.png')) out.push(relative(dir, p).split(sep).join('/').replace(/\.png$/i, ''));
    }
  };
  walk(dir);
  return out.sort();
}

const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');

/** Compare one pair of files. Returns a short result string and the count of differing pixels. */
function compare(fileA, fileB) {
  const a = readFileSync(fileA), b = readFileSync(fileB);
  if (sha1(a) === sha1(b)) return { text: 'same (same bytes)', differing: 0 };
  const pa = decodePng(a), pb = decodePng(b);
  if (pa.width !== pb.width || pa.height !== pb.height) {
    return { text: `size differs: ${pa.width}x${pa.height} vs ${pb.width}x${pb.height}`, differing: pa.width * pa.height };
  }
  let differing = 0;
  const n = pa.width * pa.height;
  for (let p = 0, o = 0; p < n; p++, o += 4) {
    if (pa.data[o] !== pb.data[o] || pa.data[o + 1] !== pb.data[o + 1] || pa.data[o + 2] !== pb.data[o + 2] || pa.data[o + 3] !== pb.data[o + 3]) differing++;
  }
  if (differing === 0) return { text: 'same (same pixels, different bytes)', differing: 0 };
  return { text: `${differing} px differ (${((differing / n) * 100).toFixed(2)}%)`, differing };
}

const mask = readMask(maskFile);
const namesA = shotNames(dirA), namesB = new Set(shotNames(dirB));
const all = [...new Set([...namesA, ...namesB])].sort();
const differed = [];
let total = 0, same = 0, missing = 0, maskedCount = 0, failed = 0;
const width = Math.max(...all.map((n) => n.length), 4);
const rows = [];
for (const name of all) {
  const inA = namesA.includes(name), inB = namesB.has(name);
  const masked = mask.has(name);
  let text, differing = 0;
  if (!inA || !inB) {
    text = inA ? 'missing in B' : 'only in B';
    missing++;
  } else {
    ({ text, differing } = compare(join(dirA, `${name}.png`), join(dirB, `${name}.png`)));
  }
  const differs = differing > 0 || !inA || !inB;
  if (differs) differed.push(name);
  if (!differs) same++;
  if (differs && masked) maskedCount++;
  if (differs && !masked) { failed++; total += differing; }
  if (!quiet || differs) rows.push(`${name.padEnd(width)}  ${text}${differs && masked ? '  [masked]' : ''}`);
}
console.log(`pixel-diff: ${dirA}  vs  ${dirB}`);
console.log(`${'shot'.padEnd(width)}  result`);
for (const r of rows) console.log(r);
console.log('');
console.log(`${all.length} shots: ${same} same, ${differed.length} differ or missing (${maskedCount} of them masked), ${missing} missing on one side.`);
console.log(`Total differing pixels outside the mask: ${total}${failed ? ` in ${failed} shot(s)` : ''}.`);
if (writeMaskFile) {
  mkdirSync(dirname(writeMaskFile), { recursive: true });
  writeFileSync(writeMaskFile, `${JSON.stringify({ written: new Date().toISOString(), from: [dirA, dirB], shots: differed }, null, 2)}\n`);
  console.log(`Mask list written: ${writeMaskFile} (${differed.length} shot(s)).`);
}
process.exit(failed ? 1 : 0);
