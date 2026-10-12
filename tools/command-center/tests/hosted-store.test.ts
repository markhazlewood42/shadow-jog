import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveAnswer, liveState, pr, snapshot } from '../fixtures/hosted/world';
import type { FetchFn } from '../src/web/hosted/fetch';
import type { VisibilitySource } from '../src/web/hosted/poller';
import { LIVE_INTERVAL_MS, LIVE_MODULES, LIVE_URL, SNAPSHOT_INTERVAL_MS, SNAPSHOT_MODULES, SNAPSHOT_URL, type HostedEvent, createHostedStore, looksLikeSnapshot } from '../src/web/hosted/store';

// The store of the hosted page: it fetches the snapshot every 15 s and the live key every 10 s while the tab is visible, keeps the last good answer of each,
// and says which modules changed. Fake timers, a fake fetch and a fake tab: no network, no browser.

type Answer = { status?: number; body?: unknown; type?: string };

/** A fake fetch that answers each URL from a table the test changes, and counts the calls. */
function fakeServer() {
  const answers = new Map<string, Answer | 'throw'>();
  const calls: string[] = [];
  const fetchImpl: FetchFn = async (url) => {
    calls.push(url);
    const answer = answers.get(url);
    if (answer === undefined || answer === 'throw') throw new TypeError('Failed to fetch');
    const status = answer.status ?? 200;
    return { ok: status >= 200 && status < 300, status, type: (answer.type ?? 'basic') as ResponseType, headers: new Headers(), text: async () => (typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body)) };
  };
  return { answers, calls, fetchImpl, count: (url: string) => calls.filter((call) => call === url).length };
}

function fakeTab(visible = true): VisibilitySource & { set(visible: boolean): void } {
  let state = visible;
  const callbacks = new Set<() => void>();
  return {
    isVisible: () => state,
    onChange(callback) {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
    set(next) {
      state = next;
      for (const callback of [...callbacks]) callback();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-12T12:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the store', () => {
  it('polls the snapshot every 15 s and the live key every 10 s', async () => {
    const server = fakeServer();
    server.answers.set(SNAPSHOT_URL, { body: snapshot() });
    server.answers.set(LIVE_URL, { body: liveAnswer('online') });
    const store = createHostedStore({ fetchImpl: server.fetchImpl, visibility: fakeTab() });
    const off = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(server.count(SNAPSHOT_URL)).toBe(1);
    expect(server.count(LIVE_URL)).toBe(1);

    await vi.advanceTimersByTimeAsync(30_000);
    // 30 s later: snapshot at 15 s and 30 s, live at 10 s, 20 s and 30 s.
    expect(server.count(SNAPSHOT_URL)).toBe(1 + 30_000 / SNAPSHOT_INTERVAL_MS);
    expect(server.count(LIVE_URL)).toBe(1 + 30_000 / LIVE_INTERVAL_MS);
    off();
  });

  it('does not poll while the tab is hidden and refreshes when it shows', async () => {
    const server = fakeServer();
    server.answers.set(SNAPSHOT_URL, { body: snapshot() });
    server.answers.set(LIVE_URL, { body: liveAnswer('online') });
    const tab = fakeTab();
    const store = createHostedStore({ fetchImpl: server.fetchImpl, visibility: tab });
    const off = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    tab.set(false);
    const before = server.calls.length;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(server.calls.length).toBe(before);
    tab.set(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(server.calls.length).toBe(before + 2);
    off();
  });

  it('stops polling when the last listener leaves', async () => {
    const server = fakeServer();
    server.answers.set(SNAPSHOT_URL, { body: snapshot() });
    server.answers.set(LIVE_URL, { body: liveAnswer('online') });
    const store = createHostedStore({ fetchImpl: server.fetchImpl, visibility: fakeTab() });
    const off = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    off();
    const before = server.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(server.calls.length).toBe(before);
  });

  it('tells the modules that changed, and says nothing when a poll finds the same data', async () => {
    const server = fakeServer();
    server.answers.set(SNAPSHOT_URL, { body: snapshot() });
    server.answers.set(LIVE_URL, { body: liveAnswer('online', liveState()) });
    const store = createHostedStore({ fetchImpl: server.fetchImpl, visibility: fakeTab() });
    const events: HostedEvent[] = [];
    const off = store.subscribe((event) => events.push(event));
    await vi.advanceTimersByTimeAsync(0);
    const changed = (list: HostedEvent[]) => list.flatMap((event) => (event.type === 'changed' ? [event.event.module] : []));
    // The first answers tell every module once.
    expect(changed(events)).toHaveLength(SNAPSHOT_MODULES.length + LIVE_MODULES.length);
    expect(new Set(changed(events))).toEqual(new Set([...SNAPSHOT_MODULES, ...LIVE_MODULES]));

    events.length = 0;
    // The same data with a new `at` (the adapter's clock) and a new age: no change.
    server.answers.set(SNAPSHOT_URL, { body: snapshot({ at: '2026-10-12T12:00:15.000Z', cost: [{ call: 'x', cost: 1, remaining: 4999 }] }) });
    server.answers.set(LIVE_URL, { body: { ...liveAnswer('online', liveState()), reporter: { ...liveAnswer('online').reporter, ageSeconds: 9 } } });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(changed(events)).toEqual([]);

    // A new PR changes the snapshot modules only.
    server.answers.set(SNAPSHOT_URL, { body: snapshot({ github: { open: [pr(1, 'a')], merged: [] } }) });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(new Set(changed(events))).toEqual(new Set(SNAPSHOT_MODULES));
    off();
  });

  it('keeps the last good data when a poll fails, and tells the panels once', async () => {
    const server = fakeServer();
    server.answers.set(SNAPSHOT_URL, { body: snapshot({ github: { open: [pr(7, 'a')], merged: [] } }) });
    server.answers.set(LIVE_URL, { body: liveAnswer('online') });
    const store = createHostedStore({ fetchImpl: server.fetchImpl, visibility: fakeTab() });
    const events: HostedEvent[] = [];
    const off = store.subscribe((event) => events.push(event));
    await vi.advanceTimersByTimeAsync(0);
    events.length = 0;

    server.answers.set(SNAPSHOT_URL, { status: 502, body: { error: 'the store could not be reached', kind: 'x' } });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(store.snapshot().data?.github.open[0]?.number).toBe(7);
    expect(store.snapshot().error).toMatchObject({ code: 'http-502' });
    const afterFirst = events.filter((event) => event.type === 'changed').length;
    expect(afterFirst).toBe(SNAPSHOT_MODULES.length);

    // The same error again is not news.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(events.filter((event) => event.type === 'changed').length).toBe(afterFirst);

    // A good answer clears the error and tells the panels.
    server.answers.set(SNAPSHOT_URL, { body: snapshot({ github: { open: [pr(7, 'a')], merged: [] } }) });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(store.snapshot().error).toBeNull();
    expect(events.filter((event) => event.type === 'changed').length).toBe(afterFirst + SNAPSHOT_MODULES.length);
    off();
  });

  it('reports the connection: connecting, live, offline, live again', async () => {
    const server = fakeServer();
    server.answers.set(SNAPSHOT_URL, { body: snapshot() });
    server.answers.set(LIVE_URL, { body: liveAnswer('online') });
    const store = createHostedStore({ fetchImpl: server.fetchImpl, visibility: fakeTab() });
    const states: string[] = [];
    const off = store.subscribe((event) => {
      if (event.type === 'connection') states.push(event.state);
    });
    expect(states).toEqual(['connecting']);
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toBe('live');
    server.answers.set(SNAPSHOT_URL, 'throw');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(states.at(-1)).toBe('offline');
    server.answers.set(SNAPSHOT_URL, { body: snapshot() });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(states.at(-1)).toBe('live');
    off();
  });

  it('a reporter that is not running is not a lost connection', async () => {
    const server = fakeServer();
    server.answers.set(SNAPSHOT_URL, { body: snapshot() });
    server.answers.set(LIVE_URL, { body: liveAnswer('not-running') });
    const store = createHostedStore({ fetchImpl: server.fetchImpl, visibility: fakeTab() });
    const off = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(store.connection()).toBe('live');
    expect(store.live().data?.reporter.state).toBe('not-running');
    off();
  });

  it('flags a lost login (401, redirect, HTML) and clears the flag when the next answer is good', async () => {
    const server = fakeServer();
    server.answers.set(SNAPSHOT_URL, { body: snapshot() });
    server.answers.set(LIVE_URL, { body: liveAnswer('online') });
    const store = createHostedStore({ fetchImpl: server.fetchImpl, visibility: fakeTab() });
    const events: HostedEvent[] = [];
    const off = store.subscribe((event) => events.push(event));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.loginExpired()).toBe(false);

    server.answers.set(LIVE_URL, { status: 0, type: 'opaqueredirect' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.loginExpired()).toBe(true);
    expect(events.some((event) => event.type === 'status')).toBe(true);
    // The data of the snapshot is still there, so the panels can show it as stale.
    expect(store.snapshot().data).not.toBeNull();

    server.answers.set(LIVE_URL, { body: liveAnswer('online') });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.loginExpired()).toBe(false);
    off();
  });

  it('refuses an answer that is JSON but not a snapshot', async () => {
    const server = fakeServer();
    server.answers.set(SNAPSHOT_URL, { body: { hello: 'world' } });
    server.answers.set(LIVE_URL, { body: liveAnswer('online') });
    const store = createHostedStore({ fetchImpl: server.fetchImpl, visibility: fakeTab() });
    await store.ensure('snapshot');
    expect(store.snapshot().data).toBeNull();
    expect(store.snapshot().error).toMatchObject({ kind: 'bad-response' });
  });

  it('ensure loads once, shares a request in flight, and loads again after an error (the Retry button)', async () => {
    const server = fakeServer();
    server.answers.set(SNAPSHOT_URL, 'throw');
    const store = createHostedStore({ fetchImpl: server.fetchImpl, visibility: fakeTab() });
    await Promise.all([store.ensure('snapshot'), store.ensure('snapshot'), store.ensure('snapshot')]);
    expect(server.count(SNAPSHOT_URL)).toBe(1);
    expect(store.snapshot().error).toMatchObject({ kind: 'network' });

    server.answers.set(SNAPSHOT_URL, { body: snapshot() });
    await store.ensure('snapshot');
    expect(server.count(SNAPSHOT_URL)).toBe(2);
    expect(store.snapshot().error).toBeNull();
    await store.ensure('snapshot');
    expect(server.count(SNAPSHOT_URL)).toBe(2);
  });
});

describe('looksLikeSnapshot', () => {
  it('accepts a snapshot and refuses other shapes', () => {
    expect(looksLikeSnapshot(snapshot())).toBe(true);
    expect(looksLikeSnapshot(null)).toBe(false);
    expect(looksLikeSnapshot({})).toBe(false);
    expect(looksLikeSnapshot({ ...snapshot(), workstreams: 'no' })).toBe(false);
  });
});
