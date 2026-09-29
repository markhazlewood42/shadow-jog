/**
 * Evidence capture for quality reviews: drives the game to fixed states and writes PNGs to
 * docs/screenshots/. Run with `npm run shots`.
 */
import { expect, test, type Page } from '@playwright/test';

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
  // Through the rest of the comic to the first spoken line in the field (not a half-drawn page).
  for (let i = 0; i < 24 && (await sj<string>(page, 'sj.top()')) !== 'DialogScene'; i++) {
    await key(page, 'z');
    await page.waitForTimeout(600);
  }
  expect(await sj<string>(page, 'sj.top()')).toBe('DialogScene');
  await page.waitForTimeout(1600);
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
  // The Sell tab, with something to sell.
  await sj(page, "(sj.state.inventory = { ...sj.state.inventory, gang_colors: 2 }, true)");
  await key(page, 'Escape');
  await page.waitForTimeout(300);
  await key(page, 'ArrowDown');
  await key(page, 'Enter');
  await page.waitForTimeout(400);
  await shot(page, '10b-shop-sell');
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
  await page.waitForTimeout(1500);
  await sj(page, "sj.tp('annex', 22, 20, 'down')");
  await page.waitForTimeout(2500);
  await shot(page, '21-annex');
});

test('22 victory', async ({ page }) => {
  await open(page, 'annex');
  // Hex a few XP short of a level, so the panel shows a bar rolling over.
  await page.evaluate(`(async () => { const { xpFor } = await import('/src/data/party.ts'); const m = window.__SJ__.state.members.hex; m.xp = xpFor(m.level + 1) - 4; })()`);
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
  // The last page: Pale's order, then the chapter's title card. Advance until the card is up.
  for (let i = 0; i < 40; i++) {
    const done = await sj<boolean>(page, "(() => { const t = sj.game.top; if (!t || t.constructor.name !== 'PanelScene') return true; const p = t.pages[t.page]; return t.page === t.pages.length - 1 && t.shown === p.length; })()");
    if (done) break;
    await key(page, 'z', 1, 350);
  }
  await page.waitForTimeout(2500);
  await shot(page, '23b-ending-finale');
});

test('24 ending results + 25 next chapter', async ({ page }) => {
  await open(page, 'finale'); // post-Warden: the chapter's real end state
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

test('27 level features: lattice, secret panel, intake, radio lot', async ({ page }) => {
  await open(page, 'annex');
  // Mid-puzzle: relay A cycled, so emitters 1-2 are dark and 3 is live.
  await sj(page, '(Object.assign(sj.state.flags, { annex_key: true, relay_a: true, lattice_off: false, sable_joined: false }), true)');
  // Each secret framed on its own, after the area banner has gone.
  await page.waitForTimeout(3000);
  await sj(page, "sj.tp('annex', 28, 7, 'right')");
  await page.waitForTimeout(2500);
  await shot(page, '27-annex-lattice');
  await sj(page, "sj.tp('annex', 15, 22, 'left')");
  await page.waitForTimeout(2500);
  await shot(page, '28-annex-panel');
  await sj(page, '(sj.state.flags.annex_panel = true, true)');
  await sj(page, "sj.tp('annex', 12, 22, 'up')");
  await page.waitForTimeout(2500);
  await shot(page, '29-annex-crawlspace');
  await sj(page, "sj.tp('sinkline_1', 3, 11, 'up')");
  await page.waitForTimeout(1500);
  await shot(page, '30-sinkline-intake');
  await sj(page, "sj.tp('world', 6, 28, 'left')");
  await page.waitForTimeout(1500);
  await shot(page, '31-world-radio-lot');
});

test('37 cryopod before and after the rescue', async ({ page }) => {
  await open(page, 'annex');
  await sj(page, "(delete sj.state.flags.sable_joined, sj.state.flags.lattice_off = true, sj.tp('annex', 36, 8, 'up'))");
  await page.waitForTimeout(900);
  await shot(page, '37-annex-cryopod');
  await sj(page, "(sj.state.flags.sable_joined = true, sj.tp('annex', 36, 8, 'up'))");
  await page.waitForTimeout(900);
  await shot(page, '37b-annex-cryopod-empty');
});

test('38 packs: three rats, three hounds, each an individual', async ({ page }) => {
  for (const [name, who] of [['38-battle-rat-pack', 'glowrat'], ['38b-battle-hound-pack', 'scrap_hound']] as const) {
    await open(page, 'town');
    await sj(page, `sj.defineEncounter('f_shot_pack', ['${who}', '${who}', '${who}'])`);
    await sj(page, "sj.battle('f_shot_pack', 'street')");
    await page.waitForTimeout(3200);
    await shot(page, name);
  }
});

test('maps overview + cast', async ({ page }) => {
  for (const id of ['lantern_row', 'bar', 'world', 'rustyard', 'sinkline_1', 'annex', 'dock']) {
    await page.goto(`/?debug&scene=mapview&map=${id}`);
    await page.waitForTimeout(900);
    await shot(page, `maps/${id}`);
  }
  await page.goto('/?debug&scene=chars&zoom=4');
  await page.waitForTimeout(1200);
  await shot(page, 'progress-01-cast-sprites');
  await page.goto('/?debug&scene=chars&zoom=2&npcs');
  await page.waitForTimeout(1200);
  await shot(page, '32-crowd-sprites');
});

test('33 menu places', async ({ page }) => {
  await open(page, 'sinkline');
  await sj(page, 'sj.menu()');
  await page.waitForTimeout(400);
  await key(page, 'ArrowDown', 6);
  await key(page, 'Enter');
  await page.waitForTimeout(300);
  await shot(page, '33-menu-places');
  // The current place's map.
  await key(page, 'Enter');
  await page.waitForTimeout(500);
  await shot(page, '33b-menu-place-map');
});

test('34 game over', async ({ page }) => {
  await open(page, 'town');
  await sj(page, 'Object.assign(sj.debug, { autoLose: true, autoBattle: false })');
  await sj(page, "sj.battle('street', 'street')");
  for (let i = 0; i < 60; i++) {
    if (await sj<boolean>(page, "sj.top() === 'GameOverScene'")) break;
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(2200);
  await shot(page, '34-game-over');
});

test('35 options + 36 controls', async ({ page }) => {
  await open(page);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(1200);
  await key(page, 'Enter'); // press start
  await page.waitForTimeout(400);
  await key(page, 'ArrowDown', 3); // Options (no saves: New Game, Continue, Load, Options)
  await key(page, 'Enter');
  await page.waitForTimeout(400);
  await shot(page, '35-options');
  // Down to Controls by its label, not a row count (rows get added).
  for (let i = 0; i < 12 && (await sj<string>(page, "sj.game.top.rows[sj.game.top.idx].id")) !== 'controls'; i++) await key(page, 'ArrowDown');
  await key(page, 'Enter');
  await page.waitForTimeout(400);
  expect(await sj<string>(page, 'sj.top()')).toBe('ControlsScene');
  await shot(page, '36-controls');
});
