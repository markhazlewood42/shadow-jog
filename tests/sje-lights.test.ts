/**
 * M5 task 2: `Lights` (src/sje/display/lights.ts, docs/engine/scene-graph.md section 11). The first form keeps today's canvas operations, so the
 * proof is a comparison with the old `Lighting` (src/field/lighting.ts): the same lights give the same operations in the same order, with the same
 * numbers. A recording stand-in for the 2D context logs every call and every property write; `document` is stubbed so the OLD code (which makes
 * its canvases with `document.createElement`) runs in Node against it.
 *
 * Controls: a one-pixel move, a wrong radius, a wrong intensity and a wrong frame each change the log, so the comparison can fail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flickerAmount as oldFlicker, Lighting } from '../src/field/lighting';
import type { BakedLight } from '../src/field/bake';
import { H, W } from '../src/sje/core/size';
import { flickerAmount, LIGHT_RES, Lights, parseRgb } from '../src/sje/display/lights';

/** What a recording context writes down: `op value` lines for calls, `prop = value` for property writes. */
interface Recorder {
  ctx: CanvasRenderingContext2D;
  log: string[];
}

interface FakeCanvas {
  width: number;
  height: number;
  /** The gradient stops drawn on this canvas, as text: lets a log say WHICH light sprite was drawn. */
  stops: string;
  log: string[];
  getContext(kind: string, opts?: unknown): CanvasRenderingContext2D;
}

const fmt = (v: unknown): string => (typeof v === 'object' && v !== null && 'stops' in (v as object) ? `sprite[${(v as { stops: string }).stops}]` : String(v));

function recorder(canvas: Partial<FakeCanvas> = {}): Recorder {
  const log: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_t, name: string) {
      if (name === 'canvas') return canvas;
      return (...args: unknown[]) => {
        if (name === 'createRadialGradient') {
          const g = {
            stops: '' as string,
            addColorStop(o: number, c: string): void {
              g.stops += `${o}:${c};`;
            },
          };
          return g;
        }
        log.push(`${name}(${args.map(fmt).join(',')})`);
        return undefined;
      };
    },
    set(_t, name: string, v) {
      log.push(`${name} = ${fmt(v)}`);
      if (name === 'fillStyle' && typeof v === 'object' && v && 'stops' in v) canvas.stops = (v as { stops: string }).stops;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, log };
}

const created: FakeCanvas[] = [];

function fakeCanvas(): FakeCanvas {
  const c: FakeCanvas = {
    width: 0,
    height: 0,
    stops: '',
    log: [],
    getContext() {
      const r = recorder(c);
      c.log = r.log;
      return r.ctx;
    },
  };
  created.push(c);
  return c;
}

beforeEach(() => {
  created.length = 0;
  vi.stubGlobal('document', { createElement: () => fakeCanvas() });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const LIGHTS: BakedLight[] = [
  { x: 100, y: 80, r: 30, color: '#86f08c', i: 0.5 },
  { x: 300, y: 200, r: 70, color: '#ff6a3a', i: 0.5, flicker: true },
  { x: 500, y: 120, r: 45, color: '#3fe0f0', i: 2.5 },
  { x: 40, y: 300, r: 20, color: '#ff4fb0', i: 1, flicker: true, seed: 17 },
  { x: -500, y: -500, r: 30, color: '#ffffff', i: 1 }, // far off screen
  { x: 900, y: 80, r: 50, color: '#ffcc3d', i: 0.3 }, // off screen at camera 0, in view when the camera moves
];

/** The old light map, built the old way, and the log of what it drew on its map context. */
function oldMap(lights: BakedLight[], ambient: string, camX: number, camY: number, frame: number, enabled = true): string[] {
  const first = created.length;
  const l = new Lighting();
  l.ambient = ambient;
  l.enabled = enabled;
  const mapCanvas = created[first];
  expect(mapCanvas, 'the old Lighting makes its map canvas first').toBeDefined();
  // `Lighting`'s own map canvas has had getContext called once (in `surface`); its recorder is the one the proxy returned.
  const log = mapCanvas?.log ?? [];
  log.length = 0;
  l.build(lights, camX, camY, frame);
  return [...log];
}

function newMap(lights: BakedLight[], ambient: string, camX: number, camY: number, frame: number, enabled = true): string[] {
  const set = new Lights();
  set.setAmbientColor(ambient);
  set.enabled = enabled;
  for (const l of lights) set.addLight(l.x, l.y, l.r, l.color, l.i, { flicker: l.flicker === true, ...(l.seed !== undefined ? { seed: l.seed } : {}) });
  const r = recorder();
  set.paint(r.ctx, camX, camY, frame);
  return r.log;
}

describe('Lights.paint: the old light map, operation for operation', () => {
  it('gives the log of the old Lighting.build for 40 frames and 4 camera positions', () => {
    let compared = 0;
    for (const [cx, cy] of [[0, 0], [250, 100], [-48, 0], [400, 312]]) {
      for (let frame = 0; frame < 40; frame += 1) {
        const want = oldMap(LIGHTS, '#605a86', cx ?? 0, cy ?? 0, frame);
        const got = newMap(LIGHTS, '#605a86', cx ?? 0, cy ?? 0, frame);
        expect(got, `camera ${cx},${cy} frame ${frame}`).toEqual(want);
        compared++;
      }
    }
    expect(compared).toBe(160);
  });

  it('the log is not empty and is what the design says: ambient fill, then lighter, then each light, then reset', () => {
    const log = newMap([{ x: 100, y: 80, r: 30, color: '#86f08c', i: 1 }], '#605a86', 20, 10, 0);
    expect(log[0]).toBe('globalCompositeOperation = source-over');
    expect(log[1]).toBe('fillStyle = #605a86');
    expect(log[2]).toBe(`fillRect(0,0,${W},${H})`);
    expect(log[3]).toBe('globalCompositeOperation = lighter');
    expect(log[4]).toBe('globalAlpha = 1');
    // x - camX - r = 100 - 20 - 30 = 50, y: 80 - 10 - 30 = 40, d = 60
    expect(log[5]).toMatch(/^drawImage\(sprite\[.*\],50,40,60,60\)$/);
    expect(log.slice(-2)).toEqual(['globalAlpha = 1', 'globalCompositeOperation = source-over']);
  });

  it('intensity above 1 draws a second pass: 2.5 is alpha 1, 1, 0.5', () => {
    const log = newMap([{ x: 200, y: 100, r: 20, color: '#ffffff', i: 2.5 }], '#000000', 0, 0, 0);
    const alphas = log.filter((l) => l.startsWith('globalAlpha =')).map((l) => Number(l.split('= ')[1]));
    expect(alphas.slice(0, 3)).toEqual([1, 1, 0.5]);
    expect(log.filter((l) => l.startsWith('drawImage'))).toHaveLength(3);
  });

  it('a light wholly off screen is not drawn; one whose edge touches the screen is', () => {
    const off = newMap([{ x: -31, y: 100, r: 30, color: '#ffffff', i: 1 }], '#000000', 0, 0, 0);
    expect(off.some((l) => l.startsWith('drawImage'))).toBe(false);
    const edge = newMap([{ x: -30, y: 100, r: 30, color: '#ffffff', i: 1 }], '#000000', 0, 0, 0);
    expect(edge.some((l) => l.startsWith('drawImage'))).toBe(true);
  });

  it('disabled lights fill only the ambient color', () => {
    const log = newMap(LIGHTS, '#101030', 0, 0, 0, false);
    expect(log).toEqual(['globalCompositeOperation = source-over', 'fillStyle = #101030', `fillRect(0,0,${W},${H})`]);
    expect(oldMap(LIGHTS, '#101030', 0, 0, 0, false)).toEqual(log);
  });

  it('CONTROL: a 1 px move, a wrong radius, a wrong intensity and a wrong frame each change the log', () => {
    const base = oldMap(LIGHTS, '#605a86', 0, 0, 5);
    const bent = (fn: (l: BakedLight[]) => void, frame = 5): string[] => {
      const copy = LIGHTS.map((l) => ({ ...l }));
      fn(copy);
      return newMap(copy, '#605a86', 0, 0, frame);
    };
    expect(newMap(LIGHTS, '#605a86', 0, 0, 5)).toEqual(base);
    expect(bent((l) => { (l[0] as BakedLight).x += 1; })).not.toEqual(base);
    expect(bent((l) => { (l[1] as BakedLight).r += 1; })).not.toEqual(base);
    expect(bent((l) => { (l[2] as BakedLight).i = 1.5; })).not.toEqual(base);
    expect(bent(() => undefined, 6)).not.toEqual(base);
    expect(newMap(LIGHTS, '#605a87', 0, 0, 5)).not.toEqual(base);
  });
});

describe('Lights.bloom: the old haze, operation for operation', () => {
  function oldBloom(camX: number, camY: number, frame: number, strength: number): string[] {
    const l = new Lighting();
    const r = recorder();
    l.bloom(r.ctx, LIGHTS, camX, camY, frame, strength);
    return r.log;
  }
  function newBloom(camX: number, camY: number, frame: number, strength: number): string[] {
    const set = new Lights();
    for (const l of LIGHTS) set.addLight(l.x, l.y, l.r, l.color, l.i, { flicker: l.flicker === true, ...(l.seed !== undefined ? { seed: l.seed } : {}) });
    const r = recorder();
    set.bloom(r.ctx, camX, camY, frame, strength);
    return r.log;
  }

  it('gives the log of the old Lighting.bloom, outdoors (0.14) and in an interior (0.08)', () => {
    for (const strength of [0.14, 0.08, 0.16]) {
      for (let frame = 0; frame < 30; frame++) {
        for (const [cx, cy] of [[0, 0], [300, 60]] as const) expect(newBloom(cx, cy, frame, strength)).toEqual(oldBloom(cx, cy, frame, strength));
      }
    }
  });

  it('skips dim lights (under 0.5), draws nothing at strength 0, and uses the haze radius 0.55 r', () => {
    const log = newBloom(0, 0, 0, 0.14);
    // 4 lights have i >= 0.5 and are on screen at camera 0: (100,80), (300,200), (500,120), (40,300). The 0.3 one and the off-screen ones are out.
    expect(log.filter((l) => l.startsWith('drawImage'))).toHaveLength(4);
    expect(newBloom(0, 0, 0, 0)).toEqual([]);
    // light 0: r = 30 * 0.55 = 16.5 -> d = round(33) = 33, corner round(100 - 16.5) = 84 (JS rounds .5 up), round(80 - 16.5) = 64
    expect(log.find((l) => l.startsWith('drawImage'))).toMatch(/,84,64,33,33\)$/);
  });
});

describe('Lights: the set and the flicker', () => {
  it('addLight returns a handle that removes just that light, and removing twice is safe', () => {
    const set = new Lights();
    const a = set.addLight(10, 10, 20);
    set.addLight(30, 30, 20, '#ff0000', 0.5);
    expect(set.count).toBe(2);
    a.remove();
    a.remove();
    expect(set.count).toBe(1);
    expect(set.lights[0]).toMatchObject({ x: 30, y: 30, r: 20, color: '#ff0000', i: 0.5, flicker: false });
    set.clear();
    expect(set.count).toBe(0);
  });

  it('defaults: white, intensity 1, ambient white, boost 0.32', () => {
    const set = new Lights();
    set.addLight(1, 2, 3);
    expect(set.lights[0]).toMatchObject({ color: '#ffffff', i: 1 });
    expect(set.ambientColor).toBe('#ffffff');
    expect(set.spriteBoost).toBe(0.32);
  });

  it('refuses a bad radius, intensity or color, in words', () => {
    const set = new Lights();
    expect(() => set.addLight(0, 0, 0)).toThrow('radius');
    expect(() => set.addLight(0, 0, -5)).toThrow('radius');
    expect(() => set.addLight(0, 0, 5, '#ffffff', -1)).toThrow('intensity');
    expect(() => set.addLight(0, 0, 5, 'red')).toThrow('#rrggbb');
    expect(() => set.setAmbientColor('0x00ff00')).toThrow('#rrggbb');
    expect(set.count).toBe(0);
    expect(parseRgb('#f80')).toEqual([255, 136, 0]);
  });

  it('flickerAmount is the old function: 1 for a steady light, the same wobble and dropout for a flicker', () => {
    expect(flickerAmount({ x: 5, y: 5 }, 100)).toBe(1);
    // The old function, over a grid of positions, seeds and 3,000 frames (the dropout hash included): the same number every time.
    for (const l of [{ x: 0, y: 0, r: 1, color: '#fff', i: 1, flicker: true }, { x: 300, y: 200, r: 1, color: '#fff', i: 1, flicker: true, seed: 17 }, { x: 41, y: 977, r: 1, color: '#fff', i: 1, flicker: true }, { x: 5, y: 5, r: 1, color: '#fff', i: 1 }]) {
      for (let f = 0; f < 3000; f++) expect(flickerAmount(l, f)).toBe(oldFlicker(l, f));
    }
    // And its shape: a dropout happens, is rare, and the rest stays near 0.85 to 1.
    const sample = (seed: number) => Array.from({ length: 2000 }, (_, f) => flickerAmount({ x: 0, y: 0, flicker: true, seed }, f));
    for (const seed of [0, 17, 123456]) {
      const a = sample(seed);
      expect(a.some((v) => v < 0.5)).toBe(true); // a dropout happens in 2000 frames
      expect(a.filter((v) => v < 0.5).length).toBeLessThan(80); // and it is rare (12 in 997)
      expect(Math.max(...a)).toBeLessThan(1.02);
      expect(Math.min(...a.filter((v) => v >= 0.5))).toBeGreaterThan(0.7);
    }
    // The default seed comes from the position, so two lights at different places flicker apart.
    expect(flickerAmount({ x: 1, y: 2, flicker: true }, 7)).toBe(flickerAmount({ x: 1, y: 2, flicker: true, seed: 1 * 13 + 2 * 7 }, 7));
    expect(flickerAmount({ x: 1, y: 2, flicker: true }, 7)).not.toBe(flickerAmount({ x: 9, y: 2, flicker: true }, 7));
  });

  it('the default sprite is a LIGHT_RES gradient with the old four stops, made once per color', () => {
    const set = new Lights();
    set.addLight(100, 100, 30, '#86f08c');
    set.addLight(200, 100, 30, '#86f08c');
    const r = recorder();
    set.paint(r.ctx, 0, 0, 0);
    const sprites = created.filter((c) => c.stops.length > 0);
    expect(sprites).toHaveLength(1);
    expect(sprites[0]?.width).toBe(LIGHT_RES);
    expect(sprites[0]?.stops).toBe('0:rgba(134,240,140,1);0.3:rgba(134,240,140,0.72);0.62:rgba(134,240,140,0.28);1:rgba(134,240,140,0);');
  });
});
