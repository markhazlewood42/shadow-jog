/**
 * The stage scene's seams for the editor, on the Shadow Jog Engine (ET task 5). These are the 10 cases of the Phaser stage lab's `stagelab-edit.spec.ts` (spike
 * `spike/phaser-stage`), which tested `StageScene.applyStage`, `showStage`, `setEnemySet`, `setPhase`, `setEditMode` on the spike's own page `/stagelab.html`. That page and class
 * are gone; the editor page (`/stageedit.html`) runs the real `BattleStageScene` through `StageHost` (`src/dev/stageedit/host.ts`), so the same checks run there:
 *
 * a changed stage config really changes the scene (the horizon repaints the picture, another stage, another enemy group, another moment of the turn, a moved HUD region, a
 * changed shadow), none of it leaks textures or leaves stray objects, the frame comes from the fixed tick (so a replay is the same every run), and a fighter dragged with the mouse
 * lands on another depth row and sorts there.
 *
 * Mapping: `applyStage` is `host.setStage` (`BattleStageScene.loadStage`, hot reload), `showStage` is `setStage` of the other stage, `setEnemySet` is `setEnemies`, `setPhase` is
 * the host's, `currentStage()` is the editor's session, `step(n)` is `game.step(n)`. What the engine's scene does not have, and the cases that depended on it, are listed in the
 * Record of docs/engine/et-brief.md ("Archive cases dropped"): the effects picture of the Act moment (`fx-` textures), the dotted home ring, the Phaser input hit areas of edit mode.
 */
import { expect, type Page, test } from '@playwright/test';
import { dropScratch, flush, openEditor, scratchName, bodyOf, dragGame } from './stageeditkit';

let scratch = '';
test.beforeEach(() => {
  scratch = scratchName('scene');
});
test.afterEach(() => dropScratch(scratch));

/** How many textures of a kind the engine holds. */
const countOf = (page: Page, prefix: string): Promise<number> => page.evaluate((p) => (window.__stagelab?.textureKeys() ?? []).filter((k) => k.startsWith(p)).length, prefix);
/** The stage host of the page (the scene that runs now). */
const hostKey = (page: Page): Promise<string> => page.evaluate(() => window.__stagelab?.scene()?.pictureKey ?? '');

test('moving the horizon repaints the picture: the kerb follows the horizon, the wall stays complete and old pictures are removed', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  const keys = new Set<string>();
  for (const horizon of [137, 145, 157, 145]) {
    await page.evaluate((h) => {
      const s = window.__stagelab?.scene();
      if (!s) throw new Error('no scene');
      // (The 640x360 art's kerb row is 176, so the skyline's shift is the horizon less 176.)
      s.setStage({ ...s.config, backdrop: { ...s.config.backdrop, horizonY: h, shiftY: h - 176 }, floor: { ...s.config.floor, y0: h } });
    }, horizon);
    keys.add(await hostKey(page));
    await flush(page);
    // Only the current stage picture exists: a dragged horizon does not leave one behind per step.
    expect(await countOf(page, 'stage-')).toBe(1);
    // The kerb row (the street's `edge` colour) sits exactly on the horizon, with the wall above it and floor below.
    const [above, kerb, floor] = await page.evaluate((h) => window.__stagelab?.pixels([[8, h - 1], [8, h], [8, h + 20]]) ?? Promise.reject(new Error('no hook')), horizon);
    const edge = await page.evaluate(() => (window.__stagelab?.scene()?.config.floor as { edge?: string | null } | undefined)?.edge);
    expect(edge, 'the street stage has a kerb colour').toBeTruthy();
    expect(kerb).toBe(String(edge).toLowerCase());
    expect(above).not.toBe('#07060d'); // the window clear colour: if it shows through, a gap was left
    expect(floor).not.toBe(above);
  }
  // Going back to a horizon finds the picture by its name again: 3 distinct pictures for 3 distinct horizons.
  expect(keys.size).toBe(3);
  expect(errors).toEqual([]);
});

test('another floor seed repaints the floor; the same config keeps its picture (nothing is painted twice)', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  const key = await hostKey(page);
  const textures = await page.evaluate(() => window.__stagelab?.textureCount() ?? 0);
  await page.evaluate(() => {
    const s = window.__stagelab?.scene();
    if (!s) throw new Error('no scene');
    s.setStage({ ...s.config });
  });
  expect(await hostKey(page)).toBe(key);
  expect(await page.evaluate(() => window.__stagelab?.textureCount())).toBe(textures);
  await page.evaluate(() => {
    const s = window.__stagelab?.scene();
    if (!s) throw new Error('no scene');
    s.setStage({ ...s.config, floor: { ...s.config.floor, seed: 4242 } });
  });
  expect(await hostKey(page)).not.toBe(key);
  expect(await countOf(page, 'stage-')).toBe(1);
  expect(errors).toEqual([]);
});

test('another stage, another enemy group and another moment of the turn rebuild what they need, with no leaks', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  const baseline = await page.evaluate(() => ({ hud: window.__stagelab?.scene()?.hudObjects?.objects.length ?? 0, fighters: window.__stagelab?.scene()?.fighters.length ?? 0 }));
  expect(baseline.fighters).toBe(7);

  // Every group on both stages, then the same walk again: the second pass finds every picture by name, so nothing grows.
  const walk = async (): Promise<number> => {
    for (const id of ['sewer', 'street']) {
      await page.evaluate(async (i) => {
        const configUrl = '/src/battlestage/config.ts';
        const { resolveStage } = await import(/* @vite-ignore */ configUrl);
        const ed = window.__stageedit;
        const entry = ed?.session.data.stages[i];
        if (!ed || !entry) throw new Error(`no stage ${i}`);
        ed.host.setStage(resolveStage(entry, ed.session.data.hud));
      }, id);
      expect(await page.evaluate(() => window.__stagelab?.scene()?.config.id)).toBe(id);
      expect(await countOf(page, 'stage-')).toBe(1);
      for (const [key, count] of [['1', 1], ['2', 2], ['4', 4], ['5', 5], ['6', 6], ['boss', 1], ['boss+1', 2], ['boss+2', 3], ['3', 3]] as const) {
        await page.evaluate((k) => {
          const s = window.__stagelab?.scene();
          const roster = s?.config.demo.rosters[k];
          if (!s || !roster) throw new Error(`no roster for ${k}`);
          s.setEnemies(roster);
        }, key);
        expect(await page.evaluate(() => window.__stagelab?.scene()?.fighters.filter((f) => f.side === 'enemy').length)).toBe(count);
      }
    }
    return page.evaluate(() => window.__stagelab?.textureCount() ?? 0);
  };
  const first = await walk();
  const second = await walk();
  expect(second).toBe(first);
  // Back where we started: the same number of figures and HUD objects (nothing of the other groups is left behind).
  expect(await page.evaluate(() => window.__stagelab?.scene()?.fighters.length)).toBe(baseline.fighters);
  expect(await page.evaluate(() => window.__stagelab?.scene()?.hudObjects?.objects.length)).toBe(baseline.hud);
  await flush(page);
  expect(await page.evaluate(() => window.__stagelab?.crisp())).toBe(true);
  const snap = await page.evaluate(() => window.__stagelab?.snapshot() ?? Promise.reject(new Error('no hook')));
  expect(snap.colours).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test('the three moments of the turn show the regions the design says, and one hero is active', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  const boxes = (): Promise<string[]> => page.evaluate(() => ['turnOrder', 'commands', 'partyStatus', 'enemyInfo', 'banner', 'combo'].filter((n) => !!window.__stagelab?.scene()?.hudObjects?.box(n as never)));
  const state = (): Promise<{ active: number; target: number; flashed: number; view: string; banner: string | null }> =>
    page.evaluate(() => {
      const s = window.__stagelab?.scene();
      if (!s) throw new Error('no scene');
      return {
        active: s.fighters.filter((f) => f.active).length,
        target: s.fighters.filter((f) => f.target).length,
        flashed: s.fighters.filter((f) => f.flash > 0).length,
        view: s.viewNow?.phase ?? '',
        banner: s.viewNow?.banner ?? null,
      };
    });
  const phase = (p: 'choose' | 'target' | 'act'): Promise<void> => page.evaluate((q) => window.__stagelab?.scene()?.setPhase(q), p);

  expect(await boxes()).toEqual(['turnOrder', 'commands', 'partyStatus', 'enemyInfo']);
  expect(await state()).toMatchObject({ active: 1, target: 0, flashed: 0, view: 'choose', banner: null });

  await phase('target');
  expect((await boxes()).sort()).toEqual(['banner', 'commands', 'enemyInfo', 'partyStatus', 'turnOrder']);
  expect(await state()).toMatchObject({ active: 1, target: 1, flashed: 0, view: 'target' });
  expect((await state()).banner).toMatch(/: pick a target$/);

  await phase('act');
  expect((await boxes()).sort()).toEqual(['banner', 'combo', 'enemyInfo', 'partyStatus', 'turnOrder']);
  expect(await state()).toMatchObject({ active: 1, target: 1, flashed: 1, view: 'act' });
  // The attacker moved to the target's row, borrows its sort row plus a pixel, and the target is knocked back 3 px.
  const act = await page.evaluate(() => {
    const s = window.__stagelab?.scene();
    const a = s?.fighters.find((f) => f.active);
    const t = s?.fighters.find((f) => f.target);
    if (!s || !a || !t) throw new Error('no attacker or target');
    return { attackerY: a.y, targetY: t.baseY, sortY: a.sortY, bodyDx: t.bodyDx, attackerMoved: a.x !== a.baseX, targetSortY: t.sortY, lunge: s.config.sort.lungeOverTarget };
  });
  expect(act.attackerY).toBe(act.targetY);
  expect(act.sortY).toBe(act.targetSortY + act.lunge);
  expect(act.bodyDx).toBe(3);
  expect(act.attackerMoved).toBe(true);

  // And back: everyone is home again.
  await phase('choose');
  expect(await state()).toMatchObject({ active: 1, target: 0, flashed: 0 });
  expect(await page.evaluate(() => window.__stagelab?.scene()?.fighters.every((f) => f.x === f.baseX && f.y === f.baseY && f.bodyDx === 0))).toBe(true);
  expect(errors).toEqual([]);
});

test('the bottom boxes share one frame, and the command strip keeps its slot (dimmed) while an action plays', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  // The design's own layout (the shipped hud-640.json holds Mark's choice, the action-left preset): this test is about how that band is framed.
  await page.evaluate(async () => {
    const url = '/src/dev/stageedit/presets.ts';
    const saveUrl = '/src/dev/stageedit/save.ts';
    const { applyPresetOn } = await import(/* @vite-ignore */ url);
    const { SET_SCREEN } = await import(/* @vite-ignore */ saveUrl);
    const s = window.__stagelab?.scene();
    if (!s) throw new Error('no scene');
    const hud = JSON.parse(JSON.stringify(s.config.hud));
    applyPresetOn(SET_SCREEN, hud, 'timeline-bottom3', true);
    s.setStage({ ...s.config, hud });
  });
  const frames = (): Promise<Array<[number, number]>> => page.evaluate(() => (window.__stagelab?.scene()?.hudObjects?.frames ?? []).map((f) => [f.x, f.y] as [number, number]));
  // One band from the party table to the enemy box (the 480x270 band at [4, 226], on the 640x360 screen: 80 px right and on the bottom edge).
  expect(await frames()).toEqual([[84, 316]]);
  await page.evaluate(() => window.__stagelab?.scene()?.setPhase('act'));
  // The command box is gone (the existing rule), but its slot holds a standby strip, so the band has no hole.
  expect(await page.evaluate(() => !!window.__stagelab?.scene()?.hudObjects?.box('commands'))).toBe(false);
  expect(await frames()).toEqual([[84, 316], [284, 316]]);
  await page.evaluate(() => window.__stagelab?.scene()?.setPhase('choose'));
  expect(await frames()).toEqual([[84, 316]]);
  // A box hidden by hand leaves the band and no standby strip appears for it.
  await page.evaluate(() => {
    const s = window.__stagelab?.scene();
    if (!s) throw new Error('no scene');
    s.setStage({ ...s.config, hud: { ...s.config.hud, commands: { ...s.config.hud.commands, show: 'never' } } });
    s.setPhase('act');
  });
  expect(await frames()).toEqual([]);
  expect(errors).toEqual([]);
});

test('two identical foes carry their A and B on the stage and the lone one carries none', async ({ page }) => {
  const { errors } = await openEditor(page, scratch, '&stage=street&set=3&phase=choose');
  const tags = await page.evaluate(() => (window.__stagelab?.scene()?.fighters ?? []).filter((f) => f.side === 'enemy').map((f) => (f.bar ? f.bar.tag : null)));
  // Punk, Punk, Glowrat: the two punks are A and B, the rat has no tag.
  expect(tags.map((t) => t || null).sort()).toEqual([null, 'A', 'B'].sort());
  expect(errors).toEqual([]);
});

test('HUD regions and the shadow follow the config: move a box, hide one, change the shadow share', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  // (Only the numbers cross to the test: a display object itself is a huge graph that Playwright would try to copy.)
  const where = (name: string): Promise<{ x: number; y: number } | null> =>
    page.evaluate((n) => {
      const b = window.__stagelab?.scene()?.hudObjects?.box(n as never);
      return b ? { x: b.x, y: b.y } : null;
    }, name);
  // Wherever the shipped HUD layout puts the party table, the scene draws it there.
  const placed = await page.evaluate(() => {
    const r = window.__stagelab?.scene()?.config.hud.partyStatus;
    if (!r) throw new Error('no party status box');
    return { x: r.x, y: r.y };
  });
  expect(await where('partyStatus')).toMatchObject(placed);
  await page.evaluate(() => {
    const s = window.__stagelab?.scene();
    if (!s) throw new Error('no scene');
    s.setStage({ ...s.config, hud: { ...s.config.hud, partyStatus: { ...s.config.hud.partyStatus, x: 40, y: 200 }, commands: { ...s.config.hud.commands, show: 'never' } } });
  });
  expect(await where('partyStatus')).toMatchObject({ x: 40, y: 200 });
  expect(await where('commands')).toBeNull();
  await flush(page);
  const snap = await page.evaluate(() => window.__stagelab?.snapshot() ?? Promise.reject(new Error('no hook')));
  expect(snap.colours).toBeGreaterThan(100);

  // A shadow slider: 30 steps, and the number of shadow textures never grows past the sizes in use (7 fighters at most).
  let most = 0;
  const widths = new Set<number>();
  for (let i = 0; i < 30; i++) {
    const share = 0.3 + i * 0.03;
    await page.evaluate((w) => {
      const s = window.__stagelab?.scene();
      if (!s) throw new Error('no scene');
      s.setStage({ ...s.config, shadow: { ...s.config.shadow, widthScale: w } });
    }, share);
    most = Math.max(most, await countOf(page, 'shadow-'));
    for (const w of await page.evaluate(() => (window.__stagelab?.scene()?.fighters ?? []).map((f) => f.shadowW))) widths.add(w);
  }
  expect(most).toBeLessThanOrEqual(7);
  expect(widths.size).toBeGreaterThan(5);
  expect(errors).toEqual([]);
});

test('a figure is one unit in the sort: its shadow and ring sort inside its group, so a nearer fighter covers all of a farther one', async ({ page }) => {
  const { errors } = await openEditor(page, scratch, '&set=6');
  const parts = await page.evaluate(() => {
    const s = window.__stagelab?.scene();
    if (!s) throw new Error('no scene');
    return s.fighters.map((f) => {
      const d = f.describe();
      return { id: f.id, side: f.side, y: f.sortY, depth: f.depth, group: d.depth, shadow: d.shadow.depth, ring: d.ring.depth, ringShown: d.ring.visible };
    });
  });
  expect(parts.filter((p) => p.side === 'enemy')).toHaveLength(6);
  // (In the spike every part had its own flat depth, `figure depth + PART`. On the engine the figure is a container with the one depth number and the parts keep a small LOCAL depth.)
  for (const p of parts) {
    expect(p.group).toBe(p.depth);
    expect(p.shadow).toBe(-0.5);
    // (A ring that is not shown keeps its stub depth; the ring of the moment, the acting hero's, sits at -0.4.)
    if (p.ringShown) expect(p.ring).toBe(-0.4);
  }
  expect(parts.filter((p) => p.ringShown).length).toBeGreaterThanOrEqual(1);
  // A figure on a nearer row sorts above every part of a farther one: the groups differ by at least a whole row, the parts by less than 1.
  for (const far of parts) for (const near of parts) if (near.y > far.y) expect(near.group + near.shadow).toBeGreaterThan(far.group + 0.25);
  expect(errors).toEqual([]);
});

test('frames come from the fixed tick: the same tick shows the same picture, and stepping N ticks moves exactly N', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  const result = await page.evaluate(async () => {
    const url = '/src/battlestage/idle.ts'; // the dev server serves the module the game itself runs
    const { idleFrame, enemyIdle } = await import(/* @vite-ignore */ url);
    const host = window.__stagelab?.scene();
    const game = window.__stagelab?.game;
    if (!host || !game) throw new Error('no editor');
    const s = host.scene;
    const bad: string[] = [];
    const check = (): void => {
      for (const f of s.figures) {
        const body = f.describe().body;
        if (f.sheet) {
          const want = idleFrame(s.worldFrame, f.sheet.fps, f.sheet.count, f.sheet.phase);
          if (Number(body.frame) !== want) bad.push(`${f.id} tick ${s.worldFrame}: frame ${body.frame}, wanted ${want}`);
        } else {
          const o = enemyIdle(f.idle as never, s.worldFrame, f.uid);
          if (body.x !== f.bodyDx + f.offX + o.x || body.y !== 1 + f.offY + o.y) bad.push(`${f.id} tick ${s.worldFrame}: sway off`);
        }
      }
    };
    const start = s.frame;
    check();
    game.step(1);
    check();
    game.step(59);
    check();
    game.step(200);
    check();
    // Frames that really change over a second (the sheet loops, not a still).
    const seen = new Set<string | number>();
    for (let i = 0; i < 60; i++) {
      game.step(1);
      const hero = s.figures.find((f) => f.sheet);
      if (hero) seen.add(hero.describe().body.frame ?? -1);
    }
    return { bad, advanced: s.frame - start, frames: seen.size };
  });
  expect(result.bad).toEqual([]);
  // 1 + 59 + 200 + 60 ticks stepped by hand, all inside one synchronous call, so the clock cannot add any.
  expect(result.advanced).toBe(320);
  expect(result.frames).toBeGreaterThan(3);
  expect(errors).toEqual([]);
});

test('a fighter picked up with the mouse and dropped on another depth row: the scene follows, and its depth and shadow sort on the new row', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  const kit = await bodyOf(page, 'party', 0);
  const before = await page.evaluate(() => window.__stagelab?.scene()?.fighters.find((x) => x.id === 'kit')?.slot.row);
  expect(before).toBe(4);
  // Drop so the FEET end up near row 2 and x 200: the pointer keeps its offset from the feet.
  const rows = await page.evaluate(() => window.__stagelab?.scene()?.config.rows.map((r) => r.y) ?? []);
  const target = { x: 200, y: (rows[2] ?? 0) + 3 };
  await dragGame(page, { x: kit.x, y: kit.y }, { x: target.x + (kit.x - kit.feetX), y: target.y + (kit.y - kit.feetY) });
  const after = await page.evaluate(() => {
    const s = window.__stagelab?.scene();
    const f = s?.fighters.find((x) => x.id === 'kit');
    if (!s || !f) throw new Error('kit gone');
    const d = f.describe();
    return { slot: f.slot, x: f.x, y: f.y, depth: f.depth, shadowDepth: d.depth + d.shadow.depth, rowY: s.config.rows[f.slot.row]?.y, saved: window.__stageedit?.session.stage.party[0], half: s.config.screen?.w ? s.config.screen.w / 2 : 0 };
  });
  // Snapped to the nearest row (2), x where it was dropped, depth and shadow follow, and the editor's data has it.
  expect(after.slot.row).toBe(2);
  expect(Math.abs(after.slot.x - target.x)).toBeLessThanOrEqual(3);
  expect(after.y).toBe(after.rowY ?? -1);
  const closeness = 240 - Math.min(240, Math.abs(after.x - after.half));
  expect(after.depth).toBe((after.rowY ?? 0) * 1000 + closeness * 2);
  expect(after.shadowDepth).toBe(after.depth - 0.5);
  expect(after.saved).toMatchObject({ x: after.slot.x, row: 2 });
  expect(errors).toEqual([]);
});
