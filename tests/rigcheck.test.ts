// The animation editor's save check (src/art/rig2/check.ts): the dev server writes skeleton.json
// only if the posted skeletons pass it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { POSE_KEYS, checkSkeletons } from '../src/art/rig2/check';

const saved = () => JSON.parse(readFileSync('public/art/rig/skeleton.json', 'utf8')) as Record<string, Record<string, unknown>>;

describe('skeleton.json check', () => {
  it('passes the skeletons the game ships with', () => {
    expect(checkSkeletons(saved())).toEqual([]);
  });

  it('knows the same key poses as the rig', async () => {
    const { KEY_POSES } = await import('../src/art/rig2/battle');
    expect([...POSE_KEYS]).toEqual([...KEY_POSES]);
  });

  it('catches a broken shape anywhere in it, in plain words', () => {
    const cases: [string, (d: Record<string, Record<string, unknown>>) => void, RegExp][] = [
      ['not an object', (d) => Object.assign(d, { kit: 5 }), /kit is not an object/],
      ['a missing arm', (d) => delete d.kit!.arm, /kit\.arm is missing/],
      ['a joint that is not a point', (d) => ((d.kit!.arm as Record<string, unknown>).shoulder = [1]), /kit\.arm\.shoulder is not valid/],
      ['a bad colour', (d) => (d.kit!.light = 'red'), /kit\.light is not valid/],
      ['an unknown pose', (d) => ((d.kit!.poses as Record<string, unknown>).dance = { hand: [1, 2] }), /kit\.poses\.dance is not a field/],
      ['a pose without a hand', (d) => ((d.rook!.poses as Record<string, Record<string, unknown>>).strike!.hand = undefined), /rook\.poses\.strike\.hand is missing/],
      ['a weapon of an unknown kind', (d) => ((d.rook!.poses as Record<string, Record<string, unknown>>).strike!.weapon = { kind: 'axe', angle: 0 }), /rook\.poses\.strike\.weapon\.kind is not valid/],
      ['a broken free arm', (d) => ((d.rook!.free as Record<string, unknown>).pose = 'up'), /rook\.free\.pose is not valid/],
      ['a typo in a field name', (d) => ((d.rook!.stance as Record<string, unknown>).sinkk = 2), /rook\.stance\.sinkk is not a field/],
    ];
    for (const [what, breakIt, problem] of cases) {
      const d = saved();
      breakIt(d);
      expect(checkSkeletons(d).join('; '), what).toMatch(problem);
    }
    expect(checkSkeletons([])).toEqual(['expected an object of skeletons']);
    expect(checkSkeletons(null)).toEqual(['expected an object of skeletons']);
    expect(checkSkeletons({})).toEqual(['no skeletons']);
  });
});
