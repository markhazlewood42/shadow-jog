/**
 * The Phaser stage lab's final stage design (spike `spike/phaser-stage`, step P2): the pickers, the design's own
 * acceptance checks run on the REAL sprites, and the HUD drawn where the config says.
 *
 * The design's mockup script printed a list of checks (the lane between the sides, the edges, nothing in the top
 * HUD band...) for every enemy group on both stages. `checkFigures` is that list as a function; here the browser
 * reports the figures' real sizes and it is run on all 18 groups.
 */
import { expect, type Page, test } from '@playwright/test';
import { hideStatus, openLab } from './stagelabkit';

type Scene = {
  config: { id: string };
  enemySet: string;
  currentPhase: string;
  fighters: Array<{ side: string; id: string }>;
  figureBoxes: () => unknown[];
  setEnemySet: (k: string) => void;
  showStage: (id: string) => void;
  setPhase: (p: string) => void;
  currentView: never;
};
declare global {
  interface Window {
    __ss: () => Scene;
  }
}

async function open(page: Page, query = ''): Promise<string[]> {
  await page.addInitScript(() => {
    window.__ss = () => {
      const s = window.__stagelab?.scene();
      if (!s) throw new Error('no scene yet');
      return s as unknown as Scene;
    };
  });
  return openLab(page, query);
}

test('the address and the three pickers choose the stage, the enemy group and the moment of the turn', async ({ page }) => {
  const errors = await open(page, '?stage=sewer&set=boss&phase=target');
  expect(await page.evaluate(() => [window.__ss().config.id, window.__ss().enemySet, window.__ss().currentPhase])).toEqual(['sewer', 'boss', 'target']);
  expect(await page.locator('#pick-stage').inputValue()).toBe('sewer');
  expect(await page.locator('#pick-set').inputValue()).toBe('boss');
  expect(await page.locator('#pick-phase').inputValue()).toBe('target');

  await page.selectOption('#pick-stage', 'street');
  await page.selectOption('#pick-set', '6');
  await page.selectOption('#pick-phase', 'act');
  expect(await page.evaluate(() => [window.__ss().config.id, window.__ss().enemySet, window.__ss().currentPhase])).toEqual(['street', '6', 'act']);
  expect(await page.evaluate(() => window.__ss().fighters.filter((f) => f.side === 'enemy').length)).toBe(6);

  // H hides the pickers (a screenshot of the stage should be only the stage), and shows them again.
  await page.keyboard.press('h');
  await expect(page.locator('#labbar')).toBeHidden();
  await page.keyboard.press('h');
  await expect(page.locator('#labbar')).toBeVisible();
  expect(errors).toEqual([]);
});

test('without the pickers (?clean) the page is only the stage', async ({ page }) => {
  const errors = await open(page, '?clean');
  expect(await page.locator('#labbar select').count()).toBe(0);
  expect(errors).toEqual([]);
});

test('every enemy group on both stages passes the design’s figure checks with the real sprites', async ({ page }) => {
  const errors = await open(page);
  const result = await page.evaluate(async () => {
    const url = '/src/stage/config.ts';
    const { checkFigures, checkLayout, SET_KEYS } = await import(/* @vite-ignore */ url);
    const s = window.__ss();
    const report: string[] = [];
    for (const stage of ['street', 'sewer']) {
      s.showStage(stage);
      const cfg = (s as unknown as { config: unknown }).config;
      for (const p of checkLayout(cfg)) report.push(`${stage}: ${p}`);
      for (const key of SET_KEYS as string[]) {
        s.setEnemySet(key);
        for (const p of checkFigures(cfg, s.figureBoxes())) report.push(`${stage} ${key}: ${p}`);
      }
    }
    return report;
  });
  expect(result).toEqual([]);
  expect(errors).toEqual([]);
});

test('the HUD is drawn where the config puts it: the window outlines land on the boxes’ corners, in the game’s outline colour', async ({ page }) => {
  const errors = await open(page);
  await hideStatus(page);
  const hud = await page.evaluate(() => {
    const cfg = (window.__ss() as unknown as { config: { hud: Record<string, { x: number; y: number; w: number; h: number }> } }).config;
    return cfg.hud;
  });
  const corners: Array<[number, number]> = [];
  for (const k of ['turnOrder', 'partyStatus', 'commands', 'enemyInfo'])
    corners.push([hud[k]?.x ?? 0, hud[k]?.y ?? 0], [(hud[k]?.x ?? 0) + (hud[k]?.w ?? 0) - 1, (hud[k]?.y ?? 0) + (hud[k]?.h ?? 0) - 1]);
  const colours = await page.evaluate((pts) => window.__stagelab?.pixels(pts) ?? Promise.reject(new Error('no hook')), corners);
  for (const c of colours) expect(c).toBe('#07060d');
  // The accent: the commands window has its corner pieces in the acting hero's colour; the party table is plain.
  const lit = await page.evaluate((pts) => window.__stagelab?.pixels(pts) ?? Promise.reject(new Error('no hook')), [[(hud.commands?.x ?? 0) + 2, (hud.commands?.y ?? 0) + 1]] as Array<[number, number]>);
  expect(lit[0]).not.toBe('#07060d');
  expect(errors).toEqual([]);
});

test('the party table shows real numbers, and the moment changes what the HUD says', async ({ page }) => {
  const errors = await open(page);
  const view = async (): Promise<{ party: Array<{ name: string; hp: number; maxHp: number; resLabel: string }>; banner: string | null; phase: string }> => page.evaluate(() => window.__ss().currentView);
  const choose = await view();
  expect(choose.party.map((m) => m.name)).toEqual(['Kit', 'Rook', 'Hex', 'Sable']);
  expect(choose.party.every((m) => m.hp === m.maxHp && m.maxHp > 30)).toBe(true);
  expect(choose.party.map((m) => m.resLabel)).toEqual(['KI', '—', 'RAM', 'MANA']);
  await page.evaluate(() => window.__ss().setPhase('act'));
  const act = await view();
  expect(act.phase).toBe('act');
  expect(act.banner).toMatch(/^Rook: /);
  expect(errors).toEqual([]);
});

test('a wrong stage in the address is one readable message naming the stages there are, shown in red on the page', async ({ page }) => {
  await open(page, '?stage=moon');
  expect(await page.evaluate(() => window.__stagelab?.error)).toBe('No stage "moon" (there is: street, sewer)');
  await expect(page.locator('#status')).toHaveText(/No stage "moon"/);
  await expect(page.locator('#status')).toHaveClass(/bad/);
});
