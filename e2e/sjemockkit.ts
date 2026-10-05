/**
 * Shared by the resolution mock's spec (e2e/sjemock.spec.ts): step B3 of the engine-platform spike (docs/spikes/engine-platform.md).
 *
 * The mock shows the same four screens at the two candidate sizes, 480x270 and 640x360, on the two displays Mark cares about (1080p
 * fullscreen and a Steam Deck window), so he can pick one. Nothing is re-laid out for 640x360: the DEV switch `?size=640x360`
 * (src/sje/core/size.ts) only changes the size of the picture, and the art and the text stay as they are.
 *
 *   field    Lantern Row in the shipped game (the OLD engine, Canvas 2D), the party walking
 *   dialog   a line of the shipped dialog window, in the same field
 *   battle   the battle stage slice on the NEW engine (/sjestage.html)
 *   3d       the minimal 3D test scene on the NEW engine (/sjelab.html)
 *
 * What "the same state" means here. Each capture of one screen is made from the same script: the same map, the same position, the same
 * number of ticks, the same seed and the same text. A tick-driven game (the field) is frozen and stepped by hand, so a capture never
 * depends on how fast the machine ran. The facts that must agree between the two sizes come back with every capture (`facts`).
 *
 * Why the old engine runs with its GPU effects off. With them on, the game shows its bloom and a heat haze that are blurred at the
 * SCREEN's resolution, so the picture is soft by design and no block of it is one colour. The 2D path shows the pixel grid itself, which
 * is what the comparison is about. (The new engine has no such effects yet; its pictures are always exact.)
 */
import { type Browser, expect, type Page } from '@playwright/test';

export const SIZES = [
  { id: '480x270', w: 480, h: 270 },
  { id: '640x360', w: 640, h: 360 },
] as const;
export type SizeId = (typeof SIZES)[number]['id'];

/** The two displays. A window of this CSS size at device pixel ratio 1. */
export const DISPLAYS = [
  { id: '1080p', width: 1920, height: 1080, label: '1080p fullscreen (1920x1080)' },
  { id: 'deck', width: 1280, height: 800, label: 'Steam Deck window (1280x800)' },
] as const;
export type DisplayId = (typeof DISPLAYS)[number]['id'];

export const SCREENS = ['field', 'dialog', 'battle', '3d'] as const;
export type ScreenId = (typeof SCREENS)[number];

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Capture {
  /** The page as the player sees it: the whole window, bars included. PNG bytes. */
  png: Buffer;
  /** Where the game's picture sits in the window, in device pixels (the window is at ratio 1, so these are CSS pixels too). */
  region: Region;
  /** Device pixels per game pixel. A whole number, or (field, Fit mode) a fraction. */
  k: number;
  /** Everything about the state the capture was made in: what must be the same at both sizes, and what is measured. */
  facts: Record<string, unknown>;
}

/** What the tests ignore in the console: the browser's own hints, and the dev server's reload socket. */
const ALLOWED = [
  /GPU stall due to ReadPixels/,
  /Multiple readback operations using getImageData/,
  /WebSocket connection to 'ws:\/\/localhost:\d+\/\?token=/,
];

export interface Opened {
  page: Page;
  problems: string[];
  close(): Promise<void>;
}

async function open(browser: Browser, display: (typeof DISPLAYS)[number], url: string, seeded: boolean): Promise<Opened> {
  // SJEMOCK_BASE: a plain script (outside the test runner) has no baseURL from the config, so it names the dev server here.
  const base = process.env.SJEMOCK_BASE ? { baseURL: process.env.SJEMOCK_BASE } : {};
  const context = await browser.newContext({ ...base, viewport: { width: display.width, height: display.height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    if (ALLOWED.some((re) => re.test(m.text()))) return;
    problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  // The game's visual effects (dust, glitches) call Math.random. A fixed generator, reseeded by the script, makes them repeat.
  if (seeded) {
    await page.addInitScript(() => {
      let s = 1;
      (window as unknown as { __reseed: (n: number) => void }).__reseed = (n) => {
        s = n >>> 0;
      };
      Math.random = () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    });
  }
  await page.goto(url);
  return { page, problems, close: () => context.close() };
}

// ------------------------------------------------------------------------------------------------ the old engine (field, dialog)

/** The line the dialog capture shows: long enough to wrap onto three lines at 480x270. */
export const DIALOG_LINE = 'There they are. My favorite disaster and his apprentice. Sit, sit. Mind the stain, it’s load-bearing, and the rain gets in through the vents when the wind turns.';

/** One tick of the shipped game's own loop, by hand (see `freeze`). */
interface SjGame {
  tick(): void;
  frame: number;
  speed: number;
}

/**
 * Open the shipped game on the dev server at a size, with the loop stopped. The game's loop asks for a frame
 * (`requestAnimationFrame`) at the start of every frame; with that call replaced by a no-op the loop ends after the frame in progress.
 * From then on the page does nothing by itself: the test ticks and draws by hand, exactly as `main.ts` does (`game.tick()`, then
 * `display.beginFrame()`, `game.render()`, `display.present()`).
 */
export async function openGame(browser: Browser, size: SizeId, display: (typeof DISPLAYS)[number], mode: 'integer' | 'fit' = 'integer'): Promise<Opened & { fit: FitScale }> {
  const o = await open(browser, display, `/?debug&size=${size}`, true);
  await o.page.waitForFunction(() => (window as unknown as { __SJ__?: unknown }).__SJ__ !== undefined, null, { timeout: 60_000 });
  // Boot is asynchronous: wait until the title scene is up, so nothing of the boot is still to come when the loop is frozen.
  await o.page.waitForFunction(() => (window as unknown as { __SJ__: { top(): string | null } }).__SJ__.top() === 'TitleScene', null, { timeout: 60_000 });
  const fit = await o.page.evaluate(async (wanted) => {
    const sj = (window as unknown as { __SJ__: { gpu(on: boolean): void; display: { mode: string; resize(): void; element: HTMLCanvasElement; back: HTMLCanvasElement } } }).__SJ__;
    // What the game's own default ("Fit" mode) does on this window, written down before anything changes it: the size it gives the picture on the page.
    const css = { w: parseFloat(sj.display.element.style.width), h: parseFloat(sj.display.element.style.height) };
    const asked = { cssW: css.w, cssH: css.h, scale: css.w / sj.display.back.width, mode: sj.display.mode };
    // No GPU effects (see the header). Then, unless the capture is of Fit mode itself, the integer-scale mode ("Pixel-perfect" in Options):
    // whole device pixels per game pixel, bars around.
    sj.gpu(false);
    if (wanted === 'integer') sj.display.mode = 'integer';
    sj.display.resize();
    const frame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = () => 0;
    // Two real frames, so the one in progress has finished.
    await new Promise<void>((done) => frame(() => frame(() => done())));
    return asked;
  }, mode);
  return Object.assign(o, { fit });
}

/** What the shipped game's default Fit mode does with a window: the picture's CSS size and the scale (a fraction, unless the window is a whole multiple). */
export interface FitScale {
  cssW: number;
  cssH: number;
  scale: number;
  mode: string;
}

/** Run `n` ticks of the frozen game, then draw one frame (the same three calls as `main.ts`). */
export async function tickGame(page: Page, n: number): Promise<void> {
  await page.evaluate((count) => {
    const sj = (window as unknown as { __SJ__: { game: SjGame; display: { beginFrame(): void; present(): void }; render?: never } }).__SJ__;
    for (let i = 0; i < count; i++) sj.game.tick();
    draw();
    function draw(): void {
      const g = sj.game as unknown as { render(): void };
      sj.display.beginFrame();
      g.render();
      sj.display.present();
    }
  }, n);
}

/** Hold or release a key for the frozen game's input (the key events set a flag that the next tick reads). */
async function hold(page: Page, key: string, ticks: number): Promise<void> {
  await page.keyboard.down(key);
  await tickGame(page, ticks);
  await page.keyboard.up(key);
}

/** The place in the window where the game's canvas is, from the page's own layout. */
async function screenRegion(page: Page): Promise<Region> {
  return page.evaluate(() => {
    const r = document.getElementById('screen')?.getBoundingClientRect();
    if (!r) throw new Error('no #screen');
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
}

/** What the script did and where the game ended up: the same at both sizes. */
interface FieldFacts {
  [key: string]: unknown;
  top: string | null;
  map: string;
  leaderTile: [number, number];
  followerTile: [number, number];
  party: string[];
  gameFrame: number;
  ticksRun: number;
  seed: number;
}

/**
 * Lantern Row, the party on screen. The script: the game's own `start` stage (Kit leads, Rook follows), the frame counter reset to 0,
 * the loop frozen, 90 ticks for the fade-in, then Kit walks right for 40 ticks (the key held down) so Rook trails behind him, then 100
 * ticks of standing (the "Lantern Row" banner is gone after 200 ticks of the scene). The same 230 ticks at every size.
 */
export async function captureField(browser: Browser, size: SizeId, display: (typeof DISPLAYS)[number], opts: { dialog?: boolean; mode?: 'integer' | 'fit' } = {}): Promise<Capture & { opened: Opened }> {
  const o = await openGame(browser, size, display, opts.mode ?? 'integer');
  const { page } = o;
  const seed = 20261005;
  await page.evaluate((s) => {
    const w = window as unknown as { __reseed(n: number): void; __SJ__: { game: SjGame; stage(name: string): Promise<void> } };
    w.__reseed(s);
    w.__SJ__.game.frame = 0;
    // Not awaited: the stage's last step waits for a fade, which only ticks can finish.
    void w.__SJ__.stage('start');
  }, seed);
  await tickGame(page, 90);
  await hold(page, 'ArrowRight', 40);
  await tickGame(page, 100);
  let ticks = 230;
  if (opts.dialog) {
    await page.evaluate((text) => {
      const sj = (window as unknown as { __SJ__: { say(who: string, text: string, face?: string): void } }).__SJ__;
      sj.say('dutch', text, 'happy');
    }, DIALOG_LINE);
    // Long enough for the window to open and the whole line to be typed out (the typewriter is a few characters a tick).
    await tickGame(page, 240);
    ticks += 240;
  }
  // The "Autosaved" badge is on the wall clock (1.8 s), not on ticks, and the shipped game puts it where 480x270 has its corner. Let it expire, then draw again.
  await page.waitForTimeout(2100);
  await tickGame(page, 0);
  const facts = await page.evaluate(() => {
    const sj = (window as unknown as { __SJ__: { top(): string | null; state: { party: string[] }; game: SjGame; field(): { party: Array<{ x: number; y: number }> } | null } }).__SJ__;
    const f = sj.field();
    return {
      top: sj.top(),
      map: (sj.state as unknown as { map: string }).map,
      leaderTile: [f?.party[0]?.x ?? -1, f?.party[0]?.y ?? -1] as [number, number],
      followerTile: [f?.party[1]?.x ?? -1, f?.party[1]?.y ?? -1] as [number, number],
      party: [...sj.state.party],
      gameFrame: sj.game.frame,
    };
  });
  const region = await screenRegion(page);
  const png = await page.screenshot();
  const k = region.w / (SIZES.find((s) => s.id === size)?.w ?? 480);
  const f: FieldFacts = { ...facts, ticksRun: ticks, seed, fitMode: o.fit, tilesVisible: { cols: (SIZES.find((s) => s.id === size)?.w ?? 480) / 16, rows: (SIZES.find((s) => s.id === size)?.h ?? 270) / 16 } };
  return { png, region, k, facts: f, opened: o };
}

// ------------------------------------------------------------------------------------------------ the new engine pages

/** Where the engine's picture sits, from the page's own hook (the engine's presenter). */
type Picture = { x: number; y: number; w: number; h: number; k: number; canvasW: number; canvasH: number };

/** The battle stage slice at its tick 41, on /sjestage.html. Mark's art when his folder is there, else the stand-ins. */
export async function captureBattle(browser: Browser, size: SizeId, display: (typeof DISPLAYS)[number]): Promise<Capture & { opened: Opened }> {
  // STAGELAB_NO_SPRITES=1 shows the page what CI shows it (no sprite folder): the stand-ins.
  const o = await open(browser, display, `/sjestage.html?manual&size=${size}${process.env.STAGELAB_NO_SPRITES ? '&standins' : ''}`, false);
  const { page } = o;
  await page.waitForFunction(() => window.__SJESTAGE__ !== undefined || (window as unknown as { __SJESTAGE_ERROR__?: string }).__SJESTAGE_ERROR__ !== undefined, null, { timeout: 90_000 });
  const failed = await page.evaluate(() => (window as unknown as { __SJESTAGE_ERROR__?: string }).__SJESTAGE_ERROR__);
  if (failed) throw new Error(`the stage lab failed to start: ${failed}`);
  const TICK = 41;
  await page.evaluate((t) => window.__SJESTAGE__?.show({ tick: t }), TICK);
  const pic: Picture = (await page.evaluate(() => window.__SJESTAGE__?.picture())) as Picture;
  const info = await page.evaluate(() => window.__SJESTAGE__?.info());
  const figures = await page.evaluate(() => {
    const h = window.__SJESTAGE__;
    if (!h) throw new Error('no hook');
    return h.figures().map((f) => ({ id: f.id, side: f.side, ink: h.inkBox(f.id) }));
  });
  const png = await page.screenshot();
  return {
    png,
    region: { x: pic.x, y: pic.y, w: pic.w, h: pic.h },
    k: pic.k,
    facts: { tick: TICK, seed: info?.seed, sprites: info?.sprites, renderer: info?.renderer, w: info?.w, h: info?.h, figures },
    opened: o,
  };
}

/** The minimal 3D test scene on /sjelab.html: a hack with seed 7, 120 ticks in. The scene's look is not part of the review (Mark, 2026-10-05). */
export async function capture3d(browser: Browser, size: SizeId, display: (typeof DISPLAYS)[number]): Promise<Capture & { opened: Opened }> {
  const o = await open(browser, display, `/sjelab.html?manual&size=${size}`, false);
  const { page } = o;
  await page.waitForFunction(() => window.__SJE__ !== undefined || (window as unknown as { __SJE_ERROR__?: string }).__SJE_ERROR__ !== undefined, null, { timeout: 90_000 });
  const failed = await page.evaluate(() => (window as unknown as { __SJE_ERROR__?: string }).__SJE_ERROR__);
  if (failed) throw new Error(`the lab failed to start: ${failed}`);
  const TICKS = 120;
  await page.evaluate(() => {
    const h = window.__SJE__;
    if (!h) throw new Error('no hook');
    h.hackHud(true);
    h.hackStart({ ticks: 900 });
  });
  await page.waitForFunction(() => window.__SJE__?.scenes().includes('HackScene') === true, null, { timeout: 60_000 });
  const tickBefore = await page.evaluate(() => window.__SJE__?.tick() ?? -1);
  await page.evaluate((n) => window.__SJE__?.step(n), TICKS);
  const pic: Picture = (await page.evaluate(() => window.__SJE__?.picture())) as Picture;
  const info = await page.evaluate(() => window.__SJE__?.info());
  const sim = await page.evaluate(() => window.__SJE__?.sim());
  const frame = await page.evaluate(() => window.__SJE__?.frame());
  const png = await page.screenshot();
  return {
    png,
    region: { x: pic.x, y: pic.y, w: pic.w, h: pic.h },
    k: pic.k,
    facts: { seed: 7, ticksStepped: TICKS, labTick: tickBefore + TICKS, sim, frame3d: frame, renderer: info?.renderer, w: info?.w, h: info?.h },
    opened: o,
  };
}

// ------------------------------------------------------------------------------------------------ analysis (runs in a plain browser page)

export interface BlockResult {
  /** The picture's size in the screenshot, and the zoom asked for. */
  region: Region;
  k: number;
  /** How many k-by-k blocks were looked at (the whole picture, from its top-left corner), and how many were not one flat colour. */
  blocks: number;
  bad: number;
  /** The first few bad blocks, as (column, row). */
  samples: Array<{ x: number; y: number }>;
  /** Colours in the picture (a sanity check: a blank picture would be exact too). */
  colours: number;
}

/**
 * Count the k-by-k blocks of a screenshot's picture that are not one flat colour. The picture is the region, whose corner is where the
 * block grid starts. A pixel-exact capture has none. `k` must divide the region's size.
 */
export async function countBadBlocks(browser: Browser, png: Buffer, region: Region, k: number): Promise<BlockResult> {
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async ({ b64, region, k }) => {
        const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
        const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('no 2D context');
        ctx.drawImage(bmp, 0, 0);
        const w = Math.round(region.w);
        const h = Math.round(region.h);
        const data = new Uint32Array(ctx.getImageData(Math.round(region.x), Math.round(region.y), w, h).data.buffer);
        const colours = new Set<number>();
        for (let i = 0; i < data.length; i += 97) colours.add(data[i] ?? 0);
        let blocks = 0;
        let bad = 0;
        const samples: Array<{ x: number; y: number }> = [];
        for (let by = 0; by < Math.floor(h / k); by++) {
          for (let bx = 0; bx < Math.floor(w / k); bx++) {
            blocks++;
            const first = data[by * k * w + bx * k];
            let flat = true;
            for (let dy = 0; dy < k && flat; dy++) {
              const row = (by * k + dy) * w + bx * k;
              for (let dx = 0; dx < k; dx++) {
                if (data[row + dx] !== first) {
                  flat = false;
                  break;
                }
              }
            }
            if (!flat) {
              bad++;
              if (samples.length < 8) samples.push({ x: bx, y: by });
            }
          }
        }
        return { region: { x: region.x, y: region.y, w, h }, k, blocks, bad, samples, colours: colours.size };
      },
      { b64: png.toString('base64'), region, k },
    );
  } finally {
    await page.close();
  }
}

/** The rows and columns of ink of a drawn glyph, found by drawing it with the game's own font on a scratch canvas. Returns game pixels. */
export async function glyphInk(page: Page, chars: string[]): Promise<Record<string, { w: number; h: number; top: number; bottom: number }>> {
  return page.evaluate(async (list) => {
    // The font module is pure drawing code. A second copy of it in the page is fine: it holds no game state.
    const url = '/src/engine/font.ts';
    const font = (await import(/* @vite-ignore */ url)) as { drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, opts?: { shadow?: false | string; color?: string }): number };
    const out: Record<string, { w: number; h: number; top: number; bottom: number }> = {};
    for (const ch of list) {
      const c = document.createElement('canvas');
      c.width = 24;
      c.height = 24;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('no 2D context');
      font.drawText(ctx, ch, 4, 4, { shadow: false, color: '#ffffff' });
      const px = ctx.getImageData(0, 0, 24, 24).data;
      let top = 99;
      let bottom = -1;
      let left = 99;
      let right = -1;
      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 24; x++) {
          if ((px[(y * 24 + x) * 4 + 3] ?? 0) === 0) continue;
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
      }
      out[ch] = { w: right - left + 1, h: bottom - top + 1, top: top - 4, bottom: bottom - 4 };
    }
    return out;
  }, chars);
}

/** The inked height of the field's party leader (his standing frame, facing down), in game pixels. */
export async function fieldCharacterInk(page: Page): Promise<{ w: number; h: number; cell: [number, number] }> {
  return page.evaluate(() => {
    const sj = (window as unknown as { __SJ__: { field(): { party: Array<{ sprite: { frames: Record<string, HTMLCanvasElement[]> } }> } | null } }).__SJ__;
    const frame = sj.field()?.party[0]?.sprite.frames.down?.[0];
    if (!frame) throw new Error('no leader frame');
    const ctx = frame.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2D context');
    const px = ctx.getImageData(0, 0, frame.width, frame.height).data;
    let top = frame.height;
    let bottom = -1;
    let left = frame.width;
    let right = -1;
    for (let y = 0; y < frame.height; y++) {
      for (let x = 0; x < frame.width; x++) {
        if ((px[(y * frame.width + x) * 4 + 3] ?? 0) === 0) continue;
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
    return { w: right - left + 1, h: bottom - top + 1, cell: [frame.width, frame.height] as [number, number] };
  });
}

// ------------------------------------------------------------------------------------------------ the side-by-side image

export interface SideNote {
  /** A rectangle in GAME pixels of the picture it is drawn on, outlined and labelled. */
  box: Region;
  label: string;
}

/**
 * One image with the 480x270 capture on the left and the 640x360 capture on the right, each at the SAME physical scale as on that
 * display (the screenshots are placed 1:1, never resized), with a caption bar on top. `notes` outline and label an area of the right
 * picture (game pixels), for the places that are laid out for 480x270 and show empty or unused space at 640x360. Returns PNG bytes.
 */
export async function sideBySide(
  browser: Browser,
  left: Capture,
  right: Capture,
  opts: { title: string; leftCaption: string; rightCaption: string; rightNotes?: SideNote[] },
): Promise<Buffer> {
  const gap = 8;
  const bar = 72;
  const lw = pngSize(left.png);
  const rw = pngSize(right.png);
  const width = lw.w + gap + rw.w;
  const height = bar + Math.max(lw.h, rw.h);
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  try {
    const rk = right.k;
    const notes = (opts.rightNotes ?? [])
      .map(
        (n) =>
          `<div class="note" style="left:${right.region.x + n.box.x * rk}px;top:${right.region.y + n.box.y * rk}px;width:${n.box.w * rk}px;height:${n.box.h * rk}px"><span>${n.label}</span></div>`,
      )
      .join('');
    await page.setContent(`<!doctype html><html><head><style>
      html,body{margin:0;background:#000;width:${width}px;height:${height}px;overflow:hidden;font:600 18px/1.2 Consolas,'Courier New',monospace;color:#e8e4ff}
      .bar{position:absolute;left:0;top:0;width:${width}px;height:${bar}px;background:#1c1a2e;border-bottom:2px solid #3fe0f0;box-sizing:border-box}
      .cap{position:absolute;top:36px;height:36px;display:flex;align-items:center;padding:0 12px;white-space:nowrap;box-sizing:border-box}
      .title{position:absolute;top:0;left:0;height:36px;padding:0 12px;display:flex;align-items:center;color:#ffd75e;white-space:nowrap}
      img{position:absolute;top:${bar}px;image-rendering:pixelated;display:block}
      .note{position:absolute;margin-top:${bar}px;border:2px dashed #ff4fb0;box-sizing:border-box;pointer-events:none}
      .note span{position:absolute;left:6px;bottom:6px;background:rgba(10,9,19,.85);color:#ff9fd4;font-size:16px;padding:2px 6px}
    </style></head><body>
      <div class="bar"></div>
      <div class="cap" style="left:0">${opts.leftCaption}</div>
      <div class="cap" style="left:${lw.w + gap}px">${opts.rightCaption}</div>
      <div class="title">${opts.title}</div>
      <img style="left:0" src="data:image/png;base64,${left.png.toString('base64')}">
      <img style="left:${lw.w + gap}px" src="data:image/png;base64,${right.png.toString('base64')}">
      <div style="position:absolute;left:${lw.w}px;top:${bar}px;width:${gap}px;height:${height - bar}px;background:#3fe0f0"></div>
      <div style="position:absolute;left:${lw.w + gap}px;top:0">${notes}</div>
    </body></html>`);
    await page.evaluate(() => Promise.all(Array.from(document.images).map((i) => i.decode())));
    return await page.screenshot({ type: 'png' });
  } finally {
    await page.close();
  }
}

/** The width and height written in a PNG's header. */
export function pngSize(png: Buffer): { w: number; h: number } {
  expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
}

/** What `readDialogGlyphs` found in a picture of the dialog window. All in DEVICE pixels, inked rows only (the game's text colour, not the shadow). */
export interface DialogGlyphs {
  /** The rows of ink of the first line of text, as a band: its top row and bottom row in the picture, and how many rows that is. */
  line: { top: number; bottom: number; rows: number };
  /** The letters of the first word, left to right, found as groups of columns with a blank column between them: each one's ink rows and columns. */
  letters: Array<{ x0: number; x1: number; y0: number; y1: number; rows: number; cols: number }>;
}

/**
 * C14: READ BACK a known glyph from the captured picture. The dialog line starts with "There" (`DIALOG_LINE`). The game draws text in one flat colour
 * (`#f4f1ff`, `TEXT` in src/engine/font.ts) with a one pixel shadow of another colour, so the pixels of exactly that colour are the letters. In the
 * lower part of the picture and to the right of the portrait (where the text starts) this finds the first line of text, then splits it into letters at
 * the blank columns between them. The first letter is the capital T, the third is a lowercase e: their heights in device pixels are what the player
 * sees, to compare with the glyph table (7 rows and 5 rows) times the scale.
 */
export async function readDialogGlyphs(browser: Browser, png: Buffer, region: Region, k: number): Promise<DialogGlyphs> {
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async ({ b64, region, k }) => {
        const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
        const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('no 2D context');
        ctx.drawImage(bmp, 0, 0);
        const rw = Math.round(region.w);
        const rh = Math.round(region.h);
        const img = ctx.getImageData(Math.round(region.x), Math.round(region.y), rw, rh).data;
        const isText = (x: number, y: number): boolean => {
          const i = (y * rw + x) * 4;
          return img[i] === 0xf4 && img[i + 1] === 0xf1 && img[i + 2] === 0xff;
        };
        // The text lives in the lower part of the picture (the box is 62 game pixels tall and 6 above the bottom) and right of the portrait (8 + 8 + 56 = 72).
        // (Game pixels times k: the picture is whatever size the display gives it.)
        const xFrom = 72 * k;
        const yFrom = rh - 70 * k;
        const rowInk = (y: number): boolean => {
          for (let x = xFrom; x < rw; x++) if (isText(x, y)) return true;
          return false;
        };
        let top = -1;
        for (let y = yFrom; y < rh; y++)
          if (rowInk(y)) {
            top = y;
            break;
          }
        if (top < 0) throw new Error('no text-coloured pixel in the dialog area');
        // The first line is the run of rows with ink from the top, plus the rows of a glyph with a gap in it: a line is 9 game pixels tall (GLYPH_H), so take 9 x k rows.
        const bottomLimit = Math.min(rh - 1, top + 9 * k - 1);
        let bottom = top;
        for (let y = top; y <= bottomLimit; y++) if (rowInk(y)) bottom = y;
        // Columns with ink in that band, grouped: a gap of a whole game pixel (k device pixels) or more ends a letter.
        const colInk = (x: number): boolean => {
          for (let y = top; y <= bottom; y++) if (isText(x, y)) return true;
          return false;
        };
        const groups: Array<{ x0: number; x1: number }> = [];
        let x = xFrom;
        while (x < rw && groups.length < 5) {
          while (x < rw && !colInk(x)) x++;
          if (x >= rw) break;
          const x0 = x;
          let blank = 0;
          let last = x;
          while (x < rw && blank < k) {
            if (colInk(x)) {
              blank = 0;
              last = x;
            } else blank++;
            x++;
          }
          groups.push({ x0, x1: last });
        }
        const letters = groups.map((g) => {
          let y0 = 1e9;
          let y1 = -1;
          for (let yy = top; yy <= bottom; yy++)
            for (let xx = g.x0; xx <= g.x1; xx++)
              if (isText(xx, yy)) {
                y0 = Math.min(y0, yy);
                y1 = Math.max(y1, yy);
              }
          return { x0: g.x0, x1: g.x1, y0, y1, rows: y1 - y0 + 1, cols: g.x1 - g.x0 + 1 };
        });
        return { line: { top, bottom, rows: bottom - top + 1 }, letters };
      },
      { b64: png.toString('base64'), region, k },
    );
  } finally {
    await page.close();
  }
}
