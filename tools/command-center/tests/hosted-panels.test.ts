import { describe, expect, it } from 'vitest';
import { liveAnswer, liveState } from '../fixtures/hosted/world';
import type { LiveAnswer } from '../src/hosted/live';
import { agentsOf, hostedHealth, readLive } from '../src/web/hosted/panels';
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

describe('hostedHealth', () => {
  it('says the same startedAt on every call', async () => {
    const first = hostedHealth('https://x.example').startedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(hostedHealth('https://x.example').startedAt).toBe(first);
  });
});
