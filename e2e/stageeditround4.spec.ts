/**
 * Battle Stage Editor, bug-fix round 4 (`/stageedit.html`, spike `spike/phaser-stage`): the Align bugs the round-3 judges
 * found, driven with a real keyboard on a private scratch copy of the data. Six wide enemies (a Rustfang Punk is 73 px
 * wide, so only three fit on one row of the enemies' 216 px) show that fighters which do not fit stay exactly where they
 * were, and that Align keeps clear of fighters that are not selected.
 */
import { expect, type Page, test } from '@playwright/test';
import type { StageEntry } from '../src/stage/config';
import { dropScratch, flush, openEditor, scratchName } from './stageeditkit';

type Slot = { x: number; row: number; dy?: number };
const stageOf = (page: Page): Promise<StageEntry> => page.evaluate(() => JSON.parse(JSON.stringify(window.__stageedit?.session.stage)) as StageEntry);
const msg = (page: Page): Promise<string> => page.locator('#st-msg').innerText();
const select = (page: Page, side: 'party' | 'enemy', list: number[]): Promise<void> =>
  page.evaluate(([s, items]) => {
    window.__stageedit?.session.select(items.map((index) => ({ kind: 'fighter' as const, side: s, index })));
  }, [side, list] as const);
/** The drawn left and right edge of every fighter of a side, as the editor measures them (same order as the slots). */
const edges = (page: Page, side: 'party' | 'enemy'): Promise<Array<{ left: number; right: number }>> =>
  page.evaluate((s) => {
    const sc = window.__stagelab?.scene();
    return (sc?.fighters.filter((f) => f.side === s) ?? []).map((f) => {
      const b = sc?.boxOf(f);
      return { left: b?.left ?? 0, right: b?.right ?? 0 };
    });
  }, side);
/** True when any two of the given edge pairs come closer than 1 px or overlap. */
const overlap = (list: Array<{ left: number; right: number }>): boolean => {
  const s = [...list].sort((a, b) => a.left - b.left);
  return s.some((e, i) => i > 0 && e.left < (s[i - 1]?.right ?? 0) + 1);
};

test.describe.configure({ mode: 'serial' });

let scratch = '';
test.beforeEach(() => {
  scratch = scratchName('round4');
});
test.afterEach(() => dropScratch(scratch));

/** Six enemies on different rows, their pictures overlapping, and that enemy count shown. */
async function sixWide(page: Page, slots: Slot[]): Promise<void> {
  await page.evaluate((s) => {
    const e = window.__stageedit;
    if (!e) return;
    e.session.edit('Six wide enemies', (d) => {
      (d.stages.street as StageEntry).enemySets['6'] = s;
    });
    e.session.showSet('6');
  }, slots);
  await flush(page);
}

test('Back on six wide enemies: the ones that do not fit stay exactly where they were, and the status line says how many moved', async ({ page }) => {
  await openEditor(page, scratch);
  const start: Slot[] = [
    { x: 290, row: 0 },
    { x: 310, row: 1 },
    { x: 330, row: 2 },
    { x: 350, row: 3 },
    { x: 370, row: 4, dy: 3 },
    { x: 400, row: 2, dy: -2 },
  ];
  await sixWide(page, start);
  await select(page, 'enemy', [0, 1, 2, 3, 4, 5]);
  await page.keyboard.press('w');
  await flush(page);
  const text = await msg(page);
  const m = /^(\d) of 6 moved to the back row; (\d) stayed: not enough room\./.exec(text);
  expect(m, text).not.toBeNull();
  const stayed = Number(m?.[2]);
  expect(stayed).toBeGreaterThanOrEqual(1);
  const after = (await stageOf(page)).enemySets['6'] ?? [];
  // Whoever is not on the back row now has not moved at all (the same row, x and dy as before).
  const notMoved = after.map((q, i) => ({ q, i })).filter(({ q }) => q.row !== 0);
  expect(notMoved.length).toBe(stayed);
  for (const { q, i } of notMoved) expect(q).toEqual(start[i]);
  // Those on the back row stand side by side without touching, inside x 260 to 476.
  const e = await edges(page, 'enemy');
  const onBack = after.map((q, i) => ({ q, i })).filter(({ q }) => q.row === 0);
  expect(overlap(onBack.map(({ i }) => e[i] as { left: number; right: number }))).toBe(false);
  for (const { i } of onBack) {
    expect(e[i]?.left).toBeGreaterThanOrEqual(259);
    expect(e[i]?.right).toBeLessThanOrEqual(477);
  }
  await expect(page.locator('#st-msg')).toHaveClass(/bad/);
  // One undo step puts everyone back.
  await page.keyboard.press('Control+z');
  expect((await stageOf(page)).enemySets['6']).toEqual(start);
});

test('Align again with nothing left to do says "No change"', async ({ page }) => {
  await openEditor(page, scratch);
  await select(page, 'party', [0]);
  await page.keyboard.press('s'); // Kit already stands on the front row
  await expect(page.locator('#st-msg')).toContainText('No change');
  expect(await page.evaluate(() => window.__stageedit?.session.dirty)).toBe(false);
});

test('Align does not land on an enemy that is not selected and already stands on the row', async ({ page }) => {
  await openEditor(page, scratch);
  // E2 (not selected) stands on the middle row. E0 and E1 are selected: Middle takes them to row 2 as well.
  await sixWide(page, [
    { x: 290, row: 0 },
    { x: 420, row: 4 },
    { x: 340, row: 2 },
    { x: 400, row: 1 },
    { x: 430, row: 3 },
    { x: 460, row: 1 },
  ]);
  const before = (await stageOf(page)).enemySets['6'] ?? [];
  await select(page, 'enemy', [0, 1]);
  await page.keyboard.press('m');
  await flush(page);
  const after = (await stageOf(page)).enemySets['6'] ?? [];
  expect(after[2]).toEqual(before[2]); // the one that was not selected never moves
  expect(after.slice(3)).toEqual(before.slice(3));
  const e = await edges(page, 'enemy');
  const row2 = after.map((q, i) => ({ q, i })).filter(({ q }) => q.row === 2);
  expect(overlap(row2.map(({ i }) => e[i] as { left: number; right: number }))).toBe(false);
});

test('Right for one enemy packs around a neighbour on its row that is not selected', async ({ page }) => {
  await openEditor(page, scratch);
  await sixWide(page, [
    { x: 300, row: 2 },
    { x: 420, row: 2 },
    { x: 330, row: 0 },
    { x: 360, row: 1 },
    { x: 390, row: 3 },
    { x: 440, row: 4 },
  ]);
  await select(page, 'enemy', [0]);
  await page.keyboard.press('d');
  await flush(page);
  const after = (await stageOf(page)).enemySets['6'] ?? [];
  expect(after[1]).toEqual({ x: 420, row: 2 });
  const e = await edges(page, 'enemy');
  expect(overlap([e[0] as { left: number; right: number }, e[1] as { left: number; right: number }])).toBe(false);
});

test('a single hero aligned Right stops short of the enemies: the 55 px gap rule still holds, and the status line says so', async ({ page }) => {
  await openEditor(page, scratch);
  // The gap warnings the street already has before anything is aligned (Mark's enemy slots with the mirrored art; see MARKS_FIGURE_BREAKS).
  const gapWarnings = () => page.evaluate(() => (window.__stageedit?.warnings() ?? []).filter((w) => w.stageId === 'street' && (w.rule === 'gap' || w.rule === 'nearest')).map((w) => `${w.setKey}: ${w.text}`));
  const before = await gapWarnings();
  await page.locator('#heroes li', { hasText: 'Rook' }).click();
  await page.keyboard.press('d');
  await flush(page);
  const text = await msg(page);
  expect(text).toMatch(/55 px between the sides/);
  // Aligning the hero to the right adds no gap warning of its own: every one there now was there before.
  expect((await gapWarnings()).filter((w) => !before.includes(w))).toEqual([]);
  const h = await edges(page, 'party');
  expect(h[1]?.right).toBeLessThan(240);
  expect(h[1]?.right).toBeGreaterThan(150);
});

test('the Align keys work on a Russian keyboard: the key at the A position types ф and still aligns left', async ({ page }) => {
  await openEditor(page, scratch);
  await select(page, 'party', [2]); // Hex stands alone on her row
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ф', code: 'KeyA', bubbles: true, cancelable: true })));
  await flush(page);
  await expect(page.locator('#st-msg')).toContainText('left edge');
  expect((await stageOf(page)).party[2]?.x).toBeLessThan(130);
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ц', code: 'KeyW', bubbles: true, cancelable: true })));
  await flush(page);
  expect((await stageOf(page)).party[2]?.row).toBe(0);
});

test('a save that does not write the HUD is checked against the HUD on disk, and the posted HUD is left alone', async ({ page }) => {
  await openEditor(page, scratch);
  const res = await page.evaluate(async (name) => {
    const cur = (await (await fetch(`/__stage/stages?scratch=${name}`)).json()) as { stages: string; axes: string };
    const hud = (JSON.parse((await (await fetch(`/__stage/hud?scratch=${name}`)).json()).hud) as { layout: { commands: { w: number } } }).layout;
    const stages = JSON.parse(cur.stages) as Record<string, { hud?: unknown }>;
    stages.street = { ...stages.street, hud: { commands: { x: 300 } } };
    hud.commands.w = 300; // would break the street's own box if it were saved
    const post = async (write: string[]): Promise<{ ok: boolean; problems: string[]; written?: string[] }> =>
      (await (await fetch(`/__stage/stages?scratch=${name}&dry=1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stages, axes: JSON.parse(cur.axes), hud, write }) })).json()) as { ok: boolean; problems: string[]; written?: string[] };
    return { without: await post(['stages']), withHud: await post(['stages', 'hud']) };
  }, scratch);
  expect(res.without.ok).toBe(true);
  expect(res.without.written).toEqual(['stages']);
  expect(res.withHud.ok).toBe(false);
  expect(res.withHud.problems.join(' ')).toContain("the HUD layout in this save does not fit a stage's own HUD box");
});
