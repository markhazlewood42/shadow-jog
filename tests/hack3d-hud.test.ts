/**
 * The HUD's cleanup when its constructor throws half way (src/hack3d/hud.ts). A constructor that
 * throws gives its caller nothing to destroy, so the HUD must free the text textures it already made.
 * The scene is a stand-in that records `createCanvas` and `remove`: no Pixi, no GPU.
 */
import { describe, expect, it } from 'vitest';
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
});
