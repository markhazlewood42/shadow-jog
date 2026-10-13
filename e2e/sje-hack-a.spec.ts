/**
 * The 3D mode on the GAME page, part A of four (M7; docs/engine/m7-brief.md pass lines 4 to 24): the story, the door, the loss, the leak, the canaries and determinism, with the short hack and the first controls of the jump. CI runs the four parts in different shards, because the
 * one file `sje-hack.spec.ts` took 1,514 s on CI (software GL) and a shard may not pass 30 minutes. The helpers are in `e2e/sjehackkit.ts`; the `test()` calls stay here, because Playwright
 * names a test by the file that calls `test()`. The four parts hold exactly the 59 tests of the old file, with the same titles. Hooks and method: the header of `e2e/sjehackkit.ts`.
 *
 * Run:  CI=1 PW_PORT=3012 npx playwright test e2e/sje-hack-a.spec.ts --project=chromium --reporter=line
 */
import { expect, type Page, test } from '@playwright/test';
import { inRanges, type UniformRange } from '../src/hack3d/transition';
import { openGame, sj, unevenBlocks, waitTop, waitUntil } from './sjegamekit';
import { W, H, LOSS_NOISE, NODE, openTitle, openField, FIELD_STATE, frozenStep, startFrozen, hashAt, glErrors, colors, pixel, TRANSITION, UNIFORM, outcome, capture, coverEndProblems, uniformProblems } from './sjehackkit';

test.describe('the story bridge on the real loop (pass lines 4 and 5)', () => {
  /** Run `script` (a function body over `s`, the story API) on the field and record the scene on top and the log. Resolves when the script has ended. */
  async function runStory(page: Page, body: string): Promise<{ log: string[]; tops: string[]; outcome: unknown; hackSeen: { colors: number; edge: number[]; fill: number[] } | null }> {
    await sj(
      page,
      `(() => { const st = (window.__story = { log: [], tops: [], outcome: null, done: false, seen: null });
        sj.field().runScript(async (s) => { const log = (m) => st.log.push(m); ${body} }).then((ok) => { st.log.push('end:' + ok); st.done = true; });
        return true; })()`,
    );
    let hackSeen: { colors: number; edge: number[]; fill: number[] } | null = null;
    const top = async () => sj<string>(page, 'sj.top()');
    const end = Date.now() + 60_000;
    const tops: string[] = [];
    while (Date.now() < end) {
      const t = await top();
      if (t !== tops[tops.length - 1]) tops.push(t);
      // Once the 3D scene has run a while: the picture is not blank and a HUD panel is on it.
      // Once the 3D scene has run a while AND the cover has gone (the reveal is 60 ticks long; a veil over the HUD would change its colors).
      if (!hackSeen && (await sj<boolean>(page, "sj.hackState().running && sj.hackState().tick > 20 && (!sj.jackState() || sj.jackState().phase === 'done')"))) {
        hackSeen = { colors: await colors(page), edge: await pixel(page, NODE.x, NODE.y), fill: await pixel(page, NODE.x + 2, NODE.y + 2) };
      }
      if (await sj<boolean>(page, 'window.__story.done')) break;
      await page.waitForTimeout(40);
    }
    const st = await sj<{ log: string[]; outcome: unknown; done: boolean }>(page, 'window.__story');
    expect(st.done, 'the story ended').toBe(true);
    return { log: st.log, tops, outcome: st.outcome, hackSeen };
  }

  const STORY = (id: string) => `log('line-1'); await s.say(null, 'Line one.', { auto: 12 }); log('hack'); st.outcome = await s.hack(sj.hackDef(${JSON.stringify(id)}), { onUnsupported: 'win' }); log('hack-result'); await s.say(null, 'Line two.', { auto: 12 }); log('line-2');`;

  for (const [id, expected] of [
    ['test-short', 'success'],
    ['test-fail', 'fail'],
  ] as const) {
    test(`a 2D line, the hack (${id}), a 2D line: the story continues with the result (${expected}) and the same 2D scene is back, unchanged`, async ({ browser }) => {
      // The default transition (style A): the 2D scene gives way to the cover, the hack plays, and the 2D scene is back (the jump to 3D and back, pass line 4).
      const g = await openField(browser, { query: '' });
      try {
        const { page } = g;
        const before = await sj<string>(page, FIELD_STATE);
        const r = await runStory(page, STORY(id));
        // The story's own log: the second line came after the hack's result, in order.
        expect(r.log).toEqual(['line-1', 'hack', 'hack-result', 'line-2', 'end:true']);
        expect(r.outcome).toMatchObject({ outcome: expected, via: 'played' });
        // The scene on top: the field, the 2D line, the field, the 3D scene, the field again, the 2D line, the field.
        expect(r.tops).toContain('HackScene');
        // (The last scene is read below, after the story has gone: the loop that samples the stack stops the moment the script ends, a tick before the last dialog is gone.)
        // The 3D picture was not blank and the HUD panel was on it (edge #1f5cff, fill #0a0918).
        expect(r.hackSeen, 'the hack ran long enough to look at').not.toBeNull();
        expect(r.hackSeen?.colors).toBeGreaterThan(20);
        expect(r.hackSeen?.edge).toEqual([0x1f, 0x5c, 0xff]);
        expect(r.hackSeen?.fill).toEqual([0x0a, 0x09, 0x18]);
        // After the hack the same 2D scene is back with its state unchanged.
        expect(await waitUntil(page, 'sj.top() === "FieldScene" && sj.idle()', 10_000)).toBe(true);
        expect(await sj<string>(page, FIELD_STATE)).toBe(before);
        expect(await glErrors(page)).toEqual([]);
        expect(g.problems).toEqual([]);
      } finally {
        await g.close();
      }
    });
  }

  test('CONTROL: a script that does not await the hack shows its second line before the hack ends', async ({ browser }) => {
    const g = await openField(browser);
    try {
      const { page } = g;
      const r = await runStory(
        g.page,
        `log('line-1'); await s.say(null, 'Line one.', { auto: 12 }); log('hack'); const p = s.hack(sj.hackDef('test-short'), { onUnsupported: 'win' }).then((o) => { st.outcome = o; log('hack-result'); }); await s.wait(1); log('line-2'); await p;`,
      );
      // (A real second line would be hidden under the hack that starts on top of it, so the control logs the moment the story goes on.)
      expect(r.log.indexOf('line-2'), 'the story went on before the hack ended').toBeLessThan(r.log.indexOf('hack-result'));
      expect(await waitUntil(page, 'sj.top() === "FieldScene" && sj.idle()', 10_000)).toBe(true);
    } finally {
      await g.close();
    }
  });

  // Pass line 5. The story is dropped in the middle of a hack: outcome fail / dropped, one try, no retry, no second scene, within 1 s.
  for (const way of ['abandon', 'reset'] as const) {
    test(`game.${way}() in the middle of a hack: fail / dropped, one try, no retry, no second scene, the answer within 1 s`, async ({ browser }) => {
      const g = await openTitle(browser);
      try {
        const { page } = g;
        await sj(page, '(window.__h = null, sj.hack("test-hack").then((o) => { window.__h = { o, at: performance.now() }; }), true)');
        expect(await waitUntil(page, 'sj.hackState().running && sj.hackState().tick > 15', 30_000)).toBe(true);
        const t0 = await sj<number>(page, 'performance.now()');
        await sj(page, way === 'abandon' ? '(sj.game.abandon(), true)' : '(sj.hackTest.resetToIdle(), true)');
        // Watch the stack for a good while: a retry or a second scene would show up as a HackScene.
        const seen = new Set<string>();
        const h = await (async () => {
          const end = Date.now() + 1500;
          while (Date.now() < end) {
            for (const n of await sj<string[]>(page, 'sj.hackTest.scenes()')) seen.add(n);
            const got = await sj<{ o: unknown; at: number } | null>(page, 'window.__h');
            if (got && Date.now() + 700 > end) return got; // the answer is in, and a retry would have started by now
            await page.waitForTimeout(15);
          }
          return sj<{ o: unknown; at: number } | null>(page, 'window.__h');
        })();
        expect(h, 'the hack answered').not.toBeNull();
        const o = (h as { o: { outcome: string; via: string; results: Array<{ status: string; reason?: string }> }; at: number }).o;
        expect(o).toEqual({ outcome: 'fail', via: 'dropped', results: [{ status: 'aborted', reason: 'user' }] });
        expect((h as { at: number }).at - t0, 'the answer comes within 1 s').toBeLessThan(1000);
        expect(seen.has('HackScene'), 'no second scene: the stack never held a HackScene after the drop').toBe(false);
        expect(await sj<boolean>(page, 'sj.hackState().running')).toBe(false);
        expect(g.problems).toEqual([]);
      } finally {
        await g.close();
      }
    });
  }
});

// ---- pass line 6: no WebGL 2, a chunk that fails -----------------------------------------------------------------

test.describe('no WebGL 2, and a chunk that fails (pass line 6)', () => {
  const chunkRequests = (page: Page): string[] => {
    const urls: string[] = [];
    page.on('request', (r) => {
      if (/hack3d\/(index|hackscene|look|hud|devprobe)|sje\/three\//.test(r.url())) urls.push(r.url());
    });
    return urls;
  };

  test('probe false: unsupported / no-webgl2 at once, no chunk request, and the 2D alternative plays', async ({ browser }) => {
    const g = await openField(browser);
    try {
      const { page } = g;
      const requests = chunkRequests(page);
      await sj(page, '(sj.hackDev.set({ env: { probe: () => false } }), true)');
      const t0 = Date.now();
      // Through the field script runner, with a 2D line before and after, and a 2D alternative that the story provides.
      await sj(
        page,
        `(() => { const st = (window.__story = { log: [], done: false, outcome: null });
          sj.field().runScript(async (s) => { st.log.push('line-1'); st.outcome = await s.hack(sj.hackDef('test-fallback'), { playAlternative: async () => { st.log.push('alternative'); return 'fail'; } }); st.log.push('line-2'); }).then(() => { st.done = true; });
          return true; })()`,
      );
      expect(await waitUntil(page, 'window.__story.done', 5000)).toBe(true);
      const ms = Date.now() - t0;
      const st = await sj<{ log: string[]; outcome: unknown }>(page, 'window.__story');
      expect(st.outcome).toEqual({ outcome: 'fail', via: 'alternative', results: [{ status: 'unsupported', reason: 'no-webgl2' }] });
      expect(st.log).toEqual(['line-1', 'alternative', 'line-2']);
      expect(ms, 'the answer comes in under 500 ms (plus the page round trips)').toBeLessThan(1500);
      expect(requests, 'no request for the 3D chunk').toEqual([]);
      expect(await sj<boolean>(page, 'sj.hackState().running')).toBe(false);
      // A booted game that has WebGL 2 never gives no-webgl2: with the real probe the hack runs.
      await sj(page, '(sj.hackDev.clear(), true)');
      const real = await sj<{ results: Array<{ status: string }> }>(page, `sj.hack('test-short', { over: { ticks: 5 } })`);
      expect(real.results[0]?.status).not.toBe('unsupported');
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });

  test('CONTROL: probe true gives no `unsupported`', async ({ browser }) => {
    const g = await openTitle(browser);
    try {
      await sj(g.page, '(sj.hackDev.set({ env: { probe: () => true } }), true)');
      const o = await sj<{ results: Array<{ status: string }> }>(g.page, `sj.hack('test-short', { over: { ticks: 5 } })`);
      expect(o.results.map((r) => r.status)).not.toContain('unsupported');
    } finally {
      await g.close();
    }
  });

  test('the chunk request is aborted: unsupported / chunk-failed, the story continues, and the page logs one console error, from the door', async ({ browser }) => {
    const g = await openGame(browser, { allow: [/^Failed to load resource/] });
    try {
      const { page } = g;
      expect(await waitTop(page, 'TitleScene')).toBe(true);
      await page.route(/\/src\/hack3d\/index\.ts/, (route) => route.abort());
      // One story, played through the seam: a line, the hack with the default policy (alternative plays), a line.
      const o = await sj<{ outcome: string; via: string; results: Array<{ status: string; reason?: string }> }>(page, `sj.hack('test-fallback', { alternative: 'success' })`);
      expect(o.results).toEqual([{ status: 'unsupported', reason: 'chunk-failed' }]);
      expect(o).toMatchObject({ outcome: 'success', via: 'alternative' });
      const doorErrors = g.problems.filter((p) => /the 3D chunk would not load/.test(p));
      expect(doorErrors, 'one console error from the door').toHaveLength(1);
      // The door is the only one that logs: no other console error, no uncaught error.
      expect(g.problems.filter((p) => !/the 3D chunk would not load/.test(p))).toEqual([]);
    } finally {
      await g.close();
    }
    // CONTROL: the same page with the route left open gives a played hack (a fresh page: the browser remembers a module that failed to load).
    const open = await openTitle(browser);
    try {
      const played = await sj<{ via: string }>(open.page, `sj.hack('test-short', { over: { ticks: 5 } })`);
      expect(played.via).toBe('played');
    } finally {
      await open.close();
    }
  });
});

// ---- pass lines 7 and 8: context loss -------------------------------------------------------------------------------

test.describe('context lost for good, and back in time (pass lines 7 and 8)', () => {
  /** Lose the game's context with a hack running, and give the time (page clock) to the answer. */
  async function lossRun(page: Page, opts: Record<string, unknown>): Promise<{ ms: number; o: { outcome: string; via: string; results: Array<{ status: string; reason?: string }> } }> {
    await sj(page, `(window.__h = null, sj.hack('test-hack', ${JSON.stringify(opts)}).then((o) => { window.__h = { o, at: performance.now() }; }), true)`);
    expect(await waitUntil(page, 'sj.hackState().running && sj.hackState().tick > 20', 30_000)).toBe(true);
    const t0 = await sj<number>(page, '(sj.forceContextLoss(), performance.now())');
    const h = await outcome(page, 8000);
    expect(h, 'the hack answered').not.toBeNull();
    return { ms: (h?.at ?? 0) - t0, o: h?.o as never };
  }

  for (const frame of ['shared-context', 'canvas-copy'] as const) {
    test(`${frame}: lost for good ends within 2 s of the loss (about 1 s), with no console error; the default policy retries once and the story gets success`, async ({ browser }) => {
      const g = await openTitle(browser, { allow: LOSS_NOISE });
      try {
        const r = await lossRun(g.page, { frame });
        // The first try: aborted / context-lost, after the grace (1000 ms) and before 2000 ms. The retry ends at once (the context is still lost).
        expect(r.ms, 'ms from the loss to the answer').toBeGreaterThanOrEqual(950);
        expect(r.ms).toBeLessThan(2000);
        expect(r.o.results).toEqual([
          { status: 'aborted', reason: 'context-lost' },
          { status: 'aborted', reason: 'context-lost' },
        ]);
        expect(r.o).toMatchObject({ outcome: 'success', via: 'policy' });
        expect(g.problems.filter((p) => !LOSS_NOISE.some((re) => re.test(p)))).toEqual([]);
      } finally {
        await g.close();
      }
    });
  }

  test('CONTROL: with contextGraceMs 2500 the same case fails the 2 s line', async ({ browser }) => {
    const g = await openTitle(browser, { allow: LOSS_NOISE });
    try {
      const r = await lossRun(g.page, { contextGraceMs: 2500 });
      expect(r.ms, 'the 2 s line would fail').toBeGreaterThanOrEqual(2400);
    } finally {
      await g.close();
    }
  });

  test('a restore at 500 ms: the scene carries on and its picture at tick N has the hash of a run with no loss; no console warning', async ({ browser }) => {
    const N = 400;
    const g = await openTitle(browser, { allow: LOSS_NOISE });
    let reference = '';
    try {
      await startFrozen(g.page, 'test-hack');
      reference = await hashAt(g.page, N);
    } finally {
      await g.close();
    }
    const l = await openTitle(browser, { allow: LOSS_NOISE });
    try {
      const { page } = l;
      await startFrozen(page, 'test-hack');
      await hashAt(page, 200);
      await sj(page, '(sj.forceContextLoss(), true)');
      expect(await waitUntil(page, 'sj.renderer.contextLost', 10_000)).toBe(true);
      await frozenStep(page, 100); // the sim runs on while nothing can be drawn
      await page.waitForTimeout(500);
      await sj(page, '(sj.forceContextRestore(), true)');
      expect(await waitUntil(page, '!sj.renderer.contextLost', 10_000)).toBe(true);
      const after = await hashAt(page, N);
      expect(await sj(page, 'window.__h'), 'the scene was not ended').toBeNull();
      expect(after, 'the picture at tick N is the picture of a run with no loss').toBe(reference);
      expect(await glErrors(page)).toEqual([]);
      expect(l.problems.filter((p) => !LOSS_NOISE.some((re) => re.test(p)))).toEqual([]);
    } finally {
      await l.close();
    }
  });

  test('a restore at 1500 ms: already ended, silent, and a new hack draws the picture of a fresh page at the same tick', async ({ browser }) => {
    const N = 300;
    const fresh = await openTitle(browser, { allow: LOSS_NOISE });
    let reference = '';
    try {
      await startFrozen(fresh.page, 'test-hack');
      reference = await hashAt(fresh.page, N);
    } finally {
      await fresh.close();
    }
    const g = await openTitle(browser, { allow: LOSS_NOISE });
    try {
      const { page } = g;
      await startFrozen(page, 'test-hack');
      await hashAt(page, 100);
      await sj(page, '(sj.forceContextLoss(), true)');
      expect(await waitUntil(page, 'sj.renderer.contextLost', 10_000)).toBe(true);
      const h = await outcome(page, 4000);
      expect(h?.o.results[0], 'the hack ended after the grace').toEqual({ status: 'aborted', reason: 'context-lost' });
      await page.waitForTimeout(600); // 1.5 s after the loss in all
      const warningsBefore = g.problems.length;
      await sj(page, '(sj.forceContextRestore(), true)');
      expect(await waitUntil(page, '!sj.renderer.contextLost', 10_000)).toBe(true);
      expect(await sj<boolean>(page, 'sj.hackState().running'), 'the ended scene did not come back').toBe(false);
      expect(g.problems.length, 'the restore warns nothing').toBe(warningsBefore);
      // A new hack on the restored context draws the same picture as a fresh page at the same tick.
      await startFrozen(page, 'test-hack');
      expect(await hashAt(page, N)).toBe(reference);
      expect(await glErrors(page)).toEqual([]);
    } finally {
      await g.close();
    }
  });
});

// ---- pass line 9: leak ----------------------------------------------------------------------------------------------

test.describe('leak (pass line 9)', () => {
  const KINDS = ['texture', 'buffer', 'program', 'vao', 'framebuffer'] as const;

  async function cycles(page: Page, frame: string, n: number): Promise<void> {
    for (let i = 0; i < n; i++) await sj(page, `sj.hack('test-short', { frame: ${JSON.stringify(frame)}, over: { ticks: 2 } })`);
  }

  /**
   * The warm-up. The first entries make Three's renderer, its shaders, the bloom programs and (in the shared mode) the copy-blit program, and Three compiles a program on its FIRST DRAWN frame.
   * A cycle of 2 ticks can end before any frame is drawn when the runner is slow, so a fixed count of short cycles can leave a compile for the measured cycles (a constant +1, not growth).
   * So: one longer hack first (it cannot end without drawing), then single short cycles until the counts are equal on two cycles in a row (cap 12; a real leak never settles and is
   * caught by the measured cycles with the counts in the message).
   */
  async function warmUp(page: Page, frame: string): Promise<void> {
    await sj(page, `sj.hack('test-short', { frame: ${JSON.stringify(frame)}, over: { ticks: 40 } })`);
    let last = JSON.stringify(await sj<Record<string, number>>(page, 'sj.glCounts()'));
    for (let i = 0; i < 12; i++) {
      await cycles(page, frame, 1);
      const now = JSON.stringify(await sj<Record<string, number>>(page, 'sj.glCounts()'));
      if (now === last) return;
      last = now;
    }
  }

  async function heap(page: Page): Promise<number> {
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('HeapProfiler.collectGarbage');
      await cdp.send('HeapProfiler.collectGarbage');
      const { usedSize } = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number };
      return usedSize;
    } finally {
      await cdp.detach();
    }
  }

  for (const frame of ['shared-context', 'canvas-copy'] as const) {
    test(`10 cycles in ${frame}: every GPU count is back to the baseline${frame === 'shared-context' ? ', one host, the heap within 5%' : ''}`, async ({ browser }) => {
      const g = await openTitle(browser);
      try {
        const { page } = g;
        await warmUp(page, frame);
        const before = await sj<Record<string, number>>(page, 'sj.glCounts()');
        const heapBefore = await heap(page);
        await cycles(page, frame, 10);
        const after = await sj<Record<string, number>>(page, 'sj.glCounts()');
        const heapAfter = await heap(page);
        for (const k of KINDS) expect(after[k], k).toBe(before[k]);
        if (frame === 'shared-context') {
          const hosts = await sj<{ shared: number; private: number }>(page, '(async () => { const h = (await sj.hackChunk()).hostsCreated; return { shared: h.shared, private: h.private }; })()');
          expect(hosts).toEqual({ shared: 1, private: 0 });
          expect(heapAfter, 'the JS heap after a forced collection').toBeLessThanOrEqual(heapBefore * 1.05);
        }
        // CONTROL: a deliberate leak of 6 textures shows +6.
        await sj(page, '(() => { const gl = sj.game.renderer.glc.gl; for (let i = 0; i < 6; i++) gl.createTexture(); return true; })()');
        const leaked = await sj<Record<string, number>>(page, 'sj.glCounts()');
        expect(leaked.texture).toBe((after.texture ?? 0) + 6);
        expect(g.problems).toEqual([]);
      } finally {
        await g.close();
      }
    });
  }
});

// ---- pass lines 10 and 11: the hand-off canary, the hidden scene ---------------------------------------------------

test.describe('the hand-off canary and the hidden scene on the game page (pass lines 10 and 11)', () => {
  test('a filtered container with a gap over a running HackScene shows the 3D picture through the gap (CONTROL: the bars are inverted, and with no overlay the gap pixel is the same)', async ({ browser }) => {
    const g = await openTitle(browser);
    try {
      const { page } = g;
      await startFrozen(page, 'test-hack');
      await frozenStep(page, 80);
      const gapPoints = [
        [300, 120],
        [330, 200],
        [340, 300],
      ];
      const bare = [] as number[][];
      for (const [x, y] of gapPoints) bare.push(await pixel(page, x as number, y as number));
      const geo = await sj<{ gapX0: number; gapX1: number; barX: number; y: number }>(page, 'sj.hackTest.gapOverlay(true)');
      await frozenStep(page, 0);
      for (const [i, [x, y]] of gapPoints.entries()) expect(await pixel(page, x as number, y as number), `gap pixel ${i}: the 3D picture shows through`).toEqual(bare[i]);
      // CONTROL: the filtered bars are white inverted to black: the overlay is there and the filter works (so a gap that shows the picture is not a missing overlay).
      expect(await pixel(page, geo.barX, geo.y)).toEqual([0, 0, 0]);
      await sj(page, 'sj.hackTest.gapOverlay(false)');
      expect(await glErrors(page)).toEqual([]);
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });

  // Pass line 11, the pixel case. A cover closes INSIDE its own prerender; the HackScene under it kept ticking while it was hidden. The first frame after the reveal is a fresh render.
  test('a cover that closes inside its own prerender: the HackScene under it shows a fresh frame at once, not a stale one (CONTROL: a prerender with no second pass shows the stale one)', async ({ browser }) => {
    const A = 150; // ticks before the cover
    const B = 90; // ticks while it is hidden
    const reference = await (async () => {
      const g = await openTitle(browser);
      try {
        await startFrozen(g.page, 'test-hack');
        return await hashAt(g.page, A + B);
      } finally {
        await g.close();
      }
    })();
    for (const mutant of [false, true]) {
      const g = await openTitle(browser);
      try {
        const { page } = g;
        await startFrozen(page, 'test-hack');
        const shown = await hashAt(page, A); // the picture before the hide
        const cover = await sj<boolean>(page, '(window.__cover = sj.hackTest.coverInPrerender(), true)');
        expect(cover).toBe(true);
        await frozenStep(page, 1); // the cover is on the stack, the HackScene is hidden, and the sim runs on
        await frozenStep(page, B - 1);
        expect(await sj<number>(page, 'sj.hackState().tick')).toBe(A + B);
        if (mutant) await sj(page, '(sj.hackTest.mutantPrerender(true), true)');
        // Arm, draw (the cover closes inside its own prerender) and read in ONE task: the real loop keeps drawing (a frozen game still draws), and its next draw would show a fresh frame.
        const after = await sj<string>(page, '(window.__cover.arm(), sj.step(0), sj.frameHash())');
        expect(await sj<boolean>(page, 'sj.hackTest.coverClosed()')).toBe(true);
        if (!mutant) {
          expect(after, 'the first frame after the reveal equals a fresh render').toBe(reference);
          expect(after, 'and differs from the picture before the hide').not.toBe(shown);
        } else {
          expect(after, 'CONTROL: with no second pass the reveal shows a stale picture').not.toBe(reference);
        }
        expect(g.problems).toEqual([]);
      } finally {
        await g.close();
      }
    }
  });
});

// ---- pass lines 12 and 13: determinism, pixels, colors --------------------------------------------------------------

test.describe('determinism, pixels and colors at 640x360 (pass lines 12 and 13)', () => {
  test('the same tick count gives the same picture on two loads, however the ticks are split; CONTROL: another seed gives another picture', async ({ browser }) => {
    const runs: Array<[string, number[]]> = [
      ['one block of 333', [333]],
      ['two loads, one block of 333', [333]],
      ['333 times 1', Array.from({ length: 333 }, () => 1)],
      ['3 times 111', [111, 111, 111]],
    ];
    const hashes: string[] = [];
    for (const [, split] of runs) {
      const g = await openTitle(browser);
      try {
        await startFrozen(g.page, 'test-hack');
        // The scene counts from its first tick; startFrozen leaves it at tick 1 or so. Tick to 333 in the given pieces after reading where it is.
        const now = await sj<number>(g.page, 'sj.hackState().tick');
        const rest = 333 - now;
        const pieces = split.length === 1 ? [rest] : split.length === 3 ? [Math.floor(rest / 3), Math.floor(rest / 3), rest - 2 * Math.floor(rest / 3)] : split.slice(0, rest);
        let spent = pieces.reduce((a, b) => a + b, 0);
        while (spent < rest) {
          pieces.push(1);
          spent++;
        }
        hashes.push(await hashAt(g.page, 333, pieces));
      } finally {
        await g.close();
      }
    }
    expect(new Set(hashes).size, `hashes: ${hashes.join(' ')}`).toBe(1);
    const other = await openTitle(browser);
    try {
      await startFrozen(other.page, 'test-hack', { over: { seed: 8 } });
      expect(await hashAt(other.page, 333), 'CONTROL: seed 8 draws another picture').not.toBe(hashes[0]);
    } finally {
      await other.close();
    }
  });

  test('the HUD equals a Canvas 2D drawing (0 differing pixels), its text has 7:1 contrast against the panel, and the same drawing at a wrong place differs (control)', async ({ browser }) => {
    const g = await openTitle(browser);
    try {
      const { page } = g;
      await startFrozen(page, 'test-hack');
      await frozenStep(page, 60);
      const ref = await sj<{ x: number; y: number; w: number; h: number; base64: string }>(page, 'sj.hackTest.hudReference()');
      const refBytes = Buffer.from(ref.base64, 'base64');
      const shot = await sj<{ w: number; h: number; data: Record<string, number> }>(page, `sj.pixels({ x: ${ref.x}, y: ${ref.y}, w: ${ref.w}, h: ${ref.h} })`);
      const got = Uint8Array.from(Object.values(shot.data));
      let differing = 0;
      for (let i = 0; i < refBytes.length; i += 4) if (refBytes[i] !== got[i] || refBytes[i + 1] !== got[i + 1] || refBytes[i + 2] !== got[i + 2]) differing++;
      expect(differing, 'differing pixels in the top right panel').toBe(0);
      // CONTROL: the same reference against the panel shifted by one pixel differs.
      const shifted = await sj<{ data: Record<string, number> }>(page, `sj.pixels({ x: ${ref.x + 1}, y: ${ref.y}, w: ${ref.w}, h: ${ref.h} })`);
      const gotShifted = Uint8Array.from(Object.values(shifted.data));
      let shiftedDiffering = 0;
      for (let i = 0; i < refBytes.length; i += 4) if (refBytes[i] !== gotShifted[i] || refBytes[i + 1] !== gotShifted[i + 1] || refBytes[i + 2] !== gotShifted[i + 2]) shiftedDiffering++;
      expect(shiftedDiffering, 'control: a one pixel shift is found').toBeGreaterThan(0);
      // Contrast: the panel color against the brightest text pixel of the panel.
      const lum = (r: number, gg: number, b: number): number => {
        const f = (c: number): number => {
          const s = c / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(b);
      };
      const panel = [got[(2 * ref.w + 2) * 4] ?? 0, got[(2 * ref.w + 2) * 4 + 1] ?? 0, got[(2 * ref.w + 2) * 4 + 2] ?? 0];
      let best = 1;
      const lp = lum(panel[0] ?? 0, panel[1] ?? 0, panel[2] ?? 0);
      for (let y = 2; y < ref.h - 2; y++) {
        for (let x = 2; x < ref.w - 2; x++) {
          const i = (y * ref.w + x) * 4;
          const l = lum(got[i] ?? 0, got[i + 1] ?? 0, got[i + 2] ?? 0);
          best = Math.max(best, (Math.max(l, lp) + 0.05) / (Math.min(l, lp) + 0.05));
        }
      }
      expect(best, 'HUD text contrast against its panel').toBeGreaterThanOrEqual(7);
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });

  for (const [dpr, viewport] of [
    [1, { width: 1280, height: 720 }],
    [1.5, { width: 1280, height: 720 }],
  ] as const) {
    test(`every k-by-k block is one flat color at device pixel ratio ${dpr}, with the HUD over the 3D (CONTROL: a wrong scale finds uneven blocks)`, async ({ browser }) => {
      const g = await openTitle(browser, { dpr, viewport });
      try {
        const { page } = g;
        await startFrozen(page, 'test-hack');
        for (const t of [80, 200]) {
          await hashAt(page, t);
          const cp = await sj<{ w: number; h: number; base64: string; k: number; x: number; y: number }>(page, 'sj.canvasPixels()');
          const raw = Buffer.from(cp.base64, 'base64');
          const img = { w: cp.w, h: cp.h, data: new Uint8Array(raw) };
          expect(cp.k, 'an integer scale').toBeGreaterThanOrEqual(1);
          expect(unevenBlocks(img, cp.k, cp.x, cp.y, W, H), `uneven ${cp.k}x${cp.k} blocks at tick ${t}, dpr ${dpr}`).toBe(0);
          const wrong = cp.k + 1;
          expect(unevenBlocks(img, wrong, cp.x, cp.y, Math.floor((W * cp.k) / wrong) - 1, Math.floor((H * cp.k) / wrong) - 1), 'control: a wrong scale finds uneven blocks').toBeGreaterThan(0);
        }
        expect(g.problems).toEqual([]);
      } finally {
        await g.close();
      }
    });
  }

  test('a Three color #ff2080 reaches the screen unchanged', async ({ browser }) => {
    const g = await openTitle(browser);
    try {
      const { page } = g;
      await startFrozen(page, 'test-hack', { hud: false, bloom: false });
      await frozenStep(page, 10);
      await sj(page, 'sj.hackTest.colorQuad(0xff2080)');
      await frozenStep(page, 1);
      expect(await pixel(page, W / 2, H / 2), 'the quad color as written').toEqual([0xff, 0x20, 0x80]);
      await sj(page, '(sj.hackTest.removeColorQuad(), true)');
      await frozenStep(page, 1);
      expect(await pixel(page, W / 2, H / 2), 'CONTROL: with the quad gone the pixel is not that color').not.toEqual([0xff, 0x20, 0x80]);
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });
});

test.describe('the jump between 2D and 3D: no bad frame, a held chunk, an exact way back (pass lines 19 to 24)', () => {
  for (const level of ['full', 'none'] as const) {
    test(`fx ${level}: a hack of 5 ticks (shorter than the reveal) ends, the story continues, and the cover is gone`, async ({ browser }) => {
      const g = await openTitle(browser, { query: `&jack=glitch&fx=${level}&seed=5` });
      try {
        const { page } = g;
        const out = await sj<{ outcome: string; via: string }>(page, `sj.hack('test-short', { over: { ticks: 5 } })`);
        expect(out).toMatchObject({ outcome: 'success', via: 'played' });
        expect(await sj(page, 'sj.jackState()')).toBeNull();
        expect(await sj<boolean>(page, 'sj.hackState().running')).toBe(false);
        expect(g.problems).toEqual([]);
      } finally {
        await g.close();
      }
    });
  }

  // Controls of line 19, on the glitch style at full.
  test('CONTROL: a mutant that skips the first 3D renders reveals a blank target, a mutant that draws one black frame at the hand-over shows one: both give an undeclared one-color frame', async ({ browser }) => {
    test.slow(); // The 2 s jack (60+60 ticks) makes every-frame capture slow on software GL.
    for (const mutant of ['blank', 'black'] as const) {
      const g = await openTitle(browser, { query: '&jack=glitch&fx=full&seed=5' });
      try {
        const { page } = g;
        if (mutant === 'blank') await sj(page, 'sj.hackTest.skipFirstRenders(8)');
        else await sj(page, '(sj.hackTest.blackFrameAtHandover(true), true)');
        const frames = await capture(page, 'test-short', { over: { ticks: 40 } });
        const problems = uniformProblems(frames, UNIFORM.glitch.full);
        expect(
          problems.some((m) => /is one color \(share [\d.]+\) and is in no declared range/.test(m)),
          `${mutant}: the check names the undeclared one-color frame (got: ${problems.join(' | ') || 'nothing'})`,
        ).toBe(true);
        // The blank target is revealed, so the FIRST frame after the cover is one color: the cover-end rule (round 1) finds it on its own as well.
        if (mutant === 'blank') expect(coverEndProblems(frames, UNIFORM.glitch.full).length, 'blank: the first frame after the cover is judged').toBeGreaterThan(0);
      } finally {
        await g.close();
      }
    }
    // And the rules reject a style that declares more than they allow (the unit test of the rules has the full list).
    const wide: UniformRange[] = [...UNIFORM.glitch.full, { phase: 'in', from: 0, to: TRANSITION.inTicks - 1, reason: 'too wide' }];
    expect(uniformProblems([], wide)).not.toEqual([]);
  });

  // Line 19, rule 2 (round 1): the swap is part of the cover, so the first frame after it is judged. The real capture passes; a capture whose first `in` frame (after the swap, or after the
  // declared `in` range) is made uniform fails. fx none is used because it declares an `in` range and has a long fade, so both cases of the rule are in one capture.
  test('CONTROL: the first frame after the cover (swap plus its declared in range) is judged: a mutant whose first in frame is uniform fails', async ({ browser }) => {
    test.slow(); // The 2 s jack (60+60 ticks) makes every-frame capture slow on software GL.
    const g = await openTitle(browser, { query: '&jack=glitch&fx=none&seed=5' });
    try {
      const frames = await capture(g.page, 'test-short', { over: { ticks: 40 } });
      const real = UNIFORM.glitch.none;
      expect(coverEndProblems(frames, real), 'the real capture: the first frame after each cover is a picture').toEqual([]);
      // Mutant 1: the frame after the declared in range (in:11 here) is uniform.
      const afterRange = frames.findIndex((f) => f.phase === 'in' && !inRanges(real, 'in', f.t));
      expect(afterRange).toBeGreaterThan(0);
      const m1 = frames.map((f, i) => (i === afterRange ? { ...f, share: 1 } : f));
      expect(coverEndProblems(m1, real).length, 'mutant: a uniform frame right after the declared in range').toBe(1);
      // Mutant 2: with no declared in range, the first in frame after the swap is the one that is judged.
      const swapOnly = real.filter((r) => r.phase !== 'in');
      const afterSwap = frames.findIndex((f) => f.phase === 'in');
      expect(afterSwap).toBeGreaterThan(0);
      const withFirstIn = (share: number) => frames.map((f, i) => (f.phase === 'in' && frames[i - 1]?.phase === 'swap' ? { ...f, share } : f));
      expect(coverEndProblems(withFirstIn(0.5), swapOnly), 'a picture right after the swap passes').toEqual([]);
      expect(coverEndProblems(withFirstIn(1), swapOnly).length, 'mutant: a uniform first in frame after the swap (both covers)').toBe(2);
      // Mutant 3: a capture with no reveal at all after the swap.
      expect(coverEndProblems(frames.slice(0, frames.findIndex((f) => f.phase === 'swap') + 1), real).length, 'mutant: the swap is never followed by a reveal').toBeGreaterThan(0);
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });
});
