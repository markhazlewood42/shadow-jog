/**
 * The field camera rule (src/scenes/fieldkit/camera.ts): a map smaller than the view is centered,
 * a larger map keeps the view inside itself. The scene's camera and the scripted pan() share it.
 * The sizes are written relative to W and H, so the test holds at 480x270 and at 640x360 alike.
 */
import { describe, expect, it } from 'vitest';
import { H, W } from '../src/engine/game';
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
    // The Rustyard at 640x360: 544 wide (narrower) by 448 tall (taller).
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
