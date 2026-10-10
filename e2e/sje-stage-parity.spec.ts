/**
 * The battle stage on the Shadow Jog Engine (/sjestage.html), checked in a real browser: the PARITY HARNESS of milestone M3 (docs/engine/m3-brief.md
 * task 10, decision 1a). It started as the spike's e2e/sjestage.spec.ts (docs/spikes/engine-platform.md, exit criterion 7) and was promoted in M3.
 *
 * REGRESSION PARITY. The Phaser spike has no 640x360 stage, so it cannot be the reference at 640x360. The reference frames (the goldens in
 * tests/fixtures/sjestage) are the Phaser spike's own 480x270 pictures. The stage is laid out in the 480x270 numbers of the stage JSONs inside the top left of
 * the 640x360 picture, so the harness reads that corner and compares it with the goldens, pixel for pixel: 0 pixels outside the renderer mask, at most 1/255 inside
 * it. The rest of the 640x360 picture must be the void color. The 640x360 layout is judged by Mark from pictures, then pinned as new goldens (decision 1b).
 *
 * What it checks, and where the rule comes from:
 *  - the INPUTS are pinned (cleanup C2): the SHA-256 of every data file the slice reads is in the manifest, and a changed file fails first with the command that makes the references again;
 *  - parity: the engine's frame against the goldens at three ticks, and a depth-haze frame (cleanup C3), for the stand-in crew (what CI has) and,
 *    on Mark's machine, for his sprites. The loose line: no pixel differs by more than 2/255 in any channel, and at most 3% of the pixels
 *    differ at all. The STRICT regression gate (cleanup C1): exact outside the renderer-dependent glow pixels, with negative controls in the real scene
 *    (a 2/255 step, a one-pixel move of a shadow, a ring or a body). The numbers are printed and attached to the test report. A diff picture is saved when `SJESTAGE_SHOTS=<folder>` is set;
 *  - the design: depth order (a nearer figure draws over a farther one, the parts of a figure sort inside it), the feet where the stage
 *    config puts them, the origin on the feet, the mirrored enemy, the hero's idle frame chosen from the tick;
 *  - crispness: at every whole zoom every k-by-k block of the canvas is one flat color, at device pixel ratios 1 to 2.25, with the effects off and with the whole effect stack on (M3 pass line 5);
 *  - determinism: the same tick, the same seed and the same sprite mode give the same pixel hash on two page loads, and however the ticks
 *    are split; a different seed gives a different floor;
 *  - stability: the picture changes at exactly the ticks where the idle animation says it should, so nothing flickers;
 *  - leaks: textures and GL objects are flat over restarts of the scene; context loss and restore.
 *
 * Run it:  npx playwright test e2e/sje-stage-parity.spec.ts --reporter=line
 *          CI=1 npx playwright test e2e/sje-stage-parity.spec.ts   (the bundled Chromium on software GL, like CI; PW_NOGPU=1 does it with Edge)
 *          SJESTAGE_SHOTS=<folder> saves the engine, reference and diff pictures.
 *          SJESTAGE_REFS=<folder> adds the frames of Mark's art (made by `node scripts/sjestage-refs.mjs --out <folder>`).
 *          STAGELAB_NO_SPRITES=1 pretends Mark's folder is missing (what CI sees): the page uses the stand-ins.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { depthFor, enemySlots, loadStages, loadHud, slotPoint, type StageConfig } from '../src/battlestage/config';
import { enemyIdle, idleFrame } from '../src/battlestage/idle';
import { zoomFor } from './sjelabkit';
import {
  assertInputsPinned,
  committedFrames,
  compareFrames,
  describeParity,
  describeStrict,
  encodePng,
  FIXTURES,
  type FrameKind,
  H,
  HAVE_ART,
  inputFiles,
  openStage,
  PARITY_MAX_CHANNEL,
  PARITY_MAX_PERCENT,
  readCommitted,
  readReference,
  referenceName,
  rendererKind,
  readSlice,
  ROOT,
  type SpriteMode,
  savePicture,
  strictCompare,
  SIZE,
  strictMask,
  W,
  withStage,
} from './sjestagekit';
import { STAGE_KNOWN } from '../src/battlestage/known';

const SLICE = readSlice();

/** `STAGELAB_NO_SPRITES=1` pretends Mark's folder is missing, the way a CI checkout has it. The page is then opened with ?standins, which is what it would choose by itself. */
const PRETEND_NO_ART = !!process.env.STAGELAB_NO_SPRITES;
const ART_HERE = HAVE_ART && !PRETEND_NO_ART;

/** One viewport per device pixel ratio (the same windows as e2e/sjelab.spec.ts). The integer zoom of each is worked out by the presenter's own rule (`zoomFor`). */
const WINDOWS = [
  { dpr: 1, viewport: { width: 1920, height: 1080 } },
  { dpr: 1.25, viewport: { width: 1600, height: 900 } },
  { dpr: 1.5, viewport: { width: 1300, height: 730 } },
  { dpr: 1.75, viewport: { width: 1100, height: 620 } },
  { dpr: 2, viewport: { width: 960, height: 540 } },
  { dpr: 2.25, viewport: { width: 1600, height: 900 } },
];

/** The stage as the game reads it (the same loader the page uses), for checks that compare the display list with the config. */
function shippedStage(seed?: number): StageConfig {
  const json = (name: string): unknown => JSON.parse(readFileSync(join(ROOT, 'src', 'data', name), 'utf8'));
  // (No list of backdrop ids here: it lives in the art code, which needs a browser. The page checks the ids when it loads the file.)
  const file = loadStages(json('stages.json'), undefined, STAGE_KNOWN, loadHud(json('hud.json')));
  const stage = file[SLICE.stageId];
  if (!stage) throw new Error(`no stage ${SLICE.stageId}`);
  return seed === undefined ? stage : { ...stage, floor: { ...stage.floor, seed } };
}

const rgba = (base64: string): Buffer => Buffer.from(base64, 'base64');

/** Show the slice at a tick in a mode and read the back buffer. */
async function frameAt(page: Page, tick: number, sprites: SpriteMode, seed = SLICE.seed, frame: FrameKind = 'slice'): Promise<Buffer> {
  const got = await page.evaluate(async ([t, s, sd, fr]) => {
    const h = window.__SJESTAGE__;
    if (!h) throw new Error('no hook');
    await h.show({ tick: t as number, sprites: s as 'standins' | 'art', seed: sd as number, frame: fr as 'slice' | 'haze' });
    return h.pixels();
  }, [tick, sprites, seed, frame] as const);
  expect([got.w, got.h]).toEqual([SIZE.w, SIZE.h]);
  return cornerOf(rgba(got.base64), got.w);
}

/** The top left 480x270 of a 640x360 picture: the part the goldens cover (the stage is laid out there, M3 decision 1a). */
function cornerOf(full: Buffer, fullW: number): Buffer {
  const out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) full.copy(out, y * W * 4, y * fullW * 4, (y * fullW + W) * 4);
  return out;
}

test.describe('stage lab: boot', () => {
  test('boots on WebGL2 with zero console errors and warnings, and says which renderer drew it and which crew pictures it uses', async ({ browser }) => {
    await withStage(
      browser,
      async ({ page, problems }) => {
        // Nothing has read a pixel yet: no console error, no warning, none allowed.
        expect(problems, 'console errors and warnings during boot').toEqual([]);
        const info = await page.evaluate(() => window.__SJESTAGE__?.info());
        console.log(`SJESTAGE renderer: ${info?.renderer} | ${info?.version} | k=${info?.k} dpr=${info?.dpr} | sprites ${info?.sprites} | Mark's art here: ${info?.haveArt}`);
        expect(info?.w).toBe(SIZE.w);
        expect(info?.h).toBe(SIZE.h);
        // The page uses Mark's art when it is there, and the stand-ins on a machine without it (CI), unless it was told otherwise.
        expect(info?.haveArt).toBe(ART_HERE);
        expect(info?.sprites).toBe(ART_HERE ? 'art' : 'standins');
        // One scene, with two figures: Kit and the punk.
        const figures = await page.evaluate(() => window.__SJESTAGE__?.figures());
        expect(figures?.map((f) => f.id)).toEqual([...SLICE.lineup, ...SLICE.enemies.map((e, i) => `${e}#${i}`)]);
      },
      // STAGELAB_NO_SPRITES=1 shows the page what CI shows it: no sprite folder at all, and no ?standins to tell it so.
      { query: 'manual', hideArt: PRETEND_NO_ART },
    );
  });

  test('without Mark’s sprite folder (every request for it answered with the app’s own page, as Vite does) the page finds that out by itself, uses the stand-ins and logs nothing', async ({ browser }) => {
    const lab = await openStage(browser, { query: 'manual', hideArt: true });
    try {
      expect(lab.problems, 'console errors and warnings').toEqual([]);
      const info = await lab.page.evaluate(() => window.__SJESTAGE__?.info());
      expect(info?.haveArt).toBe(false);
      expect(info?.sprites).toBe('standins');
      // Asking for his art there is a readable error, not a blank picture.
      const message = await lab.page.evaluate(() => window.__SJESTAGE__?.show({ sprites: 'art' }).then(() => 'no error', (e: Error) => e.message));
      expect(message).toContain('not on this machine');
      // The picture is the one the ?standins page draws.
      const hidden = await lab.page.evaluate(() => window.__SJESTAGE__?.show({ tick: 41, sprites: 'standins' }));
      await withStage(
        browser,
        async ({ page }) => {
          expect(await page.evaluate(() => window.__SJESTAGE__?.show({ tick: 41, sprites: 'standins' }))).toBe(hidden);
        },
        { query: 'manual&standins' },
      );
    } finally {
      await lab.close();
    }
  });

  test('the picture is not blank, and nothing is drawn over the canvas', async ({ browser }) => {
    await withStage(browser, async ({ page }) => {
      const px = rgba((await page.evaluate(() => window.__SJESTAGE__?.pixels()))?.base64 ?? '');
      const colours = new Set<number>();
      for (let i = 0; i < px.length; i += 4) colours.add(px.readUInt32LE(i));
      // A backdrop with fighters has hundreds of colours; one flat colour or a handful means a blank or failed draw.
      expect(colours.size).toBeGreaterThan(100);
      let transparent = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) transparent++;
      expect(transparent, 'every pixel of the back buffer is opaque').toBe(0);
    });
  });
});

/** The frames of the parity set: the slice at its three ticks, and the haze frame (C3). */
const PARITY_FRAMES: Array<{ frame: FrameKind; ticks: readonly number[] }> = [
  { frame: 'slice', ticks: SLICE.ticks },
  { frame: 'haze', ticks: SLICE.haze.ticks },
];

test.describe('stage lab: parity with the Phaser spike (exit criterion 7)', () => {
  // C2: this runs FIRST. When Mark has edited a design file (or a rig file) since the references were made, every pixel test below would fail with numbers
  // that say nothing. This one says what changed and how to make the references again. (Each pixel test calls the same check before it compares anything.)
  for (const kind of ['gpu', 'soft'] as const) {
    test(`the inputs of the references are pinned (${kind} set): every data file the slice reads is the one the references were made with`, () => {
      assertInputsPinned(kind);
    });
  }

  const modes: SpriteMode[] = ['standins', 'art'];
  for (const { frame, ticks } of PARITY_FRAMES) {
    for (const mode of modes) {
      for (const tick of ticks) {
        test(`${mode}, ${frame} frame, tick ${tick}: no pixel differs by more than ${PARITY_MAX_CHANNEL}/255 and at most ${PARITY_MAX_PERCENT}% differ (exit criterion), and the STRICT regression gate: exact outside the renderer-dependent pixels`, async ({ browser }, testInfo) => {
          test.skip(mode === 'art' && !ART_HERE, "Mark's sprite folder is not here, so his art cannot be shown (the stand-in numbers are the CI line)");
          await withStage(browser, async ({ page }) => {
            const kind = await rendererKind(page);
            // C2: before any pixel is compared.
            assertInputsPinned(kind);
            const ref = readReference(mode, kind, tick, frame);
            test.skip(ref === null, `no ${kind} reference frame for ${mode} ${frame} tick ${tick}: run node scripts/sjestage-refs.mjs --out <folder>${kind === 'soft' ? ' --no-gpu' : ''} and set SJESTAGE_REFS=<folder>`);
            if (!ref) return;
            const engine = await frameAt(page, tick, mode, SLICE.seed, frame);
            const parity = compareFrames(engine, ref);
            const strict = strictCompare(engine, ref, strictMask());
            const line = `${describeParity(`PARITY ${mode} ${frame} ${kind} t${tick}`, parity)} | ${describeStrict('STRICT', strict)}`;
            console.log(line);
            testInfo.annotations.push({ type: 'parity', description: line });
            const stem = `sjestage-${mode}-${kind}${frame === 'haze' ? '-haze' : ''}-t${tick}`;
            savePicture(`${stem}-engine.png`, encodePng(engine, W, H, 2));
            savePicture(`${stem}-ref.png`, encodePng(ref, W, H, 2));
            savePicture(`${stem}-diff.png`, encodePng(parity.diff, W, H, 2));
            expect(parity.maxDiff, `largest channel difference (samples ${JSON.stringify(parity.samples)})`).toBeLessThanOrEqual(PARITY_MAX_CHANNEL);
            expect(parity.pct, 'percent of pixels that differ at all').toBeLessThanOrEqual(PARITY_MAX_PERCENT);
            // C1: the regression gate. The measured parity is exactly 0, so anything else is a change somebody has to look at.
            expect(strict.ok, `strict gate: ${describeStrict('', strict)} samples ${JSON.stringify(strict.samples)}`).toBe(true);
          });
        });
      }
    }
  }

  test('the committed references are what the capture script says they are: made for THIS slice, four stand-in frames for each renderer kind (three ticks and the haze frame), opaque, not blank, and the hashes in the manifest match', async () => {
    for (const kind of ['gpu', 'soft'] as const) {
      const manifest = JSON.parse(readFileSync(join(FIXTURES, `manifest-${kind}.json`), 'utf8')) as { slice: unknown; kind: string; inputs: Record<string, string>; files: Record<string, { bytes: number; sha256: string }> };
      expect(manifest.slice, `manifest-${kind}.json was made for src/battlestage/slice.json as it is now (run scripts/sjestage-refs.mjs again if the slice changed)`).toEqual(SLICE);
      expect(manifest.kind).toBe(kind);
      expect(Object.keys(manifest.inputs).sort(), 'the manifest pins every input file in inputs.json').toEqual([...inputFiles()].sort());
      for (const { frame, tick } of committedFrames()) {
        const ref = readCommitted(kind, tick, frame);
        expect(ref, `the committed ${kind} stand-in reference for ${frame} tick ${tick} (tests/fixtures/sjestage)`).not.toBeNull();
        if (!ref) continue;
        expect(ref.length).toBe(W * H * 4);
        expect(createHash('sha256').update(ref).digest('hex'), `sha256 of ${kind} ${frame} tick ${tick}`).toBe(manifest.files[referenceName('standins', kind, tick, frame)]?.sha256);
        // A plain loop and ONE expect: 130,000 calls of expect() take minutes.
        const colours = new Set<number>();
        let transparent = 0;
        for (let i = 0; i < ref.length; i += 4) {
          if (ref[i + 3] !== 255) transparent++;
          colours.add(ref.readUInt32LE(i));
        }
        expect(transparent, `non-opaque pixels in the ${kind} reference for ${frame} tick ${tick}`).toBe(0);
        expect(colours.size).toBeGreaterThan(100);
      }
    }
  });

  test('the GPU and the software references differ from each other by 1/255 at most, on a few percent of the pixels: that is why there are two sets (the game’s own glow layer is painted by canvas code that is renderer dependent)', async () => {
    for (const { frame, tick } of committedFrames()) {
      const gpu = readCommitted('gpu', tick, frame);
      const soft = readCommitted('soft', tick, frame);
      expect(gpu && soft).toBeTruthy();
      if (!gpu || !soft) continue;
      const p = compareFrames(gpu, soft);
      console.log(describeParity(`GPU against SOFTWARE reference, ${frame} tick ${tick}`, p));
      expect(p.maxDiff).toBeLessThanOrEqual(1);
      expect(p.differing, 'the two kinds really do differ (otherwise one set would do)').toBeGreaterThan(0);
      // Where they differ is the street's glow layer (the shop windows and signs in the wall): 1,732 translucent pixels at 240x135, four pixels each at 480x270.
      expect(p.pct).toBeLessThan(5);
    }
  });

  test('the renderer mask of the strict gate is only the glow layer: a few percent of the picture, so the gate is exact nearly everywhere (it allows 1/255 inside the mask and nothing else)', async () => {
    const mask = strictMask();
    let count = 0;
    let lowest = 0;
    for (let p = 0; p < mask.length; p++)
      if (mask[p]) {
        count++;
        lowest = Math.max(lowest, Math.floor(p / W));
      }
    const horizon = shippedStage().backdrop.horizonY;
    // (The glow layer is the wall's neon plus its reflection in the floor just under the kerb, so the mask reaches a little below the horizon row.)
    console.log(`SJESTAGE strict mask: ${count} px (${((count / mask.length) * 100).toFixed(2)}%), the lowest row is ${lowest}, the horizon is row ${horizon}`);
    expect(count).toBeGreaterThan(0);
    expect(count / mask.length, 'the mask is a few percent of the picture at most').toBeLessThan(0.05);
  });

  test('NEGATIVE CONTROL (loose gate): the harness fails a frame that is wrong (a picture shifted one pixel, a colour off by 3)', async ({ browser }) => {
    await withStage(browser, async ({ page }) => {
      const ref = readReference('standins', await rendererKind(page), SLICE.ticks[1] ?? 0);
      expect(ref).not.toBeNull();
      if (!ref) return;
      const engine = await frameAt(page, SLICE.ticks[1] ?? 0, 'standins');
      // The real frame passes (the tests above). Shift the whole picture one pixel to the right: a nearly identical picture that is wrong.
      const shifted = Buffer.from(engine);
      for (let y = 0; y < H; y++) engine.copy(shifted, (y * W + 1) * 4, y * W * 4, (y * W + W - 1) * 4);
      const moved = compareFrames(shifted, ref);
      expect(moved.maxDiff > PARITY_MAX_CHANNEL || moved.pct > PARITY_MAX_PERCENT, `a picture shifted by one pixel is caught: ${describeParity('shifted', moved)}`).toBe(true);
      // A tint of 3/255 on every pixel is caught by the channel rule alone.
      const tinted = Buffer.from(engine);
      for (let i = 0; i < tinted.length; i += 4) tinted[i] = Math.min(255, (tinted[i] ?? 0) + 3);
      const off = compareFrames(tinted, ref);
      expect(off.maxDiff, 'a colour off by 3 is caught').toBeGreaterThan(PARITY_MAX_CHANNEL);
      // The measure itself: a picture compared with itself has no difference.
      expect(compareFrames(engine, Buffer.from(engine)).differing).toBe(0);
    });
  });

  test('NEGATIVE CONTROL (strict gate, C1): moving the SHADOW, the RING or the BODY of a figure by one pixel in the real scene fails the strict gate, and the unmoved scene passes it', async ({ browser }) => {
    await withStage(browser, async ({ page }) => {
      const kind = await rendererKind(page);
      const tick = SLICE.ticks[1] ?? 0;
      const ref = readReference('standins', kind, tick);
      expect(ref).not.toBeNull();
      if (!ref) return;
      const mask = strictMask();
      // Control for the control: the same scene, not moved, passes.
      const cleanFrame = await frameAt(page, tick, 'standins');
      const clean = strictCompare(cleanFrame, ref, mask);
      expect(clean.ok, describeStrict('unmoved', clean)).toBe(true);
      // A 2/255 step on one channel of every pixel (M3 pass line 4 control): outside the mask any difference fails, inside it only 1/255 is allowed.
      const stepped = Buffer.from(cleanFrame);
      for (let i = 0; i < stepped.length; i += 4) stepped[i] = Math.min(255, (stepped[i] ?? 0) + 2);
      const step2 = strictCompare(stepped, ref, mask);
      console.log(`SJESTAGE NEGATIVE CONTROL a 2/255 step: ${describeStrict('strict', step2)}`);
      expect(step2.ok, 'a 2/255 step on every pixel must fail the strict gate').toBe(false);
      // A 1/255 step inside the mask is the renderer's own noise and passes; outside it fails. Together they show the mask is what the gate relies on.
      const ones = Buffer.from(cleanFrame);
      for (let i = 0; i < ones.length; i += 4) ones[i] = Math.min(255, (ones[i] ?? 0) + 1);
      expect(strictCompare(ones, ref, mask).outside, 'a 1/255 step outside the mask fails').toBeGreaterThan(0);
      const kitId = SLICE.lineup[0] ?? 'kit';
      const punkId = `${SLICE.enemies[0] ?? 'rustfang_punk'}#0`;
      const cases: Array<[string, string, 'shadow' | 'ring' | 'body', number, number]> = [
        ['the hero shadow one pixel right', kitId, 'shadow', 1, 0],
        ['the hero shadow one pixel down', kitId, 'shadow', 0, 1],
        ['the hero ring one pixel left', kitId, 'ring', -1, 0],
        ['the hero body one pixel right', kitId, 'body', 1, 0],
        ['the punk body one pixel up', punkId, 'body', 0, -1],
        ['the punk shadow one pixel left', punkId, 'shadow', -1, 0],
      ];
      for (const [label, id, part, dx, dy] of cases) {
        await page.evaluate(([i, p, x, y]) => window.__SJESTAGE__?.nudge(i as string, p as 'shadow' | 'ring' | 'body', x as number, y as number), [id, part, dx, dy] as const);
        const wrong = cornerOf(rgba((await page.evaluate(() => window.__SJESTAGE__?.pixels()))?.base64 ?? ''), SIZE.w);
        const strict = strictCompare(wrong, ref, mask);
        const loose = compareFrames(wrong, ref);
        console.log(`SJESTAGE NEGATIVE CONTROL ${label}: ${describeStrict('strict', strict)} | ${describeParity('loose', loose)}`);
        expect(strict.ok, `${label} must fail the strict gate`).toBe(false);
        expect(strict.outside, `${label}: pixels outside the mask that moved`).toBeGreaterThan(0);
        // Put the scene right again for the next case.
        await page.evaluate((t) => window.__SJESTAGE__?.show({ tick: t, sprites: 'standins' }), tick);
      }
    });
  });
});

test.describe('stage lab: the stage is the design', () => {
  test('figures stand where the stage config puts them, and draw in the order of their feet (a nearer figure over a farther one)', async ({ browser }) => {
    await withStage(browser, async ({ page }) => {
      await page.evaluate(() => window.__SJESTAGE__?.show({ tick: 0, sprites: 'standins' }));
      const stage = shippedStage();
      const figures = (await page.evaluate(() => window.__SJESTAGE__?.figures())) ?? [];
      expect(figures).toHaveLength(2);
      const kit = figures[0];
      const punk = figures[1];
      if (!kit || !punk) throw new Error('two figures');
      // The feet: the config's slot, through the same function the stage uses (so a design edit in the editor does not break this test).
      const heroSlot = stage.party[0];
      const foeSlot = enemySlots(stage, SLICE.setKey)[0];
      if (!heroSlot || !foeSlot) throw new Error('slots');
      const heroFeet = slotPoint(stage, heroSlot);
      const foeFeet = slotPoint(stage, foeSlot);
      expect([kit.x, kit.y]).toEqual([heroFeet.x, heroFeet.y]);
      expect([punk.x, punk.y]).toEqual([foeFeet.x, foeFeet.y]);
      // The depth: the one number depthFor gives for the feet (rows apart by at least 14 px = 14,000, so a lower row always wins).
      expect(kit.depth).toBe(depthFor(heroFeet.y, heroFeet.x, 'party', heroSlot.order ?? 0));
      expect(punk.depth).toBe(depthFor(foeFeet.y, foeFeet.x, 'enemy', foeSlot.order ?? 0));
      // The draw order of the stage: the backdrop first, then the figures from the farthest feet to the nearest.
      const order = await page.evaluate(() => window.__SJESTAGE__?.drawOrder());
      const farFirst = [kit, punk].sort((a, b) => a.depth - b.depth).map((f) => `figure ${f.id}`);
      expect(order?.[0]).toMatch(/^crew|stage-street/);
      expect(order?.slice(1)).toEqual(farFirst);
      // The parts of a figure sort inside it: shadow, then ring, then the body.
      for (const f of [kit, punk]) expect(await page.evaluate((id) => window.__SJESTAGE__?.partOrder(id), f.id)).toEqual(['shadow', 'ring', 'body']);
      // The ring: cyan under the acting hero, amber under the target, both shown in the slice. The body sits one pixel below the feet row, the shadow too.
      expect(kit.ring.visible && punk.ring.visible).toBe(true);
      expect(kit.shadow.visible && punk.shadow.visible).toBe(true);
      expect([kit.body.y, punk.body.y]).toEqual([1, 1]);
    });
  });

  test('the haze frame (C3): every figure on a hazed row shows a hazed picture named after its row, the nearest row shows the plain one, and no ring exempts anybody', async ({ browser }) => {
    await withStage(browser, async ({ page }) => {
      await page.evaluate((t) => window.__SJESTAGE__?.show({ tick: t, sprites: 'standins', frame: 'haze' }), SLICE.haze.ticks[0] ?? 0);
      const stage = shippedStage();
      const tint = stage.depthTint;
      if (!tint) throw new Error('the street has no depth haze');
      const figures = (await page.evaluate(() => window.__SJESTAGE__?.figures())) ?? [];
      expect(figures.map((f) => f.id)).toEqual([...SLICE.haze.lineup, ...SLICE.haze.enemies.map((e, i) => `${e}#${i}`)]);
      const rows = [...stage.party.slice(0, SLICE.haze.lineup.length).map((s) => s.row), ...enemySlots(stage, SLICE.haze.setKey).map((s) => s.row)];
      let hazed = 0;
      figures.forEach((f, i) => {
        const amount = tint.amounts[rows[i] ?? 0] ?? 0;
        expect(f.ring.visible, `${f.id} has no ring in this frame`).toBe(false);
        if (amount > 0) {
          hazed++;
          expect(f.body.texture, `${f.id} on row ${rows[i]} is hazed by ${amount}`).toMatch(new RegExp(`^haze-.*-${Math.round(amount * 100)}$`));
        } else expect(f.body.texture, `${f.id} on row ${rows[i]} has no haze`).not.toMatch(/^haze-/);
      });
      // Four heroes and three enemies: the nearest row (haze 0) has Kit and the last punk, the other five are hazed.
      expect(hazed, 'figures with a haze').toBeGreaterThanOrEqual(5);
    });
  });

  test('the origin of a body is its feet; the punk is mirrored to face the hero, Kit is not; the hero shows the idle frame of the tick', async ({ browser }) => {
    await withStage(browser, async ({ page }) => {
      for (const tick of [0, 1, 7, 8, 41, 173, 480]) {
        await page.evaluate((t) => window.__SJESTAGE__?.show({ tick: t, sprites: 'standins' }), tick);
        const [kit, punk] = (await page.evaluate(() => window.__SJESTAGE__?.figures())) ?? [];
        if (!kit || !punk) throw new Error('two figures');
        // Stand-in sheets: 8 frames at 8 fps, the first hero starts at phase 0 (the spike's rule: phase = (index * 3) mod count).
        expect(kit.body.frame, `Kit's idle frame at tick ${tick}`).toBe(idleFrame(tick, 8, 8, 0));
        expect(kit.body.flipX).toBe(false);
        expect(punk.body.flipX, 'the punk art faces right, so it is flipped to face the hero (enemyfacing.json)').toBe(true);
        // The enemy's body moves with the tick: its idle motion is a function of the tick and its number (enemyIdle). Before the first tick it stands at its feet. The shadow stays on the floor.
        expect(punk.body.texture).toMatch(/^(haze-)?enemy-punk-0/);
        const sway = tick === 0 ? { x: 0, y: 0 } : enemyIdle(punk.idle as Parameters<typeof enemyIdle>[0], tick, 0);
        expect([punk.body.x, punk.body.y - 1], `the punk's idle (${punk.idle}) at tick ${tick}`).toEqual([sway.x, sway.y]);
        // Origins are the feet as a fraction of the picture, so they are whole pixels (the engine would have warned otherwise: no console problems).
        expect(kit.body.originX).toBeGreaterThan(0);
        expect(kit.body.originY).toBeGreaterThan(0.5);
      }
    });
  });

  test('a restart makes the same stage again, and the idle loop wraps (the frame at tick 60 is the frame at tick 0 plus 8)', async ({ browser }) => {
    await withStage(browser, async ({ page }) => {
      const frames: Array<string | number | undefined> = [];
      for (const tick of [0, 60]) {
        await page.evaluate((t) => window.__SJESTAGE__?.show({ tick: t, sprites: 'standins' }), tick);
        frames.push(((await page.evaluate(() => window.__SJESTAGE__?.figures())) ?? [])[0]?.body.frame);
      }
      // 8 frames at 8 fps is 8 frames a second: 60 ticks make a whole loop of 8, so tick 60 shows frame 0 again.
      expect(frames).toEqual([0, 0]);
    });
  });
});

test.describe('stage lab: determinism', () => {
  test('the same tick, seed and sprite mode give the same pixel hash on two page loads, and however the ticks are split', async ({ browser }) => {
    const runs: string[][] = [];
    for (let load = 0; load < 2; load++) {
      await withStage(browser, async ({ page }) => {
        const run: string[] = [];
        for (const t of [0, 1, 20, 41, 60, 95, 173, 600]) run.push((await page.evaluate((tick) => window.__SJESTAGE__?.show({ tick, sprites: 'standins' }), t)) ?? '');
        runs.push(run);
      });
    }
    expect(runs[0]).toEqual(runs[1]);
    // Different ticks make different pictures (so the equality above is not two blank frames), except where the idle loop wraps.
    expect(new Set(runs[0]).size, 'distinct pictures over the ticks').toBeGreaterThanOrEqual(4);
    // And the same tick reached in different ways: 1 x 173, and 173 x 1, and 3 pieces.
    await withStage(browser, async ({ page }) => {
      const whole = await page.evaluate(() => window.__SJESTAGE__?.show({ tick: 173, sprites: 'standins' }));
      await page.evaluate(() => window.__SJESTAGE__?.show({ tick: 0, sprites: 'standins' }));
      const ones = await page.evaluate(() => {
        let h = '';
        for (let i = 0; i < 173; i++) h = window.__SJESTAGE__?.step(1) ?? '';
        return h;
      });
      await page.evaluate(() => window.__SJESTAGE__?.show({ tick: 0, sprites: 'standins' }));
      const pieces = await page.evaluate(() => {
        window.__SJESTAGE__?.step(100);
        window.__SJESTAGE__?.step(60);
        return window.__SJESTAGE__?.step(13);
      });
      expect(ones).toBe(whole);
      expect(pieces).toBe(whole);
    });
  });

  test('the seed decides the floor (the same seed, the same picture; another seed, another floor) and the tick does not change it', async ({ browser }) => {
    await withStage(browser, async ({ page }) => {
      const hash = (seed: number) => page.evaluate((s) => window.__SJESTAGE__?.show({ tick: 0, sprites: 'standins', seed: s }), seed);
      const a = await hash(7);
      const b = await hash(7);
      const c = await hash(8);
      expect(b).toBe(a);
      expect(c).not.toBe(a);
      // Another floor seed moves only the floor decorations, not the figures: the pictures share their upper part (the wall).
      const wallA = cornerOf(rgba((await page.evaluate(async () => { await window.__SJESTAGE__?.show({ tick: 0, sprites: 'standins', seed: 7 }); return window.__SJESTAGE__?.pixels(); }))?.base64 ?? ''), SIZE.w);
      const wallC = cornerOf(rgba((await page.evaluate(async () => { await window.__SJESTAGE__?.show({ tick: 0, sprites: 'standins', seed: 8 }); return window.__SJESTAGE__?.pixels(); }))?.base64 ?? ''), SIZE.w);
      const horizon = shippedStage().backdrop.horizonY;
      const above = (px: Buffer): Buffer => px.subarray(0, (horizon - 4) * W * 4);
      expect(above(wallC).equals(above(wallA)), 'the wall above the horizon does not depend on the floor seed').toBe(true);
    });
  });

  test('the picture does not depend on the window: the back buffer hash is the same at every device pixel ratio and zoom', async ({ browser }) => {
    const hashes: string[] = [];
    for (const { dpr, viewport } of WINDOWS.filter((_, i) => i === 0 || i === 2 || i === 5)) {
      await withStage(
        browser,
        async ({ page }) => {
          hashes.push((await page.evaluate(() => window.__SJESTAGE__?.show({ tick: 41, sprites: 'standins' }))) ?? '');
        },
        { dpr, viewport },
      );
    }
    expect(new Set(hashes).size).toBe(1);
  });
});

test.describe('stage lab: the 480x270 layout inside the 640x360 frame (M3 decision 1a)', () => {
  // The slice is laid out in the 480x270 numbers of the stage JSONs, so it fills the top left 480x270 of the frame (the corner the goldens judge above). The 160 columns
  // and 90 rows around it must be one color, the void. A difference here means the stage reads the picture size somewhere it should not, or paints outside its own area.
  test('the picture is 640x360, and every pixel outside the top left 480x270 is the void color', async ({ browser }) => {
    await withStage(browser, async ({ page }) => {
      const got = await page.evaluate(async () => {
        const h = window.__SJESTAGE__;
        if (!h) throw new Error('no hook');
        await h.show({ tick: 41, sprites: 'standins' });
        return h.pixels();
      });
      expect([got.w, got.h]).toEqual([640, 360]);
      const px = rgba(got.base64);
      const corner = px.subarray((359 * 640 + 639) * 4, (359 * 640 + 639) * 4 + 4);
      let notVoid = 0;
      for (let y = 0; y < 360; y++) {
        for (let x = 0; x < 640; x++) {
          if (x < 480 && y < 270) continue;
          const i = (y * 640 + x) * 4;
          if (px.compare(corner, 0, 4, i, i + 4) !== 0) notVoid++;
        }
      }
      console.log(`SJESTAGE 640x360 frame: ${notVoid} of ${640 * 360 - 480 * 270} pixels outside the 480x270 corner are not the void color ${JSON.stringify([...corner])}`);
      expect(notVoid, 'pixels outside the 480x270 area that are not the void color').toBe(0);
      // The control: the corner is a real picture, not the void (a blank page would pass the test above).
      const colors = new Set<number>();
      for (let y = 0; y < 270; y++) for (let x = 0; x < 480; x++) colors.add(px.readUInt32LE((y * 640 + x) * 4));
      expect(colors.size, 'colors in the 480x270 corner').toBeGreaterThan(100);
    });
  });
});

test.describe('stage lab: crisp pixels at every zoom and device pixel ratio (the slice, effects off)', () => {
  for (const { dpr, viewport } of WINDOWS) {
    const k = zoomFor(viewport, dpr);
    test(`every ${k}x${k} block is one flat colour at device pixel ratio ${dpr}, window ${viewport.width}x${viewport.height} (the GL canvas, and a screenshot of the page)`, async ({ browser }) => {
      await withStage(
        browser,
        async ({ page }) => {
          const info = await page.evaluate(() => window.__SJESTAGE__?.info());
          expect(info?.k, 'integer zoom').toBe(k);
          // The idle loop moves the hero's frame and the punk's body: check several ticks, not one still picture.
          for (const tick of [0, 41, 173, 300]) {
            await page.evaluate((t) => window.__SJESTAGE__?.show({ tick: t, sprites: 'standins' }), tick);
            const blocks = await page.evaluate(() => window.__SJESTAGE__?.canvasBlocks());
            expect(blocks?.canvasW).toBe(SIZE.w * k);
            expect(blocks?.canvasH).toBe(SIZE.h * k);
            expect(blocks?.blocks).toBe(SIZE.w * SIZE.h);
            expect(blocks?.bad, `non-uniform ${k}x${k} blocks at tick ${tick}, dpr ${dpr}: ${JSON.stringify(blocks?.samples)}`).toBe(0);
          }
          // What the compositor shows: a screenshot of the page, with the picture's place in it.
          const pic = await page.evaluate(() => window.__SJESTAGE__?.picture());
          expect(pic?.k).toBe(k);
          expect(Number.isInteger(pic?.x) && Number.isInteger(pic?.y)).toBe(true);
          const shot = await page.screenshot();
          const url = `data:image/png;base64,${shot.toString('base64')}`;
          const region = { x: pic?.x ?? 0, y: pic?.y ?? 0, w: SIZE.w * k, h: SIZE.h * k };
          const blocks = await page.evaluate(([u, kk, r]) => window.__SJESTAGE__?.imageBlocks(u as string, kk as number, r as typeof region), [url, k, region]);
          expect(blocks?.blocks).toBe(SIZE.w * SIZE.h);
          expect(blocks?.bad, `non-uniform ${k}x${k} blocks in the screenshot at dpr ${dpr}: ${JSON.stringify(blocks?.samples)}`).toBe(0);
        },
        { dpr, viewport },
      );
    });
  }
});

test.describe('stage lab: stability (V4)', () => {
  test('the picture changes at exactly the ticks where the idle animation moves something, so nothing flickers', async ({ browser }) => {
    await withStage(browser, async ({ page }) => {
      await page.evaluate(() => window.__SJESTAGE__?.show({ tick: 0, sprites: 'standins' }));
      const TICKS = 240;
      const hashes = await page.evaluate((n) => {
        const h = window.__SJESTAGE__;
        if (!h) throw new Error('no hook');
        const out: string[] = [h.hash()];
        for (let i = 0; i < n; i++) out.push(h.step(1));
        return out;
      }, TICKS);
      // What the idle animation says: Kit's frame is a function of the tick, and so is the punk's offset. Two rules, both exact:
      //  1. the picture NEVER changes at a tick where neither of them moved (nothing moves by itself);
      //  2. it ALWAYS changes where the punk moved (its offset is whole pixels, so a move is a different picture).
      // (Kit's own frame changes are not required to show: the stand-in sheet repeats pictures, frames 0 and 1 are the same block.)
      const [foe0] = ((await page.evaluate(() => window.__SJESTAGE__?.figures())) ?? []).slice(1);
      const punkIdle = (foe0?.idle ?? 'still') as Parameters<typeof enemyIdle>[0];
      let moved = 0;
      let flickers = 0;
      for (let t = 1; t <= TICKS; t++) {
        const heroChanged = idleFrame(t, 8, 8, 0) !== idleFrame(t - 1, 8, 8, 0);
        const a = enemyIdle(punkIdle, t, 0);
        const b = enemyIdle(punkIdle, t - 1, 0);
        const foeChanged = a.x !== b.x || a.y !== b.y;
        const changed = hashes[t] !== hashes[t - 1];
        if (!heroChanged && !foeChanged) expect(changed, `the picture changed at tick ${t}, where nothing moves`).toBe(false);
        if (foeChanged) expect(changed, `the punk moved at tick ${t} but the picture did not change`).toBe(true);
        if (changed) moved++;
        // A flicker is a picture that goes away and comes straight back (A, B, A) when the idle loop did not move there and back.
        if (t >= 2 && hashes[t] === hashes[t - 2] && hashes[t] !== hashes[t - 1]) flickers++;
      }
      expect(moved, 'the idle animation moves the picture').toBeGreaterThanOrEqual(10);
      // The hero's loop is 8 frames of 7.5 ticks and the punk sways slowly: neither goes A, B, A in two ticks.
      expect(flickers, 'pictures that flash away for one tick and come back').toBe(0);
    });
  });
});

test.describe('stage lab: scenes come and go without leaking', () => {
  test('texture keys and GL objects are flat over 10 restarts of the scene (after a warm-up), and a deliberate leak would show', async ({ browser }) => {
    await withStage(browser, async ({ page }) => {
      // Warm up: the first restarts make the cached pictures (stage, haze, shadow, ring), later ones find them again.
      await page.evaluate(() => window.__SJESTAGE__?.reenter(4));
      const before = await page.evaluate(() => ({ gl: window.__SJESTAGE__?.glCounts(), keys: window.__SJESTAGE__?.textureKeys().sort() }));
      await page.evaluate(() => window.__SJESTAGE__?.reenter(10));
      const after = await page.evaluate(() => ({ gl: window.__SJESTAGE__?.glCounts(), keys: window.__SJESTAGE__?.textureKeys().sort() }));
      console.log(`SJESTAGE GL counts: before ${JSON.stringify(before.gl)} after 10 restarts ${JSON.stringify(after.gl)}`);
      expect(after.keys, 'the texture list is unchanged').toEqual(before.keys);
      expect(after.gl, 'GL object counts are unchanged').toEqual(before.gl);
      // The negative control: a deliberate leak of 6 textures MUST show up in the same counts.
      await page.evaluate(() => window.__SJESTAGE__?.leakOnPurpose(6));
      const leaked = await page.evaluate(() => window.__SJESTAGE__?.glCounts());
      console.log(`SJESTAGE GL counts after a deliberate leak of 6 textures ${JSON.stringify(leaked)}`);
      expect(leaked?.texture, 'the control leak shows in the GL texture count').toBeGreaterThanOrEqual((after.gl?.texture ?? 0) + 6);
    });
  });

  test('changing the seed and the sprite mode repeatedly leaves one stage picture and one set of crew pictures', async ({ browser }) => {
    await withStage(browser, async ({ page }) => {
      for (const seed of [7, 8, 9, 7, 8]) await page.evaluate((s) => window.__SJESTAGE__?.show({ tick: 3, seed: s, sprites: 'standins' }), seed);
      const keys = (await page.evaluate(() => window.__SJESTAGE__?.textureKeys())) ?? [];
      expect(keys.filter((k) => k.startsWith('stage-')), 'only the current stage picture is kept').toHaveLength(1);
      // The shadow and ring pictures are made on demand from numbers: one of each size the figures use now, no more.
      expect(keys.filter((k) => k.startsWith('shadow-')).length).toBeLessThanOrEqual(2);
      expect(keys.filter((k) => k.startsWith('ring-')).length).toBeLessThanOrEqual(2);
    });
  });

  test('a lost WebGL context comes back with the same picture (the textures are canvases, uploaded again)', async ({ browser }) => {
    await withStage(
      browser,
      async ({ page }) => {
        const before = await page.evaluate(() => window.__SJESTAGE__?.show({ tick: 41, sprites: 'standins' }));
        await page.evaluate(() => window.__SJESTAGE__?.loseContext());
        expect(await page.evaluate(() => window.__SJESTAGE__?.contextLost())).toBe(true);
        await page.evaluate(() => window.__SJESTAGE__?.restoreContext());
        expect(await page.evaluate(() => window.__SJESTAGE__?.contextLost())).toBe(false);
        await page.evaluate(() => window.__SJESTAGE__?.render());
        expect(await page.evaluate(() => window.__SJESTAGE__?.hash())).toBe(before);
        // And the scene keeps running after it.
        const after = await page.evaluate(() => window.__SJESTAGE__?.step(1));
        expect(after).toBeTruthy();
      },
    );
  });
});

test.describe('stage lab: crisp pixels with the whole effect stack on (M3 pass line 5)', () => {
  // The same count as above, with the effects at `full` and every kind of effect alive over the stage: shocks, haze, glitches, particles. The composite filter
  // works at game resolution inside the back buffer, so no block may be uneven. At device pixel ratio 1 and 1.5.
  for (const { dpr, viewport } of WINDOWS.filter((_, i) => i === 0 || i === 2)) {
    const k = zoomFor(viewport, dpr);
    test(`device pixel ratio ${dpr}: every ${k}x${k} block is one flat color with the effect stack on; a wrong ratio finds uneven blocks (control)`, async ({ browser }) => {
      await withStage(
        browser,
        async ({ page }) => {
          for (const tick of [0, 41, 173]) {
            await page.evaluate((t) => window.__SJESTAGE__?.show({ tick: t, sprites: 'standins' }), tick);
            const plain = await page.evaluate(() => window.__SJESTAGE__?.hash());
            const alive = await page.evaluate(() => window.__SJESTAGE__?.fxRaise(10));
            expect(await page.evaluate(() => window.__SJESTAGE__?.hash()), 'the effects change the picture (the test is not looking at a plain stage)').not.toBe(plain);
            expect(alive?.level, 'the effects run at full').toBe('full');
            expect((alive?.shocks ?? 0) + (alive?.hazes ?? 0) + (alive?.glitches ?? 0), `the effects are alive at tick ${tick}`).toBeGreaterThanOrEqual(2);
            expect(alive?.particles, 'particles are alive').toBeGreaterThan(0);
            const blocks = await page.evaluate(() => window.__SJESTAGE__?.canvasBlocks());
            expect(blocks?.k).toBe(k);
            expect(blocks?.blocks).toBe(SIZE.w * SIZE.h);
            expect(blocks?.bad, `uneven ${k}x${k} blocks with the stack on at tick ${tick}, dpr ${dpr}: ${JSON.stringify(blocks?.samples)}`).toBe(0);
            // The control: count blocks one device pixel bigger than the zoom. They straddle the game pixels, so some must be uneven.
            const wrong = await page.evaluate(() => window.__SJESTAGE__?.canvasBlocks(true));
            expect(wrong?.bad, 'control: a wrong ratio finds uneven blocks').toBeGreaterThan(0);
            await page.evaluate(() => window.__SJESTAGE__?.fxClear());
          }
        },
        { dpr, viewport, query: 'manual&fx=full' },
      );
    });
  }
});
