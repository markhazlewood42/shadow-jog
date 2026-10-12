/**
 * The 3D mode on the GAME page (M7; docs/engine/m7-brief.md pass lines 4 to 13). A `HackScene` runs on the real game loop, through a story script and the real door; the lab page keeps
 * the cube cases (`e2e/sje-scene3d.spec.ts`, `e2e/sje-canaries.spec.ts`).
 *
 * The hooks (src/sje-lab/hackhook.ts, DEV only; the DEV door seam is src/game/hackseam.ts):
 *  - `__SJ__.hack(idOrDef, opts?)` starts a hack through the real field script runner when a field is on (`s.hack`, so the policy loop and the door run), else through the seam;
 *    it resolves a `HackOutcome`. `opts`: `over`, `frame` ('shared-context' | 'canvas-copy'), `contextGraceMs`, `hud`, `alternative` ('success' | 'fail').
 *  - `__SJ__.hackState()` gives `{ running, tick, status, scene }` of the running `HackScene`; `__SJ__.step(n)` drives it on the real loop (a frozen game, `game.speed = 0`, ticks only by `step`).
 *  - `__SJ__.hackDev.set({ env, options })` replaces the door's environment for one test: a booted game always has WebGL 2 and its probe keeps the context.
 *  - `?scene=hack` (DEV route) opens the same scene on its own.
 * Each pass line has its control beside the case; a case without its control does not count. Port of the Phase 0 spike cases (spike/engine-platform:e2e/sje3d.spec.ts).
 *
 * Run:  CI=1 PW_PORT=3012 npx playwright test e2e/sje-hack.spec.ts --project=chromium --reporter=line
 */
import { expect, type Page, test } from '@playwright/test';
import { type GamePage, openGame, sj, unevenBlocks, waitTop, waitUntil } from './sjegamekit';

const W = 640;
const H = 360;
/** What the browser says when a test loses the context on purpose. */
const LOSS_NOISE = [/context lost/i, /WEBGL_lose_context/i, /CONTEXT_LOST_WEBGL/i, /Context Lost/];
/** The HUD's top right panel (src/hack3d/hud.ts HUD_FIXED.node): its edge is #1f5cff and its fill #0a0918. */
const NODE = { x: W - 6 - 78, y: 6, w: 78, h: 18 };

async function openTitle(browser: import('@playwright/test').Browser, o: { allow?: RegExp[]; viewport?: { width: number; height: number }; dpr?: number; query?: string } = {}): Promise<GamePage> {
  const g = await openGame(browser, { ...o });
  expect(await waitTop(g.page, 'TitleScene')).toBe(true);
  return g;
}

async function openField(browser: import('@playwright/test').Browser, o: { allow?: RegExp[] } = {}): Promise<GamePage> {
  const g = await openTitle(browser, o);
  await sj(g.page, "sj.stage('town')");
  expect(await waitUntil(g.page, 'sj.top() === "FieldScene" && sj.idle()', 30_000)).toBe(true);
  return g;
}

/** The field's state as a string: the map, the leader (tile, pixel, direction), the party, the flags, the camera. */
const FIELD_STATE = `(() => { const f = sj.field(); return JSON.stringify({ map: f.def.id, x: f.leader.x, y: f.leader.y, px: f.leader.px, py: f.leader.py, dir: f.leader.dir, party: sj.state.party, flags: sj.state.flags, cam: [f.camX, f.camY] }); })()`;

const freeze = (page: Page) => sj(page, '(sj.game.speed = 0, true)');
const frozenStep = (page: Page, n: number) => sj(page, `(sj.step(${n}), true)`);

/** Start a hack on a frozen game (nothing ticks but `step`): the chunk loads on the way. Resolves when the HackScene is on the stack. The outcome lands on `window.__h`. */
async function startFrozen(page: Page, id: string, opts: Record<string, unknown> = {}): Promise<void> {
  await freeze(page);
  await sj(page, `(window.__h = null, sj.hack(${JSON.stringify(id)}, ${JSON.stringify(opts)}).then((o) => { window.__h = { o, at: performance.now() }; }), true)`);
  for (let i = 0; i < 400; i++) {
    await frozenStep(page, 1);
    if (await sj<boolean>(page, 'sj.hackState().running')) return;
    await page.waitForTimeout(25);
  }
  throw new Error('the HackScene never started');
}

/** Tick a frozen hack to exactly tick `t` (the scene counts its own ticks), draw, and give the picture's hash. */
async function hashAt(page: Page, t: number, split = [t]): Promise<string> {
  const now = await sj<number>(page, 'sj.hackState().tick');
  if (now > t) throw new Error(`the hack is at tick ${now}, past ${t}`);
  const todo = t - now;
  if (split.length === 1) await frozenStep(page, todo);
  else for (const n of split) await frozenStep(page, n);
  expect(await sj<number>(page, 'sj.hackState().tick')).toBe(t);
  return sj<string>(page, 'sj.frameHash()');
}

const glErrors = (page: Page) =>
  sj<number[]>(page, '(() => { const gl = sj.game.renderer.glc.gl; const out = []; for (let e = gl.getError(); e !== 0 && out.length < 16; e = gl.getError()) out.push(e); return out; })()');

/** How many distinct colors the player sees. */
const colors = (page: Page) =>
  sj<number>(page, `(() => { const p = sj.pixels({ x: 0, y: 0, w: ${W}, h: ${H} }); const seen = new Set(); for (let i = 0; i < p.data.length; i += 4) seen.add((p.data[i] << 16) | (p.data[i + 1] << 8) | p.data[i + 2]); return seen.size; })()`);

const pixel = (page: Page, x: number, y: number) => sj<number[]>(page, `(() => { const p = sj.pixels({ x: ${x}, y: ${y}, w: 1, h: 1 }); return [p.data[0], p.data[1], p.data[2]]; })()`);

/** Wait for `window.__h` (the outcome of `startFrozen`) up to `ms` of real time. */
async function outcome(page: Page, ms: number): Promise<{ o: { outcome: string; via: string; results: Array<{ status: string; reason?: string }> }; at: number } | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const h = await sj<{ o: never; at: number } | null>(page, 'window.__h');
    if (h) return h;
    await page.waitForTimeout(20);
  }
  return null;
}

// ---- pass lines 4 and 5: the story bridge ---------------------------------------------------------------------

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
      if (!hackSeen && (await sj<boolean>(page, 'sj.hackState().running && sj.hackState().tick > 20'))) {
        hackSeen = { colors: await colors(page), edge: await pixel(page, NODE.x, NODE.y), fill: await pixel(page, NODE.x + 2, NODE.y + 2) };
      }
      if (await sj<boolean>(page, 'window.__story.done')) break;
      await page.waitForTimeout(40);
    }
    const st = await sj<{ log: string[]; outcome: unknown; done: boolean }>(page, 'window.__story');
    expect(st.done, 'the story ended').toBe(true);
    return { log: st.log, tops, outcome: st.outcome, hackSeen };
  }

  const STORY = (id: string) => `log('line-1'); await s.say(null, 'Line one.', { auto: 12 }); log('hack'); st.outcome = await s.hack(sj.hackDef(${JSON.stringify(id)})); log('hack-result'); await s.say(null, 'Line two.', { auto: 12 }); log('line-2');`;

  for (const [id, expected] of [
    ['test-short', 'success'],
    ['test-fail', 'fail'],
  ] as const) {
    test(`a 2D line, the hack (${id}), a 2D line: the story continues with the result (${expected}) and the same 2D scene is back, unchanged`, async ({ browser }) => {
      const g = await openField(browser);
      try {
        const { page } = g;
        const before = await sj<string>(page, FIELD_STATE);
        const r = await runStory(page, STORY(id));
        // The story's own log: the second line came after the hack's result, in order.
        expect(r.log).toEqual(['line-1', 'hack', 'hack-result', 'line-2', 'end:true']);
        expect(r.outcome).toMatchObject({ outcome: expected, via: 'played' });
        // The scene on top: the field, the 2D line, the field, the 3D scene, the field again, the 2D line, the field.
        expect(r.tops).toContain('HackScene');
        expect(r.tops.slice(-1)).toEqual(['FieldScene']);
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
        `log('line-1'); await s.say(null, 'Line one.', { auto: 12 }); log('hack'); const p = s.hack(sj.hackDef('test-short')).then((o) => { st.outcome = o; log('hack-result'); }); await s.wait(1); log('line-2'); await p;`,
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
          sj.field().runScript(async (s) => { st.log.push('line-1'); st.outcome = await s.hack(sj.hackDef('test-fallback'), async () => { st.log.push('alternative'); return 'fail'; }); st.log.push('line-2'); }).then(() => { st.done = true; });
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
        await cycles(page, frame, 4); // warm-up: the first entries make Three's renderer, its shaders and the bloom programs
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
