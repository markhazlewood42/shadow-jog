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
