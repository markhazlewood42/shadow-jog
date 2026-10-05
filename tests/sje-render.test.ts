/**
 * Engine level 1 (src/sje/render), the parts that can be checked without a GPU:
 * the context options, the integer scale maths and the GlHandoff call order.
 * The pixels themselves are checked in the browser by e2e/sjelab.spec.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { createGlContext } from '../src/sje/render/glcontext';
import { GlHandoff } from '../src/sje/render/glhandoff';
import type { PixiRenderer } from '../src/sje/render/pixirenderer';
import { alignedOffset, integerScale } from '../src/sje/render/presenter';

describe('GlContext', () => {
  function fakeCanvas(gl: unknown) {
    const listeners = new Map<string, (e: Event) => void>();
    return {
      canvas: {
        getContext: vi.fn(() => gl),
        addEventListener: (name: string, fn: (e: Event) => void) => listeners.set(name, fn),
      } as unknown as HTMLCanvasElement,
      fire: (name: string, e: Partial<Event> = {}) => listeners.get(name)?.(e as Event),
    };
  }

  it('asks for exactly the design’s context: webgl2, stencil on, no antialias, no alpha, no depth, high performance', () => {
    const { canvas } = fakeCanvas({ isContextLost: () => false, getExtension: () => null });
    createGlContext(canvas);
    expect(canvas.getContext).toHaveBeenCalledWith('webgl2', { stencil: true, antialias: false, alpha: false, depth: false, powerPreference: 'high-performance' });
  });

  it('returns null when the browser gives no WebGL2 context (the caller shows "failed to start")', () => {
    expect(createGlContext(fakeCanvas(null).canvas)).toBeNull();
  });

  it('does not look at the renderer name: a software renderer is accepted (the old presenter refused it)', () => {
    const getParameter = vi.fn();
    const gl = { isContextLost: () => false, getParameter, getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 1 }) };
    expect(createGlContext(fakeCanvas(gl).canvas)).not.toBeNull();
    expect(getParameter).not.toHaveBeenCalled();
  });

  it('keeps the lose-context extension from the start: after a loss getExtension() returns null', () => {
    const ext = { loseContext: vi.fn(), restoreContext: vi.fn() };
    let lost = false;
    const gl = { isContextLost: () => lost, getExtension: () => (lost ? null : ext) };
    const glc = createGlContext(fakeCanvas(gl).canvas);
    glc?.forceLoss();
    lost = true;
    glc?.forceRestore(); // must still reach the extension, though getExtension() now says null
    expect(ext.loseContext).toHaveBeenCalledTimes(1);
    expect(ext.restoreContext).toHaveBeenCalledTimes(1);
  });

  it('tracks loss and restore, and prevents the default on loss (that is what lets the browser restore it)', () => {
    let lost = false;
    const { canvas, fire } = fakeCanvas({ isContextLost: () => lost, getExtension: () => null });
    const glc = createGlContext(canvas);
    const events: string[] = [];
    glc?.on('lost', () => events.push('lost'));
    glc?.on('restored', () => events.push('restored'));
    const preventDefault = vi.fn();
    expect(glc?.lost).toBe(false);
    lost = true;
    fire('webglcontextlost', { preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(glc?.lost).toBe(true);
    lost = false;
    fire('webglcontextrestored');
    expect(glc?.lost).toBe(false);
    expect(events).toEqual(['lost', 'restored']);
  });
});

describe('integerScale: the whole-number zoom in device pixels (Display, integer mode)', () => {
  it('k = floor(fit * dpr), at least 1', () => {
    expect(integerScale(960, 540, 1)).toBe(2);
    expect(integerScale(1920, 1080, 1)).toBe(4);
    expect(integerScale(1600, 900, 1.25)).toBe(4); // fit 3.33 * 1.25 = 4.17
    expect(integerScale(1300, 730, 1.5)).toBe(4); // fit 2.7 * 1.5 = 4.06
    expect(integerScale(960, 540, 2)).toBe(4);
    expect(integerScale(480, 270, 1)).toBe(1);
    expect(integerScale(200, 100, 1)).toBe(1); // smaller than the picture: still 1
  });

  it('the window’s shorter side decides (letterbox, never crop)', () => {
    expect(integerScale(1920, 540, 1)).toBe(2);
    expect(integerScale(480, 1080, 1)).toBe(1);
  });

  it('is not fooled by float error on an exact fit', () => {
    // 1536 / 480 = 3.2 and 3.2 * 1.25 is 4.000000000000001 or 3.9999999999999996 depending on rounding.
    expect(integerScale(1536, 864, 1.25)).toBe(4);
    expect(integerScale(1920, 1080, 1.25)).toBe(5);
  });
});

describe('GlHandoff, the one module that touches shared GL state', () => {
  function setup() {
    const log: string[] = [];
    const gl = { clearColor: (...a: number[]) => log.push(`clearColor(${a.join(',')})`) } as unknown as WebGL2RenderingContext;
    const pixi = { resetState: () => log.push('pixi.resetState') } as unknown as PixiRenderer;
    const three = { resetState: () => log.push('three.resetState') };
    return { log, handoff: new GlHandoff(gl, pixi), three };
  }

  it('beginPixi makes Pixi forget its cached GL state', () => {
    const { log, handoff } = setup();
    handoff.beginPixi();
    expect(log).toEqual(['pixi.resetState']);
  });

  it('beginThree makes Three forget its state', () => {
    const { log, handoff, three } = setup();
    handoff.beginThree(three);
    expect(log).toEqual(['three.resetState']);
  });

  it('endThree resets Three AGAIN, then sets the clear colour back to 0,0,0,0 (the stale clear colour fix)', () => {
    const { log, handoff, three } = setup();
    handoff.endThree(three);
    expect(log).toEqual(['three.resetState', 'clearColor(0,0,0,0)']);
  });

  it('the full per-frame order with 3D active: Three in, Three out, Pixi in', () => {
    const { log, handoff, three } = setup();
    handoff.beginThree(three);
    log.push('three.render');
    handoff.endThree(three);
    handoff.beginPixi();
    expect(log).toEqual(['three.resetState', 'three.render', 'three.resetState', 'clearColor(0,0,0,0)', 'pixi.resetState']);
  });
});

describe('alignedOffset: the canvas starts on a whole device pixel', () => {
  const deviceOf = (css: number, dpr: number) => css * dpr;
  it('is half of the free room, rounded down to a multiple of q CSS pixels when dpr is p/q', () => {
    expect(alignedOffset(100, 1)).toBe(50);
    expect(alignedOffset(45, 1)).toBe(22); // dpr 1: whole CSS pixels
    expect(alignedOffset(45, 1.25)).toBe(20); // dpr 5/4: multiples of 4 (22.5 -> 20)
    expect(alignedOffset(45, 1.5)).toBe(22); // dpr 3/2: multiples of 2 (22.5 -> 22)
    expect(alignedOffset(45, 2)).toBe(22);
  });
  it('always lands on a whole device pixel, and never goes negative', () => {
    for (const dpr of [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3]) {
      for (const free of [0, 1, 7, 45, 133.4, 400, 999]) {
        const off = alignedOffset(free, dpr);
        expect(off).toBeGreaterThanOrEqual(0);
        expect(off).toBeLessThanOrEqual(free / 2 + 1e-9);
        expect(Math.abs(deviceOf(off, dpr) - Math.round(deviceOf(off, dpr)))).toBeLessThan(1e-9);
      }
    }
    expect(alignedOffset(-50, 1.5)).toBe(0); // a window smaller than the picture: the corner
  });
  it('falls back to whole device pixels for a ratio with no small denominator', () => {
    const off = alignedOffset(100, 1.3333333333);
    expect(Number.isFinite(off)).toBe(true);
    expect(off).toBeLessThanOrEqual(50);
  });
});
