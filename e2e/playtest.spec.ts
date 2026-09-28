/// <reference types="node" />
/**
 * Hands-off playtest capture: plays Chapter 1 with real dialogs and a few real Auto rounds
 * per battle, saving a screenshot every couple of seconds to playtest/latest/ (gitignored).
 * Run: npx playwright test e2e/playtest.spec.ts
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { playChapter1, route, sj, waitFor } from './route';

const DIR = join('playtest', 'latest');
const EVERY_MS = 2500;

test('playtest capture: Chapter 1', async ({ page }) => {
  test.setTimeout(30 * 60_000);
  route.timeout = 240_000;
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?debug');
  await page.waitForTimeout(800);
  await sj(page, 'Object.assign(sj.debug, { playtest: true })');
  await sj(page, 'sj.newGame()');

  let n = 0, stop = false;
  const log: string[] = [];
  const shooter = (async () => {
    while (!stop) {
      await page.waitForTimeout(EVERY_MS);
      if (stop) break;
      try {
        const where = await sj<string>(page, "sj.top() + '-' + sj.state.map");
        const name = `${String(++n).padStart(3, '0')}-${where.replace(/Scene/g, '').toLowerCase()}.png`;
        await page.locator('canvas').first().screenshot({ path: join(DIR, name) });
        log.push(name);
      } catch {
        // The page can be mid-navigation; skip this frame.
      }
    }
  })();
  try {
    await playChapter1(page);
    await waitFor(page, "sj.top() === 'TitleScene'", 'back to title', 120_000);
  } finally {
    stop = true;
    await shooter;
    writeFileSync(join(DIR, 'index.txt'), log.map((l) => `${l}\n`).join(''));
  }
  expect(errors).toEqual([]);
});
