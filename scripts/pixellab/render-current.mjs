// Render the game's current (generated-in-code) art to PNGs, for the art pass: they're the
// "current" column in the review page and the style images PixelLab matches.
//   node scripts/pixellab/render-current.mjs      (the dev server must be running on 3007)
// Writes media/art-pass/current/{char,battler,enemy,portrait}/*.png and current/npcs.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const OUT = 'media/art-pass/current';
/** Where each terrain's current look is photographed: [name, map, x, y]. */
const PLACES = [
  ['street', 'lantern_row', 26, 15],
  ['canal', 'world', 21, 32],
  ['sewer', 'sinkline_1', 16, 5],
  ['yard', 'rustyard', 23, 17],
  ['dock', 'dock', 9, 10],
  ['bar', 'bar', 16, 5],
];
for (const d of ['char', 'battler', 'enemy', 'portrait']) mkdirSync(`${OUT}/${d}`, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('page error:', String(e)));
await page.goto('http://localhost:3007/?debug');
await page.waitForFunction(() => !!window.__SJ__, null, { timeout: 30_000 });

const result = await page.evaluate(async () => {
  const { buildChar } = await import('/src/art/chars.ts');
  const { LOOKS } = await import('/src/data/looks.ts');
  const { battler, POSES } = await import('/src/art/battlers.ts');
  const { enemyArt } = await import('/src/art/enemies.ts');
  const { ENEMIES } = await import('/src/data/enemies.ts');
  const { getPortrait, PORTRAIT_KEYS } = await import('/src/art/portraits.ts');
  const { getMap, mapIds } = await import('/src/data/maps/index.ts');
  const png = (c) => c.toDataURL('image/png');
  /** A canvas of `w`x`h` with `src` centred, feet on the bottom row. */
  const onCanvas = (src, w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(src, Math.floor((w - src.width) / 2), h - src.height);
    return c;
  };
  /** The four facings side by side (down, right, up, left). */
  const strip = (sp) => {
    const dirs = ['down', 'right', 'up', 'left'];
    const f0 = sp.frames.down[0];
    const c = document.createElement('canvas');
    c.width = f0.width * 4;
    c.height = f0.height;
    const g = c.getContext('2d');
    dirs.forEach((d, i) => g.drawImage(sp.frames[d][0], i * f0.width, 0));
    return c;
  };
  const out = { char: {}, style: {}, battler: {}, enemy: {}, portrait: {}, npcs: [] };
  // Named looks (the crew, Dutch, Pale, Mags, the K-M squad...).
  for (const [id, look] of Object.entries(LOOKS)) {
    const sp = buildChar(look);
    out.char[id] = png(strip(sp));
    out.style[id] = png(onCanvas(sp.frames.down[0], 32, 32));
  }
  // Every NPC placed on every map, with its look (for the townsfolk pool and named NPCs).
  for (const mid of mapIds()) {
    for (const n of getMap(mid).npcs ?? []) {
      if (n.critter) {
        out.npcs.push({ map: mid, id: n.id, name: n.name, x: n.x, y: n.y, critter: n.critter });
        continue;
      }
      const named = Object.entries(LOOKS).find(([, l]) => l === n.look)?.[0] ?? null;
      const key = `${mid}.${n.id}`;
      out.npcs.push({ map: mid, id: n.id, name: n.name, x: n.x, y: n.y, move: n.move ?? 'static', named, look: n.look });
      if (!named) {
        const sp = buildChar(n.look);
        out.char[key] = png(strip(sp));
        out.style[key] = png(onCanvas(sp.frames.down[0], 32, 32));
      }
    }
  }
  // Battle sprites: the crew seen from behind, every pose.
  for (const id of ['kit', 'rook', 'hex', 'sable']) {
    const b = battler(id, LOOKS[id]);
    for (const p of POSES) if (b.frames[p]) out.battler[`${id}-${p}`] = png(b.frames[p]);
  }
  // Enemies, at their art resolution (res: art pixels per battle-world pixel).
  for (const [key, e] of Object.entries(ENEMIES)) {
    const a = enemyArt(e.sprite);
    out.enemy[key] = { png: png(a.canvas), res: a.res, w: a.w, h: a.h, name: e.name, family: e.family, boss: !!e.boss };
  }
  for (const k of PORTRAIT_KEYS) {
    const p = getPortrait(k, 'neutral');
    if (p) out.portrait[k] = png(p);
  }
  return out;
});

const save = (path, dataUrl) => writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
for (const [k, v] of Object.entries(result.char)) save(`${OUT}/char/${k}.png`, v);
for (const [k, v] of Object.entries(result.style)) save(`${OUT}/char/${k}.style32.png`, v);
for (const [k, v] of Object.entries(result.battler)) save(`${OUT}/battler/${k}.png`, v);
const enemies = {};
for (const [k, v] of Object.entries(result.enemy)) {
  save(`${OUT}/enemy/${k}.png`, v.png);
  enemies[k] = { res: v.res, w: v.w, h: v.h, name: v.name, family: v.family, boss: v.boss };
}
for (const [k, v] of Object.entries(result.portrait)) save(`${OUT}/portrait/${k}.png`, v);
writeFileSync(`${OUT}/npcs.json`, JSON.stringify(result.npcs, null, 1));
writeFileSync(`${OUT}/enemies.json`, JSON.stringify(enemies, null, 1));
console.log(`chars ${Object.keys(result.char).length}, battler frames ${Object.keys(result.battler).length}, enemies ${Object.keys(enemies).length}, portraits ${Object.keys(result.portrait).length}, npc placements ${result.npcs.length}`);

// Props, each painted on its own (ground layer, then its standing sprite), cropped to what's drawn.
mkdirSync(`${OUT}/prop`, { recursive: true });
const props = await page.evaluate(async () => {
  const { paintProp } = await import('/src/field/props.ts');
  const { getMap, mapIds } = await import('/src/data/maps/index.ts');
  // The first placement of each kind on any map, as the game draws it (size, colour, text).
  const first = new Map();
  for (const mid of mapIds()) for (const p of getMap(mid).props ?? []) if (!first.has(p.kind)) first.set(p.kind, p);
  const out = {};
  for (const [kind, def] of first) {
    const W = 8 * 16;
    const H = 8 * 16;
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      return c;
    };
    const [g, e, o, oe] = [mk(), mk(), mk(), mk()].map((c) => c.getContext('2d'));
    const b = {
      g, e, o, oe, lights: [], sprites: [], anims: [], w: 8, h: 8,
      block() {}, unblock() {},
      both(fn) { fn(g); fn(e); },
      bothOver(fn) { fn(o); fn(oe); },
    };
    try {
      paintProp(b, { ...def, x: 2, y: 4, when: undefined }, 7);
    } catch (err) {
      out[kind] = { error: String(err) };
      continue;
    }
    const all = mk();
    const a = all.getContext('2d');
    a.drawImage(g.canvas, 0, 0);
    for (const s of b.sprites) a.drawImage(s.canvas, s.x, s.y);
    a.drawImage(o.canvas, 0, 0);
    // Crop to the drawn pixels.
    const px = a.getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3] > 0) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (x1 < 0) continue;
    const c = document.createElement('canvas');
    c.width = x1 - x0 + 1;
    c.height = y1 - y0 + 1;
    c.getContext('2d').drawImage(all, -x0, -y0);
    out[kind] = { png: c.toDataURL('image/png') };
  }
  return out;
});
let nProps = 0;
for (const [k, v] of Object.entries(props)) {
  if (v.png) {
    save(`${OUT}/prop/${k}.png`, v.png);
    nProps++;
  } else if (v.error) console.log(`prop ${k}: ${v.error}`);
}

// Places: the game's own view of each area the terrain comes from (for the terrain review).
mkdirSync(`${OUT}/place`, { recursive: true });
// The viewport is the game's own size (one screen pixel per game pixel), read from the size source
// (src/engine/game.ts) so a later change of resolution cannot leave this script cropping the wrong area.
const { W, H } = await page.evaluate(async () => {
  const m = await import('/src/engine/game.ts');
  return { W: m.W, H: m.H };
});
await page.setViewportSize({ width: W, height: H });
/** The 128x128 crop of the terrain, centered in the screen. */
const CROP = 128;
const crop = { x: Math.floor((W - CROP) / 2), y: Math.floor((H - CROP) / 2), width: CROP, height: CROP };
for (const [name, map, x, y] of PLACES) {
  await page.goto(`http://localhost:3007/?debug&scene=field&map=${map}&x=${x}&y=${y}`);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/place/${name}.png` });
  await page.screenshot({ path: `${OUT}/place/${name}.crop.png`, clip: crop });
}
console.log(`props ${nProps}, places ${PLACES.length}`);
await browser.close();
