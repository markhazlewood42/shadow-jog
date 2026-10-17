// gradesheet.mjs: sheets for the graders.
//   node gradesheet.mjs compare <candidate> <out.png> [--given path]
//       reference and candidate side by side at 1x, 4x, 16x, gray and posterized, with the score.mjs numbers printed.
//   node gradesheet.mjs compare-blind <candidate> <out.png> [--given path]
//       numberless reference-vs-candidate sheet at 1x, 4x, 16x for the anchor score.
//   node gradesheet.mjs pair <candidate> <outBase> [--seed n] [--round n] [--given path]
//       blind pair: A and B (given and candidate, random order) at 4x and 16x. Writes <outBase>.png. The key goes to H/keys/round-<n>/ (--keys dir to change), never next to the sheet.
//   node gradesheet.mjs triplet <candidate> <outBase> [--seed n] [--given path] [--round8 path]
//       given head, candidate head, round 8 down head, shuffled, labels X Y Z. Writes <outBase>.png; the key goes to H/keys/round-<n>/ (--round n).
import { mkdirSync, writeFileSync } from 'node:fs';
import { BOX, FAMILY_NAMES, crop, drawText, newImage, paste, readPng, scaled, textWidth, writePng } from './lib.mjs';
import { GIVEN, ROUND8_DOWN, loadImage, scoreImage, toBox, verdictOf } from './score.mjs';

const BG = [20, 20, 26, 255];
const TXT = [225, 228, 235, 255];
const GREEN = [110, 220, 130, 255];
const RED = [240, 100, 100, 255];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffle = (arr, r) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export function scoreLines(candImg, givenImg) {
  const lines = [];
  const ev = scoreImage(candImg, givenImg, 'head');
  lines.push({ t: 'HEAD MODE', c: TXT });
  for (const r of ev.rows) {
    let v = String(r.value);
    if (r.name === 'ramp shares') v = `max diff ${Math.max(...FAMILY_NAMES.map((f) => Math.abs(ev.measures.ramps[f] - ev.ref.ramps[f]))).toFixed(2)}`;
    const tag = r.pass === null ? '    ' : r.pass ? 'PASS' : 'FAIL';
    lines.push({ t: `${tag} ${r.name}: ${v} [${r.band.replace(/ \(.*\)/, '')}]`.slice(0, 82), c: r.pass === false ? RED : r.pass ? GREEN : TXT });
  }
  const vd = verdictOf(candImg, givenImg);
  lines.push({ t: '', c: TXT });
  lines.push({ t: `${vd.beatsFlattenedBy30 ? 'PASS' : 'FAIL'} beats flattened baseline (${vd.flattenedExact}) by 30`, c: vd.beatsFlattenedBy30 ? GREEN : RED });
  lines.push({ t: `VERDICT ${vd.verdict}: exact ${vd.exact}, tolerant ${vd.tolerant}`, c: vd.verdict === 'PASS' ? GREEN : vd.verdict === 'VIABLE' ? TXT : RED });
  return lines;
}

const ROWS = [
  ['1x', (i) => scaled(i, 1)],
  ['4x', (i) => scaled(i, 4)],
  ['16x', (i) => scaled(i, 16)],
  ['gray 16x', (i) => scaled(i, 16, { gray: true })],
  ['posterized 16x', (i) => scaled(i, 16, { poster: true })],
];
const PANEL_W = BOX.w * 16;

/** Reference and candidate panels. rows = ROWS entries. Returns { out, y } with the panels drawn from x=16. */
function panels(ref, cand, rows, labelScale, titleScale) {
  let height = 16 + 10 * titleScale;
  rows.forEach(([, f]) => (height += 5 * labelScale + 10 + f(ref).h + 8));
  const out = newImage(16 + PANEL_W + 16 + PANEL_W + 16, height + 8, BG);
  drawText(out, 'REFERENCE', 16, 4, TXT, titleScale);
  drawText(out, 'CANDIDATE', 16 + PANEL_W + 16, 4, TXT, titleScale);
  let y = 16 + 10 * titleScale;
  for (const [label, f] of rows) {
    drawText(out, label, 16, y, [170, 175, 190, 255], labelScale);
    y += 5 * labelScale + 6;
    const a = f(ref), c = f(cand);
    paste(out, a, 16, y);
    paste(out, c, 16 + PANEL_W + 16, y);
    y += a.h + 8;
  }
  return out;
}

function compare(candPath, outPath, givenPath) {
  const given = readPng(givenPath);
  const ref = crop(given, BOX.x, BOX.y, BOX.w, BOX.h);
  const candFull = loadImage(candPath);
  const cand = toBox(candFull);
  const lines = scoreLines(candFull, given);
  const left = panels(ref, cand, ROWS, 2, 3);
  const textW = 82 * 16 + 16;
  const lineH = 28;
  const out = newImage(left.w + textW, Math.max(left.h, 16 + lines.length * lineH + 16), BG);
  paste(out, left, 0, 0);
  lines.forEach((l, i) => drawText(out, l.t, left.w, 16 + i * lineH, l.c, 4));
  writePng(out, outPath);
}

/** Numberless sheet for the anchor score: reference and candidate at 1x, 4x and 16x, labeled only REFERENCE and CANDIDATE. */
function compareBlind(candPath, outPath, givenPath) {
  const given = readPng(givenPath);
  const ref = crop(given, BOX.x, BOX.y, BOX.w, BOX.h);
  const cand = toBox(loadImage(candPath));
  writePng(panels(ref, cand, ROWS.slice(0, 3).map(([, f]) => ['', f]), 2, 3), outPath);
}

function labeled(imgs, k, title) {
  const w = BOX.w * k;
  const out = newImage(imgs.length * (w + 16) + 16, BOX.h * k + 40, BG);
  imgs.forEach(({ label, img }, i) => {
    const x = 16 + i * (w + 16);
    drawText(out, label, x + Math.floor((w - textWidth(label, 3)) / 2), 8, TXT, 3);
    paste(out, scaled(img, k), x, 32);
  });
  if (title) drawText(out, title, 16, out.h - 8, TXT, 1);
  return out;
}
const stack = (parts) => {
  const w = Math.max(...parts.map((p) => p.w));
  const h = parts.reduce((s, p) => s + p.h, 0);
  const out = newImage(w, h, BG);
  let y = 0;
  for (const p of parts) {
    paste(out, p, 0, y);
    y += p.h;
  }
  return out;
};

function blind(kind, candPath, base, a) {
  const opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
  const r = rng(Number(opt('--seed', Date.now() % 2147483647)));
  const given = readPng(opt('--given', GIVEN));
  const items = [
    { id: 'given', img: crop(given, BOX.x, BOX.y, BOX.w, BOX.h) },
    { id: 'candidate', img: toBox(loadImage(candPath)) },
  ];
  let labels = ['A', 'B'];
  if (kind === 'triplet') {
    items.push({ id: 'round8-down', img: toBox(readPng(opt('--round8', ROUND8_DOWN))) });
    labels = ['X', 'Y', 'Z'];
  }
  const order = shuffle(items, r);
  const shown = order.map((it, i) => ({ label: labels[i], img: it.img }));
  writePng(stack([labeled(shown, 4), labeled(shown, 16)]), `${base}.png`);
  const keyDir = `${opt('--keys', 'C:/Users/markh/AppData/Local/Temp/rook-head/keys')}/round-${opt('--round', 'x')}`;
  mkdirSync(keyDir, { recursive: true });
  const keyPath = `${keyDir}/${base.split('/').pop().split('\\').pop()}-key.json`;
  writeFileSync(keyPath, `${JSON.stringify(Object.fromEntries(order.map((it, i) => [labels[i], it.id])), null, 2)}\n`);
  console.log(`${kind} sheet ${base}.png, key ${keyPath} (orchestrator only, never next to the sheet)`);
}

const [, , cmd, cand, out, ...rest] = process.argv;
if (cmd === 'compare' && cand && out) {
  compare(cand, out, rest.includes('--given') ? rest[rest.indexOf('--given') + 1] : GIVEN);
  console.log(`compare sheet ${out}`);
} else if (cmd === 'compare-blind' && cand && out) {
  compareBlind(cand, out, rest.includes('--given') ? rest[rest.indexOf('--given') + 1] : GIVEN);
  console.log(`blind compare sheet ${out}`);
} else if ((cmd === 'pair' || cmd === 'triplet') && cand && out) {
  blind(cmd, cand, out, rest);
} else {
  console.error('usage: node gradesheet.mjs compare|pair|triplet <candidate> <out> [--seed n] [--given path] [--round8 path]');
  process.exit(2);
}
