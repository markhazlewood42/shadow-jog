/**
 * Losing and saving: every Game Over choice, and a real localStorage save that survives a reload.
 */
import { expect, test, type Page } from '@playwright/test';
import { E5_TEXT, expectE5Contract, skipGameFlowOnFirefox } from './webgl2kit';

// Firefox on CI has no WebGL 2: it meets the E5 message, not a game (the E5 test at the end).
skipGameFlowOnFirefox();

async function sj<T = unknown>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(async () => { const sj = window.__SJ__; return ${fn}; })()`) as Promise<T>;
}

async function waitFor(page: Page, expr: string, label: string, timeout = 20_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await sj<boolean>(page, `!!(${expr})`)) return;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`);
    await page.waitForTimeout(100);
  }
}

async function key(page: Page, k: string): Promise<void> {
  await page.keyboard.down(k);
  await page.waitForTimeout(50);
  await page.keyboard.up(k);
  await page.waitForTimeout(200);
}

async function stage(page: Page, name: string): Promise<void> {
  await page.goto('/?debug');
  await page.waitForTimeout(600);
  await page.evaluate(() => localStorage.clear());
  await sj(page, `sj.stage('${name}')`);
  await waitFor(page, 'sj.idle()', 'field idle');
}

async function loseAFight(page: Page): Promise<void> {
  await sj(page, 'Object.assign(sj.debug, { autoLose: true, autoBattle: false })');
  await sj(page, "sj.battle('street', 'street')");
  await waitFor(page, "sj.top() === 'GameOverScene'", 'game over');
  await sj(page, 'Object.assign(sj.debug, { autoLose: false })');
  await page.waitForTimeout(1500); // Game Over accepts input after its fade-in.
}

test('Retry rewinds to the moment before the fight', async ({ page }) => {
  await stage(page, 'sinkline');
  const before = await sj<string>(page, 'JSON.stringify({ inv: sj.state.inventory, hp: sj.state.members.kit.hp, battles: sj.state.battles })');
  await loseAFight(page);
  await sj(page, 'Object.assign(sj.debug, { autoBattle: true })');
  await key(page, 'Enter'); // Retry
  await waitFor(page, 'sj.idle()', 'back on the field after the retry');
  const after = await sj<{ inv: unknown; hp: number; battles: number }>(page, '({ inv: sj.state.inventory, hp: sj.state.members.kit.hp, battles: sj.state.battles })');
  const b = JSON.parse(before) as { inv: Record<string, number>; hp: number; battles: number };
  expect(after.battles).toBe(b.battles + 1);
  expect(after.hp).toBe(b.hp);
  // Only battle drops may have been added; nothing consumed.
  for (const [k, v] of Object.entries(b.inv)) expect((after.inv as Record<string, number>)[k]).toBeGreaterThanOrEqual(v);
});

test('Load from Game Over restores the save, including play time', async ({ page }) => {
  await stage(page, 'sinkline');
  await sj(page, 'sj.game.playFrames = 5000');
  expect(await sj<boolean>(page, 'sj.save(1)')).toBe(true);
  await sj(page, 'sj.game.playFrames = 99999');
  await sj(page, "sj.state.flags.bogus = true");
  await loseAFight(page);
  await key(page, 'ArrowDown'); // Load last save
  await key(page, 'Enter');
  await waitFor(page, "sj.idle() && sj.state.map === 'sinkline_1'", 'loaded field');
  const pf = await sj<number>(page, 'sj.game.playFrames');
  expect(pf).toBeGreaterThanOrEqual(5000);
  expect(pf).toBeLessThan(6000);
  expect(await sj(page, 'sj.state.flags.bogus')).toBeFalsy();
});

test('Return to Title from Game Over', async ({ page }) => {
  await stage(page, 'town');
  await loseAFight(page);
  await key(page, 'ArrowDown');
  await key(page, 'ArrowDown');
  await key(page, 'Enter');
  await waitFor(page, "sj.top() === 'TitleScene'", 'title');
});

test('A save survives a page reload and Continue restores it', async ({ page }) => {
  await stage(page, 'annex');
  await sj(page, "sj.tp('annex', 20, 12, 'left')");
  await waitFor(page, 'sj.idle()', 'field idle');
  await sj(page, 'sj.game.playFrames = 7200');
  expect(await sj<boolean>(page, 'sj.save(2)')).toBe(true);
  await page.goto('/');
  await page.waitForTimeout(1500);
  await key(page, 'Enter'); // press any key
  await page.waitForTimeout(600);
  await key(page, 'Enter'); // Continue (default when saves exist)
  await waitFor(page, "sj.idle() && sj.state.map === 'annex'", 'continued into the annex');
  const s = await sj<{ x: number; y: number; party: string[]; pf: number }>(page, '({ x: sj.state.x, y: sj.state.y, party: sj.state.party, pf: sj.game.playFrames })');
  expect(s.x).toBe(20);
  expect(s.y).toBe(12);
  expect(s.party).toContain('sable');
  expect(s.pf).toBeGreaterThanOrEqual(7200);
  expect(s.pf).toBeLessThan(8000);
});

test('Load from Game Over with a damaged save says so and returns to the title', async ({ page }) => {
  await stage(page, 'sinkline');
  expect(await sj<boolean>(page, 'sj.save(1)')).toBe(true);
  // Metadata intact (so Load is offered), state structurally broken (so loading fails).
  await page.evaluate(() => {
    localStorage.removeItem('shadowjog.save.auto');
    const raw = JSON.parse(localStorage.getItem('shadowjog.save.1')!);
    delete raw.state.members.kit;
    localStorage.setItem('shadowjog.save.1', JSON.stringify(raw));
  });
  await loseAFight(page);
  await key(page, 'ArrowDown'); // Load last save
  await key(page, 'Enter');
  await waitFor(page, "sj.top() === 'TitleScene'", 'title');
  const n = await sj<{ text: string; tone: string } | null>(page, 'sj.notice()');
  expect(n?.tone).toBe('warn');
  expect(n?.text).toMatch(/no save|damaged/i);
});

test('Autosave reports success, and failure when storage is unavailable', async ({ page }) => {
  await stage(page, 'town');
  await sj(page, "sj.tp('world', 20, 22, 'right')");
  await waitFor(page, 'sj.idle()', 'world');
  expect((await sj<{ tone: string } | null>(page, 'sj.notice()'))?.tone).toBe('saved');
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error('QuotaExceededError');
    };
  });
  await sj(page, "sj.tp('lantern_row', 30, 12, 'down')");
  await waitFor(page, 'sj.idle()', 'town');
  const n = await sj<{ text: string; tone: string } | null>(page, 'sj.notice()');
  expect(n?.tone).toBe('warn');
  expect(n?.text).toMatch(/Autosave failed/);
});

test('Title: Continue skips a damaged newest save, and Load marks it instead of failing silently', async ({ page }) => {
  await stage(page, 'town');
  expect(await sj<boolean>(page, 'sj.save(1)')).toBe(true);
  // Slot 2: newer than slot 1, but its state is broken.
  await page.evaluate(() => {
    localStorage.removeItem('shadowjog.save.auto');
    const raw = JSON.parse(localStorage.getItem('shadowjog.save.1')!);
    raw.meta.when += 60_000;
    delete raw.state.members.kit;
    localStorage.setItem('shadowjog.save.2', JSON.stringify(raw));
  });
  await page.goto('/?debug'); // a fresh boot lands on the title
  await waitFor(page, "sj.top() === 'TitleScene'", 'title');
  await page.waitForTimeout(800);
  await key(page, 'Enter'); // press start
  await page.waitForTimeout(400);
  // Load Game: the damaged slot says so and refuses.
  await key(page, 'ArrowDown');
  await key(page, 'Enter');
  await waitFor(page, "sj.top() === 'SaveScene'", 'load menu');
  expect(await sj<number>(page, 'sj.game.top.idx')).toBe(1); // cursor starts on the newest good save (slot 1)
  await key(page, 'ArrowDown'); // slot 2
  await key(page, 'Enter');
  expect(await sj<string>(page, 'sj.game.top.note')).toMatch(/damaged/i);
  await key(page, 'Escape');
  await waitFor(page, "sj.top() === 'TitleScene'", 'back to title');
  // Continue loads the newest save that works.
  await key(page, 'ArrowUp');
  await key(page, 'Enter');
  await waitFor(page, 'sj.idle()', 'field after continue');
  expect(await sj<string>(page, 'sj.state.map')).toBe('lantern_row');
});

test('A scene that throws every frame recovers to the title instead of freezing', async ({ page }) => {
  await stage(page, 'town');
  expect(await sj<boolean>(page, 'sj.save(1)')).toBe(true);
  await sj(page, "(sj.game.top.update = () => { throw new Error('boom'); }, true)");
  await waitFor(page, "sj.top() === 'TitleScene'", 'title after fault');
  const n = await sj<{ text: string; tone: string } | null>(page, 'sj.notice()');
  expect(n?.tone).toBe('warn');
  expect(n?.text).toMatch(/recovered/i);
  // And the game is fully alive: Continue gets back into the field.
  await page.waitForTimeout(800);
  await key(page, 'Enter');
  await page.waitForTimeout(400);
  await key(page, 'Enter');
  await waitFor(page, 'sj.idle()', 'field after continue');
});

test('A scene whose drawing throws every frame recovers too', async ({ page }) => {
  await stage(page, 'town');
  expect(await sj<boolean>(page, 'sj.save(1)')).toBe(true);
  await sj(page, "(sj.game.top.render = () => { throw new Error('draw'); }, true)");
  await waitFor(page, "sj.top() === 'TitleScene'", 'title after render fault');
  expect((await sj<{ text: string } | null>(page, 'sj.notice()'))?.text).toMatch(/recovered/i);
});

test('Two tabs on one save: both are warned, and only the first keeps autosaving', async ({ context }) => {
  const a = await context.newPage();
  await a.goto('/?debug');
  await a.waitForTimeout(800);
  await a.evaluate(() => localStorage.clear());
  const b = await context.newPage();
  await b.goto('/?debug');
  await b.waitForTimeout(1200);
  const noticeOf = (p: Page) => sj<{ text: string } | null>(p, 'sj.notice()');
  expect((await noticeOf(a))?.text).toContain('another tab');
  expect((await noticeOf(b))?.text).toContain('another tab');
  // The second tab walks out into the Sprawl: its autosave stays off, and it says so.
  // (sj.stage in place: reloading a tab would make it the newcomer.)
  await sj(b, "sj.stage('town')");
  await waitFor(b, 'sj.idle()', 'field idle');
  await sj(b, "sj.tp('world', 13, 22, 'right')");
  await b.waitForTimeout(1500);
  expect(await b.evaluate(() => localStorage.getItem('shadowjog.save.auto'))).toBeNull();
  expect((await noticeOf(b))?.text).toContain('Autosave is paused');
  // The first tab does the same, and its autosave writes.
  await sj(a, "sj.stage('town')");
  await waitFor(a, 'sj.idle()', 'field idle');
  await sj(a, "sj.tp('world', 13, 22, 'right')");
  await a.waitForTimeout(1500);
  expect(await a.evaluate(() => localStorage.getItem('shadowjog.save.auto'))).toBeTruthy();
  // The first tab closes: it says goodbye, and the second takes over autosaving.
  await a.close();
  await b.waitForTimeout(600);
  expect((await noticeOf(b))?.text).toContain('autosave is back on');
  await b.evaluate(() => localStorage.removeItem('shadowjog.save.auto'));
  await sj(b, "sj.tp('lantern_row', 54, 11, 'left')");
  await b.waitForTimeout(1500);
  expect(await b.evaluate(() => localStorage.getItem('shadowjog.save.auto'))).toBeTruthy();
});

test('Autosave never overwrites an autosave written by a newer version', async ({ page }) => {
  await stage(page, 'town'); // (stage clears storage, so the newer save is planted after it)
  // A save format from the future (SAVE_VERSION is 3 today), as a newer build would have left it.
  const newer = JSON.stringify({ meta: { appVersion: '0.3.0' }, state: { version: 4 } });
  await page.evaluate((json) => localStorage.setItem('shadowjog.save.auto', json), newer);
  // Walking out into the Sprawl is a place change, which autosaves.
  await sj(page, "sj.tp('world', 13, 22, 'right')");
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => localStorage.getItem('shadowjog.save.auto'))).toBe(newer);
  expect((await sj<{ text: string } | null>(page, 'sj.notice()'))?.text).toContain('newer version');
});

test('Cannot start: a browser that can’t make a canvas context says so, instead of a black screen', async ({ page }) => {
  // No canvas context at all (a locked-down or broken browser): the renderer can't be built at boot.
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
  });
  await page.goto('/');
  await page.waitForTimeout(800);
  const boot = page.locator('#boot');
  await expect(boot).toBeVisible();
  await expect(boot).toHaveClass(/error/);
  await expect(boot).toContainText('failed to start');
  await expect(boot).toContainText(E5_TEXT);
});

test('Title: Load says a newer-version save is from a newer version (not damaged) and refuses it', async ({ page }) => {
  await stage(page, 'town');
  expect(await sj<boolean>(page, 'sj.save(1)')).toBe(true);
  // Slot 2: newest, and written by a newer save format than this build knows.
  await page.evaluate(() => {
    localStorage.removeItem('shadowjog.save.auto');
    const raw = JSON.parse(localStorage.getItem('shadowjog.save.1')!);
    raw.meta.when += 60_000;
    raw.meta.appVersion = '9.9.9';
    raw.state.version = 99;
    localStorage.setItem('shadowjog.save.2', JSON.stringify(raw));
  });
  await page.goto('/?debug');
  await waitFor(page, "sj.top() === 'TitleScene'", 'title');
  await page.waitForTimeout(800);
  await key(page, 'Enter'); // press start
  await page.waitForTimeout(400);
  await key(page, 'ArrowDown'); // Load Game
  await key(page, 'Enter');
  await waitFor(page, "sj.top() === 'SaveScene'", 'load menu');
  expect(await sj<number>(page, 'sj.game.top.idx')).toBe(1); // the cursor skips the newer slot to the newest loadable one
  await key(page, 'ArrowDown'); // slot 2
  await key(page, 'Enter');
  expect(await sj<string>(page, 'sj.game.top.note')).toMatch(/newer version/i);
  expect(await sj<string>(page, 'sj.game.top.note')).not.toMatch(/damaged/i);
  expect(await sj<string>(page, 'sj.top()')).toBe('SaveScene'); // refused: still on the load screen
});

// A save format from the future (SAVE_VERSION is 3 today), as a newer build would have left it.
const NEWER_SAVE = JSON.stringify({ meta: { appVersion: '0.3.0' }, state: { version: 4 } });

/** Plant a newer-version save in slot 1 (stage() clears storage, so this runs after it). */
async function plantNewerSlot1(page: Page): Promise<void> {
  await page.evaluate((json) => localStorage.setItem('shadowjog.save.1', json), NEWER_SAVE);
}

const slot1 = (page: Page) => page.evaluate(() => localStorage.getItem('shadowjog.save.1'));

test('Menu: Save never replaces a newer-version slot until confirmed', async ({ page }) => {
  await stage(page, 'town');
  await plantNewerSlot1(page);
  await sj(page, 'sj.menu()');
  await waitFor(page, "sj.top() === 'MenuScene'", 'menu');
  await page.waitForTimeout(400);
  // Walk the cursor down to Save (its position depends on the party and flags).
  for (let i = 0; i < 12 && (await sj<string>(page, 'sj.game.top.main.current.value')) !== 'save'; i++) await key(page, 'ArrowDown');
  expect(await sj<string>(page, 'sj.game.top.main.current.value')).toBe('save');
  await key(page, 'Enter');
  expect(await sj<string>(page, 'sj.game.top.mode')).toBe('save');
  await key(page, 'Enter'); // slot 1, the newer one
  // The prompt asks first, with the newer-version wording; nothing is written yet.
  expect(await sj<string>(page, 'sj.game.top.mode')).toBe('saveConfirm');
  expect(await sj<boolean>(page, 'sj.game.top.saveSlotNewer')).toBe(true);
  expect(await slot1(page)).toBe(NEWER_SAVE);
  // Cancel goes back to the slot list and leaves the file byte-identical.
  await key(page, 'Escape');
  expect(await sj<string>(page, 'sj.game.top.mode')).toBe('save');
  expect(await slot1(page)).toBe(NEWER_SAVE);
  // Confirm replaces it with a current save.
  await key(page, 'Enter');
  expect(await sj<string>(page, 'sj.game.top.mode')).toBe('saveConfirm');
  await key(page, 'Enter');
  const after = await slot1(page);
  expect(after).not.toBe(NEWER_SAVE);
  expect(JSON.parse(after!).state.version).toBeLessThan(4);
  expect(await sj<string>(page, 'sj.game.top.mode')).not.toBe('saveConfirm');
});

test('Save point: the save screen asks before replacing a newer-version slot', async ({ page }) => {
  await stage(page, 'town');
  await plantNewerSlot1(page);
  await sj(page, 'sj.run((s) => s.savePrompt())');
  await waitFor(page, '!sj.idle()', 'save prompt');
  await page.waitForTimeout(600);
  await key(page, 'Enter'); // "Save" (the first choice)
  await waitFor(page, "sj.top() === 'SaveScene'", 'save screen');
  await page.waitForTimeout(400);
  expect(await sj<number>(page, 'sj.game.top.idx')).toBe(0); // slot 1
  expect(await sj<string>(page, 'sj.game.top.info[0].status')).toBe('newer');
  expect(await sj<string>(page, 'sj.game.top.info[0].version')).toBe('0.3.0');
  await key(page, 'Enter');
  expect(await sj<boolean>(page, 'sj.game.top.confirm')).toBe(true);
  expect(await slot1(page)).toBe(NEWER_SAVE);
  // Cancel: the prompt closes, the screen stays, the file is untouched.
  await key(page, 'Escape');
  expect(await sj<boolean>(page, 'sj.game.top.confirm')).toBe(false);
  expect(await sj<string>(page, 'sj.top()')).toBe('SaveScene');
  expect(await slot1(page)).toBe(NEWER_SAVE);
  // Confirm: replaced by a current save.
  await key(page, 'Enter');
  expect(await sj<boolean>(page, 'sj.game.top.confirm')).toBe(true);
  await key(page, 'Enter');
  const after = await slot1(page);
  expect(after).not.toBe(NEWER_SAVE);
  expect(JSON.parse(after!).state.version).toBeLessThan(4);
});

test('E5: a browser without WebGL 2 shows the message and no game; one with WebGL 2 shows no message', async ({ page }) => {
  await expectE5Contract(page, '/?debug');
});
