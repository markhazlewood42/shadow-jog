// Walk metrics on the 8-frame walk sheet: bottom-row sequence, head-bob row sequence, planted-foot finder, and the pass line check.
//   node scripts/art/pipeline/walk.mjs [--out dir] [--write-target]
// Definitions (all on opaque pixels of one 32x32 frame):
//   bottom row   the last opaque row (bbox y1).
//   head-bob row the first row (from the top, rows 0 to 13) that holds an orange lens letter (j or s). A face landmark, so hair pixels do not move it.
//   foot edges   over the 3 bottom rows (y1 - 2 to y1): L = the smallest x, R = the largest x. Merged feet still give two edges.
//   planted foot for each frame k, the move from frame k - 1 (frame 0 compares with the last frame, the cycle wraps): dL = L(k) - L(k-1), dR = R(k) - R(k-1).
//                the planted foot is the one that moves less: 'L' if |dL| < |dR|, 'R' if |dR| < |dL|, 'LR' on a tie. Its shift is that dL or dR (on a tie, both are checked).
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { bbox, isOpaque } from '../metrics.mjs';
import { letterAt } from '../headtest/lib.mjs';
import { OUT_DIR, ensureDir, loadWalkFrames, writeTargetKey } from './given.mjs';

export const FOOT_ROWS = 3;
export const BOTTOM_TOL = 2; // PA-10: bottom row within 2 px
export const PLANTED_MAX = 1; // planted foot moves at most 1 px per frame

export function bottomRow(f) {
  return bbox(f)?.y1 ?? -1;
}
export function topRow(f) {
  return bbox(f)?.y0 ?? -1;
}
export function headBobRow(f) {
  for (let y = 0; y < 14; y++) for (let x = 0; x < f.w; x++) if (['j', 's'].includes(letterAt(f, x, y))) return y;
  return -1;
}
export function footEdges(f) {
  const b = bbox(f);
  if (!b) return null;
  let L = f.w;
  let R = -1;
  for (let y = b.y1 - FOOT_ROWS + 1; y <= b.y1; y++)
    for (let x = 0; x < f.w; x++) if (isOpaque(f, x, y)) { L = Math.min(L, x); R = Math.max(R, x); }
  return { L, R };
}

/** For each frame, the planted foot of the move into it. */
export function plantedFeet(frames) {
  const edges = frames.map(footEdges);
  return frames.map((_, k) => {
    const p = edges[(k + frames.length - 1) % frames.length];
    const c = edges[k];
    const dL = (c?.L ?? 0) - (p?.L ?? 0);
    const dR = (c?.R ?? 0) - (p?.R ?? 0);
    const foot = Math.abs(dL) < Math.abs(dR) ? 'L' : Math.abs(dR) < Math.abs(dL) ? 'R' : 'LR';
    return { frame: k, foot, dL, dR, shift: foot === 'R' ? dR : dL };
  });
}

/** Everything measured on a set of walk frames. */
export function measureWalk(frames) {
  const planted = plantedFeet(frames);
  return {
    frames: frames.length,
    bottomRow: frames.map(bottomRow),
    topRow: frames.map(topRow),
    headBobRow: frames.map(headBobRow),
    footEdges: frames.map(footEdges),
    planted,
    maxPlantedShift: Math.max(...planted.map((p) => (p.foot === 'LR' ? Math.max(Math.abs(p.dL), Math.abs(p.dR)) : Math.abs(p.shift)))),
  };
}

/**
 * The walk pass line against a target (the given walk's measured record: bottomRow, headBobRow, plantedFoot sides).
 * Each line has a name: bottom-row (within 2 px of the target on every frame), planted-foot (the planted foot of the target moves at most 1 px per frame), bob (row sequence equal to the target's).
 */
export function checkWalk(frames, target) {
  const m = measureWalk(frames);
  const lines = [];
  const badBottom = m.bottomRow.map((v, k) => ({ k, v, want: target.bottomRow[k] })).filter((o) => Math.abs(o.v - (o.want ?? o.v)) > BOTTOM_TOL);
  lines.push({ name: 'bottom-row', pass: m.frames === target.bottomRow.length && badBottom.length === 0, detail: badBottom });
  const badFeet = [];
  for (const [k, side] of target.plantedFoot.entries()) {
    const p = m.planted[k];
    if (!p) continue;
    const moves = side === 'L' ? [p.dL] : side === 'R' ? [p.dR] : [p.dL, p.dR];
    if (moves.some((d) => Math.abs(d) > PLANTED_MAX)) badFeet.push({ k, side, dL: p.dL, dR: p.dR });
  }
  lines.push({ name: 'planted-foot', pass: m.planted.length === target.plantedFoot.length && badFeet.length === 0, detail: badFeet });
  const bobOk = m.headBobRow.length === target.headBobRow.length && m.headBobRow.every((v, k) => v === target.headBobRow[k]);
  lines.push({ name: 'bob', pass: bobOk, detail: { got: m.headBobRow, want: target.headBobRow } });
  return { ok: lines.every((l) => l.pass), lines, measured: m };
}

/** The record stored in target.json: the given walk's own numbers. */
export function walkRecord(frames) {
  const m = measureWalk(frames);
  return {
    note: 'Walk metrics of the given sheet (8 frames). Definitions in scripts/art/pipeline/walk.mjs. Written by walk.mjs --write-target.',
    bottomRow: m.bottomRow,
    topRow: m.topRow,
    headBobRow: m.headBobRow,
    footEdges: m.footEdges,
    plantedFoot: m.planted.map((p) => p.foot),
    plantedShift: m.planted.map((p) => ({ frame: p.frame, foot: p.foot, dL: p.dL, dR: p.dR })),
    maxPlantedShift: m.maxPlantedShift,
  };
}

// ---- CLI ----
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const out = a.includes('--out') ? a[a.indexOf('--out') + 1] : OUT_DIR;
  const frames = loadWalkFrames();
  const rec = walkRecord(frames);
  const chk = checkWalk(frames, rec);
  console.log(`bottom row   ${rec.bottomRow.join(' ')}`);
  console.log(`top row      ${rec.topRow.join(' ')}`);
  console.log(`head-bob row ${rec.headBobRow.join(' ')}`);
  console.log(`foot edges   ${rec.footEdges.map((e) => `${e?.L}-${e?.R}`).join(' ')}`);
  console.log(`planted foot ${rec.plantedShift.map((p) => `${p.foot}(${p.dL},${p.dR})`).join(' ')}`);
  console.log(`max planted shift ${rec.maxPlantedShift} px; pass line on the given: ${chk.ok ? 'PASS' : 'FAIL'}`);
  ensureDir(out);
  writeFileSync(`${out}/walk.json`, `${JSON.stringify(rec, null, 2)}\n`);
  if (a.includes('--write-target')) {
    writeTargetKey('walk', rec);
    console.log('wrote target.json pipeline.walk');
  }
  process.exit(chk.ok ? 0 : 1);
}
