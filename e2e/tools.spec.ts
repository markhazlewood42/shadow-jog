/**
 * ET pass lines 4 and 5 (docs/engine/et-brief.md section 4): every tool opens in a browser, and the two write endpoints that had no dry run have one.
 *
 * One case for each tool. Each case judges a state (a count that comes from the data, a scene name, a canvas that is not one flat color), not only "no error".
 * Four tools get no case here because a named spec already opens them and judges a state: the engine lab (e2e/sje-canaries.spec.ts), the 3D entry (e2e/sje-hack-a to
 * -d), the field show hooks (e2e/sje-field.spec.ts) and the dev routes file (tests/devroutes-hack.test.ts, tests/devroutes-ticks.test.ts and the specs above). The FX lab
 * has e2e/fxlab.spec.ts (pass line 3 and line 14).
 *
 * Controls (a check that cannot fail proves nothing):
 *  - the DEV menu is absent without this file's `navigator.webdriver` override (the guard is real);
 *  - an unknown `?scene=` shows the title, not a viewer;
 *  - a bad body gets 400 with a problem, and the hash of the file is the same before and after a dry run.
 *
 * Held back (`test.fixme`) until the tool exists: the Battle Stage Editor (ET task 5, Builder B) and Battle Test (ET task 6, Builder C). Each one is listed in the commit
 * message of the step that holds it back. The person who builds the tool removes the `fixme` and adapts the element ids to the tool.
 *
 * Run:  PW_PORT=3012 npx playwright test e2e/tools.spec.ts --reporter=line
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { DEV_TOOLS } from '../src/dev/tools';
import { openGame, sj, waitTop, waitUntil } from './sjegamekit';
import { openStage } from './sjestagekit';

const ROOT = join(import.meta.dirname, '..');

/** The hash of a file, or 'absent'. `media/` is git-ignored, so a hash is the only way to see that a run left it alone. */
function hashOf(rel: string): string {
  const p = join(ROOT, rel);
  return existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : 'absent';
}

/** How many different colors the game's back buffer shows (every 7th pixel: enough to tell a picture from a flat color). */
async function colorCount(page: Page): Promise<number> {
  return sj<number>(page, '(() => { const p = sj.pixels(); const s = new Set(); for (let i = 0; i < p.data.length; i += 28) s.add((p.data[i] << 16) | (p.data[i + 1] << 8) | p.data[i + 2]); return s.size; })()');
}

test.describe('the DEV menu (tool 1)', () => {
  test('control: without the webdriver override the menu is not mounted (the guard is real)', async ({ browser }) => {
    const g = await openGame(browser);
    try {
      expect(await waitTop(g.page, 'TitleScene')).toBe(true);
      expect(await g.page.evaluate(() => navigator.webdriver)).toBe(true);
      await g.page.waitForTimeout(500);
      expect(await g.page.locator('#devmenu-tab').count()).toBe(0);
      expect(await g.page.locator('#devmenu').count()).toBe(0);
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });

  test('with the override the tab mounts, and the open menu lists every tool of src/dev/tools.ts and a picker for each tool that takes a choice', async ({ browser }) => {
    const g = await openGame(browser, { query: '&devmenu', init: () => Object.defineProperty(navigator, 'webdriver', { get: () => false }) });
    try {
      await expect(g.page.locator('#devmenu-tab')).toBeVisible({ timeout: 30_000 });
      await expect(g.page.locator('#devmenu')).toBeVisible();
      const tools = DEV_TOOLS.flatMap((group) => group.tools);
      expect(await g.page.locator('#devmenu a').count()).toBe(tools.length);
      expect(await g.page.locator('#devmenu > label.pick select').count()).toBe(tools.filter((t) => t.pick).length);
      expect(await g.page.locator('#devmenu > h2').allTextContents()).toEqual(DEV_TOOLS.map((group) => group.group));
      // The effects section of the new engine (src/sje-lab/fxpanel.ts) is in the menu too: a level picker and buttons that fire effects.
      await expect(g.page.locator('#devmenu-fx')).toBeVisible();
      expect(await g.page.locator('#devmenu-fx button').count()).toBeGreaterThan(0);
      // The FX lab link goes where the list says, and the menu closes on Escape.
      const hrefs = await g.page.locator('#devmenu a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
      expect(hrefs).toContain('/?scene=fxlab');
      await g.page.keyboard.press('Escape');
      await expect(g.page.locator('#devmenu')).toBeHidden();
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });
});

test('the animation editor (/rigedit.html) opens with the crew from skeleton.json, draws the figure and switches a pose', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  await page.goto('/rigedit.html');
  const skeletons = (await (await page.request.get('/__rig/skeleton')).json()) as { ok: boolean; data: Record<string, unknown> };
  expect(skeletons.ok).toBe(true);
  const ids = Object.keys(skeletons.data);
  expect(ids.length).toBeGreaterThan(0);
  const crew = page.locator('#who button');
  await expect(crew.first()).toBeVisible({ timeout: 30_000 });
  // One button for each crew member whose skeleton has traced frames: never more than the file holds.
  const n = await crew.count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThanOrEqual(ids.length);
  // The editing canvas holds a drawing (not one flat color).
  const colors = await page.evaluate(() => {
    const c = document.getElementById('edit') as HTMLCanvasElement;
    const d = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set<number>();
    if (d) for (let i = 0; i < d.length; i += 16) seen.add(((d[i] ?? 0) << 16) | ((d[i + 1] ?? 0) << 8) | (d[i + 2] ?? 0) | ((d[i + 3] ?? 0) << 24));
    return seen.size;
  });
  expect(colors).toBeGreaterThan(2);
  // A pose button takes the highlight when it is clicked: the editor changed its state.
  const poses = page.locator('#pose button');
  expect(await poses.count()).toBeGreaterThan(1);
  const other = poses.nth((await poses.evaluateAll((bs) => bs.findIndex((b) => b.classList.contains('on')))) === 0 ? 1 : 0);
  await other.click();
  await expect(other).toHaveClass(/\bon\b/);
  // Nothing was saved by looking: the status line has no "Saved".
  await expect(page.locator('#status')).not.toContainText('Saved');
  expect(problems).toEqual([]);
});

test('art review (/artreview.html) lists the code-drawn assets that the dev endpoint reports, and says nothing is wrong', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  await page.goto('/artreview.html');
  await expect(page.locator('#status')).not.toHaveText('Loading…', { timeout: 30_000 });
  await expect(page.locator('#status')).not.toContainText('Couldn’t load');
  const body = (await (await page.request.get('/__artpass/data')).json()) as { ok: boolean; assets: Array<{ category: string }> };
  expect(body.ok).toBe(true);
  // The page shows the code-drawn ("Rig v2") assets; the PixelLab archive is hidden unless asked for. The count in the nav is the count in the data.
  const expected = body.assets.filter((a) => a.category.startsWith('Rig v2')).length;
  expect(expected, 'the dev endpoint reports at least one Rig v2 asset').toBeGreaterThan(0);
  await expect(page.locator('#nav a')).toHaveCount(expected);
  await expect(page.locator('#main .intro')).toBeVisible();
  await expect(page.locator('#trypicks')).toHaveAttribute('href', '/?debug&art=review');
  expect(problems).toEqual([]);
});

test.describe('art swap (?art=review)', () => {
  test('a pick that is not generated is named in a notice (the swap ran and reported)', async ({ browser }) => {
    const g = await openGame(browser, { query: '&art=review&try=zz.none/x' });
    try {
      expect(await waitUntil(g.page, '!!sj.notice() && /swap in/.test(sj.notice().text)', 40_000)).toBe(true);
      const n = await sj<{ text: string; tone: string }>(g.page, 'sj.notice()');
      expect(n.text).toBe("Couldn't swap in: zz.none/x (not generated)");
      expect(n.tone).toBe('warn');
      expect(await waitTop(g.page, 'TitleScene')).toBe(true);
    } finally {
      await g.close();
    }
  });

  test("with no list, the swap takes Mark's picks and says how many it found (none on a machine without media/art-pass)", async ({ browser }) => {
    const g = await openGame(browser, { query: '&art=review' });
    try {
      expect(await waitUntil(g.page, '!!sj.notice() && /art-pass|swap in/.test(sj.notice().text)', 40_000)).toBe(true);
      const n = await sj<{ text: string }>(g.page, 'sj.notice()');
      expect(n.text).toMatch(/^(No art-pass picks to try yet|Trying art-pass picks: |Couldn't swap in: )/);
      expect(await waitTop(g.page, 'TitleScene')).toBe(true);
    } finally {
      await g.close();
    }
  });
});

test.describe('the five art viewers (?scene=)', () => {
  const VIEWERS: Array<[route: string, scene: string]> = [
    ['mapview&map=lantern_row', 'MapViewScene'],
    ['chars&zoom=4', 'CharTestScene'],
    ['portraits', 'PortraitTestScene'],
    ['bestiary', 'BestiaryTestScene'],
    ['font', 'FontTestScene'],
  ];
  for (const [route, scene] of VIEWERS) {
    test(`?scene=${route} runs ${scene} and draws a picture`, async ({ browser }) => {
      const g = await openGame(browser, { query: `&scene=${route}` });
      try {
        expect(await waitTop(g.page, scene)).toBe(true);
        await g.page.waitForTimeout(400);
        expect(await colorCount(g.page)).toBeGreaterThan(6);
        expect(g.problems).toEqual([]);
      } finally {
        await g.close();
      }
    });
  }

  test('control: an unknown ?scene= shows the title, not a viewer', async ({ browser }) => {
    const g = await openGame(browser, { query: '&scene=nope' });
    try {
      expect(await waitTop(g.page, 'TitleScene')).toBe(true);
      expect(await sj<string>(g.page, 'sj.top()')).not.toMatch(/Test$|^MapView/);
    } finally {
      await g.close();
    }
  });
});

test('the stage lab (/sjestage.html) opens a stage at the game screen size and draws it', async ({ browser }) => {
  const lab = await openStage(browser);
  try {
    const info = await lab.page.evaluate(() => window.__SJESTAGE__?.info());
    expect(info?.w).toBe(640);
    expect(info?.h).toBe(360);
    await lab.page.evaluate(() => window.__SJESTAGE__?.show({ tick: 3 }));
    const colors = await lab.page.evaluate(() => {
      const p = window.__SJESTAGE__?.pixels();
      if (!p) return 0;
      const raw = atob(p.base64);
      const seen = new Set<number>();
      for (let i = 0; i < raw.length; i += 28) seen.add((raw.charCodeAt(i) << 16) | (raw.charCodeAt(i + 1) << 8) | raw.charCodeAt(i + 2));
      return seen.size;
    });
    expect(colors).toBeGreaterThan(10);
    // The scene moves with the tick counter: the hook's tick is the number of ticks run.
    expect(await lab.page.evaluate(() => window.__SJESTAGE__?.tick())).toBe(3);
    expect(lab.problems).toEqual([]);
  } finally {
    await lab.close();
  }
});

// ---- held back until the tool exists ------------------------------------------------------------------------------------------------------------------------------

test.describe('the Battle Stage Editor (/stageedit.html)', () => {
  // Held back: ET task 5 (Builder B) builds the page. Remove the fixme and adapt the ids to the page.
  test.fixme('opens with the stages of the 640 set, draws the stage canvas, and starts with nothing unsaved', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(m.text());
    });
    await page.goto('/stageedit.html');
    const files = (await (await page.request.get('/__stage/stages')).json()) as { ok: boolean; stages?: Record<string, unknown> };
    expect(files.ok).toBe(true);
    const ids = Object.keys(files.stages ?? {});
    expect(ids.length).toBeGreaterThan(0);
    await expect(page.locator('#stage-list option, #stage-list button')).toHaveCount(ids.length);
    await expect(page.locator('canvas').first()).toBeVisible();
    await expect(page.locator('#status')).not.toContainText('Unsaved');
    expect(problems).toEqual([]);
  });
});

test.describe('Battle Test (from the Battle Stage Editor)', () => {
  // Held back: ET task 6 (Builder C) builds it. It runs the game's own BattleScene over the editor's stage (decision 2, option B).
  test.fixme('Start runs a fight on the unsaved stage: the slot is where the edit put it, and Esc returns to the editor', async ({ page }) => {
    await page.goto('/stageedit.html');
    await page.getByRole('button', { name: /Battle Test/ }).click();
    await page.getByRole('button', { name: /Start/ }).click();
    expect(await waitUntil(page, '!!sj.battleStage', 30_000)).toBe(true);
    await page.keyboard.press('Escape');
    expect(await waitUntil(page, 'sj.battleStage === null', 30_000)).toBe(true);
  });
});

// ---- pass line 5: the dry runs --------------------------------------------------------------------------------------------------------------------------------------

test.describe('the dry run of the animation editor save (POST /__rig/skeleton?dry=1)', () => {
  const FILE = 'public/art/rig/skeleton.json';

  test('a good body is checked and not written: the answer says dry, and the file hash is the same before and after', async ({ request }) => {
    const before = hashOf(FILE);
    const got = (await (await request.get('/__rig/skeleton')).json()) as { ok: boolean; data: Record<string, unknown> };
    expect(got.ok).toBe(true);
    // The same skeletons in the opposite key order: valid, and different bytes if it were written.
    const body = Object.fromEntries(Object.entries(got.data).reverse());
    expect(Object.keys(body)).not.toEqual(Object.keys(got.data));
    const r = await request.post('/__rig/skeleton?dry=1', { data: JSON.stringify(body) });
    expect(r.status()).toBe(200);
    expect(await r.json()).toEqual({ ok: true, dry: true });
    expect(hashOf(FILE)).toBe(before);
  });

  test('control: a bad body gets 400 with a problem, with and without the dry flag, and nothing is written', async ({ request }) => {
    const before = hashOf(FILE);
    for (const url of ['/__rig/skeleton?dry=1', '/__rig/skeleton']) {
      const empty = await request.post(url, { data: '{}' });
      expect(empty.status(), url).toBe(400);
      const j = (await empty.json()) as { ok: boolean; problem: string };
      expect(j.ok).toBe(false);
      expect(j.problem).toMatch(/no skeletons/);
      // A partial body would drop a skeleton the file has: refused, dry or not.
      const got = (await (await request.get('/__rig/skeleton')).json()) as { data: Record<string, unknown> };
      const [dropped, ...rest] = Object.keys(got.data);
      const partial = await request.post(url, { data: JSON.stringify(Object.fromEntries(rest.map((k) => [k, got.data[k]]))) });
      expect(partial.status(), url).toBe(400);
      expect(((await partial.json()) as { problem: string }).problem).toContain(`would remove ${dropped}`);
      const broken = await request.post(url, { data: 'not json' });
      expect(broken.status(), url).toBe(400);
      expect(((await broken.json()) as { problem: string }).problem).toMatch(/not valid JSON/);
    }
    expect(hashOf(FILE)).toBe(before);
  });

  test('control: a cross-site post is refused (403), dry or not', async ({ request }) => {
    const before = hashOf(FILE);
    for (const url of ['/__rig/skeleton?dry=1', '/__rig/skeleton']) {
      const r = await request.post(url, { data: '{}', headers: { 'Sec-Fetch-Site': 'cross-site' } });
      expect(r.status(), url).toBe(403);
    }
    expect(hashOf(FILE)).toBe(before);
  });
});

test.describe('the dry run of the art review save (POST /__artpass/review?dry=1)', () => {
  const FILE = 'media/art-pass/review.json';

  test('a good body is checked and not written, even on a machine with no media/art-pass: the answer says dry, and the file hash is the same', async ({ request }) => {
    const before = hashOf(FILE);
    const r = await request.post('/__artpass/review?dry=1', { data: JSON.stringify({ assets: { 'zz.dry-run-probe': { options: { x: { verdict: 'good' } } } } }) });
    expect(r.status()).toBe(200);
    expect(await r.json()).toEqual({ ok: true, dry: true });
    expect(hashOf(FILE)).toBe(before);
  });

  test('control: a bad body gets 400 with a problem, with and without the dry flag, and nothing is written', async ({ request }) => {
    const before = hashOf(FILE);
    for (const url of ['/__artpass/review?dry=1', '/__artpass/review']) {
      for (const data of ['{}', JSON.stringify({ assets: 5 }), 'not json']) {
        const r = await request.post(url, { data });
        expect(r.status(), `${url} ${data}`).toBe(400);
        const j = (await r.json()) as { ok: boolean; problem: string };
        expect(j.ok).toBe(false);
        expect(j.problem.length).toBeGreaterThan(0);
      }
    }
    expect(hashOf(FILE)).toBe(before);
  });

  test('control: a cross-site post is refused (403), dry or not', async ({ request }) => {
    const before = hashOf(FILE);
    for (const url of ['/__artpass/review?dry=1', '/__artpass/review']) {
      const r = await request.post(url, { data: JSON.stringify({ assets: {} }), headers: { 'Sec-Fetch-Site': 'cross-site' } });
      expect(r.status(), url).toBe(403);
    }
    expect(hashOf(FILE)).toBe(before);
  });
});
