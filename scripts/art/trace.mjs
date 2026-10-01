// Trace chosen PixelLab frames into the character rig's own data (src/art/rig2/traced.ts): the
// standing frame per facing as indexed pixel rows plus its palette, with the outer outline taken
// off (the rig draws the outline itself, after posing), and the rows the rig animates around.
// The pixels come from the art Mark liked; everything done to them after this (walks, poses,
// outlines, recolouring) is code. See docs/ARCHITECTURE.md §7, "Rig v2".
//   node scripts/art/trace.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const A = 'media/art-pass/assets';
/** Which frames to trace: character → the option Mark picked (or, for Kit, the round-2 redo). */
const SOURCES = {
  kit: `${A}/crew.kit/redo1`,
  rook: `${A}/crew.rook/chosen`,
  hex: `${A}/crew.hex/kit`,
  sable: `${A}/crew.sable/kit`,
};
const FACINGS = { down: 'south', right: 'east', up: 'north', left: 'west' };
/**
 * Battle backs (128x128, from behind): the frame each crew member's battle sprite is built on.
 * Kit: her fighting stance (an unflagged frame of her PixelLab idle, the one Mark pointed to); the others:
 * the standing back view Mark picked (crew style for Rook and Sable, prompt only for Hex).
 */
const BATTLE = {
  kit: `${A}/battle.kit/house/idle-north-4.png`,
  rook: `${A}/battle.rook/house/north.png`,
  hex: `${A}/battle.hex/plain/north.png`,
  sable: `${A}/battle.sable/house/north.png`,
};

/** At most this many colours per character (shared by its four facings); battle backs, more detailed, get more. */
const MAX_COLOURS = { field: 28, battle: 40 };
const jobs = [];
for (const [who, dir] of Object.entries(SOURCES))
  for (const [facing, pl] of Object.entries(FACINGS)) jobs.push({ group: who, kind: 'field', who, facing, src: readFileSync(`${dir}/${pl}.png`).toString('base64') });
for (const [who, file] of Object.entries(BATTLE)) jobs.push({ group: `battle:${who}`, kind: 'battle', who, facing: 'up', src: readFileSync(file).toString('base64') });

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage();
const all = await page.evaluate(async ({ jobs, MAXES }) => {
  const load = (b) =>
    new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = `data:image/png;base64,${b}`;
    });
  const out = [];
  for (const j of jobs) {
    const img = await load(j.src);
    const w = img.width, h = img.height;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, w, h).data;
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? null : [d[(y * w + x) * 4], d[(y * w + x) * 4 + 1], d[(y * w + x) * 4 + 2], d[(y * w + x) * 4 + 3]]);
    const solid = (x, y) => (at(x, y)?.[3] ?? 0) > 0;
    const lum = (p) => 0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2];
    // The outer outline: dark pixels touching the outside. Taken off in one pass (the rig
    // re-outlines); dark lines inside the sprite (seams, folds, the eyes) stay.
    const outline = new Set();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = at(x, y);
        if (!p || p[3] === 0 || lum(p) > 48) continue;
        if (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1)) outline.add(`${x},${y}`);
      }
    const keep = (x, y) => solid(x, y) && !outline.has(`${x},${y}`);
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (keep(x, y)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    // The kept pixels (cropped, with a pixel of room for the outline), as colours for now.
    x0 -= 1; y0 -= 1; x1 += 1; y1 += 1;
    const px = [];
    for (let y = y0; y <= y1; y++) {
      const row = [];
      for (let x = x0; x <= x1; x++) row.push(keep(x, y) ? at(x, y).slice(0, 3) : null);
      px.push(row);
    }
    const W = x1 - x0 + 1, H = y1 - y0 + 1;
    const rows = px.map((r) => r.map((p) => (p ? 'x' : '.')).join(''));
    const filled = (x, y) => rows[y]?.[x] !== undefined && rows[y][x] !== '.';
    // Anchors: the feet (lowest filled row) and, facing us or away, the crotch (the lowest row
    // above the feet where the middle column is filled: below it, two legs).
    let feet = H - 1;
    while (feet > 0 && ![...rows[feet]].some((ch) => ch !== '.')) feet--;
    const cx = Math.round((W - 1) / 2);
    let crotch = null;
    if (j.facing === 'down' || j.facing === 'up') {
      // Find the centre gap between the legs, looking up from the feet.
      let gapTop = null;
      for (let y = feet; y > feet - 12; y--) {
        const mid = [cx - 1, cx, cx + 1].some((x) => !filled(x, y));
        if (mid) gapTop = y; else if (gapTop != null) break;
      }
      crotch = gapTop != null ? gapTop - 1 : feet - 6;
    }
    out.push({ group: j.group, kind: j.kind, who: j.who, facing: j.facing, w: W, h: H, ox: x0, oy: y0, px, feet, crotch, outlined: outline.size });
  }
  // One palette per character: merge the two closest colours (weighted by how many pixels use
  // them) until at most MAX remain. Noise in the shading goes; the ramps stay.
  const CH = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const key = (p) => (p[0] << 16) | (p[1] << 8) | p[2];
  for (const group of [...new Set(out.map((t) => t.group))]) {
    const frames = out.filter((t) => t.group === group);
    const MAX = MAXES[frames[0].kind];
    const counts = new Map();
    for (const t of frames) for (const r of t.px) for (const p of r) if (p) counts.set(key(p), (counts.get(key(p)) ?? 0) + 1);
    let cl = [...counts].map(([k, n]) => ({ c: [(k >> 16) & 255, (k >> 8) & 255, k & 255], n, members: [k] }));
    const dist = (a, b) => 2 * (a.c[0] - b.c[0]) ** 2 + 4 * (a.c[1] - b.c[1]) ** 2 + 3 * (a.c[2] - b.c[2]) ** 2;
    while (cl.length > MAX) {
      let bi = 0, bj = 1, bd = Infinity;
      for (let i = 0; i < cl.length; i++) for (let k = i + 1; k < cl.length; k++) {
        const d = dist(cl[i], cl[k]) * Math.min(cl[i].n, cl[k].n);
        if (d < bd) { bd = d; bi = i; bj = k; }
      }
      const a = cl[bi], b = cl[bj];
      // The merged colour is the more used one's (keeps real colours, no muddy averages).
      const keepA = a.n >= b.n;
      const m = { c: keepA ? a.c : b.c, n: a.n + b.n, members: [...a.members, ...b.members] };
      cl = cl.filter((_, i) => i !== bi && i !== bj);
      cl.push(m);
    }
    // Darkest first, so indexes read as a rough ramp.
    const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    cl.sort((a, b) => lum(a.c) - lum(b.c));
    const toIdx = new Map();
    cl.forEach((m, i) => { for (const k of m.members) toIdx.set(k, i); });
    const pal = cl.map((m) => `#${m.c.map((v) => v.toString(16).padStart(2, '0')).join('')}`);
    for (const t of frames) {
      t.pal = pal;
      t.rows = t.px.map((r) => r.map((p) => (p ? CH[toIdx.get(key(p))] : '.')).join(''));
      delete t.px;
    }
  }
  return out;
}, { jobs, MAXES: MAX_COLOURS });
await browser.close();
const traced = all.filter((t) => t.kind === 'field');
const battle = all.filter((t) => t.kind === 'battle');

// Legs start at the crotch facing us or away; the side views take their hip row from the front's.
const byWho = {};
for (const t of traced) (byWho[t.who] ??= {})[t.facing] = t;
const frontLegs = (who) => {
  const f = byWho[who].down;
  const n = f.feet - f.crotch;
  return n >= 3 && n <= 10 ? n : 4;
};
for (const t of traced) {
  const legs = t.crotch != null ? t.feet - t.crotch : 0;
  t.hip = legs >= 3 && legs <= 10 ? t.crotch : t.feet - frontLegs(t.who);
}

const lines = [
  '/**',
  ' * The crew\'s standing frames, traced from the PixelLab picks Mark liked (scripts/art/trace.mjs;',
  ' * regenerate rather than edit by hand). Per facing: pixel rows (palette index per pixel, "." for',
  ' * empty) without the outer outline, the palette, and the rows the rig animates around. The rig',
  ' * (src/art/rig2/rig.ts) does everything else in code: outlines, walks, poses, recolouring.',
  ' */',
  "import type { Traced } from './rig';",
  '',
  'export const TRACED: Record<string, Record<\'down\' | \'right\' | \'up\' | \'left\', Traced>> = {',
];
for (const [who, facings] of Object.entries(byWho)) lines.splice(lines.indexOf("import type { Traced } from './rig';") + 1, 0, `const PAL_${who.toUpperCase()} = [${facings.down.pal.map((p) => `'${p}'`).join(', ')}];`);
for (const [who, facings] of Object.entries(byWho)) {
  lines.push(`  ${who}: {`);
  for (const f of ['down', 'right', 'up', 'left']) {
    const t = facings[f];
    lines.push(`    ${f}: {`);
    lines.push(`      w: ${t.w}, h: ${t.h}, feet: ${t.feet}, hip: ${t.hip},`);
    lines.push(`      pal: PAL_${who.toUpperCase()},`);
    lines.push('      rows: [');
    for (const r of t.rows) lines.push(`        '${r}',`);
    lines.push('      ],');
    lines.push('    },');
  }
  lines.push('  },');
}
lines.push('};', '');
writeFileSync('src/art/rig2/traced.ts', lines.join('\n'));
for (const t of traced) console.log(`${t.who.padEnd(6)} ${t.facing.padEnd(5)} ${t.w}x${t.h} feet ${t.feet} hip ${t.hip} colours ${t.pal.length} (outline px removed ${t.outlined})`);

// Battle backs: one frame each, with where it sat on its 128x128 canvas (the rig's pose points are
// measured on that canvas).
const bl = [
  '/**',
  " * The crew's battle backs (from behind), traced from the PixelLab frames Mark picked",
  ' * (scripts/art/trace.mjs; regenerate rather than edit by hand). `ox, oy`: where the trace sat on',
  ' * its 128x128 canvas. The battle rig (src/art/rig2/battle.ts) builds the poses from it in code.',
  ' */',
  "import type { Traced } from './rig';",
  '',
  'export const BATTLE_TRACED: Record<string, Traced & { ox: number; oy: number }> = {',
];
for (const t of battle) {
  bl.push(`  ${t.who}: {`);
  bl.push(`    w: ${t.w}, h: ${t.h}, ox: ${t.ox}, oy: ${t.oy}, feet: ${t.feet}, hip: ${t.feet},`);
  bl.push(`    pal: [${t.pal.map((p) => `'${p}'`).join(', ')}],`);
  bl.push('    rows: [');
  for (const r of t.rows) bl.push(`      '${r}',`);
  bl.push('    ],');
  bl.push('  },');
}
bl.push('};', '');
writeFileSync('src/art/rig2/traced-battle.ts', bl.join('\n'));
for (const t of battle) console.log(`battle ${t.who}: ${t.w}x${t.h} at (${t.ox}, ${t.oy}), colours ${t.pal.length}`);
