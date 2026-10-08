/**
 * The economy by hand: walking a zone turns up random fights that pay out, and a shop takes the
 * cred and hands over the goods. Driven with the keyboard; the debug API only places the crew
 * and reads state.
 */
import { expect, test, type Page } from '@playwright/test';

async function sj<T = unknown>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(async () => { const sj = window.__SJ__; return ${fn}; })()`) as Promise<T>;
}

async function tap(page: Page, key: string, hold = 60): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(hold);
  await page.keyboard.up(key);
}

async function waitFor(page: Page, cond: string, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await sj<boolean>(page, cond)) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

test('walking the Barrens turns up fights that pay out', async ({ page }) => {
  await page.goto('/?debug');
  await page.waitForTimeout(800);
  await sj(page, "sj.stage('town')");
  await page.waitForTimeout(1200);
  await sj(page, "sj.tp('world', 13, 22, 'right')");
  await page.waitForTimeout(900);
  // A stretch of open Barrens: found on the world map rather than hard-coded.
  const start = await sj<[number, number] | null>(page, `(() => {
    const m = sj.field().map;
    for (let y = 2; y < m.h - 2; y++) for (let x = 2; x < m.w - 8; x++) {
      let ok = true;
      for (let k = 0; k < 6; k++) if (m.at(x + k, y) !== 'w_barrens' || m.solid[y * m.w + x + k]) { ok = false; break; }
      if (ok) return [x, y];
    }
    return null;
  })()`);
  expect(start, 'an open stretch of Barrens on the world map').not.toBeNull();
  await sj(page, `sj.tp('world', ${start![0]}, ${start![1]}, 'right')`);
  await page.waitForTimeout(900);
  await waitFor(page, 'sj.idle()', 3000);
  const cred0 = await sj<number>(page, 'sj.state.cred');
  const battles0 = await sj<number>(page, 'sj.state.battles');

  // Pace back and forth until a fight starts.
  let fought = false;
  for (let lap = 0; lap < 40 && !fought; lap++) {
    const dir = lap % 2 ? 'ArrowLeft' : 'ArrowRight';
    await page.keyboard.down(dir);
    fought = await waitFor(page, "sj.top() === 'BattleScene'", 1200);
    await page.keyboard.up(dir);
  }
  expect(fought, 'a random encounter within 40 laps').toBe(true);

  // The fight itself plays out on Auto (the playtest driver picks Auto and confirms the results
  // panels); what's under test here is the walk and the payout.
  await sj(page, '(Object.assign(sj.debug, { playtest: true }), true)');
  await waitFor(page, "sj.top() === 'FieldScene'", 60_000);
  await sj(page, '(Object.assign(sj.debug, { playtest: false }), true)');
  expect(await sj<string>(page, 'sj.top()')).toBe('FieldScene');
  expect(await sj<number>(page, 'sj.state.battles')).toBe(battles0 + 1);
  expect(await sj<number>(page, 'sj.state.cred')).toBeGreaterThan(cred0);
});

test('a shop takes the cred and hands over the goods', async ({ page }) => {
  await page.goto('/?debug');
  await page.waitForTimeout(800);
  await sj(page, "sj.stage('town')");
  await page.waitForTimeout(1200);
  await sj(page, '(sj.state.cred = 500, true)');
  // Stand below the armory door and walk in.
  await sj(page, "sj.tp('lantern_row', 12, 7, 'up')");
  await page.waitForTimeout(800);
  await tap(page, 'ArrowUp', 200);
  expect(await waitFor(page, "sj.state.map === 'armory' && sj.idle()", 4000), 'walked into the armory').toBe(true);
  // Up to the counter, and talk to Brother Tomas.
  for (let i = 0; i < 3; i++) {
    await tap(page, 'ArrowUp', 200);
    await page.waitForTimeout(150);
  }
  let shop = false;
  for (let i = 0; i < 6 && !shop; i++) {
    await tap(page, 'z');
    shop = await waitFor(page, "sj.top() === 'ShopScene'", 800);
  }
  expect(shop, 'the shop opened').toBe(true);
  const inv0 = await sj<Record<string, number>>(page, '({ ...sj.state.inventory })');
  // Buy → first item → quantity 1 → confirm.
  await page.waitForTimeout(400);
  for (const k of ['Enter', 'Enter', 'Enter']) {
    await tap(page, k);
    await page.waitForTimeout(300);
  }
  const cred = await sj<number>(page, 'sj.state.cred');
  const inv = await sj<Record<string, number>>(page, '({ ...sj.state.inventory })');
  expect(cred).toBeLessThan(500);
  const bought = Object.keys(inv).filter((k) => (inv[k] ?? 0) > (inv0[k] ?? 0));
  expect(bought.length, 'one item line went up').toBe(1);
  // Leave the shop and walk back out to the street.
  for (let i = 0; i < 4 && (await sj<string>(page, 'sj.top()')) === 'ShopScene'; i++) {
    await tap(page, 'x');
    await page.waitForTimeout(400);
  }
  expect(await waitFor(page, "sj.top() === 'FieldScene'", 3000)).toBe(true);
  for (let i = 0; i < 8 && (await sj<string>(page, 'sj.state.map')) === 'armory'; i++) await tap(page, 'ArrowDown', 220);
  expect(await waitFor(page, "sj.state.map === 'lantern_row'", 4000), 'back on the street').toBe(true);
});

test('selling loot turns it into cred', async ({ page }) => {
  await page.goto('/?debug');
  await page.waitForTimeout(800);
  await sj(page, "sj.stage('town')");
  await waitFor(page, 'sj.idle()', 3000);
  await sj(page, "(sj.state.inventory = { gang_colors: 2, medkit: 1 }, sj.state.cred = 100, true)");
  await sj(page, "sj.shop('lr_weapons')");
  expect(await waitFor(page, "sj.top() === 'ShopScene'", 3000)).toBe(true);
  await page.waitForTimeout(400);
  // Root menu: Buy, Sell, Leave. Sell -> the first row, "Sell all loot" -> "Sell it all".
  await tap(page, 'ArrowDown');
  await page.waitForTimeout(200);
  for (const k of ['Enter', 'Enter', 'Enter']) {
    await tap(page, k);
    await page.waitForTimeout(300);
  }
  const cred = await sj<number>(page, 'sj.state.cred');
  const inv = await sj<Record<string, number>>(page, '({ ...sj.state.inventory })');
  expect(cred).toBeGreaterThan(100);
  expect(inv.gang_colors ?? 0, 'every piece of loot went').toBe(0);
  expect(inv.medkit, 'supplies are not loot: kept').toBe(1);
});

test('gear bought in a shop can be put on there and then', async ({ page }) => {
  await page.goto('/?debug');
  await page.waitForTimeout(800);
  await sj(page, "sj.stage('town')");
  await waitFor(page, 'sj.idle()', 3000);
  await sj(page, '(sj.state.cred = 5000, true)');
  await sj(page, "sj.shop('lr_weapons')");
  expect(await waitFor(page, "sj.top() === 'ShopScene'", 3000)).toBe(true);
  await page.waitForTimeout(400);
  // Buy -> first item -> quantity 1 -> the equip picker -> its first eligible member.
  for (const k of ['Enter', 'Enter', 'Enter', 'Enter']) {
    await tap(page, k);
    await page.waitForTimeout(300);
  }
  const worn = await sj<string[]>(page, "Object.values(sj.state.members).map((m) => m.equip.weapon)");
  const first = 'iron_knuckles'; // the shelf's first item: Kit's, so the picker offers Kit
  expect(worn, 'someone is holding the new weapon').toContain(first);
});

/**
 * The four-corner walk (WP3 of docs/PIVOT-640.md, decision D17): every map that scrolls, with the
 * camera put at the four corners of its clamp, which are the extremes of what the wider view can
 * show. At each corner the camera must rest exactly on the clamp (the view inside the map, so no
 * void and no unpainted strip beyond the map's own edge), a map narrower than the view must be
 * centered, and the only camera limit and curtains in force are the ones the pop-in table ships
 * (Mark's Review 3 picks: P4's camera limit on the Rustyard, P1 and P2's curtains on the Annex).
 * Where a limit lets the view go past the map's edge (the Rustyard's south edge), the surround of
 * that map shows there, so the view is not inside the map on that side.
 *
 * Pictures: set `SJ_CORNER_SHOTS=<folder>` to save one shot of each corner (the review set goes to
 * media/pivot-640/wp3/corners/). Unset, as in CI, the walk writes nothing.
 */
const CORNER_MAPS: { map: string; stage: string }[] = [
  { map: 'lantern_row', stage: 'start' },
  { map: 'world', stage: 'town' },
  { map: 'rustyard', stage: 'town' },
  { map: 'sinkline_1', stage: 'sinkline' },
  { map: 'annex', stage: 'annex' },
];

test('the camera at the four corners of every scrolling map rests on the clamp and shows no void', async ({ page }) => {
  test.setTimeout(180_000);
  const shots = process.env.SJ_CORNER_SHOTS;
  const [W, H] = await (async () => {
    await page.goto('/?debug');
    await page.waitForTimeout(800);
    return sj<[number, number]>(page, "(async () => { const g = await import('/src/engine/game.ts'); return [g.W, g.H]; })()");
  })();
  for (const { map, stage } of CORNER_MAPS) {
    await sj(page, `sj.stage('${stage}')`);
    await page.waitForTimeout(900);
    // The chapter's end flag keeps the Dock's cutscene (a dev teleport crashes the tab) away; `intro` skips the opening.
    await sj(page, '(sj.state.flags.chapter_end = true, sj.state.flags.intro = true, true)');
    if (map !== (await sj<string>(page, 'sj.field().def.id'))) await sj(page, `sj.tp('${map}', ${stage === 'town' && map === 'rustyard' ? '15, 22' : '10, 10'}, 'down')`);
    await page.waitForTimeout(1200);
    const [mw, mh] = await sj<[number, number]>(page, '[sj.field().map.w * 16, sj.field().map.h * 16]');
    // The pop-in table's picks: P4 limits the Rustyard's camera (maxY 128), P1 and P2 are curtains on the Annex.
    const box = await sj<{ minX?: number; maxX?: number; minY?: number; maxY?: number } | null>(page, 'sj.field().cameraBox');
    expect(box, `${map}: the camera limit`).toEqual(map === 'rustyard' ? { maxY: 128 } : null);
    expect(await sj<number>(page, 'sj.field().curtains.length'), `${map}: the curtains`).toBe(map === 'annex' ? 2 : 0);
    const corners: [string, number, number][] = [['tl', 0, 0], ['tr', mw, 0], ['bl', 0, mh], ['br', mw, mh]];
    for (const [name, fx, fy] of corners) {
      await sj(page, `(sj.field().camOverride = { x: ${fx}, y: ${fy} }, sj.field().snapCamera(), true)`);
      await page.waitForTimeout(250);
      const cam = await sj<{ x: number; y: number }>(page, '({ x: sj.field().camX, y: sj.field().camY })');
      // A map narrower (shorter) than the view is centered; a wider (taller) one rests on its far edge.
      // A camera limit replaces the map's own edge on its side (the Rustyard's maxY lets the view go 40 px past the south edge).
      const wantX = mw <= W ? Math.round((mw - W) / 2) : fx === 0 ? (box?.minX ?? 0) : (box?.maxX ?? mw - W);
      const wantY = mh <= H ? Math.round((mh - H) / 2) : fy === 0 ? (box?.minY ?? 0) : (box?.maxY ?? mh - H);
      expect(cam, `${map} ${name}`).toEqual({ x: wantX, y: wantY });
      if (mw > W && !box) expect(cam.x >= 0 && cam.x + W <= mw, `${map} ${name}: the view is inside the map across`).toBe(true);
      if (mh > H && !box) expect(cam.y >= 0 && cam.y + H <= mh, `${map} ${name}: the view is inside the map down`).toBe(true);
      if (shots) await page.locator('#screen').screenshot({ path: `${shots}/${map}-${name}.png` });
    }
    await sj(page, '(sj.field().camOverride = null, true)');
  }
});
