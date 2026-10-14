import { describe, expect, it } from 'vitest';
import { liveAnswer, liveState } from '../fixtures/hosted/world';
import type { LiveAnswer } from '../src/hosted/live';
import { agentsOf, hostedHealth, nodesOf, readLive } from '../src/web/hosted/panels';
import type { Slot } from '../src/web/hosted/store';

// The maps from the slots of the store to panel data (src/web/hosted/panels.ts).

function slotOf(answer: LiveAnswer): Slot<LiveAnswer> {
  return { data: answer, error: null, loaded: true, at: '2026-10-12T12:00:00.000Z' } as Slot<LiveAnswer>;
}

describe('readLive', () => {
  it('gives a problem, and a status that agrees with it, for a reporter state it does not know', () => {
    const answer = liveAnswer('online');
    const odd = { ...answer, reporter: { ...answer.reporter, state: 'sleeping' } } as unknown as LiveAnswer;
    const read = readLive(slotOf(odd));
    expect(read.problem).not.toBeNull();
    expect(read.status.state).not.toBe('online');
    expect(read.live).toBeNull();
  });
});

const row = (id: string, startedAt: string | null) => ({ id, title: id, branch: 'b', folder: 'f', state: 'working' as const, startedAt, agents: { running: 0, done: 0, names: [] as string[] }, yourMove: null });

describe('agentsOf', () => {
  it('keeps two sessions without a start time in the order they came (the comparator returns 0)', () => {
    const out = agentsOf(liveState({ sessions: ['a', 'b', 'c'].map((id) => row(id, null)) }));
    expect(out.sessions.map((session) => session.id)).toEqual(['a', 'b', 'c']);
  });

  it('puts the oldest first and a session without a start time last', () => {
    const out = agentsOf(liveState({ sessions: [row('none', null), row('new', '2026-10-12T11:00:00.000Z'), row('old', '2026-10-12T09:00:00.000Z')] }));
    expect(out.sessions.map((session) => session.id)).toEqual(['old', 'new', 'none']);
  });
});

describe('agent boxes of a hosted session (nodesOf)', () => {
  const withAgents = (agents: Record<string, unknown>) => ({ ...row('s1', null), agents: { running: 1, done: 1, names: ['runner', 'reader'], ...agents } }) as never;

  it('makes one agent node for each item, in order of start, with the model and the times', () => {
    const nodes = nodesOf(
      withAgents({
        items: [
          { label: 'runner', state: 'running', model: 'sonnet', startedAt: '2026-10-14T09:00:00.000Z', endedAt: null },
          { label: 'reader', state: 'done', model: 'fable', startedAt: '2026-10-14T08:00:00.000Z', endedAt: '2026-10-14T08:30:00.000Z' },
        ],
      }),
    );
    expect(nodes.map((node) => [node.label, node.state, node.model, node.kind, node.parentId])).toEqual([
      ['reader', 'done', 'fable', 'agent', 's1'],
      ['runner', 'running', 'sonnet', 'agent', 's1'],
    ]);
    expect(nodes[1]).toMatchObject({ startedAt: '2026-10-14T09:00:00.000Z', endedAt: null, filePath: null, messages: { count: 0, approximate: false } });
  });

  it('draws the names with the state from the counts when an older reporter sends no items', () => {
    const nodes = nodesOf(withAgents({}));
    expect(nodes.map((node) => [node.label, node.state, node.model, node.startedAt])).toEqual([
      ['runner', 'running', null, null],
      ['reader', 'done', null, null],
    ]);
  });

  it('gives a session with no agents no nodes, and keeps the id of an agent when it moves from running to done', () => {
    expect(nodesOf(withAgents({ running: 0, done: 0, names: [] }))).toEqual([]);
    const at = '2026-10-14T09:00:00.000Z';
    const before = nodesOf(withAgents({ items: [{ label: 'a', state: 'running', model: null, startedAt: at, endedAt: null }] }));
    const after = nodesOf(withAgents({ items: [{ label: 'a', state: 'done', model: null, startedAt: at, endedAt: at }] }));
    expect(after[0]?.id).toBe(before[0]?.id);
    const twins = nodesOf(withAgents({ items: [1, 2].map(() => ({ label: 'a', state: 'running', model: null, startedAt: at, endedAt: null })) }));
    expect(new Set(twins.map((node) => node.id)).size).toBe(2);
  });
});

describe('hostedHealth', () => {
  it('says the same startedAt on every call', async () => {
    const first = hostedHealth('https://x.example').startedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(hostedHealth('https://x.example').startedAt).toBe(first);
  });
});
