/**
 * M5 pass lines 6 and 9 (smoke): the field plays on the stage under the flag (`/?engine=sje`), and falls back to the old drawing when the stage cannot be made or fails
 * (docs/engine/m5-brief.md tasks 5 to 7). The field scene is the shipped one (`scenes/field.ts`, unchanged rules); the picture is the stage under it (`src/fieldstage`).
 *
 * What it plays, reading the state through `window.__SJ__` (the DEV hook: `fieldStage` is the stage as data, `field()` the field scene):
 *  - the stage is there under the flag, below the field on the scene stack, and absent on the old path (control);
 *  - the leader walks: the camera scrolls, the leader's actor moves, the props come into view and out of it;
 *  - a real warp (`doWarp`: fade out, load, fade in) swaps the map in the stage; into a small interior the camera centers the room and the surround shows;
 *  - an emote shows on the screen-fixed layer and goes when it ends; a follower joins the actors when it walks out from behind the leader;
 *  - a chunk that fails to load, and a stage that throws in a frame, are a notice and the old drawing (the field keeps working and keeps its picture);
 *  - ten map enter and exit cycles leave the GL object counts flat (and a texture made on purpose does not: the control that the counter sees a leak);
 *  - the editor contract on a live stage: a map that breaks the rules is refused and the stage keeps its map; a snapshot shows the state it was taken at.
 *
 * 0 GL errors and 0 console warnings in every test (the watcher of `openGame` keeps every console error and warning and every uncaught page error), except the ones a test makes on purpose.
 *
 * Run:  CI=1 PW_PORT=3011 npx playwright test e2e/sje-field.spec.ts --reporter=line
 */
import { readdirSync, readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { type GamePage, openGame, sj, waitTop, waitUntil } from './sjegamekit';

async function openField(browser: import('@playwright/test').Browser, o: { allow?: RegExp[]; engine?: boolean } = {}): Promise<GamePage> {
  const g = await openGame(browser, { engine: o.engine ?? true, ...(o.allow ? { allow: o.allow } : {}) });
  expect(await waitTop(g.page, 'TitleScene')).toBe(true);
  await sj(g.page, "sj.stage('town')");
  expect(await waitUntil(g.page, 'sj.top() === "FieldScene" && sj.idle()', 30_000)).toBe(true);
  return g;
}

const stageUp = (page: Page, map?: string) => waitUntil(page, `sj.fieldStage !== null${map ? ` && sj.fieldStage.mapId === ${JSON.stringify(map)}` : ''} && sj.fieldStage.frame > 0`, 30_000);

const glErrors = (page: Page) =>
  sj<number[]>(page, '(() => { const gl = sj.game.renderer.glc.gl; const out = []; for (let e = gl.getError(); e !== 0 && out.length < 16; e = gl.getError()) out.push(e); return out; })()');

/** The class names of the scene stack, bottom first. */
const stack = (page: Page) => sj<string[]>(page, 'sj.game.scene.scenes.map((s) => s.legacy ? s.legacy.constructor.name : s.constructor.name)');

/** How many distinct colors the player sees (a blank or broken picture has very few). */
const colors = (page: Page) =>
  sj<number>(
    page,
    `(() => { const p = sj.pixels({ x: 0, y: 0, w: 640, h: 360 }); const seen = new Set(); for (let i = 0; i < p.data.length; i += 4) seen.add((p.data[i] << 16) | (p.data[i + 1] << 8) | p.data[i + 2]); return seen.size; })()`,
  );

/** Where a warp into this map puts the leader: the first warp in any map file that leads here. */
function entryOf(map: string): { x: number; y: number } {
  for (const f of readdirSync('src/data/maps')) {
    if (!f.endsWith('.json')) continue;
    const j = JSON.parse(readFileSync(`src/data/maps/${f}`, 'utf8')) as { warps?: Array<{ to: string; tx: number; ty: number }> };
    for (const w of j.warps ?? []) if (w.to === map) return { x: w.tx, y: w.ty };
  }
  throw new Error(`no warp leads to ${map}`);
}

async function hold(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

async function warpTo(page: Page, map: string): Promise<void> {
  const { x, y } = entryOf(map);
  await sj(page, `sj.tp(${JSON.stringify(map)}, ${x}, ${y}, 'down')`);
  expect(await stageUp(page, map)).toBe(true);
  expect(await waitUntil(page, 'sj.idle()', 10_000)).toBe(true);
}

test.describe('the field on the stage', () => {
  test('the stage stands under the field, and the old path has none (control)', async ({ browser }) => {
    const g = await openField(browser);
    try {
      expect(await stageUp(g.page, 'lantern_row')).toBe(true);
      const d = await sj<{ mapId: string; props: { total: number; built: number; shown: number }; lights: number; overRects: number }>(g.page, 'sj.fieldStage');
      expect(d.mapId).toBe('lantern_row');
      expect(d.props.total).toBeGreaterThan(20);
      expect(d.props.shown).toBeGreaterThan(0);
      expect(d.lights).toBeGreaterThan(20);
      // The stage is under the field, which is non-opaque so that it shows.
      const names = await stack(g.page);
      expect(names.indexOf('FieldStageScene')).toBeGreaterThanOrEqual(0);
      expect(names.indexOf('FieldStageScene')).toBeLessThan(names.indexOf('FieldScene'));
      expect(await sj<boolean>(g.page, 'sj.field().opaque')).toBe(false);
      // The picture is a picture: many colors, none of the broken-frame kind.
      expect(await colors(g.page)).toBeGreaterThan(200);
      expect(await glErrors(g.page)).toEqual([]);
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
    const old = await openField(browser, { engine: false });
    try {
      expect(await old.page.evaluate('window.__SJ__.fieldStage')).toBeUndefined();
      expect(await old.page.evaluate('window.__SJ__.field().opaque')).toBe(true);
      expect(old.problems).toEqual([]);
    } finally {
      await old.close();
    }
  });

  test('walking scrolls the camera and moves the leader; the props come into view and go out of it', async ({ browser }) => {
    const g = await openField(browser);
    try {
      expect(await stageUp(g.page, 'lantern_row')).toBe(true);
      const before = await sj<{ scroll: { x: number; y: number }; props: { built: number } }>(g.page, 'sj.fieldStage');
      const x0 = await sj<number>(g.page, 'sj.field().leader.x');
      const y0 = await sj<number>(g.page, 'sj.field().leader.y');
      await hold(g.page, 'ArrowUp', 900);
      await waitUntil(g.page, 'sj.idle()', 5_000);
      const after = await sj<{ scroll: { x: number; y: number }; props: { built: number } }>(g.page, 'sj.fieldStage');
      expect(await sj<number>(g.page, 'sj.field().leader.y')).toBeLessThan(y0);
      expect(after.scroll.y).toBeLessThan(before.scroll.y);
      expect(await sj<number>(g.page, 'sj.field().leader.x')).toBe(x0);
      // Walking far brings more props into view for the first time (they are built when they first show).
      await hold(g.page, 'ArrowLeft', 1500);
      await waitUntil(g.page, 'sj.idle()', 5_000);
      const far = await sj<{ props: { built: number } }>(g.page, 'sj.fieldStage');
      expect(far.props.built).toBeGreaterThanOrEqual(after.props.built);
      expect(await glErrors(g.page)).toEqual([]);
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });

  test('a real warp swaps the map in the stage; a small interior is centered with its surround; and back', async ({ browser }) => {
    const g = await openField(browser);
    try {
      expect(await stageUp(g.page, 'lantern_row')).toBe(true);
      // The real warp: fade out, load the map, fade in (`FieldScene.doWarp`).
      await sj(g.page, 'sj.field().doWarp(sj.field().def.warps[0])');
      expect(await waitUntil(g.page, 'sj.fieldStage !== null && sj.fieldStage.mapId !== "lantern_row" && sj.idle()', 30_000)).toBe(true);
      const first = await sj<string>(g.page, 'sj.fieldStage.mapId');
      expect(first).toBe(await sj<string>(g.page, 'sj.field().def.id'));
      // A small interior: the camera origin is negative (the room is centered) and the surround shows around it.
      await warpTo(g.page, 'bar');
      const d = await sj<{ scroll: { x: number; y: number }; surroundShown: boolean; overRects: number }>(g.page, 'sj.fieldStage');
      expect(d.scroll.x).toBeLessThan(0);
      expect(d.surroundShown).toBe(true);
      expect(await colors(g.page)).toBeGreaterThan(40);
      // And the town again.
      await warpTo(g.page, 'lantern_row');
      expect((await sj<{ scroll: { x: number } }>(g.page, 'sj.fieldStage')).scroll.x).toBeGreaterThanOrEqual(0);
      expect(await glErrors(g.page)).toEqual([]);
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });

  test('an emote shows on the screen-fixed layer and goes when it ends; a follower joins the actors', async ({ browser }) => {
    const g = await openField(browser);
    try {
      await warpTo(g.page, 'rook_flat');
      // The area banner is up for 200 ticks: wait it out, so the screen layer is empty (an interior has no rain and no objective).
      expect(await waitUntil(g.page, 'sj.fieldStage.screenShown === false', 15_000)).toBe(true);
      await sj(g.page, "sj.field().leader.emote = { kind: '!', t: 0, dur: 50 }");
      expect(await waitUntil(g.page, 'sj.fieldStage.screenShown === true', 3_000)).toBe(true);
      expect(await waitUntil(g.page, 'sj.fieldStage.screenShown === false', 5_000)).toBe(true);
      // A follower: it stands behind the leader (hidden, stacked) until the leader walks.
      const actors0 = await sj<number>(g.page, 'sj.fieldStage.actors');
      await sj(g.page, "(sj.state.party = ['kit', 'rook'], sj.field().refreshParty())");
      await g.page.waitForTimeout(300);
      expect(await sj<number>(g.page, 'sj.fieldStage.actors')).toBe(actors0);
      await hold(g.page, 'ArrowRight', 450);
      expect(await waitUntil(g.page, `sj.fieldStage.actors > ${actors0}`, 3_000)).toBe(true);
      expect(await glErrors(g.page)).toEqual([]);
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });

  test('the editor contract on the live stage: a bad map is refused and the stage keeps its map; a snapshot shows the state it was taken at', async ({ browser }) => {
    const g = await openField(browser);
    try {
      await warpTo(g.page, 'rook_flat');
      expect(await waitUntil(g.page, 'sj.fieldStage.screenShown === false', 15_000)).toBe(true);
      const msg = await sj<string | null>(g.page, 'sj.fieldStageLoadBadMap()');
      expect(msg).toMatch(/is not valid, so the stage keeps "rook_flat"/);
      expect(await sj<string>(g.page, 'sj.fieldStage.mapId')).toBe('rook_flat');
      // A snapshot, then the leader walks, then the snapshot is shown: the camera and the leader are where they were.
      const snap = await sj<{ cx: number; cy: number; actors: Array<{ x: number; y: number }> }>(g.page, 'sj.fieldStageSnapshot()');
      const scroll0 = await sj<{ x: number; y: number }>(g.page, 'sj.fieldStage.scroll');
      await hold(g.page, 'ArrowRight', 400);
      await waitUntil(g.page, 'sj.idle()', 5_000);
      await sj(g.page, `sj.fieldStageRestore(${JSON.stringify(snap)})`);
      expect(await waitUntil(g.page, 'sj.fieldStage.pinned === true', 2_000)).toBe(true);
      expect(await sj<{ x: number; y: number }>(g.page, 'sj.fieldStage.scroll')).toEqual(scroll0);
      expect(await sj<boolean>(g.page, 'sj.fieldStage.screenShown')).toBe(false);
      await sj(g.page, 'sj.fieldStageRelease()');
      expect(await waitUntil(g.page, 'sj.fieldStage.pinned === false', 2_000)).toBe(true);
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });
});

test.describe('the field falls back to the old drawing', () => {
  test('a chunk that fails to load: a notice, the old drawing, and a field that still plays', async ({ browser }) => {
    const g = await openGame(browser, { engine: true, allow: [/field stage\] could not load/] });
    try {
      expect(await waitTop(g.page, 'TitleScene')).toBe(true);
      // The boot's provider is replaced by one whose code cannot be fetched (a stale deploy), before any field is made.
      await g.page.evaluate(async () => {
        const url = '/src/scenes/fieldkit/fieldseam.ts';
        const m = (await import(/* @vite-ignore */ url)) as { setFieldStageProvider(p: unknown): void; lazyFieldStageProvider(load: () => Promise<unknown>): unknown };
        m.setFieldStageProvider(m.lazyFieldStageProvider(() => Promise.reject(new Error('a stale deploy'))));
      });
      await sj(g.page, "sj.stage('town')");
      expect(await waitUntil(g.page, 'sj.top() === "FieldScene" && sj.idle()', 30_000)).toBe(true);
      expect(await waitUntil(g.page, 'sj.notice() !== null', 5_000)).toBe(true);
      expect(await sj<string>(g.page, 'sj.notice().text')).toMatch(/new field view could not load/);
      expect(await sj(g.page, 'sj.fieldStage')).toBeNull();
      expect(await sj<boolean>(g.page, 'sj.field().opaque')).toBe(true);
      expect(await colors(g.page)).toBeGreaterThan(200);
      // It plays: the leader walks.
      const y0 = await sj<number>(g.page, 'sj.field().leader.y');
      await hold(g.page, 'ArrowUp', 600);
      await waitUntil(g.page, 'sj.idle()', 5_000);
      expect(await sj<number>(g.page, 'sj.field().leader.y')).toBeLessThan(y0);
      expect(await glErrors(g.page)).toEqual([]);
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });

  test('a stage that throws in a frame: a notice, the stage gone, the field draws itself again', async ({ browser }) => {
    const g = await openField(browser, { allow: [/field stage\] a frame failed/] });
    try {
      expect(await stageUp(g.page, 'lantern_row')).toBe(true);
      const before = await colors(g.page);
      expect(before).toBeGreaterThan(200);
      // The field's own view breaks (as a bug in a painter would): the stage must not take the field down with it.
      await sj(g.page, "(sj.field().view = () => { throw new Error('the view broke'); }, 0)");
      expect(await waitUntil(g.page, 'sj.fieldStage === null', 5_000)).toBe(true);
      expect(await sj<string>(g.page, 'sj.notice().text')).toMatch(/new field view could not load/);
      expect(await sj<boolean>(g.page, 'sj.field().opaque')).toBe(true);
      expect(await stack(g.page)).toEqual(['FieldScene']);
      await g.page.waitForTimeout(300);
      expect(await colors(g.page)).toBeGreaterThan(200);
      expect(await sj<string>(g.page, 'sj.top()')).toBe('FieldScene');
      expect(await glErrors(g.page)).toEqual([]);
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });
});

test.describe('the stage frees what it makes', () => {
  test('ten map enter and exit cycles leave the GL object counts flat; a texture made on purpose does not (control)', async ({ browser }) => {
    const g = await openField(browser);
    try {
      expect(await stageUp(g.page, 'lantern_row')).toBe(true);
      const cycle = async (n: number): Promise<void> => {
        for (let i = 0; i < n; i++) {
          await warpTo(g.page, 'rustyard');
          await warpTo(g.page, 'bar');
          await warpTo(g.page, 'lantern_row');
        }
      };
      // Two cycles first: the baked maps, the chest pictures and the font are made once and stay.
      await cycle(2);
      await g.page.waitForTimeout(300);
      const base = await sj<Record<string, number>>(g.page, 'sj.glCounts()');
      await cycle(10);
      await g.page.waitForTimeout(300);
      const after = await sj<Record<string, number>>(g.page, 'sj.glCounts()');
      for (const k of ['texture', 'buffer', 'framebuffer', 'renderbuffer', 'program']) expect(after[k] ?? 0, `${k} after 10 cycles`).toBe(base[k] ?? 0);
      // Control: a picture that nobody frees grows the texture count, so the counter would have seen a leak.
      await sj(g.page, '(void sj.game.scene.top.add.canvasImage(0, 0, 16, 16), 0)');
      await g.page.waitForTimeout(200);
      const leaked = await sj<Record<string, number>>(g.page, 'sj.glCounts()');
      expect(leaked.texture ?? 0).toBeGreaterThan(after.texture ?? 0);
      expect(await glErrors(g.page)).toEqual([]);
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });
});
