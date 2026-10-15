/**
 * The screen size the display tests assume. The old scale rule (`cssScaleFor`, two modes) and its table of window sizes were removed in M8d: the shipped display
 * (`src/sje/runtime/display.ts`) has the integer mode only, and `tests/sje-display.test.ts` pins its windows (720p at 2x, 1080p at 3x, 1440p at 4x, 4K at 6x).
 */
import { describe, expect, it } from 'vitest';
import { H, W } from '../src/sje/core/size';

describe('the screen is 640 by 360 (the display tests are written for it)', () => {
  it('has the size the table assumes', () => {
    expect([W, H]).toEqual([640, 360]);
  });
});
