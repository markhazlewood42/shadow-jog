/**
 * The jack-out gate of the hack scene (src/hack3d/hackscene.ts `update3D`): a hack ALWAYS resolves (decision E11), and a finished hack keeps its result.
 * The review of PR #80 found two gaps: a gate that throws at once left the scene stuck on its last frame, and a context loss while the cover closed replaced the
 * finished result with an abort (the policy would then replay a hack that was won).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type HackOptions, startHack } from '../src/hack3d';
import type { HackDef } from '../src/hack3d/result';
import { H, W } from '../src/sje/core/size';
import { View3D } from '../src/sje/display/view3d';
import { CanvasFrameTexture } from '../src/sje/render/frametexture';
import type { Frame3D } from '../src/sje/three';
import { fakeCanvas, headlessGame } from './sjekit';

const DEF: HackDef = { id: 't', seed: 7, ticks: 20, iceCount: 3, traceLimit: 100, hitCost: 10 };

class FakeFrame implements Frame3D {
  readonly mode = 'shared-context';
  readonly sprite: View3D;
  contextLost = false;
  constructor(host: { textures: never }) {
    this.sprite = new View3D(host, new CanvasFrameTexture(fakeCanvas(W, H)));
  }
  render(): void {}
  rewrap(): void {}
  releaseGpuData(): void {}
  privateContext(): null {
    return null;
  }
  readPixels(): never {
    throw new Error('not in a fake');
  }
  describe(): ReturnType<Frame3D['describe']> {
    return { mode: this.mode, width: W, height: H, minFilter: 'nearest', magFilter: 'nearest', rewraps: 0, hosts: { shared: 0, private: 0 } };
  }
  dispose(): void {}
}

function opts(extra: HackOptions, frames: FakeFrame[]): HackOptions {
  return {
    hud: false,
    ...extra,
    makeFrame: (_setup, host) => {
      const f = new FakeFrame(host as never);
      frames.push(f);
      return f;
    },
  };
}

beforeEach(() => void vi.spyOn(console, 'error').mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

describe('the jack-out gate of the hack scene', () => {
  it('a gate that throws at once does not trap the scene: it closes with the result of the sim', async () => {
    const { game } = headlessGame();
    const p = startHack(
      game,
      DEF,
      opts(
        {
          gate: () => {
            throw new Error('gate broke');
          },
        },
        [],
      ),
    );
    game.step(30);
    expect((await p).status).toBe('success');
  });

  it('a context loss while the cover closes (the gate is open) gives the finished result, not an abort', async () => {
    const { game } = headlessGame();
    const frames: FakeFrame[] = [];
    // A gate that never settles: the scene waits in `ending`, the way it does while the cover closes.
    const p = startHack(game, DEF, opts({ gate: () => new Promise<void>(() => undefined), contextGraceMs: 0 }, frames));
    game.step(30);
    const f = frames[0];
    if (f) f.contextLost = true;
    game.draw();
    expect((await p).status).toBe('success');
  });

  it('CONTROL: a context loss BEFORE the sim ends is still an abort (context-lost)', async () => {
    const { game } = headlessGame();
    const frames: FakeFrame[] = [];
    const p = startHack(game, { ...DEF, ticks: 900 }, opts({ contextGraceMs: 0 }, frames));
    game.step(3);
    const f = frames[0];
    if (f) f.contextLost = true;
    game.draw();
    expect(await p).toEqual({ status: 'aborted', reason: 'context-lost' });
  });
});
