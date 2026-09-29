/** Timed presses: each kind of move has its own beat, and the payoff matches the risk. */
import { describe, expect, it } from 'vitest';
import { BRACE_MULT, STRIKE_MULT, timingProfile } from '../src/battle/engine';
import { ABILITIES } from '../src/data/abilities';
import { judge, WINDOWS } from '../src/scenes/battlekit/timing';

describe('timing profiles', () => {
  it('moves get the profile their speed suggests', () => {
    expect(timingProfile(ABILITIES.flash_step!, 'strike')).toBe('quick');
    expect(timingProfile(ABILITIES.attack!, 'strike')).toBe('normal');
    const combo = Object.values(ABILITIES).find((a) => a.kind === 'combo')!;
    expect(timingProfile(combo, 'strike')).toBe('heavy');
    expect(timingProfile(ABILITIES.e_pulse_cannon!, 'brace')).toBe('heavy');
    expect(timingProfile(ABILITIES.attack!, 'brace')).toBe('normal');
  });

  it('a tighter window pays more: quick strikes reward most, heavy ones least', () => {
    expect(WINDOWS.quick.perfect).toBeLessThan(WINDOWS.normal.perfect);
    expect(WINDOWS.normal.perfect).toBeLessThan(WINDOWS.heavy.perfect);
    expect(STRIKE_MULT.quick.perfect).toBeGreaterThan(STRIKE_MULT.normal.perfect);
    expect(STRIKE_MULT.normal.perfect).toBeGreaterThan(STRIKE_MULT.heavy.perfect);
    // A blow you saw coming is the one you can brace hardest for.
    expect(BRACE_MULT.heavy.perfect).toBeLessThan(BRACE_MULT.normal.perfect);
  });

  it('the same press grades differently by profile', () => {
    // Four frames early: a heavy move's perfect, a normal move's good, a quick move's good.
    expect(judge(-4, 'heavy')).toBe('perfect');
    expect(judge(-4, 'normal')).toBe('good');
    expect(judge(-4, 'quick')).toBe('good');
    // Eight frames early: too early for a quick move.
    expect(judge(-8, 'quick')).toBe('early');
    expect(judge(-8, 'normal')).toBe('good');
    expect(judge(6, 'normal')).toBe('late');
    expect(judge(6, 'heavy')).toBe('good');
  });
});
