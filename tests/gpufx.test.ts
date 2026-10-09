/** The GPU effects layer's logic: the particle simulation and the effects façade (no WebGL needed). */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FX, GAME_MOMENTS } from '../src/data/fx';
import { checkFx, type FxData, formatFx } from '../src/engine/fxdata';
import { playMoment } from '../src/engine/moments';
import { type EmitterPreset, PARTICLE_STRIDE, ParticleSim, SHAPE_ID } from '../src/engine/particles';
import { MAX_SHOCKS, PostFx, postfx } from '../src/engine/postfx';
import { runCases } from './fxstate-cases';

const dot: EmitterPreset = { count: [5, 5], life: [10, 10], speed: [1, 1], angle: 0, spread: 0, size: [2, 2], colors: ['#ff0000', '#0000ff'], alpha: [1, 0], shape: 'dot' };

describe('particles', () => {
  it('a burst spawns its count, moves by its speed, and is gone after its life', () => {
    const sim = new ParticleSim(64, 3);
    expect(sim.burst(dot, 100, 50)).toBe(5);
    expect(sim.count).toBe(5);
    sim.step(1);
    const out = new Float32Array(64 * PARTICLE_STRIDE);
    const { add, alpha } = sim.write(out);
    expect(add).toBe(5);
    expect(alpha).toBe(0);
    expect(out[0]).toBeCloseTo(101); // x: one frame at 1 px/frame, straight right
    expect(out[1]).toBeCloseTo(50);
    expect(out[9]).toBe(SHAPE_ID.dot);
    for (let i = 0; i < 9; i++) sim.step(1);
    expect(sim.count).toBe(0);
  });

  it('colour and opacity run from the first stop to the last over a life', () => {
    const sim = new ParticleSim(8, 1);
    sim.burst({ ...dot, count: [1, 1] }, 0, 0);
    sim.step(5); // halfway
    const out = new Float32Array(8 * PARTICLE_STRIDE);
    sim.write(out);
    expect(out[5]).toBeCloseTo(0.5); // red halfway down
    expect(out[7]).toBeCloseTo(0.5); // blue halfway up
    expect(out[8]).toBeCloseTo(0.5); // alpha halfway out
  });

  it('gravity pulls, drag slows, and a slower clock moves things less', () => {
    const fall: EmitterPreset = { ...dot, count: [1, 1], speed: [0, 0], gravity: 0.5, life: [100, 100] };
    const a = new ParticleSim(4, 1), b = new ParticleSim(4, 1);
    a.burst(fall, 0, 0);
    b.burst(fall, 0, 0);
    for (let i = 0; i < 10; i++) {
      a.step(1);
      b.step(0.5);
    }
    const oa = new Float32Array(4 * PARTICLE_STRIDE), ob = new Float32Array(4 * PARTICLE_STRIDE);
    a.write(oa);
    b.write(ob);
    expect(oa[1]).toBeGreaterThan(20);
    expect(ob[1]).toBeGreaterThan(0);
    expect(ob[1]).toBeLessThan(oa[1]! / 2);
  });

  it('covering particles are packed after the glowing ones, and the cap holds', () => {
    const sim = new ParticleSim(10, 1);
    sim.burst(FX.presets.glitch!, 0, 0, { scale: 0.2 }); // covering squares
    sim.burst(dot, 0, 0); // glowing
    const out = new Float32Array(10 * PARTICLE_STRIDE);
    const { add, alpha } = sim.write(out);
    expect(add).toBe(5);
    expect(alpha).toBeGreaterThan(0);
    expect(out[9]).toBe(SHAPE_ID.dot);
    expect(out[add * PARTICLE_STRIDE + 9]).toBe(SHAPE_ID.square);
    sim.burst({ ...dot, count: [50, 50] }, 0, 0);
    expect(sim.count).toBe(10);
  });

  it('particles with different lives all die on time, however many go in one step', () => {
    const sim = new ParticleSim(64, 9);
    sim.burst({ ...dot, count: [20, 20], life: [2, 12] }, 0, 0);
    const lives: number[] = [];
    for (let t = 1; t <= 12; t++) {
      sim.step(1);
      lives.push(sim.count);
    }
    // Never more alive than the step before, and all gone by the longest life.
    for (let i = 1; i < lives.length; i++) expect(lives[i]).toBeLessThanOrEqual(lives[i - 1]!);
    expect(sim.count).toBe(0);
    // A big step kills a whole mix at once without skipping any (swap-remove re-checks the slot).
    sim.burst({ ...dot, count: [30, 30], life: [1, 5] }, 0, 0);
    sim.step(6);
    expect(sim.count).toBe(0);
  });

  it('the same seed gives the same bursts', () => {
    const run = () => {
      const s = new ParticleSim(64, 42);
      s.burst(FX.presets.crit_sparks!, 10, 10);
      s.step(3);
      const out = new Float32Array(64 * PARTICLE_STRIDE);
      s.write(out);
      return Array.from(out.slice(0, 40));
    };
    expect(run()).toEqual(run());
  });

  it('every preset is well formed', () => {
    for (const [id, p] of Object.entries(FX.presets) as [string, EmitterPreset][]) {
      expect(p.count[0], id).toBeLessThanOrEqual(p.count[1]);
      expect(p.life[0], id).toBeGreaterThan(0);
      expect(p.colors.length, id).toBeGreaterThan(0);
      for (const c of p.colors) expect(c, id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(SHAPE_ID[p.shape], id).toBeDefined();
    }
  });
});

describe('effects façade', () => {
  it('does nothing while GPU effects are off', () => {
    postfx.clear();
    postfx.active = false;
    postfx.shock(10, 10);
    postfx.aberrate(3);
    postfx.flare(1);
    postfx.emit(dot, 0, 0);
    expect(postfx.shocks.length).toBe(0);
    expect(postfx.aberration).toBe(0);
    expect(postfx.pulse).toBe(0);
    expect(postfx.particles.count).toBe(0);
  });

  it('while on: shocks spread and end, pulses fade, comfort settings scale them', () => {
    postfx.clear();
    postfx.active = true;
    postfx.motion = 0.5;
    postfx.intensity = 1;
    postfx.shock(10, 10, { strength: 4, life: 10 });
    expect(postfx.shocks[0]?.strength).toBe(2);
    for (let i = 0; i < MAX_SHOCKS + 2; i++) postfx.shock(0, 0);
    expect(postfx.shocks.length).toBe(MAX_SHOCKS);
    postfx.aberrate(3);
    postfx.flare(1);
    for (let i = 0; i < 60; i++) postfx.update();
    expect(postfx.shocks.length).toBe(0);
    expect(postfx.aberration).toBe(0);
    expect(postfx.pulse).toBe(0);
    postfx.motion = 0;
    postfx.shock(0, 0);
    expect(postfx.shocks.length).toBe(0);
    postfx.active = false;
    postfx.motion = 1;
    postfx.clear();
  });
});

describe('effects state table (shared with the new FxSystem: tests/sje-fx.test.ts)', () => {
  it('every case of the shared table passes on the old postfx', () => {
    expect(runCases(() => new PostFx())).toEqual([]);
  });
});

describe('fx data (src/data/fx.json, edited in the FX lab)', () => {
  it('is valid, and every moment the game plays is in it', () => {
    expect(checkFx(FX)).toEqual([]);
    for (const m of Object.keys(GAME_MOMENTS)) expect(FX.moments[m], m).toBeDefined();
  });

  it('is written in its own format (a lab save round-trips to the same file)', () => {
    const text = readFileSync('src/data/fx.json', 'utf8').replace(/\r\n/g, '\n');
    expect(formatFx(JSON.parse(text) as FxData)).toBe(text);
    expect(JSON.parse(formatFx(FX))).toEqual(JSON.parse(text));
  });

  it('says what is wrong with bad data', () => {
    expect(checkFx(null)).not.toEqual([]);
    const bad = JSON.parse(JSON.stringify(FX)) as FxData;
    (bad.presets.embers as unknown as Record<string, unknown>).count = [9, 2];
    (bad.presets.embers as unknown as Record<string, unknown>).colors = ['red'];
    bad.moments.crit!.layers.push({ emit: 'no_such_preset' });
    bad.moments.crit!.layers.push({ flare: 1, aberrate: 2 });
    const problems = checkFx(bad).join('\n');
    expect(problems).toContain('count');
    expect(problems).toContain('colors');
    expect(problems).toContain('no preset "no_such_preset"');
    expect(problems).toContain('exactly one of');
  });

  it('a moment plays its layers, the delayed ones on the effects clock', () => {
    postfx.clear();
    postfx.active = true;
    const fx: FxData = {
      presets: { p: dot },
      moments: { m: { layers: [{ emit: 'p' }, { emit: 'p', delay: 5, weighted: true }, { shock: { strength: 2 } }] } },
    };
    playMoment(fx, 'm', 10, 10, { weight: 2 });
    expect(postfx.particles.count).toBe(5);
    expect(postfx.shocks.length).toBe(1);
    for (let i = 0; i < 4; i++) postfx.update();
    expect(postfx.particles.count).toBe(5);
    postfx.update();
    // The delayed, weighted layer: twice the count, on top of what's still alive.
    expect(postfx.particles.count).toBe(15);
    playMoment(fx, 'no_such_moment', 0, 0);
    postfx.active = false;
    postfx.clear();
  });
});
