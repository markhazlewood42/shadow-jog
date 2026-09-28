/**
 * The economy by hand: walking a zone turns up random fights that pay out, and a shop takes the
 * cred and hands over the goods. Driven with the keyboard; the debug API only places the crew
 * and reads state.
 */
import { expect, test, type Page } from '@playwright/test';

async function sj<T = unknown>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(async () => { const sj = window.__SJ__; return ${fn}; })()`) as Promise<T>;
}

async function tap(page: Page, key: string, hold = 60): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(hold);
  await page.keyboard.up(key);
}

async function waitFor(page: Page, cond: string, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await sj<boolean>(page, cond)) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

test('walking the Barrens turns up fights that pay out', async ({ page }) => {
  await page.goto('/?debug');
  await page.waitForTimeout(800);
  await sj(page, "sj.stage('town')");
  await page.waitForTimeout(1200);
  await sj(page, "sj.tp('world', 13, 22, 'right')");
  await page.waitForTimeout(900);
  // A stretch of open Barrens: found on the world map rather than hard-coded.
  const start = await sj<[number, number] | null>(page, `(() => {
    const m = sj.field().map;
    for (let y = 2; y < m.h - 2; y++) for (let x = 2; x < m.w - 8; x++) {
      let ok = true;
      for (let k = 0; k < 6; k++) if (m.at(x + k, y) !== 'w_barrens' || m.solid[y * m.w + x + k]) { ok = false; break; }
      if (ok) return [x, y];
    }
    return null;
  })()`);
  expect(start, 'an open stretch of Barrens on the world map').not.toBeNull();
  await sj(page, `sj.tp('world', ${start![0]}, ${start![1]}, 'right')`);
  await page.waitForTimeout(900);
  await waitFor(page, 'sj.idle()', 3000);
  const cred0 = await sj<number>(page, 'sj.state.cred');
  const battles0 = await sj<number>(page, 'sj.state.battles');

  // Pace back and forth until a fight starts.
  let fought = false;
  for (let lap = 0; lap < 40 && !fought; lap++) {
    const dir = lap % 2 ? 'ArrowLeft' : 'ArrowRight';
    await page.keyboard.down(dir);
    fought = await waitFor(page, "sj.top() === 'BattleScene'", 1200);
    await page.keyboard.up(dir);
  }
  expect(fought, 'a random encounter within 40 laps').toBe(true);

  // Auto the fight, then click through the results.
  await page.waitForTimeout(3000);
  for (let i = 0; i < 40 && (await sj<string>(page, 'sj.top()')) !== 'FieldScene'; i++) {
    if (i % 8 === 0) {
      await tap(page, 'ArrowDown');
      await page.waitForTimeout(150);
      await tap(page, 'ArrowDown');
      await page.waitForTimeout(150);
    }
    await tap(page, 'Enter');
    await page.waitForTimeout(700);
  }
  expect(await sj<string>(page, 'sj.top()')).toBe('FieldScene');
  expect(await sj<number>(page, 'sj.state.battles')).toBe(battles0 + 1);
  expect(await sj<number>(page, 'sj.state.cred')).toBeGreaterThan(cred0);
});

test('a shop takes the cred and hands over the goods', async ({ page }) => {
  await page.goto('/?debug');
  await page.waitForTimeout(800);
  await sj(page, "sj.stage('town')");
  await page.waitForTimeout(1200);
  await sj(page, '(sj.state.cred = 500, true)');
  // Stand below the armory door and walk in.
  await sj(page, "sj.tp('lantern_row', 12, 7, 'up')");
  await page.waitForTimeout(800);
  await tap(page, 'ArrowUp', 200);
  expect(await waitFor(page, "sj.state.map === 'armory' && sj.idle()", 4000), 'walked into the armory').toBe(true);
  // Up to the counter, and talk to Brother Tomas.
  for (let i = 0; i < 3; i++) {
    await tap(page, 'ArrowUp', 200);
    await page.waitForTimeout(150);
  }
  let shop = false;
  for (let i = 0; i < 6 && !shop; i++) {
    await tap(page, 'z');
    shop = await waitFor(page, "sj.top() === 'ShopScene'", 800);
  }
  expect(shop, 'the shop opened').toBe(true);
  const inv0 = await sj<Record<string, number>>(page, '({ ...sj.state.inventory })');
  // Buy → first item → quantity 1 → confirm.
  await page.waitForTimeout(400);
  for (const k of ['Enter', 'Enter', 'Enter']) {
    await tap(page, k);
    await page.waitForTimeout(300);
  }
  const cred = await sj<number>(page, 'sj.state.cred');
  const inv = await sj<Record<string, number>>(page, '({ ...sj.state.inventory })');
  expect(cred).toBeLessThan(500);
  const bought = Object.keys(inv).filter((k) => (inv[k] ?? 0) > (inv0[k] ?? 0));
  expect(bought.length, 'one item line went up').toBe(1);
  // Leave the shop and walk back out to the street.
  for (let i = 0; i < 4 && (await sj<string>(page, 'sj.top()')) === 'ShopScene'; i++) {
    await tap(page, 'x');
    await page.waitForTimeout(400);
  }
  expect(await waitFor(page, "sj.top() === 'FieldScene'", 3000)).toBe(true);
  for (let i = 0; i < 8 && (await sj<string>(page, 'sj.state.map')) === 'armory'; i++) await tap(page, 'ArrowDown', 220);
  expect(await waitFor(page, "sj.state.map === 'lantern_row'", 4000), 'back on the street').toBe(true);
});
