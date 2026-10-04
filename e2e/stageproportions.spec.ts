/**
 * Hero proportions (spike `spike/phaser-stage`): how tall and how broad each hero stands in battle, from the global
 * `src/data/heroes.json`, and the editor's Height and Build sliders.
 *
 * Every editor test works on a private scratch copy of the data (`?scratch=<name>`), so Mark's real files are never written. The
 * copy starts from the frozen fixture (`tests/fixtures/stagedata/`), so a test never depends on the numbers Mark has set; the
 * tests that look at his current file (the lab) check only what must hold for any numbers (rule: docs/DEVELOPING.md,
 * "Tests vs design data").
 * `PROP_MEDIA=<folder>` also writes the pictures for the person reading the spike.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { bodyOf, dropScratch, flush, openEditor, scratchName, toScreen, waitReady } from './stageeditkit';
import { HAVE_SPRITES, openLab } from './stagelabkit';

/** Mark's current heroes.json (the lab reads it). Only the lab test uses it, and only to check that the picture follows the file. */
const HEROES = JSON.parse(readFileSync(join(process.cwd(), 'src/data/heroes.json'), 'utf8')) as Record<string, { height: number; build: number }>;
/** The hero numbers the editor holds right now (its scratch copy), read from the page. */
const heroesInEditor = (page: Page): Promise<Record<string, { height: number; build: number }>> => page.evaluate(() => JSON.parse(JSON.stringify(window.__stageedit?.session.data.heroes ?? {})));
const MEDIA = process.env.PROP_MEDIA;
const IDS = ['kit', 'rook', 'hex', 'sable'] as const;
/** The index of each hero in the party (the order of the stage's lineup). */
const SLOT: Record<string, number> = { kit: 0, rook: 1, hex: 2, sable: 3 };

test.describe.configure({ mode: 'serial' });

/** Each hero's size now and as drawn, from the scene. */
const sizes = (page: Page): Promise<Record<string, { drawn: { w: number; h: number }; now: { w: number; h: number }; boxH: number; boxW: number }>> =>
  page.evaluate(() => {
    const scene = window.__stagelab?.scene();
    if (!scene) throw new Error('no scene');
    const out: Record<string, { drawn: { w: number; h: number }; now: { w: number; h: number }; boxH: number; boxW: number }> = {};
    for (const f of scene.fighters.filter((x) => x.side === 'party')) {
      const s = scene.heroSize(f.axisKey);
      if (!s) throw new Error(`no size for ${f.axisKey}`);
      out[f.axisKey] = { ...s, boxH: f.fig.box.y1 - f.fig.box.y0 + 1, boxW: f.fig.box.x1 - f.fig.box.x0 + 1 };
    }
    return out;
  });

test('the line-up shows each hero at the height and width heroes.json asks for, within 1 px, with no console errors', async ({ page }) => {
  const errors = await openLab(page, '?stage=street&set=3&clean');
  const got = await sizes(page);
  for (const id of IDS) {
    const g = got[id];
    const want = HEROES[id];
    expect(g && want, id).toBeTruthy();
    if (!g || !want) continue;
    expect(Math.abs(g.now.h - g.drawn.h * want.height), `${id} height`).toBeLessThanOrEqual(1);
    expect(Math.abs(g.now.w - g.drawn.w * want.build), `${id} width`).toBeLessThanOrEqual(1);
    // The stage measures what it draws: the figure box is the baked picture's.
    expect(g.boxH).toBe(g.now.h);
    expect(g.boxW).toBe(g.now.w);
  }
  if (HAVE_SPRITES) {
    // The ancestry order, measured on the baked pictures (not on the numbers): Hex shorter than Kit and Rook, Sable the tallest, Rook at least as tall as Kit.
    expect(got.hex?.now.h).toBeLessThan(got.kit?.now.h ?? 0);
    expect(got.hex?.now.h).toBeLessThan(got.rook?.now.h ?? 0);
    expect(got.sable?.now.h).toBeGreaterThan(got.kit?.now.h ?? 0);
    expect(got.sable?.now.h).toBeGreaterThan(got.rook?.now.h ?? 0);
    expect(got.rook?.now.h).toBeGreaterThanOrEqual(got.kit?.now.h ?? 0);
  }
  // The heroes stand on their feet: the foot anchor is the row under the lowest sole of the baked picture.
  const feet = await page.evaluate(() => window.__stagelab?.scene()?.fighters.filter((f) => f.side === 'party').map((f) => f.fig.foot.y - 1 === f.fig.box.y1));
  expect(feet).toEqual([true, true, true, true]);
  expect(errors).toEqual([]);
});

test('the heroes are the same size in the lab and in the editor (one global file)', async ({ page }) => {
  const scratch = scratchName('prop-same');
  try {
    await openLab(page, '?stage=street&set=3&clean');
    const lab = await sizes(page);
    // The lab reads Mark's current file, so the editor's copy must start from it too (not from the fixture).
    await openEditor(page, scratch, '', { data: 'current' });
    const editor = await sizes(page);
    for (const id of IDS) expect(editor[id]?.now, id).toEqual(lab[id]?.now);
  } finally {
    dropScratch(scratch);
  }
});

/** Select a hero by clicking its body. */
async function selectHero(page: Page, id: string): Promise<void> {
  const body = await bodyOf(page, 'party', SLOT[id] ?? 0);
  const at = await toScreen(page, body.x, body.y);
  await page.mouse.click(at.x, at.y);
  await flush(page);
}

/** Move a slider the way a drag does: input events while it moves, one change event when it is let go. */
async function dragSlider(page: Page, label: string, values: number[], release = true): Promise<void> {
  await page.evaluate(
    ([name, vals, done]) => {
      const el = document.querySelector<HTMLInputElement>(`#inspector input[type=range][aria-label="${name}"]`);
      if (!el) throw new Error(`no slider ${name}`);
      for (const v of vals as number[]) {
        el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (done) el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    [`${label} slider`, values, release] as const,
  );
  await flush(page);
}

test('a hero selected shows the global Proportions group; Height previews live, is one undo step, reverts, saves and survives a reload', async ({ page }) => {
  const scratch = scratchName('prop-ed');
  try {
    const { errors } = await openEditor(page, scratch);
    // The numbers the scratch copy starts with (the fixture's): every later check is relative to these.
    const start = await heroesInEditor(page);
    const hex0 = (start.hex as { height: number }).height;
    // Nothing selected: no group (it belongs to a hero).
    await expect(page.locator('#inspector summary', { hasText: 'Proportions' })).toHaveCount(0);
    await selectHero(page, 'hex');
    const group = page.locator('#inspector details.grp', { has: page.locator('summary', { hasText: 'Proportions' }) });
    await expect(group).toBeVisible();
    // The title says the scope in plain words, and the "?" explains the method.
    await expect(group.locator('summary')).toContainText('Proportions · this hero, all battles');
    await group.locator('summary button.qm').focus();
    await expect(page.locator('#tipbubble')).toContainText('Adds or removes whole rows and columns of pixels in the body, so the pixel art stays crisp. The head stays the same size.');
    await group.locator('summary button.qm').blur();
    await expect(group).toContainText('heroes.json');
    await expect(group).toContainText('Every battle uses this, on every stage.');
    await expect(group.locator('input[type=range]')).toHaveCount(2);
    const height = group.locator('input.num[aria-label="Height"]');
    await expect(height).toHaveValue(String(hex0));
    await expect(group.locator('.rev').first()).toBeHidden();
    await expect(page.locator('#st-save')).toHaveText('Saved');

    const hexNow = async (): Promise<number> => (await sizes(page)).hex?.now.h ?? 0;
    const was = await hexNow();
    // Drag: the sprite changes while the slider moves (before it is let go), and nothing is a step yet.
    await dragSlider(page, 'Height', [0.85, 0.95, 1.1], false);
    const live = await hexNow();
    expect(live).toBeGreaterThan(was);
    expect(await page.evaluate(() => window.__stageedit?.session.dirtyParts)).toEqual(['heroes']);
    await page.evaluate(() => window.__stagelab?.scene()?.fighters.find((f) => f.axisKey === 'hex')?.sprite.texture.key);
    await dragSlider(page, 'Height', [1.1], true);
    expect(await hexNow()).toBe(Math.round((await sizes(page)).hex!.drawn.h * 1.1));
    // One drag, one undo step.
    expect((await page.evaluate(() => window.__stageedit?.session.changeCount)) ?? 0).toBe(1);
    await expect(group.locator('.rev').first()).toBeVisible();
    await expect(page.locator('#b-save')).toHaveAttribute('title', /Save heroes\.json/);
    // The other heroes did not change, and a figure's anchor, box and shadow are the new picture's.
    expect((await sizes(page)).kit?.now.h).toBe(Math.round((await sizes(page)).kit!.drawn.h * (start.kit as { height: number }).height));

    // Nothing piles up: dragging the slider a lot leaves one baked sheet per hero.
    await dragSlider(page, 'Height', [0.7, 0.75, 0.8, 0.9, 1.2, 1.3, 1.25], true);
    const baked = await page.evaluate(() => (window.__stagelab?.textureKeys() ?? []).filter((k) => k.startsWith('crewb-hex[')));
    expect(baked.length).toBe(1);

    await page.keyboard.press('Control+z');
    await flush(page);
    expect(await page.evaluate(() => window.__stageedit?.session.data.heroes.hex?.height)).toBe(1.1);
    await page.keyboard.press('Control+z');
    await flush(page);
    expect(await hexNow()).toBe(was);
    expect(await page.evaluate(() => window.__stageedit?.session.data.heroes.hex?.height)).toBe(hex0);
    await expect(page.locator('#st-save')).toHaveText('Saved');
    await page.keyboard.press('Control+y');
    await flush(page);
    expect(await page.evaluate(() => window.__stageedit?.session.data.heroes.hex?.height)).toBe(1.1);

    // The revert arrow goes back to the saved value (one more step).
    await group.locator('.rev').first().click();
    await flush(page);
    expect(await hexNow()).toBe(was);
    await expect(page.locator('#st-save')).toHaveText('Saved');

    // Build works the same way, and changes the width.
    const w0 = (await sizes(page)).hex?.now.w ?? 0;
    await dragSlider(page, 'Build', [1.1, 1.2], true);
    expect((await sizes(page)).hex?.now.w).toBeGreaterThan(w0);
    expect((await sizes(page)).hex?.now.h).toBe(was);

    // Save writes heroes.json to the scratch copy, and the real file is untouched.
    const real = () => page.evaluate(async () => (await (await fetch('/__stage/stages', { cache: 'no-store' })).json()).heroes as string);
    const realBefore = await real();
    await page.keyboard.press('Control+s');
    await expect(page.locator('#st-msg')).toContainText('Saved to scratch copy');
    expect(await real()).toBe(realBefore);
    expect(await page.evaluate(() => window.__stageedit?.session.dirty)).toBe(false);

    // Reload: the numbers are where they were left, in the data and on the stage.
    const grown = (await sizes(page)).hex?.now;
    await page.reload();
    await waitReady(page);
    expect(await page.evaluate(() => window.__stageedit?.session.data.heroes.hex?.build)).toBe(1.2);
    expect((await sizes(page)).hex?.now).toEqual(grown);
    expect(errors).toEqual([]);
  } finally {
    dropScratch(scratch);
  }
});

test('a heroes file the loader would refuse is not saved, and no file is changed', async ({ page }) => {
  const scratch = scratchName('prop-bad');
  try {
    await openEditor(page, scratch);
    await page.evaluate(() => {
      window.__stageedit?.session.edit('break it', (d) => {
        const e = d.heroes.hex;
        if (e) e.height = 5;
      });
    });
    await page.keyboard.press('Control+s');
    await expect(page.locator('#st-msg')).toContainText(/Not saved:.*height must be a number from 0\.6 to 1\.5/);
    expect(await page.evaluate(() => window.__stageedit?.session.dirty)).toBe(true);
  } finally {
    dropScratch(scratch);
  }
});

test('the help panel says where a setting lives in one line', async ({ page }) => {
  const scratch = scratchName('prop-help');
  try {
    await openEditor(page, scratch);
    await page.locator('#b-help').click();
    await expect(page.getByText('Anything about a character or the whole game is global')).toBeVisible();
  } finally {
    dropScratch(scratch);
  }
});

test.describe('Battle Test with scaled frames', () => {
  test.skip(!HAVE_SPRITES, 'needs Mark’s Sprite Fusion folder for Rook’s strike frames');

  test('Rook’s strike plays from the baked pictures, the blow lands on the foe, and the console stays quiet', async ({ page }) => {
    const scratch = scratchName('prop-bt');
    try {
      const { errors } = await openEditor(page, scratch);
      const rookNumbers = (await heroesInEditor(page)).rook as { height: number; build: number };
      await page.evaluate(() => {
        const e = window.__stageedit;
        if (!e) throw new Error('no editor');
        const st = e.session.stage;
        e.startBattle({ party: st.demo.party, roster: st.demo.rosters['3'] ?? [], setKey: '3', seed: 3, fullResources: true, speed: 1, auto: false });
        const scene = window.__stagelab?.scene();
        if (scene) scene.speed = 0;
      });
      await page.evaluate(() => {
        const bt = window.__stageedit?.battle();
        if (!bt) throw new Error('no battle');
        bt.press('left');
        bt.press('ok'); // Kit: Guard
        bt.press('ok');
        bt.press('ok'); // Rook: Attack, first foe
        bt.press('left');
        bt.press('ok'); // Hex: Guard
        bt.press('left');
        bt.press('ok'); // Sable: Guard
      });
      const result = await page.evaluate(() => {
        const scene = window.__stagelab?.scene();
        const bt = window.__stageedit?.battle();
        if (!scene || !bt) throw new Error('no battle');
        const rook = scene.fighters.filter((f) => f.side === 'party')[1];
        if (!rook) throw new Error('no rook');
        const stills = new Set<string>();
        const hp0 = bt.status().foes.map((f) => f.hp);
        let crowd = 0;
        for (let i = 0; i < 600; i++) {
          scene.step(1);
          if (rook.still) stills.add(rook.still.texture);
          crowd = Math.max(crowd, scene.fighters.length);
        }
        return { stills: [...stills], hp0, hp1: bt.status().foes.map((f) => f.hp), plan: rook.plan ? { h: rook.plan.height, b: rook.plan.build } : null };
      });
      // Every picture of the strike is a baked one (the name carries Rook's numbers), and he does hit.
      expect(result.plan).toEqual({ h: rookNumbers.height, b: rookNumbers.build });
      expect(result.stills.length).toBeGreaterThan(5);
      for (const s of result.stills) expect(s, s).toContain(`[${rookNumbers.height}x${rookNumbers.build}]`);
      expect(result.hp1.some((hp, i) => hp < (result.hp0[i] ?? 0))).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      dropScratch(scratch);
    }
  });
});

// ------------------------------------------------------------------ pictures (only when PROP_MEDIA is set)

test.describe('pictures', () => {
  test.skip(!MEDIA, 'set PROP_MEDIA=<folder> to write the pictures');

  test('the line-up and the editor', async ({ page }) => {
    const dir = MEDIA ?? '';
    mkdirSync(dir, { recursive: true });
    await page.setViewportSize({ width: 960, height: 540 });
    await openLab(page, '?stage=street&set=3&clean');
    await page.addStyleTag({ content: '#status, #labbar { display: none !important; }' });
    await flush(page);
    await page.locator('#stage canvas').screenshot({ path: join(dir, 'prop-r1-lineup-2x.png') });
    await page.setViewportSize({ width: 1600, height: 900 });
    const scratch = scratchName('prop-shot');
    try {
      await openEditor(page, scratch, '&set=3');
      await selectHero(page, 'hex');
      await page.screenshot({ path: join(dir, 'prop-r1-editor-hex.png') });
      await page.locator('#b-warn').click();
      await page.screenshot({ path: join(dir, 'prop-r1-warnings.png') });
    } finally {
      dropScratch(scratch);
    }
  });
});
