/**
 * The FX lab (dev only, `?scene=fxlab`): it opens with every preset and game moment, edits change
 * the live effects, and the dev server's save endpoint checks and formats what it's given. The
 * real Save isn't pressed here (it would rewrite src/data/fx.json): the endpoint's dry run is.
 */
import { expect, test, type Page } from '@playwright/test';

async function sj<T = unknown>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(async () => { const sj = window.__SJ__; return ${fn}; })()`) as Promise<T>;
}

// An exact 2x of the 640x360 screen (1280x720), like the config default: the lab's canvas shows at whole-pixel blocks.
test.use({ viewport: { width: 1280, height: 720 } });

test('the FX lab opens with every preset and moment, and edits play live', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?scene=fxlab');
  await expect(page.locator('#fxlab')).toBeVisible();
  const presets = await sj<string[]>(page, 'Object.keys(sj.fx.presets)');
  const listed = await page.locator('#fxlab select[size] option').allTextContents();
  expect(listed).toEqual(presets);
  // An edit (the first preset's max count, typed into its number box) changes the live data.
  const first = presets[0]!;
  const before = await sj<number[]>(page, `sj.fx.presets['${first}'].count`);
  const maxBox = page.locator('#fxlab .row', { hasText: 'max' }).first().locator('input[type=number]');
  await maxBox.fill(String((before[1] ?? 10) + 7));
  await maxBox.press('Enter');
  expect(await sj<number[]>(page, `sj.fx.presets['${first}'].count`)).toEqual([before[0], (before[1] ?? 10) + 7]);
  await expect(page.locator('#fxlab .status')).toContainText('Unsaved');
  // Clicking the picture fires it on the effects of the game (`game.fx`; level `lite` on a software renderer, `full` on a GPU).
  // The lab fires on its own every 45 frames, so stop that first: a particle count above 0 then comes from the click alone.
  expect(await sj<boolean>(page, 'sj.fxCounts().active')).toBe(true);
  await page.locator('#fxlab label', { hasText: 'Auto-repeat' }).locator('input[type=checkbox]').uncheck();
  await expect.poll(() => sj<number>(page, 'sj.fxCounts().particles')).toBe(0);
  const box = await page.locator('canvas').boundingBox();
  // A pointer event whose target is the stage itself (its margin, or an overlay in it) is not a click on the picture: no effect. Control: the click below, on the canvas, fires one.
  await page.evaluate(([x, y]) => document.getElementById('stage')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x!, clientY: y! })), [box!.x + box!.width / 2, box!.y + box!.height / 2]);
  await page.waitForTimeout(300);
  expect(await sj<number>(page, 'sj.fxCounts().particles')).toBe(0);
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect.poll(() => sj<number>(page, 'sj.fxCounts().particles')).toBeGreaterThan(0);
  // Every moment the game plays is on the Moments tab.
  await page.getByRole('button', { name: 'Moments' }).click();
  const moments = await page.locator('#fxlab select[size] option').allTextContents();
  for (const m of ['hit.fire', 'crit', 'combo', 'heal.perfect', 'down.boss', 'intro']) expect(moments.some((t) => t.startsWith(`${m}:`))).toBe(true);
  // Revert drops the edit (after its confirmation).
  page.on('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Revert' }).click();
  await expect(page.locator('#fxlab .status')).toContainText('Reloaded');
  expect(await sj<number[]>(page, `sj.fx.presets['${first}'].count`)).toEqual(before);
  expect(errors).toEqual([]);
});

test('an invalid edit shows the Unsaved state, and Save refuses it with a reason', async ({ page }) => {
  await page.goto('/?scene=fxlab');
  await expect(page.locator('#fxlab')).toBeVisible();
  const first = (await sj<string[]>(page, 'Object.keys(sj.fx.presets)'))[0]!;
  // The max count goes below the min count: checkFx rejects it, and the lab says so instead of writing the file.
  const min = await sj<number>(page, `sj.fx.presets['${first}'].count[0]`);
  const maxBox = page.locator('#fxlab .row', { hasText: 'max' }).first().locator('input[type=number]');
  await maxBox.fill(String(min - 1));
  await maxBox.press('Enter');
  await expect(page.locator('#fxlab .status')).toContainText('Unsaved');
  await page.getByRole('button', { name: 'Save to game' }).click();
  await expect(page.locator('#fxlab .status')).toContainText("Can't save");
  await expect(page.locator('#fxlab .status')).toHaveClass(/err/);
});

test('the save endpoint checks what it gets and writes fx.json in its own format', async ({ page }) => {
  await page.goto('/?scene=fxlab');
  await expect(page.locator('#fxlab')).toBeVisible();
  const [status, ok, same] = await page.evaluate(async () => {
    const file = await (await fetch('/__fxlab/fx')).json();
    const r = await fetch('/__fxlab/fx?dry=1', { method: 'POST', body: JSON.stringify(JSON.parse(file.text)) });
    const j = await r.json();
    return [r.status, j.ok, j.text === file.text.replace(/\r\n/g, '\n')];
  });
  expect(status).toBe(200);
  expect(ok).toBe(true);
  expect(same).toBe(true);
  const bad = await page.evaluate(async () => {
    const r = await fetch('/__fxlab/fx?dry=1', { method: 'POST', body: JSON.stringify({ presets: { x: { count: [5, 1] } }, moments: {} }) });
    return [r.status, (await r.json()).problems.length];
  });
  expect(bad[0]).toBe(400);
  expect(bad[1]).toBeGreaterThan(0);
});

// Pass line 14 (ET): the effects contract is the real path. The lab hands every edit to the engine's own effects system through `game.fx.loadData` (the editor contract,
// principle 11), and a bad edit leaves the last good data in place there. The lab edits its working copy of fx.json in place, so reading the shared object would pass even if the
// lab never called `loadData`: the case counts the calls instead (the control), and reads the data the effects system holds, which must be a snapshot, not that object.
test('every edit reaches game.fx through loadData, and a bad edit leaves the old data in place', async ({ page }) => {
  await page.goto('/?scene=fxlab');
  await expect(page.locator('#fxlab')).toBeVisible();
  const first = (await sj<string[]>(page, 'Object.keys(sj.fx.presets)'))[0]!;
  // Count the calls and keep what each one was given and answered.
  await page.evaluate(() => {
    const w = window as unknown as { __SJ__: { game: { fx: { loadData(d: unknown): string[] } } }; __loads: Array<{ count: number[] | null; problems: number }> };
    const fx = w.__SJ__.game.fx;
    const orig = fx.loadData.bind(fx);
    w.__loads = [];
    fx.loadData = (d: unknown) => {
      const problems = orig(d);
      w.__loads.push({ count: (d as { presets: Record<string, { count: number[] }> }).presets[Object.keys((d as { presets: object }).presets)[0]!]?.count ?? null, problems: problems.length });
      return problems;
    };
  });
  const loads = () => page.evaluate(() => (window as unknown as { __loads: Array<{ count: number[] | null; problems: number }> }).__loads);
  const held = () => sj<number[]>(page, `sj.game.fx.data.presets['${first}'].count`);
  const before = await sj<number[]>(page, `sj.fx.presets['${first}'].count`);
  const maxBox = page.locator('#fxlab .row', { hasText: 'max' }).first().locator('input[type=number]');
  // A good edit: loadData is called with the edited data, accepts it, and the effects system holds the new count.
  const good = (before[1] ?? 10) + 5;
  await maxBox.fill(String(good));
  await maxBox.press('Enter');
  await expect.poll(async () => (await loads()).length).toBeGreaterThan(0);
  const last = (await loads()).at(-1);
  expect(last).toEqual({ count: [before[0], good], problems: 0 });
  expect(await held()).toEqual([before[0], good]);
  // The effects system holds a snapshot: a later edit of the lab's working copy does not change it before loadData has accepted it.
  expect(await sj<boolean>(page, 'sj.game.fx.data !== sj.fx')).toBe(true);
  // A bad edit (max below min): loadData refuses it, the lab says so, and game.fx keeps the last good data.
  const min = before[0] ?? 1;
  const calls = (await loads()).length;
  await maxBox.fill(String(min - 1));
  await maxBox.press('Enter');
  await expect.poll(async () => (await loads()).length).toBeGreaterThan(calls);
  expect((await loads()).at(-1)?.problems).toBeGreaterThan(0);
  expect(await held()).toEqual([before[0], good]);
  await expect(page.locator('#fxlab .status')).toContainText('Unsaved');
  await expect(page.locator('#fxlab .status')).toHaveClass(/err/);
});
