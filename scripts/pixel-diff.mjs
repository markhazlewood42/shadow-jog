#!/usr/bin/env node
/**
 * Pixel diff of two screenshot sets: the "same pixels" check (PL2) of docs/PIVOT-640.md.
 *
 *   node scripts/pixel-diff.mjs <dirA> <dirB> [--mask <file>] [--stable-from <dir>] [--write-mask <file>] [--quiet]
 *
 * Pairs every PNG under <dirA> with the file of the same relative path under <dirB> (for example
 * `maps/annex.png`). Two files with the same bytes (the same SHA-1) are "same" without decoding.
 * The rest are decoded (scripts/lib/png.mjs) and compared pixel by pixel; a pixel differs when any
 * of its four channels differs. Prints one row per shot and a total.
 *
 *   --mask <file>        a JSON file with the shot names (no .png) that may differ because they
 *                        animate (rain, water, idle motion, a clock). Either a plain array or an
 *                        object with a "shots" array. The baseline step of WP0 writes it.
 *   --stable-from <dir>  a second run of the baseline build. A pixel that is the same in <dirA>
 *                        and in this run is "stable": not animation. A masked shot then still has to
 *                        match <dirB> on every stable pixel, so a layout change cannot hide behind
 *                        the mask. Without this option a masked shot is only reported.
 *   --write-mask <file>  write the names of the shots that differ to this JSON file (the baseline
 *                        step compares two runs of one build this way).
 *   --quiet              print only the shots that differ, and the total.
 *
 * Exit code 1 when a shot not on the mask list differs or is missing on either side, or when a
 * masked shot differs on a stable pixel (with --stable-from). Else 0.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { decodePng } from './lib/png.mjs';

const HELP = `pixel-diff: compare two screenshot sets pixel by pixel (PL2 of docs/PIVOT-640.md).

  node scripts/pixel-diff.mjs <dirA> <dirB> [--mask <file>] [--stable-from <dir>] [--write-mask <file>] [--quiet]

  --mask <file>        JSON with the shot names (no .png) that may differ (an array, or { "shots": [...] })
  --stable-from <dir>  a second run of the baseline: a masked shot must still match on every pixel that
                       is the same in <dirA> and in this run (the pixels that do not animate)
  --write-mask <file>  write the names of the shots that differ to this JSON file
  --quiet              print only the shots that differ, and the total

Exit code 1 when a shot not on the mask list differs or is missing, or a masked shot differs on a
stable pixel; else 0.`;

const args = process.argv.slice(2);
const positional = [];
let maskFile = null, stableDir = null, writeMaskFile = null, quiet = false, help = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--mask') maskFile = args[++i];
  else if (a === '--stable-from') stableDir = args[++i];
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
for (const d of [dirA, dirB, ...(stableDir ? [stableDir] : [])]) {
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
const samePixel = (a, b, o) => a[o] === b[o] && a[o + 1] === b[o + 1] && a[o + 2] === b[o + 2] && a[o + 3] === b[o + 3];

/**
 * Compare one pair of files. `differing` counts every pixel that differs; `stableDiff` counts only
 * the differing pixels that are the same in A and in the stable run (null without a stable run).
 */
function compare(fileA, fileB, fileS) {
  const a = readFileSync(fileA), b = readFileSync(fileB);
  if (sha1(a) === sha1(b)) return { text: 'same (same bytes)', differing: 0, stableDiff: 0 };
  const pa = decodePng(a), pb = decodePng(b);
  if (pa.width !== pb.width || pa.height !== pb.height) {
    return { text: `size differs: ${pa.width}x${pa.height} vs ${pb.width}x${pb.height}`, differing: pa.width * pa.height, stableDiff: null };
  }
  let ps = null;
  if (fileS && existsSync(fileS)) {
    ps = decodePng(readFileSync(fileS));
    if (ps.width !== pa.width || ps.height !== pa.height) ps = null;
  }
  let differing = 0, stableDiff = 0, stable = 0;
  const n = pa.width * pa.height;
  for (let p = 0, o = 0; p < n; p++, o += 4) {
    const isStable = ps ? samePixel(pa.data, ps.data, o) : false;
    if (isStable) stable++;
    if (!samePixel(pa.data, pb.data, o)) {
      differing++;
      if (isStable) stableDiff++;
    }
  }
  if (differing === 0) return { text: 'same (same pixels, different bytes)', differing: 0, stableDiff: 0 };
  let text = `${differing} px differ (${((differing / n) * 100).toFixed(2)}%)`;
  if (ps) text += `, ${stableDiff} of them on the ${stable} stable px`;
  return { text, differing, stableDiff: ps ? stableDiff : null };
}

const mask = readMask(maskFile);
const namesA = shotNames(dirA), namesB = new Set(shotNames(dirB));
const all = [...new Set([...namesA, ...namesB])].sort();
const differed = [];
let total = 0, same = 0, missing = 0, maskedCount = 0, failed = 0, stableTotal = 0, stableFailed = 0;
const width = Math.max(...all.map((n) => n.length), 4);
const rows = [];
for (const name of all) {
  const inA = namesA.includes(name), inB = namesB.has(name);
  const masked = mask.has(name);
  let text, differing = 0, stableDiff = 0;
  if (!inA || !inB) {
    text = inA ? 'missing in B' : 'only in B';
    missing++;
  } else {
    ({ text, differing, stableDiff } = compare(join(dirA, `${name}.png`), join(dirB, `${name}.png`), stableDir ? join(stableDir, `${name}.png`) : null));
  }
  const differs = differing > 0 || !inA || !inB;
  if (differs) differed.push(name);
  else same++;
  let tag = '';
  if (differs && masked) {
    maskedCount++;
    if (stableDir && stableDiff === null) tag = '  [masked, no stability data]';
    else if (stableDir && stableDiff > 0) { tag = '  [masked, FAIL: stable pixels differ]'; stableFailed++; stableTotal += stableDiff; }
    else tag = stableDir ? '  [masked, stable pixels match]' : '  [masked]';
  }
  if (differs && !masked) { failed++; total += differing; }
  if (!quiet || differs) rows.push(`${name.padEnd(width)}  ${text}${tag}`);
}
console.log(`pixel-diff: ${dirA}  vs  ${dirB}${stableDir ? `  (stable pixels from ${stableDir})` : ''}`);
console.log(`${'shot'.padEnd(width)}  result`);
for (const r of rows) console.log(r);
console.log('');
console.log(`${all.length} shots: ${same} same, ${differed.length} differ or missing (${maskedCount} of them masked), ${missing} missing on one side.`);
console.log(`Total differing pixels outside the mask: ${total}${failed ? ` in ${failed} shot(s)` : ''}.`);
if (stableDir) console.log(`Differing stable pixels inside the mask: ${stableTotal}${stableFailed ? ` in ${stableFailed} shot(s)` : ''}.`);
if (writeMaskFile) {
  mkdirSync(dirname(writeMaskFile), { recursive: true });
  writeFileSync(writeMaskFile, `${JSON.stringify({ written: new Date().toISOString(), from: [dirA, dirB], shots: differed }, null, 2)}\n`);
  console.log(`Mask list written: ${writeMaskFile} (${differed.length} shot(s)).`);
}
process.exit(failed || stableFailed ? 1 : 0);
