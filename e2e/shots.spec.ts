/**
 * Evidence capture for quality reviews: drives the game to fixed states and writes PNGs to
 * docs/screenshots/. Run with `npm run shots`.
 */
import { test, type Page } from '@playwright/test';

const OUT = 'docs/screenshots';

async function sj<T = unknown>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(async () => { const sj = window.__SJ__; return ${fn}; })()`) as Promise<T>;
}

async function open(page: Page, stage?: string): Promise<void> {
  await page.goto('/?debug');
  await page.waitForTimeout(600);
  if (stage) {
    await sj(page, `sj.stage('${stage}')`);
    await page.waitForTimeout(900);
  }
}

async function key(page: Page, k: string, n = 1, gap = 180): Promise<void> {
  for (let i = 0; i < n; i++) {
    await page.keyboard.down(k);
    await page.waitForTimeout(50);
    await page.keyboard.up(k);
    await page.waitForTimeout(gap);
  }
}

async function shot(page: Page, name: string): Promise<void> {
  await page.locator('#screen').screenshot({ path: `${OUT}/${name}.png` });
}

test.describe.configure({ mode: 'serial' });

test('01 title', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1600);
  await key(page, 'Enter');
  await page.waitForTimeout(900);
  await shot(page, '01-title');
});

test('02 intro panels + first dialog', async ({ page }) => {
  await open(page);
  await sj(page, 'sj.newGame()');
  await page.waitForTimeout(1500);
  await key(page, 'z', 2, 500);
  await page.waitForTimeout(1200);
  await shot(page, '02-intro-panels');
  await key(page, 'z', 3, 400);
  await page.waitForTimeout(3200);
  await shot(page, '03-dialog-portrait');
});

test('04 streets', async ({ page }) => {
  await open(page, 'start');
  await page.waitForTimeout(2500);
  await shot(page, '04-lantern-row-street');
  await open(page, 'town');
  await page.waitForTimeout(2500);
  await shot(page, '05-lantern-row-plaza');
});

test('06 bar dialog', async ({ page }) => {
  await open(page, 'start');
  await sj(page, "sj.tp('bar', 16, 6, 'up')");
  await page.waitForTimeout(800);
  await sj(page, "sj.say('dutch', 'There they are. My favorite disaster and his apprentice. Sit, sit. Mind the stain, it\\u2019s load-bearing.', 'happy')");
  await page.waitForTimeout(2600);
  await shot(page, '06-bar-dialog');
});

test('07 menus', async ({ page }) => {
  await open(page, 'sinkline');
  await sj(page, 'sj.menu()');
  await page.waitForTimeout(700);
  await shot(page, '07-menu');
  await key(page, 'ArrowDown', 3);
  await key(page, 'Enter');
  await key(page, 'Enter');
  await page.waitForTimeout(400);
  await shot(page, '08-menu-status');
  await key(page, 'x', 2);
  await key(page, 'ArrowUp');
  await key(page, 'Enter');
  await key(page, 'Enter');
  await key(page, 'Enter');
  await page.waitForTimeout(400);
  await shot(page, '09-menu-equip');
});

test('10 shop', async ({ page }) => {
  await open(page, 'town');
  await sj(page, "sj.shop('lr_weapons')");
  await page.waitForTimeout(500);
  await key(page, 'Enter');
  await key(page, 'ArrowDown');
  await page.waitForTimeout(400);
  await shot(page, '10-shop');
});

test('11 battle command + techs', async ({ page }) => {
  await open(page, 'sinkline');
  await sj(page, "sj.battle('sinkline', 'sewer')");
  await page.waitForTimeout(3200);
  await key(page, 'Enter');
  await page.waitForTimeout(400);
  await shot(page, '11-battle-command');
  await key(page, 'ArrowDown');
  await key(page, 'Enter');
  await page.waitForTimeout(400);
  await shot(page, '12-battle-techs');
});

test('13 battle action', async ({ page }) => {
  await open(page, 'town');
  await sj(page, "sj.battle('street', 'street')");
  await page.waitForTimeout(3200);
  await key(page, 'ArrowDown', 2);
  await key(page, 'Enter');
  await page.waitForTimeout(700);
  await shot(page, '13-battle-action');
});

test('14 combo hint', async ({ page }) => {
  await open(page, 'annex');
  await sj(page, "sj.battle('f_annex_door', 'lab')");
  await page.waitForTimeout(3200);
  await key(page, 'Enter'); // Fight
  await key(page, 'ArrowDown');
  await key(page, 'Enter'); // Ki Arts
  await key(page, 'Enter'); // Flash Step
  await key(page, 'Enter'); // target
  await key(page, 'ArrowDown');
  await key(page, 'Enter'); // Rook: Skills
  await page.waitForTimeout(400);
  await shot(page, '14-battle-combo-hint');
  await key(page, 'Enter'); // Arc Cut
  await key(page, 'Enter'); // target
  await key(page, 'Enter'); // Hex attack
  await key(page, 'Enter');
  await key(page, 'Enter'); // Sable attack
  await key(page, 'Enter');
  await page.waitForTimeout(900);
  await shot(page, '15-battle-combo');
});

test('16 bosses', async ({ page }) => {
  await open(page, 'annex');
  await sj(page, "sj.battle('f_warden', 'core', true)");
  await page.waitForTimeout(3600);
  await shot(page, '16-battle-warden');
  await open(page, 'sinkline');
  await sj(page, "sj.battle('f_lurker', 'junction', true)");
  await page.waitForTimeout(3600);
  await shot(page, '17-battle-lurker');
});

test('18 world + dungeons', async ({ page }) => {
  await open(page, 'sinkline');
  await page.waitForTimeout(1500);
  await shot(page, '18-sinkline');
  await sj(page, "sj.tp('world', 22, 22, 'right')");
  await page.waitForTimeout(3500);
  await shot(page, '19-world');
  await sj(page, "sj.tp('rustyard', 15, 18, 'up')");
  await page.waitForTimeout(3500);
  await shot(page, '20-rustyard');
  await open(page, 'annex');
  await page.waitForTimeout(3500);
  await shot(page, '21-annex');
});

test('22 victory', async ({ page }) => {
  await open(page, 'annex');
  await sj(page, "sj.battle('f_first_fight', 'street')");
  await page.waitForTimeout(3200);
  await key(page, 'ArrowDown', 2);
  await key(page, 'Enter');
  await page.waitForTimeout(9000);
  await shot(page, '22-battle-victory');
});

test('23 ending', async ({ page }) => {
  await open(page, 'annex');
  await sj(page, "sj.run((s) => s.panels('ending'))");
  await page.waitForTimeout(1500);
  await key(page, 'z', 2, 500);
  await page.waitForTimeout(1500);
  await shot(page, '23-ending-panels');
});

test('24 ending results + 25 next chapter', async ({ page }) => {
  await open(page, 'annex');
  await sj(page, 'sj.ending()');
  await page.waitForTimeout(3400);
  await shot(page, '24-ending-results');
  await key(page, 'z', 1, 300);
  await page.waitForTimeout(3600);
  await shot(page, '25-ending-next');
});

test('26 menu bestiary', async ({ page }) => {
  await open(page, 'sinkline');
  await sj(page, "Object.assign(sj.state.bestiary, { rustfang_punk: 6, rustfang_medic: 2, glowrat: 9, scrap_hound: 4, smog_wisp: 2, knuckles: 1, drowned_shade: 3 })");
  await sj(page, "Object.assign(sj.state.weakSeen, { rustfang_punk: ['cyber'], smog_wisp: ['mana'], glowrat: ['fire'] })");
  await sj(page, 'sj.menu()');
  await page.waitForTimeout(400);
  await key(page, 'ArrowDown', 5);
  await key(page, 'Enter');
  await key(page, 'ArrowDown', 4);
  await page.waitForTimeout(300);
  await shot(page, '26-menu-bestiary');
});
