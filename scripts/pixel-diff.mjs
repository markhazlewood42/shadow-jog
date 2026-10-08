#!/usr/bin/env node
/**
 * Pixel diff of two screenshot sets: the "same pixels" check (PL2) of docs/PIVOT-640.md.
 *
 *   node scripts/pixel-diff.mjs <dirA> <dirB> [--mask <file>] [--stable-from <dir>[,<dir>...]]
 *                               [--diff-out <dir>] [--write-mask <file>] [--quiet]
 *
 * Pairs every PNG under <dirA> with the file of the same relative path under <dirB> (for example
 * `maps/annex.png`). Two files with the same bytes (the same SHA-1) are "same" without decoding.
 * The rest are decoded (scripts/lib/png.mjs) and compared pixel by pixel; a pixel differs when any
 * of its four channels differs. Prints one row per shot and a total.
 *
 *   --mask <file>        a JSON file with the shot names (no .png) that may differ because they
 *                        animate (rain, water, idle motion, a clock). Either a plain array or an
 *                        object with a "shots" array. The baseline step of WP0 writes it.
 *   --stable-from <dirs> other runs of the baseline build, comma-separated (the flag may repeat). A
 *                        pixel that is the same in <dirA> and in every one of these runs is "stable":
 *                        not animation, as far as those runs can tell. A masked shot then still has
 *                        to match <dirB> on every stable pixel, so a layout change cannot hide behind
 *                        the mask. More runs make the stable set smaller and the claim surer.
 *                        Without this option a masked shot is only reported.
 *   --diff-out <dir>     write one picture per differing shot: the <dirA> shot dimmed, differing
 *                        pixels in yellow, and differing stable pixels in red.
 *   --write-mask <file>  write the names of the shots that differ to this JSON file (the baseline
 *                        step compares two runs of one build this way).
 *   --quiet              print only the shots that differ, and the total.
 *
 * Exit code 1 when a shot not on the mask list differs or is missing on either side, or when a
 * masked shot differs on a stable pixel (with --stable-from). Else 0.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { decodePng, encodePng } from './lib/png.mjs';
import { shotNames } from './lib/shot-names.mjs';

const HELP = `pixel-diff: compare two screenshot sets pixel by pixel (PL2 of docs/PIVOT-640.md).

  node scripts/pixel-diff.mjs <dirA> <dirB> [--mask <file>] [--stable-from <dir>[,<dir>...]] [--diff-out <dir>]
                              [--write-mask <file>] [--quiet]

  --mask <file>        JSON with the shot names (no .png) that may differ (an array, or { "shots": [...] })
  --stable-from <dirs> other runs of the baseline: a masked shot must still match on every pixel that is the
                       same in <dirA> and in all of these runs (the pixels that do not animate)
  --diff-out <dir>     write a diff picture per differing shot (yellow: differs; red: differs on a stable pixel)
  --write-mask <file>  write the names of the shots that differ to this JSON file
  --quiet              print only the shots that differ, and the total

Exit code 1 when a shot not on the mask list differs or is missing, or a masked shot differs on a
stable pixel; else 0.`;

const args = process.argv.slice(2);
const positional = [];
const stableDirs = [];
let maskFile = null, diffOut = null, writeMaskFile = null, quiet = false, help = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--mask') maskFile = args[++i];
  else if (a === '--stable-from') stableDirs.push(...args[++i].split(',').map((s) => s.trim()).filter(Boolean));
  else if (a === '--diff-out') diffOut = args[++i];
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
for (const d of [dirA, dirB, ...stableDirs]) {
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

const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');
const samePixel = (a, b, o) => a[o] === b[o] && a[o + 1] === b[o + 1] && a[o + 2] === b[o + 2] && a[o + 3] === b[o + 3];

/** Decode the stability runs' copies of a shot that match A's size (others are skipped). */
function stableCopies(name, pa) {
  const out = [];
  for (const d of stableDirs) {
    const f = join(d, `${name}.png`);
    if (!existsSync(f)) continue;
    const p = decodePng(readFileSync(f));
    if (p.width === pa.width && p.height === pa.height) out.push(p);
  }
  return out;
}

/**
 * Compare one pair of files. `differing` counts every pixel that differs; `stableDiff` counts only
 * the differing pixels that are the same in A and in every stability run (null without such runs).
 * With --diff-out, writes the diff picture.
 */
function compare(name, fileA, fileB) {
  const a = readFileSync(fileA), b = readFileSync(fileB);
  if (sha1(a) === sha1(b)) return { text: 'same (same bytes)', differing: 0, stableDiff: 0 };
  const pa = decodePng(a), pb = decodePng(b);
  if (pa.width !== pb.width || pa.height !== pb.height) {
    return { text: `size differs: ${pa.width}x${pa.height} vs ${pb.width}x${pb.height}`, differing: pa.width * pa.height, stableDiff: null };
  }
  const runs = stableDirs.length ? stableCopies(name, pa) : [];
  const haveStability = stableDirs.length > 0 && runs.length === stableDirs.length;
  let differing = 0, stableDiff = 0, stable = 0;
  const n = pa.width * pa.height;
  const diff = diffOut ? new Uint8Array(n * 4) : null;
  for (let p = 0, o = 0; p < n; p++, o += 4) {
    let isStable = haveStability;
    for (let r = 0; isStable && r < runs.length; r++) if (!samePixel(pa.data, runs[r].data, o)) isStable = false;
    if (isStable) stable++;
    const differs = !samePixel(pa.data, pb.data, o);
    if (differs) {
      differing++;
      if (isStable) stableDiff++;
    }
    if (diff) {
      if (differs && isStable) { diff[o] = 255; diff[o + 1] = 40; diff[o + 2] = 40; }
      else if (differs) { diff[o] = 255; diff[o + 1] = 220; diff[o + 2] = 40; }
      else { diff[o] = pa.data[o] >> 2; diff[o + 1] = pa.data[o + 1] >> 2; diff[o + 2] = pa.data[o + 2] >> 2; }
      diff[o + 3] = 255;
    }
  }
  if (differing === 0) return { text: 'same (same pixels, different bytes)', differing: 0, stableDiff: 0 };
  if (diff) {
    const file = join(diffOut, `${name}.png`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, encodePng(pa.width, pa.height, diff));
    diffsWritten++;
  }
  let text = `${differing} px differ (${((differing / n) * 100).toFixed(2)}%)`;
  if (haveStability) text += `, ${stableDiff} of them on the ${stable} stable px`;
  else if (stableDirs.length) text += ', no stability data for this shot';
  return { text, differing, stableDiff: haveStability ? stableDiff : null };
}

const mask = readMask(maskFile);
let diffsWritten = 0;
const namesA = shotNames(dirA), namesB = new Set(shotNames(dirB));
const all = [...new Set([...namesA, ...namesB])].sort();
// Two folders with no shot between them would report "0 differing pixels" and exit 0: a pass that
// compared nothing. That is a mistake in the arguments, so it fails.
if (all.length === 0) {
  console.error(`pixel-diff: no PNG shots in ${dirA} or ${dirB}, so nothing was compared`);
  process.exit(2);
}
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
    ({ text, differing, stableDiff } = compare(name, join(dirA, `${name}.png`), join(dirB, `${name}.png`)));
  }
  const differs = differing > 0 || !inA || !inB;
  if (differs) differed.push(name);
  else same++;
  let tag = '';
  if (differs && masked) {
    maskedCount++;
    if (stableDirs.length && stableDiff === null) tag = '  [masked, no stability data]';
    else if (stableDirs.length && stableDiff > 0) { tag = '  [masked, FAIL: stable pixels differ]'; stableFailed++; stableTotal += stableDiff; }
    else tag = stableDirs.length ? '  [masked, stable pixels match]' : '  [masked]';
  }
  if (differs && !masked) { failed++; total += differing; }
  if (!quiet || differs) rows.push(`${name.padEnd(width)}  ${text}${tag}`);
}
console.log(`pixel-diff: ${dirA}  vs  ${dirB}${stableDirs.length ? `  (stable pixels: the same in ${dirA} and in ${stableDirs.join(', ')})` : ''}`);
console.log(`${'shot'.padEnd(width)}  result`);
for (const r of rows) console.log(r);
console.log('');
console.log(`${all.length} shots: ${same} same, ${differed.length} differ or missing (${maskedCount} of them masked), ${missing} missing on one side.`);
console.log(`Total differing pixels outside the mask: ${total}${failed ? ` in ${failed} shot(s)` : ''}.`);
if (stableDirs.length) console.log(`Differing stable pixels inside the mask: ${stableTotal}${stableFailed ? ` in ${stableFailed} shot(s)` : ''}.`);
// Name the folder only when a picture went into it: with 0 differing pixels nothing was written.
if (diffOut && diffsWritten > 0) console.log(`Diff pictures: ${diffOut}/ (${diffsWritten} written; yellow: differs; red: differs on a stable pixel).`);
else if (diffOut) console.log('Diff pictures: none written (no shot differs).');
if (writeMaskFile) {
  mkdirSync(dirname(writeMaskFile), { recursive: true });
  writeFileSync(writeMaskFile, `${JSON.stringify({ written: new Date().toISOString(), from: [dirA, dirB], shots: differed }, null, 2)}\n`);
  console.log(`Mask list written: ${writeMaskFile} (${differed.length} shot(s)).`);
}
process.exit(failed || stableFailed ? 1 : 0);
