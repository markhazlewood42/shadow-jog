/**
 * E5 (docs/engine/decisions.md): a browser without WebGL 2 gets a message and no game. The shared checks of `prod.spec.ts` and `gameover.spec.ts`, which run on WebKit and
 * Firefox as well (`playwright.config.ts`). Headless Firefox on the CI image has no WebGL 2, so the game flow is skipped there by `browserName` and this check runs instead.
 */
import { expect, type Page, test } from '@playwright/test';

/** The text of `Game.create` (src/sje/runtime/glrenderer.ts) that `main.ts` `fail()` shows under "SHADOW JOG failed to start." */
export const E5_TEXT = /This browser cannot run WebGL 2/;
/** The one hint line under it (decision 2 of the M6 brief). */
export const E5_HINT = "Your browser’s WebGL 2 may be turned off in its settings.";

/** Does this browser give a page a WebGL 2 context? */
export const hasWebGl2 = (page: Page): Promise<boolean> => page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));

/** Skip the game flow on Firefox (CI has no WebGL 2 there). A test whose title starts with `E5` or `Cannot start` still runs. */
export function skipGameFlowOnFirefox(): void {
  test.beforeEach(({ browserName }, info) => {
    test.skip(browserName === 'firefox' && !/^(E5|Cannot start)/.test(info.title), 'Firefox on CI has no WebGL 2: the page shows the E5 message (see the E5 test)');
  });
}

/**
 * Open `url` and check the E5 contract on this browser as it is: with no WebGL 2 the boot box shows the message and the game never starts; with WebGL 2 the message is
 * absent and the game starts. The branch is taken from the browser, so the check is the same everywhere. It reports which branch ran.
 */
export async function expectE5Contract(page: Page, url: string): Promise<'message' | 'game'> {
  await page.goto(url);
  const webgl2 = await hasWebGl2(page);
  const boot = page.locator('#boot');
  if (!webgl2) {
    await expect(boot).toHaveClass(/error/, { timeout: 30_000 });
    await expect(boot).toBeVisible();
    await expect(boot).toContainText('SHADOW JOG failed to start');
    await expect(boot).toContainText(E5_TEXT);
    await expect(boot).toContainText(E5_HINT);
    expect(await page.evaluate(() => (window as unknown as { __sjStarted?: boolean }).__sjStarted === true)).toBe(false);
    test.info().annotations.push({ type: 'E5', description: 'this browser has no WebGL 2: the message branch ran' });
    return 'message';
  }
  // Control: a browser with WebGL 2 must not show the message. Wait for the game to start first, so "not shown yet" cannot pass by being early.
  await page.waitForFunction(() => (window as unknown as { __sjStarted?: boolean }).__sjStarted === true, null, { timeout: 30_000 });
  await expect(boot).toBeHidden();
  expect(await boot.textContent()).not.toMatch(E5_TEXT);
  expect(await boot.textContent()).not.toContain(E5_HINT);
  test.info().annotations.push({ type: 'E5', description: 'this browser has WebGL 2: the game branch ran' });
  return 'game';
}
