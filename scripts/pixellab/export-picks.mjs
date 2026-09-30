// Put Mark's art-pass picks into the game: turn each chosen option into the files the game loads
// (public/art/, shipped with the build) and a manifest describing them. src/art/drawn.ts loads it
// at startup; anything missing falls back to the art drawn in code.
//   node scripts/pixellab/export-picks.mjs          (the dev server needn't be running)
//
// Picks: an asset's ★ Best, else its ✓ Good (a crew member with one option got "Good" = this one);
// the townsfolk pool takes every look marked either. Held back for now, with the reason logged:
// portraits (only a neutral face exists; the dialogue uses six more expressions), battle animations
// (Mark's review: unusable; the standing frame plus code motion is used), and critters.
//
// What the export does to the art:
// - Characters: one sheet per character, a row per facing (down, right, up, left), the standing
//   frame then the walk frames. Each walk frame is snapped to the colours of its standing frame
//   (PixelLab's walks sometimes flicker a colour, e.g. a backpack), and walk frames Mark flagged
//   are replaced by the standing frame.
// - Enemies and props: cropped to their drawn pixels (the game places art by its size).
// - Tilesets: the 16 tiles in a 4x4 sheet, with each tile's corners in the manifest.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const SRC = 'media/art-pass';
const OUT = 'public/art';
const review = JSON.parse(readFileSync(`${SRC}/review.json`, 'utf8'));
const metas = Object.fromEntries(
  readdirSync(`${SRC}/assets`)
    .filter((d) => existsSync(`${SRC}/assets/${d}/meta.json`))
    .map((d) => [d, JSON.parse(readFileSync(`${SRC}/assets/${d}/meta.json`, 'utf8'))]),
);
const enemySprite = JSON.parse(readFileSync(`${SRC}/current/enemies.json`, 'utf8'));
const b64 = (rel) => readFileSync(`${SRC}/${rel}`).toString('base64');

/** Mark's pick for each asset (see the header). */
function picks() {
  const out = [];
  for (const [aid, r] of Object.entries(review.assets ?? {})) {
    const opts = Object.entries(r.options ?? {});
    const best = opts.filter(([, v]) => v.verdict === 'best');
    const good = opts.filter(([, v]) => v.verdict === 'good');
    const chosen = best.length ? best : aid.startsWith('town.') ? good : good.slice(0, 1);
    for (const [oid, v] of chosen) {
      const meta = metas[aid];
      const opt = meta?.options.find((o) => o.id === oid);
      if (meta && opt?.status === 'done') out.push({ meta, opt, flags: v.flags ?? {} });
    }
  }
  return out;
}

const FACINGS = [
  ['down', 'south'],
  ['right', 'east'],
  ['up', 'north'],
  ['left', 'west'],
];
/** The export's own game-side names for enemy sprites (src/data/enemies.ts `sprite`). */
const SPRITE_OF = {
  rustfang_medic: 'medic', rustfang_punk: 'punk', rustfang_slinger: 'slinger', glowrat: 'rat', scrap_hound: 'hound', street_drone: 'drone', smog_wisp: 'wisp', knuckles: 'brute', sewer_ghoul: 'ghoul', rust_crab: 'crab', maint_drone: 'maint', drowned_shade: 'shade', gutter_eel: 'eel', lurker: 'lurker', km_sentinel: 'sentinel', sentry_turret: 'turret', km_arcanist: 'arcanist', hunter_drone: 'hunter', bound_spirit: 'bound', warden: 'warden', warden_spirit: 'warden_spirit',
};

const manifest = { version: 1, made: new Date().toISOString(), chars: [], battlers: {}, enemies: {}, tilesets: [], props: {}, held: [] };
// Every one-off NPC the pass covered, picked or not: the townsfolk pool must never take them over.
manifest.oneOffs = Object.values(metas).flatMap((m) => (m.npc ? [m.npc] : []));
const jobs = []; // work for the browser page: { out, op, ... }

for (const { meta, opt, flags } of picks()) {
  const [cat, key = ''] = meta.id.split('.');
  if (meta.kind === 'portrait') {
    manifest.held.push(`${meta.id}: portraits wait for their other expressions`);
    continue;
  }
  if (meta.kind === 'critter') {
    manifest.held.push(`${meta.id}: critters aren't drawn from sprites yet`);
    continue;
  }
  if (meta.kind === 'battler') {
    const file = `battle/${key}.png`;
    jobs.push({ op: 'copy', out: file, src: b64(opt.rotations.north) });
    manifest.battlers[key] = { file };
    continue;
  }
  if (meta.kind === 'enemy') {
    const sprite = SPRITE_OF[key];
    if (!sprite) {
      manifest.held.push(`${meta.id}: no game sprite name for it`);
      continue;
    }
    const file = `enemies/${sprite}.png`;
    jobs.push({ op: 'crop', out: file, src: b64(opt.image) });
    manifest.enemies[sprite] = { file, enemy: key, family: enemySprite[key]?.family };
    continue;
  }
  if (meta.kind === 'prop') {
    const file = `props/${key}.png`;
    jobs.push({ op: 'crop', out: file, src: b64(opt.image) });
    manifest.props[key] = { file };
    continue;
  }
  if (meta.kind === 'tileset') {
    if (!meta.terrains) {
      manifest.held.push(`${meta.id}: no map uses this terrain yet`);
      continue;
    }
    const file = `tiles/${key}.png`;
    jobs.push({ op: 'tiles', out: file, tiles: opt.tiles.map((t) => b64(t.file)) });
    // The canal set owns only the water and its banks: the plaza and sidewalk it borders belong to
    // the street and park sets (whose tiles it would otherwise pave over).
    const drawUpper = key !== 'canal';
    manifest.tilesets.push({ id: key, file, ...meta.terrains, drawUpper, corners: opt.tiles.map((t) => (t.corners ? `${t.corners.NW}|${t.corners.NE}|${t.corners.SW}|${t.corners.SE}` : null)) });
    continue;
  }
  if (meta.kind === 'field' || meta.kind === 'npc') {
    const walk = opt.anims?.walk?.frames ?? {};
    const rows = FACINGS.map(([dir, pl]) => {
      const bad = new Set(flags[`walk/${pl}`] ?? []);
      return { stand: b64(opt.rotations[pl]), walk: (walk[pl] ?? []).map((f, i) => (bad.has(i) ? null : b64(f))) };
    });
    const file = `chars/${meta.id.replace(/\./g, '_')}.png`;
    const frames = Math.max(1, ...rows.map((r) => 1 + r.walk.length));
    jobs.push({ op: 'sheet', out: file, rows, frames });
    const target = meta.kind === 'field' ? { look: key } : meta.look ? { look: meta.look } : meta.npc ? { npc: meta.npc } : { pool: meta.pool };
    manifest.chars.push({ id: meta.id, file, cell: 32, frames, walk: frames > 1, ...target });
    continue;
  }
  manifest.held.push(`${meta.id}: nothing exports a ${meta.kind} yet`);
}
// Canal last: its banks draw over the street and plaza edges they meet.
manifest.tilesets.sort((a, b) => (a.id === 'canal') - (b.id === 'canal'));

// ------------------------------------------------------------------ the pixel work, in a browser
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage();
const results = await page.evaluate(async (jobs) => {
  const load = (b) =>
    new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = `data:image/png;base64,${b}`;
    });
  const canvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  };
  /** The box of drawn pixels. */
  const bounds = (c) => {
    const { data, width: w, height: h } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 0) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };
  /** Snap every pixel of `c` to the nearest colour in `ref` (the standing frame's palette). */
  const snap = (c, ref) => {
    const r = ref.getContext('2d').getImageData(0, 0, ref.width, ref.height).data;
    const pal = new Map();
    for (let i = 0; i < r.length; i += 4) if (r[i + 3] > 0) pal.set((r[i] << 16) | (r[i + 1] << 8) | r[i + 2], [r[i], r[i + 1], r[i + 2]]);
    const cols = [...pal.values()];
    const g = c.getContext('2d');
    const img = g.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    let changed = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      if (pal.has((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])) continue;
      let best = cols[0], bd = Infinity;
      for (const p of cols) {
        const dd = (p[0] - d[i]) ** 2 + (p[1] - d[i + 1]) ** 2 + (p[2] - d[i + 2]) ** 2;
        if (dd < bd) { bd = dd; best = p; }
      }
      d[i] = best[0]; d[i + 1] = best[1]; d[i + 2] = best[2];
      changed++;
    }
    g.putImageData(img, 0, 0);
    return changed;
  };
  const out = [];
  for (const j of jobs) {
    if (j.op === 'copy') {
      const i = await load(j.src);
      const c = canvas(i.width, i.height);
      c.getContext('2d').drawImage(i, 0, 0);
      out.push({ out: j.out, png: c.toDataURL('image/png') });
    } else if (j.op === 'crop') {
      const i = await load(j.src);
      const full = canvas(i.width, i.height);
      full.getContext('2d').drawImage(i, 0, 0);
      const bx = bounds(full) ?? { x: 0, y: 0, w: i.width, h: i.height };
      const c = canvas(bx.w, bx.h);
      c.getContext('2d').drawImage(full, -bx.x, -bx.y);
      out.push({ out: j.out, png: c.toDataURL('image/png'), size: [bx.w, bx.h] });
    } else if (j.op === 'tiles') {
      const imgs = await Promise.all(j.tiles.map(load));
      const s = imgs[0].width;
      const c = canvas(s * 4, s * Math.ceil(imgs.length / 4));
      imgs.forEach((im, k) => c.getContext('2d').drawImage(im, (k % 4) * s, Math.floor(k / 4) * s));
      out.push({ out: j.out, png: c.toDataURL('image/png') });
    } else if (j.op === 'sheet') {
      const cell = 32;
      const c = canvas(cell * j.frames, cell * 4);
      const g = c.getContext('2d');
      let snapped = 0;
      let repaired = 0;
      /**
       * Pixels that differ between two frames (colour or coverage) in the head and body, the top
       * 55%: walking moves the legs, but a frame facing the wrong way differs up top (face, tie).
       */
      const diff = (a, b) => {
        const rows = Math.ceil(cell * 0.55);
        const x = a.getContext('2d').getImageData(0, 0, cell, rows).data;
        const y = b.getContext('2d').getImageData(0, 0, cell, rows).data;
        let n = 0;
        for (let i = 0; i < x.length; i += 4) if ((x[i + 3] > 0) !== (y[i + 3] > 0) || (x[i + 3] > 0 && Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]) > 60)) n++;
        return n;
      };
      const mirrored = (src) => {
        const m = canvas(cell, cell);
        const mg = m.getContext('2d');
        mg.scale(-1, 1);
        mg.drawImage(src, -cell, 0);
        return m;
      };
      for (const [row, r] of j.rows.entries()) {
        const stand = await load(r.stand);
        const sc = canvas(cell, cell);
        sc.getContext('2d').drawImage(stand, 0, 0);
        g.drawImage(sc, 0, row * cell);
        const frames = [];
        for (let k = 0; k < j.frames - 1; k++) {
          const f = r.walk[k] ?? null;
          if (!f) {
            frames.push(null);
            continue;
          }
          const fc = canvas(cell, cell);
          fc.getContext('2d').drawImage(await load(f), 0, 0);
          snapped += snap(fc, sc);
          frames.push(fc);
        }
        // Frames that don't belong (PixelLab sometimes draws the front inside a walking-away cycle):
        // far more different from the standing frame than the rest of the cycle is.
        const d = frames.map((f) => (f ? diff(f, sc) : 0));
        const sorted = frames.filter(Boolean).map((_, i) => d[i]).sort((a, b) => a - b);
        const median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;
        const odd = frames.map((f, k) => !f || (frames.length >= 4 && d[k] > median * 1.8 && d[k] - median > 20));
        // A bad or missing frame becomes the mirror of the opposite step (same pose, other leg);
        // failing that, the standing frame.
        for (let k = 0; k < frames.length; k++) {
          let use = frames[k];
          if (odd[k]) {
            const o = (k + frames.length / 2) % frames.length;
            use = frames.length >= 4 && Number.isInteger(o) && frames[o] && !odd[o] ? mirrored(frames[o]) : sc;
            if (frames[k]) repaired++;
          }
          g.drawImage(use, (k + 1) * cell, row * cell);
        }
      }
      out.push({ out: j.out, png: c.toDataURL('image/png'), snapped, repaired });
    }
  }
  return out;
}, jobs);
await browser.close();

// Start clean, so art Mark un-picked doesn't linger.
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
for (const r of results) {
  const path = `${OUT}/${r.out}`;
  mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  writeFileSync(path, Buffer.from(r.png.split(',')[1], 'base64'));
}
writeFileSync(`${OUT}/manifest.json`, `${JSON.stringify(manifest, null, 1)}\n`);
const snapped = results.reduce((n, r) => n + (r.snapped ?? 0), 0);
for (const r of results) if (r.repaired) console.log(`  ${r.out}: ${r.repaired} walk frame(s) replaced by the mirrored opposite step`);
console.log(`exported: ${manifest.chars.length} characters, ${Object.keys(manifest.battlers).length} battle sprites, ${Object.keys(manifest.enemies).length} enemies, ${manifest.tilesets.length} tilesets, ${Object.keys(manifest.props).length} props (${snapped} walk pixels snapped to their standing colours)`);
for (const h of manifest.held) console.log(`  held: ${h}`);
