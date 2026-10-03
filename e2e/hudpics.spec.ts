/**
 * The HUD pictures (spike `spike/phaser-stage`, HUD polish rounds): the street line-up with two duplicate foes, the boss
 * line-up, an acting state with a damage number on the white Warden (the lab's still one and the Battle Test's live one), a
 * low-health state with statuses, and the command strip with a focused icon showing its caption.
 *
 * Skipped unless `HUDPICS_MEDIA` names a folder. `HUDPICS_ROUND` names the files (`hud-r<round>-<name>.png`). The pictures are
 * 960 x 540, the stage at exactly 2x.
 *
 * The fight pictures freeze real time (`scene.speed = 0`) and step the scene themselves, so every picture is the same every run.
 */
import { expect, type Page, test } from '@playwright/test';
import { dropScratch, flush, openEditor, scratchName } from './stageeditkit';
import { hideStatus, openLab } from './stagelabkit';

const MEDIA = process.env.HUDPICS_MEDIA;
const ROUND = process.env.HUDPICS_ROUND ?? '1';
const file = (name: string): string => `${MEDIA}/hud-r${ROUND}-${name}.png`;

let scratch = '';
test.beforeEach(() => {
  scratch = scratchName('hudpics');
});
test.afterEach(() => dropScratch(scratch));

test('the lab pictures: street line-up, boss line-up and the acting state', async ({ page }) => {
  test.skip(!MEDIA, 'set HUDPICS_MEDIA=<folder> to save the pictures');
  await page.setViewportSize({ width: 960, height: 540 });
  const shots: Array<[string, string]> = [
    ['street-lineup-2x', '?clean&stage=street&set=3&phase=choose'],
    ['boss-lineup-2x', '?clean&stage=street&set=boss%2B2&phase=choose'],
    ['acting-2x', '?clean&stage=street&set=boss&phase=act'],
    ['sewer-lineup-2x', '?clean&stage=sewer&set=3&phase=target'],
  ];
  for (const [name, query] of shots) {
    const errors = await openLab(page, query);
    expect(errors).toEqual([]);
    await hideStatus(page);
    // Freeze the clock at a fixed tick so the picture is the same every run (the idle loops and the low-health blink follow it).
    await page.evaluate(() => {
      const s = window.__stagelab?.scene();
      if (s) {
        s.speed = 0;
        s.step(20);
      }
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: file(name) });
  }
});

/** Start a fight without the dialog and freeze real time. */
async function startFight(page: Page, setKey: string, seed = 8): Promise<void> {
  await page.evaluate(
    ([key, sd]) => {
      const e = window.__stageedit;
      if (!e) throw new Error('no editor');
      const st = e.session.stage;
      e.startBattle({ party: st.demo.party, roster: st.demo.rosters[key as string] ?? [], setKey: key as string, seed: sd as number, fullResources: true, speed: 1, auto: false });
      const scene = window.__stagelab?.scene();
      if (scene) scene.speed = 0;
    },
    [setKey, seed],
  );
}

const stepN = (page: Page, n: number): Promise<void> => page.evaluate((k) => window.__stagelab?.scene()?.step(k), n);

test('the fight pictures: a live impact, low health with statuses, the command strip', async ({ page }) => {
  test.skip(!MEDIA, 'set HUDPICS_MEDIA=<folder> to save the pictures');
  const { errors } = await openEditor(page, scratch);
  const canvas = page.locator('#stage canvas');
  const shot = async (name: string): Promise<void> => {
    await flush(page);
    await canvas.screenshot({ path: file(name) });
  };

  // 1. Rook's Arc Cut-free attack on the Warden: the number the blow raises, on a white target.
  await startFight(page, 'boss');
  await page.evaluate(() => {
    const bt = window.__stageedit?.battle();
    if (!bt) throw new Error('no battle');
    bt.press('left');
    bt.press('ok'); // Kit: Guard
    bt.press('ok');
    bt.press('ok'); // Rook: Attack, first foe
    bt.press('left');
    bt.press('ok'); // Hex: Guard
    bt.press('left');
    bt.press('ok'); // Sable: Guard
  });
  await page.evaluate(() => {
    const scene = window.__stagelab?.scene();
    const bt = window.__stageedit?.battle();
    if (!scene || !bt) throw new Error('no battle');
    let n = 0;
    while (!bt.perf.log.some((l) => l.includes('rook-strike')) && n++ < 4000) scene.step(1);
    // The blow lands on the 33rd tick of the move; look a few ticks after it, while the Warden is still white and the number is low.
    for (let i = 0; i < 36; i++) scene.step(1);
  });
  await shot('impact-2x');
  await page.evaluate(() => window.__stageedit?.stopBattle());

  // 2. Low health and statuses: Kit nearly down (red, blinking), Hex under half (amber) and poisoned, Sable guarding, Rook stunned.
  await startFight(page, '3');
  await page.evaluate(() => {
    const bt = window.__stageedit?.battle();
    if (!bt) throw new Error('no battle');
    const party = bt.flow.battle.party;
    const [kit, rook, hex, sable] = party;
    if (!kit || !rook || !hex || !sable) throw new Error('no party');
    kit.hp = 18;
    hex.hp = 36;
    sable.hp = 70;
    kit.status.push({ id: 'poison', turns: 3 }, { id: 'atk_down', turns: 2 });
    hex.status.push({ id: 'guard', turns: 1 }, { id: 'def_up', turns: 3 });
    rook.status.push({ id: 'stun', turns: 1 });
    sable.status.push({ id: 'regen', turns: 3 });
    bt.flow.sync();
    // A key press makes the Battle Test redraw the HUD from the changed state (right then left leaves the menu where it was).
    bt.press('right');
    bt.press('left');
  });
  await stepN(page, 4); // the blink is "on" in the first 16 ticks of every 32
  await shot('lowhp-2x');
  await stepN(page, 16); // and "off" in the next 16
  await shot('lowhp-blink-2x');
  await page.evaluate(() => window.__stageedit?.stopBattle());

  // 3. The command strip with a focused icon: Skill lit, its name and cost on the caption line, a name under every icon.
  await startFight(page, '3');
  await page.evaluate(() => window.__stageedit?.battle()?.press('right'));
  await shot('commands-2x');
  await page.evaluate(() => window.__stageedit?.stopBattle());
  expect(errors).toEqual([]);
});
