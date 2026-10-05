/**
 * Engine level 1 (src/sje/render), the parts that can be checked without a GPU:
 * the context options, the integer scale maths and the GlHandoff call order.
 * The pixels themselves are checked in the browser by e2e/sjelab.spec.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGlContext, probeWebGL2, resetProbeWebGL2 } from '../src/sje/render/glcontext';
import type { BackBuffer } from '../src/sje/render/backbuffer';
import { GlHandoff } from '../src/sje/render/glhandoff';
import type { PixiRenderer } from '../src/sje/render/pixirenderer';
import { deviceSize, integerScale, pictureLayout, Presenter } from '../src/sje/render/presenter';

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

describe('probeWebGL2: asks the browser, makes ONE context, and keeps it', () => {
  afterEach(() => {
    resetProbeWebGL2();
    vi.unstubAllGlobals();
  });
  const stub = (gl: unknown) => {
    const made: Array<{ width: number; height: number; getContext: ReturnType<typeof vi.fn> }> = [];
    vi.stubGlobal('document', {
      createElement: () => {
        const canvas = { width: 300, height: 150, getContext: vi.fn(() => gl) };
        made.push(canvas);
        return canvas;
      },
    });
    return made;
  };

  it('asks for a webgl2 context, on a 1 pixel canvas', () => {
    const made = stub({});
    expect(probeWebGL2()).toBe(true);
    expect(made).toHaveLength(1);
    expect(made[0]?.getContext).toHaveBeenCalledWith('webgl2');
    expect([made[0]?.width, made[0]?.height]).toEqual([1, 1]);
  });

  it('a second call answers from the same context: no second context (the browser drops the OLDEST past about 16), and no "context lost" warning each time', () => {
    const made = stub({});
    for (let i = 0; i < 20; i++) expect(probeWebGL2()).toBe(true);
    expect(made).toHaveLength(1);
  });

  it('a browser with no WebGL2 says false, and does NOT remember it (a blocked GPU may come back)', () => {
    const made = stub(null);
    expect(probeWebGL2()).toBe(false);
    expect(probeWebGL2()).toBe(false);
    expect(made).toHaveLength(2); // asked again each time
    vi.stubGlobal('document', { createElement: () => ({ width: 1, height: 1, getContext: () => ({}) }) });
    expect(probeWebGL2()).toBe(true); // the GPU came back
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

describe('GlHandoff, the Three side and the raw GL it owns (B2)', () => {
  function setup(opts: { errors?: number[] } = {}) {
    const log: string[] = [];
    const errors = [...(opts.errors ?? [])];
    const gl = {
      UNPACK_FLIP_Y_WEBGL: 37440,
      UNPACK_PREMULTIPLY_ALPHA_WEBGL: 37441,
      READ_FRAMEBUFFER: 36008,
      RGBA: 6408,
      UNSIGNED_BYTE: 5121,
      NO_ERROR: 0,
      clearColor: (...a: number[]) => log.push(`clearColor(${a.join(',')})`),
      pixelStorei: (k: number, v: boolean) => log.push(`pixelStorei(${k},${v})`),
      bindFramebuffer: (target: number, fb: unknown) => log.push(`bindFramebuffer(${target},${fb})`),
      readPixels: (x: number, y: number, w: number, h: number) => log.push(`readPixels(${x},${y},${w},${h})`),
      getError: () => errors.shift() ?? 0,
    } as unknown as WebGL2RenderingContext;
    const pixi = { resetState: () => log.push('pixi.resetState') } as unknown as PixiRenderer;
    const three = { resetState: () => log.push('three.resetState') };
    return { log, handoff: new GlHandoff(gl, pixi), three };
  }

  it('prepareForThree unsets the two pixel-store flags that make Three log warnings as it starts', () => {
    const { log, handoff } = setup();
    handoff.prepareForThree();
    expect(log).toEqual(['pixelStorei(37440,false)', 'pixelStorei(37441,false)']);
  });

  it('withThree runs the draw BETWEEN beginThree and endThree, and hands back what the draw returns', () => {
    const { log, handoff, three } = setup();
    const out = handoff.withThree(three, () => {
      log.push('three.render');
      return 42;
    });
    expect(out).toBe(42);
    expect(log).toEqual(['three.resetState', 'three.render', 'three.resetState', 'clearColor(0,0,0,0)']);
  });

  it('withThree cleans up even when the draw throws, so Pixi never inherits Three’s state from a failed frame', () => {
    const { log, handoff, three } = setup();
    expect(() =>
      handoff.withThree(three, () => {
        throw new Error('shader failed');
      }),
    ).toThrow('shader failed');
    expect(log).toEqual(['three.resetState', 'three.resetState', 'clearColor(0,0,0,0)']);
  });

  it('the canary switch: with the clean up off, endThree does nothing (the e2e canary must then SEE the stale clear colour)', () => {
    const { log, handoff, three } = setup();
    handoff.setClearColourFix(false);
    handoff.endThree(three);
    expect(log).toEqual([]);
    handoff.setClearColourFix(true);
    handoff.endThree(three);
    expect(log).toEqual(['three.resetState', 'clearColor(0,0,0,0)']);
  });

  it('readDefaultFramebuffer reads the canvas (framebuffer null) and then makes Pixi forget its state', () => {
    const { log, handoff } = setup();
    const bytes = handoff.readDefaultFramebuffer(10, 20, 4, 2);
    expect(bytes).toHaveLength(4 * 2 * 4);
    expect(log).toEqual(['bindFramebuffer(36008,null)', 'readPixels(10,20,4,2)', 'pixi.resetState']);
  });

  it('drainErrors lists every flag that is set, in order, and stops at NO_ERROR', () => {
    expect(setup({ errors: [1282, 1281] }).handoff.drainErrors()).toEqual([1282, 1281]);
    expect(setup().handoff.drainErrors()).toEqual([]);
  });

  it('drainErrors cannot loop forever on a context that always answers with an error', () => {
    expect(setup({ errors: Array(100).fill(1282) }).handoff.drainErrors()).toHaveLength(16);
  });
});

describe('Presenter.readCanvas goes through GlHandoff (carry-over f)', () => {
  function presenterWith(canvasW: number, canvasH: number, bottomUp?: Uint8Array) {
    const asked: number[][] = [];
    const handoff = {
      readDefaultFramebuffer: (x: number, yFromBottom: number, w: number, h: number) => {
        asked.push([x, yFromBottom, w, h]);
        return bottomUp ?? new Uint8Array(w * h * 4);
      },
    } as unknown as GlHandoff;
    const resized: number[][] = [];
    const pixi = { resize: (w: number, h: number) => resized.push([w, h]), renderer: {} } as unknown as PixiRenderer;
    // Pixi falls back to its empty texture for a sprite with none: these tests never draw.
    const backBuffer = { texture: undefined } as unknown as BackBuffer;
    const presenter = new Presenter(pixi, backBuffer, handoff);
    presenter.setCanvasSize(canvasW, canvasH);
    return { presenter, asked, resized };
  }

  it('reads only the PICTURE (not the bars), with GL’s bottom-up origin, then flips the rows so row 0 is the top', () => {
    // A 1000 x 700 canvas: k = 2, the picture is 960 x 540 at (20, 80).
    const w = 960;
    const h = 540;
    const bottomUp = new Uint8Array(w * h * 4);
    // Mark the first row GL gives (the BOTTOM of the picture) and the last row (the TOP).
    bottomUp[0] = 11;
    bottomUp[(h - 1) * w * 4] = 99;
    const { presenter, asked, resized } = presenterWith(1000, 700, bottomUp);
    expect(resized).toEqual([[1000, 700]]);
    const out = presenter.readCanvas();
    // x 20; from the bottom: canvas height 700 - (top 80 + picture 540) = 80.
    expect(asked).toEqual([[20, 80, 960, 540]]);
    expect([out.w, out.h]).toEqual([960, 540]);
    expect(out.data[0]).toBe(99); // the top row of the picture is the last row GL gave
    expect(out.data[(h - 1) * w * 4]).toBe(11);
  });

  it('a canvas smaller than the picture reads only the part that is on the canvas (top-left), with the same flip', () => {
    // 300 x 200: k = 1, the picture (480 x 270) is pinned to the corner and cut off on the right and the bottom.
    const w = 300;
    const h = 200;
    const bottomUp = new Uint8Array(w * h * 4);
    bottomUp[0] = 5; // the bottom row GL gives
    bottomUp[(h - 1) * w * 4] = 77; // the top row
    const { presenter, asked } = presenterWith(300, 200, bottomUp);
    const out = presenter.readCanvas();
    expect(asked).toEqual([[0, 0, 300, 200]]);
    expect([out.w, out.h]).toEqual([300, 200]);
    expect(out.data[0]).toBe(77);
    expect(out.data[(h - 1) * w * 4]).toBe(5);
  });

  it('refuses a canvas size that is not whole device pixels (a fraction would make the browser resample)', () => {
    const { presenter } = presenterWith(960, 540);
    expect(() => presenter.setCanvasSize(960.5, 540)).toThrow(/whole device pixels/);
    expect(() => presenter.setCanvasSize(0, 540)).toThrow(/whole device pixels/);
  });
});

describe('pictureLayout: the integer zoom and the picture’s place in a canvas of device pixels (carry-over g)', () => {
  it('k is the largest whole number that fits, the picture is centred on a whole device pixel', () => {
    expect(pictureLayout(1920, 1080)).toEqual({ k: 4, w: 1920, h: 1080, x: 0, y: 0 });
    expect(pictureLayout(2000, 1125)).toEqual({ k: 4, w: 1920, h: 1080, x: 40, y: 22 }); // dpr 1.25, 1600x900
    expect(pictureLayout(3600, 2025)).toEqual({ k: 7, w: 3360, h: 1890, x: 120, y: 67 }); // dpr 2.25, 1600x900: the B0 failure
    expect(pictureLayout(1925, 1085)).toEqual({ k: 4, w: 1920, h: 1080, x: 2, y: 2 }); // dpr 1.75, 1100x620
  });

  it('at least 1; a canvas smaller than the picture pins it to the corner (never a negative offset)', () => {
    expect(pictureLayout(200, 100)).toEqual({ k: 1, w: 480, h: 270, x: 0, y: 0 });
    expect(pictureLayout(480, 270)).toEqual({ k: 1, w: 480, h: 270, x: 0, y: 0 });
  });

  it('the shorter side decides, and the picture always fits and is on whole pixels, for every ratio and a spread of windows', () => {
    for (const dpr of [0.75, 1, 1.1, 1.25, 1.3, 1.5, 1.75, 2, 2.25, 2.5, 3, 3.5]) {
      for (const [vw, vh] of [[1920, 1080], [1600, 900], [1300, 730], [1100, 620], [960, 540], [700, 400], [1401, 791], [480, 1080], [1920, 300]]) {
        const d = deviceSize(vw as number, vh as number, dpr);
        const l = pictureLayout(d.w, d.h);
        expect(Number.isInteger(l.k) && Number.isInteger(l.x) && Number.isInteger(l.y), `whole numbers at dpr ${dpr} ${vw}x${vh}`).toBe(true);
        expect(l.w).toBe(480 * l.k);
        expect(l.h).toBe(270 * l.k);
        if (l.k > 1) {
          // It fits, and it is the LARGEST that fits.
          expect(l.x + l.w).toBeLessThanOrEqual(d.w);
          expect(l.y + l.h).toBeLessThanOrEqual(d.h);
          expect(480 * (l.k + 1) > d.w || 270 * (l.k + 1) > d.h).toBe(true);
          // Centred to within one device pixel.
          expect(Math.abs(l.x - (d.w - l.w - l.x))).toBeLessThanOrEqual(1);
          expect(Math.abs(l.y - (d.h - l.h - l.y))).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('deviceSize: the canvas is the window in device pixels', () => {
  it('is the CSS size times the ratio, rounded (a window is a whole number of device pixels)', () => {
    expect(deviceSize(1600, 900, 2.25)).toEqual({ w: 3600, h: 2025 });
    expect(deviceSize(1100, 620, 1.75)).toEqual({ w: 1925, h: 1085 });
    expect(deviceSize(1000, 560, 1.1)).toEqual({ w: 1100, h: 616 });
    expect(deviceSize(1301, 731, 1.5)).toEqual({ w: 1952, h: 1097 }); // 1951.5 and 1096.5 round up
  });

  it('trusts what the browser reports (devicePixelContentBoxSize) when it agrees to within 1 pixel', () => {
    expect(deviceSize(1301, 731, 1.5, { w: 1951, h: 1097 })).toEqual({ w: 1951, h: 1097 });
  });

  it('ignores a report that is far off: a test tool that emulates the ratio reports the CSS size', () => {
    expect(deviceSize(1600, 900, 2.25, { w: 1600, h: 900 })).toEqual({ w: 3600, h: 2025 });
  });

  it('never gives 0', () => {
    expect(deviceSize(0, 0, 1)).toEqual({ w: 1, h: 1 });
  });
});
