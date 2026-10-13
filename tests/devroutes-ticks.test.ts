/** `?scene=hack&ticks=` is checked (review of PR #80): NaN made a hack that never ends, and 0 or a negative number ended it on the first tick. */
import { describe, expect, it } from 'vitest';
import { parseTicks } from '../src/hack3d/data';

describe('parseTicks', () => {
  it('a whole number of 1 or more is used', () => {
    expect(parseTicks('1')).toBe(1);
    expect(parseTicks('240')).toBe(240);
  });
  it('a missing, empty, non-numeric, zero, negative or fractional value is ignored (null: the definition keeps its own ticks)', () => {
    for (const bad of [null, '', ' ', 'abc', 'NaN', '0', '-5', '1.5', 'Infinity']) expect(parseTicks(bad), String(bad)).toBeNull();
  });
});
