/**
 * Full Chapter 1 playthrough: every story beat, driven through the real scripts with
 * dialogs and battles auto-resolved. Catches softlocks, broken warps and script errors.
 */
import { expect, test } from '@playwright/test';
import { playChapter1, sj, waitFor } from './route';

test('Chapter 1 can be played start to finish', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?debug');
  await page.waitForTimeout(800);
  await sj(page, 'Object.assign(sj.debug, { autoDialog: true, autoBattle: true })');
  await sj(page, 'sj.newGame()');
  await playChapter1(page);
  await waitFor(page, "sj.top() === 'TitleScene'", 'back to title', 40_000);
  expect(errors).toEqual([]);
});
