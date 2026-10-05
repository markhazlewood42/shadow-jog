/**
 * The 3D path in EVERY browser engine (Part A (v) and (vi) of the engine-platform spike): Chromium
 * everywhere, Firefox and WebKit on CI (`playwright.config.ts` adds them for this spec), Firefox
 * locally with PW_ALL_ENGINES=1. It is the spec that answers "does the shared-context design work in
 * Firefox and Safari's engine, on a software WebGL2?".
 *
 * (v) is the ATTACH ORDER: Pixi first, Three later. The engine boots Pixi and draws 2D frames; only
 * when the first hack runs does the lazy chunk create the Three renderer on the SAME context. If that
 * order breaks anything (a GL error, a console warning, a wrong pixel, Pixi's state corrupted), it shows here.
 *
 * WHERE WEBGL2 IS MISSING (headless Firefox on the Linux CI runner has none; WebKit and Chromium there do), the spec does not
 * fail: that is a browser fact, not an engine bug. It asserts the E5 behaviour instead (decision E5): the lab says so in plain
 * words, and a hack asked for through the door resolves `unsupported / no-webgl2` at once, without requesting the 3D chunk.
 * The full checks below run in every browser that HAS WebGL2.
 *
 * It uses nothing that only Chromium has (no DevTools protocol, no heap numbers). The leak, speed and
 * context-loss checks are in e2e/sje3d.spec.ts, which is Chromium only.
 */
import { type Browser, expect, test } from '@playwright/test';
import { bytesOf, startHack, step, withLab } from './sjelabkit';

/**
 * A request for the lazy 3D chunk or for Three itself. (The lab loads the door, the result types and the HUD up front on
 * purpose: none of them imports Three. The chunk is `hack3d/index`, the scene, the look, the simulation, and `sje/three`.)
 */
/**
 * Firefox 153 logs two WebGL warnings while the ENGINE BOOTS, before the 3D chunk is even requested, from Pixi's own
 * built-in textures: a 1x1 buffer texture uploaded with premultiply on, and a texture allocated and sampled before it
 * has data. Both are performance notes from Firefox, not errors, and both come from step B0's code path (no Three).
 * They are the only messages allowed, and only in Firefox. Recorded in the spike doc (Part A, item v).
 */
const FIREFOX_PIXI_NOTES = [/Alpha-premult and y-flip are deprecated for non-DOM-Element uploads/, /Tex image TEXTURE_2D level 0 is incurring lazy initialization/];
const allowFor = (browserName: string): RegExp[] => (browserName === 'firefox' ? FIREFOX_PIXI_NOTES : []);

const THREE_CHUNK = /hack3d\/(index|hackscene|look|sim)|sje\/three\/|\/three(\.js|\.module|\/build)/;

/** Can this browser make a WebGL2 context at all? (Asked on a blank page, before the engine is involved.) */
async function browserHasWebGL2(browser: Browser): Promise<boolean> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    return await page.evaluate(() => document.createElement('canvas').getContext('webgl2') !== null);
  } finally {
    await context.close();
  }
}

/**
 * E5 where WebGL2 is missing: the lab page says so clearly (it cannot start without WebGL2, like the game), and a hack asked for
 * through the door resolves `unsupported / no-webgl2` at once, and never requests the 3D chunk. The door is the real one
 * (`src/hack3d/door.ts`, which the shipped game uses too), loaded by its dev-server URL: it probes WebGL2 before it touches the game,
 * so no game is needed to ask it.
 */
async function expectE5WithoutWebGL2(browser: Browser, browserName: string, testInfo: { annotations: Array<{ type: string; description?: string }> }): Promise<void> {
  testInfo.annotations.push({ type: 'webgl2', description: `${browserName}: not available in this browser, so the E5 behaviour is asserted instead` });
  console.log(`SJE BROWSERS ${browserName}: no WebGL2 in this browser. Asserting E5 (the clear message, hack resolves unsupported).`);
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  try {
    const page = await context.newPage();
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto('/sjelab.html?manual');
    await page.waitForFunction(() => (window as unknown as { __SJE_ERROR__?: string }).__SJE_ERROR__ !== undefined, null, { timeout: 90_000 });
    const message = await page.evaluate(() => (window as unknown as { __SJE_ERROR__?: string }).__SJE_ERROR__);
    expect(message, 'the clear message').toMatch(/This browser cannot run WebGL 2/);
    expect(await page.locator('#status').textContent(), 'the message is on the page').toMatch(/failed to start: This browser cannot run WebGL 2/);

    const before = requests.length;
    const result = await page.evaluate(async () => {
      // A string import, so the spec's own transpiler leaves it alone.
      const load = new Function('url', 'return import(url)') as (url: string) => Promise<typeof import('../src/hack3d/door')>;
      const door = await load('/src/hack3d/door.ts');
      const t0 = performance.now();
      const answer = await door.hackDoor({} as never, { id: 'no-gl2', seed: 1, ticks: 60, iceCount: 2, traceLimit: 100, hitCost: 10 });
      return { answer, ms: performance.now() - t0 };
    });
    console.log(`SJE BROWSERS ${browserName}: no WebGL2, the door answered ${JSON.stringify(result)}`);
    expect(result.answer).toEqual({ status: 'unsupported', reason: 'no-webgl2' });
    expect(result.ms, 'unsupported comes at once').toBeLessThan(500);
    expect(requests.slice(before).filter((u) => THREE_CHUNK.test(u)), 'the 3D chunk is never requested').toEqual([]);
  } finally {
    await context.close();
  }
}

test('Pixi first, Three later: the 3D scene draws on the shared context with no GL error, no console warning, exact pixels, and Pixi stays right', async ({ browser, browserName }, testInfo) => {
  if (!(await browserHasWebGL2(browser))) {
    await expectE5WithoutWebGL2(browser, browserName, testInfo);
    return;
  }
  await withLab(browser, async ({ page, requests }) => {
    const info = await page.evaluate(() => window.__SJE__?.info());
    console.log(`SJE BROWSERS ${browserName}: ${info?.renderer} | ${info?.version}`);
    testInfo.annotations.push({ type: 'renderer', description: `${browserName}: ${info?.renderer}` });
    // 1. Pixi alone has been drawing the 2D lab. Three is not loaded yet.
    await step(page, 40);
    const before = await page.evaluate(() => window.__SJE__?.parity());
    expect(before?.maxDiff, 'the 2D lab matches its Canvas 2D reference before any 3D').toBeLessThanOrEqual(2);
    expect(requests.filter((u) => THREE_CHUNK.test(u))).toEqual([]);

    // 2. The first hack loads the chunk and makes the Three renderer on Pixi's context.
    await startHack(page, { ticks: 600 }, { hud: false });
    await step(page, 90);
    expect(requests.some((u) => THREE_CHUNK.test(u)), 'the 3D chunk was requested by the first hack').toBe(true);
    const frame = await page.evaluate(() => window.__SJE__?.frame());
    console.log(`SJE BROWSERS ${browserName}: frame ${JSON.stringify(frame)}`);
    expect(frame).toMatchObject({ mode: 'shared-context', width: 480, height: 270, minFilter: 'nearest', magFilter: 'nearest' });
    expect(await page.evaluate(() => window.__SJE__?.glErrors()), 'GL error flags').toEqual([]);

    // 3. The picture: not blank, and the back buffer IS the 3D target where nothing is drawn over it.
    const result = await page.evaluate(() => {
      const h = window.__SJE__;
      if (!h) throw new Error('no hook');
      const rt = h.framePixels();
      const bb = h.pixels();
      if (!rt) throw new Error('no 3D picture');
      const a = atob(rt.base64);
      const b = atob(bb.base64);
      let differing = 0;
      const colours = new Set<number>();
      for (let i = 0; i < a.length; i += 4) {
        colours.add((a.charCodeAt(i) << 16) | (a.charCodeAt(i + 1) << 8) | a.charCodeAt(i + 2));
        if (a.charCodeAt(i) !== b.charCodeAt(i) || a.charCodeAt(i + 1) !== b.charCodeAt(i + 1) || a.charCodeAt(i + 2) !== b.charCodeAt(i + 2)) differing++;
      }
      return { differing, colours: colours.size };
    });
    console.log(`SJE BROWSERS ${browserName}: ${result.colours} colours, ${result.differing} pixels differ between the 3D target and the back buffer`);
    expect(result.colours).toBeGreaterThan(300);
    expect(result.differing).toBe(0);

    // 4. An effect on the 3D view works (a filter reads the external texture): within 2/255 of the CPU.
    const effect = await page.evaluate(() => window.__SJE__?.effectCase('colorMatrix', 'view3d'));
    console.log(`SJE BROWSERS ${browserName}: colour matrix on the 3D view, max difference ${effect?.maxDiff}, over ${effect?.over}, GL errors ${effect?.glErrors.length}`);
    expect(effect?.over).toBe(0);
    expect(effect?.glErrors).toEqual([]);
    expect(effect?.restored).toBe(true);

    // 5. The hack ends. The 2D lab is back, and Pixi's state is intact: its picture still matches the CPU.
    await step(page, 700);
    await page.waitForFunction(() => window.__SJE__?.hackResult() !== null, null, { timeout: 10_000 });
    expect(await page.evaluate(() => window.__SJE__?.hackResult())).toMatchObject({ status: 'success' });
    const after = await page.evaluate(() => window.__SJE__?.parity());
    expect(after?.maxDiff, 'the 2D lab still matches its Canvas 2D reference after Three came and went').toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => window.__SJE__?.glErrors())).toEqual([]);
  }, { allow: allowFor(browserName) });
});

test('both frame modes draw the same picture in this browser (shared context against canvas copy)', async ({ browser, browserName }, testInfo) => {
  if (!(await browserHasWebGL2(browser))) {
    await expectE5WithoutWebGL2(browser, browserName, testInfo);
    return;
  }
  const hashes: Record<string, string[]> = {};
  for (const mode of ['shared-context', 'canvas-copy']) {
    await withLab(
      browser,
      async ({ page }) => {
        await startHack(page, { ticks: 900 });
        const got = await page.evaluate(() => window.__SJE__?.frame()?.mode);
        expect(got).toBe(mode);
        const run: string[] = [];
        for (const t of [1, 80, 250]) {
          run.push(
            await page.evaluate((n) => {
              const h = window.__SJE__;
              if (!h) throw new Error('no hook');
              return h.step(n - (h.sim()?.tick ?? 0));
            }, t),
          );
        }
        hashes[mode] = run;
        const px = bytesOf((await page.evaluate(() => window.__SJE__?.pixels()))?.base64 ?? '');
        expect(px.length).toBe(480 * 270 * 4);
      },
      { query: `manual&frame=${mode}`, allow: allowFor(browserName) },
    );
  }
  console.log(`SJE BROWSERS ${browserName}: shared ${JSON.stringify(hashes['shared-context'])} copy ${JSON.stringify(hashes['canvas-copy'])}`);
  expect(hashes['canvas-copy']).toEqual(hashes['shared-context']);
});
