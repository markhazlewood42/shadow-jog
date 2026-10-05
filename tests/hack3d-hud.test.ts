/**
 * The HUD's cleanup when its constructor throws half way (src/hack3d/hud.ts). A constructor that
 * throws gives its caller nothing to destroy, so the HUD must free the text textures it already made.
 * The scene is a stand-in that records `createCanvas` and `remove`: no Pixi, no GPU.
 */
import { describe, expect, it, vi } from 'vitest';

// The game's font draws on a real canvas, and Node has none. These tests are about texture bookkeeping, so the drawing is a no-op.
vi.mock('../src/engine/font', () => ({ drawText: () => undefined, measure: (s: string) => s.length * 5 }));
import { HackHud } from '../src/hack3d/hud';
import { HackSim } from '../src/hack3d/sim/hacksim';

/** A chainable stand-in for a display object: any method you call on it returns itself. */
const proxy: never = new Proxy({} as Record<string, unknown>, { get: () => () => proxy }) as never;

function fakeScene(failOnCanvas: number): { scene: never; made: string[]; removed: string[] } {
  const made: string[] = [];
  const removed: string[] = [];
  const scene = {
    key: 'hud-test',
    add: { layer: () => proxy, graphics: () => proxy, image: () => proxy },
    textures: {
      createCanvas: (key: string) => {
        if (made.length + 1 === failOnCanvas) throw new Error('out of texture memory');
        made.push(key);
        return { canvas: {}, ctx: { canvas: { width: 1, height: 1 }, clearRect: () => undefined }, refresh: () => undefined };
      },
      remove: (key: string) => {
        removed.push(key);
        return true;
      },
    },
  };
  return { scene: scene as never, made, removed };
}

const sim = () => new HackSim({ seed: 1, ticks: 60, iceCount: 2, traceLimit: 100, hitCost: 10 });

describe('HackHud construction', () => {
  it('a throw while making the third text line frees the two textures that were made, and the error still comes out', () => {
    const { scene, made, removed } = fakeScene(3);
    expect(() => new HackHud(scene, sim(), 'T')).toThrow('out of texture memory');
    expect(made).toHaveLength(2);
    // Every key the HUD tried to make is asked to be removed (a key that never got a texture is a harmless no-op in the store).
    for (const key of made) expect(removed).toContain(key);
  });

  it('destroy: a texture that will not be freed does not stop the others, and the first error comes out', () => {
    const { scene, made, removed } = fakeScene(0);
    const hud = new HackHud(scene, sim(), 'T');
    removed.length = 0;
    const textures = (scene as unknown as { textures: { remove: (k: string) => boolean } }).textures;
    const real = textures.remove;
    let calls = 0;
    textures.remove = (key) => {
      calls++;
      if (calls === 1) throw new Error('destroy refused');
      return real(key);
    };
    expect(() => hud.destroy()).toThrow('destroy refused');
    // Every key was tried, so all but the one that threw were removed.
    expect(calls).toBe(made.length);
    expect(removed).toHaveLength(made.length - 1);
  });
});
