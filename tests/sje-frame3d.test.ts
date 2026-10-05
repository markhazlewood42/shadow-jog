/**
 * Frame3D's error paths (src/sje/three/frame3d.ts), headless. A constructor that throws gives the
 * caller nothing to dispose, so `createFrame3D` must free what it already made: the render target
 * and the 11 render targets of the bloom pass. The GPU parts are faked (no WebGL in Node); the REAL
 * Three render target and bloom pass classes are used, so a missing `dispose` is seen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Switches the mocks below read. `vi.hoisted` runs before the imports, so the mock factories can see it.
const fail = vi.hoisted(() => ({ external: false, view3d: false, destroyView3d: false }));
/** What was freed. Counted by the two mocks below. */
const freed = vi.hoisted(() => ({ targets: 0, blooms: 0, bloomsMade: 0 }));

// The render target is the real class, with a counter on `dispose`. (This file does not import Three: it only mocks it.)
vi.mock('three', async (importOriginal) => {
  const real = await importOriginal<typeof import('three')>();
  class CountingTarget extends real.WebGLRenderTarget {
    override dispose(): void {
      freed.targets++;
      super.dispose();
    }
  }
  return { ...real, WebGLRenderTarget: CountingTarget };
});

// The bloom pass is replaced by a stand-in that counts: the real one needs a GPU to be useful, and owns 11 targets.
vi.mock('three/examples/jsm/postprocessing/UnrealBloomPass.js', () => ({
  UnrealBloomPass: class {
    constructor() {
      freed.bloomsMade++;
    }
    dispose(): void {
      freed.blooms++;
    }
    render(): void {}
  },
}));

vi.mock('../src/sje/render/frametexture', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/sje/render/frametexture')>();
  class FailingExternal extends real.ExternalFrameTexture {
    constructor(...args: ConstructorParameters<typeof real.ExternalFrameTexture>) {
      if (fail.external) throw new Error('external texture refused');
      super(...args);
    }
  }
  return { ...real, ExternalFrameTexture: FailingExternal };
});

vi.mock('../src/sje/display/view3d', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/sje/display/view3d')>();
  class FailingView3D extends real.View3D {
    constructor(...args: ConstructorParameters<typeof real.View3D>) {
      if (fail.view3d) throw new Error('view3d refused');
      super(...args);
    }
    override destroy(): void {
      if (fail.destroyView3d) throw new Error('view3d destroy refused');
      super.destroy();
    }
  }
  return { ...real, View3D: FailingView3D };
});

// A fake Three host: the shapes `frame3d.ts` reads, and nothing that needs a GPU.
vi.mock('../src/sje/three/threehost', () => {
  const renderer = {
    initRenderTarget: () => undefined,
    properties: { get: () => ({ __webglTexture: new (globalThis as unknown as { WebGLTexture: new () => object }).WebGLTexture() }) },
    resetState: () => undefined,
  };
  const host = { renderer, kind: 'shared', canvas: { width: 480, height: 270 } };
  return { ThreeHost: { shared: () => host, privateCopy: () => host }, hostsCreated: { shared: 0, private: 0 } };
});

import { runAll } from '../src/sje/core/runall';
import { buildOrFree, createFrame3D } from '../src/sje/three/frame3d';

/** A game stand-in with the three things `frame3d.ts` touches. */
function fakeGl(): never {
  return {
    handoff: { withThree: <T>(_t: unknown, draw: () => T): T => draw() },
    pixi: { renderer: {} },
    glc: { lost: false, on: () => undefined, off: () => undefined },
  } as never;
}
const fakeScene = (): never => ({ textures: {} }) as never;
// The scene and the camera are only used when a frame DRAWS, which these tests never do.
const SETUP = () => ({ scene: {} as never, camera: {} as never, bloom: { strength: 1, radius: 0.5, threshold: 0.5 } });

beforeEach(() => {
  vi.stubGlobal('WebGLTexture', class {});
  freed.targets = 0;
  freed.blooms = 0;
  freed.bloomsMade = 0;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  fail.external = false;
  fail.view3d = false;
  fail.destroyView3d = false;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('buildOrFree', () => {
  it('returns what build returns and does not free', () => {
    const free = vi.fn();
    expect(buildOrFree(free, () => 42)).toBe(42);
    expect(free).not.toHaveBeenCalled();
  });

  it('frees once, then throws the SAME error again', () => {
    const free = vi.fn();
    const boom = new Error('boom');
    expect(() =>
      buildOrFree(free, () => {
        throw boom;
      }),
    ).toThrow(boom);
    expect(free).toHaveBeenCalledTimes(1);
  });

  it('a free that also throws does not hide the first error', () => {
    const boom = new Error('first');
    expect(() =>
      buildOrFree(
        () => {
          throw new Error('second');
        },
        () => {
          throw boom;
        },
      ),
    ).toThrow(boom);
  });
});

describe('runAll', () => {
  it('runs every step in order, and throws nothing when none throws', () => {
    const order: number[] = [];
    runAll([() => order.push(1), () => order.push(2)]);
    expect(order).toEqual([1, 2]);
  });

  it('runs the steps after a failing one, then throws the FIRST error', () => {
    const ran: string[] = [];
    expect(() =>
      runAll([
        () => ran.push('a'),
        () => {
          throw new Error('first');
        },
        () => ran.push('c'),
        () => {
          throw new Error('second');
        },
      ]),
    ).toThrow('first');
    expect(ran).toEqual(['a', 'c']);
  });
});

describe('Frame3D.dispose keeps going when the Pixi side throws (the GPU objects behind it must still be freed)', () => {
  for (const mode of ['shared-context', 'canvas-copy'] as const) {
    it(`${mode}: View3D.destroy throws, so the error comes out and the target and the bloom pass are still disposed`, () => {
      const frame = createFrame3D(fakeGl(), fakeScene(), SETUP(), mode);
      fail.destroyView3d = true;
      expect(() => frame.dispose()).toThrow('view3d destroy refused');
      expect(freed).toEqual({ targets: 1, blooms: 1, bloomsMade: 1 });
      // A second dispose is a no-op (the frame is flagged), so nothing is freed twice.
      fail.destroyView3d = false;
      frame.dispose();
      expect(freed).toEqual({ targets: 1, blooms: 1, bloomsMade: 1 });
    });
  }
});

describe('createFrame3D frees what it made when the frame cannot be built', () => {
  it('works when nothing fails (control: nothing is freed until dispose, then the target and the bloom pass are)', () => {
    const frame = createFrame3D(fakeGl(), fakeScene(), SETUP(), 'shared-context');
    expect(frame.mode).toBe('shared-context');
    expect(freed).toEqual({ targets: 0, blooms: 0, bloomsMade: 1 });
    frame.dispose();
    expect(freed).toEqual({ targets: 1, blooms: 1, bloomsMade: 1 });
  });

  it('shared context: the Pixi texture wrapper throws, so the target and the bloom pass are disposed', () => {
    fail.external = true;
    expect(() => createFrame3D(fakeGl(), fakeScene(), SETUP(), 'shared-context')).toThrow('external texture refused');
    expect(freed).toEqual({ targets: 1, blooms: 1, bloomsMade: 1 });
  });

  it('shared context: the View3D throws, so the same happens (and the wrapper is destroyed)', () => {
    fail.view3d = true;
    expect(() => createFrame3D(fakeGl(), fakeScene(), SETUP(), 'shared-context')).toThrow('view3d refused');
    expect(freed).toEqual({ targets: 1, blooms: 1, bloomsMade: 1 });
  });

  it('canvas copy: the View3D throws, so the target and the bloom pass are disposed', () => {
    fail.view3d = true;
    expect(() => createFrame3D(fakeGl(), fakeScene(), SETUP(), 'canvas-copy')).toThrow('view3d refused');
    expect(freed).toEqual({ targets: 1, blooms: 1, bloomsMade: 1 });
  });

  it('Three cannot allocate the target: the target and the bloom pass are disposed (no frame exists yet to do it)', async () => {
    const gl = fakeGl();
    // The mocked host is shared by all tests: make its `initRenderTarget` throw for this call only.
    const { ThreeHost } = await import('../src/sje/three/threehost');
    const renderer = ThreeHost.shared(gl).renderer;
    const saved = renderer.initRenderTarget;
    renderer.initRenderTarget = (() => {
      throw new Error('init failed');
    }) as never;
    try {
      expect(() => createFrame3D(gl, fakeScene(), SETUP(), 'shared-context')).toThrow('init failed');
    } finally {
      renderer.initRenderTarget = saved;
    }
    expect(freed).toEqual({ targets: 1, blooms: 1, bloomsMade: 1 });
  });
});

describe('SharedContextFrame: a context restore re-wraps Three’s new texture once, at the next render (headless)', () => {
  /** A fake GL that records the listeners the frame adds, and can be lost and restored by hand. */
  function fakeGlWithLoss() {
    const listeners: { restored: Array<() => void> } = { restored: [] };
    const glc = {
      lost: false,
      on: (name: string, fn: () => void) => {
        if (name === 'restored') listeners.restored.push(fn);
      },
      off: (name: string, fn: () => void) => {
        if (name === 'restored') listeners.restored.splice(listeners.restored.indexOf(fn), 1);
      },
    };
    const calls: string[] = [];
    const gl = {
      handoff: {
        withThree: <T>(_t: unknown, draw: () => T): T => {
          calls.push('withThree');
          return draw();
        },
      },
      pixi: { renderer: {} },
      glc,
    };
    return { gl: gl as never, glc, listeners, calls };
  }

  /** The mocked host's renderer, with the calls a render makes counted. */
  async function hostRenderer() {
    const { ThreeHost } = await import('../src/sje/three/threehost');
    return ThreeHost.shared({} as never).renderer as unknown as Record<string, unknown> & { initRenderTarget: () => void };
  }

  it('render does nothing while the context is lost; a restore marks the frame stale; the next render re-wraps once and draws', async () => {
    const renderer = await hostRenderer();
    const inits: string[] = [];
    renderer.initRenderTarget = () => inits.push('init');
    renderer.setRenderTarget = () => undefined;
    renderer.render = () => undefined;
    const { gl, glc, listeners } = fakeGlWithLoss();
    const frame = createFrame3D(gl, fakeScene(), SETUP(), 'shared-context');
    // The mocked texture wrapper never touches a GPU: stub its re-point so the test sees the call, not Pixi.
    const wrapper = (frame as unknown as { wrapper: { rewrap: (t: unknown) => void } }).wrapper;
    const rewraps: unknown[] = [];
    wrapper.rewrap = (t) => rewraps.push(t);
    expect(listeners.restored).toHaveLength(1);

    glc.lost = true;
    const initsBefore = inits.length;
    frame.render();
    expect(frame.contextLost).toBe(true);
    expect(frame.describe().rewraps).toBe(0);
    expect(inits).toHaveLength(initsBefore); // nothing was drawn or re-made while lost

    // The browser restores the context. The listener only MARKS the frame (Three's own listener may not have run yet)...
    glc.lost = false;
    listeners.restored[0]?.();
    expect(rewraps).toHaveLength(0);
    // ...and the next render re-points Pixi at Three's new texture, once, then draws.
    frame.render();
    expect(rewraps).toHaveLength(1);
    expect(frame.describe().rewraps).toBe(1);
    frame.render();
    expect(rewraps).toHaveLength(1);

    // Dispose takes the listener off, and a second dispose is harmless.
    frame.dispose();
    frame.dispose();
    expect(listeners.restored).toHaveLength(0);
  });

  it('after dispose, render and rewrap do nothing', async () => {
    const renderer = await hostRenderer();
    let drawn = 0;
    renderer.initRenderTarget = () => undefined;
    renderer.setRenderTarget = () => undefined;
    renderer.render = () => {
      drawn++;
    };
    const { gl } = fakeGlWithLoss();
    const frame = createFrame3D(gl, fakeScene(), SETUP(), 'shared-context');
    frame.dispose();
    frame.render();
    frame.rewrap();
    expect(drawn).toBe(0);
    expect(frame.describe().rewraps).toBe(0);
  });
});

describe("createFrame3D 'auto': Three's texture handle is missing (E3: fall back to the canvas copy, warn once)", () => {
  // The note is given once per page, so each test starts as a new page.
  beforeEach(async () => (await import('../src/sje/three/frame3d')).frame3dTestSeams.forgetFallbackNote());

  /** Run `body` while the mocked Three renderer reports no GL texture for any target: what a Three upgrade that moves the field would do. */
  async function withoutHandle<T>(gl: never, body: () => T): Promise<T> {
    const { ThreeHost } = await import('../src/sje/three/threehost');
    const props = ThreeHost.shared(gl).renderer.properties as unknown as { get: () => unknown };
    const saved = props.get;
    props.get = () => ({});
    try {
      return body();
    } finally {
      props.get = saved;
    }
  }

  it('auto: the frame is a canvas copy, there is exactly one console warning, and the discarded shared pipeline was freed once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const gl = fakeGl();
    const frame = await withoutHandle(gl, () => createFrame3D(gl, fakeScene(), SETUP(), 'auto'));
    expect(frame.mode).toBe('canvas-copy');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/texture handle is missing/);
    // The shared pipeline (a target and a bloom pass) was built, found useless and freed: once. The canvas copy built its own.
    expect(freed).toEqual({ targets: 1, blooms: 1, bloomsMade: 2 });
    // The fallback frame is a real, usable frame with its own parts, and frees them.
    frame.dispose();
    expect(freed).toEqual({ targets: 2, blooms: 2, bloomsMade: 2 });
  });

  it('the fall-back is noted ONCE per page: a second and a third hack entry fall back without another warning (C11), and a new page notes it again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const gl = fakeGl();
    for (let entry = 0; entry < 3; entry++) {
      const frame = await withoutHandle(gl, () => createFrame3D(gl, fakeScene(), SETUP(), 'auto'));
      expect(frame.mode, `entry ${entry}`).toBe('canvas-copy');
      frame.dispose();
    }
    expect(warn, 'three entries, one warning').toHaveBeenCalledTimes(1);
    // Control: forgetting the note (a new page) makes the next fall back log again, so the count above is the flag and not a broken spy.
    (await import('../src/sje/three/frame3d')).frame3dTestSeams.forgetFallbackNote();
    const again = await withoutHandle(gl, () => createFrame3D(gl, fakeScene(), SETUP(), 'auto'));
    again.dispose();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('auto with a handle present: the shared context is used and nothing warns (control)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const frame = createFrame3D(fakeGl(), fakeScene(), SETUP(), 'auto');
    expect(frame.mode).toBe('shared-context');
    expect(warn).not.toHaveBeenCalled();
    frame.dispose();
  });

  it("'shared-context' does not fall back: it throws, and frees the pipeline it built", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const gl = fakeGl();
    await withoutHandle(gl, () => expect(() => createFrame3D(gl, fakeScene(), SETUP(), 'shared-context')).toThrow(/no GL texture handle/));
    expect(freed).toEqual({ targets: 1, blooms: 1, bloomsMade: 1 });
    expect(warn).not.toHaveBeenCalled();
  });

  it('the test seam hides the handle in the same way (the e2e uses it)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { frame3dTestSeams } = await import('../src/sje/three/frame3d');
    frame3dTestSeams.hideTextureHandle = true;
    try {
      const frame = createFrame3D(fakeGl(), fakeScene(), SETUP(), 'auto');
      expect(frame.mode).toBe('canvas-copy');
      expect(warn).toHaveBeenCalledTimes(1);
      frame.dispose();
    } finally {
      frame3dTestSeams.hideTextureHandle = false;
    }
  });
});
