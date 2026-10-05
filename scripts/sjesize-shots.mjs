// Pictures of the engine lab at 640x360 (step S1a): the 3D test scene with its HUD, and the lab's 2D scene.
//
//   node scripts/sjesize-shots.mjs <out folder> [size]      size is 640x360 (default) or 480x270
//
// Needs the dev server on port 3007 (`npm run dev`). Each picture is a screenshot of the page in a window of exactly twice the picture
// (zoom 2, device pixel ratio 1), so the file is the picture at 2x with no bars and no resampling: 1280x720 for 640x360.
// The scenes are the ones the specs use: the 3D scene is the hack of `e2e/sje3d.spec.ts` (seed 7, HUD on) stopped at tick 120; the 2D scene
// is the lab's own scene (`src/sje-lab/lab.ts`) stopped at tick 333. Both are driven by hand (`?manual`), so a second run gives the same bytes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const out = process.argv[2];
const size = process.argv[3] ?? '640x360';
if (!out || !/^(640x360|480x270)$/.test(size)) {
  console.error('usage: node scripts/sjesize-shots.mjs <out folder> [640x360|480x270]');
  process.exit(2);
}
const [w, h] = size.split('x').map(Number);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: w * 2, height: h * 2 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const problems = [];
page.on('console', (m) => {
  if ((m.type() === 'error' || m.type() === 'warning') && !/GPU stall|WebSocket connection/.test(m.text())) problems.push(m.text());
});
page.on('pageerror', (e) => problems.push(String(e)));
const query = size === '640x360' ? 'manual&size=640x360' : 'manual';
await page.goto(`http://localhost:3007/sjelab.html?${query}`);
await page.waitForFunction(() => window.__SJE__ !== undefined || window.__SJE_ERROR__ !== undefined, null, { timeout: 90_000 });
const error = await page.evaluate(() => window.__SJE_ERROR__);
if (error) throw new Error(`the lab failed to start: ${error}`);

// The lab's 2D scene.
await page.evaluate(() => {
  const hook = window.__SJE__;
  hook.step(333 - hook.tick());
});
const info = await page.evaluate(() => window.__SJE__.info());
if (info.w !== w || info.h !== h || info.k !== 2) throw new Error(`expected a ${w}x${h} picture at zoom 2, got ${JSON.stringify(info)}`);
writeFileSync(join(out, `lab-2d-${size}.png`), await page.screenshot());

// The 3D test scene, with its HUD.
await page.evaluate(() => {
  const hook = window.__SJE__;
  hook.hackHud(true);
  hook.hackStart({ seed: 7, ticks: 900 });
});
await page.waitForFunction(() => window.__SJE__.scenes().includes('HackScene'), null, { timeout: 60_000 });
await page.evaluate(() => {
  const hook = window.__SJE__;
  hook.step(120 - (hook.sim()?.tick ?? 0));
});
writeFileSync(join(out, `hack-3d-hud-${size}.png`), await page.screenshot());
console.log(JSON.stringify({ size, info: { w: info.w, h: info.h, k: info.k, renderer: info.renderer }, problems }));
await browser.close();
if (problems.length) process.exit(1);
