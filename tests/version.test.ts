/** The version stamp: a real semver number, and a label the bitmap font can draw. */
import { describe, expect, it } from 'vitest';
import { hasGlyph } from '../src/engine/font';
import { APP_VERSION, BUILD_SHA, VERSION_LABEL } from '../src/version';

describe('version stamp', () => {
  it('APP_VERSION is semver, with an optional pre-release suffix like -dev', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });

  it('VERSION_LABEL starts with v and carries the version and the build', () => {
    expect(VERSION_LABEL.startsWith('v')).toBe(true);
    expect(VERSION_LABEL).toContain(APP_VERSION);
    expect(VERSION_LABEL).toContain(BUILD_SHA);
  });

  it('every character of VERSION_LABEL is one the font can draw', () => {
    const missing = [...VERSION_LABEL].filter((ch) => !hasGlyph(ch));
    expect(missing).toEqual([]);
  });

  // Today's SHA only uses some hex digits, so also check every character a future build stamp could
  // contain: all hex digits, the semver punctuation, and the 'nogit'/'dev' fallbacks.
  it('the font can draw any build stamp, not just this one', () => {
    const possible = 'v0123456789abcdef.-+ ·nogitdev';
    const missing = [...possible].filter((ch) => !hasGlyph(ch));
    expect(missing).toEqual([]);
  });
});
