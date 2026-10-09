import { afterEach, describe, expect, it, vi } from 'vitest';
import { backfill, DEFAULT_SETTINGS as DEFAULTS } from '../src/game/settings';

describe('settings', () => {
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    vi.resetModules();
  });

  it('boots on defaults where even naming localStorage throws (storage blocked by the browser)', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    vi.resetModules();
    const { settings, DEFAULT_SETTINGS, saveSettings } = await import('../src/game/settings');
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings()).not.toThrow();
  });

  it('an old save in storage (gpuFx: false, scale: fit) loads as fxLevel none and integer', async () => {
    const stored = JSON.stringify({ musicVol: 0.4, gpuFx: false, scale: 'fit', shake: true });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => stored, setItem: () => undefined } });
    vi.resetModules();
    const { settings } = await import('../src/game/settings');
    expect(settings.fxLevel).toBe('none');
    expect(settings.scale).toBe('integer');
    expect(settings.musicVol).toBe(0.4);
    expect(settings.shake).toBe(2);
  });
});

describe('backfill: an old save becomes a current one (M1: fxLevel replaces gpuFx, scale is integer only)', () => {
  it('gpuFx: true becomes fxLevel auto, gpuFx: false becomes none, and gpuFx is gone', () => {
    const on = backfill({ gpuFx: true });
    const off = backfill({ gpuFx: false });
    expect(on.fxLevel).toBe('auto');
    expect(off.fxLevel).toBe('none');
    expect('gpuFx' in on).toBe(false);
    expect('gpuFx' in off).toBe(false);
  });

  it('control: a mapping that swapped the two (true to none) is told apart', () => {
    const swapped = (gpuFx: boolean) => (gpuFx ? 'none' : 'auto');
    expect(swapped(true)).not.toBe(backfill({ gpuFx: true }).fxLevel);
    expect(swapped(false)).not.toBe(backfill({ gpuFx: false }).fxLevel);
  });

  it('an fxLevel that is already there wins over a stale gpuFx, and a bad value falls back to the default', () => {
    expect(backfill({ fxLevel: 'full', gpuFx: false }).fxLevel).toBe('full');
    expect(backfill({ fxLevel: 'none', gpuFx: true }).fxLevel).toBe('none');
    expect(backfill({ fxLevel: 'loud' }).fxLevel).toBe(DEFAULTS.fxLevel);
  });

  it("scale 'fit' migrates to 'integer' (the fit mode was dropped), and so does anything else", () => {
    expect(backfill({ scale: 'fit' }).scale).toBe('integer');
    expect(backfill({ scale: 'integer' }).scale).toBe('integer');
    expect(backfill({ scale: 'weird' }).scale).toBe('integer');
  });

  it('a whole old save (v1 shake boolean, the dead crt toggle, gpuFx, fit) loads with everything else kept', () => {
    const old = { musicVol: 0.2, sfxVol: 0.3, textSpeed: 3, battleSpeed: 2, scale: 'fit', shake: true, flash: 1, hitPause: false, touch: 'on', timing: 'assist', keys: { confirm: 'KeyJ' }, gpuFx: false, crt: true };
    const s = backfill(old);
    expect(s).toMatchObject({ musicVol: 0.2, sfxVol: 0.3, textSpeed: 3, battleSpeed: 2, scale: 'integer', shake: 2, flash: 1, hitPause: false, touch: 'on', timing: 'assist', keys: { confirm: 'KeyJ' }, fxLevel: 'none' });
    expect('crt' in s).toBe(false);
    expect('gpuFx' in s).toBe(false);
  });

  it('a save without the new fields gets the defaults; garbage input does not throw', () => {
    expect(backfill({})).toEqual(DEFAULTS);
    expect(backfill(null)).toEqual(DEFAULTS);
    expect(backfill('nope')).toEqual(DEFAULTS);
  });
});
