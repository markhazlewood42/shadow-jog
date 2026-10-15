/** Game core: a throwing scene never kills the loop, and a persistently broken flow trips recovery. */
import { describe, expect, it, vi } from 'vitest';
import { currentNotice } from '../src/engine/errors';
import { FAULT_LIMIT, Game } from '../src/engine/game';
import type { Input } from '../src/engine/input';
import { defineGameCases, proxyCtx } from './game-cases';

// The cases themselves live in tests/game-cases.ts, so the new engine's `Game` (tests/sje-game.test.ts) runs the same ones.
defineGameCases(
  'old Game',
  (input: Input) => {
    const g = new Game(proxyCtx, input);
    return { game: g, tick: () => g.tick(), render: () => g.render() };
  },
  FAULT_LIMIT,
);

// Not about `Game`: the notice merge rule of engine/errors.ts. It stays here, after the shared cases.
describe('error notices', () => {
  it('a second error while the first is showing is counted, not shown over it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { reportError, notice } = await import('../src/engine/errors');
    notice('clear', 'warn');
    reportError(new Error('root cause'));
    reportError(new Error('fallout'));
    reportError(new Error('more fallout'));
    expect(currentNotice()?.text).toBe('root cause (+2 more)');
  });
});

// M8b: the old Game types `run` to accept a native sje scene (so game code compiles against one class), but it cannot run one. It must refuse
// loudly, not push a scene that has no `update`/`render`. At run time the game is the sje Game, so this guard only fires in a wiring mistake.
describe('old Game.run and native scenes', () => {
  it('throws when asked to run a native sje scene', async () => {
    const { Scene: NativeScene } = await import('../src/sje');
    class Native extends NativeScene<void> {
      fixedUpdate(): void {}
    }
    const g = new Game(proxyCtx, {} as unknown as Input);
    expect(() => g.run(new Native())).toThrow('the old Game cannot run a native sje scene');
    expect(g.top).toBeUndefined();
  });
});
