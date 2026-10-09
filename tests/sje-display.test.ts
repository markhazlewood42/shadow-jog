/**
 * The new engine's Display (src/sje/runtime/display.ts): integer scale only (Mark dropped `fit` on 2026-10-09). In plain Node: with no canvas
 * the Display only computes the layout, and a stand-in target stands for the canvas where the pointer mapping is tested.
 *
 * Every check has a control: the same check on a stand-in that has the trap (the old `fit` rule, a mapping that ignores the bars) must fail.
 */
import { describe, expect, it } from 'vitest';
import { cssScaleFor } from '../src/engine/display';
import { H, W } from '../src/sje/core/size';
import { type PictureLayout, pictureLayout } from '../src/sje/render/presenter';
import { Display, type ScaleTarget } from '../src/sje/runtime/display';
import { Game } from '../src/sje/runtime/game';
import { noopInput } from './game-cases';

/** The windows of the design (frame-and-rendering.md 6.6): name, CSS size, device pixel ratio, expected k. */
const WINDOWS: ReadonlyArray<readonly [string, number, number, number, number]> = [
  ['640x360 at 1', 640, 360, 1, 1],
  ['720p', 1280, 720, 1, 2],
  ['the Steam Deck window', 1280, 800, 1, 2],
  ['1080p', 1920, 1080, 1, 3],
  ['1440p', 2560, 1440, 1, 4],
  ['4K', 3840, 2160, 1, 6],
  ['1536x864 (an awkward 2.4)', 1536, 864, 1, 2],
  ['ratio 2.25 on 1000x560', 1000, 560, 2.25, 3],
  ['a window smaller than the picture', 500, 300, 1, 1],
];

describe('Display: integer scale, the whole window', () => {
  for (const [name, vw, vh, dpr, k] of WINDOWS) {
    it(`${name}: k is ${k}, the picture is W*k by H*k on a whole device pixel, and the bars are even`, () => {
      const d = new Display();
      const l = d.resizeTo(vw, vh, dpr);
      expect(l.k).toBe(k);
      expect(d.k).toBe(k);
      expect(Number.isInteger(l.k) && Number.isInteger(l.x) && Number.isInteger(l.y)).toBe(true);
      expect([l.w, l.h]).toEqual([W * k, H * k]);
      const cw = Math.round(vw * dpr);
      const ch = Math.round(vh * dpr);
      // Centered to within one device pixel, never negative.
      if (cw >= l.w) expect(Math.abs(cw - l.w - 2 * l.x)).toBeLessThanOrEqual(1);
      if (ch >= l.h) expect(Math.abs(ch - l.h - 2 * l.y)).toBeLessThanOrEqual(1);
      expect(l.x).toBeGreaterThanOrEqual(0);
      expect(l.y).toBeGreaterThanOrEqual(0);
    });
  }

  it('the mode is integer and cannot be anything else (`fit` is gone)', () => {
    expect(new Display().mode).toBe('integer');
  });

  it('control: the old `fit` rule gives a fractional scale on 1536x864, which this Display never does', () => {
    // The old Display in fit mode: 1536x864 is a 2.4 fit that does not snap (2 is under 90% of 2.4). A whole k is what the new one gives.
    expect(Number.isInteger(cssScaleFor(1536, 864, 1, 'fit'))).toBe(false);
    expect(Number.isInteger(new Display().resizeTo(1536, 864, 1).k)).toBe(true);
  });

  it('on("resize") fires after each fit with the new layout already in place, and off() stops it', () => {
    const d = new Display();
    const seen: PictureLayout[] = [];
    const fn = () => seen.push(d.layout);
    d.on('resize', fn);
    d.resizeTo(1280, 720, 1);
    d.resizeTo(1920, 1080, 1);
    expect(seen.map((l) => l.k)).toEqual([2, 3]);
    d.off('resize', fn);
    d.resizeTo(640, 360, 1);
    expect(seen).toHaveLength(2);
  });

  it('the Game draws again at once after a resize (a resize clears the canvas); control: a Display nobody listens to draws nothing', () => {
    let draws = 0;
    const game = new Game({ renderer: { render: () => draws++ }, input: noopInput });
    expect(draws).toBe(0);
    game.scale.resizeTo(1280, 720, 1);
    expect(draws).toBe(1);
    game.scale.resizeTo(1920, 1080, 1);
    expect(draws).toBe(2);
    const lone = new Display();
    lone.resizeTo(1280, 720, 1);
    expect(draws).toBe(2);
  });
});

describe('Display.toGame: a pointer position to a game pixel', () => {
  /** A stand-in canvas: `deviceW` x `deviceH` backing pixels shown in a CSS box of `cssW` x `cssH` at (left, top). */
  function fakeTarget(deviceW: number, deviceH: number, cssW: number, cssH: number, left = 0, top = 0): ScaleTarget {
    const canvas = { width: deviceW, height: deviceH, getBoundingClientRect: () => ({ left, top, width: cssW, height: cssH }) } as unknown as HTMLCanvasElement;
    const picture = pictureLayout(deviceW, deviceH);
    return { canvas, picture, fitToWindow: () => picture.k };
  }

  it('the middle of the window is the middle of the picture, at every ratio', () => {
    for (const [dw, dh, cw, ch] of [
      [1280, 720, 1280, 720],
      [2560, 1440, 1280, 720],
      [2250, 1260, 1000, 560],
    ] as const) {
      const d = new Display(fakeTarget(dw, dh, cw, ch));
      d.resizeTo(cw, ch, dw / cw);
      const p = d.toGame(cw / 2, ch / 2);
      expect(p.x).toBeCloseTo(W / 2, 1);
      expect(p.y).toBeCloseTo(H / 2, 1);
    }
  });

  it('with letterbox bars, the top-left of the picture is game pixel 0,0 and a click in the bar is outside', () => {
    // 1280x800 shows a 1280x720 picture with 40 px bars above and below.
    const d = new Display(fakeTarget(1280, 800, 1280, 800));
    d.resizeTo(1280, 800, 1);
    const corner = d.toGame(0, 40);
    expect(corner.x).toBeCloseTo(0, 5);
    expect(corner.y).toBeCloseTo(0, 5);
    expect(d.toGame(100, 10).y).toBeLessThan(0);
  });

  it('control: a mapping that ignores the bars is told apart (it puts the top of the bar at 0,0)', () => {
    const d = new Display(fakeTarget(1280, 800, 1280, 800));
    d.resizeTo(1280, 800, 1);
    const ignoringBars = (x: number, y: number) => ({ x: x / d.k, y: y / d.k });
    expect(ignoringBars(0, 40).y).not.toBeCloseTo(d.toGame(0, 40).y, 1);
  });

  it('a canvas shown inside an offset box maps from the box, not from the window', () => {
    const d = new Display(fakeTarget(1280, 720, 1280, 720, 100, 50));
    d.resizeTo(1280, 720, 1);
    const p = d.toGame(100 + 640, 50 + 360);
    expect(p.x).toBeCloseTo(W / 2, 1);
    expect(p.y).toBeCloseTo(H / 2, 1);
  });
});
