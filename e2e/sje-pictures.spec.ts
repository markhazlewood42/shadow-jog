/**
 * M3 pass line 13: the pictures for Mark's look review. LOCAL ONLY: it does nothing unless `M3_PICTURES=1`, and it is not in the CI list (it writes files and judges nothing).
 *
 *   M3_PICTURES=1 PW_PORT=3011 npx playwright test e2e/sje-pictures.spec.ts --reporter=line      (Edge on the GPU: the `gpu` set)
 *   M3_PICTURES=1 CI=1 PW_PORT=3011 npx playwright test e2e/sje-pictures.spec.ts --reporter=line (the bundled Chromium on SwiftShader: the `soft` set)
 *
 * Seven moments (and two more, the skills list and the target pick, which show where the old menus stand against the HUD), each in two variants, by one script, so the two tell the same story (the `old` variant, the Canvas 2D battle, went with the old path in M6):
 *
 *   480in640  the battle on the stage with the 480x270 stage files (Phase 0 layout, the regression parity set), drawn in the top left of the 640x360 screen (`?stageset=480`)
 *   new640    the battle on the stage with the 640x360 set (`scripts/stage-640.mjs`, the default)
 *
 *   intro    the first frames of a fight
 *   command  the command menu of the first hero
 *   attack   a hero's attack while its effect plays
 *   spell    a hero's skill while its effect plays
 *   crit     a critical number and the push camera at its peak (injected through the same calls the battle uses: `floatOn` and the `push` the `impact` of `PlaybackView` sets)
 *   victory  the rewards panel of a won fight
 *   boss     the Warden at the orders menu
 *   list     the skills list of the first hero's second command
 *   target   the target pick of that skill
 *
 * Pictures go to media/m3-stage/<kind>/<variant>-<moment>.png (git-ignored) and `media/m3-stage/<kind>/index.html` lays them out in a table. A moment that cannot be reached
 * is named in the index as missing, and the rest is still written. Not a test of behavior: sje-battle.spec.ts is.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { type Browser, type Page, test } from '@playwright/test';
import { openGame, sj, waitTop, waitUntil } from './sjegamekit';

const ON = process.env.M3_PICTURES === '1';
const KIND = process.env.CI ? 'soft' : 'gpu';
const DIR = `media/m3-stage/${KIND}`;

const VARIANTS = [
  { id: '480in640', query: '&stageset=480' },
  { id: 'new640', query: '' },
] as const;
const MOMENTS = ['intro', 'command', 'list', 'target', 'attack', 'spell', 'crit', 'victory', 'boss'] as const;
type Moment = (typeof MOMENTS)[number];

const missing: string[] = [];
const done = new Set<string>();

async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(60);
  await page.keyboard.up(key);
  await page.waitForTimeout(150);
}

const mode = (page: Page): Promise<string | null> => sj<string | null>(page, 'sj.game.top && sj.game.top.mode ? sj.game.top.mode : null');

/** Press Enter until the battle is in this mode (a few presses at most). */
async function enterUntil(page: Page, want: string, tries = 4): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if ((await mode(page)) === want) return true;
    await press(page, 'Enter');
  }
  return (await mode(page)) === want;
}

/** Freeze the game on the first frame where this expression holds (checked every frame in the page), then it is safe to take a picture. */
async function freezeWhen(page: Page, expr: string, ms = 20_000): Promise<boolean> {
  try {
    await page.waitForFunction(`(() => { const sj = window.__SJ__; if (${expr}) { sj.game.speed = 0; return true; } return false; })()`, null, { polling: 'raf', timeout: ms });
    return true;
  } catch {
    return false;
  }
}

async function shot(page: Page, variant: string, moment: Moment): Promise<void> {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(`${DIR}/${variant}-${moment}.png`, await page.screenshot());
  done.add(`${variant}-${moment}`);
}

async function open(browser: Browser, v: (typeof VARIANTS)[number]) {
  const g = await openGame(browser, { query: `&fx=full${v.query}` });
  if (!(await waitTop(g.page, 'TitleScene'))) throw new Error('no title');
  await sj(g.page, "sj.stage('annex')");
  if (!(await waitUntil(g.page, 'sj.top() === "FieldScene" && sj.idle()', 30_000))) throw new Error('no field');
  return g;
}

async function startFight(page: Page, enemies: string[], bg: string, boss = false): Promise<void> {
  await sj(page, `(sj.defineEncounter('m3pic', ${JSON.stringify(enemies)}), sj.battle('m3pic', '${bg}', ${boss}))`);
  if (!(await waitTop(page, 'BattleScene'))) throw new Error('no battle');
}

const atRound = (page: Page) => waitUntil(page, 'sj.game.top.mode === "round"', 60_000);

/** Give every hero the same order: attack the first foe (Fight, Attack, target). The first hero may pick a skill instead (`skillFirst`). */
async function orders(page: Page, skillFirst: boolean, also?: (m: 'list' | 'target') => Promise<void>): Promise<void> {
  await press(page, 'Enter'); // Fight
  for (let hero = 0; hero < 4; hero++) {
    if (!(await waitUntil(page, 'sj.game.top.mode === "command"', 8_000))) return;
    if (hero === 0 && skillFirst) {
      await press(page, 'ArrowDown');
      await press(page, 'Enter'); // the skills list
      await page.waitForTimeout(300);
      await also?.('list');
      await press(page, 'Enter'); // the first skill
    } else {
      await press(page, 'Enter'); // Attack
    }
    await enterUntil(page, 'target', 1);
    if (hero === 0 && skillFirst) {
      await page.waitForTimeout(300);
      await also?.('target');
    }
    await press(page, 'Enter'); // the first target
    await page.waitForTimeout(200);
  }
}

async function flow(browser: Browser, v: (typeof VARIANTS)[number]): Promise<void> {
  const g = await open(browser, v);
  const { page } = g;
  const step = async (m: Moment, fn: () => Promise<boolean>): Promise<void> => {
    try {
      if (await fn()) return;
      missing.push(`${v.id}-${m}: the moment was not reached`);
    } catch (e) {
      missing.push(`${v.id}-${m}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    }
  };
  try {
    await startFight(page, ['rustfang_punk', 'rustfang_slinger', 'rustfang_medic'], 'street');
    // Tough enough to live through two rounds, so the later moments are reached; the numbers shown are the battle's own.
    await sj(page, '(sj.game.top.battle.enemies.forEach((e) => { e.maxHp = 400; e.hp = 400; }), true)');
    await step('intro', async () => {
      await page.waitForTimeout(700);
      await shot(page, v.id, 'intro');
      return true;
    });
    await sj(page, '(sj.game.speed = 2, true)');
    await step('command', async () => {
      if (!(await atRound(page))) return false;
      await sj(page, '(sj.game.speed = 1, true)');
      await press(page, 'Enter'); // Fight
      if (!(await waitUntil(page, 'sj.game.top.mode === "command"', 8_000))) return false;
      await page.waitForTimeout(400);
      await shot(page, v.id, 'command');
      await press(page, 'x'); // back to the round menu
      await page.waitForTimeout(200);
      return true;
    });
    await step('attack', async () => {
      if (!(await atRound(page))) return false;
      await orders(page, false);
      if (!(await freezeWhen(page, 'sj.game.top.fx.busy'))) return false;
      await shot(page, v.id, 'attack');
      await sj(page, '(sj.game.speed = 2, true)');
      return true;
    });
    await step('spell', async () => {
      if (!(await atRound(page))) return false;
      await sj(page, '(sj.game.speed = 1, true)');
      await orders(page, true, (m) => shot(page, v.id, m));
      if (!(await freezeWhen(page, 'sj.game.top.fx.busy'))) return false;
      await shot(page, v.id, 'spell');
      await sj(page, '(sj.game.speed = 2, true)');
      return true;
    });
    await step('crit', async () => {
      if (!(await atRound(page))) return false;
      await sj(page, '(sj.game.speed = 1, true)');
      // The same calls the battle makes for a critical hit: an effect, a number in the crit style, the camera's push toward the foe.
      await sj(
        page,
        "(() => { const t = sj.game.top, e = t.battle.enemies[0], p = t.pos(e.uid); t.fx.play('fire_all', t.pos(0), t.battle.enemies.map((u) => t.pos(u.uid))); t.floatOn(e.uid, '73', '#ffd23a', 'crit'); t.push = { x: p.x, y: p.y, t: 0, life: 20 }; return true; })()",
      );
      await page.waitForFunction('window.__SJ__.game.top.push && window.__SJ__.game.top.push.t >= 4 && (window.__SJ__.game.speed = 0, true)', null, { polling: 'raf', timeout: 5_000 });
      await shot(page, v.id, 'crit');
      await sj(page, '(sj.game.speed = 2, true)');
      return true;
    });
    await step('victory', async () => {
      // Auto to the end: one hit point each, then the round menu's Auto, until the rewards panel is up.
      await sj(page, '(sj.game.top.battle.enemies.forEach((e) => { e.hp = 1; }), true)');
      const end = Date.now() + 120_000;
      while (Date.now() < end) {
        const m = await mode(page);
        if (m === 'round') {
          for (let i = 0; i < 6 && !(await sj<boolean>(page, 'sj.game.top.roundMenu.current && sj.game.top.roundMenu.current.value === "auto"')); i++) await press(page, 'ArrowDown');
          await press(page, 'Enter');
        } else if (m === 'end' && (await sj<boolean>(page, '!!sj.game.top.endPanel'))) {
          // The rewards panel, after its tally has run (the banner that sweeps in first is over in 42 frames).
          await page.waitForTimeout(2200);
          await shot(page, v.id, 'victory');
          return true;
        } else await page.waitForTimeout(120);
      }
      return false;
    });
  } finally {
    await g.close();
  }

  // The boss, on a fresh page (the first fight left the field).
  const b = await open(browser, v);
  try {
    await startFight(b.page, ['warden'], 'core', true);
    await step('boss', async () => {
      if (!(await waitUntil(b.page, 'sj.game.top.message && /blocks the way/.test(sj.game.top.message.text)', 60_000))) return false;
      if (!(await atRound(b.page))) return false;
      await b.page.waitForTimeout(500);
      await shot(b.page, v.id, 'boss');
      return true;
    });
  } finally {
    await b.close();
  }
}

test.describe('pictures for the look review (local, M3_PICTURES=1)', () => {
  test.skip(!ON, 'local only: set M3_PICTURES=1');
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(600_000);

  for (const v of VARIANTS) {
    test(`${v.id}: ${MOMENTS.join(', ')}`, async ({ browser }) => {
      await flow(browser, v);
    });
  }

  test.afterAll(() => {
    mkdirSync(DIR, { recursive: true });
    const cell = (v: string, m: string): string => (done.has(`${v}-${m}`) ? `<a href="${v}-${m}.png"><img src="${v}-${m}.png" width="480"></a>` : '<em>missing</em>');
    const rows = MOMENTS.map((m) => `<tr><th>${m}</th>${VARIANTS.map((v) => `<td>${cell(v.id, m)}</td>`).join('')}</tr>`).join('\n');
    const html = `<!doctype html><meta charset="utf-8"><title>M3 stage pictures (${KIND})</title><body style="background:#111;color:#ddd;font:14px sans-serif"><h1>M3 stage pictures (${KIND})</h1>
<p>Columns: 480in640 (the stage with the 480x270 files), new640 (the stage with the 640x360 set). Click a picture for the full size (1280x720).</p>
<table cellpadding="4"><tr><th></th>${VARIANTS.map((v) => `<th>${v.id}</th>`).join('')}</tr>\n${rows}</table>
<h2>Not reached</h2><pre>${missing.join('\n') || 'none'}</pre></body>`;
    writeFileSync(`${DIR}/index.html`, html);
  });
});
