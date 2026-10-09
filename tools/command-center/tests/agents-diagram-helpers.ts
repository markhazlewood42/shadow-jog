// Shared made-up data for the tests of the Agents diagram (layout, boxes, text list). This file has no tests of its own. Everything here is synthetic: the titles,
// labels and paths are invented, and no real session text is in it.
import type { AgentsLive, LiveNode, LiveSession } from '../src/shared/types';

/** The moment the tests call "now". The run times in the boxes are counted from here, so they are exact. */
export const NOW = Date.parse('2026-10-08T12:00:00.000Z');
export const SEC = 1000;
export const MIN = 60_000;
export const ago = (ms: number): string => new Date(NOW - ms).toISOString();

/** An agent that runs, started 5 minutes ago, with a session as its parent (`s1`). The fields of `extra` replace the ones given here. */
export function liveNode(id: string, extra: Partial<LiveNode> = {}): LiveNode {
  return {
    id,
    parentId: 's1',
    kind: 'agent',
    label: `Label of ${id}`,
    model: 'sonnet',
    state: 'running',
    startedAt: ago(5 * MIN),
    endedAt: null,
    filePath: `/fixture/${id}.jsonl`,
    messages: { count: 0, approximate: false },
    ...extra,
  };
}

/** A workflow run: no model, no messages, and a progress chip. */
export function liveWorkflow(id: string, extra: Partial<LiveNode> = {}): LiveNode {
  return liveNode(id, {
    kind: 'workflow',
    model: null,
    label: `Workflow ${id}`,
    progress: { phase: 'Build', done: 2, started: 3 },
    ...extra,
  });
}

/** A session that works, started 30 minutes ago, with no node. */
export function liveSession(id: string, extra: Partial<LiveSession> = {}): LiveSession {
  return { id, title: `Title of ${id}`, state: 'working', startedAt: ago(30 * MIN), filePath: `/fixture/${id}.jsonl`, nodes: [], ...extra };
}

export const live = (sessions: LiveSession[], extra: Partial<AgentsLive> = {}): AgentsLive => ({ sessions, hiddenScripts: 0, source: 'process-list', ...extra });

/** `count` agents with the ids `k1`, `k2` ... whose parent is `parentId`. */
export const kids = (count: number, parentId = 's1', prefix = 'k'): LiveNode[] => Array.from({ length: count }, (_, i) => liveNode(`${prefix}${i + 1}`, { parentId }));
