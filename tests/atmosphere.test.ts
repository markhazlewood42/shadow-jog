/** Weather and lighting: pooled, bounded, drawn in one pass, and cheap where it should be. */
import { beforeAll, describe, expect, it } from 'vitest';

/** A 2D context that records what's asked of it (node has no canvas). */
function recorder() {
  const calls = { fillStyle: 0, drawImage: 0, gradients: 0, fillRect: 0 };
  let style: unknown = '';
  const ctx = {
    get fillStyle() {
      return style;
    },
    set fillStyle(v: unknown) {
      calls.fillStyle++;
      style = v;
    },
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: false,
    fillRect: () => {
      calls.fillRect++;
    },
    drawImage: () => {
      calls.drawImage++;
    },
    createRadialGradient: () => {
      calls.gradients++;
      return { addColorStop: () => undefined };
    },
  };
  return { ctx, calls };
}

beforeAll(() => {
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => {
      const r = recorder();
      return { width: 0, height: 0, getContext: () => r.ctx };
    },
  };
});

describe('rain', () => {
  it('is drawn in one pass, back to front: three layer styles and the splashes, not a pass per layer', async () => {
    const { Weather } = await import('../src/field/weather');
    const w = new Weather();
    w.set('rain', 1);
    const depths = w.pool.map((d) => d.depth);
    expect([...depths].sort()).toEqual(depths);
    for (let i = 0; i < 300; i++) w.update(i % 7 === 0 ? 1 : 0, 0);
    // Respawning never changes a drop's layer: still ordered after hundreds of frames.
    expect(w.pool.map((d) => d.depth)).toEqual(depths);
    const { ctx, calls } = recorder();
    w.render(ctx as unknown as CanvasRenderingContext2D);
    expect(calls.fillStyle).toBe(4);
  });

  it('keeps a fixed pool: drops never grow, splashes stay under their cap', async () => {
    const { Weather } = await import('../src/field/weather');
    const w = new Weather();
    w.set('rain', 1);
    const n = w.pool.length;
    let most = 0;
    for (let i = 0; i < 2000; i++) {
      w.update(0, 0);
      most = Math.max(most, w.splashesLive);
    }
    expect(w.pool.length).toBe(n);
    expect(most).toBeGreaterThan(0);
    const { MAX_SPLASHES } = await import('../src/field/weather');
    expect(MAX_SPLASHES).toBe(107);
    expect(most).toBeLessThanOrEqual(MAX_SPLASHES);
  });

  it('scales the counts by the screen’s area, so the weather keeps its density per pixel', async () => {
    const { AREA_SCALE, DRIPS, DUST_MOTES, RAIN_DROPS, MAX_SPLASHES, Weather } = await import('../src/field/weather');
    const { H, W } = await import('../src/engine/game');
    // The old counts were tuned on 129,600 pixels (the 480x270 field).
    const ratio = (W * H) / 129_600;
    expect(AREA_SCALE).toBeCloseTo(ratio, 10);
    expect([RAIN_DROPS, DUST_MOTES, DRIPS, MAX_SPLASHES]).toEqual([Math.round(190 * ratio), Math.round(50 * ratio), Math.round(14 * ratio), Math.round(60 * ratio)]);
    // At 640x360 (area 1.78 times the old): the numbers the inventory predicted.
    expect([RAIN_DROPS, DUST_MOTES, DRIPS, MAX_SPLASHES]).toEqual([338, 89, 25, 107]);
    for (const [kind, n] of [['rain', RAIN_DROPS], ['dust', DUST_MOTES], ['drip', DRIPS]] as const) {
      const w = new Weather();
      w.set(kind, 1);
      expect(w.pool.length, kind).toBe(n);
    }
  });

  it('camera motion carries the near layer further than the far one (parallax)', async () => {
    const { Weather } = await import('../src/field/weather');
    const w = new Weather();
    w.set('rain', 1);
    const far = w.pool.find((d) => d.depth === 0)!, near = w.pool.find((d) => d.depth === 2)!;
    const fx = far.x, nx = near.x, fs = far.speed, ns = near.speed;
    w.update(10, 0);
    // x moves by speed*0.28 minus camera dx times the layer's parallax.
    const farShift = fx + fs * 0.28 - far.x, nearShift = nx + ns * 0.28 - near.x;
    expect(nearShift).toBeGreaterThan(farShift);
  });
});

describe('lighting', () => {
  it('culls lights off screen, and stacks a second pass only for intensity above 1', async () => {
    const { Lighting } = await import('../src/field/lighting');
    const lit = new Lighting();
    let n = 0;
    (lit.map.ctx as unknown as { drawImage: () => void }).drawImage = () => {
      n++;
    };
    lit.build([
      { x: 100, y: 100, r: 30, color: '#ff00ff', i: 0.8 },
      { x: 150, y: 100, r: 30, color: '#ff00ff', i: 1.6 },
      { x: -500, y: 100, r: 30, color: '#ff00ff', i: 1 },
    ], 0, 0, 0);
    // One pass for the dim light, two for the bright one, none for the one off screen.
    expect(n).toBe(3);
  });

  it('builds each light colour’s sprite once, however many lights and frames use it', async () => {
    const { Lighting } = await import('../src/field/lighting');
    const lit = new Lighting();
    let grads = 0;
    const doc = (globalThis as unknown as { document: { createElement: () => unknown } }).document;
    const make = doc.createElement;
    doc.createElement = () => {
      const c = make() as { getContext: () => { createRadialGradient: () => unknown } };
      const g = c.getContext();
      const real = g.createRadialGradient;
      g.createRadialGradient = () => {
        grads++;
        return real();
      };
      return c;
    };
    try {
      const lights = [1, 2, 3, 4].map((k) => ({ x: 40 * k, y: 60, r: 20, color: '#12ab34', i: 1 }));
      for (let f = 0; f < 30; f++) lit.build(lights, 0, 0, f);
      expect(grads).toBe(1);
    } finally {
      doc.createElement = make;
    }
  });

  it('flicker stays within a failing tube’s range and repeats exactly for the same frame', async () => {
    const { flickerAmount } = await import('../src/field/lighting');
    const light = { x: 3, y: 4, r: 10, color: '#fff', i: 1, flicker: true };
    for (let f = 0; f < 2000; f++) {
      const a = flickerAmount(light, f);
      expect(a).toBeGreaterThan(0.25);
      expect(a).toBeLessThanOrEqual(1);
      expect(flickerAmount(light, f)).toBe(a);
    }
    expect(flickerAmount({ ...light, flicker: false }, 5)).toBe(1);
  });
});
