/**
 * Goldens of the DEFAULT path (M6 pass line 12, docs/engine/m6-brief.md): the game as a player gets it, on the Pixi engine with no flag. Four states, one picture each:
 * the title, the field (`rustyard`), a battle, and the Options screen. Each is a screenshot of the whole window at 1280x720 (the game at zoom 2), the same unit as the M5
 * parity harness (`e2e/sjefieldparity.ts`, docs/engine/tooling-and-testing.md section 5).
 *
 * What this guards. The M5 references were pictures of the OLD path; M6 deleted that path, so those cannot be made again. These references are pictures of the NEW path, made
 * once at M6. From now on a change that moves a pixel of these four screens fails here, and the author looks at the diff (`DEFAULTPATH_SHOTS=<folder>`) and either fixes the
 * change or makes the references again on purpose.
 *
 * Method (the M5 one, with the new path on both sides):
 *  - one fresh page per state, with a fake paused clock and a seeded `Math.random` (`openGame({ fakeClock: true })`), run to an exact scene tick (`settleTo`), so the picture
 *    is the same every time;
 *  - the reference is chosen by the kind of renderer: `soft` (SwiftShader, what CI runs: the references of this folder are committed) or `gpu` (a hardware browser: local only, not
 *    committed, `tests/fixtures/defaultpath/gpu` is git-ignored). A kind with no reference skips (it says so);
 *  - the gate is the measured bounds of `BOUNDS`, as in M5: the largest step in any channel, and the fraction of pixels that differ by 2/255 or more and by 4/255 or more;
 *  - controls that must FAIL the gate: a 2/255 step over the whole picture, and a one-pixel move (the leader of the field moved by one pixel in the game, and the whole picture
 *    moved by one game pixel for every state).
 *
 * Make the references (once, after a change that is meant to change a picture; it overwrites them):
 *   M6_REFS=1 CI=1 PW_PORT=3012 npx playwright test e2e/default-path.spec.ts --reporter=line     (the bundled Chromium on SwiftShader: the `soft` set, committed)
 *   M6_REFS=1 PW_PORT=3012 npx playwright test e2e/default-path.spec.ts --reporter=line          (Edge on a GPU: the `gpu` set, local)
 * Run it:  CI=1 PW_PORT=3012 npx playwright test e2e/default-path.spec.ts --reporter=line
 *          DEFAULTPATH_SHOTS=<folder> ...   also saves the new picture, the reference and a diff picture of every state.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { encodePng } from '../scripts/lib/png.mjs';
import { advance, decode, type GamePage, openGame, sj } from './sjegamekit';
import { CASES, rendererKind, shoot, VIEWPORT } from './sjefieldkit';
import { describeMeasure, H, measure, type Measure, type Picture, type RendererKind, unevenBlocks, W, withStep } from './sjefieldparity';

const REFS = process.env.M6_REFS === '1';
const SHOTS = process.env.DEFAULTPATH_SHOTS;
const ROOT = join(import.meta.dirname, '..');
const DIR = join(ROOT, 'tests', 'fixtures', 'defaultpath');
const ZOOM = 2;

const IDS = ['title', 'rustyard', 'battle', 'options'] as const;
type Id = (typeof IDS)[number];

/** The tick of each scene the picture is taken at: after the title's own fade-in, and after the intro of the battle. */
const TICK: Record<Exclude<Id, 'rustyard'>, number> = { title: 120, battle: 300, options: 60 };

/**
 * The bounds of the gate, per kind of renderer. Measured on 2026-10-10: two runs of the same code on the same renderer (the bundled Chromium on SwiftShader) drew all four states with 0
 * differing pixels. So the bound is not room for the game: it allows the renderer's own rounding (1/255 in any pixel, on another machine) and nothing more. No pixel may be 2/255 or more away.
 * A 2/255 step moves every pixel by 2; the whole picture one game pixel to the right changes 17% to 63% of the pixels by 4/255 or more (the largest step is 236/255 or more); the leader
 * of the field one pixel off changes its sprite. All of them fail with a wide margin (the controls below print the numbers). Whether Linux SwiftShader on CI agrees with references made on
 * Windows is not known until the first CI run (the same open question as M5's `sje-field-parity.spec.ts`): if it does not, widen `max` and say why here.
 */
const BOUNDS: Record<RendererKind, { max: number; ge2: number; ge4: number }> = {
  soft: { max: 1, ge2: 0, ge4: 0 },
  gpu: { max: 1, ge2: 0, ge4: 0 },
};

/** The ways a measurement is outside the bounds of its kind (empty: inside). */
function outsideBounds(kind: RendererKind, m: Measure): string[] {
  const b = BOUNDS[kind];
  const out: string[] = [];
  if (m.max > b.max) out.push(`the largest step is ${m.max}/255, the bound is ${b.max}`);
  if (m.ge2 > b.ge2 * m.pixels) out.push(`${m.ge2} px differ by 2/255 or more, the bound is ${Math.floor(b.ge2 * m.pixels)}`);
  if (m.ge4 > b.ge4 * m.pixels) out.push(`${m.ge4} px differ by 4/255 or more, the bound is ${Math.floor(b.ge4 * m.pixels)}`);
  return out;
}

/** The picture moved right by `game` game pixels (the one-pixel move control for the states that have no actor to nudge); the columns that come in from the left are black. */
function shifted(p: Picture, gamePx: number): Picture {
  const d = gamePx * ZOOM;
  const data = new Uint8Array(p.data.length);
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const to = (y * p.w + x) * 4;
      if (x - d < 0) {
        data.set([0, 0, 0, 255], to);
        continue;
      }
      const from = (y * p.w + (x - d)) * 4;
      data[to] = p.data[from] ?? 0;
      data[to + 1] = p.data[from + 1] ?? 0;
      data[to + 2] = p.data[from + 2] ?? 0;
      data[to + 3] = p.data[from + 3] ?? 255;
    }
  }
  return { w: p.w, h: p.h, data };
}

const refPath = (kind: RendererKind, id: Id): string => join(DIR, kind, `${id}.png`);

function readRef(kind: RendererKind, id: Id): Picture | null {
  const path = refPath(kind, id);
  if (!existsSync(path)) return null;
  const d = decode(readFileSync(path));
  return { w: d.w, h: d.h, data: d.data };
}

/** Write the browser's own PNG bytes (small and exactly what was compared). */
function writeRef(kind: RendererKind, id: Id, png: Buffer): void {
  mkdirSync(join(DIR, kind), { recursive: true });
  writeFileSync(refPath(kind, id), png);
}

function saveShots(name: string, now: Picture, ref: Picture): void {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const diff = new Uint8Array(now.data.length);
  for (let i = 0; i < now.data.length; i += 4) {
    const d = Math.max(Math.abs((now.data[i] ?? 0) - (ref.data[i] ?? 0)), Math.abs((now.data[i + 1] ?? 0) - (ref.data[i + 1] ?? 0)), Math.abs((now.data[i + 2] ?? 0) - (ref.data[i + 2] ?? 0)));
    diff.set(d === 0 ? [(ref.data[i] ?? 0) >> 2, (ref.data[i + 1] ?? 0) >> 2, (ref.data[i + 2] ?? 0) >> 2, 255] : [255, 0, 96, 255], i);
  }
  writeFileSync(join(SHOTS, `${name}-new.png`), encodePng(now.w, now.h, now.data));
  writeFileSync(join(SHOTS, `${name}-ref.png`), encodePng(ref.w, ref.h, ref.data));
  writeFileSync(join(SHOTS, `${name}-diff.png`), encodePng(now.w, now.h, diff));
}

/** Step the fake clock until a counter of the page reads `target` (far away: jump most of the way, then one frame at a time). Throws when it jumps past. */
async function settleTo(page: Page, counter: string, target: number): Promise<void> {
  for (let guard = 0; guard < 600; guard++) {
    const f = await sj<number>(page, counter);
    if (f === target) return;
    if (f > target) throw new Error(`${counter} is ${f}, past the ${target} asked for`);
    const left = target - f;
    await advance(page, left > 12 ? Math.floor((left - 8) * 16.6) : 16);
  }
  throw new Error(`${counter} did not reach ${target}`);
}

/** Step the fake clock in small turns until `expr` holds (the game starts and loads its chunks in real time while the fake clock is paused). */
async function runUntil(page: Page, expr: string, label: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (await sj<boolean>(page, `!!(${expr})`).catch(() => false)) return;
    await advance(page, 100);
    await page.waitForTimeout(20);
  }
  throw new Error(`the page did not reach: ${label}`);
}

/** A key press on the fake clock: down, a few frames, up, a few frames. */
async function tap(page: Page, key: string, times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.keyboard.down(key);
    await advance(page, 50);
    await page.keyboard.up(key);
    await advance(page, 50);
  }
}

interface Taken {
  picture: Picture;
  png: Buffer;
  uneven: number;
  page: GamePage;
}

async function take(g: GamePage): Promise<Taken> {
  const png = await g.page.screenshot();
  const d = decode(png);
  const picture: Picture = { w: d.w, h: d.h, data: d.data };
  if (picture.w !== W * ZOOM || picture.h !== H * ZOOM) throw new Error(`the window is ${picture.w}x${picture.h}, expected ${W * ZOOM}x${H * ZOOM}`);
  return { picture, png, uneven: unevenBlocks(picture, ZOOM), page: g };
}

/** Open the default page on a fake clock and run it to the title. */
async function openTitle(browser: Browser): Promise<GamePage> {
  const g = await openGame(browser, { fakeClock: true, viewport: VIEWPORT });
  try {
    await runUntil(g.page, 'sj.top() === "TitleScene"', 'the title');
    return g;
  } catch (e) {
    await g.close();
    throw e;
  }
}

/** The one state that has an actor to nudge: the field (the leader moves by `nudge` pixels). */
async function capture(browser: Browser, id: Id, nudge?: { px: number; py: number }): Promise<Taken> {
  if (id === 'rustyard') {
    const c = CASES.find((x) => x.id === 'rustyard');
    if (!c) throw new Error('no case rustyard in tests/fixtures/sjefield/cases.json');
    const s = await shoot(browser, c, nudge ? { nudge } : {});
    return { picture: s.picture, png: s.png, uneven: s.uneven, page: s.page };
  }
  const g = await openTitle(browser);
  try {
    if (id === 'title') {
      await settleTo(g.page, 'sj.game.top.t', TICK.title);
    } else if (id === 'options') {
      await settleTo(g.page, 'sj.game.top.t', 30);
      await tap(g.page, 'Enter'); // press start
      await advance(g.page, 400);
      await tap(g.page, 'ArrowDown', 3); // New Game, Continue, Load, Options (a fresh browser has no saves)
      await tap(g.page, 'Enter');
      await runUntil(g.page, 'sj.top() === "OptionsScene"', 'the Options screen');
      await settleTo(g.page, 'sj.game.top.t', TICK.options);
    } else {
      await sj(g.page, "sj.stage('town')");
      await runUntil(g.page, 'sj.top() === "FieldScene" && sj.idle()', 'the field');
      await sj(g.page, "(sj.defineEncounter('m6golden', ['sewer_ghoul', 'rust_crab']), sj.battle('m6golden', 'sewer', false))");
      await runUntil(g.page, 'sj.top() === "BattleScene" && sj.battleStage !== null && sj.battleStage.figures.length > 0', 'the battle on its stage');
      await settleTo(g.page, 'sj.game.top.frame', TICK.battle);
    }
    return await take(g);
  } catch (e) {
    await g.close();
    throw e;
  }
}

test.describe('default path: pictures of the four screens', () => {
  test.setTimeout(240_000);
  for (const id of IDS) {
    test(`${id}: the picture equals its reference (or is made again with M6_REFS=1)`, async ({ browser }) => {
      const t = await capture(browser, id);
      try {
        const kind = await rendererKind(t.page.page);
        expect(t.page.problems).toEqual([]);
        expect(t.uneven, 'the picture is crisp: no 2x2 block is more than one color').toBe(0);
        if (REFS) {
          writeRef(kind, id, t.png);
          test.info().annotations.push({ type: 'M6_REFS', description: `wrote ${kind}/${id}.png` });
          return;
        }
        const ref = readRef(kind, id);
        test.skip(!ref, `no ${kind} reference for ${id}: make it with M6_REFS=1 (the soft set is committed, the gpu set is local)`);
        if (!ref) return;
        const m = measure(t.picture, ref);
        console.log(describeMeasure(`${kind} ${id}`, m));
        saveShots(`${kind}-${id}`, t.picture, ref);
        expect(outsideBounds(kind, m), describeMeasure(id, m)).toEqual([]);
      } finally {
        await t.page.close();
      }
    });
  }
});

test.describe('default path: the gate can fail (controls)', () => {
  test.setTimeout(240_000);
  for (const id of IDS) {
    test(`${id}: a 2/255 step and a one-pixel move are rejected`, async ({ browser }) => {
      test.skip(REFS, 'making the references');
      const t = await capture(browser, id);
      try {
        const kind = await rendererKind(t.page.page);
        const ref = readRef(kind, id);
        test.skip(!ref, `no ${kind} reference for ${id}`);
        if (!ref) return;
        // Control of the control: the real picture is inside the bounds, so each failure below comes from the change and nothing else.
        expect(outsideBounds(kind, measure(t.picture, ref))).toEqual([]);
        const stepped = measure(withStep(t.picture, 2), ref);
        console.log(describeMeasure(`${id} +2/255`, stepped));
        expect(outsideBounds(kind, stepped).length, 'a 2/255 step over the whole picture is rejected').toBeGreaterThan(0);
        const moved = measure(shifted(t.picture, 1), ref);
        console.log(describeMeasure(`${id} moved 1 game px`, moved));
        expect(outsideBounds(kind, moved).length, 'the whole picture one game pixel to the right is rejected').toBeGreaterThan(0);
      } finally {
        await t.page.close();
      }
    });
  }

  test('rustyard: the leader one pixel off, in the game, is rejected', async ({ browser }) => {
    test.skip(REFS, 'making the references');
    const t = await capture(browser, 'rustyard', { px: 1, py: 0 });
    try {
      const kind = await rendererKind(t.page.page);
      const ref = readRef(kind, 'rustyard');
      test.skip(!ref, `no ${kind} reference for rustyard`);
      if (!ref) return;
      const m = measure(t.picture, ref);
      console.log(describeMeasure('rustyard leader +1px', m));
      expect(outsideBounds(kind, m).length).toBeGreaterThan(0);
    } finally {
      await t.page.close();
    }
  });

  test('control of the harness: a state that is not the reference one is rejected (the title against the Options reference)', async ({ browser }) => {
    test.skip(REFS, 'making the references');
    const t = await capture(browser, 'title');
    try {
      const kind = await rendererKind(t.page.page);
      const other = readRef(kind, 'options');
      test.skip(!other, `no ${kind} reference for options`);
      if (!other) return;
      expect(outsideBounds(kind, measure(t.picture, other)).length).toBeGreaterThan(0);
    } finally {
      await t.page.close();
    }
  });
});
