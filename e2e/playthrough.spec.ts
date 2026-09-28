/**
 * Full Chapter 1 playthrough: every story beat, driven through the real scripts with
 * dialogs and battles auto-resolved. Catches softlocks, broken warps and script errors.
 */
import { expect, test } from '@playwright/test';
import { playChapter1, sj, waitFor } from './route';

test('Chapter 1 can be played start to finish', async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?debug');
  await page.waitForTimeout(800);
  await sj(page, 'Object.assign(sj.debug, { autoDialog: true, autoBattle: true })');
  await sj(page, 'sj.newGame()');
  // Before the dock, dialogs go back to lingering (the playtest driver), so the results screen
  // of this driven run stays up long enough to capture: evidence of what the systems actually
  // produce (the screenshot set's own ending shot uses a preset stage).
  await playChapter1(page, () => sj(page, 'Object.assign(sj.debug, { autoDialog: false, playtest: true })'));
  await waitFor(page, "sj.top() === 'EndingScene'", 'results screen', 120_000);
  await page.waitForTimeout(2600);
  await page.locator('#screen').screenshot({ path: 'docs/screenshots/24c-ending-results-playthrough.png' });
  await waitFor(page, "sj.top() === 'TitleScene'", 'back to title', 60_000);
  expect(errors).toEqual([]);
});
