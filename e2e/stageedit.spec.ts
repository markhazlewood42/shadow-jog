/**
 * The Battle Stage Editor (`/stageedit.html`, spike `spike/phaser-stage`), driven with a real mouse and keyboard.
 *
 * Every test works on a private scratch copy of the data (`?scratch=<name>`), never `src/data/stages.json`. The core
 * round trip the item asks for: drag a hero to another row, move the horizon, undo and redo, save, reload, and find
 * the value where it was left. The rest check the things a designer relies on: that the scene itself changes (not a
 * look-alike), that one drag is one undo step, the unsaved-changes signals, a refused save, HUD presets and boxes,
 * the JSON pane, the foot anchor, and that the page makes no console errors.
 */
import { expect, type Page, test } from '@playwright/test';
import type { StageConfig } from '../src/stage/config';
import { bodyOf, canvasRect, dragGame, dropScratch, flush, openEditor, scratchName, toScreen, waitReady } from './stageeditkit';

/** The session's current stage, as plain data. */
const stageOf = (page: Page): Promise<StageConfig> => page.evaluate(() => JSON.parse(JSON.stringify(window.__stageedit?.session.stage)) as StageConfig);
const saved = (page: Page): Promise<{ dirty: boolean; undo: boolean; redo: boolean; changes: number }> =>
  page.evaluate(() => {
    const s = window.__stageedit?.session;
    return { dirty: !!s?.dirty, undo: !!s?.canUndo, redo: !!s?.canRedo, changes: s?.changeCount ?? 0 };
  });
const status = (page: Page): Promise<string> => page.locator('#st-msg').innerText();
/** The wall-and-floor picture's name: it changes whenever the horizon or floor is repainted. */
const pictureKey = (page: Page): Promise<string> => page.evaluate(() => window.__stagelab?.scene()?.pictureKey ?? '');

test.describe.configure({ mode: 'serial' });

let scratch = '';
test.beforeEach(() => {
  scratch = scratchName('edit');
});
test.afterEach(() => dropScratch(scratch));

test('drag a hero to another row: the slot, the scene and the inspector all follow, as one undo step', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  const before = await stageOf(page);
  const rook = await bodyOf(page, 'party', 1);
  expect(before.party[1]?.row).toBe(3);
  // Rook stands on row 4 (index 3, y 191). Drag him up by 34 game pixels: two rows back.
  await dragGame(page, { x: rook.x, y: rook.y }, { x: rook.x + 12, y: rook.y - 34 });
  const after = await stageOf(page);
  expect(after.party[1]?.row).toBe(1);
  expect(after.party[1]?.x).toBe(before.party[1] ? before.party[1].x + 12 : -1);
  // The real scene moved: his feet are on the row's line and he is drawn behind the heroes in front of him.
  const feet = await page.evaluate(() => {
    const f = window.__stagelab?.scene()?.fighters.filter((x) => x.side === 'party')[1];
    return f ? { y: f.baseY, depth: f.depth, row: f.slot.row } : null;
  });
  expect(feet).toMatchObject({ y: after.rows[1]?.y, row: 1 });
  // The inspector shows him, with a revert arrow beside the moved value.
  await expect(page.locator('#inspector')).toContainText('Rook');
  await expect(page.locator('#inspector select[aria-label="Row"]')).toHaveValue('1');
  await expect(page.locator('#inspector .field.moved')).not.toHaveCount(0);
  // One drag, one undo step (the drag made many movements).
  expect((await saved(page)).changes).toBe(1);
  await page.keyboard.press('Control+z');
  await flush(page);
  expect((await stageOf(page)).party[1]).toEqual(before.party[1]);
  expect((await saved(page)).dirty).toBe(false);
  expect(errors).toEqual([]);
});

test('move the horizon: the line, the floor top and the skyline move together, the scene repaints, undo and redo bring it back', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  const key0 = await pictureKey(page);
  expect((await stageOf(page)).backdrop.horizonY).toBe(100);
  // Grab the horizon where no fighter stands (x 20) and drag it up 8 game pixels.
  await dragGame(page, { x: 20, y: 100.5 }, { x: 20, y: 92.5 });
  const s = await stageOf(page);
  expect([s.backdrop.horizonY, s.floor.y0, s.backdrop.shiftY]).toEqual([92, 92, 92 - 132]);
  await expect(page.locator('#inspector')).toContainText('Horizon');
  const key1 = await pictureKey(page);
  expect(key1).not.toBe(key0);
  // The kerb row (the street's edge colour) now sits on row 92 of the real canvas, with wall above it and floor below.
  const [kerb, above, below] = await page.evaluate(() => window.__stagelab?.pixels([[8, 92], [8, 91], [8, 110]]) ?? Promise.reject(new Error('no hook')));
  expect(kerb).toBe('#3a3a5c');
  expect(above).not.toBe(kerb);
  expect(below).not.toBe(kerb);
  // Undo puts the picture back (the same cached picture), redo moves it again.
  await page.keyboard.press('Control+z');
  await flush(page);
  expect((await stageOf(page)).backdrop.horizonY).toBe(100);
  expect(await pictureKey(page)).toBe(key0);
  await page.keyboard.press('Control+y');
  await flush(page);
  expect((await stageOf(page)).backdrop.horizonY).toBe(92);
  expect(await pictureKey(page)).toBe(key1);
  await page.keyboard.press('Control+Shift+z');
  await flush(page);
  expect((await stageOf(page)).backdrop.horizonY).toBe(92); // nothing left to redo: unchanged
  expect(errors).toEqual([]);
});

test('save, reload: the saved file is read back through the game’s loader and the value is where it was left', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  await dragGame(page, { x: 20, y: 100.5 }, { x: 20, y: 96.5 });
  const rook = await bodyOf(page, 'party', 1);
  await dragGame(page, { x: rook.x, y: rook.y }, { x: rook.x, y: rook.y - 34 });
  const edited = await stageOf(page);
  expect((await saved(page)).dirty).toBe(true);
  await expect(page.locator('#b-save')).toBeEnabled();
  await page.keyboard.press('Control+s');
  await expect(page.locator('#st-msg')).toContainText(/Saved to scratch copy/);
  expect((await saved(page)).dirty).toBe(false);
  await expect(page.locator('#b-save')).toBeDisabled();
  await page.reload();
  await waitReady(page);
  const reloaded = await stageOf(page);
  expect(reloaded.backdrop.horizonY).toBe(96);
  expect(reloaded.party[1]).toEqual(edited.party[1]);
  // The scene shows it too, not just the data.
  const sceneRow = await page.evaluate(() => window.__stagelab?.scene()?.fighters.filter((x) => x.side === 'party')[1]?.slot.row);
  expect(sceneRow).toBe(edited.party[1]?.row);
  // The file on the dev server is valid JSON in the stable format, and the real data files were not touched.
  const text = await page.evaluate(async (name) => (await (await fetch(`/__stage/stages?scratch=${name}`)).json()).stages as string, scratch);
  expect(JSON.parse(text).street.backdrop.horizonY).toBe(96);
  const real = await page.evaluate(async () => JSON.parse((await (await fetch('/__stage/stages')).json()).stages).street.backdrop.horizonY as number);
  expect(real).toBe(100);
  expect(errors).toEqual([]);
});

test('the scripted task: select Rook, back row, raise the horizon 8 px, switch the HUD preset, save, reload', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  const t0 = Date.now();
  await page.locator('#heroes li', { hasText: 'Rook' }).click();
  await page.locator('#inspector select[aria-label="Row"]').selectOption('0');
  // Click the horizon where nobody stands, then Shift+Up raises it 8 px.
  const at = await toScreen(page, 20, 100.5);
  await page.mouse.click(at.x, at.y);
  await page.keyboard.press('Shift+ArrowUp');
  await page.locator('#s-preset').selectOption('ff-strip');
  await page.keyboard.press('Control+s');
  await expect(page.locator('#st-msg')).toContainText(/Saved to/);
  await page.reload();
  await waitReady(page);
  const s = await stageOf(page);
  expect([s.party[1]?.row, s.backdrop.horizonY, s.hud.preset]).toEqual([0, 92, 'ff-strip']);
  // By script this takes a couple of seconds; the bar for a person is a minute.
  expect(Date.now() - t0).toBeLessThan(30_000);
  expect(errors).toEqual([]);
});

test('unsaved changes show in the title, the status line and the Save button; Revert asks first and loads the file again', async ({ page }) => {
  await openEditor(page, scratch);
  await expect(page.locator('#b-save')).toBeDisabled();
  await expect(page.locator('#st-save')).toHaveText('Saved');
  await expect(page).toHaveTitle('Battle Stage Editor');
  await page.locator('#heroes li', { hasText: 'Kit' }).click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page).toHaveTitle('• Battle Stage Editor');
  await expect(page.locator('#st-save')).toContainText('Unsaved changes (2)');
  await expect(page.locator('#b-save')).toBeEnabled();
  expect((await stageOf(page)).party[0]?.x).toBe(46 + 9);
  // Undoing back to the saved state clears the signal by itself.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#st-save')).toHaveText('Saved');
  await page.keyboard.press('Control+y');
  await page.locator('#b-revert').click();
  await expect(page.locator('.dlg')).toContainText('Throw away 1 change to street?');
  await page.keyboard.press('Escape');
  await expect(page.locator('.dlg')).toHaveCount(0);
  expect((await stageOf(page)).party[0]?.x).toBe(47);
  await page.locator('#b-revert').click();
  await page.locator('.dlg button', { hasText: 'Throw away' }).click();
  await expect(page.locator('#st-msg')).toContainText('Reloaded');
  expect((await stageOf(page)).party[0]?.x).toBe(46);
  expect((await saved(page)).dirty).toBe(false);
});

test('a file the game’s loader would refuse is not saved, says why, and stays unsaved', async ({ page }) => {
  await openEditor(page, scratch);
  // Make an invalid stage the way a typing slip could: two heroes on one spot cannot be dragged to, so use the hook.
  await page.evaluate(() => {
    const se = window.__stageedit;
    se?.session.edit('break it', (d) => {
      const s = d.stages.street;
      if (s) s.floor.y1 = 100;
    });
  });
  await page.keyboard.press('Control+s');
  await expect(page.locator('#st-msg')).toContainText(/Not saved:/);
  expect(await status(page)).toMatch(/y1|outside the floor|below y0/);
  expect((await saved(page)).dirty).toBe(true);
  await expect(page.locator('#inspector .checks .bad')).not.toHaveCount(0);
});

test('HUD: switching the preset moves the real HUD boxes; a box moved by hand stays and can be reverted with its arrow', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  const box0 = await page.evaluate(() => {
    const b = window.__stagelab?.scene()?.hudObjects?.box('partyStatus');
    return b ? { x: b.x, y: b.y } : null;
  });
  expect(box0).toEqual({ x: 4, y: 228 });
  await page.locator('#s-preset').selectOption('ff-strip');
  await flush(page);
  const box1 = await page.evaluate(() => {
    const b = window.__stagelab?.scene()?.hudObjects?.box('partyStatus');
    return b ? { x: b.x, y: b.y } : null;
  });
  expect(box1).toEqual({ x: 300, y: 228 });
  // Drag the command box by hand 20 px left: an override with a revert arrow.
  await dragGame(page, { x: 240, y: 240 }, { x: 220, y: 240 });
  expect((await stageOf(page)).hud.commands.x).toBe(184 - 20);
  await expect(page.locator('#inspector')).toContainText('HUD box: Commands');
  await expect(page.locator('#inspector .field.moved')).not.toHaveCount(0);
  await page.locator('#inspector .field.moved .rev:not([hidden])').first().click();
  expect((await stageOf(page)).hud.commands.x).toBe(184);
  // Resize by a corner grip: the opposite corner stays put.
  await dragGame(page, { x: 240, y: 240 }, { x: 240, y: 240 }); // select the box again
  const before = (await stageOf(page)).hud.commands;
  await dragGame(page, { x: before.x + before.w, y: before.y + before.h }, { x: before.x + before.w + 10, y: before.y + before.h });
  const after = (await stageOf(page)).hud.commands;
  expect([after.x, after.y, after.w]).toEqual([before.x, before.y, before.w + 10]);
  expect(errors).toEqual([]);
});

test('the JSON pane shows the stage as it will be saved and lights up exactly the lines a drag changed', async ({ page }) => {
  await openEditor(page, scratch);
  await page.locator('#t-json').click();
  await expect(page.locator('#jsonpane')).toBeVisible();
  await expect(page.locator('#jsontitle')).toContainText('stages.json › street');
  await expect(page.locator('#jsontext .ln.chg')).toHaveCount(0);
  const rook = await bodyOf(page, 'party', 1);
  await dragGame(page, { x: rook.x, y: rook.y }, { x: rook.x - 10, y: rook.y });
  const lit = await page.locator('#jsontext .ln.chg').allInnerTexts();
  expect(lit).toHaveLength(1);
  expect(lit[0]).toContain('"x": 78');
  // The pane is the same text Save writes.
  const text = await page.locator('#jsontext').innerText();
  expect(text).toContain('"horizonY": 100');
});

test('arrow keys, shift-click and the lock: nudges, multi-select moves and a locked layer cannot be grabbed', async ({ page }) => {
  await openEditor(page, scratch);
  const kit = await bodyOf(page, 'party', 0);
  const hex = await bodyOf(page, 'party', 2);
  const k = await toScreen(page, kit.x, kit.y);
  const h = await toScreen(page, hex.x, hex.y);
  await page.mouse.click(k.x, k.y);
  // (Hold Shift with the keyboard: the mouse call's own modifiers option does not reach this page's pointer events.)
  await page.keyboard.down('Shift');
  await page.mouse.click(h.x, h.y);
  await page.keyboard.up('Shift');
  expect(await page.evaluate(() => window.__stageedit?.session.selectedFighters('party'))).toEqual([0, 2]);
  await expect(page.locator('#st-sel')).toHaveText('2 selected');
  // Up and down move whole rows (back is up), together.
  await page.keyboard.press('ArrowUp');
  const s = await stageOf(page);
  expect([s.party[0]?.row, s.party[2]?.row]).toEqual([3, 1]);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__stageedit?.session.selection.length)).toBe(0);
  // Lock the fighters: a click on Kit now selects nothing.
  await page.locator('#heroes li', { hasText: 'Kit' }).click();
  await page.keyboard.press('Control+l');
  await expect(page.locator('#locks')).toContainText('Locked: fighters');
  await page.mouse.click(k.x, k.y - 40);
  expect(await page.evaluate(() => window.__stageedit?.session.selection.length)).toBe(0);
  await page.locator('.lockchip').click();
  await expect(page.locator('#locks .lockchip')).toHaveCount(0);
});

test('draw order: Ctrl+] and Ctrl+[ bring a fighter forward or send it back within its row, and show +1 / -1', async ({ page }) => {
  await openEditor(page, scratch);
  await page.locator('#heroes li', { hasText: 'Hex' }).click();
  const depth0 = await page.evaluate(() => window.__stagelab?.scene()?.fighters.filter((x) => x.side === 'party')[2]?.depth ?? 0);
  await page.keyboard.press('Control+]');
  expect((await stageOf(page)).party[2]?.order).toBe(1);
  await flush(page);
  const depth1 = await page.evaluate(() => window.__stagelab?.scene()?.fighters.filter((x) => x.side === 'party')[2]?.depth ?? 0);
  expect(depth1 - depth0).toBe(1000);
  await expect(page.locator('#ovsvg')).toContainText('+1');
  await page.keyboard.press('Control+[');
  await page.keyboard.press('Control+[');
  expect((await stageOf(page)).party[2]?.order).toBe(-1);
  await expect(page.locator('#ovsvg')).toContainText('-1');
  await page.locator('.segb', { hasText: 'Auto' }).click();
  expect('order' in ((await stageOf(page)).party[2] ?? {})).toBe(false);
});

test('foot anchor: the crosshair nudges a sprite’s standing point by a pixel, the figure shifts, and it is saved in axes.json', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  await page.locator('#t-anchors').click();
  const rook = await bodyOf(page, 'party', 1);
  const before = await page.evaluate(() => {
    const f = window.__stagelab?.scene()?.fighters.filter((x) => x.side === 'party')[1];
    return f ? { x: f.sprite.originX * f.sprite.width, y: f.sprite.originY * f.sprite.height } : null;
  });
  // Click the crosshair at his feet, then the arrow key moves the standing point one pixel right in the sprite.
  const at = await toScreen(page, rook.feetX, rook.feetY);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('#st-sel')).toContainText('Foot anchor');
  await page.keyboard.press('ArrowRight');
  await flush(page);
  const after = await page.evaluate(() => {
    const f = window.__stagelab?.scene()?.fighters.filter((x) => x.side === 'party')[1];
    return f ? { x: f.sprite.originX * f.sprite.width, y: f.sprite.originY * f.sprite.height } : null;
  });
  expect(after?.x).toBeCloseTo((before?.x ?? 0) + 1, 5);
  expect(after?.y).toBeCloseTo(before?.y ?? 0, 5);
  expect(await page.evaluate(() => JSON.stringify(window.__stageedit?.session.data.axes))).toBe('{"rook":{"x":1,"y":0}}');
  // Saved with the stages, in its own file, and back to zero removes it again.
  await page.keyboard.press('Control+s');
  await expect(page.locator('#st-msg')).toContainText(/Saved to/);
  const axes = await page.evaluate(async (name) => JSON.parse((await (await fetch(`/__stage/stages?scratch=${name}`)).json()).axes), scratch);
  expect(axes).toEqual({ rook: { x: 1, y: 0 } });
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Control+s');
  const none = await page.evaluate(async (name) => JSON.parse((await (await fetch(`/__stage/stages?scratch=${name}`)).json()).axes), scratch);
  expect(none).toEqual({});
  expect(errors).toEqual([]);
});

test('Align and Copy from n−1 re-lay a group in one undo step; the stage list adds, renames and deletes stages', async ({ page }) => {
  await openEditor(page, scratch);
  await page.locator('#seg-set button[data-set="4"]').click();
  await page.keyboard.press('Escape');
  const before = (await stageOf(page)).enemySets['4'];
  await page.locator('#inspector button', { hasText: 'Align' }).click();
  const aligned = (await stageOf(page)).enemySets['4'];
  expect(aligned).not.toEqual(before);
  expect(aligned).toHaveLength(4);
  await page.keyboard.press('Control+z');
  expect((await stageOf(page)).enemySets['4']).toEqual(before);
  await page.locator('#inspector button', { hasText: 'Copy from' }).click();
  expect((await stageOf(page)).enemySets['4']?.slice(0, 3)).toEqual((await stageOf(page)).enemySets['3']);
  // The list.
  await page.locator('#s-dup').click();
  await expect(page.locator('#stages li.on')).toContainText('street-copy');
  await page.locator('#s-del').click();
  await page.locator('.dlg button', { hasText: 'Delete' }).click();
  await expect(page.locator('#stages li')).toHaveCount(2);
  await page.locator('#s-new').click();
  await page.locator('.dlg input').fill('Rooftop');
  await page.keyboard.press('Enter');
  await expect(page.locator('#stages li.on')).toContainText('rooftop');
  await page.keyboard.press('Control+s');
  await expect(page.locator('#st-msg')).toContainText(/Saved to/);
  await page.reload();
  await waitReady(page);
  await expect(page.locator('#stages li')).toHaveCount(3);
  // The new stage is a full stage: the scene can show it.
  await page.locator('#stages li', { hasText: 'rooftop' }).click();
  await flush(page);
  expect(await page.evaluate(() => window.__stagelab?.scene()?.config.id)).toBe('rooftop');
});

test('Play hides the handles, E toggles it, the Keys list matches the table, and the Battle Test button opens its dialog', async ({ page }) => {
  await openEditor(page, scratch);
  await expect(page.locator('#ovsvg')).toBeVisible();
  await page.keyboard.press('e');
  await expect(page.locator('#ovsvg')).toBeHidden();
  await page.keyboard.press('e');
  await expect(page.locator('#ovsvg')).toBeVisible();
  await page.locator('#b-keys').click();
  await expect(page.locator('.dlg')).toContainText('Ctrl+S');
  await expect(page.locator('.dlg')).toContainText('Ctrl+]');
  await expect(page.locator('.dlg')).not.toContainText('F5');
  await page.keyboard.press('Escape');
  await page.locator('#b-test').click();
  await expect(page.getByRole('dialog', { name: 'Battle Test' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.dlg')).toHaveCount(0);
});

test('the stage is drawn crisp: the canvas starts on a whole pixel and shows whole-number zoom, with the handles on top', async ({ page }) => {
  await openEditor(page, scratch);
  const r = await canvasRect(page);
  expect([r.x % 1, r.y % 1]).toEqual([0, 0]);
  expect(r.w).toBe(960);
  expect(await page.evaluate(() => window.__stagelab?.devicePixelsPerPixel)).toBe(2);
  expect(await page.evaluate(() => window.__stagelab?.crisp())).toBe(true);
  // The handles are an SVG over the canvas, the same size.
  const o = await page.locator('#ovsvg').boundingBox();
  expect([o?.x, o?.y, o?.width, o?.height]).toEqual([r.x, r.y, r.w, r.h]);
});

test('below 1100 px the three columns stack, as the animation editor’s do', async ({ page }) => {
  await openEditor(page, scratch);
  await page.setViewportSize({ width: 900, height: 900 });
  await flush(page);
  const left = await page.locator('#left').boundingBox();
  const centre = await page.locator('#centre').boundingBox();
  const right = await page.locator('#right').boundingBox();
  // Stacked: the lists first, then the stage, then the inspector, each below the one before.
  expect(left?.y ?? 0).toBeLessThan(centre?.y ?? 0);
  expect(right?.y ?? 0).toBeGreaterThan((centre?.y ?? 0) + (centre?.height ?? 0) - 1);
});
