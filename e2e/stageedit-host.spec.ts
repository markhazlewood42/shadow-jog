/**
 * The Battle Stage Editor's seams on the engine (ET task 5): the cases that did not exist in the Phaser spike because the spike's scene changed these things in place.
 *
 * On the engine the foot anchors (`axes`), which enemies are mirrored (`facing`) and how tall each hero stands (`heroes`) are fields of the scene's `BattleStageInit`, so a change makes
 * a NEW scene on the same stage (`StageHost.setData`), which keeps the frame and the figures' state (`snapshot` and `restore`). And the pick is the editor's own (`Figure.describe()` and
 * `TextureManager.readPixels`): it must find a figure by its drawn pixels, also when the picture is mirrored. These are new cases, not archive cases.
 */
import { expect, type Page, test } from '@playwright/test';
import type { StageEntry } from '../src/battlestage/config';
import { bodyOf, dropScratch, flush, openEditor, scratchName, toScreen } from './stageeditkit';

let scratch = '';
test.beforeEach(() => {
  scratch = scratchName('host');
});
test.afterEach(() => dropScratch(scratch));

/** A token of the running scene object: it changes when the host makes a new scene. */
const sceneToken = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const w = window as unknown as { __sceneTokens?: WeakMap<object, string>; __sceneCount?: number };
    const scene = window.__stagelab?.scene()?.scene as unknown as object;
    w.__sceneTokens ??= new WeakMap();
    w.__sceneCount ??= 0;
    let t = w.__sceneTokens.get(scene);
    if (!t) {
      w.__sceneCount += 1;
      t = `scene-${w.__sceneCount}`;
      w.__sceneTokens.set(scene, t);
    }
    return t;
  });

test('a change of the hero proportions makes a new scene on the same stage: the figures are taller, the frame and the selection are kept', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  await page.locator('#heroes li', { hasText: 'Kit' }).click();
  const token0 = await sceneToken(page);
  const before = await page.evaluate(() => ({ frame: window.__stagelab?.scene()?.scene.frame ?? 0, size: window.__stagelab?.scene()?.heroSize('kit'), figures: window.__stagelab?.scene()?.fighters.length, kitY: window.__stagelab?.scene()?.fighters[0]?.y }));
  await page.evaluate(() => {
    window.__stageedit?.session.edit('Kit taller', (d) => {
      d.heroes.kit = { height: 1.3, build: 1 };
    });
  });
  await flush(page);
  expect(await sceneToken(page)).not.toBe(token0);
  const after = await page.evaluate(() => ({ frame: window.__stagelab?.scene()?.scene.frame ?? 0, size: window.__stagelab?.scene()?.heroSize('kit'), figures: window.__stagelab?.scene()?.fighters.length, kitY: window.__stagelab?.scene()?.fighters[0]?.y, selection: window.__stageedit?.session.selectedFighters('party') }));
  expect(after.figures).toBe(before.figures);
  expect(after.kitY).toBe(before.kitY);
  expect(after.size?.now.h ?? 0).toBeGreaterThan(before.size?.now.h ?? 99);
  expect(after.size?.drawn).toEqual(before.size?.drawn);
  // The new scene carries on from the old one's frame (it restored the old one's snapshot), and the selection is the editor's, so it stays.
  expect(after.frame).toBeGreaterThanOrEqual(before.frame);
  expect(after.selection).toEqual([0]);
  // Undo makes a new scene again, back at the old size.
  await page.keyboard.press('Control+z');
  await flush(page);
  expect((await page.evaluate(() => window.__stagelab?.scene()?.heroSize('kit')))?.now).toEqual(before.size?.now);
  expect(errors).toEqual([]);
});

test('the Mirror switch of an enemy flips its picture in the scene, and the pick still finds it by its drawn pixels', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  const flipped = (): Promise<boolean[]> => page.evaluate(() => (window.__stagelab?.scene()?.fighters ?? []).filter((f) => f.side === 'enemy').map((f) => f.describe().body.flipX));
  const roster = await page.evaluate(() => [...(window.__stagelab?.scene()?.enemies ?? [])]);
  const first = await flipped();
  // Select the first enemy and turn its Mirror switch the other way.
  await page.evaluate(() => window.__stageedit?.session.select([{ kind: 'fighter', side: 'enemy', index: 0 }]));
  const box = page.locator('#enemy-mirror');
  await expect(box).toBeVisible();
  const wasOn = await box.isChecked();
  await box.setChecked(!wasOn);
  await flush(page);
  const now = await flipped();
  expect(now[0]).toBe(!wasOn);
  // The same sprite elsewhere in the group follows (it is the sprite that is mirrored, not the slot): the other punk is the same kind.
  const sameKind = roster.map((k, i) => (k === roster[0] ? i : -1)).filter((i) => i >= 0);
  for (const i of sameKind) expect(now[i]).toBe(!wasOn);
  for (let i = 0; i < roster.length; i++) if (!sameKind.includes(i)) expect(now[i]).toBe(first[i]);
  // Pick: the solid pixel nearest the middle of each enemy picks that enemy, mirrored or not, and a click on it selects it.
  for (let i = 0; i < roster.length; i++) {
    const body = await bodyOf(page, 'enemy', i);
    const at = await toScreen(page, body.x, body.y);
    await page.mouse.click(at.x, at.y);
    expect(await page.evaluate(() => window.__stageedit?.session.selectedFighters('enemy'))).toEqual([i]);
  }
  expect(errors).toEqual([]);
});

test('the pick looks at drawn pixels: the empty corner of a figure’s cell is not a hit, and the nearer figure wins where two overlap', async ({ page }) => {
  await openEditor(page, scratch);
  const out = await page.evaluate(() => {
    const host = window.__stagelab?.scene();
    if (!host) throw new Error('no scene');
    const f = host.fighters[0];
    if (!f) throw new Error('no figure');
    const b = host.boxOf(f);
    // A point well above the drawn pixels of the first hero (outside every figure) is nobody.
    const empty = host.pick(b.left + 1, Math.max(0, b.top - 40));
    // A point on the drawn body of each figure picks a figure that stands there; the figure drawn on top (the larger depth) wins.
    const picks = host.fighters.map((g) => {
      const gb = host.boxOf(g);
      for (let y = Math.floor(gb.top); y <= g.y; y++) for (let x = Math.floor(gb.left); x <= gb.right; x++) if (host.pick(x + 0.5, y + 0.5) === g) return true;
      return false;
    });
    return { empty: empty === null, picks };
  });
  expect(out.empty).toBe(true);
  expect(out.picks.every(Boolean)).toBe(true);
});

test('a save and a reload keep a proportions change and a foot anchor, and the real files are not touched', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  const realFiles = (): Promise<string> => page.evaluate(async () => JSON.stringify(await (await fetch('/__stage/stages')).json()));
  const realBefore = await realFiles();
  await page.evaluate(() => {
    const se = window.__stageedit;
    se?.session.edit('Hex taller', (d) => {
      d.heroes.hex = { height: 1, build: 1 };
    });
    se?.session.edit('Kit foot anchor', (d) => {
      d.axes.kit = { x: 1, y: 0 };
    });
  });
  expect(await page.evaluate(() => window.__stageedit?.session.dirtyParts)).toEqual(['axes', 'heroes']);
  await page.keyboard.press('Control+s');
  await expect(page.locator('#st-msg')).toContainText(/Saved to scratch copy/);
  await page.reload();
  await page.waitForFunction(() => window.__stagelab?.ready === true && !!window.__stageedit);
  const back = await page.evaluate(() => ({ hex: window.__stageedit?.session.data.heroes.hex, kit: window.__stageedit?.session.data.axes.kit, dirty: window.__stageedit?.session.dirty }));
  expect(back).toEqual({ hex: { height: 1, build: 1 }, kit: { x: 1, y: 0 }, dirty: false });
  // The real files (the endpoint without `?scratch=`) are exactly as they were.
  expect(await realFiles()).toBe(realBefore);
  const stage = (await page.evaluate(() => JSON.parse(JSON.stringify(window.__stageedit?.session.stage)))) as StageEntry;
  expect(stage.screen).toEqual({ w: 640, h: 360 });
  expect(errors).toEqual([]);
});
