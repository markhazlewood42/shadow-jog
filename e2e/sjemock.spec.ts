/**
 * The resolution mock (step B3 of the engine-platform spike, docs/spikes/engine-platform.md; exit criterion 11, design decision E12):
 * the same four screens at 480x270 and at 640x360, on a 1080p fullscreen display and in a Steam Deck window (1280x800), so Mark can
 * choose a size by eye. Nothing is re-laid out for 640x360: only the picture's size changes (`src/sje/core/size.ts`).
 *
 * What it checks (the pass line behind each):
 *  - the DEV switch: `?size=640x360` makes a 640x360 picture on the old game, the engine lab and the stage lab; any other value is
 *    ignored; and the SHIPPED build has no trace of it: its bundle has no `640x360`, and the page ignores `?size=` (B4, P1).
 *  - exactness: for all four screens, both sizes and both displays, every k-by-k block of the picture is ONE colour at the integer
 *    scale the presenter used, and that scale is the whole number the arithmetic says (P3, V1, B5).
 *  - the same content and state at both sizes: the same map, tiles, tick count, seed and text; a capture repeated gives the same bytes (P5, V2, V4).
 *  - legibility: the dialog's capital letters are at least 14 device pixels tall on every display at both sizes (V5), measured.
 *
 * With `SJEMOCK_SHOTS=<folder>` it also writes what Mark looks at: every capture as a full-resolution PNG, one side-by-side image per
 * screen and display, and `report.json` (the facts of every capture and the measurements table). That is the one run that writes files.
 *
 * Run it:  npx playwright test e2e/sjemock.spec.ts --reporter=line
 *          PW_NOGPU=1 npx playwright test e2e/sjemock.spec.ts   (software GL and canvas, like CI)
 *          SJEMOCK_SHOTS=<folder> npx playwright test e2e/sjemock.spec.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  type Capture,
  capture3d,
  captureBattle,
  captureField,
  countBadBlocks,
  DISPLAYS,
  type DisplayId,
  fieldCharacterInk,
  glyphInk,
  openGame,
  pngSize,
  type ScreenId,
  SCREENS,
  type SideNote,
  SIZES,
  type SizeId,
  sideBySide,
} from './sjemockkit';

const SHOTS = process.env.SJEMOCK_SHOTS;
const PROD = 'http://localhost:3008';

type Key = `${ScreenId}|${DisplayId}|${SizeId}`;
const key = (s: ScreenId, d: DisplayId, z: SizeId): Key => `${s}|${d}|${z}`;

/** The integer scale each display must give each size: floor(min(width / w, height / h)). Written out by hand, not read from the engine. */
const EXPECT_K: Record<DisplayId, Record<SizeId, number>> = {
  '1080p': { '480x270': 4, '640x360': 3 },
  deck: { '480x270': 2, '640x360': 2 },
};

/** Cap height of the dialog's text must reach this many device pixels (a 7-pixel capital at k=2 is 14). */
const MIN_CAP_DEVICE_PX = 14;

const captures = new Map<Key, Capture>();
const extras = new Map<string, Capture>();

test.describe.configure({ mode: 'serial' });

test.describe('the resolution mock', () => {
  test.setTimeout(600_000);

  test.beforeAll(async ({ browser }) => {
    for (const d of DISPLAYS) {
      for (const z of SIZES) {
        const made: Array<[ScreenId, () => ReturnType<typeof captureField>]> = [
          ['field', () => captureField(browser, z.id, d)],
          ['dialog', () => captureField(browser, z.id, d, { dialog: true })],
          ['battle', () => captureBattle(browser, z.id, d)],
          ['3d', () => capture3d(browser, z.id, d)],
        ];
        for (const [screen, make] of made) {
          const c = await make();
          // Console errors and warnings (the allowed hints are filtered out in the kit) fail the run.
          expect(c.opened.problems, `console problems on ${screen} ${d.id} ${z.id}`).toEqual([]);
          captures.set(key(screen, d.id, z.id), c);
          await c.opened.close();
        }
      }
    }
    // Extra, and not part of the exactness line: the shipped game's DEFAULT Fit mode in the Steam Deck window. On a window that is not a whole
    // multiple of the picture it scales by a fraction and the browser resamples. This is what a Deck player gets today at 480x270.
    for (const z of SIZES) {
      const c = await captureField(browser, z.id, DISPLAYS[1], { mode: 'fit' });
      extras.set(`field|deck|${z.id}|fit`, c);
      await c.opened.close();
    }
  });

  test('the DEV size switch: 640x360 on the old game and both labs, other values ignored', async ({ browser }) => {
    // The old game.
    for (const [q, expected] of [
      ['size=640x360', [640, 360]],
      ['size=480x270', [480, 270]],
      ['', [480, 270]],
      ['size=800x600', [480, 270]],
      ['size=640X360', [480, 270]],
    ] as const) {
      const page = await browser.newPage();
      try {
        await page.goto(`/?debug${q ? `&${q}` : ''}`);
        await page.waitForFunction(() => (window as unknown as { __SJ__?: unknown }).__SJ__ !== undefined);
        const got = await page.evaluate(() => {
          const sj = (window as unknown as { __SJ__: { display: { back: HTMLCanvasElement } } }).__SJ__;
          return [sj.display.back.width, sj.display.back.height];
        });
        expect(got, `old game, "${q}"`).toEqual(expected);
      } finally {
        await page.close();
      }
    }
    // The engine lab and the stage lab: the 3D target and the picture follow the same size.
    const lab = captures.get(key('3d', '1080p', '640x360'));
    expect(lab?.facts).toMatchObject({ w: 640, h: 360, frame3d: { width: 640, height: 360 } });
    const stage = captures.get(key('battle', '1080p', '640x360'));
    expect(stage?.facts).toMatchObject({ w: 640, h: 360 });
    expect(captures.get(key('3d', '1080p', '480x270'))?.facts).toMatchObject({ w: 480, h: 270, frame3d: { width: 480, height: 270 } });
  });

  test('the shipped build has no size switch: no "640x360" in any bundle file, and ?size= is ignored', async ({ page, request }) => {
    // The preview server (Playwright's config builds the game fresh and serves it on 3008).
    const html = await (await request.get(`${PROD}/`)).text();
    const scripts = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+\.js)"/g)].map((m) => m[1] as string);
    expect(scripts.length, 'the entry script of the shipped page').toBeGreaterThan(0);
    // The entry chunk lists its lazy chunks (the battle, the deck scene) in `__vite__mapDeps`; follow every `./name.js` it names, to any depth.
    const seen = new Set<string>();
    const queue = [...scripts];
    while (queue.length) {
      const rel = (queue.pop() as string).replace(/^\.\//, '');
      if (seen.has(rel)) continue;
      seen.add(rel);
      const text = await (await request.get(`${PROD}/${rel}`)).text();
      expect(text, `${rel} must not hold the DEV size switch`).not.toContain('640x360');
      expect(text, `${rel} must not read a "size" query`).not.toMatch(/get\(["']size["']\)/);
      for (const m of text.matchAll(/["'](?:\.\/)?([\w-]+\.js)["']/g)) queue.push(`assets/${m[1]}`);
    }
    expect(seen.size, 'chunks followed (the entry and its lazy chunks)').toBeGreaterThanOrEqual(5);
    // The page does not obey the query. A 960x540 window shows 480x270 at 2x (a 960x540 canvas); at 640x360 it would be 1280x720 (Fit mode, k=2).
    await page.setViewportSize({ width: 960, height: 540 });
    await page.goto(`${PROD}/?size=640x360`);
    await page.waitForFunction(() => document.getElementById('screen') !== null && (document.getElementById('boot')?.style.display ?? '') === 'none');
    const canvas = await page.evaluate(() => {
      const c = document.getElementById('screen') as HTMLCanvasElement;
      return { w: c.width, h: c.height };
    });
    expect(canvas, 'the shipped picture is 480x270 at 2x').toEqual({ w: 960, h: 540 });
    expect(await page.evaluate(() => '__SJ__' in window)).toBe(false);
  });

  test('every capture is pixel-exact at its integer scale, and the scale is the whole number the arithmetic says', async ({ browser }) => {
    const rows: string[] = [];
    for (const s of SCREENS) {
      for (const d of DISPLAYS) {
        for (const z of SIZES) {
          const c = captures.get(key(s, d.id, z.id));
          expect(c, `capture ${s} ${d.id} ${z.id}`).toBeTruthy();
          if (!c) continue;
          const k = EXPECT_K[d.id][z.id];
          expect(c.k, `${s} ${d.id} ${z.id}: the scale the page used`).toBe(k);
          // The screenshot is the whole window, and the picture sits in it, centred on whole pixels, exactly W*k by H*k.
          expect(pngSize(c.png), 'screenshot size').toEqual({ w: d.width, h: d.height });
          expect(c.region.w, 'picture width').toBe(z.w * k);
          expect(c.region.h, 'picture height').toBe(z.h * k);
          expect(c.region.x).toBe(Math.floor((d.width - z.w * k) / 2));
          expect(c.region.y).toBe(Math.floor((d.height - z.h * k) / 2));
          const b = await countBadBlocks(browser, c.png, c.region, k);
          rows.push(`${s} ${d.id} ${z.id}: k=${k} blocks=${b.blocks} bad=${b.bad} colours~${b.colours}`);
          expect(b.bad, `${s} ${d.id} ${z.id}: blocks that are not one colour (first: ${JSON.stringify(b.samples)})`).toBe(0);
          expect(b.blocks).toBe(z.w * z.h);
          // A blank picture would be exact too: it must have real content.
          expect(b.colours, `${s} ${d.id} ${z.id}: colours (sampled)`).toBeGreaterThan(40);
        }
      }
    }
    console.log(`SJEMOCK exactness\n${rows.join('\n')}`);
  });

  test('both sizes show the same content and state; a capture repeated gives the same bytes', async ({ browser }) => {
    for (const d of DISPLAYS) {
      for (const s of ['field', 'dialog'] as const) {
        const a = captures.get(key(s, d.id, '480x270'))?.facts;
        const b = captures.get(key(s, d.id, '640x360'))?.facts;
        for (const f of ['top', 'map', 'leaderTile', 'followerTile', 'party', 'gameFrame', 'ticksRun', 'seed']) {
          expect(b?.[f], `${s} ${d.id}: ${f} at 640x360 equals ${f} at 480x270`).toEqual(a?.[f]);
        }
        expect(a?.top).toBe(s === 'dialog' ? 'DialogScene' : 'FieldScene');
        expect(a?.map).toBe('lantern_row');
        expect(a?.party, 'the party is on screen: Kit and Rook').toEqual(['kit', 'rook']);
        // Rook trails Kit by one tile: the two are side by side in the picture.
        expect(a?.leaderTile).not.toEqual(a?.followerTile);
      }
      const bs = captures.get(key('battle', d.id, '480x270'))?.facts as { tick: number; seed: number; sprites: string; figures: Array<{ id: string; ink: { inkH: number } }> };
      const bl = captures.get(key('battle', d.id, '640x360'))?.facts as typeof bs;
      expect({ tick: bl.tick, seed: bl.seed, sprites: bl.sprites, figures: bl.figures }).toEqual({ tick: bs.tick, seed: bs.seed, sprites: bs.sprites, figures: bs.figures });
      const t = captures.get(key('3d', d.id, '480x270'))?.facts as { seed: number; ticksStepped: number; labTick: number; sim: unknown };
      const u = captures.get(key('3d', d.id, '640x360'))?.facts as typeof t;
      expect({ seed: u.seed, ticksStepped: u.ticksStepped, labTick: u.labTick, sim: u.sim }).toEqual({ seed: t.seed, ticksStepped: t.ticksStepped, labTick: t.labTick, sim: t.sim });
    }
    // Repeatability (V4): the same script run again gives the same picture, byte for byte, at both sizes. The old game's frozen loop and the
    // seeded generator make the field repeat; the engine pages repeat by their fixed tick.
    const d = DISPLAYS[0];
    for (const z of SIZES) {
      for (const [s, make] of [
        ['field', () => captureField(browser, z.id, d)],
        ['battle', () => captureBattle(browser, z.id, d)],
        ['3d', () => capture3d(browser, z.id, d)],
      ] as const) {
        const again = await make();
        try {
          const first = captures.get(key(s, d.id, z.id));
          expect(again.png.equals(first?.png ?? Buffer.alloc(0)), `${s} ${z.id}: a second capture is byte for byte the first`).toBe(true);
        } finally {
          await again.opened.close();
        }
      }
    }
  });

  test('the dialog text is legible at both sizes on both displays (measured), and the numbers of the table', async ({ browser }) => {
    const field = captures.get(key('field', '1080p', '480x270'));
    expect(field).toBeTruthy();
    // The glyphs and the character are the same pictures at both sizes: measure once, in the old game's page.
    const o = await openGame(browser, '480x270', DISPLAYS[0]);
    let glyphs: Awaited<ReturnType<typeof glyphInk>>;
    let character: Awaited<ReturnType<typeof fieldCharacterInk>>;
    try {
      glyphs = await glyphInk(o.page, ['H', 'x', 'p']);
      await o.page.evaluate(async () => {
        const w = window as unknown as { __SJ__: { stage(n: string): Promise<void>; game: { tick(): void } } };
        void w.__SJ__.stage('start');
        for (let i = 0; i < 5; i++) w.__SJ__.game.tick();
      });
      character = await fieldCharacterInk(o.page);
    } finally {
      await o.close();
    }
    const cap = glyphs.H?.h ?? 0;
    const xh = glyphs.x?.h ?? 0;
    expect(cap, 'a capital letter of the game font is 7 pixels tall').toBe(7);
    expect(xh, 'the x-height of the game font').toBeGreaterThan(0);
    expect(xh).toBeLessThan(cap);

    const rows: Array<Record<string, unknown>> = [];
    for (const d of DISPLAYS) {
      for (const z of SIZES) {
        const k = EXPECT_K[d.id][z.id];
        const battle = captures.get(key('battle', d.id, z.id))?.facts as { figures: Array<{ id: string; side: string; ink: { inkH: number } }>; sprites: string };
        const hero = battle.figures.find((f) => f.side === 'party');
        const punk = battle.figures.find((f) => f.id.startsWith('rustfang_punk'));
        const fit = (captures.get(key('field', d.id, z.id))?.facts.fitMode ?? {}) as { scale?: number; cssW?: number; cssH?: number };
        const region = captures.get(key('field', d.id, z.id))?.region;
        const row = {
          display: d.id,
          size: z.id,
          k,
          picture: `${z.w * k}x${z.h * k}`,
          barsLeftRight: `${region?.x}+${d.width - (region?.x ?? 0) - z.w * k}`,
          barsTopBottom: `${region?.y}+${d.height - (region?.y ?? 0) - z.h * k}`,
          fieldCharacterPx: character.h * k,
          battleHeroPx: (hero?.ink.inkH ?? 0) * k,
          punkPx: (punk?.ink.inkH ?? 0) * k,
          dialogCapPx: cap * k,
          dialogXHeightPx: xh * k,
          tilesVisible: `${z.w / 16} x ${z.h / 16}`,
          defaultFitScale: fit.scale === undefined ? null : Number(fit.scale.toFixed(3)),
          defaultFitPicture: `${fit.cssW}x${fit.cssH}`,
          sprites: battle.sprites,
        };
        rows.push(row);
        expect(row.dialogCapPx, `${d.id} ${z.id}: capital letters, device pixels`).toBeGreaterThanOrEqual(MIN_CAP_DEVICE_PX);
        expect(row.fieldCharacterPx, `${d.id} ${z.id}: the field character`).toBeGreaterThan(0);
        expect(row.battleHeroPx, `${d.id} ${z.id}: the battle hero`).toBeGreaterThan(0);
        expect(row.punkPx, `${d.id} ${z.id}: the punk`).toBeGreaterThan(0);
      }
    }
    console.log(`SJEMOCK table\n${JSON.stringify({ glyphs, character, rows }, null, 1)}`);
    // At the same scale on a display, a figure of the same art is the same height at both sizes; the sizes differ only in the scale.
    for (const d of DISPLAYS) {
      const a = rows.find((r) => r.display === d.id && r.size === '480x270');
      const b = rows.find((r) => r.display === d.id && r.size === '640x360');
      expect((a?.fieldCharacterPx as number) / EXPECT_K[d.id]['480x270']).toBe((b?.fieldCharacterPx as number) / EXPECT_K[d.id]['640x360']);
    }
    // The 1080p numbers follow from the scale: 640x360 is 3/4 as tall as 480x270 on the same screen, to the pixel.
    const big = rows.find((r) => r.display === '1080p' && r.size === '480x270');
    const small = rows.find((r) => r.display === '1080p' && r.size === '640x360');
    expect((small?.dialogCapPx as number) * 4).toBe((big?.dialogCapPx as number) * 3);
    expect((small?.punkPx as number) * 4).toBe((big?.punkPx as number) * 3);

    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      writeFileSync(join(SHOTS, 'measurements.json'), `${JSON.stringify({ glyphs, character, rows }, null, 1)}\n`);
    }
  });

  test('saves the pictures Mark looks at (only with SJEMOCK_SHOTS=<folder>)', async ({ browser }) => {
    test.skip(!SHOTS, 'set SJEMOCK_SHOTS=<folder> to write the pictures');
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    const report: Record<string, unknown> = {};
    for (const [k, c] of captures) {
      const [s, d, z] = k.split('|');
      writeFileSync(join(SHOTS, `${s}-${d}-${z}.png`), c.png);
      report[k] = { region: c.region, k: c.k, facts: c.facts };
    }
    for (const [k, c] of extras) {
      const [s, d, z, tag] = k.split('|');
      writeFileSync(join(SHOTS, `extra-${s}-${d}-${z}-${tag}mode.png`), c.png);
      report[k] = { region: c.region, k: c.k, facts: c.facts };
    }
    writeFileSync(join(SHOTS, 'report.json'), `${JSON.stringify(report, null, 1)}\n`);

    /** The area of each screen that is drawn for 480x270 and so is not the whole picture at 640x360. Game pixels of the 640x360 picture. */
    const notes: Partial<Record<ScreenId, SideNote[]>> = {
      battle: [{ box: { x: 0, y: 0, w: 480, h: 270 }, label: 'laid out for 480x270: backdrop, floor and figures are placed for this area' }],
      '3d': [{ box: { x: 0, y: 253, w: 640, h: 17 }, label: 'caption bar: laid out for 480x270' }],
    };
    const titles: Record<ScreenId, string> = {
      field: 'FIELD: Lantern Row, the shipped game (old engine)',
      dialog: 'DIALOG: a line in the field, the shipped dialog window (old engine)',
      battle: 'BATTLE: the stage slice (new engine)',
      '3d': '3D: the minimal technical test scene (new engine)',
    };
    for (const d of DISPLAYS) {
      for (const s of SCREENS) {
        const left = captures.get(key(s, d.id, '480x270')) as Capture;
        const right = captures.get(key(s, d.id, '640x360')) as Capture;
        const bars = (c: Capture, w: number, h: number): string => (c.region.x > 0 || c.region.y > 0 ? `, bars ${c.region.x}px sides / ${c.region.y}px top and bottom` : `, fills the screen (${w}x${h})`);
        const png = await sideBySide(browser, left, right, {
          title: `${titles[s]} on ${d.label}`,
          leftCaption: `480x270 at ${left.k}x${bars(left, d.width, d.height)}`,
          rightCaption: `640x360 at ${right.k}x${bars(right, d.width, d.height)}`,
          rightNotes: notes[s] ?? [],
        });
        writeFileSync(join(SHOTS, `sidebyside-${s}-${d.id}.png`), png);
      }
    }
    // The extra: the shipped Fit mode on the Deck window.
    const l = extras.get('field|deck|480x270|fit') as Capture;
    const r = extras.get('field|deck|640x360|fit') as Capture;
    const f = (c: Capture): string => `${Number((c.region.w / (c === l ? 480 : 640)).toFixed(3))}x`;
    writeFileSync(
      join(SHOTS, 'extra-sidebyside-field-deck-fitmode.png'),
      await sideBySide(browser, l, r, { title: 'EXTRA: the game’s default Fit mode on a Steam Deck window (not part of the exactness line)', leftCaption: `480x270 at ${f(l)} (fractional: the browser resamples)`, rightCaption: `640x360 at ${f(r)}` }),
    );
    expect(readFileSync(join(SHOTS, 'report.json'), 'utf8').length).toBeGreaterThan(100);
  });
});
