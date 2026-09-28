/**
 * Losing and saving: every Game Over choice, and a real localStorage save that survives a reload.
 */
import { expect, test, type Page } from '@playwright/test';

async function sj<T = unknown>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(async () => { const sj = window.__SJ__; return ${fn}; })()`) as Promise<T>;
}

async function waitFor(page: Page, expr: string, label: string, timeout = 20_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await sj<boolean>(page, `!!(${expr})`)) return;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`);
    await page.waitForTimeout(100);
  }
}

async function key(page: Page, k: string): Promise<void> {
  await page.keyboard.down(k);
  await page.waitForTimeout(50);
  await page.keyboard.up(k);
  await page.waitForTimeout(200);
}

async function stage(page: Page, name: string): Promise<void> {
  await page.goto('/?debug');
  await page.waitForTimeout(600);
  await page.evaluate(() => localStorage.clear());
  await sj(page, `sj.stage('${name}')`);
  await waitFor(page, 'sj.idle()', 'field idle');
}

async function loseAFight(page: Page): Promise<void> {
  await sj(page, 'Object.assign(sj.debug, { autoLose: true, autoBattle: false })');
  await sj(page, "sj.battle('street', 'street')");
  await waitFor(page, "sj.top() === 'GameOverScene'", 'game over');
  await sj(page, 'Object.assign(sj.debug, { autoLose: false })');
  await page.waitForTimeout(1500); // Game Over accepts input after its fade-in.
}

test('Retry rewinds to the moment before the fight', async ({ page }) => {
  await stage(page, 'sinkline');
  const before = await sj<string>(page, 'JSON.stringify({ inv: sj.state.inventory, hp: sj.state.members.kit.hp, battles: sj.state.battles })');
  await loseAFight(page);
  await sj(page, 'Object.assign(sj.debug, { autoBattle: true })');
  await key(page, 'Enter'); // Retry
  await waitFor(page, 'sj.idle()', 'back on the field after the retry');
  const after = await sj<{ inv: unknown; hp: number; battles: number }>(page, '({ inv: sj.state.inventory, hp: sj.state.members.kit.hp, battles: sj.state.battles })');
  const b = JSON.parse(before) as { inv: Record<string, number>; hp: number; battles: number };
  expect(after.battles).toBe(b.battles + 1);
  expect(after.hp).toBe(b.hp);
  // Only battle drops may have been added; nothing consumed.
  for (const [k, v] of Object.entries(b.inv)) expect((after.inv as Record<string, number>)[k]).toBeGreaterThanOrEqual(v);
});

test('Load from Game Over restores the save, including play time', async ({ page }) => {
  await stage(page, 'sinkline');
  await sj(page, 'sj.game.playFrames = 5000');
  expect(await sj<boolean>(page, 'sj.save(1)')).toBe(true);
  await sj(page, 'sj.game.playFrames = 99999');
  await sj(page, "sj.state.flags.bogus = true");
  await loseAFight(page);
  await key(page, 'ArrowDown'); // Load last save
  await key(page, 'Enter');
  await waitFor(page, "sj.idle() && sj.state.map === 'sinkline_1'", 'loaded field');
  const pf = await sj<number>(page, 'sj.game.playFrames');
  expect(pf).toBeGreaterThanOrEqual(5000);
  expect(pf).toBeLessThan(6000);
  expect(await sj(page, 'sj.state.flags.bogus')).toBeFalsy();
});

test('Return to Title from Game Over', async ({ page }) => {
  await stage(page, 'town');
  await loseAFight(page);
  await key(page, 'ArrowDown');
  await key(page, 'ArrowDown');
  await key(page, 'Enter');
  await waitFor(page, "sj.top() === 'TitleScene'", 'title');
});

test('A save survives a page reload and Continue restores it', async ({ page }) => {
  await stage(page, 'annex');
  await sj(page, "sj.tp('annex', 20, 12, 'left')");
  await waitFor(page, 'sj.idle()', 'field idle');
  await sj(page, 'sj.game.playFrames = 7200');
  expect(await sj<boolean>(page, 'sj.save(2)')).toBe(true);
  await page.goto('/');
  await page.waitForTimeout(1500);
  await key(page, 'Enter'); // press any key
  await page.waitForTimeout(600);
  await key(page, 'Enter'); // Continue (default when saves exist)
  await waitFor(page, "sj.idle() && sj.state.map === 'annex'", 'continued into the annex');
  const s = await sj<{ x: number; y: number; party: string[]; pf: number }>(page, '({ x: sj.state.x, y: sj.state.y, party: sj.state.party, pf: sj.game.playFrames })');
  expect(s.x).toBe(20);
  expect(s.y).toBe(12);
  expect(s.party).toContain('sable');
  expect(s.pf).toBeGreaterThanOrEqual(7200);
  expect(s.pf).toBeLessThan(8000);
});

test('Load from Game Over with a damaged save says so and returns to the title', async ({ page }) => {
  await stage(page, 'sinkline');
  expect(await sj<boolean>(page, 'sj.save(1)')).toBe(true);
  // Metadata intact (so Load is offered), state structurally broken (so loading fails).
  await page.evaluate(() => {
    localStorage.removeItem('shadowjog.save.auto');
    const raw = JSON.parse(localStorage.getItem('shadowjog.save.1')!);
    delete raw.state.members.kit;
    localStorage.setItem('shadowjog.save.1', JSON.stringify(raw));
  });
  await loseAFight(page);
  await key(page, 'ArrowDown'); // Load last save
  await key(page, 'Enter');
  await waitFor(page, "sj.top() === 'TitleScene'", 'title');
  const n = await sj<{ text: string; tone: string } | null>(page, 'sj.notice()');
  expect(n?.tone).toBe('warn');
  expect(n?.text).toMatch(/no save|damaged/i);
});

test('Autosave reports success, and failure when storage is unavailable', async ({ page }) => {
  await stage(page, 'town');
  await sj(page, "sj.tp('world', 20, 22, 'right')");
  await waitFor(page, 'sj.idle()', 'world');
  expect((await sj<{ tone: string } | null>(page, 'sj.notice()'))?.tone).toBe('saved');
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error('QuotaExceededError');
    };
  });
  await sj(page, "sj.tp('lantern_row', 30, 12, 'down')");
  await waitFor(page, 'sj.idle()', 'town');
  const n = await sj<{ text: string; tone: string } | null>(page, 'sj.notice()');
  expect(n?.tone).toBe('warn');
  expect(n?.text).toMatch(/Autosave failed/);
});
