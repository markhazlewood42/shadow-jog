/**
 * Battle geometry: the size relations the battle layers depend on (PL4, V3 of docs/PIVOT-640.md).
 * It grows with the WP2b build; this first part is the one-pixel-grid pin (the named fix V3 of WP2).
 */
import { describe, expect, it } from 'vitest';
import { H, W } from '../src/engine/game';
import { BHT, BW, WORLD_SCALE } from '../src/scenes/battlekit/geom';

describe('the battle world is an exact multiple of the screen', () => {
  it('BW * WORLD_SCALE is the screen width and BHT * WORLD_SCALE is the screen height', () => {
    // If the world were not an exact fraction of the screen, the backdrop would be stretched by a
    // fractional factor (the bare-flip fault: 2.667x under a 2x enemy layer) and pixels would
    // be uneven.
    expect(BW * WORLD_SCALE).toBe(W);
    expect(BHT * WORLD_SCALE).toBe(H);
  });

  it('the world size is whole pixels', () => {
    expect(Number.isInteger(BW)).toBe(true);
    expect(Number.isInteger(BHT)).toBe(true);
  });
});
