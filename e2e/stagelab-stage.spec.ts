/**
 * The Phaser stage lab's final stage design (spike `spike/phaser-stage`, step P2): the pickers, the design's own
 * acceptance checks run on the REAL sprites, and the HUD drawn where the config says.
 *
 * The design's mockup script printed a list of checks (the gap between the sides, the edges, nothing in the top
 * HUD band...) for every enemy group on both stages. `checkFigures` (in `src/stage/rules.ts`, the same module the
 * Battle Stage Editor runs live as warnings) is that list as a function; here the browser reports the figures' real
 * sizes and it is run on all 18 groups.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/** The stages the shipped file holds (Mark may add one: nothing here hard-codes the list). */
const STAGE_IDS = Object.keys(JSON.parse(readFileSync(join(process.cwd(), 'src/data/stages.json'), 'utf8')) as Record<string, unknown>);

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

test('every enemy group on both stages can be checked against the design’s figure rules with the real sprites (advice: a break is reported, never a failure)', async ({ page }) => {
  const errors = await open(page);
  const result = await page.evaluate(async (stageIds) => {
    // (The addresses are variables so the type checker does not try to resolve them: the dev server serves them to the page.)
    const configUrl = '/src/stage/config.ts';
    const rulesUrl = '/src/stage/rules.ts';
    const axesUrl = '/src/data/axes.json';
    const { SET_KEYS } = await import(/* @vite-ignore */ configUrl);
    const { checkFigures, checkLayout } = await import(/* @vite-ignore */ rulesUrl);
    const s = window.__ss();
    // Measure the figures as the editor and Battle Test draw them: with Mark's foot-anchor corrections (axes.json).
    const { default: axes } = await import(/* @vite-ignore */ axesUrl);
    (s as unknown as { setAxes: (a: unknown) => void }).setAxes(axes);
    const report: string[] = [];
    let checked = 0;
    for (const stage of stageIds) {
      s.showStage(stage);
      const cfg = (s as unknown as { config: unknown }).config;
      for (const p of checkLayout(cfg)) report.push(`${stage}: ${p}`);
      for (const key of SET_KEYS as string[]) {
        s.setEnemySet(key);
        const boxes = s.figureBoxes() as Array<{ left: number; right: number }>;
        // Every figure was measured: a box with no size would make the rules say nothing instead of the truth.
        for (const b of boxes) if (!(b.right > b.left)) report.push(`${stage} ${key}: a figure has no width`);
        checked += boxes.length;
        for (const p of checkFigures(cfg, boxes)) report.push(`${stage} ${key}: ${p}`);
      }
    }
    return { report, checked };
  }, STAGE_IDS);
  // Mark's stages break whichever of the design's rules he chooses to break. That is his call and the rules are advice (the editor
  // lists them as warnings), so this test does not name them: it only checks that every enemy group was measured and the rules ran.
  // What the breaks are, if any, goes into the report for the person reading the run.
  expect(result.checked).toBeGreaterThan(0);
  expect(result.report.filter((p) => p.endsWith('a figure has no width'))).toEqual([]);
  if (result.report.length) test.info().annotations.push({ type: 'design-rule advice', description: result.report.join(String.fromCharCode(10)) });
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
  expect(await page.evaluate(() => window.__stagelab?.error)).toBe(`No stage "moon" (there is: ${STAGE_IDS.join(', ')})`);
  await expect(page.locator('#status')).toHaveText(/No stage "moon"/);
  await expect(page.locator('#status')).toHaveClass(/bad/);
});
