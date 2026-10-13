/**
 * The shipped build (`vite build` served by `vite preview`), driven by keyboard only: there is no
 * debug API in production. Boots clean, starts a new game, saves from the menu, survives a reload,
 * and continues from that save; and closing the tab with unsaved progress asks first.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { chunk3dRequests } from './sjegamekit';
import { E5_TEXT, expectE5Contract, skipGameFlowOnFirefox } from './webgl2kit';

const PROD = 'http://localhost:3008';

// Firefox on CI has no WebGL 2: it meets the E5 message, not a game (the E5 test below).
skipGameFlowOnFirefox();

async function key(page: Page, k: string, n = 1, gap = 220): Promise<void> {
  for (let i = 0; i < n; i++) {
    await page.keyboard.down(k);
    await page.waitForTimeout(50);
    await page.keyboard.up(k);
    await page.waitForTimeout(gap);
  }
}

/**
 * Open the shipped build with empty storage. The game starts asynchronously (the engine chunk, then the renderer), and it fetches its battle chunk ahead (`systems.ts`
 * `loadBattle`): a reload while those are in flight aborts them, and WebKit reports the aborted `import()` as an unhandled rejection that this spec would count as a fault. So wait for the
 * game to be running and for the network to be quiet first.
 */
async function openFresh(page: Page): Promise<void> {
  await page.goto(PROD);
  await page.waitForFunction(() => (window as unknown as { __sjStarted?: boolean }).__sjStarted === true, null, { timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

async function frame(page: Page): Promise<Buffer> {
  return page.locator('canvas').first().screenshot();
}

test('production build: new game, save, reload, continue, with no errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await openFresh(page);
  await page.waitForTimeout(1500);
  // The debug hook is dev-only.
  expect(await page.evaluate(() => 'SJ' in window || '__SJ__' in window)).toBe(false);

  // Title: any key, then New Game (the only enabled entry with no saves).
  const title = await frame(page);
  await key(page, 'Enter');
  await page.waitForTimeout(400);
  await key(page, 'Enter');
  await page.waitForTimeout(1500);
  expect((await frame(page)).equals(title)).toBe(false);

  // Skip the opening panels, then read through the first scene's dialogue.
  await key(page, 'x');
  await page.waitForTimeout(1200);
  await key(page, 'z', 60, 160);

  // Menu → Save → slot 1.
  await key(page, 'Escape');
  await page.waitForTimeout(400);
  await key(page, 'ArrowDown', 7);
  await key(page, 'Enter');
  await page.waitForTimeout(300);
  await key(page, 'Enter');
  await page.waitForTimeout(900);
  const saved = await page.evaluate(() => localStorage.getItem('shadowjog.save.1'));
  expect(saved, 'slot 1 written from the in-game menu').toBeTruthy();

  // Reload: Continue is offered and loads the save into the field.
  await page.reload();
  await page.waitForTimeout(1500);
  await key(page, 'Enter');
  await page.waitForTimeout(400);
  const menu = await frame(page);
  await key(page, 'Enter'); // Continue is pre-selected when a good save exists
  await page.waitForTimeout(2000);
  expect((await frame(page)).equals(menu)).toBe(false);

  expect(errors).toEqual([]);
});

test('production build: closing the tab with unsaved progress asks first', async ({ page }) => {
  await openFresh(page);
  await page.waitForTimeout(1500);
  await key(page, 'Enter');
  await page.waitForTimeout(400);
  await key(page, 'Enter');
  await page.waitForTimeout(1500);
  await key(page, 'x');
  await page.waitForTimeout(1200);
  await key(page, 'z', 60, 160);
  // Past the 30 s of unsaved play the prompt waits for (no autosave fires this early).
  await page.waitForTimeout(32_000);
  const dialog = page.waitForEvent('dialog');
  await page.close({ runBeforeUnload: true });
  const d = await dialog;
  expect(d.type()).toBe('beforeunload');
  await d.accept();
});

test('the 3D chunk: a normal run never requests it, and the hashed chunk loads from the shipped build by its manifest name (M7 pass line 14; a wrong name rejects)', async ({ page }) => {
  // The name comes from the manifest of the build that the preview server serves (`playwright.config.ts` builds it fresh), so a renamed or missing chunk fails here.
  const manifest = JSON.parse(readFileSync('dist/.vite/manifest.json', 'utf8')) as Record<string, { file: string; src?: string }>;
  const entry = Object.values(manifest).find((c) => c.src === 'src/hack3d/index.ts');
  expect(entry?.file, 'the manifest has the 3D chunk').toMatch(/^assets\/hack3d-[\w-]+\.js$/);
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await openFresh(page);
  await page.waitForTimeout(1500);
  expect(chunk3dRequests(requests), 'a player who never hacks does not request the 3D chunk').toEqual([]);
  const url = new URL(entry?.file ?? '', `${PROD}/`).href;
  // The chunk is a module: load it as the door does (a dynamic import). It exports the door's entry and the scene.
  const exports = await page.evaluate(async (u) => {
    const m = (await import(/* @vite-ignore */ u)) as Record<string, unknown>;
    return { startHack: typeof m.startHack, HackScene: typeof m.HackScene, HackSim: typeof m.HackSim };
  }, url);
  expect(exports).toEqual({ startHack: 'function', HackScene: 'function', HackSim: 'function' });
  expect(chunk3dRequests(requests).some((u) => u === url), 'the chunk was requested by its hashed name').toBe(true);
  // Control: a wrong name makes the import reject (so the check above can fail).
  const wrong = await page.evaluate(async (u) => {
    try {
      await import(/* @vite-ignore */ u);
      return 'loaded';
    } catch {
      return 'rejected';
    }
  }, url.replace('assets/hack3d-', 'assets/hack3d-nope-'));
  expect(wrong).toBe('rejected');
});

test('E5: the shipped build shows the message in a browser without WebGL 2 (and only there)', async ({ page }) => {
  await expectE5Contract(page, PROD);
});

test('E5: the shipped build shows the message when WebGL 2 is blocked, and no game starts (the test double of a browser without WebGL 2)', async ({ page }) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2') return null;
      return (get as (this: HTMLCanvasElement, t: string, ...r: unknown[]) => RenderingContext | null).call(this, type, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto(PROD);
  const boot = page.locator('#boot');
  await expect(boot).toHaveClass(/error/, { timeout: 30_000 });
  await expect(boot).toBeVisible();
  await expect(boot).toContainText(E5_TEXT);
  expect(await page.evaluate(() => (window as unknown as { __sjStarted?: boolean }).__sjStarted === true)).toBe(false);
});
