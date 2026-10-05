/**
 * E11: a hack ALWAYS resolves, even when freeing its parts throws (src/hack3d/hackscene.ts `dispose3D`).
 * Round 3 found the gap: `dispose3D` freed the HUD first and told the waiting story afterwards, so a HUD
 * that threw left the promise pending for ever. Here the HUD's `destroy` is made to throw, and the hack
 * must still resolve (aborted / user) while the rest of the scene is still freed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A HUD that builds fine and cannot be destroyed. (The real one needs a canvas for its text.)
const hud = vi.hoisted(() => ({ destroys: 0 }));
vi.mock('../src/hack3d/hud', () => ({
  HUD_FIXED: {},
  captionFor: () => 'caption',
  HackHud: class {
    update(): void {}
    destroy(): void {
      hud.destroys++;
      throw new Error('texture destroy refused');
    }
  },
}));

import { type HackOptions, startHack } from '../src/hack3d';
import type { HackDef } from '../src/hack3d/result';
import { View3D } from '../src/sje/display/view3d';
import { CanvasFrameTexture } from '../src/sje/render/frametexture';
import type { Frame3D } from '../src/sje/three';
import { fakeCanvas, headlessGame } from './sjekit';

const DEF: HackDef = { id: 't', seed: 7, ticks: 900, iceCount: 3, traceLimit: 100, hitCost: 10 };

/** A frame that draws nothing and counts its disposes. */
class FakeFrame implements Frame3D {
  readonly mode = 'shared-context';
  readonly sprite: View3D;
  disposes = 0;
  contextLost = false;
  constructor(host: { textures: never }) {
    this.sprite = new View3D(host, new CanvasFrameTexture(fakeCanvas(480, 270)));
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
    return { mode: this.mode, width: 480, height: 270, minFilter: 'nearest', magFilter: 'nearest', rewraps: 0, hosts: { shared: 0, private: 0 } };
  }
  dispose(): void {
    this.disposes++;
  }
}

beforeEach(() => {
  hud.destroys = 0;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

function withFrames(): { options: HackOptions; frames: FakeFrame[] } {
  const frames: FakeFrame[] = [];
  return {
    frames,
    options: {
      hud: true,
      makeFrame: (host) => {
        const f = new FakeFrame(host as never);
        frames.push(f);
        return f;
      },
    },
  };
}

describe('a HUD that throws while the scene is freed', () => {
  it('game.abandon(): the hack still resolves aborted / user, and the frame is still disposed', async () => {
    const { game } = headlessGame();
    const { options, frames } = withFrames();
    const p = startHack(game, DEF, options);
    game.step(3);
    game.abandon();
    expect(await p).toEqual({ status: 'aborted', reason: 'user' });
    expect(hud.destroys).toBe(1);
    // The failure of one part did not skip the others (`freeAll` runs every step).
    expect(frames[0]?.disposes).toBe(1);
    // The failure was reported, not swallowed.
    expect(console.error).toHaveBeenCalled();
  });

  it('game.reset(): the same', async () => {
    const { game } = headlessGame();
    const { options } = withFrames();
    const p = startHack(game, DEF, options);
    game.step(3);
    void game.reset(new (class extends (await import('../src/sje')).Scene<void> {
      fixedUpdate(): void {}
    })());
    expect(await p).toEqual({ status: 'aborted', reason: 'user' });
    expect(hud.destroys).toBe(1);
  });

  it('a hack that finishes normally still gives ITS result, even though the HUD cannot be freed', async () => {
    const { game } = headlessGame();
    const { options } = withFrames();
    const p = startHack(game, { ...DEF, ticks: 20 }, options);
    game.step(20);
    expect((await p).status).toBe('success');
    expect(hud.destroys).toBe(1);
  });
});
