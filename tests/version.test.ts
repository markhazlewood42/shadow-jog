/** The version stamp: a real semver number, and a label the bitmap font can draw. */
import { describe, expect, it } from 'vitest';
import { hasGlyph } from '../src/engine/font';
import { APP_VERSION, BUILD_SHA, VERSION_LABEL } from '../src/version';

// The official Semantic Versioning 2.0.0 pattern (https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string):
// no leading zeros, dot-separated pre-release parts (like -dev or -rc.1), optional +build metadata.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

describe('version stamp', () => {
  it('APP_VERSION is semver, with an optional pre-release suffix like -dev', () => {
    expect(APP_VERSION).toMatch(SEMVER);
  });

  it('the semver check accepts real versions and rejects malformed ones', () => {
    for (const ok of ['0.1.0', '0.2.0-dev', '1.0.0-rc.1', '1.2.3+abc1234', '0.2.0-spike.phaser.1']) expect(ok).toMatch(SEMVER);
    for (const bad of ['01.2.3', '1.2', '1.2.3-..', '1.2.3-01', 'v1.2.3', '1.2.3+']) expect(bad).not.toMatch(SEMVER);
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
