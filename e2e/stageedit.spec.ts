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
import type { HudLayout, StageConfig, StageEntry } from '../src/stage/config';
import { RULE_LIMITS } from '../src/stage/rules';
import { bodyOf, canvasRect, dragGame, dropScratch, flush, openEditor, scratchName, toScreen, waitReady } from './stageeditkit';

/** The session's current stage as the file holds it (its HUD is only this stage's overrides), as plain data. */
const stageOf = (page: Page): Promise<StageEntry> => page.evaluate(() => JSON.parse(JSON.stringify(window.__stageedit?.session.stage)) as StageEntry);
/** The same stage as a battle sees it: the global HUD with this stage's overrides laid over it. */
const resolvedOf = (page: Page): Promise<StageConfig> => page.evaluate(() => JSON.parse(JSON.stringify(window.__stageedit?.session.resolved)) as StageConfig);
/** The one HUD layout every battle uses. */
const globalHud = (page: Page): Promise<HudLayout> => page.evaluate(() => JSON.parse(JSON.stringify(window.__stageedit?.session.data.hud)) as HudLayout);
/** The layout preset select in the inspector (it used to be in the top bar as well). */
const presetSelect = (page: Page) => page.locator('#inspector select[aria-label="Layout preset"]');
const saved = (page: Page): Promise<{ dirty: boolean; undo: boolean; redo: boolean; changes: number }> =>
  page.evaluate(() => {
    const s = window.__stageedit?.session;
    return { dirty: !!s?.dirty, undo: !!s?.canUndo, redo: !!s?.canRedo, changes: s?.changeCount ?? 0 };
  });
const status = (page: Page): Promise<string> => page.locator('#st-msg').innerText();
/** The wall-and-floor picture's name: it changes whenever the horizon or floor is repainted. */
const pictureKey = (page: Page): Promise<string> => page.evaluate(() => window.__stagelab?.scene()?.pictureKey ?? '');

/**
 * Inspector labels that do not fit: a label (its text and its "?" button, as drawn) that wraps, or that ends past the left edge of the control
 * beside it. The room a label really has is its grid cell plus the gap up to that control, not the cell alone: the cell is a share of the panel's
 * width and a font a little wider than the one the editor was designed in (Linux has no Segoe UI, so it draws the widest label about 2 px past its
 * cell) pushes the label into the gap without hurting anyone. Wider than the gap, and the label touches the control. A label on a row of its own has
 * no control beside it, so its own cell is its room.
 */
async function crampedLabels(page: Page): Promise<Array<{ label: string; pastRoomBy: number }>> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('#inspector .lab .l')].flatMap((l) => {
      const lab = l.closest('.lab') as HTMLElement;
      const drawn = document.createRange();
      drawn.selectNodeContents(l);
      const text = drawn.getBoundingClientRect();
      const cell = lab.getBoundingClientRect();
      const beside = lab.nextElementSibling?.getBoundingClientRect();
      const roomEnd = beside && beside.left > cell.left + 1 && beside.top < cell.bottom ? beside.left : cell.right;
      // A second line makes the label taller than one and a half lines.
      const wraps = l.getBoundingClientRect().height > 1.5 * (Number.parseFloat(getComputedStyle(l).lineHeight) || 1.5 * Number.parseFloat(getComputedStyle(l).fontSize));
      return wraps || text.right > roomEnd + 0.5 ? [{ label: l.textContent ?? '', pastRoomBy: Math.round((text.right - roomEnd) * 10) / 10 }] : [];
    }),
  );
}

// The tests here are independent (each has a private scratch copy), so one failure must not skip the tests after it. Serial mode did that on CI and hid a failing test.
test.describe.configure({ mode: 'default' });

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
  await page.keyboard.press('Escape');
  await presetSelect(page).selectOption('ff-strip');
  await page.keyboard.press('Control+s');
  await expect(page.locator('#st-msg')).toContainText(/Saved to/);
  await page.reload();
  await waitReady(page);
  const s = await stageOf(page);
  expect([s.party[1]?.row, s.backdrop.horizonY, (await globalHud(page)).preset]).toEqual([0, 92, 'ff-strip']);
  // The preset is the one HUD for every battle: the stage file carries no HUD of its own.
  expect(s.hud).toBeUndefined();
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

test('HUD: switching the preset moves the real HUD boxes; a box moved by hand stays and can be reverted with its arrow (in the one global layout)', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  const box0 = await page.evaluate(() => {
    const b = window.__stagelab?.scene()?.hudObjects?.box('partyStatus');
    return b ? { x: b.x, y: b.y } : null;
  });
  expect(box0).toEqual({ x: 120, y: 226 });
  await presetSelect(page).selectOption('ff-strip');
  await flush(page);
  const box1 = await page.evaluate(() => {
    const b = window.__stagelab?.scene()?.hudObjects?.box('partyStatus');
    return b ? { x: b.x, y: b.y } : null;
  });
  expect(box1).toEqual({ x: 280, y: 226 });
  // Drag the command box by hand 20 px left: it moves in the global layout (every battle), with a revert arrow back to the preset.
  await dragGame(page, { x: 240, y: 240 }, { x: 220, y: 240 });
  expect((await globalHud(page)).commands.x).toBe(164 - 20);
  expect((await stageOf(page)).hud).toBeUndefined();
  await expect(page.locator('#inspector')).toContainText('HUD box: Commands');
  await expect(page.locator('#st-msg')).toContainText('for every battle');
  await expect(page.locator('#inspector .field.moved')).not.toHaveCount(0);
  await page.locator('#inspector .field.moved .rev:not([hidden])').first().click();
  expect((await globalHud(page)).commands.x).toBe(164);
  // Resize by a corner grip: the opposite corner stays put.
  await dragGame(page, { x: 240, y: 240 }, { x: 240, y: 240 }); // select the box again
  const before = (await resolvedOf(page)).hud.commands;
  await dragGame(page, { x: before.x + before.w, y: before.y + before.h }, { x: before.x + before.w + 10, y: before.y + before.h });
  const after = (await resolvedOf(page)).hud.commands;
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
  await page.keyboard.press('l'); // plain L: Ctrl+L is the browser's address bar
  await expect(page.locator('#locks')).toContainText('Locked: fighters');
  // (Kit moved up two rows above, so aim at where she stands now: a fixed offset from her old spot can land on a row line, which is a handle too.)
  // (A solid pixel of hers that is not within 3 px of a row line: with her bigger proportions the middle of her body can sit exactly on one.)
  const kitNow = await page.evaluate(() => {
    const scene = window.__stagelab?.scene();
    const f = scene?.fighters.find((x) => x.side === 'party' && x.axisKey === 'kit');
    if (!scene || !f) throw new Error('no kit');
    const b = scene.boxOf(f);
    const rows = scene.config.rows.map((r) => r.y);
    for (let y = Math.floor(b.top) + 4; y <= f.y; y++) for (let x = Math.floor(b.left); x <= b.right; x++) if (scene.pick(x + 0.5, y + 0.5) === f && rows.every((ry) => Math.abs(ry - (y + 0.5)) > 3)) return { x: x + 0.5, y: y + 0.5 };
    throw new Error('no clear pixel on kit');
  });
  const kn = await toScreen(page, kitNow.x, kitNow.y);
  await page.mouse.click(kn.x, kn.y);
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
  // Corrections saved earlier (Mark's, for Sable) are in the file already; this test adds one for Rook next to them.
  const axes0 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__stageedit?.session.data.axes)) as Record<string, { x: number; y: number }>);
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
  expect(await page.evaluate(() => window.__stageedit?.session.data.axes)).toEqual({ ...axes0, rook: { x: 1, y: 0 } });
  // Saved with the stages, in its own file, and back to zero removes it again.
  await page.keyboard.press('Control+s');
  await expect(page.locator('#st-msg')).toContainText(/Saved to/);
  const axes = await page.evaluate(async (name) => JSON.parse((await (await fetch(`/__stage/stages?scratch=${name}`)).json()).axes), scratch);
  expect(axes).toEqual({ ...axes0, rook: { x: 1, y: 0 } });
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Control+s');
  const none = await page.evaluate(async (name) => JSON.parse((await (await fetch(`/__stage/stages?scratch=${name}`)).json()).axes), scratch);
  expect(none).toEqual(axes0);
  expect(errors).toEqual([]);
});

test('Align and Copy from n−1 re-lay a group in one undo step; the stage list adds, renames and deletes stages', async ({ page }) => {
  await openEditor(page, scratch);
  await page.locator('#seg-set button[data-set="4"]').click();
  await page.keyboard.press('Escape');
  const before = (await stageOf(page)).enemySets['4'];
  await page.locator('#inspector button', { hasText: 'Lay out evenly' }).click();
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

// ---------------------------------------------------------------------------------------------------------------------
// Round 1 of Mark's notes on the editor (2026-10-03): Shift axis lock, live sliders, align, one HUD for every battle,
// no duplicate controls, "?" tooltips, the help panel, wider panels and a full-height explorer.
// ---------------------------------------------------------------------------------------------------------------------

/** Press a range input at one fraction of its width, move it to another in steps, and report the page state while the button is still down. */
async function dragSlider<T>(page: Page, slider: ReturnType<Page['locator']>, from: number, to: number, whileDown: () => Promise<T>): Promise<T> {
  const box = await slider.boundingBox();
  if (!box) throw new Error('the slider is not on the page');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * from, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to, y, { steps: 6 });
  const seen = await whileDown();
  await page.mouse.up();
  await flush(page);
  return seen;
}

test('Shift while dragging locks a fighter to sideways or up and down (whichever way the pointer went further), as one undo step', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  const punk = await bodyOf(page, 'enemy', 0);
  const before = (await stageOf(page)).enemySets['3']?.[0];
  expect(before).toEqual({ x: 309, row: 0 });
  // A diagonal drag with Shift held: 30 left, 20 down. Sideways wins, so the row (and the small nudge) stay exactly as they were.
  await page.keyboard.down('Shift');
  await dragGame(page, { x: punk.x, y: punk.y }, { x: punk.x - 30, y: punk.y + 20 });
  await page.keyboard.up('Shift');
  const sideways = (await stageOf(page)).enemySets['3']?.[0];
  expect(sideways).toEqual({ x: 279, row: 0 });
  expect((await saved(page)).changes).toBe(1);
  // The same diagonal without Shift moves both ways (the row follows the pointer down).
  const again = await bodyOf(page, 'enemy', 0);
  await dragGame(page, { x: again.x, y: again.y }, { x: again.x + 12, y: again.y + 40 });
  const free = (await stageOf(page)).enemySets['3']?.[0];
  expect(free?.x).toBe(291);
  expect(free?.row).toBeGreaterThan(0);
  // Shift with a mostly vertical drag keeps x exactly where it was.
  const third = await bodyOf(page, 'enemy', 0);
  const rowBefore = free?.row ?? 0;
  await page.keyboard.down('Shift');
  await dragGame(page, { x: third.x, y: third.y }, { x: third.x + 6, y: third.y - 34 });
  await page.keyboard.up('Shift');
  const up = (await stageOf(page)).enemySets['3']?.[0];
  expect(up?.x).toBe(291);
  expect(up?.row).toBeLessThan(rowBefore);
  expect(errors).toEqual([]);
});

test('Shift while dragging a HUD box locks it to one direction too', async ({ page }) => {
  await openEditor(page, scratch);
  const h0 = (await resolvedOf(page)).hud.commands;
  await page.keyboard.down('Shift');
  await dragGame(page, { x: h0.x + 56, y: h0.y + 21 }, { x: h0.x + 56 + 40, y: h0.y + 21 - 12 });
  await page.keyboard.up('Shift');
  const h1 = (await resolvedOf(page)).hud.commands;
  expect([h1.x, h1.y]).toEqual([h0.x + 40, h0.y]);
});

test('sliders change the stage while they are dragged, and the whole drag is one undo step', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  const key0 = await pictureKey(page);
  // The horizon slider repaints the wall and floor live.
  const mid = await dragSlider(page, page.locator('#inspector input[aria-label="Horizon slider"]'), 0.5, 0.3, () =>
    page.evaluate(() => ({ data: window.__stageedit?.session.stage.backdrop.horizonY ?? 0, scene: window.__stagelab?.scene()?.config.backdrop.horizonY ?? 0, key: window.__stagelab?.scene()?.pictureKey ?? '', open: window.__stageedit?.session.inGesture ?? false })),
  );
  expect(mid.data).toBeLessThan(100);
  expect(mid.scene).toBe(mid.data);
  expect(mid.key).not.toBe(key0);
  expect(mid.open).toBe(true);
  expect((await saved(page)).changes).toBe(1);
  await page.keyboard.press('Control+z');
  await flush(page);
  expect((await stageOf(page)).backdrop.horizonY).toBe(100);
  expect(await pictureKey(page)).toBe(key0);
  // A slider that is not about the ground: the haze of the back row. The fighters' tint follows while the thumb moves.
  const haze = page.locator('#inspector input[aria-label="Haze, row 1 slider"]').first();
  const seen = await dragSlider(page, haze, 0.8, 0.45, () => page.evaluate(() => ({ data: window.__stageedit?.session.stage.depthTint?.amounts[0] ?? -1, scene: window.__stagelab?.scene()?.config.depthTint?.amounts[0] ?? -2 })));
  expect(seen.data).toBeGreaterThan(0);
  expect(seen.data).toBeLessThan(0.12);
  expect(seen.scene).toBe(seen.data);
  expect((await saved(page)).changes).toBe(1);
  expect(errors).toEqual([]);
});

test('Align: select Rook and line him up in one click; the single-letter keys do the same; several fighters line up with each other', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  await page.locator('#heroes li', { hasText: 'Rook' }).click();
  await expect(page.locator('#inspector .alignbar')).toBeVisible();
  const rook0 = (await stageOf(page)).party[1];
  expect(rook0).toEqual({ x: 88, row: 3 });
  // Centre: his drawn body is centred on the left half of the stage (x 120).
  await page.locator('.alb[data-align="centre"]').click();
  await flush(page);
  const centred = (await stageOf(page)).party[1];
  const mid = await page.evaluate(() => {
    const sc = window.__stagelab?.scene();
    const f = sc?.fighters.filter((x) => x.side === 'party')[1];
    if (!sc || !f) return null;
    const b = sc.boxOf(f);
    return (b.left + b.right) / 2;
  });
  expect(Math.abs((mid ?? 0) - 120)).toBeLessThanOrEqual(1.5);
  expect(centred?.row).toBe(3);
  // Back and Front snap to the first and last depth row; W is the same as the Back button (a plain letter, so it is the same key on every keyboard layout).
  await page.locator('.alb[data-align="front"]').click();
  expect((await stageOf(page)).party[1]?.row).toBe(4);
  await page.keyboard.press('w');
  expect((await stageOf(page)).party[1]?.row).toBe(0);
  await page.keyboard.press('a');
  expect((await stageOf(page)).party[1]?.x).toBeLessThan(40);
  await expect(page.locator('#st-msg')).toContainText('left edge');
  // Each press is one undo step.
  expect((await saved(page)).changes).toBe(4);
  // Several: the heroes line up with each other on the back-most row they use, as a block of drawn pictures kept `gap` px from the nearest enemy.
  // Whether all four fit depends on how wide the art is (Mark's Sprite Fusion crew are wider than the stand-in figures CI draws), so the test measures the
  // heroes and the room first and asserts the branch that the numbers call for: everyone lands on the back row, or the ones that do not fit stay put and say so.
  const before = (await stageOf(page)).party.map((q) => ({ ...q }));
  const room = await page.evaluate((gap) => {
    const sc = window.__stagelab?.scene();
    const ed = window.__stageedit;
    if (!sc || !ed) return null;
    const heroes = sc.fighters.filter((f) => f.side === 'party');
    const widths = heroes.map((f) => {
      const b = sc.boxOf(f);
      return Math.max(0, f.x - b.left) + Math.max(0, b.right - f.x);
    });
    // The nearest enemy's drawn left edge over every enemy group of the stage (a hero must stay `gap` px left of it).
    const lefts = Object.keys(sc.config.enemySets).flatMap((key) => sc.figureBoxesFor(sc.config, key, ed.view.roster(ed.session.stage, key)).filter((b) => b.side === 'enemy').map((b) => b.left));
    return { need: widths.reduce((n, w) => n + w, 0) + 2 * (heroes.length - 1), have: Math.min(240, Math.min(...lefts) - gap) };
  }, RULE_LIMITS.gap);
  expect(room).not.toBeNull();
  const allFit = (room?.need ?? 0) <= (room?.have ?? 0);
  test.info().annotations.push({ type: 'align-branch', description: `${allFit ? 'all four fit' : 'not enough room'} (need ${room?.need} px, have ${room?.have} px)` });
  await page.keyboard.press('Control+a');
  await page.keyboard.press('w');
  const after = (await stageOf(page)).party;
  if (allFit) {
    expect(after.map((q) => q.row)).toEqual([0, 0, 0, 0]);
    await expect(page.locator('#st-msg')).not.toContainText('stayed: not enough room');
  } else {
    // The ones that do not fit stay EXACTLY where they were (so they keep a row below the back one, or the back-row spot they held), the rest are on the back row.
    const kept = after.flatMap((q, i) => (q.row !== 0 ? [i] : []));
    expect(kept.length).toBeGreaterThanOrEqual(1);
    expect(kept.length).toBeLessThan(after.length);
    for (const i of kept) expect(after[i]).toEqual(before[i]);
    await expect(page.locator('#st-msg')).toContainText('stayed: not enough room');
  }
  // With three or more selected the bar also offers an even spread.
  await expect(page.locator('.alb[data-align="spreadAcross"]')).toBeVisible();
  await page.keyboard.press('x');
  await expect(page.locator('#st-msg')).toContainText('evenly across');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect(errors).toEqual([]);
});

test('Align works on HUD boxes: one lines up with the screen, several with each other', async ({ page }) => {
  await openEditor(page, scratch);
  const h0 = (await resolvedOf(page)).hud;
  await dragGame(page, { x: h0.commands.x + 56, y: h0.commands.y + 21 }, { x: h0.commands.x + 56, y: h0.commands.y + 21 });
  await expect(page.locator('#inspector')).toContainText('HUD box: Commands');
  await page.locator('.alb[data-align="right"]').click();
  expect((await globalHud(page)).commands.x).toBe(480 - h0.commands.w);
  await page.locator('.alb[data-align="back"]').click(); // "Top" for a HUD box
  expect((await globalHud(page)).commands.y).toBe(0);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect((await globalHud(page)).commands).toEqual(h0.commands);
});

test('one HUD for every battle: moving a box changes the global layout (hud.json) and no stage; saving writes only that file', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  const h0 = (await resolvedOf(page)).hud.commands;
  await dragGame(page, { x: h0.x + 56, y: h0.y + 21 }, { x: h0.x + 56 + 24, y: h0.y + 21 });
  expect((await globalHud(page)).commands.x).toBe(h0.x + 24);
  expect((await stageOf(page)).hud).toBeUndefined();
  expect(await page.evaluate(() => window.__stageedit?.session.dirtyParts)).toEqual(['hud']);
  await expect(page.locator('#inspector')).toContainText('Different on this stage');
  // The other stage shows the same box in the same place.
  await page.locator('#stages li', { hasText: 'sewer' }).click();
  await flush(page);
  expect((await resolvedOf(page)).hud.commands.x).toBe(h0.x + 24);
  await page.locator('#stages li', { hasText: 'street' }).click();
  await page.keyboard.press('Control+s');
  await expect(page.locator('#st-msg')).toContainText(/Saved to scratch copy/);
  expect((await saved(page)).dirty).toBe(false);
  // On disk (the scratch copy): hud.json has the move, stages.json carries no HUD at all, and the real files were not touched.
  const files = await page.evaluate(async (name) => {
    const stages = JSON.parse((await (await fetch(`/__stage/stages?scratch=${name}`)).json()).stages) as Record<string, { hud?: unknown }>;
    const hud = JSON.parse((await (await fetch(`/__stage/hud?scratch=${name}`)).json()).hud) as { version: number; layout: { commands: { x: number } } };
    const real = JSON.parse((await (await fetch('/__stage/hud')).json()).hud) as { layout: { commands: { x: number } } };
    return { withHud: Object.values(stages).filter((s) => s.hud !== undefined).length, x: hud.layout.commands.x, version: hud.version, realX: real.layout.commands.x };
  }, scratch);
  expect(files).toEqual({ withHud: 0, x: h0.x + 24, version: 1, realX: h0.x });
  await page.reload();
  await waitReady(page);
  expect((await globalHud(page)).commands.x).toBe(h0.x + 24);
  expect(errors).toEqual([]);
});

test('a stage can override one HUD box: it is edited on that stage only, saved in stages.json, and comes back after a reload', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  const h0 = (await resolvedOf(page)).hud.commands;
  await dragGame(page, { x: h0.x + 56, y: h0.y + 21 }, { x: h0.x + 56, y: h0.y + 21 }); // select the Commands box
  await page.locator('#hud-scope').check();
  await expect(page.locator('#inspector')).toContainText('stay on this stage');
  await dragGame(page, { x: h0.x + 56, y: h0.y + 21 }, { x: h0.x + 56 + 50, y: h0.y + 21 - 30 });
  await expect(page.locator('#st-msg')).toContainText('on this stage only');
  expect((await stageOf(page)).hud).toEqual({ commands: { x: h0.x + 50, y: h0.y - 30 } });
  expect((await globalHud(page)).commands.x).toBe(h0.x);
  await expect(page.locator('#ovsvg')).toContainText('•'); // the overlay marks the overridden box
  // The inspector lists it with a revert arrow back to the all-battles value.
  await page.keyboard.press('Escape');
  await expect(page.locator('#inspector')).toContainText('On this stage only');
  await expect(page.locator('#inspector .ovr .ovr-row')).toHaveCount(2);
  // The other stage is untouched.
  await page.locator('#stages li', { hasText: 'sewer' }).click();
  await flush(page);
  expect((await resolvedOf(page)).hud.commands.x).toBe(h0.x);
  await page.locator('#stages li', { hasText: 'street' }).click();
  await flush(page);
  expect(await page.evaluate(() => window.__stagelab?.scene()?.hudObjects?.box('commands')?.x)).toBe(h0.x + 50);
  await page.keyboard.press('Control+s');
  await expect(page.locator('#st-msg')).toContainText(/Saved to/);
  await page.reload();
  await waitReady(page);
  expect((await stageOf(page)).hud).toEqual({ commands: { x: h0.x + 50, y: h0.y - 30 } });
  expect((await resolvedOf(page)).hud.commands.x).toBe(h0.x + 50);
  // Turning it off again sends the box back to the all-battles layout, and a stage with no override saves no HUD at all.
  await dragGame(page, { x: h0.x + 56 + 50, y: h0.y + 21 - 30 }, { x: h0.x + 56 + 50, y: h0.y + 21 - 30 });
  await page.locator('#hud-scope').uncheck();
  expect((await stageOf(page)).hud).toBeUndefined();
  expect((await resolvedOf(page)).hud.commands.x).toBe(h0.x);
  await page.keyboard.press('Control+z');
  expect((await resolvedOf(page)).hud.commands.x).toBe(h0.x + 50);
  expect(errors).toEqual([]);
});

test('an override that is turned on but never differs is not saved (a stage carries a HUD only when it differs)', async ({ page }) => {
  await openEditor(page, scratch);
  const h0 = (await resolvedOf(page)).hud.commands;
  await dragGame(page, { x: h0.x + 56, y: h0.y + 21 }, { x: h0.x + 56, y: h0.y + 21 });
  await page.locator('#hud-scope').check();
  expect((await stageOf(page)).hud).toEqual({ commands: {} });
  // Nothing differs, so nothing is unsaved: the Save button stays off, and Ctrl+S says there is nothing to write (and tidies the empty box away).
  expect((await saved(page)).dirty).toBe(false);
  await expect(page.locator('#b-save')).toBeDisabled();
  await page.keyboard.press('Control+s');
  await expect(page.locator('#st-msg')).toContainText('Nothing to save');
  expect((await stageOf(page)).hud).toBeUndefined();
  expect((await saved(page)).dirty).toBe(false);
});

test('the top bar holds view choices and the inspector holds properties: no control is in both', async ({ page }) => {
  await openEditor(page, scratch);
  // Removed from the top bar: the HUD preset (it lives in the inspector), the dead Foreground toggle and the Camera toggle.
  await expect(page.locator('#s-preset')).toHaveCount(0);
  await expect(page.locator('#t-fg')).toHaveCount(0);
  await expect(page.locator('#t-cam')).toHaveCount(0);
  await expect(page.locator('#top')).not.toContainText('Camera');
  await expect(page.locator('#top')).not.toContainText('HUD preset');
  // Removed from the inspector: the enemy-count picker (the top bar's Enemies buttons are the only one) and the floor-top read-out.
  await expect(page.locator('#inspector')).not.toContainText('Enemies shown');
  await expect(page.locator('#inspector select[aria-label="Enemies shown"]')).toHaveCount(0);
  await expect(page.locator('#inspector')).not.toContainText('Floor top');
  await expect(page.locator('#inspector select[aria-label="Layout preset"]')).toHaveCount(1);
  // No label is in both the top bar and the inspector, and none repeats within the top bar (the per-row fields repeat by design).
  const names = (sel: string): Promise<string[]> => page.evaluate((q) => [...document.querySelectorAll<HTMLElement>(q)].map((e) => (e.getAttribute('aria-label') ?? e.textContent ?? '').trim()).filter((t) => t.length > 1), sel);
  const top = await names('#top button:not(.qm), #top select');
  const inspector = await names('#inspector select, #inspector button:not(.qm):not(.rev), #inspector input');
  expect(top.filter((l) => inspector.includes(l))).toEqual([]);
  expect(top.filter((l, i) => top.indexOf(l) !== i)).toEqual([]);
  // A remembered "camera" overlay from an older version of the page is ignored.
  await page.evaluate(() => localStorage.setItem('shadowjog.stageedit.v1', JSON.stringify({ show: { hud: true, camera: true } })));
  await page.reload();
  await waitReady(page);
  expect(await page.evaluate(() => Object.keys(window.__stageedit?.view.show ?? {}).sort())).toEqual(['anchors', 'guides', 'hud', 'safe']);
});

test('a "?" explains a setting in plain words: it opens on hover and on keyboard focus, and the haze one says what you will see', async ({ page }) => {
  await openEditor(page, scratch);
  const tip = page.locator('#tipbubble');
  await expect(tip).toBeHidden();
  const q = page.locator('#inspector .lab', { hasText: 'Haze, row 1' }).first().locator('.qm');
  await q.hover();
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Fades the fighters on this row toward the sky colour');
  await expect(tip).toContainText('you will see');
  // The bubble stays on the screen.
  const b = await tip.boundingBox();
  expect((b?.x ?? -1) >= 0 && (b?.y ?? -1) >= 0 && (b?.x ?? 0) + (b?.width ?? 0) <= 1600 && (b?.y ?? 0) + (b?.height ?? 0) <= 900).toBe(true);
  await page.mouse.move(700, 20);
  await expect(tip).toBeHidden();
  // Keyboard: focus the "?" of the shadow flatness setting.
  await page.locator('#inspector details.grp > summary', { hasText: 'Shadows' }).click();
  const flat = page.locator('#inspector .lab', { hasText: 'Flatness' }).locator('.qm');
  await flat.focus();
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('squashed');
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
  // Toolbar items explain themselves too.
  await page.locator('#t-guides').hover();
  await expect(tip).toContainText('centre line');
  // Every "?" and every toolbar tip carries text a beginner can read: not empty, not a bare data name.
  const texts = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-tip]')].map((e) => e.dataset.tip ?? ''));
  expect(texts.length).toBeGreaterThan(20);
  for (const t of texts) expect(t.split(' ').length).toBeGreaterThan(4);
});

test('help: a "?" in the top bar and a link under the stage list say what a stage is, and where each setting lives', async ({ page }) => {
  await openEditor(page, scratch);
  await expect(page.locator('#stagehint')).toContainText('A stage is one battleground');
  await page.locator('#b-help').click();
  const dlg = page.locator('.dlg');
  await expect(dlg).toContainText('A stage is one battleground');
  await expect(dlg).toContainText('backdrop picture');
  await expect(dlg).toContainText('Every fight at that place uses the stage');
  await expect(dlg).toContainText('sewer');
  await expect(dlg).toContainText('troop');
  await expect(dlg).toContainText('one HUD layout for every battle');
  await expect(dlg).toContainText('Only this editor, Battle Test and the stage lab read stages today');
  await expect(dlg).toContainText('the list of who you fight in one battle');
  await expect(dlg).toContainText('Haze, shadows and the floor belong to the stage');
  await expect(dlg).toContainText('Shift+drag');
  await page.keyboard.press('Escape');
  await expect(page.locator('.dlg')).toHaveCount(0);
  await page.locator('#stage-help').click();
  await expect(page.locator('.dlg')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  await expect(page.locator('.dlg')).toBeVisible();
});

test('the side panels are wide enough that labels do not wrap, the stage keeps whole-number zoom, and the explorer fills its panel', async ({ page }) => {
  await openEditor(page, scratch);
  const left = await page.locator('#left').boundingBox();
  const right = await page.locator('#right').boundingBox();
  expect(left?.width ?? 0).toBeGreaterThanOrEqual(268);
  expect(right?.width ?? 0).toBeGreaterThanOrEqual(340);
  // Whole pixels, so the stage between them starts on a whole pixel too.
  expect([(left?.width ?? 0) % 1, (right?.width ?? 0) % 1]).toEqual([0, 0]);
  // At 1600 x 900 the stage is still drawn at exactly 2x.
  expect((await canvasRect(page)).w).toBe(960);
  expect(await page.evaluate(() => window.__stagelab?.devicePixelsPerPixel)).toBe(2);
  expect(await page.evaluate(() => window.__stagelab?.crisp())).toBe(true);
  // No label in the inspector wraps onto a second line, and none runs into the control beside it.
  const cramped = await crampedLabels(page);
  expect(cramped).toEqual([]);
  // The check bites: with every letter 10% of the font size wider apart (the same on every OS and font), the longest label does run into its control.
  await page.addStyleTag({ content: '#inspector .lab { letter-spacing: 0.1em; }' });
  await flush(page);
  expect((await crampedLabels(page)).map((c) => c.label)).toContain('Backdrop picture?');
  await page.evaluate(() => document.head.lastElementChild?.remove());
  await flush(page);
  // The explorer takes the rest of the left panel's height and scrolls inside itself.
  const geo = await page.evaluate(() => {
    const l = document.querySelector('#left')?.getBoundingClientRect();
    const e = document.querySelector('#explorer')?.getBoundingClientRect();
    const s = document.querySelector('#explorer-scroll') as HTMLElement | null;
    return { leftBottom: l?.bottom ?? 0, exBottom: e?.bottom ?? 0, scrolls: !!s && s.scrollHeight > s.clientHeight, panelScrolls: (document.querySelector('#left') as HTMLElement).scrollHeight > (document.querySelector('#left') as HTMLElement).clientHeight + 1 };
  });
  expect(Math.abs(geo.leftBottom - geo.exBottom)).toBeLessThanOrEqual(1);
  expect(geo.scrolls).toBe(true);
  expect(geo.panelScrolls).toBe(false);
  // 1920 x 1080: the stage keeps whole-number zoom there as well.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await flush(page);
  const big = await canvasRect(page);
  expect(big.w % 480).toBe(0);
  expect(big.w).toBeGreaterThanOrEqual(960);
  expect([big.x % 1, big.y % 1]).toEqual([0, 0]);
  expect(await page.evaluate(() => window.__stagelab?.crisp())).toBe(true);
});

test('Revert also throws away an unsaved HUD move, and Battle Test fights with the HUD as it is on screen', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  const h0 = (await resolvedOf(page)).hud.commands;
  await dragGame(page, { x: h0.x + 56, y: h0.y + 21 }, { x: h0.x + 56 + 30, y: h0.y + 21 });
  expect((await globalHud(page)).commands.x).toBe(h0.x + 30);
  // Battle Test uses the unsaved global HUD too.
  await page.evaluate(() => {
    const se = window.__stageedit;
    if (!se) throw new Error('no editor');
    const st = se.session.resolved;
    se.startBattle({ party: st.demo.party, roster: st.demo.rosters['3'] ?? [], setKey: '3', seed: 8, fullResources: true, speed: 1, auto: false });
  });
  await flush(page);
  expect(await page.evaluate(() => window.__stagelab?.scene()?.config.hud.commands.x)).toBe(h0.x + 30);
  await page.evaluate(() => window.__stageedit?.stopBattle());
  await page.locator('#b-revert').click();
  await expect(page.locator('.dlg')).toContainText('Throw away 1 change to the global HUD (hud.json, used by every battle)');
  await page.locator('.dlg button', { hasText: 'Throw away' }).click();
  await expect(page.locator('#st-msg')).toContainText('Reloaded');
  expect((await globalHud(page)).commands.x).toBe(h0.x);
  expect((await saved(page)).dirty).toBe(false);
  expect(errors).toEqual([]);
});
