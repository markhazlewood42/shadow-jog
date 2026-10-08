// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { CiMain, GitInfo, Health, Panel, StatusInfo } from '../src/shared/types';
import { type Source, type StatusSources, StatusSummary } from '../src/web/now/StatusPanel';

// The rows of the Status panel and the strip under them, drawn once into a document (no server and no browser). The case here is the one where only the milestone list of
// docs/engine/migration.md could not be read: the status module then sends a failed panel whose last good data holds the complete data of status.md (src/server/status/module.ts,
// `publicPanel`; the shape is pinned on the server side by "a milestone table that is missing or has lost a column ..." in tests/status.test.ts). Design 5.6 and 7: the other
// rows stay. How the panel looks in a real browser, with the real server, is the job of e2e/now.spec.ts.

const NOW = Date.parse('2026-10-08T12:00:00.000Z');
const T0 = '2026-10-08T11:00:00.000Z';
const reload = () => undefined;

const gitInfo: GitInfo = {
  current: 'main',
  ahead: 0,
  behind: 0,
  branches: [{ name: 'main', date: T0, upstream: 'origin/main', track: null, worktree: null }],
  commits: [{ sha: 'a1b2c3d4e5f6', subject: 'A made-up subject', date: T0, author: 'Fixture Author' }],
};
const ciInfo: CiMain = { state: 'passing', createdAt: T0, url: 'https://github.com/o/r/actions/runs/1' };
const healthInfo: Health = { ok: true, name: 'Shadow Jog Command Center', version: '0.0.0', startedAt: T0, gameUrl: 'http://localhost:3007', githubRepo: 'o/r', links: [] };

const item = (text: string) => ({ text, html: `<p>${text}</p>` });
/** The data of status.md as the module reads it: three items for Mark, a date, and (when the table of milestones could not be read) no milestones. */
const statusInfo = (over: Partial<StatusInfo> = {}): StatusInfo => ({
  updated: '2026-10-05',
  nextUpForMark: [item('One'), item('Two'), item('Three')],
  milestone: { current: null, problem: 'unknown' },
  milestones: [],
  ...over,
});

const good = <T,>(data: T): Panel<T> => ({ ok: true, data, updatedAt: T0 });
const source = <T,>(panel: Panel<T>): Source<T> => ({ panel, reload });

/** What the status module sends when only the milestone table is the problem: the error of the table, and the complete status as `lastGood`. */
const milestoneProblem = (code: 'milestones-table-missing' | 'milestones-doc-missing'): Panel<StatusInfo> => ({
  ok: false,
  error: { code, message: 'The milestone list in docs/engine/migration.md cannot be read.' },
  updatedAt: T0,
  lastGood: { data: statusInfo(), updatedAt: T0 },
});

function draw(status: Panel<StatusInfo>, over: Partial<StatusSources> = {}): HTMLElement {
  const sources: StatusSources = { status: source(status), git: source(good(gitInfo)), ci: source(good(ciInfo)), health: source(good(healthInfo)), ...over };
  const markup = renderToStaticMarkup(
    <MemoryRouter>
      <StatusSummary sources={sources} now={NOW} />
    </MemoryRouter>,
  );
  return new DOMParser().parseFromString(markup, 'text/html').body;
}

const textOf = (element: Element | null | undefined): string => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
/** The value (dd) of the row with this label (dt). */
const rowValue = (host: HTMLElement, label: string): Element | null => {
  const term = [...host.querySelectorAll('dt')].find((candidate) => textOf(candidate) === label);
  return term?.nextElementSibling ?? null;
};
/** The strip of the milestones: the block under the rows, found by its label. */
const strip = (host: HTMLElement): Element | null => [...host.querySelectorAll('span')].find((label) => textOf(label) === 'Milestone')?.parentElement ?? null;

describe('the Status rows when only the milestone list failed', () => {
  for (const code of ['milestones-table-missing', 'milestones-doc-missing'] as const) {
    it(`${code}: Next up and status.md show their data, and only the strip says Unavailable`, () => {
      const host = draw(milestoneProblem(code));

      // The two rows that status.md feeds are drawn from the data that rides along in `lastGood`.
      expect(textOf(rowValue(host, 'Next up'))).toBe('3 for you');
      expect(rowValue(host, 'Next up')?.querySelector('a')?.getAttribute('href')).toBe('/docs/status');
      expect(textOf(rowValue(host, 'status.md'))).toBe('updated Oct 5');
      expect(textOf(rowValue(host, 'Next up'))).not.toContain('Unavailable');
      expect(textOf(rowValue(host, 'status.md'))).not.toContain('Unavailable');

      // The strip has no milestone list to draw, so it says so, with the code and a Retry button.
      expect(textOf(strip(host))).toContain('Unavailable');
      expect(textOf(strip(host))).toContain(code);
      expect(strip(host)?.querySelector('button[aria-label="Retry Milestone"]')).not.toBeNull();

      // The rows of the other sources are as they are when all is good, and the panel has just one Unavailable.
      expect(textOf(rowValue(host, 'Branch'))).toContain('main');
      expect(textOf(rowValue(host, 'CI on main'))).toContain('passing');
      expect(textOf(rowValue(host, 'Last commit'))).toContain('ago');
      expect(textOf(host).match(/Unavailable/g)).toHaveLength(1);
    });
  }

  it('a failure of status.md itself keeps all three rows Unavailable, also when old data rides along', () => {
    // The code is not one of the milestones: the data under it comes from an older load and may be out of date, so no row shows it.
    const host = draw({ ok: false, error: { code: 'status-section-missing', message: 'status.md has no current section.' }, updatedAt: T0, lastGood: { data: statusInfo({ nextUpForMark: [item('Old')] }), updatedAt: T0 } });
    expect(textOf(rowValue(host, 'Next up'))).toContain('Unavailable');
    expect(textOf(rowValue(host, 'status.md'))).toContain('Unavailable');
    expect(textOf(strip(host))).toContain('Unavailable');
    expect(textOf(host)).not.toContain('1 for you');
  });

  it('a milestone failure with no data riding along keeps all three rows Unavailable', () => {
    const host = draw({ ok: false, error: { code: 'milestones-table-missing', message: 'The milestone list cannot be read.' }, updatedAt: T0, lastGood: null });
    expect(textOf(rowValue(host, 'Next up'))).toContain('Unavailable');
    expect(textOf(rowValue(host, 'status.md'))).toContain('Unavailable');
    expect(textOf(strip(host))).toContain('Unavailable');
  });

  it('a failed git source still blanks Branch and Last commit, while Next up and status.md keep their data', () => {
    const git: Panel<GitInfo> = { ok: false, error: { code: 'git-failed', message: 'git could not run.' }, updatedAt: null, lastGood: null };
    const host = draw(milestoneProblem('milestones-table-missing'), { git: source(git) });
    expect(textOf(rowValue(host, 'Branch'))).toContain('Unavailable');
    expect(textOf(rowValue(host, 'Last commit'))).toContain('Unavailable');
    expect(textOf(rowValue(host, 'Next up'))).toBe('3 for you');
    expect(textOf(rowValue(host, 'status.md'))).toBe('updated Oct 5');
  });
});
