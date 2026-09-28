/** Field actors: tile steps interpolate smoothly and report arrival exactly once. */
import { describe, expect, it, vi } from 'vitest';

// Sprite building needs a canvas; movement doesn't, so the art is stubbed out.
vi.mock('../src/art/chars', () => ({ buildChar: () => ({ frames: {}, w: 16, h: 24, ax: 8, ay: 22 }), walkFrame: () => 0 }));
vi.mock('../src/art/critters', () => ({ critterSprite: () => ({ frames: {}, w: 16, h: 16, ax: 8, ay: 14 }) }));

const { Actor } = await import('../src/field/actor');
const { TS } = await import('../src/field/tiles');

const look = { skin: '#fff', hair: '#000', hairStyle: 'short', top: '#000', accent: '#000', pants: '#000', boots: '#000' } as const;

describe('actor', () => {
  it('steps one tile over `dur` frames and reports arrival on the last one only', () => {
    const a = new Actor('t', look, 3, 4);
    a.step('right', 8);
    expect(a.moving).toBe(true);
    expect([a.x, a.y]).toEqual([4, 4]); // logical position is the destination
    const arrivals: number[] = [];
    for (let f = 1; f <= 10; f++) if (a.update()) arrivals.push(f);
    expect(arrivals).toEqual([8]);
    expect(a.moving).toBe(false);
    expect(a.px).toBe(4 * TS + 8);
  });

  it('interpolates pixel position part-way through a step', () => {
    const a = new Actor('t', look, 0, 0);
    a.step('down', 8);
    for (let f = 0; f < 4; f++) a.update();
    expect(a.py).toBe(0.5 * TS + 15);
    expect(a.dir).toBe('down');
  });

  it('follows to an adjacent tile, facing the way it moves; same tile is a no-op', () => {
    const a = new Actor('t', look, 5, 5);
    a.stepTo(5, 5, 8);
    expect(a.moving).toBe(false);
    a.stepTo(5, 4, 8);
    expect(a.dir).toBe('up');
    expect(a.moving).toBe(true);
  });

  it('settle() eases the second half of a step to a stop, and lands exactly on the tile', () => {
    const a = new Actor('t', look, 2, 2);
    a.step('right', 12);
    for (let f = 0; f < 6; f++) a.update();
    a.settle();
    let frames = 6;
    while (!a.update()) frames++;
    frames++;
    expect(frames).toBeGreaterThan(12); // takes longer than a clipped step…
    expect(a.px).toBe(3 * TS + 8); // …and still ends on the tile
    // A quick tap (settling in the first half) keeps its normal length.
    a.step('right', 12);
    a.update();
    a.settle();
    let n = 1;
    while (!a.update()) n++;
    expect(n + 1).toBe(12);
  });

  it('place() snaps position and cancels a move in progress', () => {
    const a = new Actor('t', look, 1, 1);
    a.step('left', 8);
    a.update();
    a.place(7, 2, 'right');
    expect(a.moving).toBe(false);
    expect([a.x, a.y, a.px, a.py, a.dir]).toEqual([7, 2, 7 * TS + 8, 2 * TS + 15, 'right']);
  });
});
