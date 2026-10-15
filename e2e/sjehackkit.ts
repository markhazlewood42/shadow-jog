/**
 * SHARED HELPERS of the four spec files `sje-hack-a` to `-d` (they were one file, `sje-hack.spec.ts`; see the header of each part).
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
 * Run (the four parts, a to d):  CI=1 PW_PORT=3012 npx playwright test e2e/sje-hack-a.spec.ts --project=chromium --reporter=line
 */
import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { checkUniformRanges, inRanges, type JackLevel, type JackStyle, type TransitionParams, type UniformData, type UniformRange } from '../src/hack3d/transition';
import { advance, type GamePage, openGame, sj, waitTop, waitUntil } from './sjegamekit';

export const W = 640;
export const H = 360;
/** What the browser says when a test loses the context on purpose. */
export const LOSS_NOISE = [/context lost/i, /WEBGL_lose_context/i, /CONTEXT_LOST_WEBGL/i, /Context Lost/];
/** The HUD's top right panel (src/hack3d/hud.ts HUD_FIXED.node): its edge is #1f5cff and its fill #0a0918. */
export const NODE = { x: W - 6 - 78, y: 6, w: 78, h: 18 };

/**
 * A page on the title. Most cases here are about the scene and the door, not about the jump, so they run with `&jack=cut` (no transition): the 3D scene then starts at once and
 * counts its own ticks. The cases of the jump itself (the last describe) and the story bridge pass their own query.
 */
export async function openTitle(browser: import('@playwright/test').Browser, o: { allow?: RegExp[]; viewport?: { width: number; height: number }; dpr?: number; query?: string } = {}): Promise<GamePage> {
  const g = await openGame(browser, { ...o, query: o.query ?? '&jack=cut' });
  expect(await waitTop(g.page, 'TitleScene')).toBe(true);
  return g;
}

export async function openField(browser: import('@playwright/test').Browser, o: { allow?: RegExp[]; query?: string; interior?: boolean } = {}): Promise<GamePage> {
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
export const FIELD_STATE = `(() => { const f = sj.field(); return JSON.stringify({ map: f.def.id, x: f.leader.x, y: f.leader.y, px: f.leader.px, py: f.leader.py, dir: f.leader.dir, party: sj.state.party, flags: sj.state.flags, cam: [f.camX, f.camY] }); })()`;

export const freeze = (page: Page) => sj(page, '(sj.game.speed = 0, true)');
export const frozenStep = (page: Page, n: number) => sj(page, `(sj.step(${n}), true)`);

/** Start a hack on a frozen game (nothing ticks but `step`): the chunk loads on the way. Resolves when the HackScene is on the stack. The outcome lands on `window.__h`. */
export async function startFrozen(page: Page, id: string, opts: Record<string, unknown> = {}): Promise<void> {
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
export async function hashAt(page: Page, t: number, split = [t]): Promise<string> {
  const now = await sj<number>(page, 'sj.hackState().tick');
  if (now > t) throw new Error(`the hack is at tick ${now}, past ${t}`);
  const todo = t - now;
  if (split.length === 1) await frozenStep(page, todo);
  else for (const n of split) await frozenStep(page, n);
  expect(await sj<number>(page, 'sj.hackState().tick')).toBe(t);
  return sj<string>(page, 'sj.frameHash()');
}

export const glErrors = (page: Page) =>
  sj<number[]>(page, '(() => { const gl = sj.game.renderer.glc.gl; const out = []; for (let e = gl.getError(); e !== 0 && out.length < 16; e = gl.getError()) out.push(e); return out; })()');

/** How many distinct colors the player sees. */
export const colors = (page: Page) =>
  sj<number>(page, `(() => { const p = sj.pixels({ x: 0, y: 0, w: ${W}, h: ${H} }); const seen = new Set(); for (let i = 0; i < p.data.length; i += 4) seen.add((p.data[i] << 16) | (p.data[i + 1] << 8) | p.data[i + 2]); return seen.size; })()`);

export const pixel = (page: Page, x: number, y: number) => sj<number[]>(page, `(() => { const p = sj.pixels({ x: ${x}, y: ${y}, w: 1, h: 1 }); return [p.data[0], p.data[1], p.data[2]]; })()`);

/** Wait for `window.__h` (the outcome of `startFrozen`) up to `ms` of real time. */
export async function outcome(page: Page, ms: number): Promise<{ o: { outcome: string; via: string; results: Array<{ status: string; reason?: string }> }; at: number } | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const h = await sj<{ o: never; at: number } | null>(page, 'window.__h');
    if (h) return h;
    await page.waitForTimeout(20);
  }
  return null;
}

// ---- pass lines 4 and 5: the story bridge ---------------------------------------------------------------------


export const HACKS_FILE = JSON.parse(readFileSync('src/data/hacks.json', 'utf8')) as { transition: TransitionParams; uniform: UniformData };
export const TRANSITION = HACKS_FILE.transition;
export const UNIFORM = HACKS_FILE.uniform;
export const STYLES: readonly JackStyle[] = ['glitch', 'dissolve', 'collapse'];
export const LEVELS: readonly JackLevel[] = ['full', 'lite', 'none'];

export interface Frame {
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
export const FRAME = `(() => {
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
export const COUNT_FX = `(() => {
  const fx = sj.game.fx; window.__fxCalls = [];
  for (const name of ['playMoment', 'glitch', 'aberrate', 'shock', 'flare', 'haze', 'dim', 'emit']) {
    const orig = fx[name].bind(fx);
    fx[name] = (...a) => { window.__fxCalls.push(name); return orig(...a); };
  }
  return true;
})()`;

/** Capture every frame of a hack on a frozen page, from the first tick of the cover to its end. `pause` is the real time between ticks, so a chunk load can finish. */
export async function capture(page: Page, id: string, opts: Record<string, unknown>, o: { pause?: number; maxSteps?: number; afterDone?: number; onFrame?: (frames: readonly Frame[]) => void } = {}): Promise<Frame[]> {
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
export function coverEndProblems(frames: readonly Frame[], ranges: readonly UniformRange[]): string[] {
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
export function uniformProblems(frames: readonly Frame[], ranges: readonly UniformRange[]): string[] {
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
export function holdProblems(frames: readonly Frame[]): string[] {
  const hold = frames.filter((f) => f.phase === 'hold');
  const out: string[] = [];
  if (hold.length < 20) out.push(`only ${hold.length} hold frames: the chunk was not held`);
  hold.forEach((f, i) => {
    if (f.share >= 1) out.push(`hold frame ${i} is blank`);
  });
  for (let i = 0; i + 10 <= hold.length; i++) if (new Set(hold.slice(i, i + 10).map((f) => f.hash)).size < 2) out.push(`the picture did not change over hold ticks ${i} to ${i + 9}`);
  return out;
}

export const chunkUrl = /\/src\/hack3d\/index\.ts/;

// Line 20, case 1: a slow chunk. The request is held back until the capture has seen HOLD_FRAMES hold frames, then it goes on: the hold keeps animating, never blank, and when the chunk
// arrives the in phase runs in full and the hack plays.
// The delay counts hold frames (ticks), not wall-clock time. 24 is the number of HOLD frames to see: it does not depend on the length of the out phase (60 ticks since the 2 s jack).
// The chunk request starts at the first tick of the cover, so it runs while the out phase is still ticking: a fixed 3 s delay passed during the out phase on a slow runner (CI: software
// GL, about 250 ms for each captured tick), the chunk was there when the out phase ended, and the hold had 1 to 5 frames. Counting hold frames holds the chunk until the hold has them.
// The wall-clock hold bound is raised so a slow runner cannot end the hold before the chunk is let go (the bound itself is tested below, with 1,500 ms).
export const HOLD_FRAMES = 24;
export const SLOW_RUNNER_BOUND = `(sj.hackDev.set({ options: { jack: { params: { holdBoundMs: 60000 } } } }), true)`;
/** Hold a route's request until `frames` hold frames are captured. Give `onFrame` of `capture` the returned `watch`. */
export const holdChunkFor = (frames: number) => {
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

// ---- line 21: the way back is exact ----------------------------------------------------------------------------------------------

/** Step a frozen game one tick at a time (with a little real time, for a module that loads) until `cond` holds. */
export async function stepUntil(page: Page, cond: string): Promise<void> {
  for (let i = 0; i < 600; i++) {
    await frozenStep(page, 1);
    if (await sj<boolean>(page, cond)) return;
    await page.waitForTimeout(10);
  }
  throw new Error(`the frozen game never reached: ${cond}`);
}

/** Put a known field on screen on a frozen game: the town, then the armory interior (no rain, so its picture depends on the field's tick count only). Every step is a tick, so two pages that do this have the same frame count. */
export async function restageFrozen(page: Page): Promise<void> {
  await freeze(page);
  await sj(page, "(sj.stage('town'), true)");
  await stepUntil(page, 'sj.top() === "FieldScene" && sj.idle()');
  await sj(page, "(sj.tp('armory', 6, 8, 'down'), true)");
  await stepUntil(page, 'sj.field().def.id === "armory" && sj.idle()');
  // A new field has a start-up of its own; measured at fx lite, its first frames differ between two pages in a few hundred pixels. 60 more ticks and the picture is the settled one.
  await frozenStep(page, 60);
}

/** The back buffer as base64 (the raw pixels, for a compare with a tolerance). */
export const SHOT = `(() => { sj.step(0); const d = sj.pixels({ x: 0, y: 0, w: ${W}, h: ${H} }).data; let s = ''; for (let i = 0; i < d.length; i += 8192) s += String.fromCharCode.apply(null, d.subarray(i, i + 8192)); return btoa(s); })()`;
export interface Settled {
  state: string;
  frame: number;
  hash: string;
  shot: Buffer;
}

/** Freeze, then read the field's state, its tick count and the settled picture (the hash of the back buffer, and the pixels). */
export async function settledPicture(page: Page): Promise<Settled> {
  await freeze(page);
  const state = await sj<string>(page, FIELD_STATE);
  const frame = await sj<number>(page, 'sj.field().frame');
  const hash = await sj<string>(page, '(sj.step(0), sj.frameHash())');
  return { state, frame, hash, shot: Buffer.from(await sj<string>(page, SHOT), 'base64') };
}

/** How many pixels differ by more than `tol` in any channel (a picture of another size counts every pixel). */
export function diffPixels(a: Buffer, b: Buffer, tol: number): number {
  if (a.length !== b.length) return Math.max(a.length, b.length) / 4;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > tol || Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0)) > tol || Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0)) > tol) n++;
  return n;
}

// The settled picture is compared with a rule that holds at full and at lite (the exact compare is the `fx none` case below). Two pages that were NEVER covered are not frame-exact (measured in
// round 1): one in real time and one stepped differ by up to 2 in a channel across the picture at lite, two pages that each put up a fresh field differ in a few hundred scattered pixels
// (about 0.1%), by run, and one run in seven showed a differing hash at full. So: 2 per channel, and at most 1% of the pixels beyond that. A leftover is far over this: a half-faded world differs in nearly every pixel, a left glitch layer in thousands, a filter in the whole picture.
// The control below pins that. (The structural state of the leftover is judged exactly: the field-state hash and the effect counts.)
export const PICTURE = { tol: 2, limit: Math.floor(W * H * 0.01) } as const;

// ---- line 24: deterministic pictures (the normal path) ---------------------------------------------------------------------------

/** A page on a fake clock with a fixed seed: the frames of the out and in phases of a jack, as `round:phase:tick` -> hash. The hold is left out (its length depends on the load). */
export async function sequence(browser: import('@playwright/test').Browser, style: JackStyle, seed: number): Promise<Record<string, string>> {
  const g = await openGame(browser, { query: `&jack=${style}&fx=full&seed=${seed}`, fakeClock: true });
  try {
    const { page } = g;
    expect(await waitUntil(page, '!!sj.game.top', 30_000)).toBe(true);
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
