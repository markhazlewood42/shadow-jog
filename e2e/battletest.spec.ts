/**
 * Battle Test (`/stageedit.html`, ET task 6): a real fight on the stage you are editing. Decision 2, option B (docs/engine/et-brief.md): the fight is the game's OWN `BattleScene`,
 * run over the game's own `LiveStageScene` made from the editor's UNSAVED stage. There is no second battle in the editor, so there is no performer, no move animation and no
 * `moves.json` to test; what the archive's `e2e/battletest.spec.ts` asked of those is listed under "Archive cases dropped" in the brief's Record.
 *
 * What these check: the dialog (party tabs, the game's own stat code, troop, options); that the fight runs on the stage as it is on screen (pass line 9: an unsaved edit of a
 * slot is where the figure stands, `__SJ__.battleStage`); that the status trace of a seed equals the driver's `battleTrace` for that seed and another seed differs; that the keys
 * drive the game's own menus; that a hit reads as a hit; that a whole fight ends and the editor comes back; and that Esc returns with the selection and the undo history intact.
 *
 * Time is controlled: a spec stops the page's real 60 Hz loop (`game.stop()`) and plays the fight with `battle().advance(n)`, which runs n ticks and lets the battle's promises run
 * between ticks. So a run never depends on how fast the machine is, and the same ticks give the same picture.
 */
import { expect, type Page, test } from '@playwright/test';
import { sj, waitUntil } from './sjegamekit';
import { dropScratch, flush, openEditor, scratchName } from './stageeditkit';

let scratch = '';
test.beforeEach(() => {
  scratch = scratchName('bt');
  test.setTimeout(120_000);
});
test.afterEach(() => dropScratch(scratch));

/** What the page can be asked to start (the dialog's choices). */
interface Run {
  setKey?: string;
  seed?: number;
  auto?: boolean;
  /** Every hero at this level (low levels make the enemies hit back). */
  level?: number;
  timed?: boolean;
}

/** Stop the real loop, then start a fight without the dialog. Resolves when the fight is on. */
async function begin(page: Page, o: Run = {}): Promise<void> {
  await page.evaluate(async (r) => {
    const e = window.__stageedit;
    if (!e) throw new Error('no editor');
    window.__stagelab?.game?.stop();
    const st = e.session.resolved;
    const setKey = r.setKey ?? '3';
    const party = st.demo.party.map((m) => ({ ...m, ...(r.level ? { level: r.level } : {}) }));
    await e.startBattle({ party, roster: st.demo.rosters[setKey] ?? [], setKey, seed: r.seed ?? 8, fullResources: true, speed: 1, auto: !!r.auto, timed: !!r.timed });
  }, o);
}

/** Play `n` ticks (or fewer: the test may end by itself). */
const advance = (page: Page, n: number): Promise<number> => page.evaluate((k) => window.__stageedit?.battle()?.advance(k) ?? 0, n);

const status = (page: Page) => page.evaluate(() => window.__stageedit?.battle()?.status());
const mode = async (page: Page): Promise<string | undefined> => (await status(page))?.mode;
const trace = (page: Page) => page.evaluate(() => [...(window.__stageedit?.battle()?.trace ?? [])]);

/** Play until the fight is in this mode (the game's menu), at most `max` ticks. */
async function until(page: Page, want: string, max = 6000): Promise<void> {
  await page.evaluate(
    async ([m, limit]) => {
      const bt = window.__stageedit?.battle();
      if (!bt) throw new Error('no battle');
      await bt.advance(limit as number, () => bt.status().mode === m);
      if (bt.status().mode !== m) throw new Error(`the fight did not reach "${m}" (it is in "${bt.status().mode}")`);
    },
    [want, max] as const,
  );
}

/** Press a key and let the game see it (a tick or two). */
async function key(page: Page, k: string): Promise<void> {
  await page.keyboard.press(k);
  await advance(page, 3);
}

interface StageFigure {
  id: string;
  side: string;
  x: number;
  y: number;
  alpha: number;
  flash: number;
  tint: number;
  down: boolean;
  bodyDx: number;
  bar: { ratio: number; tag: string } | null;
}
const figures = (page: Page): Promise<StageFigure[]> => sj<StageFigure[]>(page, 'sj.battleStage ? sj.battleStage.figures : []');

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
  await expect(dlg.getByTestId('bt-timed')).not.toBeChecked();
  // Cancel starts nothing.
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await expect(dlg).toHaveCount(0);
  expect(await page.evaluate(() => window.__stageedit?.battle() ?? null)).toBeNull();
  // Control: before a test the page has no battle stage on its game hook.
  expect(await page.evaluate(() => (window as unknown as { __SJ__?: unknown }).__SJ__ ?? null)).toBeNull();
  expect(errors).toEqual([]);
});

test('Start runs one real round: the health changes by the engine’s number, the stage follows, and the console stays quiet', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  await page.evaluate(() => window.__stagelab?.game?.stop());
  await page.locator('#b-test').click();
  const dlg = page.getByRole('dialog', { name: 'Battle Test' });
  await dlg.getByTestId('bt-auto').check();
  await dlg.getByRole('button', { name: 'Start' }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page.locator('#st-msg')).toContainText('Testing the saved stage');
  const before = await status(page);
  expect(before?.foes.map((f) => f.hp)).toEqual(before?.foes.map((f) => f.maxHp));
  expect(await mode(page)).toBe('intro');
  // The fight is the game's: the intro plays, then the round menu comes up, and Auto plays the round.
  await until(page, 'round');
  await until(page, 'end');
  const after = await status(page);
  expect(after?.round).toBeGreaterThanOrEqual(1);
  // Somebody lost health, and what the engine has is what the line of the trace says.
  expect((after?.foes ?? []).some((f) => f.hp < f.maxHp) || (after?.party ?? []).some((p) => p.hp < p.maxHp)).toBe(true);
  const lines = await trace(page);
  expect(lines.length).toBeGreaterThan(1);
  const last = lines[lines.length - 1] ?? '';
  for (const f of after?.foes ?? []) expect(last).toContain(`${f.name}:${f.hp}/${f.maxHp}`);
  expect(errors).toEqual([]);
});

test('tests the UNSAVED stage, Delete leaves the slots and the selection as they were (it has no binding), and Esc comes back to the editor with the selection and the undo history intact', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  const slotX = await page.evaluate(() => window.__stagelab?.scene()?.config.party[0]?.x ?? 0);
  await page.evaluate(() => {
    const e = window.__stageedit;
    if (!e) return;
    e.session.select([{ kind: 'fighter', side: 'party', index: 1 }]);
    e.session.edit('Move slot 1', (d) => {
      const s = d.stages[e.session.stageId];
      const slot = s?.party[0];
      if (slot) slot.x += 40;
    });
    e.flush();
  });
  const mine = await page.evaluate(() => ({ selection: JSON.stringify(window.__stageedit?.session.selection), undo: window.__stageedit?.session.nextUndoLabel, canUndo: window.__stageedit?.session.canUndo, dirty: window.__stageedit?.session.dirty }));
  expect(mine).toEqual({ selection: JSON.stringify([{ kind: 'fighter', side: 'party', index: 1 }]), undo: 'Move slot 1', canUndo: true, dirty: true });
  await page.evaluate(() => window.__stagelab?.game?.stop());
  await page.keyboard.press('Control+Enter');
  const dlg = page.getByRole('dialog', { name: 'Battle Test' });
  await expect(dlg).toContainText('unsaved changes');
  await dlg.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('#st-msg')).toContainText('Testing unsaved changes');
  expect(await page.evaluate(() => !!window.__stageedit?.battle())).toBe(true);
  // While it runs the editor’s own keys stay out of the way: Delete has no binding in the editor, so it changes nothing (checked below as unchanged state), and the handles are hidden.
  // Delete has no binding in `src/dev/stageedit`, so the check is that the party slots and the selection are the same before and after the key.
  const readState = () => page.evaluate(() => ({ slots: JSON.stringify(window.__stageedit?.session.data.stages[window.__stageedit.session.stageId]?.party), selection: JSON.stringify(window.__stageedit?.session.selection) }));
  const beforeDelete = await readState();
  await page.keyboard.press('Delete');
  expect(beforeDelete.slots).toContain('x');
  expect(await readState()).toEqual(beforeDelete);
  await expect(page.locator('#ovsvg')).toBeHidden();
  // Control: another editor key (E toggles Play and Edit) is not heard either, because the game has the keys.
  await page.keyboard.press('e');
  expect(await page.evaluate(() => window.__stageedit?.view.mode)).toBe('edit');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__stageedit?.battle() ?? null)).toBeNull();
  await expect(page.locator('#st-msg')).toContainText('Back to editing');
  const back = await page.evaluate(() => ({ selection: JSON.stringify(window.__stageedit?.session.selection), undo: window.__stageedit?.session.nextUndoLabel, canUndo: window.__stageedit?.session.canUndo, dirty: window.__stageedit?.session.dirty }));
  expect(back).toEqual(mine);
  // The editor's scene is back on the edited stage: the horizon is where the edit put it, the handles are shown again, and no battle stage is left on the game hook.
  await page.evaluate(() => window.__stagelab?.game?.start());
  await flush(page);
  expect(await page.evaluate(() => window.__stagelab?.scene()?.config.party[0]?.x)).toBe(slotX + 40);
  await expect(page.locator('#ovsvg')).toBeVisible();
  expect(await sj(page, 'sj.battleStage')).toBeNull();
  // Undo still works after the test.
  await page.evaluate(() => window.__stageedit?.session.undo());
  expect(await page.evaluate(() => window.__stageedit?.session.dirty)).toBe(false);
  expect(errors).toEqual([]);
});

test('pass line 9: an unsaved edit of a slot puts that slot’s figure at the edited place, the seed-7 trace equals battleTrace(7) and seed 8 differs', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  // Control first: the stage as saved. The first hero stands where the slot says.
  await begin(page, { seed: 7, auto: true });
  expect(await waitUntil(page, 'sj.battleStage !== null', 10_000)).toBe(true);
  const saved = (await figures(page)).find((f) => f.side === 'party');
  expect(saved).toBeTruthy();
  await page.evaluate(() => window.__stageedit?.stopBattle());
  expect(await sj(page, 'sj.battleStage')).toBeNull();
  // The edit: slot 1 moves 40 px to the right. Not saved.
  await page.evaluate(() => {
    const e = window.__stageedit;
    if (!e) return;
    e.session.edit('Move slot 1', (d) => {
      const s = d.stages[e.session.stageId];
      const slot = s?.party[0];
      if (slot) slot.x += 40;
    });
    e.flush();
  });
  expect(await page.evaluate(() => window.__stageedit?.session.dirty)).toBe(true);
  await begin(page, { seed: 7, auto: true });
  const edited = (await figures(page)).find((f) => f.side === 'party');
  expect(edited?.x).toBe((saved?.x ?? 0) + 40);
  expect(edited?.y).toBe(saved?.y);
  expect(edited?.id).toBe(saved?.id);
  // Play seed 7 to its end (the auto-play gives the orders). The status trace equals the driver's.
  await page.evaluate(async () => {
    const bt = window.__stageedit?.battle();
    if (!bt) throw new Error('no battle');
    await bt.advance(20000, () => bt.status().mode === 'end');
  });
  const seven = await trace(page);
  const driver7 = await sj<string[]>(page, 'sj.battleTrace(7).trace');
  expect(seven.length).toBeGreaterThan(2);
  expect(seven).toEqual(driver7);
  // Control: another seed is another fight, and the live fight follows that one too.
  const driver8 = await sj<string[]>(page, 'sj.battleTrace(8).trace');
  expect(driver8).not.toEqual(driver7);
  await page.evaluate(() => window.__stageedit?.stopBattle());
  await begin(page, { seed: 8, auto: true });
  await page.evaluate(async () => {
    const bt = window.__stageedit?.battle();
    if (!bt) throw new Error('no battle');
    await bt.advance(20000, () => bt.status().mode === 'end');
  });
  const eight = await trace(page);
  expect(eight).not.toEqual(seven);
  expect(eight).toEqual(driver8);
  // Control: the check can fail. A trace with one word changed is not equal.
  expect([...seven.slice(0, -1), `${seven[seven.length - 1] ?? ''}!`]).not.toEqual(driver7);
  expect(errors).toEqual([]);
});

test('the same seed and the same ticks give the same fight, tick for tick', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  const run = async (): Promise<string> => {
    await begin(page, { seed: 21, auto: true, level: 1, setKey: '6' });
    const out = await page.evaluate(async () => {
      const bt = window.__stageedit?.battle();
      const hook = (window as unknown as { __SJ__?: { battleStage: unknown } }).__SJ__;
      if (!bt || !hook) throw new Error('no battle');
      const rows: unknown[] = [];
      for (let i = 0; i < 600; i++) {
        await bt.advance(1);
        rows.push([hook.battleStage, bt.status().foes.map((f) => f.hp), bt.status().party.map((p) => p.hp)]);
      }
      return JSON.stringify([rows, bt.trace]);
    });
    await page.evaluate(() => window.__stageedit?.stopBattle());
    return out;
  };
  const a = await run();
  const b = await run();
  expect(a).toBe(b);
  expect(a.length).toBeGreaterThan(5000);
  // Control: another seed is another fight.
  await begin(page, { seed: 22, auto: true, level: 1, setKey: '6' });
  const other = await page.evaluate(async () => {
    const bt = window.__stageedit?.battle();
    if (!bt) throw new Error('no battle');
    await bt.advance(6000, () => bt.status().mode === 'end');
    return JSON.stringify(bt.trace);
  });
  expect(other).not.toBe(JSON.stringify(JSON.parse(a)[1]));
  expect(errors).toEqual([]);
});

test('a hit makes the target flash and shake, and a hero who is hit is tinted and shakes; everyone who is standing settles when it is over', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  // Level 1 heroes against six enemies: the enemies get their turns and hit back.
  await begin(page, { seed: 8, auto: true, level: 1, setKey: '6' });
  const seen = await page.evaluate(async () => {
    const bt = window.__stageedit?.battle();
    const hook = (window as unknown as { __SJ__?: { battleStage: { figures: Array<{ side: string; flash: number; tint: number; bodyDx: number; down: boolean }> } | null } }).__SJ__;
    if (!bt || !hook) throw new Error('no battle');
    let foeFlash = 0;
    let foeShake = 0;
    let heroTint = 0;
    let heroShake = 0;
    for (let i = 0; i < 6000 && bt.outcome === null; i++) {
      await bt.advance(1);
      for (const f of hook.battleStage?.figures ?? []) {
        if (f.side === 'enemy') {
          if (f.flash > 0) foeFlash++;
          if (f.bodyDx !== 0) foeShake++;
        } else {
          if (f.tint > 0) heroTint++;
          if (f.bodyDx !== 0) heroShake++;
        }
      }
    }
    return { foeFlash, foeShake, heroTint, heroShake, outcome: bt.outcome };
  });
  expect(seen.foeFlash).toBeGreaterThan(0);
  expect(seen.foeShake).toBeGreaterThan(0);
  expect(seen.heroTint).toBeGreaterThan(0);
  expect(seen.heroShake).toBeGreaterThan(0);
  expect(seen.outcome).not.toBeNull();
  expect(errors).toEqual([]);
  // The fight ended by itself and the editor came back; the rest of the check is on a fight that has not ended: hits settle between rounds.
  await begin(page, { seed: 8, auto: true, level: 1, setKey: '6' });
  const settled = await page.evaluate(async () => {
    const bt = window.__stageedit?.battle();
    const hook = (window as unknown as { __SJ__?: { battleStage: { figures: StageFigureLike[] } | null } }).__SJ__;
    if (!bt || !hook) throw new Error('no battle');
    interface StageFigureLike { side: string; flash: number; tint: number; bodyDx: number; down: boolean; offX: number; offY: number; alpha: number }
    // Play to the second round menu: the first round's hits have landed, and nothing is moving now.
    let menus = 0;
    let last = '';
    for (let i = 0; i < 8000 && menus < 2 && bt.outcome === null; i++) {
      await bt.advance(1);
      const m = bt.status().mode;
      if (m === 'round' && last !== 'round') menus++;
      last = m;
    }
    await bt.advance(30);
    // A defeated enemy is gone (alpha 0) and a fallen hero is dimmed: neither is "standing".
    const live = (hook.battleStage?.figures ?? []).filter((f) => !f.down && f.alpha > 0);
    return { menus, calm: live.every((f) => f.flash === 0 && f.tint === 0 && f.bodyDx === 0 && f.offX === 0 && f.offY === 0 && f.alpha === 1), n: live.length };
  });
  expect(settled.menus).toBeGreaterThanOrEqual(2);
  expect(settled.n).toBeGreaterThan(0);
  expect(settled.calm).toBe(true);
});

test('a whole fight plays out on auto-play to a victory or a defeat, the editor comes back by itself and says so, with the stage whole', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  await begin(page, { seed: 8, auto: true, level: 1, setKey: '6' });
  const res = await page.evaluate(async () => {
    const bt = window.__stageedit?.battle();
    if (!bt) throw new Error('no battle');
    // The results panels close by themselves (auto-play); the scene ends and the editor takes the page back. `advance` stops when the test is stopped.
    let n = 0;
    while (window.__stageedit?.battle() && n < 40000) n += await bt.advance(100);
    return { ticks: n, outcome: bt.outcome, rounds: bt.status().round };
  });
  expect(['win', 'lose']).toContain(res.outcome);
  expect(res.rounds).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => window.__stageedit?.battle() ?? null)).toBeNull();
  await expect(page.locator('#st-msg')).toContainText(/Victory|Defeat/);
  // The stage is back to its editing state: seven figures, none dimmed or down, and no battle stage on the game hook.
  await page.evaluate(() => window.__stagelab?.game?.start());
  await flush(page);
  const back = await page.evaluate(() => {
    const s = window.__stagelab?.scene();
    return s ? { figures: s.fighters.length, down: s.fighters.some((f) => f.down), dim: s.fighters.some((f) => f.alpha !== 1) } : null;
  });
  expect(back).toEqual({ figures: 7, down: false, dim: false });
  expect(await sj(page, 'sj.battleStage')).toBeNull();
  await expect(page.locator('#ovsvg')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the keyboard drives the game’s own menus: Enter confirms, the arrows choose, Backspace steps back, Esc leaves', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  await begin(page, { seed: 8 });
  await until(page, 'round');
  expect(await mode(page)).toBe('round');
  await key(page, 'Enter'); // Fight
  expect(await mode(page)).toBe('command');
  await key(page, 'Enter'); // Attack
  expect(await mode(page)).toBe('target');
  const first = (await status(page))?.target;
  expect(first).not.toBeNull();
  await key(page, 'ArrowDown');
  const second = (await status(page))?.target;
  expect(second).not.toBe(first);
  await key(page, 'Backspace');
  expect(await mode(page)).toBe('command');
  // The page keeps Backspace from the browser while the game has the keys (it is the game's Cancel).
  expect(await page.evaluate(() => { const ev = new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', cancelable: true, bubbles: true }); document.body.dispatchEvent(ev); return ev.defaultPrevented; })).toBe(true);
  for (let hero = 0; hero < 4; hero++) {
    await key(page, 'Enter'); // Attack
    await key(page, 'Enter'); // the first foe
  }
  expect(await mode(page)).toBe('play');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__stageedit?.battle() ?? null)).toBeNull();
  // Control: after Esc the game's input hears nothing and takes no key from the editor: Backspace in a text field of the editor still edits the text.
  expect(await page.evaluate(() => { const ev = new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', cancelable: true, bubbles: true }); document.body.dispatchEvent(ev); return ev.defaultPrevented; })).toBe(false);
  expect(errors).toEqual([]);
});

test('a hit on a hero reads as a hit: a red tint that fades, a shake, and a number', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  await begin(page, { seed: 8, auto: true, level: 1, setKey: '6' });
  const r = await page.evaluate(async () => {
    const bt = window.__stageedit?.battle();
    const hook = (window as unknown as { __SJ__?: { battleStage: { numbers: number; figures: Array<{ id: string; side: string; tint: number; bodyDx: number }> } | null } }).__SJ__;
    if (!bt || !hook) throw new Error('no battle');
    const tint: number[] = [];
    let numbers = 0;
    let shaken = false;
    let who = '';
    for (let i = 0; i < 6000 && bt.outcome === null; i++) {
      await bt.advance(1);
      const d = hook.battleStage;
      if (!d) continue;
      numbers = Math.max(numbers, d.numbers);
      const hurt = d.figures.find((f) => f.side === 'party' && (who === '' ? f.tint > 0 : f.id === who));
      if (hurt) {
        who = hurt.id;
        tint.push(hurt.tint);
        if (hurt.bodyDx !== 0) shaken = true;
      }
      // One hero's whole hit: the tint starts, then comes back to nothing.
      if (who && tint.length > 4 && tint[tint.length - 1] === 0) break;
    }
    return { tint, numbers, shaken };
  });
  expect(Math.max(...r.tint)).toBeGreaterThan(0);
  // It fades: the tint is lower at the end than at its peak, and it ends at nothing.
  expect(r.tint[r.tint.length - 1]).toBe(0);
  expect(r.tint.indexOf(Math.max(...r.tint))).toBeLessThan(r.tint.length - 1);
  expect(r.shaken).toBe(true);
  expect(r.numbers).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('a hero who is knocked out stays down, dimmed, for the rest of the fight', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  await begin(page, { seed: 8, auto: true, level: 1, setKey: '6' });
  const r = await page.evaluate(async () => {
    const bt = window.__stageedit?.battle();
    const hook = (window as unknown as { __SJ__?: { battleStage: { figures: Array<{ id: string; side: string; down: boolean; alpha: number }> } | null } }).__SJ__;
    if (!bt || !hook) throw new Error('no battle');
    const down = (): Array<{ id: string; alpha: number }> => (hook.battleStage?.figures ?? []).filter((f) => f.side === 'party' && f.down);
    for (let i = 0; i < 8000 && down().length === 0 && bt.outcome === null; i++) await bt.advance(1);
    const first = down();
    const hero = first[0];
    if (!hero) return { hero: '', alphaAtFall: 0, later: [] as boolean[], standingAlpha: 0 };
    const later: boolean[] = [];
    for (let i = 0; i < 6 && bt.outcome === null; i++) {
      await bt.advance(40);
      later.push(down().some((f) => f.id === hero.id));
    }
    const standing = (hook.battleStage?.figures ?? []).find((f) => f.side === 'party' && !f.down);
    return { hero: hero.id, alphaAtFall: hero.alpha, later, standingAlpha: standing?.alpha ?? 0 };
  });
  expect(r.hero).not.toBe('');
  expect(r.alphaAtFall).toBeLessThan(1);
  expect(r.later.length).toBeGreaterThan(0);
  expect(r.later.every(Boolean)).toBe(true);
  // Control: a hero who is standing is not dimmed.
  expect(r.standingAlpha).toBe(1);
  expect(errors).toEqual([]);
});

test('the dialog picks the troop from the stage’s groups and shows whether the stage is edited', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  // Saved: the badge says so.
  await page.locator('#b-test').click();
  let dlg = page.getByRole('dialog', { name: 'Battle Test' });
  await expect(dlg.getByTestId('bt-badge')).toHaveText('Saved');
  // The troop select lists the stage's own groups; choosing another changes the chips.
  const options = await dlg.getByTestId('bt-troop-select').locator('option').allTextContents();
  expect(options.length).toBeGreaterThan(2);
  const chips = await dlg.getByTestId('bt-troop').innerText();
  const other = await dlg.getByTestId('bt-troop-select').locator('option').nth(options.length - 1).getAttribute('value');
  await dlg.getByTestId('bt-troop-select').selectOption(other ?? '');
  expect(await dlg.getByTestId('bt-troop').innerText()).not.toBe(chips);
  // Esc closes the dialog and starts nothing.
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  expect(await page.evaluate(() => window.__stageedit?.battle() ?? null)).toBeNull();
  // Edited: the badge says so.
  await page.evaluate(() => {
    const e = window.__stageedit;
    e?.session.edit('Move the horizon', (d) => {
      const s = d.stages[e.session.stageId];
      if (s) s.backdrop.horizonY = 150;
    });
  });
  await page.locator('#b-test').click();
  dlg = page.getByRole('dialog', { name: 'Battle Test' });
  await expect(dlg.getByTestId('bt-badge')).toHaveText('Edited · unsaved');
  // The chosen group is the one that fights.
  await dlg.getByTestId('bt-troop-select').selectOption(other ?? '');
  await page.evaluate(() => window.__stagelab?.game?.stop());
  await dlg.getByRole('button', { name: 'Start' }).click();
  await page.waitForFunction(() => !!window.__stageedit?.battle());
  const roster = await page.evaluate(() => window.__stageedit?.battle()?.options.roster ?? []);
  expect(roster.length).toBe(Number(other === 'boss' ? 1 : (other ?? '').startsWith('boss+') ? Number((other ?? '').split('+')[1]) + 1 : other));
  expect((await status(page))?.foes.length).toBe(roster.length);
  expect(errors).toEqual([]);
});

test('a second Start while a test runs does nothing, and a stage the game would refuse leaves the editor standing', async ({ page }) => {
  const { errors } = await openEditor(page, scratch);
  await begin(page, { seed: 8 });
  const first = await page.evaluate(() => window.__stageedit?.battle());
  expect(first).toBeTruthy();
  const same = await page.evaluate(async () => {
    const e = window.__stageedit;
    if (!e) return false;
    const a = e.battle();
    const st = e.session.resolved;
    await e.startBattle({ party: st.demo.party, roster: st.demo.rosters['3'] ?? [], setKey: '3', seed: 1, fullResources: true, speed: 1, auto: false });
    return e.battle() === a;
  });
  expect(same).toBe(true);
  // Control: after Esc a new Start works again (the first one cleaned up).
  await page.keyboard.press('Escape');
  await begin(page, { seed: 9 });
  expect(await page.evaluate(() => window.__stageedit?.battle()?.options.seed)).toBe(9);
  await page.keyboard.press('Escape');
  // A refused start: a party that the stage cannot show says why in the status line, and the editor is still there.
  const refused = await page.evaluate(async () => {
    const e = window.__stageedit;
    if (!e) return '';
    const st = e.session.resolved;
    await e.startBattle({ party: st.demo.party, roster: ['no_such_enemy'], setKey: '1', seed: 1, fullResources: true, speed: 1, auto: false });
    return `${e.battle() ? 'running' : 'none'}`;
  });
  expect(refused).toBe('none');
  await expect(page.locator('#st-msg')).toContainText('Battle Test could not start');
  await page.evaluate(() => window.__stagelab?.game?.start());
  await flush(page);
  expect(await page.evaluate(() => window.__stagelab?.scene()?.fighters.length)).toBe(7);
  expect(errors.filter((m) => !/no_such_enemy/.test(m))).toEqual([]);
});
