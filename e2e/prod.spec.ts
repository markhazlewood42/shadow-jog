/**
 * The shipped build (`vite build` served by `vite preview`), driven by keyboard only: there is no
 * debug API in production. Boots clean, starts a new game, saves from the menu, survives a reload,
 * and continues from that save.
 */
import { expect, test, type Page } from '@playwright/test';

const PROD = 'http://localhost:3008';

async function key(page: Page, k: string, n = 1, gap = 220): Promise<void> {
  for (let i = 0; i < n; i++) {
    await page.keyboard.down(k);
    await page.waitForTimeout(50);
    await page.keyboard.up(k);
    await page.waitForTimeout(gap);
  }
}

async function frame(page: Page): Promise<Buffer> {
  return page.locator('#screen').screenshot();
}

test('production build: new game, save, reload, continue, with no errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(PROD);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
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
