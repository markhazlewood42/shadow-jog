// Facing-ID harness (consult C2 C4, build B5): the blind task "name the facing". It builds the task and scores the answers.
// It runs NO model: an orchestrator gives the pictures and the prompt to a blind grader (a fresh Sonnet), then scores the answers here.
//   node scripts/art/v2/grade/facingid.mjs build --calibration --out <taskDir> --key <keyDir>
//   node scripts/art/v2/grade/facingid.mjs build --cand <facing>=<png> [--cand ...] --out <taskDir> --key <keyDir>
//   node scripts/art/v2/grade/facingid.mjs score --answers <answers.json> --key <keyDir>/key.json
// A task item is one picture: the given on the left and one candidate on the right, both at 8x, on a gray ground. The grader names the facing
// of the right picture from 8 options. The option letters are shuffled per item (fixed seed), so the position of the answer says nothing.
// The task folder holds only the pictures and the prompt. The key (the right answer per item and the letter map) goes to a separate folder,
// grader side (out and key must be two separate folders, neither inside the other). A calibration set of 10 items must score 9 of 10 before the
// grader's facing-ID verdicts count. A candidate task (C6 round 1: 2 items) needs every item right: the pass need is a parameter of the task.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { newImage, readPng, writePng } from '../../pixkit/png.mjs';
import { candidateFromRef } from './calibrate.mjs';
import { loadSpec } from './hardlines.mjs';
import { N, flipH } from './image.mjs';
import { REF_FACINGS, loadReference } from './refs/labels.mjs';

/** The 8 facings, in the ring order. `name` is the screen direction the grader sees. The given is down-right (se). */
export const FACINGS = [
  { id: 's', name: 'down (facing the viewer)' },
  { id: 'se', name: 'down-right' },
  { id: 'e', name: 'right' },
  { id: 'ne', name: 'up-right' },
  { id: 'n', name: 'up (back to the viewer)' },
  { id: 'nw', name: 'up-left' },
  { id: 'w', name: 'left' },
  { id: 'sw', name: 'down-left' },
];
export const FACING_IDS = FACINGS.map((f) => f.id);
/** The pass need of the calibration set only (9 of 10). A candidate task needs all of its items right. */
export const PASS_NEED = 9;
export const SCALE = 8;
const GAP = 16;
const GROUND = [122, 122, 122];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The picture of one item: the given on the left, the candidate on the right, each at `scale`x with nearest neighbor, on a gray ground. */
export function facingIdPicture(given, cand, { scale = SCALE, gap = GAP } = {}) {
  const w = N * scale * 2 + gap;
  const h = N * scale;
  const img = newImage(w, h);
  for (let i = 0; i < w * h; i++) img.data.set([...GROUND, 255], i * 4);
  const blit = (src, x0) => {
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = (y * src.w + x) * 4;
        if (x >= src.w || y >= src.h || src.data[i + 3] !== 255) continue;
        for (let v = 0; v < scale; v++) for (let u = 0; u < scale; u++) img.data.set(src.data.subarray(i, i + 4), ((y * scale + v) * w + x0 + x * scale + u) * 4);
      }
  };
  blit(given, 0);
  blit(cand, N * scale + gap);
  return img;
}

/** The prompt for the blind grader. The letters of one item are in `letters` (letter -> facing id). */
export function promptText(items) {
  const L = [
    'You see a set of pictures. In each picture, the LEFT figure is a game character facing DOWN-RIGHT (toward the viewer and to the right of the picture). The RIGHT figure is the same character in another facing, or the same facing.',
    'Name the facing of the RIGHT figure. Directions are screen directions: "down" means facing the viewer, "up" means the back is to the viewer, "right" means toward the right side of the picture, "left" means toward the left side of the picture.',
    'Each picture has 8 lettered options. The letters change from picture to picture, so read them each time. Answer with the letter only, one line per picture, like: item-01: C',
    'Do not guess from the file name or the order. Look at the figure: where the face points, whether the face is visible, which shoulder and which hand show.',
    '',
  ];
  for (const it of items) {
    L.push(`${it.id} (picture ${it.file})`);
    for (const [letter, fid] of Object.entries(it.letters)) L.push(`  ${letter}: ${FACINGS.find((f) => f.id === fid).name}`);
    L.push('');
  }
  return `${L.join('\n')}`;
}

/** True when a and b are the same folder, or one is inside the other. */
export function foldersOverlap(a, b) {
  const rel = (from, to) => {
    const r = relative(resolve(from), resolve(to));
    return r === '' || (!r.startsWith('..') && !isAbsolute(r));
  };
  return rel(a, b) || rel(b, a);
}

/**
 * Build the task. items: [{ id, cand (Img), facing (the right answer) }].
 * Writes <out>/item-NN.png and <out>/prompt.txt, and <key>/key.json (grader side). Returns { items, key }.
 * passNeed: how many items the grader must get right. The default is every item (a candidate task, C6: 2 of 2). The calibration set passes PASS_NEED (9 of 10).
 * Throws when out and key are the same folder or one is inside the other: the key would sit in the task folder.
 */
export function buildFacingIdTask(items, { out, key, given = loadSpec().given, seed = 20261017, passNeed = items.length } = {}) {
  if (foldersOverlap(out, key)) throw new Error(`out and key must be separate folders, neither inside the other (out ${out}, key ${key}): the key is grader side`);
  const rnd = mulberry32(seed);
  mkdirSync(out, { recursive: true });
  mkdirSync(key, { recursive: true });
  const built = [];
  const keyItems = {};
  // The item order is shuffled too, so the number of an item says nothing about its facing.
  const order0 = [...items];
  for (let i = order0.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order0[i], order0[j]] = [order0[j], order0[i]];
  }
  order0.forEach((it, k) => {
    const id = `item-${String(k + 1).padStart(2, '0')}`;
    const order = [...FACING_IDS];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const letters = Object.fromEntries(order.map((fid, i) => ['ABCDEFGH'[i], fid]));
    const file = `${id}.png`;
    writePng(facingIdPicture(given, it.cand), `${out}/${file}`);
    built.push({ id, file, letters });
    keyItems[id] = { facing: it.facing, correct: Object.entries(letters).find(([, f]) => f === it.facing)[0], letters, source: it.source ?? null };
  });
  writeFileSync(`${out}/prompt.txt`, promptText(built));
  const keyDoc = { note: 'Grader-side answer key. Keep it out of the task folder and out of every grader prompt.', passNeed, seed, items: keyItems };
  writeFileSync(`${key}/key.json`, `${JSON.stringify(keyDoc, null, 2)}\n`);
  return { items: built, key: keyDoc };
}

/**
 * The calibration set: 10 items. The consult names "the 5 references, the given and 2 flips", which is 8 pictures. The two self-mirror facings
 * add the last two (the flips of s and of n keep their facing), so the set has 4 flips: flip(given) = sw, flip(ne) = nw, flip(s) = s, flip(n) = n.
 */
export function calibrationItems(spec = loadSpec()) {
  const ref = Object.fromEntries(REF_FACINGS.map((f) => [f, candidateFromRef(loadReference(f), spec).img]));
  const items = REF_FACINGS.map((f) => ({ cand: ref[f], facing: f, source: `reference ${f}` }));
  items.push({ cand: spec.given, facing: 'se', source: 'the given' });
  items.push({ cand: flipH(spec.given), facing: 'sw', source: 'flip of the given' });
  items.push({ cand: flipH(ref.ne), facing: 'nw', source: 'flip of reference ne' });
  items.push({ cand: flipH(ref.s), facing: 's', source: 'flip of reference s (a self-mirror facing)' });
  items.push({ cand: flipH(ref.n), facing: 'n', source: 'flip of reference n (a self-mirror facing)' });
  return items;
}

/** The calibration task: the 10 calibration items, pass need 9 (the only task where 9 applies). */
export function buildCalibrationTask({ out, key, given, seed } = {}) {
  return buildFacingIdTask(calibrationItems(), { out, key, given, seed, passNeed: PASS_NEED });
}

const NAME_TO_ID = Object.fromEntries(FACINGS.flatMap((f) => [[f.id, f.id], [f.name.toLowerCase(), f.id], [f.name.split(' (')[0].toLowerCase(), f.id]]));

/**
 * Score the answers of one blind grader. answers: { 'item-01': 'C', ... } (a letter, or a facing id or name). key: the key.json document.
 * The pass need is key.passNeed (9 for the calibration set, every item for a candidate task); opts.need overrides it. With no need in either, every item must be right.
 * Returns { correct, total, pass, need, items: [{ id, answer, facing, picked, ok }] }. A missing or unreadable answer is wrong.
 */
export function scoreFacingId(answers, key, { need: needOpt = null } = {}) {
  const need = needOpt ?? key.passNeed ?? Object.keys(key.items).length;
  const rows = Object.entries(key.items).map(([id, k]) => {
    const raw = answers[id];
    const text = typeof raw === 'string' ? raw.trim() : '';
    let picked = null;
    if (/^[A-H]$/i.test(text)) picked = k.letters[text.toUpperCase()] ?? null;
    else picked = NAME_TO_ID[text.toLowerCase()] ?? null;
    return { id, answer: text || null, facing: k.facing, picked, ok: picked === k.facing };
  });
  const correct = rows.filter((r) => r.ok).length;
  return { correct, total: rows.length, need, pass: rows.length >= need && correct >= need, items: rows };
}

function main() {
  const a = process.argv.slice(2);
  const cmd = a[0];
  const opt = (n) => (a.includes(n) ? a[a.indexOf(n) + 1] : null);
  const all = (n) => a.flatMap((x, i) => (x === n ? [a[i + 1]] : []));
  try {
    if (cmd === 'build') {
      const out = opt('--out');
      const key = opt('--key');
      if (!out || !key) throw new Error('build needs --out <taskDir> and --key <keyDir> (a different folder: the key is grader side)');
      let items = null;
      if (!a.includes('--calibration')) {
        items = all('--cand').map((s) => {
          const [facing, path] = s.split('=');
          if (!FACING_IDS.includes(facing)) throw new Error(`--cand needs <facing>=<png> with a facing of ${FACING_IDS.join(', ')}`);
          return { facing, cand: readPng(path), source: path };
        });
        if (!items.length) throw new Error('build needs --calibration or at least one --cand <facing>=<png>');
      }
      const r = items ? buildFacingIdTask(items, { out, key }) : buildCalibrationTask({ out, key });
      console.log(`${r.items.length} items written to ${out}; key written to ${key}/key.json`);
    } else if (cmd === 'score') {
      const key = JSON.parse(readFileSync(opt('--key'), 'utf8'));
      const answers = JSON.parse(readFileSync(opt('--answers'), 'utf8'));
      const s = scoreFacingId(answers, key);
      for (const r of s.items) console.log(`${r.id}: ${r.ok ? 'right' : 'WRONG'} (answer ${r.answer ?? 'none'}, picked ${r.picked ?? 'none'}, key ${r.facing})`);
      console.log(`facing-ID: ${s.correct} of ${s.total} (need ${s.need}): ${s.pass ? 'PASS' : 'FAIL'}`);
      process.exit(s.pass ? 0 : 1);
    } else {
      console.error('usage: facingid.mjs build --calibration|--cand <facing>=<png> --out <taskDir> --key <keyDir>  |  facingid.mjs score --answers <answers.json> --key <key.json>');
      process.exit(2);
    }
  } catch (e) {
    console.error(`facingid: ${e.message}`);
    process.exit(2);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
