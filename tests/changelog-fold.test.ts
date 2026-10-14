import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkDir, fold, foldIntoChangelog, main, parseEntry, validateEntry } from '../scripts/changelog-fold.mjs';

/**
 * Changelog entry files (changelog.d/README.md). A feature PR adds `changelog.d/<branch-slug>.md` and never edits CHANGELOG.md;
 * `scripts/changelog-fold.mjs` merges the files into a release section. These tests cover the validator, the fold and the dry run
 * in a temp folder, and run the validator over the real changelog.d folder, so a bad entry file fails `npm run check` and CI.
 */

const CHANGELOG = `# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.1.0] - 2026-10-03

### Added
- First release.

[Unreleased]: https://github.com/example/repo/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/example/repo/releases/tag/v0.1.0
`;

let root: string;
let dir: string;
let changelogPath: string;

const entry = (name: string, text: string) => writeFileSync(join(dir, name), text);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'changelog-fold-'));
  dir = join(root, 'changelog.d');
  mkdirSync(dir);
  changelogPath = join(root, 'CHANGELOG.md');
  writeFileSync(changelogPath, CHANGELOG);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the real changelog.d folder', () => {
  it('holds only valid entry files', () => {
    const { errors } = checkDir();
    expect(errors).toEqual([]);
  });
});

describe('validateEntry', () => {
  it('accepts headings with bullets, indented continuations and every allowed heading', () => {
    const text = [
      '### Added',
      '- One.',
      '  - nested',
      '',
      '  wrapped paragraph',
      '- Two.',
      '### Changed',
      '- C.',
      '### Deprecated',
      '- D.',
      '### Removed',
      '- R.',
      '### Fixed',
      '- F.',
      '### Security',
      '- S.',
      '',
    ].join('\n');
    expect(validateEntry(text, 'good.md')).toEqual([]);
    expect(parseEntry(text).sections.Added).toEqual(['- One.\n  - nested\n\n  wrapped paragraph', '- Two.']);
  });

  it.each([
    ['an empty file', '', /empty/],
    ['a blank file', '\n  \n', /empty/],
    ['a heading with no bullet', '### Added\n\n### Fixed\n- ok\n', /"Added" has no bullet/],
    ['an unknown heading', '### Tweaked\n- x\n', /unknown heading "Tweaked"/],
    ['a heading at another level', '## Added\n- x\n', /use a "### " heading/],
    ['an Unreleased heading', '## [Unreleased]\n### Added\n- x\n', /no Unreleased heading/],
    ['a bullet before any heading', '- x\n### Added\n- y\n', /needs a heading above it/],
    ['text outside headings and bullets', '### Added\nSome loose text.\n- x\n', /text outside headings and bullets/],
    ['a file with text and no heading', 'just words\n', /text outside headings and bullets/],
    ['an empty bullet', '### Added\n- \n', /bullet is empty/],
  ])('rejects %s', (_label, text, message) => {
    const errors = validateEntry(text, 'bad.md');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toMatch(message);
    expect(errors.every((error) => error.startsWith('bad.md'))).toBe(true);
  });

  it('rejects a file name that is not lowercase kebab-case .md', () => {
    expect(validateEntry('### Added\n- x\n', 'My Branch.md').join('\n')).toMatch(/file name/);
    expect(validateEntry('### Added\n- x\n', 'spike/foo.md').join('\n')).toMatch(/file name/);
  });

  it('checkDir skips README.md and reports a bad file by name', () => {
    entry('README.md', 'Anything goes here.\n');
    entry('good.md', '### Added\n- ok\n');
    entry('broken.md', 'nope\n');
    const { files, errors } = checkDir(dir);
    expect(files).toEqual(['broken.md', 'good.md']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^broken\.md:1:/);
  });
});

describe('fold', () => {
  it('merges several files by heading, in Keep a Changelog order, files in name order', () => {
    entry('b-branch.md', '### Fixed\n- fix b\n\n### Added\n- add b\n');
    entry('a-branch.md', '### Security\n- sec a\n\n### Added\n- add a\n  - nested a\n\n### Changed\n- change a\n');
    entry('README.md', 'ignored\n');
    const { text, files } = fold({ dir, changelogPath, version: '0.2.0', date: '2026-10-20' });
    expect(files).toEqual(['a-branch.md', 'b-branch.md']);
    const release = text.slice(text.indexOf('## [0.2.0]'), text.indexOf('## [0.1.0]'));
    expect(release).toBe(
      [
        '## [0.2.0] - 2026-10-20',
        '',
        '### Added',
        '- add a',
        '  - nested a',
        '- add b',
        '',
        '### Changed',
        '- change a',
        '',
        '### Fixed',
        '- fix b',
        '',
        '### Security',
        '- sec a',
        '',
        '',
      ].join('\n'),
    );
  });

  it('writes the file, deletes the entry files, keeps README.md, and leaves Unreleased empty', () => {
    entry('one.md', '### Added\n- thing\n');
    entry('README.md', 'keep me\n');
    fold({ dir, changelogPath, version: '0.2.0', date: '2026-10-20' });
    const text = readFileSync(changelogPath, 'utf8');
    expect(text).toContain('## [Unreleased]\n\n## [0.2.0] - 2026-10-20\n\n### Added\n- thing\n\n## [0.1.0] - 2026-10-03');
    expect(readdirSync(dir)).toEqual(['README.md']);
    expect(text).toContain('[Unreleased]: https://github.com/example/repo/compare/v0.2.0...HEAD\n[0.2.0]: https://github.com/example/repo/compare/v0.1.0...v0.2.0\n[0.1.0]:');
  });

  it('moves bullets that still sit under Unreleased into the new section, ahead of the entry bullets', () => {
    writeFileSync(changelogPath, CHANGELOG.replace('## [Unreleased]\n', '## [Unreleased]\n\n### Added\n- legacy\n'));
    entry('one.md', '### Added\n- new\n');
    const text = foldIntoChangelog(readFileSync(changelogPath, 'utf8'), [{ name: 'one.md', text: '### Added\n- new\n' }], '0.2.0', '2026-10-20');
    expect(text).toContain('## [Unreleased]\n\n## [0.2.0] - 2026-10-20\n\n### Added\n- legacy\n- new\n\n## [0.1.0]');
  });

  it('an empty folder is an error and changes nothing', () => {
    expect(() => fold({ dir, changelogPath, version: '0.2.0', date: '2026-10-20' })).toThrow(/No entry file/);
    expect(readFileSync(changelogPath, 'utf8')).toBe(CHANGELOG);
  });

  it('a bad file stops the fold before any change', () => {
    entry('good.md', '### Added\n- ok\n');
    entry('bad.md', '### Added\n');
    expect(() => fold({ dir, changelogPath, version: '0.2.0', date: '2026-10-20' })).toThrow(/bad\.md/);
    expect(readFileSync(changelogPath, 'utf8')).toBe(CHANGELOG);
    expect(readdirSync(dir).sort()).toEqual(['bad.md', 'good.md']);
  });

  it('rejects a bad version, a bad date and a version that already exists', () => {
    entry('one.md', '### Added\n- thing\n');
    expect(() => fold({ dir, changelogPath, version: 'v1', date: '2026-10-20' })).toThrow(/not a version/);
    expect(() => fold({ dir, changelogPath, version: '0.2.0', date: '20/10/2026' })).toThrow(/not a date/);
    expect(() => fold({ dir, changelogPath, version: '0.1.0', date: '2026-10-20' })).toThrow(/already has a section/);
  });

  it('a dry run returns the new text but changes nothing', () => {
    entry('one.md', '### Added\n- thing\n');
    const { text, release } = fold({ dir, changelogPath, version: '0.2.0', date: '2026-10-20', dryRun: true });
    expect(text).toContain('## [0.2.0] - 2026-10-20');
    expect(release).toContain('- thing');
    expect(readFileSync(changelogPath, 'utf8')).toBe(CHANGELOG);
    expect(readdirSync(dir)).toEqual(['one.md']);
  });
});

describe('main', () => {
  it('--check exits 0 on the real folder', () => {
    const out: string[] = [];
    expect(main(['--check'], (m) => out.push(m), (m) => out.push(m))).toBe(0);
    expect(out.join('\n')).toMatch(/all good/);
  });

  it('exits 1 with a usage line when no version is given', () => {
    const err: string[] = [];
    expect(main([], () => {}, (m) => err.push(m))).toBe(1);
    expect(err.join('\n')).toMatch(/Usage/);
  });
});
