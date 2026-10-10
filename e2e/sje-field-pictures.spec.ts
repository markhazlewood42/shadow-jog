/**
 * M5 checkpoint 1: the lighting pictures for Mark (docs/engine/m5-brief.md pass line 12 and 15). LOCAL ONLY: it does nothing unless `M5_PICTURES=1`, and it is not in the CI list (it
 * writes files and judges nothing).
 *
 *   M5_PICTURES=1 PW_PORT=3011 npx playwright test e2e/sje-field-pictures.spec.ts --reporter=line      (Edge on the GPU: the `gpu` set)
 *   M5_PICTURES=1 CI=1 PW_PORT=3011 npx playwright test e2e/sje-field-pictures.spec.ts --reporter=line (the bundled Chromium on SwiftShader: the `soft` set)
 *
 * Each case is one moment of the field, made twice by the same script on a page with a fake clock (so both run the same ticks): `old` is the game without the flag (the
 * Canvas 2D field), `new` is the field on the stage under `?engine=sje`. The pair holds every pixel of the field: the baked layers, the light map, the lit sprites, the haze.
 *
 *   world-night / world-day   the world map at its shipped ambient, and with the ambient lifted (the game has no clock: "night" is the map's own ambient, "day" an override)
 *   rustyard                  the lot: lit by a barrel fire and lamps, a map smaller than the screen (its themed surround)
 *   bar                       a small interior (its edge-fill surround and the warm lamps)
 *   rain-on / rain-off        Lantern Row with its rain and without (`weather` set to none before the map's first bake)
 *
 * Pictures go to media/m5-field/<kind>/<case>-<old|new>.png (git-ignored) and `media/m5-field/<kind>/index.html` lays each pair out with its pixel difference.
 * Not a test of behavior: sje-field.spec.ts is.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { type Browser, type Page, test } from '@playwright/test';
import { advance, decode, diff, openGame } from './sjegamekit';

const ON = process.env.M5_PICTURES === '1';
const KIND = process.env.CI ? 'soft' : 'gpu';
const DIR = `media/m5-field/${KIND}`;
/** The ambient of "day": a lifted, nearly white color. The game has no clock, so this is an override for the picture only. */
const DAY = '#e6e2f2';

interface Case {
  id: string;
  map: string;
  note: string;
  weather?: 'rain' | 'none';
  ambient?: string;
}

const CASES: Case[] = [
  { id: 'world-night', map: 'world', note: 'the world map at its shipped ambient' },
  { id: 'world-day', map: 'world', ambient: DAY, note: 'the world map, ambient lifted to a day color' },
  { id: 'rustyard', map: 'rustyard', note: 'the Rustyard: barrel fire, lamps, a themed surround' },
  { id: 'bar', map: 'bar', note: 'a small interior with its edge-fill surround' },
  { id: 'rain-on', map: 'lantern_row', note: 'Lantern Row with its rain' },
  { id: 'rain-off', map: 'lantern_row', weather: 'none', note: 'Lantern Row without rain (the wet streets are not baked either)' },
];

/** Where a warp into this map puts the leader: the first warp in any map file that leads here. */
function entryOf(map: string): { x: number; y: number; dir: string } {
  for (const f of readdirSync('src/data/maps')) {
    if (!f.endsWith('.json')) continue;
    const j = JSON.parse(readFileSync(`src/data/maps/${f}`, 'utf8')) as { warps?: Array<{ to: string; tx: number; ty: number; dir?: string }>; maps?: unknown };
    for (const w of j.warps ?? []) if (w.to === map) return { x: w.tx, y: w.ty, dir: w.dir ?? 'down' };
  }
  throw new Error(`no warp leads to ${map}`);
}

/** Step the fake clock until the expression is true (the page's own timers do not run on their own). */
async function until(page: Page, expr: string, ms = 20_000): Promise<boolean> {
  for (let t = 0; t < ms; t += 100) {
    if (await page.evaluate(`(() => { const sj = window.__SJ__; try { return !!(${expr}); } catch { return false; } })()`)) return true;
    await advance(page, 100);
    await page.waitForTimeout(20);
  }
  return false;
}

/** One picture of a case, on the old path or the new one. */
async function shoot(browser: Browser, c: Case, engine: boolean): Promise<Buffer> {
  const g = await openGame(browser, { engine, fakeClock: true });
  try {
    if (!(await until(g.page, 'sj.top() === "TitleScene"'))) throw new Error('no title');
    // Map data a tool may change, before the map's first bake.
    await g.page.evaluate(
      async ({ map, weather, ambient }) => {
        // The page's own copy of the registry (the dev server serves one module per URL): a variable keeps the type checker from looking for the URL on disk.
        const url = '/src/data/maps/index.ts';
        const m = (await import(/* @vite-ignore */ url)) as { getMap(id: string): { weather?: string; ambient: string } };
        const def = m.getMap(map);
        if (weather) def.weather = weather;
        if (ambient) def.ambient = ambient;
        // The town is the first map the stage loads: patch it too when the case is about it.
      },
      { map: c.map, weather: c.weather ?? null, ambient: c.ambient ?? null },
    );
    await g.page.evaluate("(void window.__SJ__.stage('town'), 0)");
    if (!(await until(g.page, 'sj.top() === "FieldScene" && sj.idle()'))) throw new Error('no field');
    if (c.map !== 'lantern_row') {
      const e = entryOf(c.map);
      await g.page.evaluate(`(void window.__SJ__.tp(${JSON.stringify(c.map)}, ${e.x}, ${e.y}, ${JSON.stringify(e.dir)}), 0)`);
      if (!(await until(g.page, `sj.field() && sj.field().def.id === ${JSON.stringify(c.map)} && sj.idle()`))) throw new Error(`no warp to ${c.map}`);
    }
    // The banner of the area is on for 200 ticks; wait it out so the picture is the field. 500 ticks is 8.3 s of game time.
    await advance(g.page, 8400);
    await g.page.waitForTimeout(200);
    if (engine && !(await until(g.page, 'sj.fieldStage !== null'))) throw new Error('the stage did not open');
    const png = await g.page.locator('canvas').first().screenshot();
    if (g.problems.length > 0) console.log(`[${c.id} ${engine ? 'new' : 'old'}] problems: ${g.problems.join(' | ')}`);
    return png;
  } finally {
    await g.close();
  }
}

test.describe('field lighting pictures (M5 checkpoint 1)', () => {
  test.skip(!ON, 'local only: set M5_PICTURES=1');
  test.setTimeout(900_000);

  test('old against new', async ({ browser }) => {
    mkdirSync(DIR, { recursive: true });
    const rows: string[] = [];
    for (const c of CASES) {
      const old = await shoot(browser, c, false);
      const now = await shoot(browser, c, true);
      writeFileSync(`${DIR}/${c.id}-old.png`, old);
      writeFileSync(`${DIR}/${c.id}-new.png`, now);
      const d = diff(decode(old), decode(now));
      console.log(`${c.id}: ${d.differing} of ${(d.differing / Math.max(d.ratio, 1e-9)).toFixed(0)} pixels differ (${(d.ratio * 100).toFixed(2)}%)`);
      rows.push(`<tr><td colspan="2"><b>${c.id}</b>: ${c.note}. ${(d.ratio * 100).toFixed(2)}% of pixels differ.</td></tr><tr><td><img src="${c.id}-old.png" width="640"><br>old</td><td><img src="${c.id}-new.png" width="640"><br>new</td></tr>`);
    }
    writeFileSync(`${DIR}/index.html`, `<!doctype html><meta charset="utf-8"><title>M5 field lighting, old against new (${KIND})</title><body style="background:#111;color:#ddd;font:14px sans-serif"><table>${rows.join('')}</table>`);
  });
});
