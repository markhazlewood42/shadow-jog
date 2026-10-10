/**
 * M5 task 2: `Camera.pan` with easing and bounds (docs/engine/scene-graph.md section 5).
 *
 * The reference is the old field: the END point is `cameraOrigin` (`src/scenes/fieldkit/camera.ts`, the rule that `FieldScene.targetCam` and the
 * scripted `pan()` share), and each STEP is `FieldScene.updateCamera`'s (`src/scenes/field.ts`): ease-in-out quad over `frames`, rounded to a whole
 * pixel, done on the tick `t == frames`. The step formula is written out below from that code, as the spec. Every check has a control: a build
 * with the trap on purpose (a linear ease, no bounds, a bad rounding), which must give a different answer.
 */
import { describe, expect, it } from 'vitest';
import { H, TICK_MS, W } from '../src/sje/core/size';
import { Camera, CameraManager } from '../src/sje/display/camera';
import { Container } from '../src/sje/display/container';
import { TextureManager } from '../src/sje/display/texturemanager';
import { cameraOrigin } from '../src/scenes/fieldkit/camera';

function rig() {
  const host = { textures: new TextureManager() };
  const world = new Container(host, 0, 0, 'world');
  const ui = new Container(host, 0, 0, 'ui');
  const camera = new Camera(world);
  /** Run n ticks and return the scroll after each. */
  const run = (n: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      camera.update();
      out.push([camera.scrollX, camera.scrollY]);
    }
    return out;
  };
  return { host, world, ui, camera, run };
}

/** `FieldScene.updateCamera`, written out: the origin after `t` ticks of a pan of `frames` from (sx, sy) to (x, y). */
function legacyStep(sx: number, sy: number, x: number, y: number, frames: number, t: number): [number, number] {
  const k = Math.min(1, t / frames);
  const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
  return [Math.round(sx + (x - sx) * e), Math.round(sy + (y - sy) * e)];
}

describe('Camera.pan: the steps', () => {
  it('moves like the field\'s pan: ease-in-out quad, whole pixels, arriving on the last tick (40 frames)', () => {
    const { camera, run } = rig();
    camera.setScroll(100, 60);
    // Centered on (700, 500): the origin is (700 - W/2, 500 - H/2).
    const tx = 700 - W / 2;
    const ty = 500 - H / 2;
    camera.pan(700, 500, 40 * TICK_MS);
    const got = run(40);
    const want = Array.from({ length: 40 }, (_, i) => legacyStep(100, 60, tx, ty, 40, i + 1));
    expect(got).toEqual(want);
    expect(got[39]).toEqual([tx, ty]);
    // It really eased: the first step is tiny, the middle is the half way point.
    expect(got[0]?.[0]).toBeLessThan(105);
    expect(got[19]?.[0]).toBeGreaterThan(100 + (tx - 100) * 0.4);
    expect(got[19]?.[0]).toBeLessThan(100 + (tx - 100) * 0.6);
  });

  it('CONTROL: a linear pan gives other steps, so the test above depends on the ease', () => {
    const lin = rig();
    lin.camera.setScroll(100, 60);
    lin.camera.pan(700, 500, 40 * TICK_MS, 'linear');
    const got = lin.run(40);
    const quad = Array.from({ length: 40 }, (_, i) => legacyStep(100, 60, 700 - W / 2, 500 - H / 2, 40, i + 1));
    expect(got).not.toEqual(quad);
    expect(got[0]?.[0]).toBeGreaterThan(105); // linear starts at once
    expect(got[39]).toEqual([700 - W / 2, 500 - H / 2]);
  });

  it('a duration in milliseconds is a whole number of ticks, at least one', () => {
    for (const frames of [1, 2, 30, 60]) {
      const { camera, run } = rig();
      camera.pan(1000, 700, frames * TICK_MS);
      const got = run(frames - 1);
      // Still running one tick before the end (the last step may round onto the end point, so the position cannot say), arrived on the last.
      expect(camera.isPanning).toBe(true);
      expect(run(1)[0]).toEqual([1000 - W / 2, 700 - H / 2]);
      expect(camera.isPanning).toBe(false);
      expect(got).toHaveLength(frames - 1);
    }
    const { camera, run } = rig();
    camera.pan(1000, 700, 0);
    expect(run(1)[0]).toEqual([1000 - W / 2, 700 - H / 2]);
  });

  it('writes the world position (the scroll, negated), so the picture moves with it', () => {
    const { camera, world, run } = rig();
    camera.pan(900, 600, 10 * TICK_MS);
    run(10);
    expect([world.x, world.y]).toEqual([-(900 - W / 2), -(600 - H / 2)]);
  });

  it('every step is a whole pixel and never -0', () => {
    const { camera, run } = rig();
    camera.pan(W / 2 + 7, H / 2 + 3, 33 * TICK_MS);
    for (const [x, y] of run(33)) {
      expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
      expect(Object.is(x, -0) || Object.is(y, -0)).toBe(false);
    }
  });
});

describe('Camera.pan: arriving', () => {
  it('runs done once, on the tick it arrives, and the camera stops being busy', () => {
    const { camera } = rig();
    const calls: number[] = [];
    let tick = 0;
    camera.pan(800, 400, 5 * TICK_MS, 'quadInOut', () => calls.push(tick));
    expect(camera.isPanning).toBe(true);
    expect(camera.busy).toBe(true);
    for (tick = 1; tick <= 8; tick++) camera.update();
    expect(calls).toEqual([5]);
    expect(camera.isPanning).toBe(false);
    expect(camera.busy).toBe(false);
  });

  it('a done callback may start the next pan (a chain of pans)', () => {
    const { camera } = rig();
    const seen: string[] = [];
    camera.pan(800, 400, 2 * TICK_MS, 'linear', () => {
      seen.push('first');
      camera.pan(1000, 600, 2 * TICK_MS, 'linear', () => seen.push('second'));
    });
    for (let i = 0; i < 6; i++) camera.update();
    expect(seen).toEqual(['first', 'second']);
    expect([camera.scrollX, camera.scrollY]).toEqual([1000 - W / 2, 600 - H / 2]);
  });

  it('a new pan replaces a running one and starts from where the camera is; the old done never runs', () => {
    const { camera, run } = rig();
    let oldDone = 0;
    camera.pan(1500, 900, 20 * TICK_MS, 'linear', () => oldDone++);
    const mid = run(10)[9] as [number, number];
    camera.pan(200, 100, 10 * TICK_MS, 'linear');
    const got = run(10);
    expect(oldDone).toBe(0);
    expect(got[0]?.[0]).toBeLessThan(mid[0]); // moving back toward the new target from `mid`
    expect(got[9]).toEqual([200 - W / 2, 100 - H / 2]);
  });

  it('setScroll during a pan is overwritten by the next tick (the pan does not stop for it)', () => {
    const { camera, run } = rig();
    camera.pan(900, 500, 10 * TICK_MS, 'linear');
    run(3);
    camera.setScroll(0, 0);
    const after = run(1)[0] as [number, number];
    expect(after[0]).toBeGreaterThan(0);
    expect(run(7)[6]).toEqual([900 - W / 2, 500 - H / 2]);
  });
});

describe('Camera.pan: bounds and the small-room rule', () => {
  it('a target outside the bounds lands on the bounds, on every step', () => {
    const { camera, run } = rig();
    camera.setBounds(0, 0, 960, 672); // the world map
    camera.pan(5000, 5000, 20 * TICK_MS, 'linear');
    const got = run(20);
    expect(got[19]).toEqual([960 - W, 672 - H]);
    for (const [x, y] of got) {
      expect(x).toBeLessThanOrEqual(960 - W);
      expect(y).toBeLessThanOrEqual(672 - H);
    }
    camera.pan(-4000, -4000, 5 * TICK_MS);
    expect(run(5)[4]).toEqual([0, 0]);
  });

  it('CONTROL: with no bounds the same pan goes past the map edge', () => {
    const { camera, run } = rig();
    camera.pan(5000, 5000, 20 * TICK_MS, 'linear');
    expect(run(20)[19]).toEqual([5000 - W / 2, 5000 - H / 2]);
  });

  it('a map smaller than the view is centered whatever the pan target is (negative origin)', () => {
    const { camera, run } = rig();
    camera.setBounds(0, 0, 544, 300); // narrower and shorter than the view
    camera.pan(100, 100, 6 * TICK_MS);
    const end = run(6)[5];
    expect(end).toEqual([Math.round((544 - W) / 2), Math.round((300 - H) / 2)]);
    expect(end?.[0]).toBeLessThan(0);
    expect(end?.[1]).toBeLessThan(0);
  });

  it('the end point equals cameraOrigin (the field\'s rule) for maps of every size and many focus points', () => {
    const sizes: [number, number][] = [[960, 672], [896, 640], [544, 448], [224, 160], [W, H], [W + 1, H + 1], [352, 640]];
    const focus: [number, number][] = [[0, 0], [W / 2, H / 2], [100, 700], [500, 300], [900, 650], [959, 671], [333, 111], [4000, 4000], [-50, -50]];
    let checked = 0;
    for (const [mw, mh] of sizes) {
      for (const [fx, fy] of focus) {
        const { camera, run } = rig();
        camera.setBounds(0, 0, mw, mh);
        camera.pan(fx, fy, 3 * TICK_MS);
        const end = run(3)[2];
        const want = cameraOrigin(fx, fy, mw, mh);
        expect(end, `${mw}x${mh} focus ${fx},${fy}`).toEqual([want.x, want.y]);
        checked++;
      }
    }
    expect(checked).toBe(sizes.length * focus.length);
  });

  it('the pop-in camera box (a side that replaces the map edge) is bounds with that range', () => {
    // box { minX: -96, maxX: 400, minY: 0 } on a 960x672 map: the range is [minX, maxX] on x and the default on y.
    const box = { minX: -96, maxX: 400 };
    const { camera, run } = rig();
    camera.setBounds(box.minX, 0, box.maxX - box.minX + W, 672);
    for (const [fx, fy] of [[50, 100], [700, 300], [-300, 600]] as const) {
      camera.pan(fx, fy, 2 * TICK_MS);
      const end = run(2)[1];
      const want = cameraOrigin(fx, fy, 960, 672, box);
      expect(end, `focus ${fx},${fy}`).toEqual([want.x, want.y]);
    }
  });
});

describe('Camera.pan: the ui camera and the manager', () => {
  it('the ui camera never pans (it never scrolls)', () => {
    const { world, ui } = rig();
    const cams = new CameraManager(world, ui);
    expect(() => cams.ui.pan(10, 10, 100)).toThrow('never scrolls');
    expect(() => cams.main.pan(10, 10, 100)).not.toThrow();
  });

  it('CameraManager.update advances the main camera\'s pan', () => {
    const { world, ui } = rig();
    const cams = new CameraManager(world, ui);
    cams.main.pan(W / 2 + 40, H / 2, 4 * TICK_MS, 'linear');
    for (let i = 0; i < 4; i++) cams.update();
    expect(cams.main.scrollX).toBe(40);
  });
});
