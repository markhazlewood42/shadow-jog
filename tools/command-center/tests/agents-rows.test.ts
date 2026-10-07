import { describe, expect, it } from 'vitest';
import type { AgentInfo, SessionInfo, WorkflowInfo } from '../src/shared/types';
import { CLAUDE_PROJECTS, agentFilesPath, agentRow, journalPath, runningFirst, sessionFilePath, sessionRunMs, workflowRow } from '../src/web/agents/SessionCard';

// The logic of the Agents page that decides what a row says: how long a session ran, how far an agent or a workflow is, and where the files are. All of it is a plain function of
// data, so these tests need no browser, and they can fix the clock, which a browser test cannot. (How the page looks and behaves is the job of e2e/agents.spec.ts.)

const NOW = Date.parse('2026-10-06T12:00:00.000Z');
const MIN = 60_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function agent(id: string, extra: Partial<AgentInfo> = {}): AgentInfo {
  return { id, sessionId: 's1', description: `Description of ${id}`, agentType: 'general-purpose', model: 'sonnet', state: 'done', startedAt: ago(20 * MIN), endedAt: ago(14 * MIN), workflowId: null, ...extra };
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
    lastEventAt: ago(2 * MIN),
    ...extra,
  };
}

function session(extra: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'e2e00000-0000-4000-8000-000000000001',
    title: 'Title',
    folder: 'fixture-shadow-jog',
    matchedBy: 'folder',
    cwd: '/fixture/repo',
    entrypoint: 'claude-desktop',
    branch: 'fixture-branch',
    startedAt: ago(90 * MIN),
    lastActivityAt: ago(30 * MIN),
    state: 'idle',
    prs: [],
    yourMove: null,
    agents: [],
    workflows: [],
    ...extra,
  };
}

describe('sessionRunMs', () => {
  it('a live session has run until now, and one that is over ran until its last write, however long ago that was', () => {
    // 90 minutes ago the session began, and its last write was 30 minutes ago.
    expect(sessionRunMs(session({ state: 'working' }), NOW)).toBe(90 * MIN);
    expect(sessionRunMs(session({ state: 'waiting' }), NOW)).toBe(90 * MIN);
    expect(sessionRunMs(session({ state: 'idle' }), NOW)).toBe(60 * MIN);
    expect(sessionRunMs(session({ state: 'unknown' }), NOW)).toBe(60 * MIN);
    // Later, the length of a session that is over has not moved.
    expect(sessionRunMs(session({ state: 'idle' }), NOW + 5 * 60 * MIN)).toBe(60 * MIN);
    expect(sessionRunMs(session({ state: 'working' }), NOW + 5 * 60 * MIN)).toBe(90 * MIN + 5 * 60 * MIN);
  });

  it('a time that is not a time gives no length, not a guess', () => {
    expect(sessionRunMs(session({ state: 'working', startedAt: 'not a time' }), NOW)).toBeNull();
    expect(sessionRunMs(session({ state: 'idle', lastActivityAt: '' }), NOW)).toBeNull();
    // A live session does not use its last write, so a bad one does not matter.
    expect(sessionRunMs(session({ state: 'working', lastActivityAt: 'not a time' }), NOW)).toBe(90 * MIN);
  });
});

describe('agentRow', () => {
  it('an agent that runs has a moving bar, one that is done has a full bar, and one that stopped has an empty bar', () => {
    const running = agentRow(agent('a1', { state: 'running', endedAt: null, startedAt: ago(4 * MIN) }), NOW);
    expect(running).toMatchObject({ kind: 'agent', state: 'running', progress: null, runMs: 4 * MIN, nested: true });
    const done = agentRow(agent('a2', { state: 'done' }), NOW);
    expect(done).toMatchObject({ state: 'done', progress: 1, runMs: 6 * MIN });
    const stopped = agentRow(agent('a3', { state: 'stopped', startedAt: ago(90 * MIN), endedAt: ago(80 * MIN) }), NOW);
    expect(stopped).toMatchObject({ state: 'stopped', progress: 0, runMs: 10 * MIN });
  });

  it('is named by what it was asked to do, else by its kind, else by its id', () => {
    expect(agentRow(agent('a1'), NOW).name).toBe('Description of a1');
    expect(agentRow(agent('a1', { description: '' }), NOW).name).toBe('general-purpose');
    expect(agentRow(agent('a1', { description: '', agentType: '' }), NOW).name).toBe('Agent a1');
  });

  it('says what kind of agent it is and which file is its own, and leaves out what it does not know', () => {
    expect(agentRow(agent('a1'), NOW).detail).toBe('general-purpose · sonnet · agent-a1.jsonl');
    expect(agentRow(agent('a1', { model: '' }), NOW).detail).toBe('general-purpose · agent-a1.jsonl');
    expect(agentRow(agent('a1', { model: '', agentType: '' }), NOW).detail).toBe('agent-a1.jsonl');
  });

  it('has no length when its start is not a time', () => {
    expect(agentRow(agent('a1', { startedAt: '' }), NOW).runMs).toBeNull();
    expect(agentRow(agent('a1', { endedAt: 'not a time' }), NOW).runMs).toBeNull();
  });
});

describe('workflowRow', () => {
  it('its bar is the agents that are done of the agents that started, and a workflow that is done is full', () => {
    expect(workflowRow(workflow('w1'), NOW).progress).toBeCloseTo(2 / 3);
    expect(workflowRow(workflow('w1', { state: 'done', started: 3, done: 3 }), NOW).progress).toBe(1);
    // A run that stopped shows how far it got, and does not look finished.
    expect(workflowRow(workflow('w1', { state: 'stopped', started: 4, done: 1 }), NOW).progress).toBe(0.25);
  });

  it('before any agent started, a run that is at work moves and any other has an empty bar', () => {
    expect(workflowRow(workflow('w1', { state: 'running', started: 0, done: 0, phases: [] }), NOW).progress).toBeNull();
    expect(workflowRow(workflow('w1', { state: 'stopped', started: 0, done: 0, phases: [] }), NOW).progress).toBe(0);
    expect(workflowRow(workflow('w1', { state: 'unknown', started: 0, done: 0, phases: [] }), NOW).progress).toBe(0);
  });

  it('says how many of its agents are done, and keeps its state word', () => {
    expect(workflowRow(workflow('w1'), NOW)).toMatchObject({ kind: 'workflow', name: 'Workflow w1', state: 'running', detail: '2 of 3 agents done', nested: true });
    expect(workflowRow(workflow('w1', { state: 'unknown', started: 0, done: 0 }), NOW)).toMatchObject({ state: 'unknown', detail: '0 of 0 agents done' });
  });

  it('a run that is at work has run until now, one that is over ran until its last event, and a journal with no file time has no length', () => {
    expect(workflowRow(workflow('w1', { state: 'running' }), NOW).runMs).toBe(8 * MIN);
    expect(workflowRow(workflow('w1', { state: 'done' }), NOW).runMs).toBe(6 * MIN);
    expect(workflowRow(workflow('w1', { state: 'stopped' }), NOW + 60 * MIN).runMs).toBe(6 * MIN);
    expect(workflowRow(workflow('w1', { startedAt: null }), NOW).runMs).toBeNull();
  });
});

describe('runningFirst', () => {
  it('puts what runs first and keeps the order of the rest', () => {
    const items = [
      { id: 'newest', state: 'done' },
      { id: 'second', state: 'done' },
      { id: 'old-but-running', state: 'running' },
      { id: 'stuck', state: 'stopped' },
      { id: 'another-running', state: 'running' },
    ];
    expect(runningFirst(items).map((item) => item.id)).toEqual(['old-but-running', 'another-running', 'newest', 'second', 'stuck']);
    // The list that came in is not changed.
    expect(items[0]?.id).toBe('newest');
  });
});

describe('the paths of the files', () => {
  it('are built from the folder and the id that the server sends, in the layout that Claude Code writes', () => {
    const one = session();
    expect(CLAUDE_PROJECTS).toBe('~/.claude/projects');
    expect(sessionFilePath(one)).toBe('~/.claude/projects/fixture-shadow-jog/e2e00000-0000-4000-8000-000000000001.jsonl');
    expect(agentFilesPath(one)).toBe('~/.claude/projects/fixture-shadow-jog/e2e00000-0000-4000-8000-000000000001/subagents');
    expect(journalPath(one, workflow('wf_00000001-aaa'))).toBe('~/.claude/projects/fixture-shadow-jog/e2e00000-0000-4000-8000-000000000001/subagents/workflows/wf_00000001-aaa/journal.jsonl');
    // A session of the home-base folder has the path of that folder: the folder is part of the session, not a setting of the page.
    expect(sessionFilePath(session({ folder: 'fixture-home-base', matchedBy: 'cwd' }))).toContain('/fixture-home-base/');
  });
});
