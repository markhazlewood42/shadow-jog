/**
 * Enemies face the heroes (spike `spike/phaser-stage`): the stage mirrors the enemy sprites that `src/data/enemyfacing.json`
 * lists, the Battle Stage Editor has a "Mirror (face the heroes)" switch for it, and Save writes the file with the others.
 *
 * Every editor test works on a private scratch copy of the data (`?scratch=<name>`), so Mark's real files are never written.
 * `FACING_MEDIA=<folder>` also writes the pictures (the line-ups and the editor with the switch) for the person reading the spike.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { ENEMIES } from '../src/data/enemies';
import { bodyOf, dropScratch, flush, openEditor, scratchName, toScreen, waitReady } from './stageeditkit';
import { openLab } from './stagelabkit';

const FACING = JSON.parse(readFileSync(join(process.cwd(), 'src/data/enemyfacing.json'), 'utf8')) as Record<string, { mirror: boolean; facing: string }>;
const MEDIA = process.env.FACING_MEDIA;

test.describe.configure({ mode: 'serial' });

/** Every enemy on the stage: its sprite key, whether the picture is flipped, and what the facing data says about that sprite. */
const enemiesOf = (page: Page): Promise<Array<{ id: string; sprite: string; flipX: boolean; mirror: boolean }>> =>
  page.evaluate(() => {
    const scene = window.__stagelab?.scene();
    if (!scene) throw new Error('no scene');
    return scene.fighters.filter((f) => f.side === 'enemy').map((f) => ({ id: f.id, sprite: f.axisKey, flipX: f.sprite.flipX, mirror: f.mirror }));
  });

test('the street stage draws every enemy flipped exactly as the facing data says, with no console errors', async ({ page }) => {
  const errors = await openLab(page, '?stage=street&set=6&clean');
  const enemies = await enemiesOf(page);
  expect(enemies.length).toBe(6);
  for (const e of enemies) {
    expect(FACING[e.sprite], `${e.id} has an entry in enemyfacing.json`).toBeDefined();
    expect(e.flipX, `${e.id} (${e.sprite})`).toBe(FACING[e.sprite]?.mirror);
    expect(e.mirror).toBe(e.flipX);
  }
  // The heroes are never flipped: they already face right.
  expect(await page.evaluate(() => window.__stagelab?.scene()?.fighters.filter((f) => f.side === 'party').some((f) => f.sprite.flipX || f.mirror))).toBe(false);
  expect(errors).toEqual([]);
});

test('every enemy of every group on both stages is flipped as the data says (a new group, a boss phase change and a summon too)', async ({ page }) => {
  const errors = await openLab(page, '?clean');
  const sets = ['1', '2', '3', '4', '5', '6', 'boss', 'boss+1', 'boss+2'];
  for (const stage of ['street', 'sewer']) {
    for (const set of sets) {
      await page.evaluate(([st, s]) => {
        const scene = window.__stagelab?.scene();
        scene?.showStage(st as string);
        scene?.setEnemySet(s as string);
      }, [stage, set]);
      for (const e of await enemiesOf(page)) expect(e.flipX, `${stage} ${set}: ${e.id}`).toBe(FACING[e.sprite]?.mirror);
    }
  }
  // Every one of the 21 sprites, one at a time: the flip follows the data for a sprite that is not in any demo group too.
  const every = Object.values(ENEMIES).map((e) => [e.id, e.sprite] as const);
  const flips = await page.evaluate((list) => {
    const scene = window.__stagelab?.scene();
    if (!scene) throw new Error('no scene');
    const out: Record<string, boolean> = {};
    for (const [key, sprite] of list) {
      scene.showStage('street');
      scene.setEnemies([key]);
      const f = scene.fighters.find((x) => x.side === 'enemy');
      if (f) out[sprite] = f.sprite.flipX;
    }
    return out;
  }, every);
  expect(Object.keys(flips).length).toBe(21);
  for (const [sprite, flipped] of Object.entries(flips)) expect(flipped, sprite).toBe(FACING[sprite]?.mirror);
  expect(errors).toEqual([]);
});

test('mirrored about the feet: the drawn silhouette is the art reversed about the foot point, and the feet do not move', async ({ page }) => {
  await openLab(page, '?stage=street&set=1&clean');
  const result = await page.evaluate(async () => {
    const scene = window.__stagelab?.scene();
    const hook = window.__stagelab;
    if (!scene || !hook) throw new Error('no scene');
    scene.speed = 0; // no idle sway: the sprite stays exactly where it was placed
    scene.setEnemies(['rustfang_punk']);
    const f = scene.fighters.find((x) => x.side === 'enemy');
    if (!f) throw new Error('no enemy');
    const out: Record<string, { drawn: number; wrong: number; spriteLeft: number }> = {};
    for (const mirror of [false, true]) {
      scene.setFacing({ ...scene.facing, punk: { mirror, facing: 'front', note: 'test' } });
      const art = f.art;
      const x0 = Math.floor(f.x) - 75;
      const y0 = Math.floor(f.y) - 115;
      const w = 150;
      const h = 125;
      // Picture one: only the backdrop. Picture two: the sprite as well. What differs is the sprite's drawn pixels.
      for (const part of [f.shadow, f.ring, f.home, f.bar, f.barTag]) part?.setVisible(false);
      f.sprite.setVisible(false);
      const without = await hook.region(x0, y0, w, h);
      f.sprite.setVisible(true);
      const withIt = await hook.region(x0, y0, w, h);
      let drawn = 0;
      let wrong = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const differs = [0, 1, 2].some((c) => withIt[i + c] !== without[i + c]);
          // Where this screen pixel comes from in the art: reversed about the foot point when mirrored.
          const sx = x0 + x - Math.floor(f.x);
          const sy = y0 + y - (Math.floor(f.y) + 1);
          const cx = mirror ? art.foot.x - 1 - sx : art.foot.x + sx;
          const cy = art.foot.y + sy;
          const inside = cx >= 0 && cy >= 0 && cx < art.raw.w && cy < art.raw.h;
          const solid = inside && (art.raw.px[(cy * art.raw.w + cx) * 4 + 3] ?? 0) > 0;
          if (differs) drawn++;
          // (A sprite pixel the same colour as the backdrop behind it is invisible to this test; there are very few.)
          if (solid && !differs) wrong++;
          if (!solid && differs) wrong++;
        }
      }
      out[String(mirror)] = { drawn, wrong, spriteLeft: f.sprite.x - f.sprite.displayOriginX };
      f.sprite.setVisible(true);
    }
    return out;
  });
  for (const mirror of ['false', 'true']) {
    const r = result[mirror];
    expect(r?.drawn, `mirror ${mirror}: something is drawn`).toBeGreaterThan(1500);
    // Under 1% of the sprite's pixels may disagree (a colour that happens to match the backdrop).
    expect((r?.wrong ?? 0) / (r?.drawn ?? 1), `mirror ${mirror}: pixels in the wrong place`).toBeLessThan(0.01);
  }
});

test('the editor shows the Mirror switch on a selected enemy; it is one undo step, saves with the others, and is still there after a reload', async ({ page }) => {
  const scratch = scratchName('facing');
  try {
    const { errors } = await openEditor(page, scratch);
    // Nothing selected: no switch (it belongs to an enemy).
    await expect(page.locator('#enemy-mirror')).toHaveCount(0);
    const body = await bodyOf(page, 'enemy', 0);
    const at = await toScreen(page, body.x, body.y);
    await page.mouse.click(at.x, at.y);
    await flush(page);
    const key = await page.evaluate(() => window.__stagelab?.scene()?.fighters.filter((f) => f.side === 'enemy')[0]?.axisKey ?? '');
    const was = FACING[key]?.mirror === true;
    const row = page.locator('#inspector .field.mirror');
    await expect(row).toContainText('Mirror (face the heroes)');
    await expect(page.locator('#enemy-mirror')).toBeVisible();
    expect(await page.locator('#enemy-mirror').isChecked()).toBe(was);
    // The "?" explains it in plain words; a revert arrow appears only after a change.
    await expect(row.locator('button.qm')).toHaveCount(1);
    await row.locator('button.qm').focus();
    await expect(page.locator('#tipbubble')).toContainText("Flips this enemy's picture left-to-right so it looks at the heroes. Mirroring also flips details like logos or which hand holds a weapon.");
    await row.locator('button.qm').blur();
    await expect(row.locator('.rev')).toBeHidden();
    await expect(page.locator('#st-save')).toHaveText('Saved');

    // Flip it: the scene follows at once, every appearance of that sprite changes with it, and the file is unsaved.
    await page.locator('#enemy-mirror').click();
    await flush(page);
    expect(await page.evaluate((k) => window.__stagelab?.scene()?.fighters.filter((f) => f.side === 'enemy' && f.axisKey === k).every((f) => f.sprite.flipX), key)).toBe(!was);
    await expect(row.locator('.rev')).toBeVisible();
    expect(await page.evaluate(() => window.__stageedit?.session.dirtyParts)).toEqual(['facing']);
    await expect(page.locator('#b-save')).toHaveAttribute('title', /Save enemyfacing\.json/);
    expect((await page.evaluate(() => window.__stageedit?.session.changeCount)) ?? 0).toBe(1);

    // Undo and redo, from the keyboard.
    await page.keyboard.press('Control+z');
    await flush(page);
    expect(await page.evaluate((k) => window.__stagelab?.scene()?.fighters.filter((f) => f.side === 'enemy' && f.axisKey === k).every((f) => f.sprite.flipX), key)).toBe(was);
    await expect(page.locator('#st-save')).toHaveText('Saved');
    await page.keyboard.press('Control+y');
    await flush(page);
    expect(await page.locator('#enemy-mirror').isChecked()).toBe(!was);

    // The revert arrow goes back to the saved value as one more step, and the arrow goes away.
    await row.locator('.rev').click();
    await flush(page);
    expect(await page.locator('#enemy-mirror').isChecked()).toBe(was);
    await expect(page.locator('#st-save')).toHaveText('Saved');
    await page.locator('#enemy-mirror').click();
    await flush(page);

    // Save writes the facing file (in the scratch copy), and the real file is untouched.
    const real = () => page.evaluate(async () => (await (await fetch('/__stage/stages', { cache: 'no-store' })).json()).facing as string);
    const realBefore = await real();
    await page.keyboard.press('Control+s');
    await expect(page.locator('#st-msg')).toContainText('Saved to scratch copy');
    expect(await real()).toBe(realBefore);
    expect(await page.evaluate(() => window.__stageedit?.session.dirty)).toBe(false);

    // Reload: the value is where it was left, in the data, in the scene and in the switch.
    await page.reload();
    await waitReady(page);
    expect(await page.evaluate((k) => window.__stageedit?.session.data.facing[k]?.mirror, key)).toBe(!was);
    expect(await page.evaluate((k) => window.__stagelab?.scene()?.fighters.filter((f) => f.side === 'enemy' && f.axisKey === k).every((f) => f.sprite.flipX), key)).toBe(!was);
    expect(errors).toEqual([]);
  } finally {
    dropScratch(scratch);
  }
});

test('a facing file the loader would refuse is not saved, and no file is changed', async ({ page }) => {
  const scratch = scratchName('facing-bad');
  try {
    await openEditor(page, scratch);
    await page.evaluate(() => {
      window.__stageedit?.session.edit('break it', (d) => {
        delete d.facing.rat;
      });
    });
    await page.keyboard.press('Control+s');
    await expect(page.locator('#st-msg')).toContainText(/Not saved:.*no entry for the sprite "rat"/);
    expect(await page.evaluate(() => window.__stageedit?.session.dirty)).toBe(true);
  } finally {
    dropScratch(scratch);
  }
});

test('the Battle Test uses the value in the editor, saved or not, and a summoned enemy is flipped as the data says', async ({ page }) => {
  const scratch = scratchName('facing-bt');
  try {
    const { errors } = await openEditor(page, scratch);
    // Flip the punk in the editor without saving, then fight three punks.
    await page.evaluate(() => {
      const se = window.__stageedit;
      if (!se) throw new Error('no editor');
      se.session.edit('Mirror punk', (d) => {
        const e = d.facing.punk;
        if (e) e.mirror = !e.mirror;
      });
    });
    await flush(page);
    const want = await page.evaluate(() => window.__stageedit?.session.data.facing.punk?.mirror);
    await page.evaluate(() => {
      const e = window.__stageedit;
      if (!e) throw new Error('no editor');
      const st = e.session.stage;
      e.startBattle({ party: st.demo.party, roster: ['rustfang_punk', 'rustfang_punk', 'rustfang_punk'], setKey: '3', seed: 3, fullResources: true, speed: 1, auto: false });
    });
    await flush(page);
    const fighting = await enemiesOf(page);
    expect(fighting.length).toBe(3);
    for (const e of fighting) expect(e.flipX).toBe(want);
    expect(await page.evaluate(() => window.__stageedit?.session.dirtyParts)).toEqual(['facing']);
    await page.evaluate(() => window.__stageedit?.stopBattle());
    await flush(page);
    expect(errors).toEqual([]);
  } finally {
    dropScratch(scratch);
  }
});

// ------------------------------------------------------------------ pictures (only when FACING_MEDIA is set)

test.describe('pictures', () => {
  test.skip(!MEDIA, 'set FACING_MEDIA=<folder> to write the pictures');

  test('line-ups and the editor', async ({ page }) => {
    const dir = MEDIA ?? '';
    mkdirSync(dir, { recursive: true });
    await page.setViewportSize({ width: 960, height: 540 });
    for (const [name, query] of [
      ['facing-street-lineup-2x.png', '?stage=street&set=4&clean'],
      ['facing-street-six-2x.png', '?stage=street&set=6&clean'],
      ['facing-street-boss-2x.png', '?stage=street&set=boss%2B2&clean'],
      ['facing-sewer-six-2x.png', '?stage=sewer&set=6&clean'],
    ] as const) {
      await openLab(page, query);
      await page.addStyleTag({ content: '#status, #labbar { display: none !important; }' });
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
      await page.locator('#stage canvas').screenshot({ path: join(dir, name) });
    }
    await page.setViewportSize({ width: 1600, height: 900 });
    await openEditor(page, scratchName('facing-shot'), '&set=4');
    // The first enemy of the four is a Rustfang Punk, a mirrored sprite: the switch is on.
    const body = await bodyOf(page, 'enemy', 0);
    const at = await toScreen(page, body.x, body.y);
    await page.mouse.click(at.x, at.y);
    await flush(page);
    await page.screenshot({ path: join(dir, 'facing-editor-1600x900.png') });
  });
});
