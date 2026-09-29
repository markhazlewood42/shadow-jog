/**
 * The wrong thing at the wrong moment: what a real player does that a scripted route never will.
 * Mashing every key through a door fade, opening the menu mid-warp, reloading in the middle of a
 * conversation, hammering keys through a battle. Each must end somewhere playable, with no errors.
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

/** Press a key briefly (no settle wait: mashing). */
async function tap(page: Page, k: string): Promise<void> {
  await page.keyboard.down(k);
  await page.waitForTimeout(16);
  await page.keyboard.up(k);
}

/** Press a spread of keys as fast as a frustrated player would, for `ms`. */
async function mash(page: Page, ms: number, keys = ['z', 'x', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']): Promise<void> {
  const end = Date.now() + ms;
  let i = 0;
  while (Date.now() < end) await tap(page, keys[i++ % keys.length]!);
}

async function stage(page: Page, name: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?debug');
  await page.waitForTimeout(600);
  await page.evaluate(() => localStorage.clear());
  await sj(page, `sj.stage('${name}')`);
  await waitFor(page, 'sj.idle()', 'field idle');
  return errors;
}

/** Back out of anything open (menus, dialogs) until the field is idle. */
async function settle(page: Page): Promise<void> {
  for (let i = 0; i < 40 && !(await sj<boolean>(page, 'sj.idle()')); i++) {
    await tap(page, (await sj<string>(page, 'sj.top()')) === 'DialogScene' ? 'z' : 'Escape');
    await page.waitForTimeout(150);
  }
  await waitFor(page, 'sj.idle()', 'field idle after the chaos');
}

test('mashing every key while walking through a door ends up in the room, playable', async ({ page }) => {
  const errors = await stage(page, 'town');
  // Step onto the bar's door and hammer keys through the fade.
  await sj(page, "sj.tp('lantern_row', 22, 7, 'up')");
  await page.keyboard.down('ArrowUp');
  await mash(page, 2500);
  await page.keyboard.up('ArrowUp');
  await settle(page);
  expect(['bar', 'lantern_row']).toContain(await sj<string>(page, 'sj.state.map'));
  expect(errors).toEqual([]);
});

test('opening the menu over and over during a warp never strands the crew', async ({ page }) => {
  const errors = await stage(page, 'town');
  await sj(page, "sj.tp('lantern_row', 54, 11, 'right')");
  await page.keyboard.down('ArrowRight');
  await mash(page, 2000, ['Escape', 'x', 'Escape', 'ArrowDown', 'z']);
  await page.keyboard.up('ArrowRight');
  await settle(page);
  expect(['world', 'lantern_row']).toContain(await sj<string>(page, 'sj.state.map'));
  // And it can still move: some direction changes the position (whichever isn't a wall).
  const pos = () => sj<number>(page, 'sj.field().leader.x * 1000 + sj.field().leader.y');
  const before = await pos();
  for (const dir of ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp']) {
    await page.keyboard.down(dir);
    await page.waitForTimeout(350);
    await page.keyboard.up(dir);
    await page.waitForTimeout(250);
    if ((await pos()) !== before) break;
  }
  expect(await pos()).not.toBe(before);
  expect(errors).toEqual([]);
});

test('reloading in the middle of a conversation, then Continue, lands in a playable field', async ({ page }) => {
  const errors = await stage(page, 'town');
  expect(await sj<boolean>(page, 'sj.save(1)')).toBe(true);
  await sj(page, "sj.say('rook', 'This line is interrupted by a reload.')");
  await waitFor(page, "sj.top() === 'DialogScene'", 'dialog open');
  await page.reload();
  await page.waitForTimeout(1200);
  await tap(page, 'Enter');
  await page.waitForTimeout(500);
  // Continue is the first choice when a save exists.
  await tap(page, 'Enter');
  await waitFor(page, 'sj.idle()', 'field after continue');
  expect(await sj<string>(page, 'sj.state.map')).toBe('lantern_row');
  expect(errors).toEqual([]);
});

test('hammering keys through a battle never breaks it: it plays out to a result', async ({ page }) => {
  const errors = await stage(page, 'town');
  await sj(page, "sj.battle('street', 'street')");
  await waitFor(page, "sj.top() === 'BattleScene'", 'battle open');
  await mash(page, 5000);
  // Wherever the mashing left it (mid-orders, a list open, aiming), backing out reaches the round
  // menu, where the debug driver can finish the fight.
  for (let i = 0; i < 20 && (await sj<string>(page, "sj.top() === 'BattleScene' ? sj.game.top.mode : 'done'")) !== 'round'; i++) {
    const mode = await sj<string>(page, "sj.top() === 'BattleScene' ? sj.game.top.mode : 'done'");
    if (mode === 'done') break;
    await tap(page, 'x');
    await page.waitForTimeout(300);
  }
  await sj(page, 'Object.assign(sj.debug, { playtest: true })');
  await waitFor(page, "sj.top() !== 'BattleScene'", `battle over (stuck in mode ${await sj<string>(page, "sj.top() === 'BattleScene' ? sj.game.top.mode : '-'")})`, 90_000);
  await sj(page, 'Object.assign(sj.debug, { playtest: false })');
  await settle(page);
  expect(errors).toEqual([]);
});
