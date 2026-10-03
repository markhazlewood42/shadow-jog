/**
 * Battle Stage Editor, polish round 3 (`/stageedit.html`, spike `spike/phaser-stage`): what Mark's judges asked for
 * after round 2, driven with a real mouse and keyboard on a private scratch copy of the data.
 *
 * Align keys that are plain letters, a stage that is always a whole zoom (with a hint for the left-panel key), Align
 * that stays inside the design's limits and says honestly when there is not enough room, the explorer where a click
 * selects, one Save that writes (or refuses) all the files together, and wording that follows the real state.
 */
import { expect, type Page, test } from '@playwright/test';
import type { StageEntry } from '../src/stage/config';
import { canvasRect, dropScratch, flush, openEditor, scratchName } from './stageeditkit';

const stageOf = (page: Page): Promise<StageEntry> => page.evaluate(() => JSON.parse(JSON.stringify(window.__stageedit?.session.stage)) as StageEntry);
const msg = (page: Page): Promise<string> => page.locator('#st-msg').innerText();
const select = (page: Page, side: 'party' | 'enemy', list: number[]): Promise<void> =>
  page.evaluate(([s, items]) => {
    window.__stageedit?.session.select(items.map((index) => ({ kind: 'fighter' as const, side: s, index })));
  }, [side, list] as const);
const selected = (page: Page, side: 'party' | 'enemy'): Promise<number[]> => page.evaluate((s) => window.__stageedit?.session.selectedFighters(s) ?? [], side);
/** Both files of the scratch copy as the dev server holds them. */
const onDisk = (page: Page, name: string): Promise<{ stages: string; hud: string; axes: string }> =>
  page.evaluate(async (n) => {
    const st = (await (await fetch(`/__stage/stages?scratch=${n}`)).json()) as { stages: string; axes: string };
    const hud = (await (await fetch(`/__stage/hud?scratch=${n}`)).json()) as { hud: string };
    return { stages: st.stages, axes: st.axes, hud: hud.hud };
  }, name);

test.describe.configure({ mode: 'serial' });

let scratch = '';
test.beforeEach(() => {
  scratch = scratchName('polish3');
});
test.afterEach(() => dropScratch(scratch));

// ---------------------------------------------------------------- 2: whole zoom only

const SIZES: Array<[number, number, number]> = [
  [1366, 768, 1],
  [1440, 900, 1],
  [1536, 864, 1],
  [1600, 900, 2],
  [1920, 1080, 2],
  [2560, 1440, 3],
];

test('the stage is always a whole zoom at a whole-pixel position, at six laptop and desktop sizes', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  for (const [w, h, k] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForFunction((want) => Math.round((document.querySelector('#stage canvas') as HTMLCanvasElement).getBoundingClientRect().width / 480) === want, k, { timeout: 5000 });
    await flush(page);
    const r = await canvasRect(page);
    expect({ size: `${w}x${h}`, zoom: r.w / 480, h: r.h / 270 }).toEqual({ size: `${w}x${h}`, zoom: k, h: k });
    // A whole pixel position: no half pixel for the picture to blur on.
    expect(Number.isInteger(r.x)).toBe(true);
    expect(Number.isInteger(r.y)).toBe(true);
    // The readout in the status line agrees with the canvas, and so does the hook the lab tests read.
    await expect(page.locator('#st-zoom')).toContainText(`Zoom ${k}x`);
    expect(await page.evaluate(() => window.__stagelab?.devicePixelsPerPixel)).toBe(k);
    // The overlay's handles sit on the picture exactly.
    const ov = await page.evaluate(() => {
      const s = (document.querySelector('#ovsvg') as SVGSVGElement).getBoundingClientRect();
      const c = (document.querySelector('#stage canvas') as HTMLCanvasElement).getBoundingClientRect();
      return { dx: Math.abs(s.left - c.left), dw: Math.abs(s.width - c.width) };
    });
    expect(ov.dx).toBeLessThan(0.51);
    expect(ov.dw).toBeLessThan(0.51);
  }
  expect(errors).toEqual([]);
});

test('at 1x the status line offers the left-panel key, and pressing it reaches 2x; there is no nudge at 2x or when the panel is already hidden', async ({ page }) => {
  await openEditor(page, scratch);
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.waitForFunction(() => Math.round((document.querySelector('#stage canvas') as HTMLCanvasElement).getBoundingClientRect().width / 480) === 1);
  const zoom = page.locator('#st-zoom');
  await expect(zoom).toContainText('Zoom 1x');
  await expect(zoom).toContainText('Press P to hide the left panel: the stage then fits at 2x.');
  await page.keyboard.press('p');
  await page.waitForFunction(() => Math.round((document.querySelector('#stage canvas') as HTMLCanvasElement).getBoundingClientRect().width / 480) === 2);
  await expect(zoom).toContainText('Zoom 2x');
  await expect(zoom).not.toContainText('Press P');
  await page.keyboard.press('p');
  // Back to 1x, and the nudge is back.
  await page.waitForFunction(() => Math.round((document.querySelector('#stage canvas') as HTMLCanvasElement).getBoundingClientRect().width / 480) === 1);
  await expect(zoom).toContainText('Press P');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForFunction(() => Math.round((document.querySelector('#stage canvas') as HTMLCanvasElement).getBoundingClientRect().width / 480) === 2);
  await expect(zoom).not.toContainText('Press P');
});

test.describe('on scaled displays', () => {
  for (const dpr of [1.25, 1.5]) {
    test(`at ${dpr * 100}% the picture is a whole number of screen pixels per game pixel, on a screen pixel`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 }, deviceScaleFactor: dpr });
      const page = await ctx.newPage();
      await openEditor(page, scratch);
      await page.setViewportSize({ width: 1536, height: 864 });
      await flush(page);
      const r = await canvasRect(page);
      const device = (r.w * dpr) / 480;
      expect(Number.isInteger(Math.round(device * 1e6) / 1e6)).toBe(true);
      expect(Math.abs(r.x * dpr - Math.round(r.x * dpr))).toBeLessThan(1e-6);
      expect(Math.abs(r.y * dpr - Math.round(r.y * dpr))).toBeLessThan(1e-6);
      await expect(page.locator('#st-zoom')).toHaveAttribute('title', new RegExp(`exactly ${device} by ${device} screen pixels`));
      await ctx.close();
    });
  }
});

// ---------------------------------------------------------------- 1: the Align keys

test('Align keys: A C D align left / centre / right, W M S go to the back / middle / front row, X and Y spread; each works on a HUD box as well', async ({ page }) => {
  await openEditor(page, scratch);
  await page.locator('#heroes li', { hasText: 'Rook' }).click();
  await page.keyboard.press('w');
  expect((await stageOf(page)).party[1]?.row).toBe(0);
  await page.keyboard.press('s');
  expect((await stageOf(page)).party[1]?.row).toBe(4);
  await page.keyboard.press('m');
  expect((await stageOf(page)).party[1]?.row).toBe(2);
  await page.keyboard.press('a');
  await expect(page.locator('#st-msg')).toContainText('left edge');
  const left = (await stageOf(page)).party[1]?.x ?? 999;
  await page.keyboard.press('d');
  await expect(page.locator('#st-msg')).toContainText('right edge');
  const right = (await stageOf(page)).party[1]?.x ?? 0;
  expect(right).toBeGreaterThan(left);
  await page.keyboard.press('c');
  await expect(page.locator('#st-msg')).toContainText('centre');
  // Four heroes: X spreads across, Y spreads over the rows.
  await page.keyboard.press('Control+a');
  await page.keyboard.press('x');
  await expect(page.locator('#st-msg')).toContainText('evenly across');
  await page.keyboard.press('y');
  await expect(page.locator('#st-msg')).toContainText('evenly over the rows');
  // The Keys list shows the same letters, and the bar's tooltips say them.
  await expect(page.locator('.alb[data-align="centre"]')).toHaveAttribute('title', /\(key C\)/);
  await expect(page.locator('.alb[data-align="back"]')).toHaveAttribute('title', /\(key W\)/);
  await expect(page.locator('.alb[data-align="spreadAcross"]')).toHaveAttribute('title', /\(key X\)/);
  await page.locator('#b-keys').click();
  const rows = await page.evaluate(() => [...document.querySelectorAll('.dlg tr')].map((tr) => `${tr.querySelector('kbd')?.textContent ?? ''}|${tr.querySelectorAll('td')[1]?.textContent ?? ''}`));
  for (const want of ['A|Align left', 'C|Align centre', 'D|Align right', 'W|Align to the back row', 'M|Align to the middle row', 'S|Align to the front row', 'X|Spread 3 or more evenly across', 'Y|Spread 3 or more evenly over the rows']) expect(rows.some((r) => r.startsWith(want))).toBe(true);
  await page.keyboard.press('Escape');
  // A HUD box: the same letter lines it up with the screen.
  await page.evaluate(() => window.__stageedit?.session.select([{ kind: 'hud', region: 'commands' }]));
  await page.keyboard.press('d');
  await expect(page.locator('#st-msg')).toContainText('Aligned');
});

test('the help explains the Align keys and the Left panel toggle', async ({ page }) => {
  await openEditor(page, scratch);
  await page.keyboard.press('?');
  const text = await page.locator('.dlg').innerText();
  expect(text).toMatch(/align with one key/i);
  expect(text).toMatch(/Left panel[^\n]*P/);
  expect(text).toMatch(/AltGr/);
  await page.keyboard.press('Escape');
});

// ---------------------------------------------------------------- 3: Align limits

/** Put six enemies on one row, side by side, and show that enemy count. */
async function crowd(page: Page): Promise<void> {
  await page.evaluate(() => {
    const e = window.__stageedit;
    if (!e) return;
    e.session.edit('Crowd the enemies', (d) => {
      const st = d.stages.street as StageEntry;
      st.enemySets['6'] = [270, 300, 330, 360, 390, 420].map((x) => ({ x, row: 2 }));
    });
    e.session.showSet('6');
  });
  await flush(page);
}

/** The drawn left and right edge of every enemy, as the editor measures them. */
const enemyEdges = (page: Page): Promise<Array<{ left: number; right: number; x: number }>> =>
  page.evaluate(() => {
    const sc = window.__stagelab?.scene();
    return (sc?.fighters.filter((f) => f.side === 'enemy') ?? []).map((f) => {
      const b = sc?.boxOf(f);
      return { left: b?.left ?? 0, right: b?.right ?? 0, x: f.x };
    });
  });

test('Align left on six enemies on one row that do not all fit: stays inside x 260 to 476, packs what fits and says so', async ({ page }) => {
  await openEditor(page, scratch);
  await crowd(page);
  await select(page, 'enemy', [0, 1, 2, 3, 4, 5]);
  await page.keyboard.press('a');
  const text = await msg(page);
  expect(text).toMatch(/not enough room: \d of 6 fit, the rest stayed/);
  const fit = Number(/not enough room: (\d) of 6/.exec(text)?.[1]);
  expect(fit).toBeGreaterThanOrEqual(1);
  expect(fit).toBeLessThan(6);
  await flush(page);
  const edges = await enemyEdges(page);
  const planned = (await stageOf(page)).enemySets['6'] ?? [];
  // The ones that were packed (the first `fit` by old order) are inside the limits the rules enforce.
  for (const e of edges.slice(0, fit)) {
    expect(e.left).toBeGreaterThanOrEqual(259);
    expect(e.right).toBeLessThanOrEqual(477);
  }
  // The rest did not move.
  expect(planned.slice(fit).map((q) => q.x)).toEqual([270, 300, 330, 360, 390, 420].slice(fit));
});

test('Align right never pushes an enemy past x 476, the limit the stage rules enforce, and the status line is computed from the final positions', async ({ page }) => {
  await openEditor(page, scratch);
  await page.evaluate(() => {
    window.__stageedit?.session.edit('Enemies at the edge', (d) => {
      (d.stages.street as StageEntry).enemySets['2'] = [
        { x: 440, row: 1 },
        { x: 470, row: 3 },
      ];
    });
    window.__stageedit?.session.showSet('2');
  });
  await flush(page);
  await select(page, 'enemy', [0, 1]);
  await page.keyboard.press('d');
  await flush(page);
  for (const e of await enemyEdges(page)) expect(e.right).toBeLessThanOrEqual(477);
  expect(await msg(page)).toMatch(/right edge/);
  expect(await msg(page)).not.toMatch(/not enough room/);
  // Nobody was left on the same spot, and the stage rule for the right edge shows no warning for it.
  const warnings = await page.evaluate(() => (window.__stageedit?.warnings() ?? []).filter((w) => w.stageId === 'street' && w.setKey === '2' && w.rule === 'edge').length);
  expect(warnings).toBe(0);
});

test('Back, Middle and Front with several fighters landing on one row pack them side by side, and the status line says so', async ({ page }) => {
  await openEditor(page, scratch);
  // Move the heroes close together on three different rows, so Front would stack them.
  await page.evaluate(() => {
    window.__stageedit?.session.edit('Heroes close together', (d) => {
      const st = d.stages.street as StageEntry;
      st.party = [
        { x: 100, row: 0 },
        { x: 106, row: 2 },
        { x: 112, row: 4 },
        { x: 40, row: 1 },
      ];
    });
  });
  await flush(page);
  await select(page, 'party', [0, 1, 2]);
  await page.keyboard.press('s');
  await flush(page);
  const st = await stageOf(page);
  expect(st.party.slice(0, 3).map((q) => q.row)).toEqual([4, 4, 4]);
  const edges = await page.evaluate(() => {
    const sc = window.__stagelab?.scene();
    return (sc?.fighters.filter((f) => f.side === 'party') ?? []).slice(0, 3).map((f) => {
      const b = sc?.boxOf(f);
      return { left: b?.left ?? 0, right: b?.right ?? 0 };
    });
  });
  const sorted = [...edges].sort((a, b) => a.left - b.left);
  sorted.forEach((e, k) => {
    if (k > 0) expect(e.left).toBeGreaterThanOrEqual((sorted[k - 1]?.right ?? 0) + 1);
  });
  expect(await msg(page)).toMatch(/share a row, so they were packed side by side/);
});

// ---------------------------------------------------------------- 4: the explorer

test('Who’s standing here: a plain click on an enemy selects its slot like a hero; the + button picks the enemy type; a missing one says so', async ({ page }) => {
  await openEditor(page, scratch);
  const here = page.locator('#enemies li', { has: page.locator('small', { hasText: 'here' }) });
  expect(await here.count()).toBeGreaterThanOrEqual(1);
  // Plain click: the slot is selected on the stage, with no preview change.
  const before = (await stageOf(page)).enemySets;
  await here.nth(0).click();
  expect((await selected(page, 'enemy')).length).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#inspector')).toContainText(/Enem(y|ies)/);
  // An enemy that is not standing on this stage: the status line says so, nothing is selected or changed.
  await page.evaluate(() => window.__stageedit?.session.select([]));
  const away = page.locator('#enemies li', { has: page.locator('small:not(:text("here"))') }).first();
  const name = ((await away.locator('span').nth(1).innerText()) ?? '').trim();
  await away.click();
  await expect(page.locator('#st-msg')).toContainText(`${name} is not standing on this stage`);
  await expect(page.locator('#st-msg')).toContainText('no slot to select');
  expect(await selected(page, 'enemy')).toEqual([]);
  await away.click({ modifiers: ['Shift'] });
  await expect(page.locator('#st-msg')).toContainText('no slot to add to the selection');
  await away.click({ modifiers: ['Control'] });
  await expect(page.locator('#st-msg')).toContainText('no slot to add to the selection');
  // The + button has a tooltip and puts that enemy in the selected slot.
  const plus = away.locator('.pal-add');
  await expect(plus).toHaveAttribute('title', new RegExp(`Put ${name} in the selected enemy slot`));
  await page.evaluate(() => window.__stageedit?.session.select([{ kind: 'fighter', side: 'enemy', index: 0 }]));
  await plus.click();
  await expect(page.locator('#st-msg')).toContainText(`${name} now stands in E1`);
  expect(await selected(page, 'enemy')).toEqual([0]); // the + never changes the selection
  expect((await stageOf(page)).enemySets).toEqual(before); // and a preview is never saved with the stage
  // A double click on a row no longer applies anything (it selects, twice).
  const standing = (): Promise<string[]> => page.evaluate(() => [...(window.__stagelab?.scene()?.enemies ?? [])]);
  await flush(page);
  const rosterBefore = await standing();
  await here.nth(0).dblclick();
  expect(await standing()).toEqual(rosterBefore);
});

// ---------------------------------------------------------------- 5: one atomic save

test('one Save writes the stages, the HUD and the axes together, and only the files that changed', async ({ page }) => {
  await openEditor(page, scratch);
  const before = await onDisk(page, scratch);
  await page.evaluate(() => {
    const e = window.__stageedit;
    e?.session.edit('Move Kit', (d) => {
      (d.stages.street as StageEntry).party[0] = { x: 31, row: 2 };
    });
    e?.session.edit('Move the commands', (d) => {
      d.hud.commands.x += 8;
    });
    e?.session.edit('Nudge Rook’s foot anchor', (d) => {
      d.axes.rook = { x: 1, y: 0 };
    });
  });
  expect(await page.evaluate(() => window.__stageedit?.session.dirtyParts)).toEqual(['stages', 'axes', 'hud']);
  await page.keyboard.press('Control+s');
  await expect(page.locator('#st-msg')).toContainText(/Saved to scratch copy/);
  const after = await onDisk(page, scratch);
  expect(after.stages).not.toBe(before.stages);
  expect(after.hud).not.toBe(before.hud);
  expect(after.axes).not.toBe(before.axes);
  expect(await page.evaluate(() => window.__stageedit?.session.dirty)).toBe(false);
  // Only the HUD changes now: the other two files are left exactly as they are.
  await page.evaluate(() => {
    window.__stageedit?.session.edit('Move the commands again', (d) => {
      d.hud.commands.x += 8;
    });
  });
  await page.keyboard.press('Control+s');
  await expect(page.locator('#st-msg')).toContainText(/Saved to scratch copy/);
  const hudOnly = await onDisk(page, scratch);
  expect(hudOnly.stages).toBe(after.stages);
  expect(hudOnly.axes).toBe(after.axes);
  expect(hudOnly.hud).not.toBe(after.hud);
});

test('a HUD change that breaks a stage’s own HUD box refuses the whole save: nothing is written, and the message says why', async ({ page }) => {
  await openEditor(page, scratch);
  const before = await onDisk(page, scratch);
  await page.evaluate(() => {
    const e = window.__stageedit;
    e?.session.edit('Move Kit', (d) => {
      (d.stages.street as StageEntry).party[0] = { x: 31, row: 2 };
    });
    // The street keeps its own commands box at x 300 (its width comes from the global HUD)...
    e?.session.edit('Street has its own commands box', (d) => {
      (d.stages.street as StageEntry).hud = { commands: { x: 300 } };
    });
    // ...and the global box is widened, so the street's box would run off the screen.
    e?.session.edit('Widen the commands', (d) => {
      d.hud.commands.w = 300;
    });
  });
  await page.keyboard.press('Control+s');
  const text = await msg(page);
  expect(text).toMatch(/^Not saved: /);
  expect(text).toContain("the HUD layout in this save does not fit a stage's own HUD box");
  expect(text).toContain('street');
  expect(text).toMatch(/No file was changed\.$/);
  await expect(page.locator('#st-msg')).toHaveClass(/bad/);
  const after = await onDisk(page, scratch);
  expect(after).toEqual(before);
  expect(await page.evaluate(() => window.__stageedit?.session.dirty)).toBe(true);
});

test('if the dev server is not there, nothing is reported saved and the changes stay', async ({ page }) => {
  await openEditor(page, scratch);
  await page.evaluate(() => {
    window.__stageedit?.session.edit('Move Kit', (d) => {
      (d.stages.street as StageEntry).party[0] = { x: 31, row: 2 };
    });
  });
  await page.route('**/__stage/stages**', (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()));
  await page.keyboard.press('Control+s');
  await expect(page.locator('#st-msg')).toContainText('Not saved');
  await expect(page.locator('#st-msg')).toContainText('No file was changed');
  expect(await page.evaluate(() => window.__stageedit?.session.dirty)).toBe(true);
});

// ---------------------------------------------------------------- 6: wording

test('the Save tooltip lists only the files that changed: axes.json only when the foot anchors changed', async ({ page }) => {
  await openEditor(page, scratch);
  const title = (): Promise<string> => page.locator('#b-save').evaluate((b) => b.getAttribute('title') ?? '');
  await expect.poll(title).toMatch(/Nothing to save/);
  await page.evaluate(() => {
    window.__stageedit?.session.edit('Move Kit', (d) => {
      (d.stages.street as StageEntry).party[0] = { x: 31, row: 2 };
    });
  });
  await expect.poll(title).toMatch(/^Save stages\.json \(Ctrl\+S\)$/);
  await page.evaluate(() => {
    window.__stageedit?.session.edit('Move the commands', (d) => {
      d.hud.commands.x += 8;
    });
  });
  await expect.poll(title).toMatch(/^Save stages\.json, hud\.json \(Ctrl\+S\)$/);
  await page.evaluate(() => {
    window.__stageedit?.session.edit('Nudge a foot anchor', (d) => {
      d.axes.rook = { x: 1, y: 0 };
    });
  });
  await expect.poll(title).toMatch(/^Save stages\.json, hud\.json, axes\.json \(Ctrl\+S\)$/);
});
