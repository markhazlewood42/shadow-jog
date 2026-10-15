/**
 * M8b pass line 7: the pictures of the UI scenes for Mark's look review. LOCAL ONLY: it does nothing unless `M8_PICTURES=1`, it is not in the CI list, and it judges nothing
 * (no pixel comparison: the layout tests judge, Mark's eye judges the look).
 *
 *   M8_PICTURES=1 CI=1 PW_PORT=3012 npx playwright test e2e/m8-ui-pictures.spec.ts --reporter=line
 *
 * Pictures go to media/m8-ui/<scene>.png (git-ignored) at 1280x720. Phase 1 of M8b: card, controls, gameover, ending (two pages), placemap, save, load.
 * Phase 2: title (before and after a key), options, dialog (a portrait line and a choice), shop (root, buy, quantity, sell, sell all loot).
 * Phase 3: the field menu (party, items, item target, techs, equip slots and gear, status, combos, bestiary, places, save), Hex's deck (dead, seating, booted, view)
 * and the comic panels (the intro's two pages, the ending's pages and the title card).
 * A scene that cannot be reached is named in the output and the rest is still written.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from '@playwright/test';
import { openGame, sj, waitTop } from './sjegamekit';

const ON = process.env.M8_PICTURES === '1';
const DIR = 'media/m8-ui';

test('M8b pictures: the UI scenes ported so far', async ({ browser }) => {
  test.skip(!ON, 'local only: set M8_PICTURES=1');
  test.setTimeout(180_000);
  const g = await openGame(browser, { query: '&fx=none', allow: [/./] });
  const { page } = g;
  mkdirSync(DIR, { recursive: true });
  const missing: string[] = [];
  if (!(await waitTop(page, 'TitleScene'))) throw new Error('no title');
  const shot = async (name: string): Promise<void> => {
    writeFileSync(`${DIR}/${name}.png`, await page.screenshot());
  };
  // The title: the logo is up and the prompt blinks; then a key brings the menu.
  await page.waitForTimeout(2500);
  await shot('title-prompt');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  await shot('title-menu');
  await sj(page, "sj.stage('annex')");
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
  await scene('options', 'OptionsScene', 'options', 500);
  await scene('card', 'CardScene', 'card', 900);
  await scene('controls', 'ControlsScene', 'controls', 500);
  await scene('placemap', 'PlaceMapScene', 'placemap', 700);
  await scene('save', 'SaveScene', 'save', 500);
  await scene('load', 'SaveScene', 'load', 500);
  await scene('gameover', 'GameOverScene', 'gameover', 3000);
  // The dialog: a line with a portrait, typed out, then a choice.
  const keyTap = async (k: string): Promise<void> => {
    await page.keyboard.press(k);
    await page.waitForTimeout(250);
  };
  await sj(page, "sj.say('dutch', 'There they are. My favorite disaster and his apprentice. Sit, sit. Mind the stain, it\u2019s load-bearing.', 'happy')");
  if (await waitTop(page, 'DialogScene', 10_000)) {
    await page.waitForTimeout(3500);
    await shot('dialog-portrait');
    await keyTap('z');
    await page.waitForTimeout(400);
  } else missing.push('dialog-portrait');
  await sj(page, "sj.run(async (s) => { await s.ask('dutch', 'You want the job, or you want to keep your teeth?', ['Take the job', 'Keep my teeth', 'Ask about the pay']); })");
  if (await waitTop(page, 'DialogScene', 10_000)) {
    await page.waitForTimeout(4500);
    await keyTap('ArrowDown');
    await shot('dialog-choice');
    await keyTap('z');
    await page.waitForTimeout(400);
  } else missing.push('dialog-choice');
  // The shop: the root, the buy list, the quantity question, the sell list, and the sell-all-loot question.
  await sj(page, '(sj.state.inventory = { gang_colors: 2, medkit: 1, scrap_plate: 3 }, sj.state.cred = 900, true)');
  await sj(page, "sj.shop('lr_weapons')");
  if (await waitTop(page, 'ShopScene', 10_000)) {
    await page.waitForTimeout(500);
    await shot('shop-root');
    await keyTap('Enter');
    await keyTap('ArrowDown');
    await page.waitForTimeout(300);
    await shot('shop-buy');
    await keyTap('Enter');
    await page.waitForTimeout(300);
    await shot('shop-quantity');
    await keyTap('Escape');
    await keyTap('Escape');
    await keyTap('ArrowDown');
    await keyTap('Enter');
    await page.waitForTimeout(300);
    await shot('shop-sell');
    await keyTap('Enter');
    await page.waitForTimeout(300);
    await shot('shop-sell-all');
    await sj(page, 'sj.game.top.close()');
    await page.waitForTimeout(300);
  } else missing.push('shop');
  // The field menu: the party first, then each page. `pick` moves the main list's cursor to a row by its label and presses confirm; `back` presses cancel.
  await sj(page, '(sj.state.inventory = { medkit: 2, gang_colors: 2, scrap_plate: 3, stim: 1 }, true)');
  await sj(page, 'sj.menu()');
  if (await waitTop(page, 'MenuScene', 10_000)) {
    await page.waitForTimeout(500);
    await shot('menu-party');
    const pick = async (label: string): Promise<void> => {
      await sj(page, `(sj.game.top.main.index = sj.game.top.main.items.findIndex((it) => it.label === ${JSON.stringify(label)}), true)`);
      await keyTap('Enter');
    };
    const back = async (n: number): Promise<void> => {
      for (let i = 0; i < n; i++) await keyTap('Escape');
    };
    await pick('Items');
    await shot('menu-items');
    await keyTap('Enter');
    await shot('menu-item-target');
    await back(2);
    await pick('Techs');
    await keyTap('Enter');
    await shot('menu-techs');
    await back(2);
    await pick('Equip');
    await keyTap('Enter');
    await shot('menu-equip-slots');
    await keyTap('Enter');
    await shot('menu-equip-gear');
    await back(3);
    await pick('Status');
    await keyTap('Enter');
    await shot('menu-status');
    await back(2);
    for (const label of ['Combos', 'Bestiary', 'Places', 'Save']) {
      await pick(label);
      await shot(`menu-${label.toLowerCase()}`);
      await back(1);
    }
    await back(1);
  } else missing.push('menu');
  // Hex's deck: dead, then seating the Stingray (the swing is not aimed by a script: drop it, snap both clips, let it boot), then the view.
  await sj(page, "(sj.run((s) => s.deck('dead')), true)");
  if (await waitTop(page, 'DeckScene', 10_000)) {
    await page.waitForTimeout(900);
    await shot('deck-dead');
    await keyTap('Escape');
    await page.waitForTimeout(500);
  } else missing.push('deck-dead');
  await sj(page, "(sj.run((s) => s.deck('seat')), true)");
  if (await waitTop(page, 'DeckScene', 10_000)) {
    await page.waitForTimeout(1100);
    await shot('deck-seat-align');
    await sj(page, '(sj.game.top.go("drop"), true)');
    await page.waitForTimeout(700);
    await keyTap('Enter');
    await page.waitForTimeout(400);
    await keyTap('Enter');
    await page.waitForTimeout(3600);
    await shot('deck-seat-booted');
    await sj(page, 'sj.game.top.close(undefined)');
    await page.waitForTimeout(400);
  } else missing.push('deck-seat');
  await sj(page, "(sj.run((s) => s.deck('view')), true)");
  if (await waitTop(page, 'DeckScene', 10_000)) {
    await page.waitForTimeout(700);
    await shot('deck-view');
    await sj(page, 'sj.game.top.close(undefined)');
    await page.waitForTimeout(400);
  } else missing.push('deck-view');
  // The comic panels: confirm until the wanted page has every panel in, then wait for its speech to type out.
  const panelsTo = async (id: string, pageIdx: number, name: string, wait: number): Promise<void> => {
    await sj(page, `(sj.run((s) => s.panels('${id}')), true)`);
    if (!(await waitTop(page, 'PanelScene', 10_000))) {
      missing.push(name);
      return;
    }
    const at = (): Promise<boolean> => sj<boolean>(page, `(() => { const t = sj.game.top; return t.page === ${pageIdx} && t.shown === t.pages[${pageIdx}].length; })()`);
    for (let i = 0; i < 40 && !(await at()); i++) {
      await keyTap('Enter');
      await page.waitForTimeout(450);
    }
    await page.waitForTimeout(wait);
    await shot(name);
    await sj(page, 'sj.game.top.close(undefined)');
    await page.waitForTimeout(400);
  };
  await panelsTo('intro', 0, 'panels-intro-1', 2500);
  await panelsTo('intro', 1, 'panels-intro-2', 3500);
  await panelsTo('ending', 0, 'panels-ending-1', 3500);
  await panelsTo('ending', 3, 'panels-ending-finale', 4500);
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
