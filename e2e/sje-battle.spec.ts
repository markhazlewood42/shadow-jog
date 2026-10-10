/**
 * M3 pass line 6: the battle plays end to end under the flag (`/?engine=sje`), on the stage (docs/engine/m3-brief.md tasks 5 to 7). The battle scene is the shipped one (`scenes/battle.ts`,
 * unchanged rules); the picture is the Pixi stage under it: the backdrop, the figures with shadows, the HUD, the effects and the numbers. This spec plays a WIN, a LOSS, a FLEE and a
 * BOSS INTRO, reading the state through `window.__SJ__` (the DEV hook: `battleStage` for the stage as data, `game.top` for the battle scene) and checking the HUD's pixels.
 *
 * Every check has a control (the same check on something that must fail):
 *  - the stage exists only under the flag (`battleStage` is null before a fight, gone after it, and absent on the old path);
 *  - the HUD's pixels are found in the party table and the foe box, and NOT in a part of the screen the HUD does not cover;
 *  - the draw order follows the rule (a figure whose feet are lower is drawn later); a swapped order breaks the check;
 *  - the page's own warning/error watcher sees a warning when one is made (so "0 console warnings" is a real check).
 *
 * 0 GL errors and 0 console warnings in every test: the watcher of `openGame` keeps every console error and warning and every uncaught page error.
 *
 * Run:  CI=1 PW_PORT=3011 npx playwright test e2e/sje-battle.spec.ts --reporter=line
 * Pictures (not tracked) go to test-results/m3-battle/.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { MEMBERS } from '../src/data/party';
import { decode, openGame, type GamePage, sj, unevenBlocks, waitTop, waitUntil } from './sjegamekit';

type Rect = { x: number; y: number; w: number; h: number };
const OUT = 'test-results/m3-battle';
mkdirSync(OUT, { recursive: true });

// The shipped battle uses the 640x360 set (M3 task 9): the HUD boxes are those of hud-640.json.
const HUD = (JSON.parse(readFileSync('src/data/hud-640.json', 'utf8')) as { layout: Record<'partyStatus' | 'enemyInfo', Rect> }).layout;
const rectOf = (r: { x: number; y: number; w: number; h: number }): Rect => ({ x: r.x, y: r.y, w: r.w, h: r.h });

/** How many pixels in a rectangle of the back buffer are within `tol` of this color. Runs inside the page (no pixels cross the wire). */
async function countColor(page: Page, rect: Rect, hex: string, tol = 14): Promise<number> {
  const r = Number.parseInt(hex.slice(1, 3), 16), g = Number.parseInt(hex.slice(3, 5), 16), b = Number.parseInt(hex.slice(5, 7), 16);
  return sj<number>(
    page,
    `(() => { const p = sj.pixels(${JSON.stringify(rect)}); let n = 0; for (let i = 0; i < p.data.length; i += 4) if (Math.abs(p.data[i] - ${r}) <= ${tol} && Math.abs(p.data[i + 1] - ${g}) <= ${tol} && Math.abs(p.data[i + 2] - ${b}) <= ${tol}) n++; return n; })()`,
  );
}

/** Open the game on the new engine, jump to the town and wait for the field. */
async function openField(browser: import('@playwright/test').Browser, o: { viewport?: { width: number; height: number }; dpr?: number; query?: string } = {}): Promise<GamePage> {
  const g = await openGame(browser, { engine: true, ...o });
  expect(await waitTop(g.page, 'TitleScene')).toBe(true);
  await sj(g.page, "sj.stage('town')");
  expect(await waitUntil(g.page, 'sj.top() === "FieldScene" && sj.idle()', 30_000)).toBe(true);
  return g;
}

/** Start a fight (a one-group encounter) from the field. */
async function fight(page: Page, enemies: string[], bg: string, boss = false): Promise<void> {
  await sj(page, `(sj.defineEncounter('m3b', ${JSON.stringify(enemies)}), sj.battle('m3b', '${bg}', ${boss}))`);
  expect(await waitTop(page, 'BattleScene')).toBe(true);
}

const stageThere = (page: Page) => waitUntil(page, 'sj.battleStage !== null && sj.battleStage.figures.length > 0', 30_000);
const mode = (page: Page) => sj<string | null>(page, 'sj.game.top && sj.game.top.mode ? sj.game.top.mode : null');

async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(60);
  await page.keyboard.up(key);
  await page.waitForTimeout(120);
}

/** On the round menu, choose the item with this value (`auto`, `run`...) and confirm it. */
async function chooseRound(page: Page, value: string): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const cur = await sj<string | null>(page, 'sj.game.top.roundMenu.current ? sj.game.top.roundMenu.current.value : null');
    if (cur === value) break;
    await press(page, 'ArrowDown');
  }
  await press(page, 'Enter');
}

/**
 * Play rounds until the battle scene is gone (`done` says when), taking the round menu's `value` each time it is open and confirming every results panel. Returns the largest
 * wash the stage showed on the way (the defeat drains the frame).
 */
async function playOut(page: Page, value: string, done: string, ms = 150_000): Promise<{ maxWash: number; rounds: number }> {
  const end = Date.now() + ms;
  let maxWash = 0;
  let rounds = 0;
  while (Date.now() < end) {
    if (await sj<boolean>(page, `!!(${done})`)) return { maxWash, rounds };
    const m = await mode(page);
    if (m === 'round') {
      await chooseRound(page, value);
      rounds++;
      await page.waitForTimeout(400);
    } else if (m === 'end') await press(page, 'Enter');
    else await page.waitForTimeout(150);
    maxWash = Math.max(maxWash, (await sj<number | null>(page, 'sj.battleStage ? sj.battleStage.wash : null')) ?? 0);
  }
  throw new Error(`The fight did not end in ${ms} ms (mode ${await mode(page)})`);
}

/** The rule of the draw order: of two figures, the one whose feet are lower on the screen is drawn later. */
function orderHolds(d: { figures: Array<{ id: string; y: number }>; order: string[] }): boolean {
  const at = (id: string) => d.order.indexOf(id);
  for (const a of d.figures) for (const b of d.figures) if (a.y < b.y && at(a.id) > at(b.id)) return false;
  return true;
}

test.describe.configure({ mode: 'serial' });

test.describe('the battle on the stage, under the flag', () => {
  test('a WIN: the stage stands under the fight, the HUD draws, the rules play, the stage is gone afterwards', async ({ browser }) => {
    const g = await openField(browser);
    try {
      const { page } = g;
      // Control: before a fight there is no stage.
      expect(await sj(page, 'sj.battleStage')).toBeNull();
      const battlesBefore = await sj<number>(page, 'sj.state.battles');
      await fight(page, ['rustfang_punk', 'glowrat', 'rustfang_punk'], 'street');
      await sj(page, '(sj.game.speed = 2, true)');
      expect(await stageThere(page)).toBe(true);
      expect(await waitUntil(page, 'sj.game.top.mode === "round"', 60_000)).toBe(true);

      const d = await sj<{ figures: Array<{ id: string; side: string; y: number; depth: number }>; order: string[]; camera: { zoom: number }; stageId: string; hud: { regions: number } }>(page, 'sj.battleStage');
      // Who is on stage: the two heroes of the town save and the three enemies.
      expect(d.figures.filter((f) => f.side === 'party').length).toBeGreaterThanOrEqual(2);
      expect(d.figures.filter((f) => f.side === 'enemy').map((f) => f.id.split('#')[0])).toEqual(['rustfang_punk', 'glowrat', 'rustfang_punk']);
      expect(d.stageId).toBe('street');
      expect(d.camera.zoom).toBe(1);
      expect(d.hud.regions).toBeGreaterThan(2);
      // The draw order follows the rule. Control: the same check on a swapped order fails.
      expect(orderHolds(d)).toBe(true);
      const swapped = { ...d, order: [...d.order].reverse() };
      expect(orderHolds(swapped)).toBe(false);

      // The HUD's pixels. The party table has the first hero's name in the hero's own color; the foe box has the foes' names in their pink. The sky between the timeline and the combo box, where no HUD box stands, has neither.
      const party = rectOf(HUD.partyStatus);
      const foes = rectOf(HUD.enemyInfo);
      const sky = { x: 336, y: 4, w: 130, h: 34 };
      const heroColor = MEMBERS.kit.color;
      expect(await countColor(page, party, heroColor), 'the first hero\'s name in the party table').toBeGreaterThan(8);
      expect(await countColor(page, foes, '#ffd0d0'), 'the foes\' names in the foe box').toBeGreaterThan(20);
      expect(await countColor(page, sky, heroColor), 'control: no hero-colored pixel where no HUD stands').toBe(0);
      expect(await countColor(page, sky, '#ffd0d0'), 'control: no foe-name pixel where no HUD stands').toBe(0);
      writeFileSync(`${OUT}/win-orders.png`, await page.screenshot());

      // Play the fight on Auto to the end.
      const out = await playOut(page, 'auto', 'sj.top() === "FieldScene" && sj.battleStage === null');
      expect(out.rounds).toBeGreaterThan(0);
      expect(await sj<number>(page, 'sj.state.battles')).toBe(battlesBefore + 1);
      // A win leaves the party standing, and the stage is gone.
      expect(await sj(page, 'sj.battleStage')).toBeNull();
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });

  test('a LOSS: the crew falls, the frame drains, Game Over comes up, the stage is gone', async ({ browser }) => {
    const g = await openField(browser);
    try {
      const { page } = g;
      // One hit point each, against a group that hits back.
      await sj(page, 'Object.values(sj.state.members).forEach((m) => { m.hp = 1; })');
      await fight(page, ['sewer_ghoul', 'sewer_ghoul', 'gutter_eel'], 'sewer');
      await sj(page, '(sj.game.speed = 2, true)');
      expect(await stageThere(page)).toBe(true);
      expect((await sj<{ stageId: string }>(page, 'sj.battleStage')).stageId).toBe('sewer');
      expect(await waitUntil(page, 'sj.game.top.mode === "round"', 60_000)).toBe(true);
      const out = await playOut(page, 'auto', 'sj.top() === "GameOverScene"');
      // The killing blow drained the frame toward red-black (the stage's wash), at some point on the way. Control: no wash before the blow.
      expect(out.maxWash).toBeGreaterThan(0.1);
      writeFileSync(`${OUT}/loss-gameover.png`, await page.screenshot());
      expect(await sj(page, 'sj.battleStage')).toBeNull();
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });

  test('a FLEE: Run takes the crew out of the fight, and the stage is gone', async ({ browser }) => {
    const g = await openField(browser);
    try {
      const { page } = g;
      await fight(page, ['rustfang_punk', 'scrap_hound'], 'street');
      await sj(page, '(sj.game.speed = 2, true)');
      expect(await stageThere(page)).toBe(true);
      expect(await waitUntil(page, 'sj.game.top.mode === "round"', 60_000)).toBe(true);
      // A failed escape gives the enemies a free round: run again until it works.
      const out = await playOut(page, 'run', 'sj.top() === "FieldScene" && sj.battleStage === null');
      expect(out.rounds).toBeGreaterThan(0);
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });

  test('a BOSS INTRO: the boss stands in the boss group, its tell reads, and the foe box and the on-stage bar are the boss\'s', async ({ browser }) => {
    const g = await openField(browser);
    try {
      const { page } = g;
      await fight(page, ['warden'], 'street', true);
      expect(await stageThere(page)).toBe(true);
      const d = await sj<{ figures: Array<{ id: string; side: string; bar: { ratio: number } | null }>; stageId: string }>(page, 'sj.battleStage');
      expect(d.figures.filter((f) => f.side === 'enemy').map((f) => f.id)).toEqual(['warden#0']);
      // The intro: the shatter, then the line that says who blocks the way.
      expect(await waitUntil(page, 'sj.game.top.message && /blocks the way/.test(sj.game.top.message.text)', 60_000)).toBe(true);
      expect(await waitUntil(page, 'sj.game.top.mode === "round"', 60_000)).toBe(true);
      const after = await sj<{ figures: Array<{ id: string; side: string; alpha: number; bar: { ratio: number } | null }> }>(page, 'sj.battleStage');
      const boss = after.figures.find((f) => f.id === 'warden#0');
      expect(boss?.alpha).toBe(1);
      expect(boss?.bar?.ratio).toBe(1);
      // The foe box names the boss (a lone foe reads in full), in the foe box's own pink; control: not in the sky.
      expect(await countColor(page, rectOf(HUD.enemyInfo), '#f4f1ff'), 'a name and its numbers in the foe box').toBeGreaterThan(20);
      expect(await countColor(page, { x: 4, y: 64, w: 100, h: 30 }, '#f4f1ff'), 'control: nothing like it in the open sky on the left').toBe(0);
      // Auto is not offered against a boss (the old rule): the round menu's Auto is disabled.
      expect(await sj<boolean>(page, 'sj.game.top.roundMenu.items.find((i) => i.value === "auto").enabled === false')).toBe(true);
      writeFileSync(`${OUT}/boss-orders.png`, await page.screenshot());
      // Leave the fight (the same as running, to the field).
      await sj(page, "(sj.game.top.close('run'), true)");
      expect(await waitUntil(page, 'sj.top() === "FieldScene" && sj.battleStage === null', 30_000)).toBe(true);
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });
});

test.describe('crisp pixels (M3 pass line 5, on the shipped battle)', () => {
  for (const [name, viewport, dpr] of [
    ['device pixel ratio 1', { width: 1920, height: 1080 }, 1],
    ['device pixel ratio 1.5', { width: 1280, height: 720 }, 1.5],
  ] as const) {
    test(`${name}: every 3x3 block of the picture is one flat color with the stage, the HUD, the effects and a number on screen; a wrong ratio finds uneven blocks (control)`, async ({ browser }) => {
      const g = await openField(browser, { viewport, dpr, query: '&fx=full' });
      try {
        const { page } = g;
        await fight(page, ['rustfang_punk', 'glowrat', 'rustfang_punk'], 'street');
        expect(await stageThere(page)).toBe(true);
        expect(await waitUntil(page, 'sj.game.top.mode === "round"', 60_000)).toBe(true);
        await sj(page, '(sj.game.speed = 0, true)');
        // The battle's own effects and a number, drawn now: the layers that are scaled (the effects layer is 2 stage pixels per world pixel on the 640x360 layout).
        await sj(page, "(() => { const t = sj.game.top; t.fx.play('fire_all', t.pos(0), t.battle.enemies.map((u) => t.pos(u.uid))); t.floatOn(t.battle.enemies[0].uid, '27', '#ffb23a', 'hit'); sj.step(12); sj.game.speed = 0; return true; })()");
        expect(await sj<boolean>(page, 'sj.battleStage.fxDrawn && sj.battleStage.numbers > 0'), 'the effects and the number are really on screen').toBe(true);
        const img = decode(await page.screenshot());
        expect([img.w, img.h]).toEqual([1920, 1080]);
        // 640 x 360 blocks of 3 px: the whole frame (the stage fills the 640x360 screen since task 9).
        expect(unevenBlocks(img, 3, 0, 0, 640, 360), 'uneven 3x3 blocks').toBe(0);
        expect(unevenBlocks(img, 2, 0, 0, 800, 500), 'control: a wrong ratio finds uneven blocks').toBeGreaterThan(0);
        expect(g.problems).toEqual([]);
      } finally {
        await g.close();
      }
    });
  }
});

test.describe('controls', () => {
  test('the old path has no stage, and the watcher sees a warning when one is made', async ({ browser }) => {
    const g = await openGame(browser, { engine: false });
    try {
      const { page } = g;
      expect(await waitTop(page, 'TitleScene')).toBe(true);
      await sj(page, "sj.stage('town')");
      expect(await waitUntil(page, 'sj.top() === "FieldScene" && sj.idle()', 30_000)).toBe(true);
      await fight(page, ['rustfang_punk'], 'street');
      // The old path: the battle draws itself; there is no stage and no hook member for one.
      expect(await sj<boolean>(page, '"battleStage" in sj')).toBe(false);
      expect(await sj<boolean>(page, 'sj.game.top.stage === null && sj.game.top.opaque === true')).toBe(true);
      expect(g.problems).toEqual([]);
      // The watcher is alive: a warning made in the page is kept.
      await page.evaluate(() => console.warn('a made warning'));
      await page.waitForTimeout(100);
      expect(g.problems.some((p) => /a made warning/.test(p))).toBe(true);
    } finally {
      await g.close();
    }
  });
});
