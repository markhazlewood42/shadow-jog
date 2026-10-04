import { describe, expect, it } from 'vitest';
import { clearLane, contactY, nearEdge, type Silhouette } from '../src/stage/contact';
import type { Raw } from '../src/stage/pixels';

/** A target drawn like a tall boss: wide shoulder pods high up (x 10-60, rows 5-25), a narrow torso, two legs (x 30-38 and 42-50, rows 26-59), feet on row 60. */
function boss(): Silhouette {
  const raw: Raw = { w: 70, h: 64, px: new Uint8ClampedArray(70 * 64 * 4) };
  const fill = (x0: number, x1: number, y0: number, y1: number): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) raw.px.set([200, 200, 200, 255], (y * 70 + x) * 4);
  };
  fill(10, 60, 5, 25);
  fill(30, 50, 26, 59);
  return { raw, box: { x0: 10, y0: 5, x1: 60, y1: 59 }, foot: { x: 40, y: 60 } };
}

describe('nearEdge: where a blow meets the body, not its bounding box', () => {
  const b = boss();
  it('finds the shoulder pod at chest height and the leg at knee height, from the left', () => {
    // Chest: 40 rows above the feet is row 20 (inside the pods). The pods start at x 10, which is 30 left of the feet column.
    expect(nearEdge(b, -40, 1)).toBe(10 - 40);
    // Knee: 10 above the feet is row 50, where only the legs are (x 30).
    expect(nearEdge(b, -10, 1)).toBe(30 - 40);
  });
  it('mirrors for an attacker coming from the right', () => {
    expect(nearEdge(b, -40, -1)).toBe(61 - 40);
    expect(nearEdge(b, -10, -1)).toBe(51 - 40);
  });
  it('a weapon higher than the head lands on the top rows, one lower than the soles on the bottom rows', () => {
    expect(nearEdge(b, -200, 1)).toBe(10 - 40);
    expect(nearEdge(b, 30, 1)).toBe(30 - 40);
  });
  it('is null for an empty picture', () => {
    const empty: Silhouette = { raw: { w: 10, h: 10, px: new Uint8ClampedArray(400) }, box: { x0: 0, y0: 0, x1: 9, y1: 9 }, foot: { x: 5, y: 10 } };
    expect(nearEdge(empty, -3, 1)).toBeNull();
  });
  it('ignores faint pixels (a glow is not a body)', () => {
    const g = boss();
    for (let y = 40; y < 60; y++) g.raw.px.set([255, 255, 255, 30], (y * 70 + 20) * 4);
    expect(nearEdge(g, -10, 1)).toBe(30 - 40);
  });
});

describe('contactY keeps the spark on the target', () => {
  const box = { y0: 36, y1: 59 };
  const foot = { y: 60 };
  it('leaves a blow that lands inside the target alone', () => {
    expect(contactY(190, 200, box, foot)).toBe(190);
  });
  it('pulls a fist swung over a short target down onto its back', () => {
    // A 24 px target on row 200: its top is row 176; a fist at row 150 lands just under the top.
    expect(contactY(150, 200, box, foot)).toBe(176 + 3);
  });
  it('and never lower than the feet', () => {
    expect(contactY(260, 200, box, foot)).toBe(198);
  });
});

describe('clearLane: how far to step down the stage to run in front of the crew', () => {
  it('goes to the nearest mate’s row plus a margin', () => {
    expect(clearLane(191, [208, 174, 157])).toBe(21);
  });
  it('is 0 for the hero already in front, and 0 with no mates', () => {
    expect(clearLane(208, [191, 174, 157])).toBe(0);
    expect(clearLane(208, [])).toBe(0);
  });
  it('is capped so the fighter does not leave the floor', () => {
    expect(clearLane(100, [250])).toBe(28);
  });
  it('shrinks when the front hero has fallen (the caller leaves fallen heroes out)', () => {
    expect(clearLane(191, [174, 157])).toBe(0);
  });
});
