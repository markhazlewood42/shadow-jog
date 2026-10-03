/**
 * Battle Stage Editor, polish round 2 (`/stageedit.html`, spike `spike/phaser-stage`): what Mark's judges asked for
 * after round 1, driven with a real mouse and keyboard on a private scratch copy of the data.
 *
 * Align that does what it says (the middle row, fighters packed on one row), shortcuts that the browser leaves alone,
 * tooltips that stay open and sit beside the panel, Shift/Ctrl+click in the explorer, the Mouse group of the Keys list,
 * the Stage settings button, the wording and the state of the status line, "mixed" values, the collapsible left panel
 * for laptops, and the design's rules as live warnings (a red outline, the Warnings chip, the status-bar line).
 */
import { expect, type Page, test } from '@playwright/test';
import type { StageEntry } from '../src/stage/config';
import { RESERVED } from '../src/stage/edit/keys';
import { canvasRect, dropScratch, flush, openEditor, scratchName, waitReady } from './stageeditkit';
import { HAVE_SPRITES, MARKS_FIGURE_BREAKS } from './stagelabkit';

const stageOf = (page: Page): Promise<StageEntry> => page.evaluate(() => JSON.parse(JSON.stringify(window.__stageedit?.session.stage)) as StageEntry);
const select = (page: Page, items: Array<{ side: 'party' | 'enemy'; index: number }>): Promise<void> =>
  page.evaluate((list) => {
    window.__stageedit?.session.select(list.map((i) => ({ kind: 'fighter' as const, side: i.side, index: i.index })));
  }, items);

test.describe.configure({ mode: 'serial' });

let scratch = '';
test.beforeEach(() => {
  scratch = scratchName('polish2');
});
test.afterEach(() => dropScratch(scratch));

// ---------------------------------------------------------------- A, B: Align

test('Align Middle puts one fighter on the middle row by count: row 3 of 5', async ({ page }) => {
  await openEditor(page, scratch);
  await page.locator('#heroes li', { hasText: 'Kit' }).click();
  await page.locator('.alb[data-align="middle"]').click();
  expect((await stageOf(page)).party[0]?.row).toBe(2);
  await expect(page.locator('#st-msg')).toContainText('middle row');
  await page.locator('.alb[data-align="front"]').click();
  expect((await stageOf(page)).party[0]?.row).toBe(4);
  await page.keyboard.press('Control+Alt+v');
  expect((await stageOf(page)).party[0]?.row).toBe(2);
});

test('Align left, centre and right pack fighters that share a row, in their old order, and the status line says so', async ({ page }) => {
  await openEditor(page, scratch);
  // Three enemies on one row, standing at x 360, 300 and 420 (left to right: the 2nd, the 1st, the 3rd).
  await page.locator('#seg-set button[data-set="3"]').click();
  await page.evaluate(() => {
    window.__stageedit?.session.edit('Three on one row', (d) => {
      const s = d.stages.street as StageEntry;
      s.enemySets['3'] = [
        { x: 360, row: 2 },
        { x: 300, row: 2 },
        { x: 420, row: 2 },
      ];
    });
  });
  await flush(page);
  /** Left-to-right order of the three (their slot numbers), and the smallest gap between neighbouring drawn edges. */
  const layout = (): Promise<{ order: number[]; gap: number }> =>
    page.evaluate(() => {
      const sc = window.__stagelab?.scene();
      if (!sc) throw new Error('no scene');
      const foes = sc.fighters.filter((f) => f.side === 'enemy').map((f, i) => ({ i, b: sc.boxOf(f) }));
      foes.sort((a, b) => a.b.left - b.b.left);
      const gaps = foes.slice(1).map((f, k) => f.b.left - (foes[k]?.b.right ?? 0));
      return { order: foes.map((f) => f.i), gap: Math.min(...gaps) };
    });
  const before = await layout();
  expect(before.order).toEqual([1, 0, 2]);
  await select(page, [0, 1, 2].map((index) => ({ side: 'enemy' as const, index })));
  for (const how of ['left', 'right', 'centre'] as const) {
    await page.locator(`.alb[data-align="${how}"]`).click();
    await flush(page);
    const now = await layout();
    expect(now.order, `${how}: the order stays`).toEqual([1, 0, 2]);
    expect(now.gap, `${how}: no overlap, the minimum gap`).toBeGreaterThanOrEqual(2);
    expect(now.gap, `${how}: packed tight`).toBeLessThanOrEqual(3);
    await expect(page.locator('#st-msg')).toContainText('packed side by side');
    await expect(page.locator('#st-msg')).toContainText('3 of them share a row');
  }
  // Fighters each alone on a row line up as before, and the message does not claim any packing.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.evaluate(() => {
    window.__stageedit?.session.edit('Three rows', (d) => {
      const s = d.stages.street as StageEntry;
      s.enemySets['3'] = [
        { x: 360, row: 1 },
        { x: 300, row: 2 },
        { x: 420, row: 3 },
      ];
    });
  });
  await select(page, [0, 1, 2].map((index) => ({ side: 'enemy' as const, index })));
  await page.locator('.alb[data-align="left"]').click();
  await expect(page.locator('#st-msg')).not.toContainText('packed');
  // Spread across keeps the order too.
  await page.evaluate(() => {
    window.__stageedit?.session.edit('Three on one row', (d) => {
      const s = d.stages.street as StageEntry;
      s.enemySets['3'] = [
        { x: 360, row: 2 },
        { x: 300, row: 2 },
        { x: 440, row: 2 },
      ];
    });
  });
  await select(page, [0, 1, 2].map((index) => ({ side: 'enemy' as const, index })));
  await page.locator('.alb[data-align="spreadAcross"]').click();
  await flush(page);
  expect((await layout()).order).toEqual([1, 0, 2]);
});

// ---------------------------------------------------------------- C, G: keys and the Mouse group

test('the Align keys avoid the browser’s: Ctrl+Alt+letter works, a plain Alt+D does nothing, and the Keys list shows no reserved key', async ({ page }) => {
  await openEditor(page, scratch);
  await page.locator('#heroes li', { hasText: 'Hex' }).click();
  const x0 = (await stageOf(page)).party[2]?.x;
  await page.keyboard.press('Alt+d');
  expect((await stageOf(page)).party[2]?.x).toBe(x0);
  await page.keyboard.press('Control+Alt+d');
  const x1 = (await stageOf(page)).party[2]?.x ?? 0;
  expect(x1).toBeGreaterThan(x0 ?? 0);
  await expect(page.locator('#st-msg')).toContainText('right edge');
  // The tooltip of the Right button shows the new key.
  await expect(page.locator('.alb[data-align="right"]')).toHaveAttribute('title', /Ctrl\+Alt\+D/);
  await page.locator('#b-keys').click();
  const keys = await page.evaluate(() => [...document.querySelectorAll('.dlg kbd')].map((k) => k.textContent ?? ''));
  expect(keys).toContain('Ctrl+Alt+D');
  for (const k of keys) expect(RESERVED).not.toContain(k);
  expect(keys).not.toContain('Ctrl+L');
  await page.keyboard.press('Escape');
});

test('the Keys list has a Mouse group (Shift+click, Shift+drag, Ctrl+drag), and the help mentions the same', async ({ page }) => {
  await openEditor(page, scratch);
  await page.locator('#b-keys').click();
  const dlg = page.locator('.dlg');
  await expect(dlg.locator('th', { hasText: 'Mouse' })).toBeVisible();
  // The list opens at its top, with the Mouse group in view (not scrolled down to the Close button).
  expect(await dlg.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(dlg.locator('th', { hasText: 'Mouse' })).toBeInViewport();
  await expect(dlg).toContainText('Shift+click');
  await expect(dlg).toContainText('Add it to the selection');
  await expect(dlg).toContainText('Shift+drag');
  await expect(dlg).toContainText('sideways or up and down');
  await expect(dlg).toContainText('Ctrl+drag');
  await expect(dlg).toContainText('Flip the grid');
  await page.keyboard.press('Escape');
  await page.locator('#b-help').click();
  await expect(page.locator('.dlg')).toContainText('Shift+click');
  await expect(page.locator('.dlg')).toContainText('Shift+drag');
  await expect(page.locator('.dlg')).toContainText('Ctrl+drag');
});

// ---------------------------------------------------------------- D, E: tooltips

test('a tooltip opened by keyboard focus stays open (the scroll that focus causes does not close it)', async ({ page }) => {
  await openEditor(page, scratch);
  const tip = page.locator('#tipbubble');
  // The last "?" of the inspector is far down the panel, so focusing it scrolls the panel.
  const last = page.locator('#inspector .qm').last();
  await last.focus();
  await page.waitForTimeout(600);
  await expect(tip).toBeVisible();
  expect((await tip.innerText()).length).toBeGreaterThan(20);
  // A real scroll by the user still closes it.
  await page.locator('#inspector').evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(tip).toBeHidden();
});

test('an inspector tooltip opens beside the whole right panel and does not cover its label; a left panel one opens beside the left panel', async ({ page }) => {
  await openEditor(page, scratch);
  const tip = page.locator('#tipbubble');
  const label = page.locator('#inspector .lab', { hasText: 'Haze, row 2' }).first();
  await label.locator('.qm').hover();
  await expect(tip).toBeVisible();
  const b = await tip.boundingBox();
  const panel = await page.locator('#right').boundingBox();
  const lab = await label.boundingBox();
  expect((b?.x ?? 0) + (b?.width ?? 0)).toBeLessThanOrEqual((panel?.x ?? 0) + 0.5);
  // No overlap with the label.
  const overlap = !!b && !!lab && b.x < lab.x + lab.width && b.x + b.width > lab.x && b.y < lab.y + lab.height && b.y + b.height > lab.y;
  expect(overlap).toBe(false);
  await page.mouse.move(700, 20);
  await expect(tip).toBeHidden();
  // The left panel's "?" opens to the right of that panel, over the stage.
  await page.locator('#explorer h2 .qm').hover();
  await expect(tip).toBeVisible();
  const lb = await tip.boundingBox();
  const lp = await page.locator('#left').boundingBox();
  expect(lb?.x ?? 0).toBeGreaterThanOrEqual((lp?.x ?? 0) + (lp?.width ?? 0) - 0.5);
});

// ---------------------------------------------------------------- F: the explorer

test('Shift+click and Ctrl+click in Who’s standing here add to and remove from the selection, so align works from the panel', async ({ page }) => {
  await openEditor(page, scratch);
  const sel = (): Promise<number[]> => page.evaluate(() => window.__stageedit?.session.selectedFighters('party') ?? []);
  await page.locator('#heroes li', { hasText: 'Kit' }).click();
  await page.locator('#heroes li', { hasText: 'Hex' }).click({ modifiers: ['Shift'] });
  expect(await sel()).toEqual([0, 2]);
  await page.locator('#heroes li', { hasText: 'Rook' }).click({ modifiers: ['Control'] });
  expect(await sel()).toEqual([0, 2, 1]);
  await page.locator('#heroes li', { hasText: 'Kit' }).click({ modifiers: ['Control'] });
  expect(await sel()).toEqual([2, 1]);
  await expect(page.locator('#heroes li.on')).toHaveCount(2);
  // Two selected: align to each other works from here (they are on different rows, so they share a left edge).
  await page.locator('.alb[data-align="left"]').click();
  const s = await stageOf(page);
  await flush(page);
  const edges = await page.evaluate(() => {
    const sc = window.__stagelab?.scene();
    const mates = sc?.fighters.filter((f) => f.side === 'party') ?? [];
    return [1, 2].map((i) => Math.round(sc?.boxOf(mates[i] as never).left ?? -1));
  });
  expect(Math.abs((edges[0] ?? 0) - (edges[1] ?? 99))).toBeLessThanOrEqual(1);
  expect(s.party[1]).toBeDefined();
  // A plain click starts over.
  await page.locator('#heroes li', { hasText: 'Sable' }).click();
  expect(await sel()).toEqual([3]);
  // Enemies: Shift+click on one standing on the stage selects its slot, and a second one adds to it.
  const here = page.locator('#enemies li', { has: page.locator('small', { hasText: 'here' }) });
  expect(await here.count()).toBeGreaterThanOrEqual(2);
  await here.nth(0).click({ modifiers: ['Shift'] });
  await here.nth(1).click({ modifiers: ['Shift'] });
  expect((await page.evaluate(() => window.__stageedit?.session.selectedFighters('enemy') ?? [])).length).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#inspector')).toContainText('enemies');
});

// ---------------------------------------------------------------- H: the Stage settings button

test('with something selected a "Stage settings" button is at the top of the inspector, and it clears the selection', async ({ page }) => {
  await openEditor(page, scratch);
  await expect(page.locator('#stage-settings')).toHaveCount(0);
  await page.locator('#heroes li', { hasText: 'Kit' }).click();
  const button = page.locator('#inspector #stage-settings');
  await expect(button).toBeVisible();
  await expect(button).toHaveText('Stage settings');
  // It is the first thing in the panel, on screen without scrolling.
  const top = await button.boundingBox();
  const panel = await page.locator('#inspector').boundingBox();
  expect((top?.y ?? 999) - (panel?.y ?? 0)).toBeLessThan(40);
  await expect(page.locator('#inspector .backhint')).toHaveCount(0);
  await button.click();
  expect(await page.evaluate(() => window.__stageedit?.session.selection.length)).toBe(0);
  await expect(page.locator('#inspector')).toContainText('Shadows');
  await expect(page.locator('#stage-settings')).toHaveCount(0);
});

// ---------------------------------------------------------------- I: the server checks overrides against the global HUD on disk

test('the stage endpoint checks a stage’s HUD overrides against the global hud.json on disk', async ({ page }) => {
  await openEditor(page, scratch);
  const hud = await page.evaluate(async (name) => (await (await fetch(`/__stage/hud?scratch=${name}`)).json()) as { hud: string }, scratch);
  const file = JSON.parse(hud.hud) as { layout: { commands: { x: number; w: number } } };
  // An override that moves the commands box to x 300 and leaves its width to the global layout.
  const stages = await page.evaluate(async (name) => JSON.parse(((await (await fetch(`/__stage/stages?scratch=${name}`)).json()) as { stages: string }).stages) as Record<string, StageEntry>, scratch);
  (stages.street as StageEntry).hud = { commands: { x: 300 } };
  const post = (url: string, body: unknown) => page.request.post(url, { data: body, headers: { 'Content-Type': 'application/json' } });
  // With the narrow global box (w 100) the override fits...
  file.layout.commands.w = 100;
  expect((await post(`/__stage/hud?scratch=${scratch}`, { layout: file.layout })).ok()).toBe(true);
  expect((await post(`/__stage/stages?scratch=${scratch}&dry=1`, { stages, axes: {} })).ok()).toBe(true);
  // ...and is refused once the global box has been widened, even though the posted body never mentions the HUD.
  file.layout.commands.w = 300;
  expect((await post(`/__stage/hud?scratch=${scratch}`, { layout: file.layout })).ok()).toBe(true);
  const refused = await post(`/__stage/stages?scratch=${scratch}&dry=1`, { stages, axes: {} });
  expect(refused.status()).toBe(400);
  const body = (await refused.json()) as { ok: boolean; problems: string[] };
  expect(body.ok).toBe(false);
  expect(body.problems.join(' ')).toMatch(/street/);
});

// ---------------------------------------------------------------- J: wording and state

test('the Save tooltip names the files that would be written, undo says what it undid, and a new stage clears the status line', async ({ page }) => {
  await openEditor(page, scratch);
  await expect(page.locator('#b-save')).toHaveAttribute('title', /stages\.json/);
  await expect(page.locator('#b-save')).toHaveAttribute('title', /hud\.json/);
  // Move a fighter: stages.json (and axes.json, written with it), not hud.json.
  await page.locator('#heroes li', { hasText: 'Kit' }).click();
  await page.keyboard.press('ArrowRight');
  await flush(page);
  const title = (await page.locator('#b-save').getAttribute('title')) ?? '';
  expect(title).toContain('stages.json');
  expect(title).not.toContain('hud.json');
  // Move a HUD box too: now hud.json is named as well.
  await page.evaluate(() => {
    window.__stageedit?.session.edit('Move the commands', (d) => {
      d.hud.commands.x += 8;
    });
  });
  await flush(page);
  expect((await page.locator('#b-save').getAttribute('title')) ?? '').toContain('hud.json');
  // Undo names the step it took back.
  await expect(page.locator('#b-undo')).toHaveAttribute('title', /Move the commands/);
  await page.keyboard.press('Control+z');
  await expect(page.locator('#st-msg')).toHaveText('Undid “Move the commands”.');
  await page.keyboard.press('Control+y');
  await expect(page.locator('#st-msg')).toHaveText('Redid “Move the commands”.');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#st-msg')).toContainText('Undid');
  // Changing stage clears the message about the one you left.
  await page.locator('#stages li', { hasText: 'Sewer' }).click();
  await expect(page.locator('#st-msg')).toHaveText('');
});

test('Revert says which files it throws away: the stages, and the global HUD when that is what changed', async ({ page }) => {
  await openEditor(page, scratch);
  await page.evaluate(() => {
    const se = window.__stageedit;
    se?.session.edit('Move the commands', (d) => {
      d.hud.commands.x += 8;
    });
    se?.session.edit('Move Kit', (d) => {
      (d.stages.street as StageEntry).party[0] = { x: 30, row: 2 };
    });
  });
  await page.locator('#b-revert').click();
  const text = await page.locator('.dlg').innerText();
  expect(text).toContain('Throw away 2 changes to street and the global HUD (hud.json, used by every battle)');
  await page.keyboard.press('Escape');
});

test('the change-id button asks only for the id; the Name field is the only place for the name', async ({ page }) => {
  await openEditor(page, scratch);
  await expect(page.locator('#s-ren')).toHaveText('Change id');
  await expect(page.locator('#stagebtns')).not.toContainText('Rename');
  await page.locator('#s-ren').click();
  const dlg = page.locator('.dlg');
  await expect(dlg).toContainText('Change id');
  expect(await dlg.locator('input').count()).toBe(1);
  await dlg.locator('input').fill('main-street');
  await page.keyboard.press('Enter');
  await expect(page.locator('#stages li.on code')).toHaveText('main-street');
  await expect(page.locator('#stages li.on')).toContainText('Street'); // the name did not change
  await expect(page.locator('#inspector input[aria-label="Name"]')).toHaveValue('Street');
  // The name is changed in the inspector.
  await page.locator('#inspector input[aria-label="Name"]').fill('Main Street');
  await page.keyboard.press('Tab');
  await expect(page.locator('#stages li.on')).toContainText('Main Street');
});

// ---------------------------------------------------------------- K: labels

test('labels and tips say what they mean: no "lane", no "fog colour", short draw-order tip, plain button names', async ({ page }) => {
  await openEditor(page, scratch);
  await page.locator('#inspector details.grp > summary').evaluateAll((els) => {
    for (const e of els) (e.parentElement as HTMLDetailsElement).open = true;
  });
  const inspector = page.locator('#inspector');
  await expect(inspector.locator('button', { hasText: 'Copy from one fewer enemy' })).toBeVisible();
  await expect(inspector.locator('button', { hasText: 'Put back the demo enemies' })).toBeVisible();
  await expect(inspector).not.toContainText('Copy from n');
  await expect(inspector).not.toContainText('Reset preview');
  for (let i = 1; i <= 5; i++) await expect(inspector.locator('.lab .l', { hasText: `Haze, row ${i}` })).toHaveCount(1);
  await expect(inspector).not.toContainText('Distance haze');
  // Every tip and label, in the stage form and in the fighter and HUD forms.
  const collect = (): Promise<string[]> => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-tip], #inspector [title], #inspector [aria-label]')].flatMap((e) => [e.dataset.tip ?? '', e.title, e.getAttribute('aria-label') ?? '', e.textContent ?? '']));
  const texts = [...(await collect())];
  await page.locator('#heroes li', { hasText: 'Kit' }).click();
  texts.push(...(await collect()));
  const hudBox = (await stageOf(page)).party[0];
  expect(hudBox).toBeDefined();
  await page.evaluate(() => window.__stageedit?.session.select([{ kind: 'hud', region: 'commands' }]));
  await flush(page);
  texts.push(...(await collect()));
  const text = texts.join('\n');
  expect(text).not.toMatch(/\blanes?\b/i);
  expect(text).not.toMatch(/fog colou?r/i);
  expect(text).toContain('toward the sky colour');
  // The draw-order tip is about 25 words.
  await page.locator('#heroes li', { hasText: 'Kit' }).click();
  const draw = (await page.locator('#inspector .lab', { hasText: 'Draw order' }).locator('.qm').getAttribute('data-tip')) ?? '';
  expect(draw.split(/\s+/).length).toBeLessThanOrEqual(28);
  // The Align tip for HUD boxes is about the screen; the half rule is for fighters only.
  const fighterTip = (await page.locator('#inspector .grp summary', { hasText: 'Align' }).locator('.qm').getAttribute('data-tip')) ?? '';
  expect(fighterTip).toContain('heroes on the left');
  await page.evaluate(() => window.__stageedit?.session.select([{ kind: 'hud', region: 'commands' }]));
  await flush(page);
  const hudTip = (await page.locator('#inspector .grp summary', { hasText: 'Align' }).locator('.qm').getAttribute('data-tip')) ?? '';
  expect(hudTip).toContain('Line up with the screen, or with each other');
  expect(hudTip).not.toMatch(/hero|enem/i);
});

// ---------------------------------------------------------------- L: mixed values

test('several selected with different values: "mixed" is shown in full and the slider is greyed out; typing a value sets them all', async ({ page }) => {
  await openEditor(page, scratch);
  await select(page, [
    { side: 'party', index: 0 },
    { side: 'party', index: 1 },
  ]);
  const across = page.locator('#inspector .field', { has: page.locator('input[aria-label="Across"]') });
  const num = across.locator('input.num');
  await expect(across).toHaveClass(/mixed/);
  await expect(num).toHaveAttribute('placeholder', 'mixed');
  await expect(across.locator('input[type="range"]')).toBeDisabled();
  // The word fits in the box (the placeholder is not cut off).
  const fits = await num.evaluate((el) => {
    const c = document.createElement('canvas').getContext('2d');
    if (!c) return false;
    const cs = getComputedStyle(el);
    c.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const inner = (el as HTMLElement).clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return c.measureText('mixed').width <= inner;
  });
  expect(fits).toBe(true);
  await num.fill('100');
  await num.press('Enter');
  await num.blur();
  const s = await stageOf(page);
  expect([s.party[0]?.x, s.party[1]?.x]).toEqual([100, 100]);
  await expect(across).not.toHaveClass(/mixed/);
  await expect(across.locator('input[type="range"]')).toBeEnabled();
});

// ---------------------------------------------------------------- M: laptops

test('the side panels have whole-pixel widths, so the stage starts on a whole pixel on a 1536 x 864 laptop', async ({ page }) => {
  await openEditor(page, scratch);
  await page.setViewportSize({ width: 1536, height: 864 });
  await flush(page);
  await page.waitForTimeout(200);
  const widths = await page.evaluate(() => ['#left', '#right', '#centre'].map((s) => document.querySelector(s)?.getBoundingClientRect().width ?? -1));
  for (const w of widths) expect(w % 1, `panel width ${w}`).toBe(0);
  const r = await canvasRect(page);
  expect([r.x % 1, r.y % 1]).toEqual([0, 0]);
  expect(await page.evaluate(() => window.__stagelab?.crisp())).toBe(true);
});

test('the left panel can be folded away so the stage keeps 2x at 1440 x 900, with a button and the P key, and the choice is remembered', async ({ page }) => {
  await openEditor(page, scratch);
  await page.setViewportSize({ width: 1440, height: 900 });
  await flush(page);
  await page.waitForTimeout(200);
  // With both panels there is not room for 2x at this width.
  expect((await canvasRect(page)).w).toBe(480);
  await page.locator('#t-left').click();
  await page.waitForTimeout(300);
  await flush(page);
  await expect(page.locator('#left')).toBeHidden();
  const r = await canvasRect(page);
  expect(r.w).toBe(960);
  expect([r.x % 1, r.y % 1]).toEqual([0, 0]);
  expect(await page.evaluate(() => window.__stagelab?.crisp())).toBe(true);
  // The handles still sit exactly on the canvas.
  const o = await page.locator('#ovsvg').boundingBox();
  expect([o?.x, o?.y, o?.width, o?.height]).toEqual([r.x, r.y, r.w, r.h]);
  // Remembered per browser: a reload comes back with the panel folded.
  await page.reload();
  await waitReady(page);
  await page.waitForTimeout(300);
  await expect(page.locator('#left')).toBeHidden();
  await expect(page.locator('#t-left')).not.toHaveClass(/on/);
  expect((await canvasRect(page)).w).toBe(960);
  // The key brings it back, and again hides it.
  await page.keyboard.press('p');
  await expect(page.locator('#left')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('shadowjog.stageedit.v1') ?? '{}').leftOpen)).toBe(true);
  await page.keyboard.press('p');
  await expect(page.locator('#left')).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('shadowjog.stageedit.v1') ?? '{}').leftOpen)).toBe(false);
});

test('a browser that blocks storage still gets the editor, with the left panel open', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('storage is blocked');
      },
    });
  });
  const { errors } = await openEditor(page, scratch);
  await expect(page.locator('#left')).toBeVisible();
  await page.locator('#t-left').click();
  await expect(page.locator('#left')).toBeHidden();
  expect(errors.filter((e) => !/storage is blocked/.test(e))).toEqual([]);
});

// ---------------------------------------------------------------- P: the design's rules as live warnings

test('Mark’s current figure-rule breaks show as warnings: the chip counts them, lists each with its enemy count, and a click goes there', async ({ page }) => {
  test.skip(!HAVE_SPRITES, 'The counts depend on the real sprite sizes (Mark’s Sprite Fusion folder is not on this machine)');
  await openEditor(page, scratch, '&stage=street&set=3');
  const chip = page.locator('#b-warn');
  await expect(chip).toHaveText(`Warnings (${MARKS_FIGURE_BREAKS.length})`);
  await expect(chip).toHaveClass(/has/);
  // The chip has a tooltip.
  await chip.hover();
  await expect(page.locator('#tipbubble')).toContainText('never stops you from saving');
  await chip.click();
  const pop = page.locator('#warnpop');
  await expect(pop).toBeVisible();
  // Each broken rule is listed in plain words with the stage and enemy count it applies to.
  const keys = await pop.locator('.wi').evaluateAll((els) => els.map((e) => e.getAttribute('data-key') ?? ''));
  expect(keys.sort()).toEqual([...MARKS_FIGURE_BREAKS].sort());
  await expect(pop).toContainText('Boss alone');
  await expect(pop).toContainText('6 enemies');
  await expect(pop).toContainText('the gap between the heroes and the enemies');
  // The bubble that explained the chip does not sit on top of the list.
  await expect(page.locator('#tipbubble')).toBeHidden();
  // Click one: that stage, that enemy count, the fighters to blame selected.
  await pop.locator('.wi[data-rule="nearest"]').click();
  await expect(pop).toBeHidden();
  expect(await page.evaluate(() => [window.__stageedit?.session.stageId, window.__stageedit?.session.setKey])).toEqual(['sewer', '6']);
  const picked = await page.evaluate(() => window.__stageedit?.session.selection ?? []);
  expect(picked.length).toBeGreaterThan(0);
  await expect(page.locator('#st-warn')).toBeVisible();
  await expect(page.locator('#st-warn')).toContainText('Design rule');
  // The red outline is drawn on the offending fighter.
  await expect(page.locator('#ovsvg rect[stroke="#ff3b3b"]')).not.toHaveCount(0);
  // Esc closes the list.
  await chip.click();
  await expect(pop).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
});

test('a placement that breaks a rule gets a red outline and a warning, and undoing it takes them away; warnings never block saving', async ({ page }) => {
  await openEditor(page, scratch, '&stage=street&set=3');
  const base = await page.evaluate(() => window.__stageedit?.warnings().length ?? -1);
  expect(base).toBeGreaterThanOrEqual(0);
  const outlines = (): Promise<number> => page.locator('#ovsvg rect[stroke="#ff3b3b"]').count();
  const before = await outlines();
  // Put the first enemy at the middle line: its left edge is far left of the 260 the design needs.
  await page.evaluate(() => {
    window.__stageedit?.session.edit('Move E1 to the middle', (d) => {
      const s = d.stages.street as StageEntry;
      s.enemySets['3'] = (s.enemySets['3'] ?? []).map((q, i) => (i === 0 ? { ...q, x: 244 } : q));
    });
  });
  await flush(page);
  const w = await page.evaluate(() => window.__stageedit?.warnings().filter((x) => x.setKey === '3' && x.culprits.some((c) => c.side === 'enemy' && c.index === 0)) ?? []);
  expect(w.map((x) => x.rule)).toEqual(expect.arrayContaining(['nearest']));
  expect(await outlines()).toBeGreaterThan(before);
  await expect(page.locator('#b-warn')).toHaveText(new RegExp(`Warnings \\((?!${base}\\))\\d+\\)`));
  await expect(page.locator('#st-warn')).toBeVisible();
  await expect(page.locator('#st-warn')).toContainText('Design rule');
  await expect(page.locator('#st-warn')).toHaveAttribute('title', /nearest enemy/);
  // The inspector says it too when the fighter is selected.
  await select(page, [{ side: 'enemy', index: 0 }]);
  await expect(page.locator('#inspector .checks .warn').first()).toContainText('3 enemies');
  // A warning does not stop a save.
  await page.keyboard.press('Control+s');
  await expect(page.locator('#st-msg')).toContainText('Saved to');
  await page.keyboard.press('Control+z');
  await flush(page);
  expect(await page.evaluate(() => window.__stageedit?.warnings().length)).toBe(base);
  expect(await outlines()).toBe(before);
});

test('the rules are the same code the stage lab test runs: the editor’s warnings equal the rule module’s answer for every stage and enemy count', async ({ page }) => {
  await openEditor(page, scratch, '&stage=street&set=3');
  const same = await page.evaluate(async () => {
    const rulesUrl = '/src/stage/rules.ts';
    const configUrl = '/src/stage/config.ts';
    const { stageWarnings } = await import(/* @vite-ignore */ rulesUrl);
    const { SET_KEYS, resolveStage } = await import(/* @vite-ignore */ configUrl);
    const se = window.__stageedit;
    const sc = window.__stagelab?.scene();
    if (!se || !sc) throw new Error('no editor');
    const mine: string[] = [];
    for (const entry of Object.values(se.session.data.stages)) {
      const cfg = resolveStage(entry, se.session.data.hud);
      const boxes: Record<string, unknown[]> = {};
      for (const k of SET_KEYS as string[]) if (cfg.enemySets[k]) boxes[k] = sc.figureBoxesFor(cfg, k, se.view.roster(cfg, k));
      for (const w of stageWarnings(cfg, boxes as never)) mine.push(`${w.stageId}|${w.setKey}|${w.text}`);
    }
    return { mine: mine.sort(), shown: se.warnings().map((w) => `${w.stageId}|${w.setKey}|${w.text}`).sort() };
  });
  expect(same.shown).toEqual(same.mine);
});

test('the boxes measured for another enemy count match the ones the scene measures when that count is on stage', async ({ page }) => {
  await openEditor(page, scratch, '&stage=street&set=3');
  const result = await page.evaluate(() => {
    const sc = window.__stagelab?.scene();
    const se = window.__stageedit;
    if (!sc || !se) throw new Error('no editor');
    const cfg = sc.config;
    const out: string[] = [];
    for (const key of ['1', '3', '6', 'boss', 'boss+2']) {
      const asked = sc.figureBoxesFor(cfg, key, se.view.roster(cfg, key));
      sc.setEnemies(se.view.roster(cfg, key), key);
      const shown = sc.figureBoxes();
      const round = (b: Array<{ x: number; y: number; left: number; right: number; top: number }>): string => JSON.stringify(b.map((f) => [f.x, f.y, f.left, f.right, f.top]));
      if (round(asked) !== round(shown)) out.push(`${key}: ${round(asked)} vs ${round(shown)}`);
    }
    return out;
  });
  expect(result).toEqual([]);
});
