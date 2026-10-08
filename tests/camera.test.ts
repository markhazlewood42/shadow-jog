/**
 * The field camera rule (src/scenes/fieldkit/camera.ts): a map smaller than the view is centered,
 * a larger map keeps the view inside itself. The scene's camera and the scripted pan() share it.
 * The sizes are written relative to W and H, so the test holds at 480x270 and at 640x360 alike.
 */
import { describe, expect, it } from 'vitest';
import { H, W } from '../src/engine/game';
import type { FieldScene } from '../src/scenes/field';
import { scriptApi } from '../src/scenes/fieldkit/api';
import { cameraOrigin } from '../src/scenes/fieldkit/camera';
import type { CameraBox } from '../src/scenes/fieldkit/popins';

describe('cameraOrigin', () => {
  it('centers a map smaller than the view in both axes, whatever the focus point', () => {
    // A room like Loading Dock 7: narrower and shorter than the view. The origin is the same even
    // margin on every side, and the focus point does not move it.
    const mw = W - 160, mh = H - 46;
    const at = cameraOrigin(10, 10, mw, mh);
    expect(at).toEqual({ x: Math.round((mw - W) / 2), y: Math.round((mh - H) / 2) });
    expect(cameraOrigin(mw - 10, mh - 10, mw, mh)).toEqual(at);
    expect(at.x).toBeLessThan(0);
    expect(at.y).toBeLessThan(0);
  });

  it('centers one axis and clamps the other on a map narrower than the view but taller', () => {
    // A courtyard like the Rustyard (544 by 448 px, which at 640x360 is narrower than the view by
    // 96 px and taller by 88 px): here narrower by 96 px and taller by 178 px, a stand-in that is
    // clearly taller. Written relative to W and H, so it holds at any screen size.
    const mw = W - 96, mh = H + 178;
    expect(cameraOrigin(0, 0, mw, mh)).toEqual({ x: -48, y: 0 });
    expect(cameraOrigin(mw, mh, mw, mh)).toEqual({ x: -48, y: mh - H });
    expect(cameraOrigin(mw / 2, mh / 2, mw, mh)).toEqual({ x: -48, y: Math.round(mh / 2 - H / 2) });
  });

  it('keeps the view inside a map larger than the view', () => {
    // A stand-in larger than the view in both axes: 416 px wider and 370 px taller than the view.
    // (Lantern Row, 896x640, was exactly this much larger than the old 480x270 view; at 640x360
    // it is 256 wider and 280 taller, so the numbers are written relative to W and H instead.)
    const mw = W + 416, mh = H + 370;
    expect(cameraOrigin(0, 0, mw, mh)).toEqual({ x: 0, y: 0 });
    expect(cameraOrigin(mw, mh, mw, mh)).toEqual({ x: mw - W, y: mh - H });
    const fx = mw / 2 + 3, fy = mh / 2 - 7;
    expect(cameraOrigin(fx, fy, mw, mh)).toEqual({ x: Math.round(fx - W / 2), y: Math.round(fy - H / 2) });
  });

  it('puts a map exactly the size of the view at the origin', () => {
    expect(cameraOrigin(123, 45, W, H)).toEqual({ x: 0, y: 0 });
  });
});

/**
 * The scripted camera pan (`pan()` in fieldkit/api.ts) must use the same rule as the scene's own
 * camera. The scene here is a stand-in with only the members `pan()` touches. A pan that went
 * back to its own clamp (clamp to the map, no centering) would aim a small map's camera at 0,0
 * instead of its centered origin, and the cutscene would end on a different frame than the camera
 * rests on afterwards.
 */
describe('scripted pan() uses the camera rule', () => {
  const TS = 16;
  function fakeScene(mapTilesW: number, mapTilesH: number) {
    const panTarget: { current: { x: number; y: number; frames: number; res?: () => void } | null } = { current: null };
    const waits: number[] = [];
    const f = {
      map: { w: mapTilesW, h: mapTilesH },
      def: { id: 'a_test_map' },
      camX: 7,
      camY: 9,
      camOverride: null as { x: number; y: number } | null,
      // The pop-in table's camera limit and event curtain (fieldkit/popins.ts), as the scene holds them.
      cameraBox: null as CameraBox | null,
      curtainEvent: 'relay_b' as string | null,
      // The scene's frame wait, recorded: a pan that must hold asks for it.
      game: { wait: (n: number) => { waits.push(n); return Promise.resolve(); } },
      waits,
      get panTarget() { return panTarget.current; },
      set panTarget(v) { panTarget.current = v; },
    };
    return { f, scene: f as unknown as FieldScene };
  }

  it('aims a map smaller than the view at its centered origin, not at 0,0', () => {
    // 15 by 9 tiles is smaller than the view at both 480x270 and 640x360 (240 by 144 px).
    const { f, scene } = fakeScene(15, 9);
    void scriptApi(scene).pan(2, 3, 25);
    const want = cameraOrigin(2 * TS + 8, 3 * TS + 8, 15 * TS, 9 * TS);
    expect(want.x).toBeLessThan(0);
    expect(f.panTarget).toMatchObject({ x: want.x, y: want.y, frames: 25 });
    expect(f.camOverride).toEqual({ x: 2 * TS + 8, y: 3 * TS + 8 });
  });

  it('aims a large map at the focus point, clamped inside the map', () => {
    const { f, scene } = fakeScene(60, 50);
    void scriptApi(scene).pan(0, 0);
    expect(f.panTarget).toMatchObject({ x: 0, y: 0, frames: 40 });
    void scriptApi(scene).pan(59, 49);
    expect(f.panTarget).toMatchObject({ x: 60 * TS - W, y: 50 * TS - H });
  });

  it('uses the scene’s camera limit, so a pan lands where the limited camera rests', () => {
    const { f, scene } = fakeScene(60, 50);
    f.cameraBox = { maxX: 100 };
    void scriptApi(scene).pan(59, 0);
    expect(f.panTarget).toMatchObject({ x: 100 });
  });

  it('holds on the pan the table names (P3, the lattice shutdown), and on no other pan', async () => {
    const { f, scene } = fakeScene(60, 50);
    f.def.id = 'annex';
    let landed = false;
    void scriptApi(scene).pan(30, 7).then(() => { landed = true; });
    f.panTarget?.res?.();
    expect(f.waits).toEqual([40]);
    await Promise.resolve();
    await Promise.resolve();
    expect(landed).toBe(true);
    // The same map, another tile: no hold.
    void scriptApi(scene).pan(30, 8);
    f.panTarget?.res?.();
    expect(f.waits).toEqual([40]);
  });

  it('lifts an event curtain (a pan is the reveal beat), and does not hold on a pan the table does not name', () => {
    const { f, scene } = fakeScene(60, 50);
    expect(f.curtainEvent).toBe('relay_b');
    void scriptApi(scene).pan(10, 10);
    expect(f.curtainEvent).toBeNull();
    f.panTarget?.res?.();
    expect(f.waits).toEqual([]);
  });
});

describe('cameraOrigin with a camera limit (the pop-in table)', () => {
  const mw = W + 400, mh = H + 300;
  it('is the plain rule when no side is limited', () => {
    expect(cameraOrigin(10, 10, mw, mh, {})).toEqual(cameraOrigin(10, 10, mw, mh));
    expect(cameraOrigin(mw, mh, mw, mh, null)).toEqual({ x: mw - W, y: mh - H });
  });

  it('stops the camera short of the map edge when a limit is tighter', () => {
    expect(cameraOrigin(mw, mh, mw, mh, { maxX: 50, maxY: 20 })).toEqual({ x: 50, y: 20 });
    expect(cameraOrigin(0, 0, mw, mh, { minX: 30, minY: 40 })).toEqual({ x: 30, y: 40 });
  });

  it('lets the camera go past the map edge when a limit is looser, on that side only', () => {
    const o = cameraOrigin(mw, mh, mw, mh, { maxY: mh - H + 40 });
    expect(o.x).toBe(mw - W);
    expect(o.y).toBe(mh - H + 40);
  });

  it('does not move a map smaller than the view: it stays centered', () => {
    expect(cameraOrigin(0, 0, W - 96, H - 40, { minX: 10, maxX: 20 })).toEqual(cameraOrigin(0, 0, W - 96, H - 40));
  });
});
