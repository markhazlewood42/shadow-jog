/**
 * Error notices (src/sje/core/errors.ts). The fault-isolation cases of the game core ("a throwing scene never kills the loop, and a persistently broken flow trips recovery") live in
 * tests/game-cases.ts and run on the engine's `Game` in tests/sje-game.test.ts. This file held them for the old engine's `Game` until M8d deleted that class (and its guard against
 * native scenes, which had no subject left).
 */
import { describe, expect, it, vi } from 'vitest';
import { currentNotice } from '../src/sje/core/errors';

// Not about `Game`: the notice merge rule of src/sje/core/errors.ts.
describe('error notices', () => {
  it('a second error while the first is showing is counted, not shown over it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { reportError, notice } = await import('../src/sje/core/errors');
    notice('clear', 'warn');
    reportError(new Error('root cause'));
    reportError(new Error('fallout'));
    reportError(new Error('more fallout'));
    expect(currentNotice()?.text).toBe('root cause (+2 more)');
  });
});
