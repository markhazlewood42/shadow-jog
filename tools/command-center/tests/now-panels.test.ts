import { describe, expect, it } from 'vitest';
import type { CiMain, GitInfo, Health, Panel, StatusInfo } from '../src/shared/types';
import { type SourceResults, besideOf, branchHref, combineSources, commitHref, nextUpLabel, squareStates, standingOf, updatedLabel } from '../src/web/now/StatusPanel';
import type { PanelResult } from '../src/web/usePanel';

// How the Status panel puts the results of its four sources together and what its rows say. All of it is plain functions of data, so these tests need no browser.
// (How the panels look and behave is the job of e2e/now.spec.ts. The list of the Running panel is tested in running-panel.test.tsx.)

// ---- the Status panel: four sources in one panel, and what the rows say ----

const T0 = '2026-10-06T10:00:00.000Z';
const T1 = '2026-10-06T10:05:00.000Z';
const T2 = '2026-10-06T10:09:00.000Z';

const statusInfo: StatusInfo = { updated: '2026-10-05', nextUpForMark: [], milestone: { current: null, problem: null }, milestones: [] };
const gitInfo: GitInfo = { current: 'main', ahead: 0, behind: 0, branches: [], commits: [] };
const ciInfo: CiMain = { state: 'passing', createdAt: T0, url: 'https://github.com/o/r/actions/runs/1' };
const healthInfo: Health = { ok: true, name: 'Shadow Jog Command Center', version: '0.0.0', startedAt: T0, gameUrl: 'http://localhost:3007', githubRepo: 'o/r', links: [] };
const reload = () => undefined;

function result<T>(panel: Panel<T> | null, onReload = reload): PanelResult<T> {
  return { state: panel === null ? 'loading' : panel.ok ? 'ready' : 'error', panel, reload: onReload };
}
const good = <T>(data: T, updatedAt: string): Panel<T> => ({ ok: true, data, updatedAt });
const failed = <T>(code: string, message: string, lastGood: { data: T; updatedAt: string } | null = null): Panel<T> => ({ ok: false, error: { code, message }, updatedAt: lastGood?.updatedAt ?? null, lastGood });

/** The four results of a panel that has loaded, each good unless a test replaces it. */
function results(over: Partial<SourceResults> = {}): SourceResults {
  return {
    status: result(good(statusInfo, T1)),
    git: result(good(gitInfo, T2)),
    ci: result(good(ciInfo, T0)),
    health: result(good(healthInfo, T2)),
    ...over,
  };
}

describe('combineSources', () => {
  it('is loading until all four sources have answered', () => {
    expect(combineSources(results()).state).toBe('ready');
    for (const missing of ['status', 'git', 'ci', 'health'] as const) {
      expect(combineSources(results({ [missing]: result(null) })), missing).toMatchObject({ state: 'loading', panel: null });
    }
    expect(combineSources({ status: result(null), git: result(null), ci: result(null), health: result(null) }).state).toBe('loading');
  });

  it('is good when every source is good, with the oldest of the four times (the data is as old as its oldest part)', () => {
    const combined = combineSources(results());
    expect(combined.state).toBe('ready');
    expect(combined.panel).toMatchObject({ ok: true, updatedAt: T0 });
    // The data is the four panels, each with the function that asks it again.
    const data = combined.panel?.ok ? combined.panel.data : null;
    expect(data?.status.panel).toEqual(good(statusInfo, T1));
    expect(data?.ci.panel).toEqual(good(ciInfo, T0));
  });

  it('stays good when some sources failed: the failed ones are rows, and the time is the oldest of the good ones', () => {
    // A failed source does not change the time: its last good data is not shown, so it is not part of what is on offer.
    const combined = combineSources(results({ ci: result(failed('gh-not-signed-in', 'gh is not signed in.', { data: ciInfo, updatedAt: '2026-10-06T08:00:00.000Z' })), git: result(failed('git-failed', 'git could not run.')) }));
    expect(combined.state).toBe('ready');
    expect(combined.panel).toMatchObject({ ok: true, updatedAt: T1 });
    const data = combined.panel?.ok ? combined.panel.data : null;
    expect(data?.ci.panel.ok).toBe(false);
    expect(data?.git.panel.ok).toBe(false);
    expect(data?.status.panel.ok).toBe(true);
  });

  it('is failed only when no source is good: it names every failure once, and has no last good data', () => {
    const down = failed<never>('network', 'Cannot reach the command center server. Check that it runs.');
    const combined = combineSources({ status: result(down), git: result(down), ci: result(down), health: result(down) });
    expect(combined.state).toBe('error');
    // The same code and message from four sources are said once.
    expect(combined.panel).toEqual({ ok: false, error: { code: 'network', message: 'Cannot reach the command center server. Check that it runs.' }, updatedAt: null, lastGood: null });

    // Different failures are all named. The time is the newest time that a failed source still knows (a source that loaded before).
    const mixed = combineSources({
      status: result(failed('status-missing', 'status.md was not found.', { data: statusInfo, updatedAt: T0 })),
      git: result(failed('git-failed', 'git could not run.', { data: gitInfo, updatedAt: T2 })),
      ci: result(failed('gh-offline', 'GitHub cannot be reached.')),
      health: result(down),
    });
    expect(mixed.panel).toEqual({
      ok: false,
      error: { code: 'status-missing, git-failed, gh-offline, network', message: 'status.md was not found. git could not run. GitHub cannot be reached. Cannot reach the command center server. Check that it runs.' },
      updatedAt: T2,
      lastGood: null,
    });
  });

  it('asks all four sources again when it is asked to reload', () => {
    const asked: string[] = [];
    const ask = (name: string) => () => void asked.push(name);
    combineSources({
      status: result(good(statusInfo, T0), ask('status')),
      git: result(good(gitInfo, T0), ask('git')),
      ci: result(null, ask('ci')),
      health: result(good(healthInfo, T0), ask('health')),
    }).reload();
    expect(asked.sort()).toEqual(['ci', 'git', 'health', 'status']);
  });
});

/** A git panel for the rows: `main` that follows `origin/main`, or what a test says. */
function gitWith(over: Partial<GitInfo> & { upstream?: string | null; track?: string | null; name?: string } = {}): GitInfo {
  const { upstream = 'origin/main', track = null, name = 'main', ...rest } = over;
  return { current: name, ahead: 0, behind: 0, branches: [{ name, date: T0, upstream, track, worktree: null }], commits: [], ...rest };
}

describe('standingOf', () => {
  it('says ahead N, behind N, ahead N, behind M, level, or no upstream', () => {
    expect(standingOf(gitWith({ ahead: 3, behind: 0 }))).toBe('ahead 3');
    expect(standingOf(gitWith({ ahead: 0, behind: 2 }))).toBe('behind 2');
    expect(standingOf(gitWith({ ahead: 3, behind: 1 }))).toBe('ahead 3, behind 1');
    expect(standingOf(gitWith({ ahead: 0, behind: 0 }))).toBe('level');
    // A branch that follows none, and one whose upstream is gone: git has no counts for either.
    expect(standingOf(gitWith({ upstream: null, ahead: null, behind: null }))).toBe('no upstream');
    expect(standingOf(gitWith({ track: 'gone', ahead: null, behind: null }))).toBe('no upstream');
  });
});

describe('branchHref', () => {
  it('links the branch on GitHub only when it follows a branch of origin that still exists', () => {
    expect(branchHref('o/r', gitWith())).toBe('https://github.com/o/r/tree/main');
    // A name with slashes keeps them, and each part is encoded.
    expect(branchHref('o/r', gitWith({ name: 'feature/widget', upstream: 'origin/feature/widget' }))).toBe('https://github.com/o/r/tree/feature/widget');
    expect(branchHref('o/r', gitWith({ name: 'a#b', upstream: 'origin/a#b' }))).toBe('https://github.com/o/r/tree/a%23b');
    // It is the branch that is followed that is linked: the name of the origin branch, when it differs from the local one.
    expect(branchHref('o/r', gitWith({ name: 'local', upstream: 'origin/remote-name' }))).toBe('https://github.com/o/r/tree/remote-name');

    // No link: the branch follows none, follows another remote (the repo on GitHub is origin's), has lost its upstream, or no branch is checked out.
    expect(branchHref('o/r', gitWith({ upstream: null, ahead: null, behind: null }))).toBeNull();
    expect(branchHref('o/r', gitWith({ upstream: 'fork/main' }))).toBeNull();
    expect(branchHref('o/r', gitWith({ track: 'gone', ahead: null, behind: null }))).toBeNull();
    expect(branchHref('o/r', gitWith({ current: null, ahead: null, behind: null }))).toBeNull();
  });
});

describe('commitHref', () => {
  it('links a commit by its hex id and nothing else', () => {
    expect(commitHref('o/r', 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678')).toBe('https://github.com/o/r/commit/a1b2c3d4e5f60718293a4b5c6d7e8f9012345678');
    for (const sha of ['', 'main', 'abc12', '../../x', 'a1b2c3d?x=1', 'a1b2c3d/../../y']) expect(commitHref('o/r', sha), sha).toBeNull();
  });
});

describe('updatedLabel', () => {
  const now = new Date('2026-10-08T12:00:00');

  it('says updated, the month and the day, with the year only when it is not this year', () => {
    expect(updatedLabel('2026-10-07', now)).toBe('updated Oct 7');
    expect(updatedLabel('2026-01-02', now)).toBe('updated Jan 2');
    expect(updatedLabel('2026-12-31', now)).toBe('updated Dec 31');
    expect(updatedLabel('2025-10-07', now)).toBe('updated Oct 7, 2025');
    expect(updatedLabel('2027-03-01', now)).toBe('updated Mar 1, 2027');
    // A time of day after the date does not change it.
    expect(updatedLabel('2026-10-07T23:30:00Z', now)).toBe('updated Oct 7');
  });

  it('shows a date in another shape as it was written, and no date as No date', () => {
    expect(updatedLabel('yesterday', now)).toBe('updated yesterday');
    expect(updatedLabel('2026-13-01', now)).toBe('updated 2026-13-01');
    expect(updatedLabel('2026-10-45', now)).toBe('updated 2026-10-45');
    expect(updatedLabel('2026-10', now)).toBe('updated 2026-10');
    expect(updatedLabel(null, now)).toBe('No date');
  });
});

describe('nextUpLabel', () => {
  it('says N for you, and Nothing for you when N is 0', () => {
    expect(nextUpLabel(3)).toBe('3 for you');
    expect(nextUpLabel(1)).toBe('1 for you');
    expect(nextUpLabel(0)).toBe('Nothing for you');
  });
});

describe('the milestone strip', () => {
  const milestones = ['Phase 0', 'M0', 'M1', 'M1b', 'M2'].map((id) => ({ id, name: `Name of ${id}`, scope: '', anchor: null }));
  const info = (milestone: StatusInfo['milestone']) => ({ milestone, milestones });

  it('squareStates fills the squares before the current one, marks the current one, and outlines the rest', () => {
    expect(squareStates(5, 2)).toEqual(['done', 'done', 'current', 'later', 'later']);
    expect(squareStates(5, 0)).toEqual(['current', 'later', 'later', 'later', 'later']);
    expect(squareStates(5, 4)).toEqual(['done', 'done', 'done', 'done', 'current']);
    // No current milestone (none, or a problem): every square is outlined.
    expect(squareStates(5, null)).toEqual(['later', 'later', 'later', 'later', 'later']);
    expect(squareStates(0, null)).toEqual([]);
  });

  it('besideOf shows the current milestone, Not started, or the error label of the key', () => {
    expect(besideOf(info({ current: 'M1b', problem: null }))).toEqual({ kind: 'current', index: 3 });
    expect(besideOf(info({ current: null, problem: null }))).toEqual({ kind: 'not-started' });
    expect(besideOf(info({ current: null, problem: 'missing' }))).toEqual({ kind: 'error', label: 'Milestone key missing' });
    expect(besideOf(info({ current: null, problem: 'unknown' }))).toEqual({ kind: 'error', label: 'Unknown milestone' });
    // A problem wins over any value, and an id that the list does not have is as unknown as one that the server flagged.
    expect(besideOf(info({ current: 'M1', problem: 'unknown' }))).toEqual({ kind: 'error', label: 'Unknown milestone' });
    expect(besideOf(info({ current: 'M9', problem: null }))).toEqual({ kind: 'error', label: 'Unknown milestone' });
  });
});
