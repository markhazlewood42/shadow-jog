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
    const mw = W + 416, mh = H + 370; // Lantern Row at 480x270
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
    const panTarget: { current: { x: number; y: number; frames: number } | null } = { current: null };
    const f = {
      map: { w: mapTilesW, h: mapTilesH },
      camX: 7,
      camY: 9,
      camOverride: null as { x: number; y: number } | null,
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
});
