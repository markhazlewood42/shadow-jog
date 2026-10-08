#!/usr/bin/env node
/**
 * Contact sheets for the 640x360 move: each baseline shot (480x270) beside its 640x360 shot, on
 * PNG pages with the shot names as labels. The pages are what Mark gets at each review
 * (docs/PIVOT-640.md, "Visual updates").
 *
 *   node scripts/contact-sheet.mjs <baselineDir> <resultDir> <outPrefix> [options]
 *
 * Two views:
 *   --view gamepx   (default) both pictures at the same zoom per game pixel (--zoom, default 1), so
 *                   the two viewports (960x540 and 1280x720) do not matter. The 640x360 picture is
 *                   simply larger, as the game is.
 *   --view 1080p    the baseline at 4x and the result at 3x: both fill a 1920x1080 screen, as on a
 *                   1080p monitor, so the art reads 25% smaller on the right.
 * Options:
 *   --base 480x270    the baseline's game size      --result 640x360   the result's game size
 *   --per-page N      pairs on one page (gamepx 8, 1080p 1)   --cols N   pair columns (gamepx 2, 1080p 1)
 *   --only a,b,c      only these shot names (no .png)
 *
 * Each shot is first brought back to game pixels (a 2x shot is sampled 2:1, which is exact for a
 * nearest-neighbor upscale), then drawn at the view's zoom with smoothing off, so every game pixel is
 * a clean block. Pages are written as <outPrefix>-01.png, -02.png, ... The drawing happens in a
 * headless browser page (Playwright's Chromium, or Edge locally), so no image package is needed.
 */
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

const HELP = `contact-sheet: pages that pair each baseline shot with its 640x360 shot.

  node scripts/contact-sheet.mjs <baselineDir> <resultDir> <outPrefix> [--view gamepx|1080p] [--zoom N]
                                 [--per-page N] [--cols N] [--only a,b,c] [--base 480x270] [--result 640x360]

Writes <outPrefix>-01.png, -02.png, ... Default view: gamepx (same zoom per game pixel, zoom 1).`;

const args = process.argv.slice(2);
const positional = [];
const opt = { view: 'gamepx', zoom: null, perPage: null, cols: null, only: null, base: '480x270', result: '640x360', help: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--view') opt.view = args[++i];
  else if (a === '--zoom') opt.zoom = Number(args[++i]);
  else if (a === '--per-page') opt.perPage = Number(args[++i]);
  else if (a === '--cols') opt.cols = Number(args[++i]);
  else if (a === '--only') opt.only = new Set(args[++i].split(','));
  else if (a === '--base') opt.base = args[++i];
  else if (a === '--result') opt.result = args[++i];
  else if (a === '--help' || a === '-h') opt.help = true;
  else positional.push(a);
}
if (opt.help || positional.length !== 3 || !['gamepx', '1080p'].includes(opt.view)) {
  console.log(HELP);
  process.exit(opt.help ? 0 : 2);
}
const [baseDir, resultDir, outPrefix] = positional;
for (const d of [baseDir, resultDir]) {
  if (!existsSync(d) || !statSync(d).isDirectory()) {
    console.error(`not a directory: ${d}`);
    process.exit(2);
  }
}

function parseSize(s, what) {
  const m = /^(\d+)x(\d+)$/.exec(s ?? '');
  if (!m) throw new Error(`${what}: expected WxH, got "${s}"`);
  return { w: Number(m[1]), h: Number(m[2]) };
}
const baseSize = parseSize(opt.base, '--base');
const resultSize = parseSize(opt.result, '--result');
const is1080 = opt.view === '1080p';
// Zoom per game pixel for each side. The 1080p view puts both on a 1920-wide screen.
const zoomBase = is1080 ? 1920 / baseSize.w : (opt.zoom ?? 1);
const zoomResult = is1080 ? 1920 / resultSize.w : (opt.zoom ?? 1);
const perPage = opt.perPage ?? (is1080 ? 1 : 8);
const cols = opt.cols ?? (is1080 ? 1 : 2);
if (![zoomBase, zoomResult].every((z) => Number.isInteger(z) && z >= 1)) {
  console.error(`the zoom per game pixel must be a whole number (base ${zoomBase}, result ${zoomResult})`);
  process.exit(2);
}

/** Every PNG under `dir`, as names relative to it, with forward slashes and no extension. */
function shotNames(root) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.png')) out.push(relative(root, p).split(sep).join('/').replace(/\.png$/i, ''));
    }
  };
  walk(root);
  return out.sort();
}

const baseNames = shotNames(baseDir), resultNames = new Set(shotNames(resultDir));
let names = [...new Set([...baseNames, ...resultNames])].sort();
if (opt.only) names = names.filter((n) => opt.only.has(n));
if (names.length === 0) {
  console.error('no shots to draw');
  process.exit(2);
}
const dataUrl = (file) => (existsSync(file) ? `data:image/png;base64,${readFileSync(file).toString('base64')}` : null);

const pages = [];
for (let i = 0; i < names.length; i += perPage) pages.push(names.slice(i, i + perPage));
const pad = String(pages.length).length < 2 ? 2 : String(pages.length).length;

const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'msedge' });
const page = await browser.newPage();
await page.setContent('<!doctype html><html><body style="margin:0;background:#222"><canvas id="sheet"></canvas></body></html>');

// The viewport a folder of shots came from, read from the PNG files themselves: the most common
// picture size among the shots that are a whole multiple of the game frame. Nothing is assumed
// about which viewport a capture used, so the caption stays true whatever --base and --result say.
function viewportOf(dir, names, size) {
  const counts = new Map();
  for (const n of names) {
    const f = join(dir, `${n}.png`);
    if (!existsSync(f)) continue;
    const head = readFileSync(f).subarray(0, 24); // 8-byte signature, then the IHDR chunk: width, height at 16 and 20
    const w = head.readUInt32BE(16), h = head.readUInt32BE(20), k = w / size.w;
    if (!Number.isInteger(k) || k < 1 || h !== size.h * k) continue;
    counts.set(`${w}x${h}`, (counts.get(`${w}x${h}`) ?? 0) + 1);
  }
  return [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'unknown size';
}
const baseView = viewportOf(baseDir, baseNames, baseSize), resultView = viewportOf(resultDir, [...resultNames], resultSize);
const shrink = Math.round((1 - zoomResult / zoomBase) * 100);
const header = is1080
  ? `Left: the baseline, ${baseSize.w}x${baseSize.h} at ${zoomBase}x. Right: the result, ${resultSize.w}x${resultSize.h} at ${zoomResult}x. Both fill a ${baseSize.w * zoomBase}x${baseSize.h * zoomBase} screen, as on a 1080p monitor${shrink > 0 ? `, so the art reads ${shrink}% smaller on the right` : shrink < 0 ? `, so the art reads ${-shrink}% larger on the right` : ''}.`
  : `Left: the baseline, ${baseSize.w}x${baseSize.h}. Right: the result, ${resultSize.w}x${resultSize.h}. Same zoom per game pixel (${zoomBase}x), so the right picture is larger, as the game is. Baseline shots come from a ${baseView} viewport, results from ${resultView}.`;

mkdirSync(dirname(outPrefix) || '.', { recursive: true });
for (const [pi, group] of pages.entries()) {
  const items = group.map((name) => ({
    name,
    base: dataUrl(join(baseDir, `${name}.png`)),
    result: dataUrl(join(resultDir, `${name}.png`)),
  }));
  const png = await page.evaluate(
    async ({ items, baseSize, resultSize, zoomBase, zoomResult, cols, header, pageLabel }) => {
      const load = (src) => new Promise((res, rej) => {
        if (!src) return res(null);
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => rej(new Error('image failed to load'));
        img.src = src;
      });
      /**
       * Bring a shot back to its game pixels: a 2x shot sampled 2:1 is exact for nearest-neighbor
       * art. Returns null for a picture that is not a whole multiple of the game frame (a sprite
       * sheet, a map overview), which is then drawn to fit instead.
       */
      const toGame = (img, size) => {
        const k = img.width / size.w;
        if (!Number.isInteger(k) || k < 1 || img.height !== size.h * k) return null;
        const c = document.createElement('canvas');
        c.width = size.w; c.height = size.h;
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = false;
        g.drawImage(img, 0, 0, size.w, size.h);
        return c;
      };
      /** Draw one shot at the view's zoom, or to fit when it is not a screen. Returns whether it was a screen. */
      const drawShot = (ctx, img, size, zoom, x, y) => {
        const g = toGame(img, size);
        if (g) {
          ctx.drawImage(g, x, y, size.w * zoom, size.h * zoom);
          return true;
        }
        const s = Math.min((size.w * zoom) / img.width, (size.h * zoom) / img.height, 1);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, x, y, Math.round(img.width * s), Math.round(img.height * s));
        ctx.imageSmoothingEnabled = false;
        return false;
      };
      const GAP = 16;
      const cellW = baseSize.w * zoomBase + GAP + resultSize.w * zoomResult;
      const pageW = GAP + cols * (cellW + GAP);
      // Labels scale with the page, so a 3840-wide 1080p page stays readable when zoomed out.
      const font = Math.max(15, Math.round(pageW / 130));
      const LABEL = font + 8, HEADER = font * 2 + 8;
      const cellH = Math.max(baseSize.h * zoomBase, resultSize.h * zoomResult) + LABEL;
      const rows = Math.ceil(items.length / cols);
      const canvas = document.getElementById('sheet');
      canvas.width = pageW;
      canvas.height = HEADER + rows * (cellH + GAP) + GAP;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#1e1e24';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#e8e8f0';
      ctx.font = `${font}px sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(`${pageLabel}  ${header}`, GAP, font / 2, canvas.width - 2 * GAP);
      for (const [i, it] of items.entries()) {
        const col = i % cols, row = Math.floor(i / cols);
        const x0 = GAP + col * (cellW + GAP), y0 = HEADER + row * (cellH + GAP);
        const [b, r] = await Promise.all([load(it.base), load(it.result)]);
        const y = y0 + LABEL;
        const rx = x0 + baseSize.w * zoomBase + GAP;
        const bScreen = b ? drawShot(ctx, b, baseSize, zoomBase, x0, y) : true;
        const rScreen = r ? drawShot(ctx, r, resultSize, zoomResult, rx, y) : true;
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${font}px sans-serif`;
        const notes = [b ? '' : '(no baseline)', r ? '' : '(no result)', bScreen && rScreen ? '' : '(not a screen: shown to fit)'].filter(Boolean).join('  ');
        ctx.fillText(`${it.name}${notes ? `  ${notes}` : ''}`, x0, y0 + 2, cellW);
        // A thin outline shows each picture's frame, so an empty void is still visible as a frame.
        ctx.strokeStyle = '#8888aa';
        ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 0.5, y + 0.5, baseSize.w * zoomBase - 1, baseSize.h * zoomBase - 1);
        ctx.strokeRect(rx + 0.5, y + 0.5, resultSize.w * zoomResult - 1, resultSize.h * zoomResult - 1);
      }
      return canvas.toDataURL('image/png').split(',')[1];
    },
    { items, baseSize, resultSize, zoomBase, zoomResult, cols, header, pageLabel: `Page ${pi + 1} of ${pages.length}.` },
  );
  const file = `${outPrefix}-${String(pi + 1).padStart(pad, '0')}.png`;
  writeFileSync(file, Buffer.from(png, 'base64'));
  console.log(`${file}  (${group.length} pair(s): ${group.join(', ')})`);
}
await browser.close();
