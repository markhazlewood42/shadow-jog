import { describe, expect, it } from 'vitest';
import type { AgentInfo, GitInfo, Panel, SessionInfo, SessionsInfo, StatusInfo, WorkflowInfo } from '../src/shared/types';
import { FINISHED_KEPT_MS, runningRows } from '../src/web/now/RunningPanel';
import { combinePanels } from '../src/web/now/StatusPanel';
import type { PanelResult } from '../src/web/usePanel';

// The logic that decides what the Running panel lists, and how the Status panel puts the results of its two sources together. Both are plain functions of
// data, so these tests need no browser. (How the panels look and behave is the job of e2e/now.spec.ts.)

const NOW = Date.parse('2026-10-06T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

function agent(id: string, extra: Partial<AgentInfo> = {}): AgentInfo {
  return { id, sessionId: 's1', description: `Description of ${id}`, agentType: 'general-purpose', model: '', state: 'running', startedAt: ago(5 * MIN), endedAt: null, workflowId: null, ...extra };
}

function workflow(id: string, extra: Partial<WorkflowInfo> = {}): WorkflowInfo {
  return {
    id,
    name: `Workflow ${id}`,
    sessionId: 's1',
    state: 'running',
    phases: [
      { name: 'Research', started: 2, done: 2 },
      { name: 'Build', started: 1, done: 0 },
    ],
    started: 3,
    done: 2,
    startedAt: ago(8 * MIN),
    lastEventAt: ago(MIN),
    ...extra,
  };
}

function session(id: string, extra: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    title: `Title of ${id}`,
    folder: 'fixture-shadow-jog',
    matchedBy: 'folder',
    cwd: '/fixture/repo',
    entrypoint: 'claude-desktop',
    branch: 'fixture-branch',
    startedAt: ago(30 * MIN),
    lastActivityAt: ago(MIN),
    state: 'working',
    prs: [],
    yourMove: null,
    agents: [],
    workflows: [],
    ...extra,
  };
}

const info = (sessions: SessionInfo[]): SessionsInfo => ({ sessions, scanned: sessions.length, skipped: 0, hiddenSdk: 0 });

describe('runningRows', () => {
  it('lists each live session with its running agents and workflows, then what finished a few minutes ago, and nothing else', () => {
    const rows = runningRows(
      info([
        session('s1', {
          agents: [
            agent('a-running'),
            agent('a-done-now', { state: 'done', endedAt: ago(3 * MIN) }),
            agent('a-done-old', { state: 'done', endedAt: ago(FINISHED_KEPT_MS + MIN) }), // finished too long ago
            agent('a-stopped', { state: 'stopped' }), // stuck: it neither runs nor finished
            agent('a-of-a-workflow', { workflowId: 'wf_1' }), // the workflow's row stands for it
          ],
          workflows: [workflow('wf_running'), workflow('wf_done', { state: 'done', lastEventAt: ago(2 * MIN) }), workflow('wf_old', { state: 'done', lastEventAt: ago(FINISHED_KEPT_MS + MIN) }), workflow('wf_stopped', { state: 'stopped' })],
        }),
      ]),
      NOW,
    );
    // The session first. Under it what still runs (agents, then workflows), then what just ended.
    expect(rows.map((row) => [row.kind, row.name, row.state, row.nested === true])).toEqual([
      ['session', 'Title of s1', 'working', false],
      ['agent', 'Description of a-running', 'running', true],
      ['workflow', 'Workflow wf_running', 'running', true],
      ['agent', 'Description of a-done-now', 'done', true],
      ['workflow', 'Workflow wf_done', 'done', true],
    ]);
  });

  it('gives a running agent a bar with no value and a finished one a full bar, and a workflow the agents done of the agents started', () => {
    const rows = runningRows(info([session('s1', { agents: [agent('a-run'), agent('a-end', { state: 'done', endedAt: ago(MIN) })], workflows: [workflow('wf_run'), workflow('wf_end', { state: 'done', lastEventAt: ago(MIN) }), workflow('wf_new', { started: 0, done: 0, phases: [] })] })]), NOW);
    const bar = (name: string) => rows.find((row) => row.name === name)?.progress;
    expect(bar('Description of a-run')).toBeNull(); // null: a bar that moves, because agents report no percent done
    expect(bar('Description of a-end')).toBe(1);
    expect(bar('Workflow wf_run')).toBeCloseTo(2 / 3);
    expect(bar('Workflow wf_end')).toBe(1);
    expect(bar('Workflow wf_new')).toBeNull(); // nothing started yet, so nothing to measure
    // The phases say where the workflow is, in the order the journal names them.
    expect(rows.find((row) => row.name === 'Workflow wf_run')?.detail).toBe('2 of 3 agents done. Phases: Research 2/2, Build 0/1');
    expect(rows.find((row) => row.name === 'Workflow wf_new')?.detail).toBe('0 of 0 agents done');
  });

  it('shows a session that waits for Mark with an empty bar, and leaves out a session that is idle or that cannot be read', () => {
    const rows = runningRows(info([session('s-working'), session('s-waiting', { state: 'waiting' }), session('s-idle', { state: 'idle' }), session('s-unknown', { state: 'unknown' })]), NOW);
    expect(rows.map((row) => [row.name, row.state, row.progress])).toEqual([
      ['Title of s-working', 'working', null],
      ['Title of s-waiting', 'waiting for you', 0],
    ]);
    // How long the session has run is how long ago it started.
    expect(rows[0]?.runMs).toBe(30 * MIN);
  });

  it('names an agent by what it was asked, else by its kind, else by its id, and times it from its start to its end (or to now while it runs)', () => {
    const rows = runningRows(
      info([session('s1', { agents: [agent('a1', { description: '' }), agent('a2', { description: '', agentType: '' }), agent('a3', { state: 'done', startedAt: ago(10 * MIN), endedAt: ago(4 * MIN) })] })]),
      NOW,
    );
    expect(rows.map((row) => row.name)).toEqual(['Title of s1', 'general-purpose', 'Agent a2', 'Description of a3']);
    expect(rows[1]?.runMs).toBe(5 * MIN); // running: from its start to now
    const finished = rows.find((row) => row.name === 'Description of a3');
    expect(finished?.runMs).toBe(6 * MIN); // finished: from its start to its end
  });

  it('has no rows for no sessions', () => {
    expect(runningRows(info([]), NOW)).toEqual([]);
  });
});

// ---- the Status panel puts two results into one ----

const T0 = '2026-10-06T10:00:00.000Z';
const T1 = '2026-10-06T10:05:00.000Z';

const statusInfo: StatusInfo = { updated: null, rightNow: { heading: 'Right now', html: '<p>x</p>' }, nextUpForMark: [], milestones: [] };
const gitInfo: GitInfo = { current: 'main', ahead: 0, behind: 0, branches: [], commits: [] };
const reload = () => undefined;

function result<T>(panel: Panel<T> | null): PanelResult<T> {
  return { state: panel === null ? 'loading' : panel.ok ? 'ready' : 'error', panel, reload };
}
const good = <T>(data: T, updatedAt: string): Panel<T> => ({ ok: true, data, updatedAt });
const failed = <T>(code: string, message: string, lastGood: { data: T; updatedAt: string } | null): Panel<T> => ({ ok: false, error: { code, message }, updatedAt: lastGood?.updatedAt ?? null, lastGood });

describe('combinePanels', () => {
  it('is loading until both sources have answered', () => {
    expect(combinePanels(result(null), result(null)).state).toBe('loading');
    expect(combinePanels(result(good(statusInfo, T0)), result(null))).toMatchObject({ state: 'loading', panel: null });
    expect(combinePanels(result(null), result(good(gitInfo, T0)))).toMatchObject({ state: 'loading', panel: null });
  });

  it('is good when both are good, with the older of the two times (the data is as old as its oldest part)', () => {
    expect(combinePanels(result(good(statusInfo, T1)), result(good(gitInfo, T0))).panel).toEqual({ ok: true, data: { status: statusInfo, git: gitInfo }, updatedAt: T0 });
  });

  it('is failed when one source failed, says what it said, and still carries the data of both (the last good data of the failed one)', () => {
    // The status module reports a missing milestone table as a failure that still holds the status: the panel shows the error and the status together.
    const combined = combinePanels(result(failed('milestones-doc-missing', 'The migration doc was not found.', { data: statusInfo, updatedAt: T0 })), result(good(gitInfo, T1)));
    expect(combined.state).toBe('error');
    expect(combined.panel).toEqual({
      ok: false,
      error: { code: 'milestones-doc-missing', message: 'The migration doc was not found.' },
      updatedAt: T0,
      lastGood: { data: { status: statusInfo, git: gitInfo }, updatedAt: T0 },
    });
  });

  it('names both failures when both failed, and has no last good data when neither source ever loaded', () => {
    const combined = combinePanels(result(failed<StatusInfo>('status-missing', 'status.md was not found.', null)), result(failed<GitInfo>('git-failed', 'git could not run.', null)));
    expect(combined.panel).toEqual({ ok: false, error: { code: 'status-missing, git-failed', message: 'status.md was not found. git could not run.' }, updatedAt: null, lastGood: null });
    // One failed source with nothing of its own, next to a good one: the good part is carried, and the other is null.
    const half = combinePanels(result(good(statusInfo, T1)), result(failed<GitInfo>('git-failed', 'git could not run.', null)));
    expect(half.panel).toMatchObject({ ok: false, error: { code: 'git-failed' }, lastGood: { data: { status: statusInfo, git: null }, updatedAt: T1 } });
  });

  it('asks both sources again when it is asked to reload', () => {
    let reloads = 0;
    const count = { state: 'ready' as const, panel: good(statusInfo, T0), reload: () => void (reloads += 1) };
    const other = { state: 'ready' as const, panel: good(gitInfo, T0), reload: () => void (reloads += 10) };
    combinePanels(count, other).reload();
    expect(reloads).toBe(11);
  });
});
