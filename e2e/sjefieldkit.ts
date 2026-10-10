/**
 * The browser side of the field parity harness (M5 task 8): put a page (the old path or the new one) in a fixed state of `tests/fixtures/sjefield/cases.json`, run its
 * fake clock to an exact field tick, and take the 640x360 picture the player sees. The pure comparison is in `e2e/sjefieldparity.ts`.
 *
 * Both paths run the SAME code to reach a state (`__SJ__.fieldShow`, src/dev/fieldshow.ts) on a page with a fake, paused clock and a seeded `Math.random`
 * (`openGame({ fakeClock: true })`), so the old field and the new one are in the same state at the same tick.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { advance, decode, type GamePage, openGame, sj, waitUntil } from './sjegamekit';
import { type Picture, type RendererKind, unevenBlocks, W, H } from './sjefieldparity';

export const ROOT = join(import.meta.dirname, '..');
export const DIR = join(ROOT, 'tests', 'fixtures', 'sjefield');

export interface Case {
  id: string;
  stage: string;
  map: string;
  x: number;
  y: number;
  dir: 'up' | 'down' | 'left' | 'right';
  note: string;
  flags?: Record<string, unknown>;
  ambient?: string;
  weather?: string;
  /** The seed of the page's random numbers. */
  seed?: number;
  /** The field tick the picture is taken at. */
  frame?: number;
  /** The effects level of both paths: `none` (the field's own drawing, the default) or `full` (the whole GPU stack: glow, haze, bloom). */
  fx?: 'none' | 'full';
  /** The renderer kinds that have a reference (default: both). */
  kinds?: RendererKind[];
}

const file = JSON.parse(readFileSync(join(DIR, 'cases.json'), 'utf8')) as { defaultFrame: number; cases: Case[] };
export const CASES: Case[] = file.cases;
export const DEFAULT_FRAME = file.defaultFrame;

/** The map files and the shared look data that a reference picture of the old field depends on. A changed file fails the spec first, with the command that makes the references again. */
export const INPUTS: string[] = [...new Set(CASES.map((c) => `src/data/maps/${c.map}.json`))].sort();

/** The zoom the page runs at: a 1280x720 window shows the 640x360 game at 2x. */
export const ZOOM = 2;
export const VIEWPORT = { width: W * ZOOM, height: H * ZOOM };

/** Which kind of renderer does this page draw with? The bundled Chromium on SwiftShader (CI) is `soft`; a hardware browser is `gpu`. */
export async function rendererKind(page: Page): Promise<RendererKind> {
  const name = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    if (!gl) return 'none';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  });
  return /swiftshader|llvmpipe|software/i.test(name) || name === 'none' ? 'soft' : 'gpu';
}

export interface Shot {
  /** What the player sees: the screenshot of the window, 1280x720 (the game at zoom 2 fills it). */
  picture: Picture;
  /** The screenshot as the browser encoded it (what a reference file holds). */
  png: Buffer;
  /** The 2x2 blocks of the picture that are not one flat color (0 for a crisp picture). */
  uneven: number;
  /** The field tick of the picture and the state the page reported. */
  frame: number;
  info: { map: string; lights: number; camera: { x: number; y: number }; leader: { x: number; y: number } };
  page: GamePage;
}

/** Step the fake clock (one rAF of 16 ms at a time near the end) until the field's tick counter is `target`. Throws when it jumps past it. */
export async function settle(page: Page, target: number): Promise<void> {
  for (let guard = 0; guard < 400; guard++) {
    const f = await sj<number>(page, 'sj.field() ? sj.field().frame : -1');
    if (f === target) return;
    if (f > target) throw new Error(`the field tick is ${f}, past the ${target} asked for`);
    const left = target - f;
    // Far away: jump most of the way (a rAF is 16 ms and a tick 16.67 ms, so about left x 16.7 ms), then walk the last ticks one rAF at a time.
    await advance(page, left > 12 ? Math.floor((left - 8) * 16.6) : 16);
  }
  throw new Error(`the field did not reach tick ${target}`);
}

/** Open a fresh page on the old path or the new one, put it in the state of `c`, run it to its tick, and take the picture. The caller closes `shot.page`. */
export async function shoot(browser: Browser, c: Case, engine: boolean, extra: { lightScale?: number; nudge?: { px: number; py: number } } = {}): Promise<Shot> {
  const fx = c.fx ?? 'none';
  // The new path takes the level from the query. The old one takes it from the settings (`sj.gpu`), below.
  const g = await openGame(browser, { engine, fakeClock: true, viewport: VIEWPORT, query: `&fx=${fx}`, ...(c.seed !== undefined ? { seed: c.seed } : {}) });
  try {
    if (!(await waitUntil(g.page, 'sj.top() === "TitleScene"', 60_000).catch(() => false))) {
      // The title needs the fake clock to run: step it.
      for (let i = 0; i < 100; i++) {
        await advance(g.page, 100);
        if (await sj<boolean>(g.page, 'sj.top() === "TitleScene"').catch(() => false)) break;
      }
    }
    if (!engine) await sj(g.page, `sj.gpu(${fx === 'full'})`);
    await sj(g.page, `sj.fieldShow(${JSON.stringify({ stage: c.stage, map: c.map, x: c.x, y: c.y, dir: c.dir, flags: c.flags, ambient: c.ambient, weather: c.weather, ...extra })})`);
    // The new path opens its stage a little after the field exists (a lazy chunk): give the clock time until the field is on.
    for (let i = 0; i < 200; i++) {
      await advance(g.page, 100);
      if (await sj<boolean>(g.page, 'sj.field() !== null && sj.top() === "FieldScene"').catch(() => false)) break;
    }
    const target = c.frame ?? DEFAULT_FRAME;
    await settle(g.page, target);
    if (engine && !(await waitUntil(g.page, 'sj.fieldStage !== null', 10_000))) throw new Error('the stage did not open on the new path');
    // The whole window, not one canvas: with GPU effects the old path shows its picture on a second canvas (#fx) over the 2D one, and the player sees the top one.
    const png = await g.page.screenshot();
    const d = decode(png);
    const picture: Picture = { w: d.w, h: d.h, data: d.data };
    if (picture.w !== W * ZOOM || picture.h !== H * ZOOM) throw new Error(`the window is ${picture.w}x${picture.h}, expected ${W * ZOOM}x${H * ZOOM}`);
    const uneven = unevenBlocks(picture, ZOOM);
    const frame = await sj<number>(g.page, 'sj.field().frame');
    const info = await sj<Shot['info']>(g.page, 'sj.fieldInfo()');
    return { picture, png, uneven, frame, info, page: g };
  } catch (e) {
    await g.close();
    throw e;
  }
}

// ------------------------------------------------------------------ the references (made by e2e/sje-field-refs.spec.ts)

export const refPath = (kind: RendererKind, id: string): string => join(DIR, kind, `${id}.png`);

/** Write the browser's own PNG bytes: they are filtered and small, and what was compared is exactly what is stored. */
export function writeRef(kind: RendererKind, id: string, png: Buffer): void {
  mkdirSync(join(DIR, kind), { recursive: true });
  writeFileSync(refPath(kind, id), png);
}

export function readRef(kind: RendererKind, id: string): Picture | null {
  const path = refPath(kind, id);
  if (!existsSync(path)) return null;
  const d = decode(readFileSync(path));
  return { w: d.w, h: d.h, data: d.data };
}

/** The SHA-256 of a repo file as text with LF line ends, so a Windows checkout and a Linux one agree. */
export const pinOf = (rel: string): string => createHash('sha256').update(readFileSync(join(ROOT, rel), 'utf8').replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10)), 'utf8').digest('hex');
