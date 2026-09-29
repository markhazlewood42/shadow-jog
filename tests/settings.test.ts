import { afterEach, describe, expect, it, vi } from 'vitest';

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
});
