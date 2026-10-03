/**
 * The Battle Test (`/stageedit.html`, spike `spike/phaser-stage`): a real fight on the stage you are editing.
 *
 * What these check, in the order of the item's rubric: the fight is driven by the real battle engine (the health bars
 * move when the blow lands, not before; the stage under test is the UNSAVED one), Rook's strike plays from his frames
 * with the lunge, the hitstop and the hit effect, a hit makes the target (and a hero) flinch, the whole thing is
 * frame-counted (the same seed and the same ticks give the same trace), and nothing writes to the console.
 *
 * Time is controlled: after a test starts the scene's real-time clock is switched off (`scene.speed = 0`) and the
 * specs advance the fight with `scene.step(n)`, so a run never depends on how fast the machine is.
 */
import { expect, type Page, test } from '@playwright/test';
import { dropScratch, flush, openEditor, scratchName } from './stageeditkit';

let scratch = '';
test.beforeEach(() => {
  scratch = scratchName('bt');
});
test.afterEach(() => dropScratch(scratch));

/** The orders for one test: Kit, Hex and Sable guard; Rook attacks the first foe. */
interface Opts {
  setKey: string;
  seed: number;
  auto?: boolean;
}

/** Start a fight without the dialog and freeze real time so only `step` moves it. */
async function startFight(page: Page, o: Opts): Promise<void> {
  await page.evaluate((opts) => {
    const e = window.__stageedit;
    if (!e) throw new Error('no editor');
    const st = e.session.stage;
    e.startBattle({ party: st.demo.party, roster: st.demo.rosters[opts.setKey] ?? [], setKey: opts.setKey, seed: opts.seed, fullResources: true, speed: 1, auto: !!opts.auto });
    const scene = window.__stagelab?.scene();
    if (scene) scene.speed = 0;
  }, o);
}

/** Rook attacks, everyone else guards (Kit, Hex and Sable each press Guard then confirm). */
async function rookAttacks(page: Page): Promise<void> {
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
}

const status = (page: Page) => page.evaluate(() => window.__stageedit?.battle()?.status());

/** One tick's worth of what is on the stage, for Rook and the first foe. */
interface Snap {
  frame: number;
  world: number;
  still: string;
  x: number;
  y: number;
  offX: number;
  flash: boolean;
  pause: number;
  foeHp: number[];
  foeFlash: boolean;
  fx: number;
}

/** Step one tick at a time for `n` ticks and record Rook and the first foe after each. */
async function trace(page: Page, n: number): Promise<Snap[]> {
  return page.evaluate((count) => {
    const scene = window.__stagelab?.scene();
    const bt = window.__stageedit?.battle();
    if (!scene || !bt) throw new Error('no scene');
    const rook = scene.fighters.filter((f) => f.side === 'party')[1];
    const foe = scene.fighters.filter((f) => f.side === 'enemy')[0];
    if (!rook || !foe) throw new Error('no fighters');
    const out: Snap[] = [];
    for (let i = 0; i < count; i++) {
      scene.step(1);
      out.push({
        frame: scene.frame,
        world: scene.worldFrame,
        still: rook.still?.texture ?? 'idle',
        x: rook.x,
        y: rook.y,
        offX: rook.offX,
        flash: rook.flash,
        pause: bt.perf.pause,
        foeHp: bt.status().foes.map((f) => f.hp),
        foeFlash: foe.flash,
        fx: bt.perf.fxCount,
      });
    }
    return out;
  }, n);
}

test('the Battle Test button opens RPG Maker’s dialog: party tabs, status, troop, options', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  await page.locator('#b-test').click();
  const dlg = page.getByRole('dialog', { name: 'Battle Test' });
  await expect(dlg).toBeVisible();
  // One tab per party slot, named for who stands there.
  await expect(dlg.getByRole('tab')).toHaveCount(4);
  await expect(dlg.getByRole('tab').nth(1)).toContainText('Rook');
  // The status panel is the game's own stat code: Rook at level 10 has the most health of the crew.
  await dlg.getByRole('tab').nth(1).click();
  await expect(dlg.getByTestId('bt-status')).toContainText('130');
  await expect(dlg.getByTestId('bt-status')).toContainText('Arc Cut');
  // A level change updates the numbers.
  const hpBefore = await dlg.getByTestId('bt-status').innerText();
  await dlg.getByTestId('bt-level').fill('14');
  await dlg.getByTestId('bt-level').press('Tab');
  expect(await dlg.getByTestId('bt-status').innerText()).not.toBe(hpBefore);
  // The troop is the enemies on the stage; the options are there.
  await expect(dlg.getByTestId('bt-troop')).toContainText('Rustfang Punk');
  await expect(dlg.getByTestId('bt-auto')).toBeVisible();
  await expect(dlg.getByTestId('bt-seed')).toBeVisible();
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await expect(dlg).toHaveCount(0);
  expect(await page.evaluate(() => window.__stageedit?.battle() ?? null)).toBeNull();
  expect(errors).toEqual([]);
});

test('Start runs one real turn: the health changes by the engine’s number, the HUD follows, and the console stays quiet', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  await page.locator('#b-test').click();
  const dlg = page.getByRole('dialog', { name: 'Battle Test' });
  await dlg.getByTestId('bt-auto').check();
  await dlg.getByRole('button', { name: 'Start' }).click();
  await expect(dlg).toHaveCount(0);
  await page.evaluate(() => {
    const scene = window.__stagelab?.scene();
    if (scene) scene.speed = 0;
  });
  const before = await status(page);
  expect(before?.foes.map((f) => f.hp)).toEqual(before?.foes.map((f) => f.maxHp));
  // Play until the first round is over (auto-play gives the orders).
  await page.evaluate(() => {
    const scene = window.__stagelab?.scene();
    const bt = window.__stageedit?.battle();
    if (!scene || !bt) throw new Error('no battle');
    for (let i = 0; i < 2000 && bt.status().round < 1; i++) scene.step(1);
    for (let i = 0; i < 2000 && (bt.perf.busy || bt.flow.mode === 'playing'); i++) scene.step(1);
  });
  const after = await status(page);
  expect(after?.round).toBe(1);
  // Somebody lost health, and what the player sees equals what the engine has.
  const lost = (after?.foes ?? []).some((f) => f.hp < f.maxHp) || (after?.party ?? []).some((p) => p.hp < p.maxHp);
  expect(lost).toBe(true);
  const agree = await page.evaluate(() => {
    const bt = window.__stageedit?.battle();
    return bt ? bt.flow.battle.units.every((u) => bt.flow.disp.get(u.uid)?.hp === Math.max(0, u.hp)) : false;
  });
  expect(agree).toBe(true);
  // The HUD says what happened: the party table and the enemy box are drawn from the same numbers.
  const hudHp = await page.evaluate(() => window.__stagelab?.scene()?.currentView.party.map((m) => m.hp));
  expect(hudHp).toEqual(after?.party.map((p) => p.hp));
  await expect(page.locator('#st-msg')).toContainText('Testing the saved stage');
  expect(errors).toEqual([]);
});

test('tests the UNSAVED stage, and Esc comes back to the editor with the selection intact', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  await page.evaluate(() => {
    const e = window.__stageedit;
    if (!e) return;
    e.session.select([{ kind: 'fighter', side: 'party', index: 1 }]);
    e.session.edit('Move the horizon', (d) => {
      const s = d.stages[e.session.stageId];
      if (s) s.backdrop.horizonY = 104;
    });
    e.flush();
  });
  const horizonBefore = await page.evaluate(() => window.__stageedit?.session.stage.backdrop.horizonY);
  expect(horizonBefore).toBe(104);
  await page.keyboard.press('Control+Enter');
  const dlg = page.getByRole('dialog', { name: 'Battle Test' });
  await expect(dlg).toContainText('unsaved changes');
  await dlg.getByRole('button', { name: 'Start' }).click();
  // The fight runs on the edited horizon.
  expect(await page.evaluate(() => window.__stagelab?.scene()?.config.backdrop.horizonY)).toBe(104);
  await expect(page.locator('#st-msg')).toContainText('Testing unsaved changes');
  // While it runs the editor’s own keys stay out of the way: Delete would remove a selection, here it does nothing.
  await page.keyboard.press('Delete');
  expect(await page.evaluate(() => window.__stageedit?.session.dirty)).toBe(true);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__stageedit?.battle() ?? null)).toBeNull();
  const back = await page.evaluate(() => ({ selection: JSON.stringify(window.__stageedit?.session.selection), dirty: window.__stageedit?.session.dirty, live: !!window.__stagelab?.scene()?.liveView }));
  expect(back).toEqual({ selection: JSON.stringify([{ kind: 'fighter', side: 'party', index: 1 }]), dirty: true, live: false });
  await expect(page.locator('#st-msg')).toContainText('Back to editing');
  expect(errors).toEqual([]);
});

test('Rook’s strike: dip, overhead wind-up, swing, hit on tick 33 with a 7-tick hitstop, follow-through and home again', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  await startFight(page, { setKey: 'boss', seed: 8 });
  await rookAttacks(page);
  // Advance to the moment Rook's move begins, then trace it tick by tick.
  const beginAt = await page.evaluate(() => {
    const scene = window.__stagelab?.scene();
    const bt = window.__stageedit?.battle();
    if (!scene || !bt) throw new Error('no battle');
    let n = 0;
    while (!bt.perf.log.some((l) => l.includes('rook-strike')) && n++ < 3000) scene.step(1);
    return n;
  });
  expect(beginAt).toBeLessThan(3000);
  const t = await trace(page, 130);
  const stills = [...new Set(t.map((s) => s.still))];
  // The frames Mark drew, in order, with the swing frames between.
  expect(stills.filter((s) => s !== 'idle').map((s) => s.replace('still-rook-', ''))).toEqual(['dip', 'riseA', 'rise', 'windup', 'smearA', 'mid', 'smearB', 'swingB', 'followFade', 'follow', 'recover']);
  // The blow lands on the swing-B frame: the foe's health bar drops on that tick and not before.
  const hitIndex = t.findIndex((s) => s.foeHp[0] !== (t[0] as Snap).foeHp[0]);
  expect(hitIndex).toBeGreaterThan(20);
  expect(t[hitIndex]?.still).toBe('still-rook-swingB');
  expect(t.slice(0, hitIndex).every((s) => s.foeHp[0] === (t[0] as Snap).foeHp[0])).toBe(true);
  // Hitstop: for the next 7 ticks the real clock runs and the world clock and the move do not.
  const stop = t.slice(hitIndex, hitIndex + 9);
  const frozenTicks = stop.filter((s, i) => i > 0 && s.world === (stop[i - 1] as Snap).world).length;
  expect(frozenTicks).toBe(7);
  expect(stop[1]?.x).toBe(stop[6]?.x);
  expect(stop[1]?.foeFlash).toBe(true); // the target is white while the world holds
  // The lunge: Rook moved forward and sideways onto the target's row, and came home exactly.
  const first = t[0] as Snap;
  const farthest = t.reduce((m, s) => (s.x > m.x ? s : m), first);
  expect(farthest.x - first.x).toBeGreaterThan(40);
  expect(t[t.length - 1]?.x).toBe(first.x);
  expect(t[t.length - 1]?.y).toBe(first.y);
  // Effects were spawned by the hit (glow, cut, shards, number) and the screen shook.
  expect(Math.max(...t.map((s) => s.fx))).toBeGreaterThan(8);
  expect(errors).toEqual([]);
});

test('the same seed and the same ticks give the same fight, tick for tick', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  const run = async (): Promise<string> => {
    await startFight(page, { setKey: '3', seed: 21, auto: true });
    const out = await page.evaluate(() => {
      const scene = window.__stagelab?.scene();
      const bt = window.__stageedit?.battle();
      if (!scene || !bt) throw new Error('no battle');
      const rows: unknown[] = [];
      for (let i = 0; i < 600; i++) {
        scene.step(1);
        rows.push([bt.perf.pause, scene.fighters.map((f) => [f.x, f.y, f.offX, f.offY, f.flash ? 1 : 0, f.alpha, f.still?.texture ?? '-']), bt.status().foes.map((f) => f.hp), bt.status().party.map((p) => p.hp)]);
      }
      return JSON.stringify([rows, bt.perf.log]);
    });
    await page.evaluate(() => window.__stageedit?.stopBattle());
    return out;
  };
  const a = await run();
  const b = await run();
  expect(a).toBe(b);
  expect(a.length).toBeGreaterThan(5000);
  expect(errors).toEqual([]);
});

test('a hit makes the target flinch: white and shoved back, then home, and a hero flinches the same way', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  // Auto-play, so the enemies get their turns too and hit the heroes.
  await startFight(page, { setKey: '3', seed: 8, auto: true });
  const seen = await page.evaluate(() => {
    const scene = window.__stagelab?.scene();
    const bt = window.__stageedit?.battle();
    if (!scene || !bt) throw new Error('no battle');
    const foe = scene.fighters.filter((f) => f.side === 'enemy')[0];
    const heroes = scene.fighters.filter((f) => f.side === 'party');
    if (!foe) throw new Error('no foe');
    let foeFlashed = false;
    let foeOffset = 0;
    let heroFlashed = '';
    let heroOffset = 0;
    for (let i = 0; i < 2500; i++) {
      scene.step(1);
      if (foe.flash) foeFlashed = true;
      foeOffset = Math.max(foeOffset, foe.offX);
      for (const h of heroes) {
        if (h.flash && !heroFlashed) heroFlashed = h.id;
        heroOffset = Math.min(heroOffset, h.offX);
      }
      if (foeFlashed && heroFlashed && !bt.perf.busy) break;
    }
    // Let the round finish with nobody giving new orders; then everyone still standing is home, plain and fully drawn
    // (a defeated fighter is the one thing that may stay changed: a hero dimmed, an enemy gone).
    bt.setAuto(false);
    for (let i = 0; i < 4000 && (bt.perf.busy || bt.flow.mode === 'playing'); i++) scene.step(1);
    const settled = scene.fighters.every((f) => f.down || (f.offX === 0 && f.offY === 0 && !f.flash && f.alpha === 1 && f.x === f.baseX && f.y === f.baseY));
    return { foeFlashed, foeOffset, heroFlashed, heroOffset, settled, busy: bt.perf.busy };
  });
  expect(seen.foeFlashed).toBe(true);
  expect(seen.foeOffset).toBeGreaterThan(0); // an enemy is shoved to the right, away from the heroes
  expect(seen.heroFlashed).not.toBe('');
  expect(seen.heroOffset).toBeLessThan(0); // a hero is shoved to the left
  expect(seen.busy).toBe(false);
  expect(seen.settled).toBe(true);
  expect(errors).toEqual([]);
});

test('a whole fight plays out on auto-play to a victory or a defeat, the status line says so, and Esc returns the stage whole', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  await startFight(page, { setKey: '3', seed: 8, auto: true });
  const res = await page.evaluate(() => {
    const scene = window.__stagelab?.scene();
    const bt = window.__stageedit?.battle();
    if (!scene || !bt) throw new Error('no battle');
    let n = 0;
    while (bt.flow.mode !== 'over' && n++ < 20000) scene.step(1);
    for (let i = 0; i < 80; i++) scene.step(1);
    return { mode: bt.flow.mode, outcome: bt.flow.outcome, rounds: bt.status().round, ticks: n };
  });
  expect(res.mode).toBe('over');
  expect(['win', 'lose']).toContain(res.outcome);
  await flush(page);
  await expect(page.locator('#st-msg')).toContainText(/Victory|Defeat/);
  await page.keyboard.press('Escape');
  // The stage is back to its lab state: every enemy is standing again, nobody is dimmed.
  const back = await page.evaluate(() => {
    const scene = window.__stagelab?.scene();
    return scene ? { live: !!scene.liveView, foes: scene.fighters.filter((f) => f.side === 'enemy').map((f) => f.alpha), down: scene.fighters.some((f) => f.down) } : null;
  });
  expect(back).toEqual({ live: false, foes: [1, 1, 1], down: false });
  expect(errors).toEqual([]);
});

test('the keyboard drives the orders: arrows choose, Enter confirms, Backspace steps back', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  await startFight(page, { setKey: '3', seed: 8 });
  const mode = (): Promise<string | undefined> => page.evaluate(() => window.__stageedit?.battle()?.status().mode);
  expect(await mode()).toBe('command');
  await page.keyboard.press('Enter');
  expect(await mode()).toBe('target');
  expect(await page.evaluate(() => window.__stagelab?.scene()?.currentView.target)).toBe(0);
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => window.__stagelab?.scene()?.currentView.target)).toBe(1);
  await page.keyboard.press('Backspace');
  expect(await mode()).toBe('command');
  for (let hero = 0; hero < 4; hero++) {
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
  }
  expect(await mode()).toBe('playing');
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// The judges' and Mark's pictures. Skipped unless BATTLETEST_MEDIA names a folder; the frames of the animation go to
// BATTLETEST_FRAMES (a folder in the OS temp area) for `scripts`-free assembly into an APNG and a GIF afterwards.
// ---------------------------------------------------------------------------------------------------------------
const MEDIA = process.env.BATTLETEST_MEDIA;
const FRAMES = process.env.BATTLETEST_FRAMES;

test('the pictures of round 1 (only when BATTLETEST_MEDIA is set)', async ({ page }) => {
  test.skip(!MEDIA, 'set BATTLETEST_MEDIA to a folder to write the pictures');
  const out = MEDIA as string;
  const { errors } = await openEditor(page, scratch);
  const canvas = page.locator('#stage canvas');
  const shot = async (name: string): Promise<void> => {
    await flush(page);
    await canvas.screenshot({ path: `${out}/p4-battle-r1-${name}.png` });
  };
  const stepN = (n: number): Promise<void> => page.evaluate((k) => window.__stagelab?.scene()?.step(k), n);

  // 1. The dialog, as RPG Maker's: party tabs, status, troop, options.
  await page.locator('#b-test').click();
  const dlg = page.getByRole('dialog', { name: 'Battle Test' });
  await dlg.getByRole('tab').nth(1).click();
  await flush(page);
  await page.screenshot({ path: `${out}/p4-battle-r1-dialog.png` });
  await dlg.getByRole('button', { name: 'Cancel' }).click();

  // 2. Rook's strike on the Warden, with the menus first.
  await startFight(page, { setKey: 'boss', seed: 8 });
  await shot('menu-2x');
  await rookAttacks(page);
  await page.evaluate(() => {
    const scene = window.__stagelab?.scene();
    const bt = window.__stageedit?.battle();
    if (!scene || !bt) throw new Error('no battle');
    let n = 0;
    while (!bt.perf.log.some((l) => l.includes('rook-strike')) && n++ < 3000) scene.step(1);
  });
  // The frame sequence of the animation: every 3rd tick (20 pictures a second, exactly 50 ms each) from a few ticks before the dip.
  const marks: Record<number, string> = { 20: 'windup-2x', 32: 'swing-2x', 36: 'impact-2x', 52: 'follow-2x' };
  let tick = 0;
  let idx = 0;
  if (FRAMES) await shotAt(page, `${FRAMES}/f${String(idx++).padStart(3, '0')}.png`);
  while (tick < 100) {
    await stepN(1);
    tick++;
    if (marks[tick]) await shot(marks[tick] as string);
    if (FRAMES && tick % 3 === 0) await shotAt(page, `${FRAMES}/f${String(idx++).padStart(3, '0')}.png`);
  }
  await page.evaluate(() => window.__stageedit?.stopBattle());

  // 3. A hero flinching: the first enemy blow that lands during an auto-played fight.
  await startFight(page, { setKey: '3', seed: 8, auto: true });
  const found = await page.evaluate(() => {
    const scene = window.__stagelab?.scene();
    const bt = window.__stageedit?.battle();
    if (!scene || !bt) throw new Error('no battle');
    const heroes = scene.fighters.filter((f) => f.side === 'party');
    for (let i = 0; i < 4000; i++) {
      scene.step(1);
      if (bt.perf.pause > 0 && heroes.some((h) => h.flash)) return true;
    }
    return false;
  });
  expect(found).toBe(true);
  await shot('hurt-2x');
  await page.evaluate(() => window.__stageedit?.stopBattle());

  // 4. Kit's jab, cross and kick: the kick lands (tick 51 of her move).
  await startFight(page, { setKey: 'boss', seed: 8 });
  await page.evaluate(() => {
    const scene = window.__stagelab?.scene();
    const bt = window.__stageedit?.battle();
    if (!scene || !bt) throw new Error('no battle');
    bt.press('ok');
    bt.press('ok'); // Kit: Attack
    for (let i = 0; i < 3; i++) {
      bt.press('left');
      bt.press('ok'); // the others guard
    }
    let n = 0;
    while (!bt.perf.log.some((l) => l.includes('kit-punch')) && n++ < 3000) scene.step(1);
    for (let i = 0; i < 24; i++) scene.step(1);
  });
  await shot('kit-jab-2x');
  await stepN(12);
  await shot('kit-cross-2x');
  await stepN(24);
  await shot('kit-kick-2x');
  expect(errors).toEqual([]);
});

/** Screenshot the canvas to an exact path. */
async function shotAt(page: Page, path: string): Promise<void> {
  await flush(page);
  await page.locator('#stage canvas').screenshot({ path });
}
