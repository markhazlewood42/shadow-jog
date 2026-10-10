/**
 * The shipped build (`vite build` served by `vite preview`), driven by keyboard only: there is no
 * debug API in production. Boots clean, starts a new game, saves from the menu, survives a reload,
 * and continues from that save; and closing the tab with unsaved progress asks first.
 */
import { expect, test, type Page } from '@playwright/test';
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
