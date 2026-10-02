import { describe, expect, it } from 'vitest';
import { KATA_HOLD, KATA_LEAD, KATA_POSES, KATA_ZANSHIN, isContact, kataBeat, kataLength, kataTimeline } from '../src/art/rig2/sidekata';

describe("Rook's kendo strike timeline (spike side-battle)", () => {
  for (const at of [18, 24, 30]) {
    for (const low of [false, true]) {
      const tl = kataTimeline(at, low);
      const starts: number[] = [];
      let n = 0;
      for (const s of tl) {
        starts.push(n);
        n += s.frames;
      }
      it(`at ${at}${low ? ' (low target)' : ''}: the first contact frame shows KATA_LEAD frames before the effect`, () => {
        const i = tl.findIndex((s) => isContact(s.key));
        expect(starts[i]).toBe(at - KATA_LEAD);
      });
      it(`at ${at}${low ? ' (low target)' : ''}: the contact is held through the hit, then zanshin, then home`, () => {
        const i = tl.findIndex((s) => isContact(s.key));
        expect((tl[i]?.frames ?? 0) + (tl[i + 1]?.frames ?? 0)).toBe(KATA_HOLD);
        expect(tl[i + 2]?.key).toBe('zanshin');
        expect(tl[i + 2]?.frames).toBe(KATA_ZANSHIN);
      });
      it(`at ${at}${low ? ' (low target)' : ''}: the body is home before the sword is sheathed, and never crosses the crew with the blade raised`, () => {
        const back = tl.findIndex((s, j) => j > 0 && s.key === 'ready' && tl[j - 1]?.key === 'zanshin');
        expect(tl[back]?.to).toBe(0);
        for (const s of tl.slice(back + 1)) expect(s.from + s.to).toBe(0);
      });
      it(`at ${at}${low ? ' (low target)' : ''}: the dash spacing keeps growing and the length adds up`, () => {
        const lunges = [0, 1, 2, 3, 4, 5].map((j) => kataBeat(starts[tl.findIndex((s) => s.key === 'swing0')] + j, at, low).lunge);
        for (let j = 1; j < lunges.length; j++) expect(lunges[j] as number).toBeGreaterThan(lunges[j - 1] as number);
        expect(kataLength(at, low)).toBe(n);
      });
    }
  }
  it('every cut frame has a smear, the swing2 is held two frames, and a low target uses the lowered blade', () => {
    for (const k of ['swing0', 'swing1', 'swing2', 'contact0', 'contact0Low'] as const) expect(KATA_POSES[k].smear).toBeDefined();
    expect(kataTimeline(18).find((s) => s.key === 'swing2')?.frames).toBe(2);
    expect(kataTimeline(18, true).some((s) => s.key === 'contactLow')).toBe(true);
    expect(KATA_POSES.contactLow.deg).toBeLessThan(KATA_POSES.contact.deg);
  });
});
