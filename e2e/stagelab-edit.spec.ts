/**
 * The Phaser stage lab's seams for the editor (spike `spike/phaser-stage`): everything step 2 builds on.
 *
 * Checks that a changed stage config really changes the scene (the horizon repaints the picture, another stage,
 * another enemy group, another moment of the turn, a moved HUD region, a changed shadow), that none of it leaks
 * textures or leaves stray objects, that frame choice comes from the fixed tick (so a replay is the same every
 * run), and that in edit mode a fighter can be picked up with the mouse and dropped on another depth row.
 */
import { expect, type Page, test } from '@playwright/test';
import { openLab } from './stagelabkit';

type Part = { visible: boolean; depth: number; texture: { key: string }; x: number; y: number };

/** The page's StageScene, for `page.evaluate` callbacks (typed loosely on purpose: a few private fields are read). */
type AnyScene = {
  fighters: Array<{
    id: string;
    side: string;
    boss: boolean;
    slot: { row: number; x: number };
    baseX: number;
    baseY: number;
    x: number;
    y: number;
    bodyDx: number;
    sortY: number;
    depth: number;
    shadowW: number;
    active: boolean;
    target: boolean;
    flash: boolean;
    sprite: { x: number; y: number; scaleX: number; depth: number; frame: { name: string | number }; texture: { key: string }; input: { enabled: boolean; hitArea: unknown; hitAreaCallback: (a: unknown, x: number, y: number, o: unknown) => boolean } | null; width: number; height: number; originX: number; originY: number };
    shadow: Part;
    ring: Part;
    home: Part;
    bar: { depth: number; x: number; y: number } | null;
    sheet?: { fps: number; count: number; phase: number };
    idle: string;
    uid: number;
  }>;
  frame: number;
  config: StageLike;
  enemies: string[];
  enemySet: string;
  currentPhase: string;
  currentView: { phase: string; active: number; target: number | null; banner: string | null; act: { dmg: number } | null };
  pictureKey: string;
  hudObjects: { box: (name: string) => { x: number; y: number } | undefined; objects: unknown[]; frames: Array<{ x: number; y: number }> };
  children: { length: number };
  applyStage: (s: unknown) => void;
  showStage: (id: string) => void;
  setEnemySet: (key: string) => void;
  setEnemies: (keys: string[], setKey?: string) => void;
  setPhase: (p: string) => void;
  setEditMode: (on: boolean) => void;
  currentStage: () => { party: Array<{ row: number; x: number }> };
  step: (n: number) => void;
};

type StageLike = {
  id: string;
  backdrop: { horizonY: number; shiftY: number; id: string };
  floor: { y0: number; y1: number; seed?: number };
  rows: Array<{ y: number }>;
  shadow: { widthScale: number };
  hud: Record<string, { x: number; y: number; show: string }>;
  demo: { lineup: string[] };
};

declare global {
  interface Window {
    /** The lab's scene, typed for these tests (set by `open` below, because a function from this file does not exist inside the page). */
    __sc: () => AnyScene;
  }
}

/** Open the lab and give the page a `window.__sc()` that returns its scene. */
async function open(page: Page, query = ''): Promise<string[]> {
  await page.addInitScript(() => {
    window.__sc = () => {
      const s = window.__stagelab?.scene();
      if (!s) throw new Error('no scene yet');
      return s as unknown as AnyScene;
    };
  });
  return openLab(page, query);
}

/** How many textures of a kind Phaser holds. */
const countOf = (page: Page, prefix: string): Promise<number> => page.evaluate((p) => (window.__stagelab?.textureKeys() ?? []).filter((k) => k.startsWith(p)).length, prefix);

test('moving the horizon repaints the picture: the kerb follows the horizon, the wall stays complete and old pictures are removed', async ({ page }) => {
  const errors = await open(page);
  const keys = new Set<string>();
  for (const horizon of [92, 100, 112, 100]) {
    await page.evaluate((h) => {
      const s = window.__sc();
      s.applyStage({ ...s.config, backdrop: { ...s.config.backdrop, horizonY: h, shiftY: h - 132 }, floor: { ...s.config.floor, y0: h } });
    }, horizon);
    keys.add(await page.evaluate(() => window.__sc().pictureKey));
    // Only the current stage picture exists: a dragged horizon does not leave one behind per step.
    expect(await countOf(page, 'stage-')).toBe(1);
    // The kerb row (the street's `edge` colour) sits exactly on the horizon, with the wall above it and floor below.
    const [above, kerb, floor] = await page.evaluate((h) => window.__stagelab?.pixels([[8, h - 1], [8, h], [8, h + 20]]) ?? Promise.reject(new Error('no hook')), horizon);
    expect(kerb).toBe('#3a3a5c');
    expect(above).not.toBe('#07060d'); // the window clear colour: if it shows through, a gap was left
    expect(floor).not.toBe(above);
  }
  // Going back to a horizon finds the picture by its name again: 3 distinct pictures for 3 distinct horizons.
  expect(keys.size).toBe(3);
  expect(errors).toEqual([]);
});

test('another floor seed repaints the floor; the same config keeps its picture (nothing is painted twice)', async ({ page }) => {
  const errors = await open(page);
  const key = await page.evaluate(() => window.__sc().pictureKey);
  const textures = await page.evaluate(() => window.__stagelab?.textureCount() ?? 0);
  await page.evaluate(() => {
    const s = window.__sc();
    s.applyStage({ ...s.config });
  });
  expect(await page.evaluate(() => window.__sc().pictureKey)).toBe(key);
  expect(await page.evaluate(() => window.__stagelab?.textureCount())).toBe(textures);
  await page.evaluate(() => {
    const s = window.__sc();
    s.applyStage({ ...s.config, floor: { ...s.config.floor, seed: 4242 } });
  });
  expect(await page.evaluate(() => window.__sc().pictureKey)).not.toBe(key);
  expect(await countOf(page, 'stage-')).toBe(1);
  expect(errors).toEqual([]);
});

test('another stage, another enemy group and another moment of the turn rebuild what they need, with no leaks', async ({ page }) => {
  const errors = await open(page);
  const baseline = await page.evaluate(() => ({ children: window.__sc().children.length, fighters: window.__sc().fighters.length }));
  expect(baseline.fighters).toBe(7);

  // Every group on both stages, then the same walk again: the second pass finds every picture by name, so nothing grows.
  const walk = async (): Promise<number> => {
    for (const id of ['sewer', 'street']) {
      await page.evaluate((i) => window.__sc().showStage(i), id);
      expect(await page.evaluate(() => window.__sc().config.id)).toBe(id);
      expect(await countOf(page, 'stage-')).toBe(1);
      for (const [key, count] of [['1', 1], ['2', 2], ['4', 4], ['5', 5], ['6', 6], ['boss', 1], ['boss+1', 2], ['boss+2', 3], ['3', 3]] as const) {
        await page.evaluate((k) => window.__sc().setEnemySet(k), key);
        expect(await page.evaluate(() => window.__sc().fighters.filter((f) => f.side === 'enemy').length)).toBe(count);
        expect(await page.evaluate(() => window.__sc().enemySet)).toBe(key);
      }
    }
    return page.evaluate(() => window.__stagelab?.textureCount() ?? 0);
  };
  const first = await walk();
  const second = await walk();
  expect(second).toBe(first);
  // Back where we started: the same number of objects (nothing of the other groups is left behind).
  expect(await page.evaluate(() => window.__sc().children.length)).toBe(baseline.children);
  expect(await page.evaluate(() => window.__stagelab?.crisp())).toBe(true);
  const snap = await page.evaluate(() => window.__stagelab?.snapshot() ?? Promise.reject(new Error('no hook')));
  expect(snap.colours).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test('the three moments of the turn show the regions the design says, and one hero is active', async ({ page }) => {
  const errors = await open(page);
  const boxes = (): Promise<string[]> => page.evaluate(() => ['turnOrder', 'commands', 'partyStatus', 'enemyInfo', 'banner', 'combo'].filter((n) => !!window.__sc().hudObjects.box(n)));
  const state = (): Promise<{ active: number; target: number; home: number; flashed: number; view: string; banner: string | null }> =>
    page.evaluate(() => {
      const s = window.__sc();
      return {
        active: s.fighters.filter((f) => f.active).length,
        target: s.fighters.filter((f) => f.target).length,
        home: s.fighters.filter((f) => f.home.visible).length,
        flashed: s.fighters.filter((f) => f.flash).length,
        view: s.currentView.phase,
        banner: s.currentView.banner,
      };
    });

  expect(await boxes()).toEqual(['turnOrder', 'commands', 'partyStatus', 'enemyInfo']);
  expect(await state()).toMatchObject({ active: 1, target: 0, home: 0, flashed: 0, view: 'choose', banner: null });

  await page.evaluate(() => window.__sc().setPhase('target'));
  expect((await boxes()).sort()).toEqual(['banner', 'commands', 'enemyInfo', 'partyStatus', 'turnOrder']);
  expect(await state()).toMatchObject({ active: 1, target: 1, home: 0, flashed: 0, view: 'target' });
  expect((await state()).banner).toMatch(/: pick a target$/);

  await page.evaluate(() => window.__sc().setPhase('act'));
  expect((await boxes()).sort()).toEqual(['banner', 'combo', 'enemyInfo', 'partyStatus', 'turnOrder']);
  expect(await state()).toMatchObject({ active: 1, target: 1, home: 1, flashed: 1, view: 'act' });
  // The attacker moved to the target's row, borrows its sort row plus a pixel, and the target is knocked back 3 px.
  const act = await page.evaluate(() => {
    const s = window.__sc();
    const a = s.fighters.find((f) => f.active);
    const t = s.fighters.find((f) => f.target);
    if (!a || !t) throw new Error('no attacker or target');
    return { attackerY: a.y, targetY: t.baseY, sortY: a.sortY, bodyDx: t.bodyDx, attackerMoved: a.x !== a.baseX, targetSortY: t.sortY, lunge: s.config as unknown as { sort: { lungeOverTarget: number } } };
  });
  expect(act.attackerY).toBe(act.targetY);
  expect(act.sortY).toBe(act.targetSortY + act.lunge.sort.lungeOverTarget);
  expect(act.bodyDx).toBe(3);
  expect(act.attackerMoved).toBe(true);

  // And back: everyone is home again and the effects picture is gone.
  await page.evaluate(() => window.__sc().setPhase('choose'));
  expect(await state()).toMatchObject({ active: 1, target: 0, home: 0, flashed: 0 });
  expect(await countOf(page, 'fx-')).toBe(0);
  expect(errors).toEqual([]);
});

test('the bottom boxes share one frame, and the command strip keeps its slot (dimmed) while an action plays', async ({ page }) => {
  const errors = await open(page);
  const frames = (): Promise<Array<[number, number]>> => page.evaluate(() => window.__sc().hudObjects.frames.map((f) => [f.x, f.y] as [number, number]));
  // One band from the party table to the enemy box.
  expect(await frames()).toEqual([[4, 226]]);
  await page.evaluate(() => window.__sc().setPhase('act'));
  // The command box is gone (the existing rule), but its slot holds a standby strip, so the band has no hole.
  expect(await page.evaluate(() => !!window.__sc().hudObjects.box('commands'))).toBe(false);
  expect(await frames()).toEqual([[4, 226], [204, 226]]);
  await page.evaluate(() => window.__sc().setPhase('choose'));
  expect(await frames()).toEqual([[4, 226]]);
  // A box hidden by hand leaves the band and no standby strip appears for it.
  await page.evaluate(() => {
    const s = window.__sc();
    s.applyStage({ ...s.config, hud: { ...s.config.hud, commands: { ...s.config.hud.commands, show: 'never' } } });
    s.setPhase('act');
  });
  expect(await frames()).toEqual([]);
  expect(errors).toEqual([]);
});

test('two identical foes carry their A and B on the stage and the lone one carries none', async ({ page }) => {
  const errors = await open(page, '?clean&stage=street&set=3&phase=choose');
  const tags = await page.evaluate(() => (window.__sc().fighters as unknown as Array<{ side: string; barTag?: { visible: boolean; texture: { key: string } } }>).filter((f) => f.side === 'enemy').map((f) => (f.barTag?.visible ? f.barTag.texture.key.split('|')[0] : null)));
  // Punk, Punk, Glowrat: the two punks are A and B (their texture is the letter drawn), the rat has no tag.
  expect(tags.map((t) => t?.replace('bartag-', '') ?? null).sort()).toEqual([null, 'A', 'B'].sort());
  expect(errors).toEqual([]);
});

test('HUD regions and the shadow follow the config: move a box, hide one, change the shadow share', async ({ page }) => {
  const errors = await open(page);
  const where = (name: string): Promise<{ x: number; y: number } | null> => page.evaluate((n) => window.__sc().hudObjects.box(n) ?? null, name);
  expect(await where('partyStatus')).toMatchObject({ x: 4, y: 226 });
  await page.evaluate(() => {
    const s = window.__sc();
    s.applyStage({ ...s.config, hud: { ...s.config.hud, partyStatus: { ...s.config.hud.partyStatus, x: 40, y: 200 }, commands: { ...s.config.hud.commands, show: 'never' } } });
  });
  expect(await where('partyStatus')).toMatchObject({ x: 40, y: 200 });
  expect(await where('commands')).toBeNull();
  const snap = await page.evaluate(() => window.__stagelab?.snapshot() ?? Promise.reject(new Error('no hook')));
  expect(snap.colours).toBeGreaterThan(100);

  // A shadow slider: 30 steps, and the number of shadow textures never grows past the sizes in use (7 fighters at most).
  let most = 0;
  const widths = new Set<number>();
  for (let i = 0; i < 30; i++) {
    const share = 0.3 + i * 0.03;
    await page.evaluate((w) => {
      const s = window.__sc();
      s.applyStage({ ...s.config, shadow: { ...s.config.shadow, widthScale: w } });
    }, share);
    most = Math.max(most, await countOf(page, 'shadow-'));
    for (const w of await page.evaluate(() => window.__sc().fighters.map((f) => f.shadowW))) widths.add(w);
  }
  expect(most).toBeLessThanOrEqual(7);
  expect(widths.size).toBeGreaterThan(5);
  expect(errors).toEqual([]);
});

test('a figure is one unit in the sort: shadow, ring, body and health bar share its number, so a nearer fighter covers all of a farther one', async ({ page }) => {
  const errors = await open(page, '?set=6');
  const parts = await page.evaluate(() => {
    const s = window.__sc();
    return s.fighters.map((f) => ({ id: f.id, side: f.side, y: f.sortY, x: f.x, depth: f.depth, body: f.sprite.depth, shadow: f.shadow.depth, ring: f.ring.depth, bar: f.bar?.depth ?? null }));
  });
  expect(parts.filter((p) => p.side === 'enemy')).toHaveLength(6);
  for (const p of parts) {
    expect(p.body).toBe(p.depth);
    expect(p.shadow).toBe(p.depth - 0.5);
    expect(p.ring).toBe(p.depth - 0.4);
    if (p.side === 'enemy') expect(p.bar).toBe(p.depth + 0.25);
    else expect(p.bar).toBeNull();
  }
  // Any figure on a nearer row has a shadow above the farther figure's health bar.
  for (const far of parts) for (const near of parts) if (near.y > far.y) expect(near.shadow).toBeGreaterThan(far.bar ?? far.depth);
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
          if (f.sprite.x !== f.x + f.bodyDx + o.x || f.sprite.y !== f.y + 1 + o.y) bad.push(`${f.id} tick ${s.frame}: sway off`);
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

  // Find an opaque pixel of Kit (the lead, front hero) to grab: the hit test follows the drawn pixels.
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
  expect(grab.slot.row).toBe(4);

  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  const zoom = box.width / 480;
  const at = (gx: number, gy: number): [number, number] => [box.x + gx * zoom, box.y + gy * zoom];
  const [sx, sy] = at(grab.x, grab.y);
  // Drop so the FEET end up near row 2 (y 174) and x 120: the pointer keeps its offset from the feet.
  const targetFeet = { x: 120, y: 177 };
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
    return { slot: f.slot, x: f.x, y: f.sprite.y, depth: f.sprite.depth, shadowDepth: f.shadow.depth, rowY: s.config.rows[f.slot.row]?.y, saved: s.currentStage().party[0] };
  });
  // Snapped to the nearest row (2, y 174), x where it was dropped, depth and shadow follow, and the "save" copy of the config has it.
  expect(after.slot.row).toBe(2);
  expect(Math.abs(after.slot.x - targetFeet.x)).toBeLessThanOrEqual(3);
  expect(after.y).toBe((after.rowY ?? 0) + 1);
  const closeness = 240 - Math.min(240, Math.abs(after.x - 240));
  expect(after.depth).toBe((after.rowY ?? 0) * 1000 + closeness * 2);
  expect(after.shadowDepth).toBe(after.depth - 0.5);
  expect(after.saved).toEqual(after.slot);

  // Edit mode off again: nothing is pickable.
  await page.evaluate(() => window.__sc().setEditMode(false));
  expect(await page.evaluate(() => window.__sc().fighters.every((f) => !f.sprite.input?.enabled))).toBe(true);
  expect(errors).toEqual([]);
});
