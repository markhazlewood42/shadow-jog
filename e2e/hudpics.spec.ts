/**
 * The HUD pictures (spike `spike/phaser-stage`, HUD polish rounds): the street line-up with two duplicate foes, the boss
 * line-up, an acting state with a damage number on the white Warden (the lab's still one and the Battle Test's live one), a
 * low-health state with statuses, and the command strip with a focused icon showing its caption. Round 2 adds a weak-spot hit and a
 * critical hit (tinted, tagged numbers) and the four HUD presets plus a box dragged off the bottom row (the band must collapse cleanly).
 * Round 3 adds the six-foe line-up and the combo counter after a multi-hit (Kit's Hundred Rain on the Warden), and counts the numbers
 * the lab and the fight draw against the counter.
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
const ROUND = process.env.HUDPICS_ROUND ?? '3';
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
    ['six-lineup-2x', '?clean&stage=street&set=6&phase=choose'],
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

test('the number pictures: a weak-spot hit and a critical hit on the white Warden', async ({ page }) => {
  test.skip(!MEDIA, 'set HUDPICS_MEDIA=<folder> to save the pictures');
  await page.setViewportSize({ width: 960, height: 540 });
  const errors = await openLab(page, '?clean&stage=street&set=boss&phase=act');
  expect(errors).toEqual([]);
  await hideStatus(page);
  for (const [name, patch] of [['weak-hit-2x', { weak: true, crit: false, dmg: 112 }], ['crit-hit-2x', { weak: false, crit: true, dmg: 186 }]] as const) {
    await page.evaluate((p) => {
      const s = window.__stagelab?.scene();
      if (!s) throw new Error('no scene');
      s.speed = 0;
      // The lab's view is rebuilt from the engine on every refresh; hand the scene a copy with a different featured hit and redraw.
      const v = s.currentView;
      if (!v.act) throw new Error('no act');
      // The number and the counter both come from the hit list, so the patched hit replaces the list.
      s.liveView = { ...v, act: { ...v.act, ...p, hitList: [{ target: v.target ?? 0, amount: p.dmg, crit: p.crit, weak: p.weak }] } };
      s.redrawLive();
      s.step(20);
    }, patch);
    await page.waitForTimeout(200);
    await page.screenshot({ path: file(name) });
  }
});

test('the preset pictures: each of the four HUD presets and a box dragged off the bottom row', async ({ page }) => {
  test.skip(!MEDIA, 'set HUDPICS_MEDIA=<folder> to save the pictures');
  const { errors } = await openEditor(page, scratch);
  const canvas = page.locator('#stage canvas');
  for (const id of ['timeline-bottom3', 'ff-strip', 'action-left', 'ps4-panels']) {
    await page.locator('#s-preset').selectOption(id);
    await flush(page);
    await canvas.screenshot({ path: file(`preset-${id}-2x`) });
  }
  // The shipped layout again, then the command strip pulled up off the row: the band closes round the other two.
  await page.locator('#s-preset').selectOption('timeline-bottom3');
  await page.evaluate(() => {
    window.__stageedit?.session.edit('move the commands', (d) => {
      const s = d.stages.street;
      if (s) s.hud.commands.y = 176;
    });
  });
  await flush(page);
  await canvas.screenshot({ path: file('preset-box-off-row-2x') });
  expect(errors).toEqual([]);
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

  // 1b. A multi-hit: Kit's Hundred Rain on the Warden alone. Five numbers stack down the side of the big target and the counter says 5 HIT with their sum.
  await startFight(page, 'boss');
  await page.evaluate(() => {
    const bt = window.__stageedit?.battle();
    if (!bt) throw new Error('no battle');
    bt.press('right');
    bt.press('down');
    bt.press('down');
    bt.press('down');
    bt.press('ok'); // Kit: Hundred Rain
    for (let i = 0; i < 3; i++) {
      bt.press('left');
      bt.press('ok'); // the others guard
    }
  });
  const sums = await page.evaluate(() => {
    const scene = window.__stagelab?.scene();
    const bt = window.__stageedit?.battle();
    if (!scene || !bt) throw new Error('no battle');
    let n = 0;
    // Step to the moment the last blow's number has just come up, so all of them are still on the stage.
    let last = 0;
    while (n++ < 4000) {
      scene.step(1);
      const k = bt.perf.comboList.length;
      if (k > last) {
        last = k;
        n = 0;
      }
      if (k >= 5 && n > 2) break;
      if (k > 0 && n > 90) break;
    }
    return { counted: bt.perf.numberLog.filter((x) => x.hit !== null).map((x) => Number(x.text)), list: bt.perf.comboList.map((h) => h.amount) };
  });
  expect(sums.counted).toEqual(sums.list);
  await shot('combo-2x');
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
