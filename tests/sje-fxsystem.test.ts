/**
 * The editor contract of `FxSystem` (docs/engine/m2-brief.md section 2, point 9; pass line 16), in Node, with no GPU:
 * `FxParams`, `loadData`, `playMoment` with no scene, `step`, `snapshot` and `restore`. The drawing is checked in the browser (e2e/sje-fx.spec.ts).
 * Each check has a control: the same check on a case that must fail.
 */
import { RenderTexture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { FX } from '../src/data/fx';
import { CompositeFilter } from '../src/sje/fx/compositefilter';
import type { FxData } from '../src/sje/fx/fxdata';
import { defaultFxParams, FX_SLOTS } from '../src/sje/fx/fxparams';
import { FxSystem } from '../src/sje/fx/fxsystem';
import { MAX_GLITCHES, MAX_HAZES, MAX_SHOCKS } from '../src/sje/fx/fxstate';

const live = (seed = 1): FxSystem => {
  const fx = new FxSystem({ seed });
  fx.active = true; // headless: no GPU, so a test switches it on itself, as the old tests do
  return fx;
};

describe('FxParams', () => {
  it('every look tunable has a default, the slot counts are the shader slots, and a changed value reaches the composite uniform, for the bloom, dim, vignette, haze, glitch and shock fields (control: unchanged stays default)', () => {
    const d = defaultFxParams();
    // Today's values (the old presenter's constants).
    expect(d.bloomHalf).toBe(0.9);
    expect(d.bloomQuarter).toBe(0.8);
    expect(d.dimSpareGain).toBe(3);
    expect(d.vignetteFalloff).toBe(2);
    expect(d.blurWeights[1]).toBeCloseTo(0.3162162162);
    expect(d.glitchSliceHeight).toBe(3);
    expect(d.particleCap).toBe(4096);
    expect(FX_SLOTS).toEqual({ shocks: MAX_SHOCKS, hazes: MAX_HAZES, glitches: MAX_GLITCHES });
    for (const [k, v] of Object.entries(d)) expect(v, k).not.toBeUndefined();

    // Pixi asks a throwaway canvas for the shader precision when it builds a program. Node has no canvas: say there is no GL there.
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
    const mk = () => RenderTexture.create({ width: 8, height: 8 });
    const [a, b, c] = [mk(), mk(), mk()];
    const f = new CompositeFilter(a.source, b.source, c.source);
    const read = (name: string) => (f.filter.resources as unknown as { compositeUniforms: { uniforms: Record<string, unknown> } }).compositeUniforms.uniforms[name];
    const fx = live();
    f.update(fx, 0, d);
    expect(read('uVigFalloff')).toBe(2);
    expect(read('uDimSpare')).toBe(3);
    f.update(fx, 0, { ...d, vignetteFalloff: 5, dimSpareGain: 7, bloomHalf: 0.1 });
    expect(read('uVigFalloff')).toBe(5);
    expect(read('uDimSpare')).toBe(7);
    expect((read('uMix') as Float32Array)[0]).toBeCloseTo(0.1);

    // The rest of the uniform-backed fields: every one reaches its uniform. A value that is not the default must show up (control: the defaults first).
    const arr = (name: string) => Array.from(read(name) as Float32Array);
    f.update(fx, 0, d);
    expect(arr('uMix')).toEqual([Math.fround(0.9), Math.fround(0.8)]);
    expect(arr('uHazeY')).toEqual([Math.fround(0.45), Math.fround(0.21)]);
    expect(arr('uHazeX')).toEqual([Math.fround(0.3), Math.fround(0.2), Math.fround(0.33)]);
    expect(arr('uGlitchA')).toEqual([3, 4, 4, 0.75]);
    expect(arr('uGlitchB')).toEqual([Math.fround(0.35), 0.5]);
    f.update(fx, 0, {
      ...d,
      bloomQuarter: 0.2,
      hazeWaveY: [1.5, 2.5],
      hazeWaveX: [3.5, 4.5, 5.5],
      glitchSliceHeight: 7,
      glitchPatternFrames: 9,
      glitchSlide: 11,
      glitchSlideBias: 0.25,
      glitchSplit: 0.6,
      glitchThreshold: 0.8,
    });
    expect(arr('uMix')[1]).toBeCloseTo(0.2);
    expect(arr('uHazeY')).toEqual([1.5, 2.5]);
    expect(arr('uHazeX')).toEqual([3.5, 4.5, 5.5]);
    expect(arr('uGlitchA')).toEqual([7, 9, 11, 0.25]);
    expect(arr('uGlitchB')[0]).toBeCloseTo(0.6);
    expect(arr('uGlitchB')[1]).toBeCloseTo(0.8);

    // The envelope fields: a haze at its fifth frame shows 5 / fadeIn of its strength; a glitch, a shock too. Their numbers come from the params.
    fx.haze(10, 10, { radius: 30, strength: 2, life: 100 });
    fx.glitch(50, 50, { strength: 8, life: 100 });
    fx.shock(80, 80, { strength: 6, reach: 100, life: 20, width: 10 });
    fx.step(5);
    const hazeU = () => arr('uHaze');
    const glitchU = () => arr('uGlitchP');
    const shockU = () => arr('uShock');
    const shockWU = () => arr('uShockW');
    f.update(fx, 0, d);
    expect(hazeU()[3]).toBeCloseTo((2 * 5) / d.hazeFadeIn);
    expect(glitchU()[0]).toBeCloseTo(8); // 5 frames in, past its 2-frame fade-in, 95 frames before the 6-frame fade-out
    const k = 5 / 20;
    expect(shockU()[2]).toBeCloseTo(100 * (1 - (1 - k) ** d.shockReachEase));
    expect(shockU()[3]).toBeCloseTo(6 * (1 - k) ** d.shockPushEase);
    expect(shockWU()[0]).toBeCloseTo(10 * (d.shockWidthStart + k));
    f.update(fx, 0, { ...d, hazeFadeIn: 20, glitchFadeIn: 10, glitchFadeOut: 6, shockReachEase: 3, shockPushEase: 2, shockWidthStart: 1 });
    expect(hazeU()[3]).toBeCloseTo((2 * 5) / 20);
    expect(glitchU()[0]).toBeCloseTo((8 * 5) / 10);
    expect(shockU()[2]).toBeCloseTo(100 * (1 - (1 - k) ** 3));
    expect(shockU()[3]).toBeCloseTo(6 * (1 - k) ** 2);
    expect(shockWU()[0]).toBeCloseTo(10 * (1 + k));
    // The fade-out end: hazeFadeOut and glitchFadeOut count from the last frames of the life.
    fx.step(94); // t = 99: one frame before the end
    f.update(fx, 0, d);
    expect(hazeU()[3]).toBeCloseTo((2 * 1) / d.hazeFadeOut);
    f.update(fx, 0, { ...d, hazeFadeOut: 1 });
    expect(hazeU()[3]).toBeCloseTo(2);
    f.destroy();
    for (const t of [a, b, c]) t.destroy(true);
    vi.unstubAllGlobals();
  });

  it('setParams merges and copies; a system made with params has them; the particle cap sizes the simulation', () => {
    const fx = new FxSystem({ params: { particleCap: 64, vignetteFalloff: 4 } });
    expect(fx.params.vignetteFalloff).toBe(4);
    expect(fx.particles.cap).toBe(64);
    const w: [number, number, number] = [1, 2, 3];
    fx.setParams({ blurWeights: w });
    w[0] = 9;
    expect(fx.params.blurWeights).toEqual([1, 2, 3]);
    expect(fx.params.bloomHalf).toBe(0.9);
  });
});

describe('FxParams: the look numbers of the state', () => {
  it('the color split and pulse decay, the dim fade and the starting vignette come from params; the defaults are the old values (control)', () => {
    const d = defaultFxParams();
    expect([d.vignetteDefault, d.dimFadeIn, d.dimFadeOut, d.aberrationDecay, d.aberrationFloor, d.pulseDecay, d.pulseFloor]).toEqual([0.22, 10, 16, 0.86, 0.05, 0.9, 0.01]);
    const base = live();
    expect(base.vignette).toBe(0.22);
    base.aberrate(4);
    base.flare(1);
    base.dim(1, 100);
    base.step(5);
    expect(base.aberration).toBeCloseTo(4 * 0.86 ** 5);
    expect(base.pulse).toBeCloseTo(0.9 ** 5);
    expect(base.dimNow).toBeCloseTo(5 / 10);

    const fx = new FxSystem({ params: { vignetteDefault: 0.5, aberrationDecay: 0.5, pulseDecay: 0.5, dimFadeIn: 20 } });
    fx.active = true;
    expect(fx.vignette).toBe(0.5);
    fx.aberrate(4);
    fx.flare(1);
    fx.dim(1, 100);
    fx.step(5);
    expect(fx.aberration).toBeCloseTo(4 * 0.5 ** 5);
    expect(fx.pulse).toBeCloseTo(0.5 ** 5);
    expect(fx.dimNow).toBeCloseTo(5 / 20);
    // Live change through setParams, with the floors: below the floor the value drops to 0.
    fx.setParams({ aberrationDecay: 0.86, aberrationFloor: 10 });
    fx.step(1);
    expect(fx.aberration).toBe(0);
    // Snapshot and restore keep working with these (they are state, not params).
    const s = fx.snapshot();
    const other = live();
    other.restore(s);
    expect(other.snapshot()).toEqual(s);
  });
});

describe('loadData', () => {
  it('swaps in good data; bad data returns checkFx messages and leaves the old data in place (control)', () => {
    const fx = live();
    expect(fx.data).toBeNull();
    expect(fx.loadData(FX)).toEqual([]);
    expect(fx.data).toBe(FX);
    const next: FxData = { presets: {}, moments: { boom: { layers: [{ shock: { strength: 2 } }] } } as FxData['moments'] };
    expect(fx.loadData(next)).toEqual([]);
    expect(fx.data).toBe(next);
    const errors = fx.loadData({ presets: { Bad: {} }, moments: {} });
    expect(errors.length).toBeGreaterThan(0);
    expect(fx.data).toBe(next);
    expect(fx.loadData(null)).toEqual(['fx data needs "presets" and "moments" objects']);
    expect(fx.data).toBe(next);
  });
});

describe('playMoment, step, snapshot and restore', () => {
  const data: FxData = {
    presets: { puff: { count: [6, 6], life: [40, 40], speed: [1, 2], size: [3, 3], colors: ['#ffffff'], shape: 'soft' } },
    moments: {
      hit: { layers: [{ shock: { strength: 4, life: 20 } }, { emit: 'puff', delay: 5 }, { glitch: { strength: 6 }, delay: 2 }] },
    } as unknown as FxData['moments'],
  };

  it('a moment plays on a system with no scene; delayed layers wait on the effects clock; no data, no effect, and an unknown name does nothing', () => {
    const fx = live();
    fx.playMoment('hit', 100, 100);
    expect(fx.shocks.length).toBe(0); // no data loaded: nothing
    fx.loadData(data);
    fx.playMoment('nope', 1, 1);
    expect(fx.shocks.length).toBe(0);
    fx.playMoment('hit', 100, 100);
    expect(fx.shocks.length).toBe(1);
    expect(fx.particles.count).toBe(0);
    fx.step(2);
    expect(fx.glitches.length).toBe(1);
    fx.step(3);
    expect(fx.particles.count).toBe(6);
    // Inactive (a level of none): nothing at all.
    const off = new FxSystem();
    off.loadData(data);
    off.playMoment('hit', 1, 1);
    expect(off.shocks.length).toBe(0);
  });

  it('step(n) equals n update() calls', () => {
    const a = live(7), b = live(7);
    for (const f of [a, b]) {
      f.loadData(data);
      f.playMoment('hit', 50, 60);
    }
    a.step(9);
    for (let i = 0; i < 9; i++) b.update();
    expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
    // Control: one tick fewer is a different state.
    const c = live(7);
    c.loadData(data);
    c.playMoment('hit', 50, 60);
    c.step(8);
    expect(JSON.stringify(c.snapshot())).not.toBe(JSON.stringify(a.snapshot()));
  });

  it('restore(snapshot()) after more ticks gives the state of that tick again, and a snapshot is plain JSON (control: without restore the states differ)', () => {
    const fx = live(3);
    fx.loadData(data);
    fx.playMoment('hit', 200, 120);
    fx.aberrate(3, 10, 10);
    fx.dim(0.5, 40);
    fx.step(4);
    const snap = fx.snapshot();
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap); // no function, no undefined, nothing a round trip loses
    fx.step(6);
    const later = JSON.stringify(fx.snapshot());
    expect(later).not.toBe(JSON.stringify(snap));
    fx.restore(snap);
    expect(JSON.stringify(fx.snapshot())).toBe(JSON.stringify(snap));
    // And it plays on the same: ten more ticks from the restored state equal ten more from a twin that never left.
    const twin = live(3);
    twin.loadData(data);
    twin.playMoment('hit', 200, 120);
    twin.aberrate(3, 10, 10);
    twin.dim(0.5, 40);
    twin.step(4);
    fx.step(10);
    twin.step(10);
    expect(JSON.stringify(fx.snapshot())).toBe(JSON.stringify(twin.snapshot()));
  });

  it('a delayed call made with later() cannot be in a snapshot: it is counted, and restore drops it', () => {
    const fx = live();
    let ran = 0;
    fx.later(3, () => ran++);
    expect(fx.snapshot().droppedCalls).toBe(1);
    const s = fx.snapshot();
    fx.restore(s);
    fx.step(5);
    expect(ran).toBe(0);
    expect(() => fx.restore({ ...s, version: 2 as unknown as 1 })).toThrow(/version/);
  });

  it('the glitch pattern comes from the seeded stream: the same seed gives the same seed values, another seed another (control)', () => {
    const seeds = (n: number) => {
      const fx = live(n);
      fx.glitch(0, 0);
      fx.glitch(0, 0);
      return fx.glitches.map((g) => g.seed);
    };
    expect(seeds(5)).toEqual(seeds(5));
    expect(seeds(5)).not.toEqual(seeds(6));
  });
});
