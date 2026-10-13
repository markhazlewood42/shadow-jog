/**
 * The DEV door seam in src/game/hackseam.ts (M7 task 6; docs/engine/m7-brief.md decision D1 A). A booted game always has WebGL 2 and its probe keeps the context, so an e2e test cannot
 * make a page without WebGL 2. The seam lets a DEV test replace the door's environment (the probe, the chunk loader) and the scene options for the hacks that start after it.
 * A shipped build must ignore it. Node has no canvas and no chunk, so every case here uses fakes (and no cover: `jack: async () => null`, because the real cover needs a game with a screen).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hackDef, hackDevOverride, runHack, setHackDevOverride } from '../src/game/hackseam';
import type { HackResult } from '../src/hack3d/result';
import type { ScriptApi } from '../src/game/script';

const game = { contextLost: false, dropCount: 0 };
const SUCCESS: HackResult = { status: 'success' };

afterEach(() => {
  setHackDevOverride(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('E19: the author chooses what happens without 3D (the type and the run time)', () => {
  // TYPE TEST: `tsc` (npm run check) fails if a call with neither `playAlternative` nor `onUnsupported: 'win'` ever compiles again. This function is never called.
  function typeTest(s: ScriptApi): void {
    const def = hackDef('test-short');
    // @ts-expect-error a hack with no handling for a browser without 3D does not compile
    void s.hack(def);
    // @ts-expect-error an empty options object is no choice either
    void s.hack(def, {});
    // @ts-expect-error `onUnsupported` only has the value 'win'
    void s.hack(def, { onUnsupported: 'fail' });
    // @ts-expect-error both at once is not a choice
    void s.hack(def, { playAlternative: async () => 'success' as const, onUnsupported: 'win' });
    // These two compile:
    void s.hack(def, { playAlternative: async () => 'fail' });
    void s.hack(def, { onUnsupported: 'win' });
  }
  it('the type test above is compiled by tsc (this case only keeps it from being unused)', () => {
    expect(typeTest).toBeTypeOf('function');
  });

  it('no WebGL 2 with { onUnsupported: "win" }: the explicit win, via the alternative path, the chunk never asked for', async () => {
    const load = vi.fn(async () => ({ startHack: async () => SUCCESS }));
    setHackDevOverride({ env: { probe: () => false, load, jack: async () => null } });
    const out = await runHack(game, hackDef('test-fallback'), { onUnsupported: 'win' });
    expect(out).toEqual({ outcome: 'success', via: 'alternative', results: [{ status: 'unsupported', reason: 'no-webgl2' }] });
    expect(load).not.toHaveBeenCalled();
  });

  it('run-time totality: a caller that dodged the types with neither field still gets an outcome (the door never rejects)', async () => {
    setHackDevOverride({ env: { probe: () => false, jack: async () => null } });
    const out = await runHack(game, hackDef('test-fallback'), {} as never);
    expect(out.outcome).toBe('success');
  });
});

describe('the DEV door seam', () => {
  it('a replaced probe that says false gives unsupported / no-webgl2, and the 2D alternative plays; the chunk loader is never called', async () => {
    const load = vi.fn(async () => ({ startHack: async () => SUCCESS }));
    setHackDevOverride({ env: { probe: () => false, load, jack: async () => null } });
    const alt = vi.fn(async () => 'fail' as const);
    const out = await runHack(game, hackDef('test-fallback'), { playAlternative: alt });
    expect(out).toEqual({ outcome: 'fail', via: 'alternative', results: [{ status: 'unsupported', reason: 'no-webgl2' }] });
    expect(alt).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
  });

  it('a replaced chunk loader that rejects gives unsupported / chunk-failed, and the error is logged once', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setHackDevOverride({ env: { probe: () => true, load: async () => Promise.reject(new Error('no chunk')), jack: async () => null } });
    const out = await runHack(game, hackDef('test-fallback'), { onUnsupported: 'win' });
    expect(out.results).toEqual([{ status: 'unsupported', reason: 'chunk-failed' }]);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('the scene options reach startHack, and the replaced environment is the only change (the rest of the real environment stays)', async () => {
    const startHack = vi.fn(async () => SUCCESS);
    setHackDevOverride({ env: { probe: () => true, load: async () => ({ startHack }), jack: async () => null }, options: { frame: 'canvas-copy', contextGraceMs: 2500, hud: false } });
    const def = hackDef('test-short');
    const out = await runHack(game, def, { onUnsupported: 'win' });
    expect(out).toEqual({ outcome: 'success', via: 'played', results: [SUCCESS] });
    expect(startHack).toHaveBeenCalledWith(expect.anything(), def, { frame: 'canvas-copy', contextGraceMs: 2500, hud: false });
  });

  it('setHackDevOverride(null) puts the real environment back', () => {
    setHackDevOverride({ options: { hud: false } });
    expect(hackDevOverride()).toEqual({ options: { hud: false } });
    setHackDevOverride(null);
    expect(hackDevOverride()).toBeNull();
  });

  it('a shipped build ignores the override: nothing is stored and nothing is read', () => {
    vi.stubEnv('DEV', false);
    setHackDevOverride({ env: { probe: () => false } });
    expect(hackDevOverride()).toBeNull();
    vi.unstubAllEnvs();
    // Nothing was stored under the shipped flag: a DEV read finds nothing either.
    expect(hackDevOverride()).toBeNull();
  });
});
