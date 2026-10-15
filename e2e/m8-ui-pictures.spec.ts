/**
 * M8b pass line 7: the pictures of the UI scenes for Mark's look review. LOCAL ONLY: it does nothing unless `M8_PICTURES=1`, it is not in the CI list, and it judges nothing
 * (no pixel comparison: the layout tests judge, Mark's eye judges the look).
 *
 *   M8_PICTURES=1 CI=1 PW_PORT=3012 npx playwright test e2e/m8-ui-pictures.spec.ts --reporter=line
 *
 * Pictures go to media/m8-ui/<scene>.png (git-ignored) at 1280x720. Phase 1 of M8b: card, controls, gameover, ending (two pages), placemap, save, load.
 * A scene that cannot be reached is named in the output and the rest is still written.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from '@playwright/test';
import { openGame, sj, waitTop } from './sjegamekit';

const ON = process.env.M8_PICTURES === '1';
const DIR = 'media/m8-ui';

test('M8b pictures: the first six UI scenes', async ({ browser }) => {
  test.skip(!ON, 'local only: set M8_PICTURES=1');
  test.setTimeout(180_000);
  const g = await openGame(browser, { query: '&fx=none', allow: [/./] });
  const { page } = g;
  mkdirSync(DIR, { recursive: true });
  const missing: string[] = [];
  if (!(await waitTop(page, 'TitleScene'))) throw new Error('no title');
  await sj(page, "sj.stage('annex')");
  const shot = async (name: string): Promise<void> => {
    writeFileSync(`${DIR}/${name}.png`, await page.screenshot());
  };
  /** Open a scene by name with `sj.show`, wait for it, wait `ms`, take the picture, and close it. */
  const scene = async (show: string, top: string, name: string, ms: number): Promise<void> => {
    await sj(page, `sj.show('${show}')`);
    if (!(await waitTop(page, top, 10_000))) {
      missing.push(name);
      return;
    }
    await page.waitForTimeout(ms);
    await shot(name);
    await sj(page, 'sj.game.top.close(null)');
    await page.waitForTimeout(300);
  };
  await page.waitForTimeout(500);
  await shot('field-baseline');
  await scene('card', 'CardScene', 'card', 900);
  await scene('controls', 'ControlsScene', 'controls', 500);
  await scene('placemap', 'PlaceMapScene', 'placemap', 700);
  await scene('save', 'SaveScene', 'save', 500);
  await scene('load', 'SaveScene', 'load', 500);
  await scene('gameover', 'GameOverScene', 'gameover', 3000);
  // The ending: the results page, then a key press for the next-chapter card.
  await sj(page, 'sj.ending()');
  if (await waitTop(page, 'EndingScene', 10_000)) {
    await page.waitForTimeout(4500);
    await shot('ending-results');
    await sj(page, 'sj.game.top.turn()');
    await page.waitForTimeout(3500);
    await shot('ending-next');
    await sj(page, 'sj.game.top.close(undefined)');
  } else missing.push('ending');
  console.info(missing.length ? `M8 pictures missing: ${missing.join(', ')}` : 'M8 pictures: all written to media/m8-ui/');
  await g.close();
});
