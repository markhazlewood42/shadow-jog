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
import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { checkUniformRanges, inRanges, type JackLevel, type JackStyle, type TransitionParams, type UniformData, type UniformRange } from '../src/hack3d/transition';
import { advance, type GamePage, openGame, sj, unevenBlocks, waitTop, waitUntil } from './sjegamekit';

const W = 640;
const H = 360;
/** What the browser says when a test loses the context on purpose. */
const LOSS_NOISE = [/context lost/i, /WEBGL_lose_context/i, /CONTEXT_LOST_WEBGL/i, /Context Lost/];
/** The HUD's top right panel (src/hack3d/hud.ts HUD_FIXED.node): its edge is #1f5cff and its fill #0a0918. */
const NODE = { x: W - 6 - 78, y: 6, w: 78, h: 18 };

/**
 * A page on the title. Most cases here are about the scene and the door, not about the jump, so they run with `&jack=cut` (no transition): the 3D scene then starts at once and
 * counts its own ticks. The cases of the jump itself (the last describe) and the story bridge pass their own query.
 */
async function openTitle(browser: import('@playwright/test').Browser, o: { allow?: RegExp[]; viewport?: { width: number; height: number }; dpr?: number; query?: string } = {}): Promise<GamePage> {
  const g = await openGame(browser, { ...o, query: o.query ?? '&jack=cut' });
  expect(await waitTop(g.page, 'TitleScene')).toBe(true);
  return g;
}

async function openField(browser: import('@playwright/test').Browser, o: { allow?: RegExp[]; query?: string; interior?: boolean } = {}): Promise<GamePage> {
  const g = await openTitle(browser, o);
  await sj(g.page, "sj.stage('town')");
  expect(await waitUntil(g.page, 'sj.top() === "FieldScene" && sj.idle()', 30_000)).toBe(true);
  if (o.interior) {
    // An interior has no rain, so its picture depends on the field's own tick count and on nothing random (the town's rain does).
    await sj(g.page, "sj.tp('armory', 6, 8, 'down')");
    expect(await waitUntil(g.page, 'sj.field().def.id === "armory" && sj.idle()', 30_000)).toBe(true);
  }
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
      // Once the 3D scene has run a while AND the cover has gone (the reveal is 24 ticks long; a veil over the HUD would change its colors).
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

// ---- pass lines 19 to 24: the jump between the 2D game and the 3D game (M7 task 7) --------------------------------------------------------
//
// Three styles (decision D5), each at every effects level: the picture out (jack in), the hold while the chunk loads, the swap under a solid cover, the picture in, and the same
// back (jack out). The frames are captured one tick at a time on a frozen game (`sj.step(1)` and a read of the back buffer in one task). A frame may be one color (a single-color
// share of 0.9 or more) only inside a uniform range that the transition DECLARES in `src/data/hacks.json`, with a reason; the hold is judged by its own rules (line 20).

const HACKS_FILE = JSON.parse(readFileSync('src/data/hacks.json', 'utf8')) as { transition: TransitionParams; uniform: UniformData };
const TRANSITION = HACKS_FILE.transition;
const UNIFORM = HACKS_FILE.uniform;
const STYLES: readonly JackStyle[] = ['glitch', 'dissolve', 'collapse'];
const LEVELS: readonly JackLevel[] = ['full', 'lite', 'none'];

interface Frame {
  phase: string | null;
  t: number;
  share: number;
  hash: string;
  filters: number;
  fxCalls: number;
  running: boolean;
  done: boolean;
}

/** In one task: one tick, then everything a frame check needs. `share` is the single-color share (the most common color's part of the 640x360 picture). */
const FRAME = `(() => {
  sj.step(1);
  const st = sj.jackState();
  const p = sj.pixels({ x: 0, y: 0, w: ${W}, h: ${H} });
  const u = new Uint32Array(p.data.buffer, p.data.byteOffset, p.data.byteLength >> 2);
  const m = new Map(); let best = 0;
  for (let i = 0; i < u.length; i++) { const n = (m.get(u[i]) || 0) + 1; m.set(u[i], n); if (n > best) best = n; }
  const f = sj.game.screen.worldRoot.node.filters;
  return { phase: st ? st.phase : null, t: st ? st.t : -1, share: best / u.length, hash: sj.frameHash(), filters: Array.isArray(f) ? f.length : f ? 1 : 0,
    fxCalls: window.__fxCalls ? window.__fxCalls.length : 0, running: sj.hackState().running, done: window.__h !== null };
})()`;

/** Count the calls that make an effect (the effects system's own per-tick work is not counted): installed on the page's `game.fx`. */
const COUNT_FX = `(() => {
  const fx = sj.game.fx; window.__fxCalls = [];
  for (const name of ['playMoment', 'glitch', 'aberrate', 'shock', 'flare', 'haze', 'dim', 'emit']) {
    const orig = fx[name].bind(fx);
    fx[name] = (...a) => { window.__fxCalls.push(name); return orig(...a); };
  }
  return true;
})()`;

/** Capture every frame of a hack on a frozen page, from the first tick of the cover to its end. `pause` is the real time between ticks, so a chunk load can finish. */
async function capture(page: Page, id: string, opts: Record<string, unknown>, o: { pause?: number; maxSteps?: number; afterDone?: number; onFrame?: (frames: readonly Frame[]) => void } = {}): Promise<Frame[]> {
  await freeze(page);
  await sj(page, COUNT_FX);
  await sj(page, `(window.__h = null, sj.hack(${JSON.stringify(id)}, ${JSON.stringify(opts)}).then((out) => { window.__h = { out, at: performance.now() }; }), true)`);
  // The first tick of the capture is the first tick of the cover. (The styles B and C load their module with a dynamic import in a DEV build, so the cover exists a moment after the call:
  // stepping before that would run the 2D scene's own ticks first and make two loads differ.)
  expect(await waitUntil(page, 'sj.jackState() !== null', 15_000), 'the cover started').toBe(true);
  const frames: Frame[] = [];
  let tail = 0;
  for (let i = 0; i < (o.maxSteps ?? 900); i++) {
    const f = await sj<Frame>(page, FRAME);
    frames.push(f);
    o.onFrame?.(frames);
    if (f.done && f.phase === null) tail++;
    if (tail > (o.afterDone ?? 3)) break;
    await page.waitForTimeout(o.pause ?? 6);
  }
  return frames;
}

/**
 * Pass line 19, rule 2, as amended in fix round 1: the swap is part of the cover. The first frame after the cover (the swap frames, plus the declared `in` range that follows them) must not be
 * uniform: the 3D grid (jack in) or the 2D field (jack out) is already on screen. This is judged on its own, so a swap frame that is allowed to be one color cannot hide a bad first reveal frame.
 */
function coverEndProblems(frames: readonly Frame[], ranges: readonly UniformRange[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < frames.length) {
    if (frames[i]?.phase !== 'swap') {
      i++;
      continue;
    }
    while (frames[i]?.phase === 'swap') i++;
    let j = i;
    for (let f = frames[j]; f?.phase === 'in' && inRanges(ranges, 'in', f.t); f = frames[++j]);
    const first = frames[j];
    if (!first || first.phase !== 'in') out.push(`no reveal frame after the cover (the swap ended at frame ${i})`);
    else if (first.share >= 0.9) out.push(`the first frame after the cover (frame ${j}, in:${first.t}) is one color (share ${first.share.toFixed(3)}): the picture is not on screen yet`);
    i = Math.max(j, i) + 1;
  }
  return out;
}

/** The problems of a capture under pass line 19: uniform frames outside the declared ranges, the first frame after the cover, and the three more rules. The hold is outside this rule (line 20 judges it). */
function uniformProblems(frames: readonly Frame[], ranges: readonly UniformRange[]): string[] {
  const out: string[] = [...checkUniformRanges(TRANSITION, ranges), ...coverEndProblems(frames, ranges)];
  let declared = 0;
  let judged = 0;
  frames.forEach((f, i) => {
    if (f.phase === 'hold') return;
    judged++;
    const uniform = f.share >= 0.9;
    const phase = (f.phase ?? 'none') as 'out' | 'swap' | 'in' | 'none';
    const inside = f.phase !== null && inRanges(ranges, f.phase as 'out', f.t);
    if (f.phase === 'swap') declared++;
    if (uniform && inside && f.phase !== 'swap') declared++;
    if (uniform && !inside) out.push(`frame ${i} (${phase}:${f.t}) is one color (share ${f.share.toFixed(3)}) and is in no declared range`);
  });
  if (declared > 0.4 * judged) out.push(`declared ticks ${declared} are over 40% of ${judged} frames`);
  return out;
}

/** The problems of the hold frames under pass line 20: it must move (the hash changes in every window of 10 ticks) and never be blank (every pixel one color). */
function holdProblems(frames: readonly Frame[]): string[] {
  const hold = frames.filter((f) => f.phase === 'hold');
  const out: string[] = [];
  if (hold.length < 20) out.push(`only ${hold.length} hold frames: the chunk was not held`);
  hold.forEach((f, i) => {
    if (f.share >= 1) out.push(`hold frame ${i} is blank`);
  });
  for (let i = 0; i + 10 <= hold.length; i++) if (new Set(hold.slice(i, i + 10).map((f) => f.hash)).size < 2) out.push(`the picture did not change over hold ticks ${i} to ${i + 9}`);
  return out;
}

const chunkUrl = /\/src\/hack3d\/index\.ts/;

test.describe('the jump between 2D and 3D: no bad frame, a held chunk, an exact way back (pass lines 19 to 24)', () => {
  for (const style of STYLES) {
    for (const level of LEVELS) {
      test(`${style} at fx ${level}: every frame of jack in and jack out is judged (lines 19, 22, 23): no undeclared one-color frame, 0 GL errors, 0 console warnings`, async ({ browser }) => {
        const g = await openTitle(browser, { query: `&jack=${style}&fx=${level}&seed=5` });
        try {
          const { page } = g;
          const frames = await capture(page, 'test-short', { over: { ticks: 40 } });
          const out = await sj<{ outcome: string; via: string }>(page, 'window.__h.out');
          expect(out).toMatchObject({ outcome: 'success', via: 'played' });
          // The phases, in order: the cover's first round (jack in) and its second (jack out).
          const phases = frames.map((f) => f.phase).filter((p, i, all) => p !== all[i - 1]);
          expect(phases.filter((p) => p !== null)).toEqual(expect.arrayContaining(['out', 'swap', 'in']));
          expect(phases.filter((p) => p === 'out')).toHaveLength(2);
          expect(phases.filter((p) => p === 'swap')).toHaveLength(2);
          // (The first tick of `out` is painted before the first step, so a capture sees ticks 1 to outTicks - 1 of each round.)
          expect(frames.filter((f) => f.phase === 'out')).toHaveLength(2 * (TRANSITION.outTicks - 1));
          expect(frames.filter((f) => f.phase === 'in')).toHaveLength(2 * TRANSITION.inTicks);
          // Line 19.
          expect(uniformProblems(frames, UNIFORM[style][level])).toEqual([]);
          // Line 23: at none, no effects call and no world filter; at lite no world filter; at full the glitch style uses its effects.
          if (level === 'none') expect(frames.map((f) => f.fxCalls).at(-1)).toBe(0);
          if (level !== 'full') expect(Math.max(...frames.map((f) => f.filters)), 'a filter is on the world').toBe(0);
          if (level === 'full' && style === 'glitch') expect(frames.map((f) => f.fxCalls).at(-1)).toBeGreaterThan(0);
          // Line 22: the 3D scene was on screen under the reveal, and nothing broke.
          expect(frames.some((f) => f.phase === 'in' && f.running)).toBe(true);
          expect(await glErrors(page)).toEqual([]);
          expect(g.problems).toEqual([]);
        } finally {
          await g.close();
        }
      });
    }
  }

  // A hack shorter than its own reveal: its sim ends while jack in is still on screen. Jack out must wait for jack in to be over (found by the perf case of M7: the second run used to
  // replace the first one, and the story waited for ever). The result is the hack's own, and the cover is gone afterwards.
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
    const g = await openTitle(browser, { query: '&jack=glitch&fx=none&seed=5' });
    try {
      const frames = await capture(g.page, 'test-short', { over: { ticks: 40 } });
      const real = UNIFORM.glitch.none;
      expect(coverEndProblems(frames, real), 'the real capture: the first frame after each cover is a picture').toEqual([]);
      // Mutant 1: the frame after the declared in range (in:4 here) is uniform.
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

  // Line 20, case 1: a slow chunk. The request is held back until the capture has seen HOLD_FRAMES hold frames, then it goes on: the hold keeps animating, never blank, and when the chunk
  // arrives the in phase runs in full and the hack plays.
  // The delay counts hold frames (ticks), not wall-clock time. The chunk request starts at the first tick of the cover, so it runs while the out phase is still ticking: a fixed 3 s delay
  // passed during the out phase on a slow runner (CI: software GL, about 250 ms for each captured tick), the chunk was there when the out phase ended, and the hold had 1 to 5 frames.
  // The wall-clock hold bound is raised so a slow runner cannot end the hold before the chunk is let go (the bound itself is tested below, with 1,500 ms).
  const HOLD_FRAMES = 24;
  const SLOW_RUNNER_BOUND = `(sj.hackDev.set({ options: { jack: { params: { holdBoundMs: 60000 } } } }), true)`;
  /** Hold a route's request until `frames` hold frames are captured. Give `onFrame` of `capture` the returned `watch`. */
  const holdChunkFor = (frames: number) => {
    let release = () => {};
    const released = new Promise<void>((r) => {
      release = r;
    });
    return {
      released,
      watch: (seen: readonly Frame[]) => {
        if (seen.filter((f) => f.phase === 'hold').length >= frames) release();
      },
    };
  };
  for (const style of STYLES) {
    for (const level of LEVELS) {
      test(`${style} at fx ${level}: a slow chunk is held with a moving picture (never blank), then the reveal runs in full and the hack plays (line 20, case 1)`, async ({ browser }) => {
        const g = await openTitle(browser, { query: `&jack=${style}&fx=${level}&seed=5` });
        try {
          const { page } = g;
          const gate = holdChunkFor(HOLD_FRAMES);
          await page.route(chunkUrl, async (route) => {
            await gate.released;
            await route.continue();
          });
          await sj(page, SLOW_RUNNER_BOUND);
          const frames = await capture(page, 'test-short', { over: { ticks: 30 } }, { pause: 14, maxSteps: 1500, onFrame: gate.watch });
          expect(holdProblems(frames)).toEqual([]);
          expect(frames.filter((f) => f.phase === 'in').length, 'the reveal ran in full (the jack-in round and the jack-out round)').toBe(2 * TRANSITION.inTicks);
          expect(await sj(page, 'window.__h.out')).toMatchObject({ outcome: 'success', via: 'played' });
          expect(g.problems).toEqual([]);
        } finally {
          await g.close();
        }
      });
    }
  }

  test('CONTROL: a style with its hold element turned off shows a blank, frozen hold in case 1 and fails the check', async ({ browser }) => {
    const g = await openTitle(browser, { query: '&jack=glitch&fx=none&seed=5' });
    try {
      const { page } = g;
      const gate = holdChunkFor(HOLD_FRAMES);
      await page.route(chunkUrl, async (route) => {
        await gate.released;
        await route.continue();
      });
      await sj(page, SLOW_RUNNER_BOUND);
      await sj(page, '(sj.hackTest.skipHoldUi(true), true)');
      const frames = await capture(page, 'test-short', { over: { ticks: 30 } }, { pause: 14, maxSteps: 1500, onFrame: gate.watch });
      // The hold was long enough to judge, so the failure is the picture itself (blank or frozen), not a short hold.
      expect(frames.filter((f) => f.phase === 'hold').length).toBeGreaterThanOrEqual(20);
      expect(holdProblems(frames).length).toBeGreaterThan(0);
    } finally {
      await g.close();
    }
  });

  // Line 20, case 2: the chunk never arrives. The hold bound (1,500 ms here) ends it: unsupported / chunk-failed, the story goes on, the 2D scene is back clean (line 21).
  for (const level of ['full', 'none'] as const) {
    test(`fx ${level}: the chunk never completes and holdBoundMs is 1500: unsupported / chunk-failed after about 1.5 s of hold, the story continues, and the 2D scene is back with no effect left`, async ({ browser }) => {
      const g = await openGame(browser, { query: `&jack=glitch&fx=${level}&seed=5`, allow: [/\[sje\] the 3D chunk took longer/] });
      try {
        const { page } = g;
        expect(await waitTop(page, 'TitleScene')).toBe(true);
        await sj(page, "sj.stage('town')");
        expect(await waitUntil(page, 'sj.top() === "FieldScene" && sj.idle()', 30_000)).toBe(true);
        const before = await sj<string>(page, FIELD_STATE);
        await page.route(chunkUrl, () => {
          /* the request never completes */
        });
        await sj(page, "(sj.hackDev.set({ options: { jack: { params: { holdBoundMs: 1500 } } } }), true)");
        // The page notes when the hold begins (a 5 ms poll) and when the story gets its answer.
        await sj(
          page,
          `(() => { const st = (window.__story = { log: [], done: false, outcome: null, holdAt: 0, at: 0 });
            const poll = setInterval(() => { const j = sj.jackState(); if (j && j.phase === 'hold' && !st.holdAt) { st.holdAt = performance.now(); clearInterval(poll); } }, 5);
            sj.field().runScript(async (s) => { st.log.push('line-1'); st.outcome = await s.hack(sj.hackDef('test-short'), { playAlternative: async () => { st.log.push('alternative'); return 'success'; } }); st.at = performance.now(); st.log.push('line-2'); }).then(() => { st.done = true; });
            return true; })()`,
        );
        expect(await waitUntil(page, 'window.__story.done', 20_000)).toBe(true);
        const st = await sj<{ log: string[]; outcome: { outcome: string; via: string; results: Array<{ status: string; reason?: string }> }; holdAt: number; at: number }>(page, 'window.__story');
        expect(st.outcome.results).toEqual([{ status: 'unsupported', reason: 'chunk-failed' }]);
        expect(st.log, 'the story continues: the 2D alternative, then the next line').toEqual(['line-1', 'alternative', 'line-2']);
        expect(st.holdAt, 'the hold began').toBeGreaterThan(0);
        expect(st.at - st.holdAt, 'ms from the start of the hold to the answer').toBeGreaterThan(1000);
        expect(st.at - st.holdAt).toBeLessThan(2000);
        // The way back runs for 24 more ticks, then the cover is gone and nothing is left of it (line 21).
        expect(await waitUntil(page, 'sj.jackState() === null', 10_000)).toBe(true);
        expect(await waitUntil(page, 'sj.top() === "FieldScene" && sj.idle()', 10_000)).toBe(true);
        expect(await sj<string>(page, FIELD_STATE)).toBe(before);
        expect(await sj<Record<string, number>>(page, 'sj.fxCounts()')).toMatchObject({ shocks: 0, hazes: 0, glitches: 0 });
        expect(g.problems).toEqual([]);
      } finally {
        await g.close();
      }
    });
  }

  // ---- line 21: the way back is exact ----------------------------------------------------------------------------------------------

  /** Step a frozen game one tick at a time (with a little real time, for a module that loads) until `cond` holds. */
  async function stepUntil(page: Page, cond: string): Promise<void> {
    for (let i = 0; i < 600; i++) {
      await frozenStep(page, 1);
      if (await sj<boolean>(page, cond)) return;
      await page.waitForTimeout(10);
    }
    throw new Error(`the frozen game never reached: ${cond}`);
  }

  /** Put a known field on screen on a frozen game: the town, then the armory interior (no rain, so its picture depends on the field's tick count only). Every step is a tick, so two pages that do this have the same frame count. */
  async function restageFrozen(page: Page): Promise<void> {
    await freeze(page);
    await sj(page, "(sj.stage('town'), true)");
    await stepUntil(page, 'sj.top() === "FieldScene" && sj.idle()');
    await sj(page, "(sj.tp('armory', 6, 8, 'down'), true)");
    await stepUntil(page, 'sj.field().def.id === "armory" && sj.idle()');
    // A new field has a start-up of its own; measured at fx lite, its first frames differ between two pages in a few hundred pixels. 60 more ticks and the picture is the settled one.
    await frozenStep(page, 60);
  }

  /** The back buffer as base64 (the raw pixels, for a compare with a tolerance). */
  const SHOT = `(() => { sj.step(0); const d = sj.pixels({ x: 0, y: 0, w: ${W}, h: ${H} }).data; let s = ''; for (let i = 0; i < d.length; i += 8192) s += String.fromCharCode.apply(null, d.subarray(i, i + 8192)); return btoa(s); })()`;
  interface Settled {
    state: string;
    frame: number;
    hash: string;
    shot: Buffer;
  }

  /** Freeze, then read the field's state, its tick count and the settled picture (the hash of the back buffer, and the pixels). */
  async function settledPicture(page: Page): Promise<Settled> {
    await freeze(page);
    const state = await sj<string>(page, FIELD_STATE);
    const frame = await sj<number>(page, 'sj.field().frame');
    const hash = await sj<string>(page, '(sj.step(0), sj.frameHash())');
    return { state, frame, hash, shot: Buffer.from(await sj<string>(page, SHOT), 'base64') };
  }

  /** How many pixels differ by more than `tol` in any channel (a picture of another size counts every pixel). */
  function diffPixels(a: Buffer, b: Buffer, tol: number): number {
    if (a.length !== b.length) return Math.max(a.length, b.length) / 4;
    let n = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > tol || Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0)) > tol || Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0)) > tol) n++;
    return n;
  }

  // The settled picture is compared with a rule that holds at full and at lite (the exact compare is the `fx none` case below). Two pages that were NEVER covered are not frame-exact (measured in
  // round 1): one in real time and one stepped differ by up to 2 in a channel across the picture at lite, two pages that each put up a fresh field differ in a few hundred scattered pixels
  // (about 0.1%), by run, and one run in seven showed a differing hash at full. So: 2 per channel, and at most 1% of the pixels beyond that. A leftover is far over this: a half-faded world differs in nearly every pixel, a left glitch layer in thousands, a filter in the whole picture.
  // The control below pins that. (The structural state of the leftover is judged exactly: the field-state hash and the effect counts.)
  const PICTURE = { tol: 2, limit: Math.floor(W * H * 0.01) } as const;

  // All four ends compare the same three things with the state before the jump: the field-state hash (map, leader, party, flags, camera), the settled picture (the frame hash, against a page that
  // was never covered and is stepped to the same field tick), and 0 shocks, hazes, glitches and particles. A drop leaves no scene, so a known field is put up again on both pages first
  // (the same frozen steps on each); what a drop leaves behind (a filter, an effect, a stuck cover) would show in that picture or in the counts. Each case ends with a control that the compare can fail.
  for (const end of ['success', 'fail', 'abort', 'drop'] as const) {
    for (const level of ['full', 'lite'] as const) {
      test(`fx ${level}: after a ${end} the 2D scene state and settled picture are the ones before${end === 'drop' ? ' (a drop leaves no scene: a known field is put up again, and nothing of the cover or the effects is in it)' : ', no effect is left, and the cover is gone'} (line 21)`, async ({ browser }) => {
        const query = `&jack=glitch&fx=${level}&seed=5`;
        const g = await openField(browser, { query, interior: true });
        let after: Settled;
        try {
          const { page } = g;
          const before = await sj<string>(page, FIELD_STATE);
          const jackCovers = () => sj<number>(page, "sj.game.screen.overlayRoot.list.filter((c) => c.name === 'jack').length");
          expect(await jackCovers()).toBe(0);
          const id = end === 'fail' ? 'test-fail' : end === 'success' ? 'test-short' : 'test-hack';
          await sj(page, `(window.__h = null, sj.hack(${JSON.stringify(id)}, { over: ${end === 'success' ? '{ ticks: 40 }' : '{}'} }).then((out) => { window.__h = out; }), true)`);
          if (end === 'abort' || end === 'drop') {
            expect(await waitUntil(page, 'sj.hackState().running && sj.hackState().tick > 20', 30_000)).toBe(true);
            await sj(page, end === 'abort' ? "(sj.hackTest.endHack('error'), true)" : '(sj.game.abandon(), true)');
          }
          expect(await waitUntil(page, 'window.__h !== null', 40_000)).toBe(true);
          const out = await sj<{ outcome: string; via: string }>(page, 'window.__h');
          expect(out).toMatchObject(
            { success: { outcome: 'success', via: 'played' }, fail: { outcome: 'fail', via: 'played' }, abort: { outcome: 'success', via: 'policy' }, drop: { outcome: 'fail', via: 'dropped' } }[end],
          );
          expect(await waitUntil(page, 'sj.jackState() === null', 10_000)).toBe(true);
          if (end === 'drop') {
            await restageFrozen(page);
          } else {
            expect(await waitUntil(page, 'sj.top() === "FieldScene" && sj.idle()', 10_000)).toBe(true);
          }
          after = await settledPicture(page);
          expect(after.state, 'the field state is the state before').toBe(before);
          const counts = await sj<Record<string, number>>(page, 'sj.fxCounts()');
          expect([counts.shocks, counts.hazes, counts.glitches, counts.particles], 'no effect is left').toEqual([0, 0, 0, 0]);
          expect(await jackCovers(), 'the cover is gone').toBe(0);
          expect(await sj<boolean>(page, 'sj.hackState().running')).toBe(false);
          expect(g.problems).toEqual([]);
          if (end === 'success' && level === 'full') {
            // CONTROL: a layer left behind shows in the counts, and a field that moved shows in the state hash.
            await sj(page, '(sj.game.fx.glitch(320, 180, { w: 100, h: 60, strength: 5, life: 300 }), true)');
            expect((await sj<Record<string, number>>(page, 'sj.fxCounts()')).glitches, 'the control: a glitch layer is seen').toBeGreaterThan(0);
            await sj(page, '(sj.field().leader.x += 1, true)');
            expect(await sj<string>(page, FIELD_STATE), 'the control: a moved field is seen').not.toBe(before);
          }
          // CONTROL (the picture compare below can fail): a world left half faded, as a cover left behind would leave it, is far over the tolerance. (A field tick alone moves a channel by about 5 here.)
          await sj(page, '(sj.game.screen.worldRoot.node.alpha = 0.5, true)');
          const faded = await settledPicture(page);
          expect(faded.hash, 'the control: the hash sees a faded world').not.toBe(after.hash);
          expect(diffPixels(faded.shot, after.shot, PICTURE.tol), 'the control: a faded world is far over the limit').toBeGreaterThan(PICTURE.limit);
        } finally {
          await g.close();
        }
        // The reference: the same field on a page that never ran a hack, stepped to the same field tick.
        const ref = end === 'drop' ? await openTitle(browser, { query }) : await openField(browser, { query, interior: true });
        try {
          const { page } = ref;
          if (end === 'drop') await restageFrozen(page);
          else await freeze(page);
          const here = await settledPicture(page);
          expect(here.frame, 'the reference page is not past the frame').toBeLessThanOrEqual(after.frame);
          await frozenStep(page, after.frame - here.frame);
          const refPic = await settledPicture(page);
          expect(refPic.frame).toBe(after.frame);
          expect(refPic.state, 'the state is the state of a page that never jumped').toBe(after.state);
          expect(diffPixels(refPic.shot, after.shot, PICTURE.tol), 'pixels that differ from the never-covered page').toBeLessThanOrEqual(PICTURE.limit);
          expect(ref.problems).toEqual([]);
        } finally {
          await ref.close();
        }
      });
    }
  }

  test('fx none: the settled picture after jack out equals the picture of a run that was never covered, at the same field frame', async ({ browser }) => {
    const q = '&jack=glitch&fx=none&seed=5';
    const a = await openField(browser, { query: q, interior: true });
    let f1 = 0;
    let hashA = '';
    try {
      const { page } = a;
      await capture(page, 'test-short', { over: { ticks: 30 } }, { afterDone: 6 });
      expect(await sj(page, 'sj.jackState()')).toBeNull();
      f1 = await sj<number>(page, 'sj.field().frame');
      hashA = await sj<string>(page, '(sj.step(0), sj.frameHash())');
      expect(a.problems).toEqual([]);
    } finally {
      await a.close();
    }
    const b = await openField(browser, { query: q, interior: true });
    try {
      const { page } = b;
      await freeze(page);
      const fb = await sj<number>(page, 'sj.field().frame');
      expect(fb, 'the reference run is not past the frame').toBeLessThanOrEqual(f1);
      await frozenStep(page, f1 - fb);
      expect(await sj<number>(page, 'sj.field().frame')).toBe(f1);
      expect(await sj<string>(page, '(sj.step(0), sj.frameHash())'), 'the settled picture').toBe(hashA);
      // CONTROL: one more tick is another picture (the hash is not constant).
      await frozenStep(page, 7);
      expect(await sj<string>(page, '(sj.step(0), sj.frameHash())')).not.toBe(hashA);
    } finally {
      await b.close();
    }
  });

  // ---- line 24: deterministic pictures (the normal path) ---------------------------------------------------------------------------

  /** A page on a fake clock with a fixed seed: the frames of the out and in phases of a jack, as `round:phase:tick` -> hash. The hold is left out (its length depends on the load). */
  async function sequence(browser: import('@playwright/test').Browser, style: JackStyle, seed: number): Promise<Record<string, string>> {
    const g = await openGame(browser, { query: `&jack=${style}&fx=full&seed=${seed}`, fakeClock: true });
    try {
      const { page } = g;
      expect(await waitUntil(page, 'sj.game.stack.length > 0', 30_000)).toBe(true);
      await advance(page, 700);
      const frames = await capture(page, 'test-short', { over: { ticks: 40 } });
      const keyed: Record<string, string> = {};
      let round = 0;
      let last: string | null = null;
      for (const f of frames) {
        if (f.phase === 'out' && last !== 'out') round++;
        last = f.phase;
        if (f.phase === 'out' || f.phase === 'in') keyed[`${round}:${f.phase}:${f.t}`] = f.hash;
      }
      expect(g.problems).toEqual([]);
      return keyed;
    } finally {
      await g.close();
    }
  }

  for (const style of STYLES) {
    test(`${style}: the same style, seed and tick give the same frame hash on two page loads (line 24)${style === 'collapse' ? '' : '; CONTROL: another seed gives another picture'}`, async ({ browser }) => {
      const one = await sequence(browser, style, 5);
      const two = await sequence(browser, style, 5);
      expect(Object.keys(one).length, 'the frames of both rounds').toBe(2 * (TRANSITION.outTicks - 1) + 2 * TRANSITION.inTicks);
      expect(two).toEqual(one);
      if (style !== 'collapse') {
        const other = await sequence(browser, style, 6);
        const differing = Object.keys(one).filter((k) => one[k] !== other[k]).length;
        expect(differing, 'frames that differ with another seed').toBeGreaterThan(0);
      }
    });
  }
});
