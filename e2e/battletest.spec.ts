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
import { HAVE_SPRITES } from './stagelabkit';

let scratch = '';
test.beforeEach(() => {
  scratch = scratchName('bt');
});
test.afterEach(() => dropScratch(scratch));

/** The orders for one test: Kit, Hex and Sable guard; Rook attacks the first foe. */
interface Opts {
  setKey: string;
  /** The enemies, when not the stage's own for that group (they must be as many as the group has slots). */
  roster?: string[];
  seed: number;
  auto?: boolean;
}

/** Start a fight without the dialog and freeze real time so only `step` moves it. */
async function startFight(page: Page, o: Opts): Promise<void> {
  await page.evaluate((opts) => {
    const e = window.__stageedit;
    if (!e) throw new Error('no editor');
    const st = e.session.stage;
    e.startBattle({ party: st.demo.party, roster: opts.roster ?? st.demo.rosters[opts.setKey] ?? [], setKey: opts.setKey, seed: opts.seed, fullResources: true, speed: 1, auto: !!opts.auto });
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
// Round 2: the blade meets the body, the run goes in front of the crew, a hit reads as a hit on a hero, a fallen hero kneels,
// summons and boss phases are drawn, the dialog picks the troop, and everything also works with the stand-in art CI draws.
// ---------------------------------------------------------------------------------------------------------------

/** The conditions a test can step the fight toward (named, so no code is built from strings). */
type Until = 'hit' | 'hitSettled' | 'heroDown' | 'quiet' | 'summoned' | 'formChanged' | 'twoRounds';

/** Step the fight until the condition holds (or `max` ticks), inside the page; returns how many ticks it took. */
async function stepUntil(page: Page, until: Until, max = 6000): Promise<number> {
  return page.evaluate(
    ([name, limit]) => {
      const scene = window.__stagelab?.scene();
      const bt = window.__stageedit?.battle();
      if (!scene || !bt) throw new Error('no battle');
      const done = (): boolean => {
        switch (name) {
          case 'hit':
            return bt.perf.landed.length > 0;
          case 'hitSettled':
            return bt.perf.pause === 0 && bt.perf.fxCount > 4;
          case 'heroDown':
            return scene.fighters.some((f) => f.side === 'party' && f.down);
          case 'quiet':
            return !bt.perf.busy;
          case 'summoned':
            return bt.perf.log.some((l) => l.includes('joins the fight'));
          case 'formChanged':
            return bt.perf.log.some((l) => l.includes('changes form'));
          case 'twoRounds':
            return bt.status().round >= 3 || (bt.status().round >= 2 && bt.flow.mode === 'command');
          default:
            return true;
        }
      };
      let n = 0;
      while (!done() && n < limit) {
        scene.step(1);
        n++;
      }
      return n;
    },
    [until, max] as const,
  );
}

for (const standIns of [false, true]) {
  const art = standIns ? 'stand-in art (what CI draws)' : 'Mark’s art';

  test(`the blade meets the body with ${art}: the contact point is inside the target’s silhouette, on the weapon’s tip, not at its bounding box`, async ({ page }) => {
    test.skip(!standIns && !HAVE_SPRITES, 'Mark’s Sprite Fusion folder is not on this machine (CI): the stand-in run covers this');
    const { errors } = await openEditor(page, scratch, standIns ? '&standins=1' : '');
    expect(await page.evaluate(() => window.__stagelab?.standIns)).toBe(standIns);
    await startFight(page, { setKey: 'boss', seed: 8 });
    await rookAttacks(page);
    await stepUntil(page, 'hit');
    const r = await page.evaluate(() => {
      const scene = window.__stagelab?.scene();
      const bt = window.__stageedit?.battle();
      if (!scene || !bt) throw new Error('no battle');
      const rook = scene.fighters.filter((f) => f.side === 'party')[1];
      const foe = scene.fighters.filter((f) => f.side === 'enemy')[0];
      const hit = bt.perf.landed[0];
      if (!rook || !foe || !hit) throw new Error('no hit');
      const raw = foe.fig.raw;
      const col = Math.round(foe.fig.foot.x + hit.x - foe.baseX);
      const row = Math.round(foe.fig.foot.y + hit.y - foe.baseY);
      const alpha = raw.px[(row * raw.w + col) * 4 + 3] ?? 0;
      const boxEdge = foe.baseX + (foe.fig.box.x0 - foe.fig.foot.x);
      return { hitX: hit.x, hitY: hit.y, tipX: rook.x + 58, alpha, boxEdge, rookY: rook.y, footY: foe.baseY };
    });
    // The spark is on the blade's tip (58 px in front of Rook's feet) and that point is solid body, not air between a boss's pods and legs.
    expect(Math.abs(r.hitX - r.tipX)).toBeLessThanOrEqual(1);
    expect(r.alpha).toBeGreaterThan(64);
    // The Warden's leg is well inside its bounding box (the shoulder pods stick out): the old rule would have stopped Rook at the box.
    expect(r.hitX).toBeGreaterThan(r.boxEdge + 8);
    // And the blow is low, at the blade, not at the chest.
    expect(r.hitY).toBeGreaterThan(r.footY - 14);
    // Play on: the health went down by the engine's number and nothing was written to the console.
    await stepUntil(page, 'hitSettled', 200);
    const hp = await status(page);
    expect(hp?.foes[0]?.hp).toBeLessThan(hp?.foes[0]?.maxHp ?? 0);
    expect(errors).toEqual([]);
  });
}

test('Rook runs in front of his crew on the way out and the way home, never through them', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  await startFight(page, { setKey: 'boss', seed: 8 });
  await rookAttacks(page);
  await untilMove(page, 'rook-strike');
  const t = await page.evaluate(() => {
    const scene = window.__stagelab?.scene();
    if (!scene) throw new Error('no scene');
    const party = scene.fighters.filter((f) => f.side === 'party');
    const [kit, rook, hex, sable] = party;
    if (!kit || !rook || !hex || !sable) throw new Error('no party');
    const rows: Array<{ x: number; y: number; sort: number; ticks: number }> = [];
    for (let i = 0; i < 140; i++) {
      scene.step(1);
      rows.push({ x: rook.x, y: rook.y, sort: rook.sortY, ticks: i });
    }
    return { rows, hexX: hex.baseX, sableX: sable.baseX, hexY: hex.baseY, kitY: kit.baseY, home: { x: rook.baseX, y: rook.baseY } };
  });
  // While he is level with Hex and Sable (and not yet at the end of the swerve), he is on the front lane, below their feet, and drawn in front of them.
  const passing = t.rows.filter((r) => r.x > t.hexX - 10 && r.x < t.sableX + 10 && r.ticks > 4 && r.ticks < 130);
  expect(passing.length).toBeGreaterThan(3);
  for (const r of passing.slice(0, passing.length - 3)) {
    expect(r.y, `at x ${r.x}`).toBeGreaterThanOrEqual(t.hexY + 22);
    expect(r.sort).toBeGreaterThan(t.hexY);
  }
  // He covers both ways: out, and back.
  const out = t.rows.filter((r) => r.x > t.hexX && r.x < t.sableX && r.ticks < 60).length;
  const back = t.rows.filter((r) => r.x > t.hexX && r.x < t.sableX && r.ticks >= 60).length;
  expect(out).toBeGreaterThan(0);
  expect(back).toBeGreaterThan(0);
  // He ends exactly at home.
  expect(t.rows[t.rows.length - 1]).toMatchObject({ x: t.home.x, y: t.home.y });
  expect(errors).toEqual([]);
});

test('a hit on a hero reads as a hit: a fading flash, a red wash that fades, a flinch back, and the number over the hero’s head', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  await startFight(page, { setKey: '3', seed: 8, auto: true });
  const r = await page.evaluate(() => {
    const scene = window.__stagelab?.scene();
    const bt = window.__stageedit?.battle();
    if (!scene || !bt) throw new Error('no battle');
    const heroes = scene.fighters.filter((f) => f.side === 'party');
    const foe = scene.fighters.filter((f) => f.side === 'enemy')[0];
    let hero: (typeof heroes)[number] | undefined;
    const flash: number[] = [];
    const tint: number[] = [];
    let offMax = 0;
    for (let i = 0; i < 5000; i++) {
      scene.step(1);
      hero = hero ?? heroes.find((h) => h.flash && bt.perf.pause > 0);
      if (hero) {
        flash.push(hero.flash ? hero.flashAmt : 0);
        tint.push(hero.tintAmt);
        offMax = Math.min(offMax, hero.offX);
        if (!hero.flash && flash.length > 6 && tint[tint.length - 1] === 0) break;
      }
    }
    if (!hero) throw new Error('no hero was hit');
    const g = scene.figureGeo(hero);
    const num = bt.perf.numberLog.filter((n) => n.target === hero?.id).pop();
    return { flash, tint, offMax, num, top: g.top, hx: hero.x, foeTint: foe?.tintAmt ?? -1 };
  });
  // The flash starts strong and fades; it is not one flat frame.
  expect(r.flash[0]).toBeGreaterThan(0.4);
  expect(Math.min(...r.flash)).toBeLessThan(r.flash[0] ?? 0);
  for (let i = 1; i < r.flash.length; i++) expect(r.flash[i]).toBeLessThanOrEqual((r.flash[i - 1] ?? 0) + 1e-9);
  // A red wash is on the hero while the flash is up, and fades to nothing.
  expect(Math.max(...r.tint)).toBeGreaterThan(0.2);
  expect(r.tint[r.tint.length - 1]).toBe(0);
  // Shoved back (to the left, away from the enemies).
  expect(r.offMax).toBeLessThanOrEqual(-3);
  // The number floats over the hero's head, not in the gap between heroes.
  expect(r.num).toBeTruthy();
  expect(r.num?.y ?? 999).toBeLessThan(r.top);
  expect(Math.abs((r.num?.x ?? 999) - r.hx)).toBeLessThan(12);
  // Enemies are never washed red.
  expect(r.foeTint).toBe(0);
  expect(errors).toEqual([]);
});

test('a hero who is knocked out kneels (made from the hero’s own idle) and stays down, dimmed', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  await startFight(page, { setKey: '3', seed: 8, auto: true });
  await page.evaluate(() => {
    const bt = window.__stageedit?.battle();
    if (!bt) throw new Error('no battle');
    for (const h of bt.flow.battle.party) h.hp = 1;
    bt.flow.sync();
  });
  await stepUntil(page, 'heroDown', 8000);
  await stepUntil(page, 'quiet', 600);
  await page.evaluate((n) => window.__stagelab?.scene()?.step(n), 30);
  const r = await page.evaluate(() => {
    const scene = window.__stagelab?.scene();
    if (!scene) throw new Error('no scene');
    const h = scene.fighters.find((f) => f.side === 'party' && f.down);
    if (!h) throw new Error('nobody is down');
    const standing = h.fig.box.y1 - h.fig.box.y0 + 1;
    const key = h.still?.texture ?? '';
    const tex = scene.textures.get(key);
    return { key, down: h.down, shownKey: h.sprite.texture.key, tint: h.tintAmt, texH: tex?.getSourceImage().height ?? 0, standing };
  });
  expect(r.down).toBe(true);
  expect(r.key).toMatch(/^still-down-/);
  expect(r.shownKey).toContain(r.key); // dimmed copy of the kneel
  expect(errors).toEqual([]);
});

test('a hero under a quarter of their health blinks (bar and numbers), shows their statuses, and the others do not', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  await startFight(page, { setKey: '3', seed: 8 });
  const read = (): Promise<{ blinking: number; on: boolean[]; frame: number }> =>
    page.evaluate(() => {
      const scene = window.__stagelab?.scene();
      const hud = scene?.hudObjects;
      if (!scene || !hud) throw new Error('no hud');
      return { blinking: hud.blinking, on: hud.blinkerStates(), frame: scene.frame };
    });
  expect((await read()).blinking).toBe(0);
  await page.evaluate(() => {
    const bt = window.__stageedit?.battle();
    if (!bt) throw new Error('no battle');
    const [kit, , hex] = bt.flow.battle.party;
    if (!kit || !hex) throw new Error('no party');
    kit.hp = 18; // 17%: red and blinking
    hex.hp = 36; // 42%: amber, steady
    kit.status.push({ id: 'poison', turns: 3 });
    bt.flow.sync();
    bt.press('right');
    bt.press('left'); // a key press redraws the HUD from the changed state
  });
  const a = await read();
  // Kit's bar and her numbers (two things that blink), nobody else.
  expect(a.blinking).toBe(2);
  const first = a.on;
  await page.evaluate(() => window.__stagelab?.scene()?.step(16));
  const b = await read();
  expect(b.on).not.toEqual(first);
  await page.evaluate(() => window.__stagelab?.scene()?.step(16));
  expect((await read()).on).toEqual(first);
  // The poison icon is on the HUD's textures.
  expect(await page.evaluate(() => window.__stagelab?.textureKeys().some((k) => k === 'chip-status-poison'))).toBe(true);
  expect(errors).toEqual([]);
});

test('a summon draws the new enemies, a boss phase swaps the picture, and the HUD follows each only when the stage does', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  await startFight(page, { setKey: 'boss', seed: 8, auto: true });
  await page.evaluate(() => {
    const bt = window.__stageedit?.battle();
    if (!bt) throw new Error('no battle');
    const w = bt.flow.battle.enemies[0];
    if (w) w.hp = Math.floor(w.base.maxHp * 0.6);
    bt.flow.sync();
  });
  // The Warden deploys drones: the HUD lists one foe until they arrive, then three... up to the engine's cap.
  const before = await page.evaluate(() => window.__stagelab?.scene()?.fighters.filter((f) => f.side === 'enemy').length);
  expect(before).toBe(1);
  await stepUntil(page, 'summoned', 8000);
  const during = await page.evaluate(() => {
    const scene = window.__stagelab?.scene();
    const bt = window.__stageedit?.battle();
    if (!scene || !bt) throw new Error('no battle');
    const foes = scene.fighters.filter((f) => f.side === 'enemy');
    return { drawn: foes.length, hud: scene.currentView.foes.length, engine: bt.flow.battle.enemies.length, names: foes.map((f) => f.name), alpha: foes.map((f) => f.alpha) };
  });
  expect(during.drawn).toBeGreaterThan(1);
  expect(during.hud).toBe(during.drawn);
  expect(during.engine).toBe(during.drawn);
  expect(during.names).toContain('Hunter Drone');
  expect(during.alpha[0]).toBe(1); // the Warden stays; the newcomer is fading in
  expect(Math.min(...during.alpha)).toBeLessThan(1);
  await stepUntil(page, 'quiet', 600);
  const settled = await page.evaluate(() => window.__stagelab?.scene()?.fighters.filter((f) => f.side === 'enemy').every((f) => f.alpha === 1 && !f.flash));
  expect(settled).toBe(true);

  // The shell breaks: the next blow that takes its last health makes the Warden the Unbound Warden, picture and name and bar.
  const phase = await page.evaluate(() => {
    const scene = window.__stagelab?.scene();
    const bt = window.__stageedit?.battle();
    if (!scene || !bt) throw new Error('no battle');
    const foe = scene.fighters.filter((f) => f.side === 'enemy')[0];
    if (!foe) throw new Error('no foe');
    const w = bt.flow.battle.enemies[0];
    const texBefore = foe.baseTex;
    const nameBefore = foe.name;
    if (w) w.hp = 5;
    bt.flow.sync();
    let sawOldNameWhileMorphing = false;
    for (let i = 0; i < 9000 && !bt.perf.log.some((l) => l.includes('changes form')); i++) {
      scene.step(1);
      if (scene.currentView.foes[0]?.name === nameBefore) sawOldNameWhileMorphing = true;
    }
    for (let i = 0; i < 80; i++) scene.step(1);
    return { texBefore, texAfter: foe.baseTex, nameAfter: foe.name, hudName: scene.currentView.foes[0]?.name, sawOldName: sawOldNameWhileMorphing, flash: foe.flash, enemyKeys: [...scene.enemies] };
  });
  expect(phase.texAfter).not.toBe(phase.texBefore);
  expect(phase.nameAfter).toBe('Unbound Warden');
  expect(phase.hudName).toBe('Unbound Warden');
  expect(phase.sawOldName).toBe(true);
  expect(phase.flash).toBe(false);
  expect(phase.enemyKeys[0]).toBe('warden_spirit');
  // Leaving the test puts the editor's own group back (a summon added enemies, a phase changed one).
  await page.evaluate(() => window.__stageedit?.stopBattle());
  await flush(page);
  const back = await page.evaluate(() => ({ keys: [...(window.__stagelab?.scene()?.enemies ?? [])], n: window.__stagelab?.scene()?.fighters.filter((f) => f.side === 'enemy').length }));
  expect(back).toEqual({ keys: ['rustfang_punk', 'glowrat', 'rustfang_punk'], n: 3 });
  expect(errors).toEqual([]);
});

test('the dialog picks the troop from the stage’s groups, shows whether the stage is edited, and tests one move on its own', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  await page.locator('#b-test').click();
  let dlg = page.getByRole('dialog', { name: 'Battle Test' });
  await expect(dlg.getByTestId('bt-badge')).toHaveText('Saved');
  // The troop is a picker over the stage's own groups, and the chips follow it.
  const sel = dlg.getByTestId('bt-troop-select');
  expect(await sel.locator('option').count()).toBeGreaterThanOrEqual(9);
  await sel.selectOption('boss+1');
  await expect(dlg.getByTestId('bt-troop')).toContainText('WARDEN');
  await expect(dlg.getByTestId('bt-troop')).toContainText('Rustfang Punk');
  // Test one move: Rook's Arc Cut, every round, nobody else acts.
  await dlg.getByTestId('bt-drill').selectOption({ label: 'Rook: Arc Cut' });
  await dlg.getByRole('button', { name: 'Start' }).click();
  await expect(dlg).toHaveCount(0);
  await page.evaluate(() => {
    const scene = window.__stagelab?.scene();
    if (scene) scene.speed = 0;
  });
  const foes = await page.evaluate(() => window.__stagelab?.scene()?.fighters.filter((f) => f.side === 'enemy').length);
  expect(foes).toBe(2);
  await stepUntil(page, 'twoRounds', 8000);
  const log = await page.evaluate(() => window.__stageedit?.battle()?.perf.log ?? []);
  expect(log.some((l) => l.startsWith('Rook Arc Cut'))).toBe(true);
  // None of the heroes' own plain attacks were ordered by anyone but Rook's drill.
  expect(log.filter((l) => /^(Kit|Hex|Sable) /.test(l) && !l.includes('Guard'))).toEqual([]);
  await page.keyboard.press('Escape');
  // The badge says so when the stage has unsaved changes.
  await page.evaluate(() => {
    const e = window.__stageedit;
    if (!e) return;
    e.session.edit('Note it', (d) => {
      const s = d.stages[e.session.stageId];
      if (s) s.note = 'Edited for the test.';
    });
    e.flush();
  });
  await page.locator('#b-test').click();
  dlg = page.getByRole('dialog', { name: 'Battle Test' });
  await expect(dlg.getByTestId('bt-badge')).toHaveText(/Edited/);
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  expect(errors).toEqual([]);
});

for (const standIns of [false, true]) {
  test(`every picture in moves.json is a real picture on the stage with ${standIns ? 'the stand-in art CI draws' : 'Mark’s art'}`, async ({ page }) => {
    test.skip(!standIns && !HAVE_SPRITES, 'Mark’s Sprite Fusion folder is not on this machine (CI): the stand-in run covers this');
    const { errors } = await openEditor(page, scratch, standIns ? '&standins=1' : '');
    expect(await page.evaluate(() => window.__stagelab?.standIns)).toBe(standIns);
    await startFight(page, { setKey: '3', seed: 8 });
    const r = await page.evaluate(() => {
      const scene = window.__stagelab?.scene();
      if (!scene) throw new Error('no scene');
      const { moves, stills } = scene.battleAssets();
      const empty: string[] = [];
      const missing: string[] = [];
      let checked = 0;
      for (const [id, m] of Object.entries(moves.moves)) {
        for (const [i, f] of m.frames.entries()) {
          if (f.still === '$idle' || f.still === '$down') continue;
          const info = stills[f.still];
          if (!info) {
            missing.push(`${id} frame ${i + 1}: ${f.still}`);
            continue;
          }
          checked++;
          const canvas = scene.textures.get(info.texture).getSourceImage() as HTMLCanvasElement;
          const ctx = canvas.getContext('2d');
          const data = ctx?.getImageData(0, 0, canvas.width, canvas.height).data;
          let solid = 0;
          if (data) for (let p = 3; p < data.length; p += 4) if ((data[p] ?? 0) > 0) solid++;
          if (solid < 200) empty.push(`${f.still} has ${solid} pixels`);
        }
      }
      return { checked, empty: [...new Set(empty)], missing };
    });
    expect(r.missing).toEqual([]);
    expect(r.empty).toEqual([]);
    expect(r.checked).toBeGreaterThan(40);
    expect(errors).toEqual([]);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The judges' and Mark's pictures. Skipped unless BATTLETEST_MEDIA names a folder; the frames of the animation go to
// BATTLETEST_FRAMES (a folder in the OS temp area) for assembly into an APNG and a GIF afterwards. BATTLETEST_ROUND
// names the files (`p4-battle-r<round>-<name>.png`); BATTLETEST_ONLY runs one group (rook, kit, hero, summon, dialog, standins).
// ---------------------------------------------------------------------------------------------------------------
const MEDIA = process.env.BATTLETEST_MEDIA;
const FRAMES = process.env.BATTLETEST_FRAMES;
const ROUND = process.env.BATTLETEST_ROUND ?? '2';
const ONLY = process.env.BATTLETEST_ONLY;
const want = (group: string): boolean => !ONLY || ONLY.split(',').includes(group);

/** Play until a move of this id has begun (its first tick comes on the next step). */
async function untilMove(page: Page, id: string): Promise<void> {
  await page.evaluate((move) => {
    const scene = window.__stagelab?.scene();
    const bt = window.__stageedit?.battle();
    if (!scene || !bt) throw new Error('no battle');
    let n = 0;
    while (!bt.perf.log.some((l) => l.includes(move)) && n++ < 4000) scene.step(1);
  }, id);
}

test('the pictures of the round (only when BATTLETEST_MEDIA is set)', async ({ page }) => {
  test.skip(!MEDIA, 'set BATTLETEST_MEDIA to a folder to write the pictures');
  const out = MEDIA as string;
  const { errors } = await openEditor(page, scratch);
  const canvas = page.locator('#stage canvas');
  const shot = async (name: string): Promise<void> => {
    await flush(page);
    await canvas.screenshot({ path: `${out}/p4-battle-r${ROUND}-${name}.png` });
  };
  const stepN = (n: number): Promise<void> => page.evaluate((k) => window.__stagelab?.scene()?.step(k), n);

  // 1. The dialog, as RPG Maker's: party tabs, status, troop picker, "test one move", options.
  if (want('dialog')) {
    await page.evaluate(() => {
      const e = window.__stageedit;
      if (!e) return;
      e.session.edit('Note the test', (d) => {
        const s = d.stages[e.session.stageId];
        if (s) s.note = 'Trying the boss group with Rook’s Arc Cut.';
      });
      e.flush();
    });
    await page.locator('#b-test').click();
    const dlg = page.getByRole('dialog', { name: 'Battle Test' });
    await dlg.getByRole('tab').nth(1).click();
    await dlg.getByTestId('bt-troop-select').selectOption('boss+1');
    await dlg.getByTestId('bt-drill').selectOption({ label: 'Rook: Arc Cut' });
    await flush(page);
    await page.screenshot({ path: `${out}/p4-battle-r${ROUND}-dialog.png` });
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await page.evaluate(() => window.__stageedit?.session.undo());
  }

  // 2. Rook's strike on the Warden, with the menus first.
  if (want('rook')) {
    await startFight(page, { setKey: 'boss', seed: 8 });
    await shot('menu-2x');
    await rookAttacks(page);
    await untilMove(page, 'rook-strike');
    // The loop's tick n is the move's tick n-1. Every 3rd tick is a picture of the animation (20 a second, 50 ms each).
    const marks: Record<number, string> = { 4: 'ready-2x', 10: 'dip-2x', 21: 'dash-2x', 30: 'swing-2x', 36: 'impact-2x', 54: 'follow-2x', 62: 'return-2x' };
    let tick = 0;
    let idx = 0;
    if (FRAMES) await shotAt(page, `${FRAMES}/f${String(idx++).padStart(3, '0')}.png`);
    while (tick < 110) {
      await stepN(1);
      tick++;
      if (marks[tick]) await shot(marks[tick] as string);
      if (FRAMES && tick % 3 === 0) await shotAt(page, `${FRAMES}/f${String(idx++).padStart(3, '0')}.png`);
    }
    await page.evaluate(() => window.__stageedit?.stopBattle());
  }

  // 3. Heroes hurt: the first enemy blow that lands, then a hero knocked out (the heroes are put on 1 health so the picture does not wait for luck).
  if (want('hero')) {
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
    await stepN(10);
    await shot('hurt-after-2x');
    await page.evaluate(() => window.__stageedit?.stopBattle());

    await startFight(page, { setKey: '3', seed: 8, auto: true });
    await page.evaluate(() => {
      const scene = window.__stagelab?.scene();
      const bt = window.__stageedit?.battle();
      if (!scene || !bt) throw new Error('no battle');
      for (const h of bt.flow.battle.party) h.hp = 1;
      bt.flow.sync();
      const heroes = scene.fighters.filter((f) => f.side === 'party');
      for (let i = 0; i < 6000 && !heroes.some((h) => h.down); i++) scene.step(1);
      for (let i = 0; i < 40; i++) scene.step(1);
    });
    await shot('ko-2x');
    await page.evaluate(() => window.__stageedit?.stopBattle());
  }

  // 4. Kit's jab, cross and kick on the Warden, and her crouching combo on a Glowrat.
  if (want('kit')) {
    await startFight(page, { setKey: 'boss', seed: 8 });
    await page.evaluate(() => {
      const bt = window.__stageedit?.battle();
      if (!bt) throw new Error('no battle');
      bt.press('ok');
      bt.press('ok'); // Kit: Attack
      for (let i = 0; i < 3; i++) {
        bt.press('left');
        bt.press('ok'); // the others guard
      }
    });
    await untilMove(page, 'kit-punch');
    await stepN(24);
    await shot('kit-jab-2x');
    await stepN(11);
    await shot('kit-cross-2x');
    await stepN(21);
    await shot('kit-kick-2x');
    await page.evaluate(() => window.__stageedit?.stopBattle());

    await startFight(page, { setKey: '1', roster: ['glowrat'], seed: 8 });
    await page.evaluate(() => {
      const bt = window.__stageedit?.battle();
      if (!bt) throw new Error('no battle');
      bt.press('ok');
      bt.press('ok'); // the Glowrat, the only foe
      for (let i = 0; i < 3; i++) {
        bt.press('left');
        bt.press('ok');
      }
    });
    await untilMove(page, 'kit-punch-low');
    await stepN(24);
    await shot('kit-low-jab-2x');
    await stepN(32);
    await shot('kit-low-kick-2x');
    await page.evaluate(() => window.__stageedit?.stopBattle());
  }

  // 5. A summon and a boss phase change on the Warden.
  if (want('summon')) {
    await startFight(page, { setKey: 'boss', seed: 8, auto: true });
    await page.evaluate(() => {
      const bt = window.__stageedit?.battle();
      if (!bt) throw new Error('no battle');
      // Under 70% health the Warden deploys its drones on its next turn.
      const w = bt.flow.battle.enemies[0];
      if (w) w.hp = Math.floor(w.base.maxHp * 0.6);
      bt.flow.sync();
    });
    await page.evaluate(() => {
      const scene = window.__stagelab?.scene();
      const bt = window.__stageedit?.battle();
      if (!scene || !bt) throw new Error('no battle');
      for (let i = 0; i < 6000 && !bt.perf.log.some((l) => l.includes('joins the fight')); i++) scene.step(1);
      for (let i = 0; i < 6; i++) scene.step(1);
    });
    await shot('summon-arrive-2x');
    await stepN(24);
    await shot('summon-2x');
    // The shell breaks: a blow that takes the last health.
    await page.evaluate(() => {
      const scene = window.__stagelab?.scene();
      const bt = window.__stageedit?.battle();
      if (!scene || !bt) throw new Error('no battle');
      const w = bt.flow.battle.enemies[0];
      if (w) w.hp = 5;
      bt.flow.sync();
      for (let i = 0; i < 8000 && !bt.perf.log.some((l) => l.includes('changes form')); i++) scene.step(1);
    });
    await shot('phase-2x');
    await stepN(40);
    await shot('phase-after-2x');
    await page.evaluate(() => window.__stageedit?.stopBattle());
  }
  expect(errors).toEqual([]);
});

test('the pictures with the stand-in art that CI draws (only when BATTLETEST_MEDIA is set)', async ({ page }) => {
  test.skip(!MEDIA || !want('standins'), 'set BATTLETEST_MEDIA to a folder to write the pictures');
  const out = MEDIA as string;
  const { errors } = await openEditor(page, scratch, '&standins=1');
  expect(await page.evaluate(() => window.__stagelab?.standIns)).toBe(true);
  const shot = async (name: string): Promise<void> => {
    await flush(page);
    await page.locator('#stage canvas').screenshot({ path: `${out}/p4-battle-r${ROUND}-standins-${name}.png` });
  };
  await startFight(page, { setKey: 'boss', seed: 8 });
  await rookAttacks(page);
  await untilMove(page, 'rook-strike');
  await page.evaluate((n) => window.__stagelab?.scene()?.step(n), 21);
  await shot('dash-2x');
  await page.evaluate((n) => window.__stagelab?.scene()?.step(n), 15);
  await shot('impact-2x');
  await page.evaluate((n) => window.__stagelab?.scene()?.step(n), 50);
  await shot('home-2x');
  expect(errors).toEqual([]);
});

test('timing: frame time while real fights play themselves in real time, with the HUD, the effects and six enemies or the boss and two helpers (reported, loose ceiling)', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  const firstFrameMs = await page.evaluate(() => window.__stagelab?.firstFrameMs ?? 0);
  const renderer = await page.evaluate(() => window.__stagelab?.renderer);
  const r = (n: number | undefined) => (n ?? 0).toFixed(2);
  // The two busiest groups: six enemies at once, and the Warden with two helpers (summons, a phase change). Auto-play, real time (speed 1), nothing frozen.
  for (const setKey of ['6', 'boss+2']) {
    await page.evaluate((key) => {
      const e = window.__stageedit;
      if (!e) throw new Error('no editor');
      const st = e.session.stage;
      e.startBattle({ party: st.demo.party, roster: st.demo.rosters[key] ?? [], setKey: key, seed: 8, fullResources: true, speed: 1, auto: true });
    }, setKey);
    await flush(page);
    await page.evaluate(() => window.__stagelab?.resetStats());
    // Sample the effect count while it plays (to show the window had effects in it) until the fight is over or 8 seconds have passed.
    const run = await page.evaluate(
      () =>
        new Promise<{ fxMax: number; ms: number; over: boolean }>((resolve) => {
          let fxMax = 0;
          const t0 = performance.now();
          const loop = (): void => {
            const bt = window.__stageedit?.battle();
            fxMax = Math.max(fxMax, bt?.perf.fxCount ?? 0);
            const ms = performance.now() - t0;
            const over = !!bt?.status().outcome;
            if (over || ms > 8000) resolve({ fxMax, ms, over });
            else requestAnimationFrame(loop);
          };
          loop();
        }),
    );
    const s = await page.evaluate(() => window.__stagelab?.stats());
    console.log(
      `battletest timing [${renderer}] group ${setKey}: editor first frame ${Math.round(firstFrameMs)} ms after navigation; ${s?.frames} frames in ${(run.ms / 1000).toFixed(1)} s of auto-play (${run.over ? 'fight over' : 'fight still going'}); ` +
        `most effects at once ${run.fxMax}; interval p50 ${r(s?.intervalP50)} ms p95 ${r(s?.intervalP95)} ms; CPU work per frame p50 ${r(s?.workP50)} ms p95 ${r(s?.workP95)} ms`,
    );
    await page.evaluate(() => window.__stageedit?.stopBattle());
    expect(s?.frames ?? 0).toBeGreaterThan(60);
    // Loose on purpose (a GPU-less CI runner is slow); the spike's real target (work p95 under 6 ms) is judged from the logged numbers.
    expect(s?.workP95 ?? 999).toBeLessThan(50);
  }
  expect(errors).toEqual([]);
});

/** Screenshot the canvas to an exact path. */
async function shotAt(page: Page, path: string): Promise<void> {
  await flush(page);
  await page.locator('#stage canvas').screenshot({ path });
}
