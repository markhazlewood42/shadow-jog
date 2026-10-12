import { describe, expect, it } from 'vitest';
import {
  BRANCH_NAME_PATTERN,
  type PrMerge,
  branchCheck,
  branchFromWorkstreamPath,
  isValidBranchName,
  parseWorkstream,
  staleWorkstreamPaths,
  workstreamPathFor,
} from '../src/shared/workstream';

// The workstream file contract (design.md section 5.9). Every verdict here is also what the
// Vercel functions and the page will show, because they all call the same validator.

/** A file with every field right. Tests change one field at a time. A null value leaves the key out. */
function file(overrides: Record<string, string | null> = {}, body = 'Notes.\n'): string {
  const fields: Record<string, string | null> = {
    type: 'workstream',
    title: 'M6 flip default',
    branch: 'engine-m6-flip',
    roadmap: 'M6',
    state: 'review',
    next_for_mark: '\n  - Rename the required checks\n  - Merge the PR',
    blocked_on: '[61]',
    updated: '2026-10-11',
    ...overrides,
  };
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `${key}:${value?.startsWith('\n') ? '' : ' '}${value}`);
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

const PATH = 'docs/workstreams/engine-m6-flip.md';

/** The errors of a file that must fail. A file that passes makes the test fail. */
function errorsOf(src: string, path = PATH): string[] {
  const result = parseWorkstream(path, src);
  if (result.ok) throw new Error('the file passed, but the test expected it to fail');
  return result.errors;
}

describe('parseWorkstream: a valid file', () => {
  it('returns every field', () => {
    expect(parseWorkstream(PATH, file())).toEqual({
      ok: true,
      path: PATH,
      workstream: {
        type: 'workstream',
        title: 'M6 flip default',
        branch: 'engine-m6-flip',
        roadmap: 'M6',
        state: 'review',
        next_for_mark: ['Rename the required checks', 'Merge the PR'],
        blocked_on: [61],
        updated: '2026-10-11',
      },
    });
  });

  it('reads the example of the design, with a comment after a value', () => {
    const src = `---
type: workstream
title: M6 flip default
branch: engine-m6-flip
roadmap: m6            # id in roadmap.json
state: review          # active | review | blocked | parked | merged
next_for_mark:
  - Rename the required checks in the main ruleset to e2e (1/4) to e2e (4/4)
blocked_on: [61]       # decision issue numbers
updated: 2026-10-11
---
`;
    expect(parseWorkstream(PATH, src).ok).toBe(true);
  });

  it('accepts all five states', () => {
    for (const state of ['active', 'review', 'blocked', 'parked', 'merged']) {
      expect(parseWorkstream(PATH, file({ state })).ok).toBe(true);
    }
  });

  it('lets next_for_mark and blocked_on be left out, empty or written with nothing after the key', () => {
    for (const overrides of [
      { next_for_mark: null, blocked_on: null },
      { next_for_mark: '[]', blocked_on: '[]' },
      { next_for_mark: '', blocked_on: '' },
    ]) {
      const result = parseWorkstream(PATH, file(overrides));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.workstream.next_for_mark).toEqual([]);
        expect(result.workstream.blocked_on).toEqual([]);
      }
    }
  });

  it('reads a CRLF file and a file that starts with a byte order mark', () => {
    expect(parseWorkstream(PATH, file().replace(/\n/g, '\r\n')).ok).toBe(true);
    expect(parseWorkstream(PATH, `﻿${file()}`).ok).toBe(true);
  });

  it('accepts a branch with a slash, with the file in a folder', () => {
    expect(parseWorkstream('docs/workstreams/spike/foo.md', file({ branch: 'spike/foo' })).ok).toBe(true);
  });

  it('accepts a Windows path', () => {
    expect(parseWorkstream('docs\\workstreams\\engine-m6-flip.md', file()).ok).toBe(true);
  });
});

describe('parseWorkstream: each invalid field', () => {
  it('rejects a file with no frontmatter, or with an unclosed block', () => {
    expect(errorsOf('# Just a doc\n')[0]).toMatch(/no frontmatter/);
    expect(errorsOf('---\ntype: workstream\n')[0]).toMatch(/no frontmatter/);
  });

  it('rejects frontmatter that is not YAML, or not a map', () => {
    expect(errorsOf('---\ntype: [oops\n---\n')[0]).toMatch(/not valid YAML/);
    expect(errorsOf('---\n- a\n- b\n---\n')[0]).toMatch(/key: value/);
    expect(errorsOf('---\n---\n')[0]).toMatch(/key: value/);
  });

  it('rejects a wrong or missing type', () => {
    expect(errorsOf(file({ type: 'doc' }))).toEqual(['type must be "workstream", not "doc"']);
    expect(errorsOf(file({ type: null }))).toEqual(['type must be "workstream", not undefined']);
  });

  it('rejects a missing, empty or non-text title and roadmap', () => {
    expect(errorsOf(file({ title: null }))[0]).toMatch(/^title must be a non-empty text/);
    expect(errorsOf(file({ title: '""' }))[0]).toMatch(/^title must be a non-empty text/);
    expect(errorsOf(file({ roadmap: null }))[0]).toMatch(/^roadmap must be a non-empty text/);
    expect(errorsOf(file({ roadmap: '42' }))).toEqual(['roadmap must be a non-empty text, not 42']);
    expect(errorsOf(file({ roadmap: '[a, b]' }))[0]).toMatch(/^roadmap must be a non-empty text, not a list/);
  });

  it('rejects a state that is not in the list', () => {
    expect(errorsOf(file({ state: 'done' }))).toEqual([
      'state must be one of active, review, blocked, parked, merged, not "done"',
    ]);
    expect(errorsOf(file({ state: 'Review' }))[0]).toMatch(/^state must be one of/);
    expect(errorsOf(file({ state: null }))[0]).toMatch(/not undefined/);
  });

  it('rejects next_for_mark that is not a list of texts', () => {
    expect(errorsOf(file({ next_for_mark: 'Merge the PR' }))[0]).toMatch(/^next_for_mark must be a list/);
    expect(errorsOf(file({ next_for_mark: '[1, 2]' }))[0]).toMatch(/^next_for_mark must be a list/);
    expect(errorsOf(file({ next_for_mark: '\n  - ok\n  - ""' }))[0]).toMatch(/^next_for_mark must be a list/);
  });

  it('rejects blocked_on that is not a list of whole numbers', () => {
    for (const blocked_on of ['61', '[a]', '[61.5]', '["61"]', '[0]', '[-3]']) {
      expect(errorsOf(file({ blocked_on }))[0]).toMatch(/^blocked_on must be a list of issue numbers/);
    }
  });

  it('rejects an updated that is not a real YYYY-MM-DD date', () => {
    for (const updated of ['2026-13-01', '2026-02-30', '2026-1-5', '11 Oct 2026', '2026-10-11T10:00:00Z', '20261011']) {
      expect(errorsOf(file({ updated }))[0]).toMatch(/^updated must be a date written YYYY-MM-DD/);
    }
    expect(errorsOf(file({ updated: null }))[0]).toMatch(/not undefined/);
    expect(parseWorkstream(PATH, file({ updated: '2028-02-29' })).ok).toBe(true);
    expect(errorsOf(file({ updated: '2027-02-29' }))[0]).toMatch(/^updated must be a date/);
  });

  it('rejects an unknown field, which is most likely a typo', () => {
    expect(errorsOf(file({ next_for_me: '[]' }))).toEqual([
      'unknown field "next_for_me" (allowed: type, title, branch, roadmap, state, next_for_mark, blocked_on, updated)',
    ]);
  });

  it('reports every problem at once, and builds the text of the red row from the path and the errors', () => {
    const result = parseWorkstream(PATH, file({ state: 'done', updated: 'soon' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(2);
      expect(result.message).toBe(`${PATH}: ${result.errors.join('; ')}`);
      expect(result.message.startsWith('docs/workstreams/engine-m6-flip.md: state must be')).toBe(true);
    }
  });
});

describe('parseWorkstream: the branch and the path', () => {
  it('rejects a branch that does not match the path', () => {
    expect(errorsOf(file({ branch: 'other-branch' }))).toEqual([
      'branch "other-branch" does not match the file path, which names the branch "engine-m6-flip"',
    ]);
  });

  it('rejects a slash branch written in a flat file, and the reverse', () => {
    expect(errorsOf(file({ branch: 'spike/foo' }), 'docs/workstreams/spike-foo.md')[0]).toMatch(/does not match/);
    expect(errorsOf(file({ branch: 'spike-foo' }), 'docs/workstreams/spike/foo.md')[0]).toMatch(/does not match/);
  });

  it('rejects a path outside docs/workstreams, a path without .md, and an empty name', () => {
    for (const path of ['docs/other/engine-m6-flip.md', 'docs/workstreams/engine-m6-flip.txt', 'docs/workstreams/.md']) {
      expect(errorsOf(file(), path)).toEqual(['path must be docs/workstreams/<branch>.md']);
    }
  });

  it('rejects a file path whose branch name is outside the rule, before it reads the file', () => {
    for (const path of [
      'docs/workstreams/Engine-M6.md',
      'docs/workstreams/engine.m6.md',
      'docs/workstreams/engine-m6.md.md',
      'docs/workstreams/a//b.md',
      'docs/workstreams/-a.md',
      'docs/workstreams/a--b.md',
    ]) {
      expect(errorsOf('not even frontmatter', path)[0]).toMatch(/^branch name ".*" must be lowercase/);
    }
  });

  it('rejects a branch field outside the rule even when the path agrees', () => {
    const errors = errorsOf(file({ branch: 'Engine-M6-Flip' }));
    expect(errors[0]).toMatch(/^branch name "Engine-M6-Flip" must be lowercase/);
  });
});

describe('the branch-name rule', () => {
  it.each(['main', 'engine-m6-flip', 'spike/foo', 'a/b/c', 'v2', '1', 'cc-live-design', 'a-1/b-2'])(
    'accepts %s',
    (name) => {
      expect(isValidBranchName(name)).toBe(true);
      expect(BRANCH_NAME_PATTERN.test(name)).toBe(true);
    },
  );

  it.each([
    ['uppercase', 'Engine-M6'],
    ['uppercase in a later part', 'spike/Foo'],
    ['a dot', 'release-1.0'],
    ['a .md suffix', 'notes.md'],
    ['an underscore', 'a_b'],
    ['a leading slash', '/a'],
    ['a trailing slash', 'a/'],
    ['an empty part', 'a//b'],
    ['a leading dash', '-a'],
    ['a trailing dash', 'a-'],
    ['a double dash', 'a--b'],
    ['a dash next to a slash', 'a-/b'],
    ['a space', 'a b'],
    ['the empty name', ''],
    ['a dependabot branch', 'dependabot/npm_and_yarn/vite-7.0.1'],
  ])('rejects %s', (_label, name) => {
    expect(isValidBranchName(name)).toBe(false);
  });
});

describe('branchCheck', () => {
  it('asks for the file lookup of a branch inside the rule', () => {
    expect(branchCheck('engine-m6-flip', true)).toEqual({ kind: 'valid' });
    expect(branchCheck('engine-m6-flip', false)).toEqual({ kind: 'valid' });
  });

  it('skips a bot branch that has no file: a neutral row, never a red one', () => {
    expect(branchCheck('dependabot/npm_and_yarn/vite-7.0.1', false)).toEqual({ kind: 'skipped' });
    expect(branchCheck('release-1.0', false)).toEqual({ kind: 'skipped' });
  });

  it('gives a red row, with the reason and no lookup, to a branch outside the rule that has a file', () => {
    const check = branchCheck('Release-1.0', true);
    expect(check.kind).toBe('invalid');
    if (check.kind === 'invalid') {
      expect(check.message).toMatch(/^docs\/workstreams\/Release-1\.0\.md: branch name "Release-1\.0" must be lowercase/);
    }
  });
});

describe('paths and branches', () => {
  it('maps a branch to its path and back, with slashes as folders', () => {
    expect(workstreamPathFor('spike/foo')).toBe('docs/workstreams/spike/foo.md');
    expect(branchFromWorkstreamPath('docs/workstreams/spike/foo.md')).toBe('spike/foo');
    expect(branchFromWorkstreamPath('docs/workstreams/engine-m6-flip.md')).toBe('engine-m6-flip');
  });

  it('gives null for a path that is not a workstream file', () => {
    expect(branchFromWorkstreamPath('docs/workstreams/README.txt')).toBeNull();
    expect(branchFromWorkstreamPath('docs/GDD.md')).toBeNull();
    expect(branchFromWorkstreamPath('docs/workstreams/.md')).toBeNull();
  });
});

describe('staleWorkstreamPaths', () => {
  const now = '2026-10-30T12:00:00Z';
  const pr = (headRefName: string, mergedAt: string | null): PrMerge => ({ headRefName, mergedAt });
  const paths = [
    'docs/workstreams/old.md',
    'docs/workstreams/recent.md',
    'docs/workstreams/spike/old-slash.md',
    'docs/workstreams/open.md',
    'docs/workstreams/no-pr.md',
  ];

  it('lists the files whose PR merged more than 14 days ago, sorted', () => {
    const prs = [
      pr('old', '2026-10-10T00:00:00Z'),
      pr('recent', '2026-10-25T00:00:00Z'),
      pr('spike/old-slash', '2026-10-01T00:00:00Z'),
      pr('open', null),
    ];
    expect(staleWorkstreamPaths(paths, prs, now)).toEqual([
      'docs/workstreams/old.md',
      'docs/workstreams/spike/old-slash.md',
    ]);
  });

  it('counts the 14 days from mergedAt: exactly 14 days is not stale, a second more is', () => {
    const path = ['docs/workstreams/edge.md'];
    expect(staleWorkstreamPaths(path, [pr('edge', '2026-10-16T12:00:00Z')], now)).toEqual([]);
    expect(staleWorkstreamPaths(path, [pr('edge', '2026-10-16T11:59:59Z')], now)).toEqual(path);
  });

  it('keeps the file of a branch with a PR that is not merged, even when an older PR of the same name merged', () => {
    const prs = [pr('old', '2026-09-01T00:00:00Z'), pr('old', null)];
    expect(staleWorkstreamPaths(['docs/workstreams/old.md'], prs, now)).toEqual([]);
  });

  it('uses the newest merge when a name was reused and merged twice', () => {
    const prs = [pr('old', '2026-09-01T00:00:00Z'), pr('old', '2026-10-28T00:00:00Z')];
    expect(staleWorkstreamPaths(['docs/workstreams/old.md'], prs, now)).toEqual([]);
  });

  it('never lists a file with no PR, a path that is not a workstream file, or an unreadable mergedAt', () => {
    const prs = [pr('weird', 'not a date')];
    const list = ['docs/workstreams/no-pr.md', 'docs/GDD.md', 'docs/workstreams/weird.md'];
    expect(staleWorkstreamPaths(list, prs, now)).toEqual([]);
  });

  it('takes the time as a Date, a number or text, and the number of days', () => {
    const prs = [pr('old', '2026-10-10T00:00:00Z')];
    const path = ['docs/workstreams/old.md'];
    expect(staleWorkstreamPaths(path, prs, new Date(now))).toEqual(path);
    expect(staleWorkstreamPaths(path, prs, Date.parse(now))).toEqual(path);
    expect(staleWorkstreamPaths(path, prs, now, 30)).toEqual([]);
  });
});
