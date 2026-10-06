import { describe, expect, it } from 'vitest';
import { formatAge, formatDuration } from '../src/web/now/time';

// The two short ways that the Now page says "how long". They are pure functions of a length or two times, so a test needs no clock.

const NOW = Date.parse('2026-10-06T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatDuration', () => {
  it('says seconds under a minute, minutes under an hour, hours under a day and days after that', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(45_900)).toBe('45 s');
    expect(formatDuration(59_999)).toBe('59 s');
    expect(formatDuration(MIN)).toBe('1 min');
    expect(formatDuration(12 * MIN + 40_000)).toBe('12 min');
    expect(formatDuration(HOUR)).toBe('1 h');
    expect(formatDuration(3 * HOUR + 5 * MIN)).toBe('3 h 5 min');
    expect(formatDuration(DAY)).toBe('1 d');
    expect(formatDuration(2 * DAY + 4 * HOUR + 30 * MIN)).toBe('2 d 4 h');
  });

  it('takes a negative length (two clocks that differ) as 0', () => {
    expect(formatDuration(-5_000)).toBe('0 s');
  });
});

describe('formatAge', () => {
  it('says how long ago a time was, in the biggest unit', () => {
    expect(formatAge(ago(5_000), NOW)).toBe('just now');
    expect(formatAge(ago(59_000), NOW)).toBe('just now');
    expect(formatAge(ago(MIN), NOW)).toBe('1 min ago');
    expect(formatAge(ago(59 * MIN), NOW)).toBe('59 min ago');
    expect(formatAge(ago(HOUR), NOW)).toBe('1 h ago');
    expect(formatAge(ago(23 * HOUR + 59 * MIN), NOW)).toBe('23 h ago');
    expect(formatAge(ago(DAY), NOW)).toBe('1 d ago');
    expect(formatAge(ago(6 * DAY + 5 * HOUR), NOW)).toBe('6 d ago');
  });

  it('takes a time ahead of the clock as just now, and shows a text that is not a time as it is', () => {
    expect(formatAge(new Date(NOW + 30 * MIN).toISOString(), NOW)).toBe('just now');
    expect(formatAge('', NOW)).toBe('');
    expect(formatAge('last week', NOW)).toBe('last week');
  });
});
