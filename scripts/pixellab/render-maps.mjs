// Show each art-pass tileset in a real level, for the review page: the whole map at full size
// (ground, buildings, props) with the drawn tiles laid in, and an in-game shot (lighting, rain,
// people) at a spot where the two terrains meet. The same two pictures of today's game are the
// "Now". Needs the dev server on 3007. Costs nothing (no PixelLab calls).
//   node scripts/pixellab/render-maps.mjs [--only terrain.street]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const ROOT = 'media/art-pass';
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const assets = readdirSync(`${ROOT}/assets`)
  .filter((d) => d.startsWith('terrain.') && (!only || d === only))
  .map((d) => JSON.parse(readFileSync(`${ROOT}/assets/${d}/meta.json`, 'utf8')))
  .filter((m) => m.terrains);

const browser = await chromium.launch({ channel: 'msedge' });
// 1280x720 is exactly 2x the game's 640x360, so the in-game shots are exact, not resampled.
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const problems = [];
page.on('pageerror', (e) => problems.push(String(e)));

/** Load the game (with `tryId` swapped in, if given) and wait for it. */
async function open(query) {
  await page.goto(`http://localhost:3007/?debug${query}`);
  await page.waitForFunction(() => !!window.__SJ__, null, { timeout: 30_000 });
}

/** The whole map, baked fresh (so a swapped-in tileset applies), as a PNG data URL. */
async function wholeMap(mapId) {
  return page.evaluate(async (id) => {
    const { FieldMap } = await import('/src/field/fieldmap.ts');
    const { getMap } = await import('/src/data/maps/index.ts');
    const m = new FieldMap(getMap(id));
    const c = document.createElement('canvas');
    c.width = m.ground.width;
    c.height = m.ground.height;
    const g = c.getContext('2d');
    g.drawImage(m.ground, 0, 0);
    for (const s of [...m.sprites].sort((a, b) => a.baseY - b.baseY)) g.drawImage(s.canvas, s.x, s.y);
    g.drawImage(m.over, 0, 0);
    return c.toDataURL('image/png');
  }, mapId);
}

/** A walkable cell where the tileset's two terrains meet (the median one), for the in-game shot. */
async function spot(t) {
  return page.evaluate(async (t) => {
    const { FieldMap } = await import('/src/field/fieldmap.ts');
    const { getMap } = await import('/src/data/maps/index.ts');
    const m = new FieldMap(getMap(t.map));
    const lower = new Set(t.lower);
    const upper = new Set(t.upper);
    const near = (x, y, set) => {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (set.has(m.at(x + dx, y + dy))) return true;
      return false;
    };
    const cells = [];
    for (let y = 1; y < m.h - 1; y++)
      for (let x = 1; x < m.w - 1; x++) {
        const id = m.at(x, y);
        if (m.isSolid(x, y) || !(lower.has(id) || upper.has(id))) continue;
        if (near(x, y, lower) && (upper.size === 0 || near(x, y, upper))) cells.push([x, y]);
      }
    if (!cells.length) for (let y = 1; y < m.h - 1; y++) for (let x = 1; x < m.w - 1; x++) if (!m.isSolid(x, y) && (lower.has(m.at(x, y)) || upper.has(m.at(x, y)))) cells.push([x, y]);
    return cells[Math.floor(cells.length / 2)] ?? [Math.floor(m.w / 2), Math.floor(m.h / 2)];
  }, t);
}

const save = (path, dataUrl) => {
  mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
};

for (const a of assets) {
  const t = a.terrains;
  // Today's game, for the Now column.
  await open('');
  const [x, y] = await spot(t);
  const nowMap = `current/map/${t.map}.png`;
  if (!existsSync(`${ROOT}/${nowMap}`)) save(`${ROOT}/${nowMap}`, await wholeMap(t.map));
  const nowShot = `current/place/terrain-${a.id.split('.')[1]}.png`;
  await open(`&scene=field&map=${t.map}&x=${x}&y=${y}`);
  await page.waitForTimeout(2500);
  await page.locator('#screen').screenshot({ path: `${ROOT}/${nowShot}` });
  a.preview = { map: nowMap, game: nowShot, at: { x, y } };

  for (const o of a.options) {
    if (o.status !== 'done' || !o.tiles?.length) continue;
    const tryId = `&art=review&try=${a.id}/${o.id}`;
    await open(tryId);
    // Give the swap a moment to install before baking.
    await page.waitForTimeout(800);
    const mapFile = `assets/${a.id}/${o.id}/map.png`;
    save(`${ROOT}/${mapFile}`, await wholeMap(t.map));
    const gameFile = `assets/${a.id}/${o.id}/ingame.png`;
    await open(`${tryId}&scene=field&map=${t.map}&x=${x}&y=${y}`);
    await page.waitForTimeout(2500);
    await page.locator('#screen').screenshot({ path: `${ROOT}/${gameFile}` });
    o.preview = { map: mapFile, game: gameFile };
    console.log(`  ${a.id}/${o.id}`);
  }
  // Written back into the asset's meta.json (the runner keeps fields it doesn't own).
  const path = `${ROOT}/assets/${a.id}/meta.json`;
  const now = JSON.parse(readFileSync(path, 'utf8'));
  now.preview = a.preview;
  for (const o of now.options) {
    const mine = a.options.find((x) => x.id === o.id);
    if (mine?.preview) o.preview = mine.preview;
  }
  writeFileSync(path, JSON.stringify(now, null, 1));
}
if (problems.length) console.log(`page errors:\n  ${problems.slice(0, 6).join('\n  ')}`);
console.log(`rendered ${assets.length} tilesets`);
await browser.close();
