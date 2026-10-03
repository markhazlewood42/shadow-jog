/**
 * The Phaser stage lab's seams for the editor (spike `spike/phaser-stage`): everything step 2 builds on.
 *
 * Checks that a changed stage config really changes the scene (the horizon, a new backdrop, another party
 * order, a different number of enemies, enemy size, shadow size), that none of it leaks textures or leaves
 * stray objects, that frame choice comes from the fixed tick (so a replay is the same every run), and that in
 * edit mode a fighter can be picked up with the mouse and dropped on another depth row.
 */
import { expect, type Page, test } from '@playwright/test';
import { openLab } from './stagelabkit';

/** The page's StageScene, for `page.evaluate` callbacks (typed loosely on purpose: a few private fields are read). */
type AnyScene = {
  fighters: Array<{
    id: string;
    side: string;
    slot: { row: number; x: number };
    baseX: number;
    baseY: number;
    sprite: { x: number; y: number; scaleX: number; depth: number; frame: { name: string | number }; input: { enabled: boolean; hitArea: unknown; hitAreaCallback: (a: unknown, x: number, y: number, o: unknown) => boolean } | null; width: number; height: number; originX: number; originY: number };
    shadow: { texture: { key: string }; depth: number };
    sheet?: { fps: number; count: number; phase: number };
    idle: string;
    uid: number;
  }>;
  frame: number;
  config: Record<string, unknown> & { horizon: number; backdrop: string; lineup: string[]; shadow: { width: number }; rows: Array<{ y: number }>; floor: { top: number; bottom: number } };
  enemies: string[];
  children: { length: number };
  layers: { front: unknown; wall: { y: number }; floor: { y: number }; wallTop: { visible: boolean; displayHeight: number }; floorBottom: { visible: boolean; displayHeight: number; y: number } };
  applyStage: (s: unknown) => void;
  setEnemies: (keys: string[]) => void;
  setEditMode: (on: boolean) => void;
  currentStage: () => { party: Array<{ row: number; x: number }> };
  step: (n: number) => void;
};

declare global {
  interface Window {
    /** The lab's scene, typed for these tests (set by `open` below, because a function from this file does not exist inside the page). */
    __sc: () => AnyScene;
  }
}

/** Open the lab and give the page a `window.__sc()` that returns its scene. */
async function open(page: Page): Promise<string[]> {
  await page.addInitScript(() => {
    window.__sc = () => {
      const s = window.__stagelab?.scene();
      if (!s) throw new Error('no scene yet');
      return s as unknown as AnyScene;
    };
  });
  return openLab(page);
}

/** Count the shadow textures Phaser holds. */
const shadowCount = (page: Page): Promise<number> => page.evaluate(() => (window.__stagelab?.textureKeys() ?? []).filter((k) => k.startsWith('shadow-')).length);

test('moving the horizon moves the wall and the floor and always leaves a complete backdrop', async ({ page }) => {
  const errors = await open(page);
  // The window clear colour (the game's backgroundColor): if it shows through, a gap was left.
  const clear = '#07060d';
  for (const horizon of [90, 124, 160]) {
    await page.evaluate((h) => {
      const s = window.__sc();
      s.applyStage({ ...s.config, horizon: h, floor: { ...s.config.floor, top: Math.max(s.config.floor.top, h) } });
    }, horizon);
    const placed = await page.evaluate(() => {
      const l = window.__sc().layers;
      return { wallY: l.wall.y, floorY: l.floor.y, top: l.wallTop.visible ? l.wallTop.displayHeight : 0, bottom: l.floorBottom.visible ? l.floorBottom.displayHeight : 0 };
    });
    expect(placed.wallY).toBe(horizon);
    expect(placed.floorY).toBe(horizon);
    // A horizon lower than the baked one (124) opens a gap at the top; a higher one at the bottom.
    expect(placed.top).toBe(Math.max(0, horizon - 124));
    expect(placed.bottom).toBe(Math.max(0, 124 - horizon));
    const colours = await page.evaluate(() => window.__stagelab?.pixels([[10, 0], [240, 0], [470, 0], [10, 269], [240, 269], [470, 269]]) ?? Promise.reject(new Error('no hook')));
    expect(colours).not.toContain(clear);
  }
  expect(errors).toEqual([]);
});

test('a new backdrop, another party order and another set of enemies rebuild only what they need, with no leaks', async ({ page }) => {
  const errors = await open(page);
  const baseline = await page.evaluate(() => ({ textures: window.__stagelab?.textureCount() ?? 0, children: window.__sc().children.length, fighters: window.__sc().fighters.length }));
  expect(baseline.fighters).toBe(7);

  // Party order reversed: the same four crew, other slots.
  await page.evaluate(() => {
    const s = window.__sc();
    s.applyStage({ ...s.config, lineup: [...s.config.lineup].reverse() });
  });
  expect(await page.evaluate(() => window.__sc().fighters.filter((f) => f.side === 'party').map((f) => f.id))).toEqual(['kit', 'rook', 'sable', 'hex']);
  expect(await page.evaluate(() => window.__sc().children.length)).toBe(baseline.children);

  // Fewer and more enemies: the slot set for that head-count is used.
  await page.evaluate(() => window.__sc().setEnemies(['glowrat']));
  expect(await page.evaluate(() => window.__sc().fighters.filter((f) => f.side === 'enemy').length)).toBe(1);
  const slots1 = await page.evaluate(() => window.__sc().fighters.filter((f) => f.side === 'enemy').map((f) => f.slot));
  expect(slots1).toEqual([{ row: 1, x: 372 }]);
  expect(await page.evaluate(() => window.__sc().children.length)).toBe(baseline.children - 4);
  await page.evaluate(() => window.__sc().setEnemies(['rustfang_punk', 'glowrat', 'rustfang_punk', 'glowrat']));
  expect(await page.evaluate(() => window.__sc().fighters.length)).toBe(8);
  expect(await page.evaluate(() => window.__sc().children.length)).toBe(baseline.children + 2);

  // Another backdrop: the enemy pictures are washed with its light, so they are remade; nothing of the old one is left on the display list.
  const other = await page.evaluate(async () => {
    const url = '/src/art/battlebg.ts';
    const m = await import(/* @vite-ignore */ url);
    return (m.BG_IDS as string[]).find((id) => id !== window.__sc().config.backdrop) ?? '';
  });
  expect(other).not.toBe('');
  await page.evaluate((id) => {
    const s = window.__sc();
    s.applyStage({ ...s.config, backdrop: id });
  }, other);
  expect(await page.evaluate(() => window.__sc().config.backdrop)).toBe(other);
  expect(await page.evaluate(() => window.__sc().fighters.length)).toBe(8);
  // Four backdrop pieces, the foreground if this backdrop has one, the guide, and 8 fighters with a shadow each.
  expect(await page.evaluate(() => window.__sc().children.length)).toBe(await page.evaluate(() => 4 + (window.__sc().layers.front ? 1 : 0) + 1 + 16));
  const snap = await page.evaluate(() => window.__stagelab?.snapshot() ?? Promise.reject(new Error('no hook')));
  expect(snap.colours).toBeGreaterThan(100);

  // And back, and forth again: the textures are found by name, not re-made, so the count does not move.
  const afterOther = await page.evaluate(() => window.__stagelab?.textureCount());
  await page.evaluate(() => {
    const s = window.__sc();
    s.applyStage({ ...s.config, backdrop: 'street' });
  });
  expect(await page.evaluate(() => window.__stagelab?.textureCount())).toBe(afterOther);
  await page.evaluate((id) => {
    const s = window.__sc();
    s.applyStage({ ...s.config, backdrop: id });
  }, other);
  expect(await page.evaluate(() => window.__stagelab?.textureCount())).toBe(afterOther);
  expect(await page.evaluate(() => window.__stagelab?.crisp())).toBe(true);
  expect(errors).toEqual([]);
});

test('enemy size and shadow size are data: a changed config changes the sprites, and shadow textures do not pile up', async ({ page }) => {
  const errors = await open(page);
  // The shipped rule: every enemy at 1 screen pixel per art pixel, like the crew.
  expect(await page.evaluate(() => window.__sc().fighters.filter((f) => f.side === 'enemy').map((f) => f.sprite.scaleX))).toEqual([1, 1, 1]);
  await page.evaluate(() => {
    const s = window.__sc();
    s.applyStage({ ...s.config, enemyScale: { punk: 2, '*': 1 } });
  });
  // Punks (ids rustfang_punk#0 and #2) at 2, the rat still 1; positions and scales stay whole numbers.
  expect(await page.evaluate(() => window.__sc().fighters.filter((f) => f.side === 'enemy').map((f) => f.sprite.scaleX))).toEqual([2, 1, 2]);
  expect(await page.evaluate(() => window.__sc().fighters.every((f) => Number.isInteger(f.sprite.x) && Number.isInteger(f.sprite.y)))).toBe(true);
  await page.evaluate(() => {
    const s = window.__sc();
    s.applyStage({ ...s.config, enemyScale: { '*': 1 } });
  });
  expect(await page.evaluate(() => window.__sc().fighters.filter((f) => f.side === 'enemy').map((f) => f.sprite.scaleX))).toEqual([1, 1, 1]);

  // A size slider: 30 steps, and the number of shadow textures never grows past the sizes in use.
  const before = await page.evaluate(() => window.__stagelab?.textureCount() ?? 0);
  let most = 0;
  for (let w = 10; w < 70; w += 2) {
    await page.evaluate((width) => {
      const s = window.__sc();
      s.applyStage({ ...s.config, shadow: { ...s.config.shadow, width, enemyScale: 1 + (width % 3) / 4 } });
    }, w);
    most = Math.max(most, await shadowCount(page));
  }
  // One party size plus the enemies' (a punk, the rat; the two punks share one): a handful at most.
  expect(most).toBeLessThanOrEqual(5);
  await page.evaluate(() => {
    const s = window.__sc();
    s.applyStage({ ...s.config, shadow: { ...s.config.shadow, width: 36, enemyScale: 1 } });
  });
  expect(await page.evaluate(() => window.__stagelab?.textureCount())).toBe(before);
  expect(errors).toEqual([]);
});

test('frames come from the fixed tick: the same tick shows the same picture, and stepping N ticks moves exactly N', async ({ page }) => {
  const errors = await open(page);
  const result = await page.evaluate(async () => {
    const url = '/src/stage/idle.ts'; // the dev server serves the module the game itself runs
    const { idleFrame, enemyIdle } = await import(/* @vite-ignore */ url);
    const s = window.__sc();
    const bad: string[] = [];
    const check = (): void => {
      for (const f of s.fighters) {
        if (f.sheet) {
          const want = idleFrame(s.frame, f.sheet.fps, f.sheet.count, f.sheet.phase);
          if (Number(f.sprite.frame.name) !== want) bad.push(`${f.id} tick ${s.frame}: frame ${f.sprite.frame.name}, wanted ${want}`);
        } else {
          const o = enemyIdle(f.idle as never, s.frame, f.uid);
          if (f.sprite.x !== f.baseX + o.x || f.sprite.y !== f.baseY + o.y) bad.push(`${f.id} tick ${s.frame}: sway off`);
        }
      }
    };
    const start = s.frame;
    check();
    s.step(1);
    check();
    s.step(59);
    check();
    s.step(200);
    check();
    // Frames that really change over a second (the sheet loops, not a still).
    const seen = new Set<string | number>();
    for (let i = 0; i < 60; i++) {
      s.step(1);
      const hero = s.fighters.find((f) => f.sheet);
      if (hero) seen.add(hero.sprite.frame.name);
    }
    return { bad, advanced: s.frame - start, frames: seen.size };
  });
  expect(result.bad).toEqual([]);
  // 1 + 59 + 200 + 60 ticks stepped by hand, all inside one synchronous call, so the clock cannot add any.
  expect(result.advanced).toBe(320);
  expect(result.frames).toBeGreaterThan(3);
  expect(errors).toEqual([]);
});

test('edit mode: a fighter is picked up with the mouse and dropped on another depth row; the scene follows', async ({ page }) => {
  const errors = await open(page);
  // Off by default: nothing is pickable.
  expect(await page.evaluate(() => window.__sc().fighters.every((f) => !f.sprite.input?.enabled))).toBe(true);
  await page.evaluate(() => window.__sc().setEditMode(true));
  expect(await page.evaluate(() => window.__sc().fighters.every((f) => f.sprite.input?.enabled === true))).toBe(true);

  // Find an opaque pixel of Kit (the front hero) to grab: the hit test follows the drawn pixels.
  const grab = await page.evaluate(() => {
    const f = window.__sc().fighters.find((x) => x.id === 'kit');
    if (!f?.sprite.input) throw new Error('kit is not interactive');
    const sp = f.sprite;
    const input = sp.input;
    if (!input) throw new Error('no input');
    // Local coordinates are in the cell; the cell's top-left in game pixels is the feet minus the origin.
    const x0 = sp.x - sp.originX * sp.width;
    const y0 = sp.y - sp.originY * sp.height;
    for (let dy = 0; dy < sp.height; dy++) {
      const ly = Math.round(sp.height * 0.5) + (dy % 2 === 0 ? dy / 2 : -(dy + 1) / 2);
      for (let lx = Math.round(sp.width * 0.4); lx < sp.width * 0.6; lx++) {
        if (ly >= 0 && ly < sp.height && input.hitAreaCallback(input.hitArea, lx, ly, sp)) return { x: x0 + lx, y: y0 + ly, feetX: sp.x, feetY: sp.y, slot: f.slot };
      }
    }
    throw new Error('no opaque pixel found on kit');
  });
  const startSlot = grab.slot;
  expect(startSlot.row).toBe(3);

  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  const zoom = box.width / 480;
  const at = (gx: number, gy: number): [number, number] => [box.x + gx * zoom, box.y + gy * zoom];
  const [sx, sy] = at(grab.x, grab.y);
  // Drop so the FEET end up near row 1 (y 201) and x 120: the pointer keeps its offset from the feet.
  const targetFeet = { x: 120, y: 205 };
  const [ex, ey] = at(targetFeet.x + (grab.x - grab.feetX), targetFeet.y + (grab.y - grab.feetY));
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move((sx + ex) / 2, (sy + ey) / 2, { steps: 6 });
  await page.mouse.move(ex, ey, { steps: 6 });
  await page.mouse.up();

  const after = await page.evaluate(() => {
    const s = window.__sc();
    const f = s.fighters.find((x) => x.id === 'kit');
    if (!f) throw new Error('kit gone');
    return { slot: f.slot, x: f.sprite.x, y: f.sprite.y, depth: f.sprite.depth, shadowDepth: f.shadow.depth, rowY: s.config.rows[f.slot.row]?.y, saved: s.currentStage().party[3] };
  });
  // Snapped to the nearest row (1, y 201), x where it was dropped, depth and shadow follow, and the "save" copy of the config has it.
  expect(after.slot.row).toBe(1);
  expect(Math.abs(after.slot.x - targetFeet.x)).toBeLessThanOrEqual(3);
  expect(after.y).toBe(after.rowY);
  expect(after.depth).toBe(after.rowY === undefined ? -1 : after.rowY * 1000 + after.slot.x);
  expect(after.shadowDepth).toBe(after.depth - 0.5);
  expect(after.saved).toEqual(after.slot);

  // Edit mode off again: nothing is pickable.
  await page.evaluate(() => window.__sc().setEditMode(false));
  expect(await page.evaluate(() => window.__sc().fighters.every((f) => !f.sprite.input?.enabled))).toBe(true);
  expect(errors).toEqual([]);
});
