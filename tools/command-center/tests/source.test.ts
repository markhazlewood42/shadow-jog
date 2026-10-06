import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChangeEvent } from '../src/shared/types';
import { createHub } from '../src/server/hub';
import { PanelError, createPanelSource } from '../src/server/source';

/** A promise that a test settles by hand, to hold a load open while it does other things. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createPanelSource', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('panel source keeps lastGood and the error when load throws', async () => {
    let call = 0;
    const source = createPanelSource({
      name: 'git',
      hub: createHub(),
      load: async () => {
        call += 1;
        if (call === 2) throw new PanelError('git-unreadable', 'Git: the repo cannot be read');
        if (call === 3) throw new Error('plain failure');
        return { commits: call };
      },
    });

    // 1. A good load: ok, with the data and the time it was made.
    const first = await source.get();
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data).toEqual({ commits: 1 });
    expect(Number.isNaN(Date.parse(first.updatedAt))).toBe(false);

    // 2. A failing load: the error keeps its code and message, the last good data stays,
    //    and updatedAt is when that data was made (so a page can say how old it is).
    const failed = await source.get(true);
    expect(failed).toEqual({
      ok: false,
      error: { code: 'git-unreadable', message: 'Git: the repo cannot be read' },
      updatedAt: first.updatedAt,
      lastGood: { data: { commits: 1 }, updatedAt: first.updatedAt },
    });

    // 3. An error that is not a PanelError still gives a panel, with a generic code and its message.
    const plain = await source.get(true);
    expect(plain).toMatchObject({
      ok: false,
      error: { code: 'load-failed', message: 'plain failure' },
      lastGood: { data: { commits: 1 } },
    });

    // 4. The next good load replaces lastGood and clears the error.
    const recovered = await source.get(true);
    expect(recovered).toMatchObject({ ok: true, data: { commits: 4 } });
  });

  it('gives an error panel with no lastGood and no time when the very first load fails', async () => {
    const source = createPanelSource({
      name: 'github',
      hub: createHub(),
      load: async () => {
        throw new PanelError('gh-not-signed-in', 'GitHub: gh is not signed in');
      },
    });
    expect(await source.get()).toEqual({
      ok: false,
      error: { code: 'gh-not-signed-in', message: 'GitHub: gh is not signed in' },
      updatedAt: null,
      lastGood: null,
    });
  });

  it('answers from the last result and loads again only when asked to refresh', async () => {
    let loads = 0;
    const load = vi.fn(async () => ({ n: ++loads }));
    const source = createPanelSource({ name: 'docs', hub: createHub(), load });
    await source.get();
    await source.get();
    expect(load).toHaveBeenCalledTimes(1);
    expect(await source.get(true)).toMatchObject({ ok: true, data: { n: 2 } });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares one load between callers that ask while it runs', async () => {
    const gate = deferred<{ n: number }>();
    const load = vi.fn(() => gate.promise);
    const source = createPanelSource({ name: 'status', hub: createHub(), load });
    const a = source.get();
    const b = source.get();
    gate.resolve({ n: 1 });
    expect(await a).toEqual(await b);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('a refresh that arrives while a load runs waits for it and then loads once more, because that load may predate the change', async () => {
    const gates = [deferred<string>(), deferred<string>()];
    let call = 0;
    const load = vi.fn(() => {
      const gate = gates[call];
      call += 1;
      if (!gate) throw new Error('a third load was not expected');
      return gate.promise;
    });
    const source = createPanelSource({ name: 'decisions', hub: createHub(), load });

    const running = source.get(true); // load 1 starts
    const refreshA = source.get(true); // arrives while load 1 runs
    const refreshB = source.get(true); // so does this one: both share the one extra load
    expect(load).toHaveBeenCalledTimes(1);

    gates[0]?.resolve('before the change');
    await running;
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    gates[1]?.resolve('after the change');

    expect(await refreshA).toMatchObject({ ok: true, data: 'after the change' });
    expect(await refreshB).toMatchObject({ ok: true, data: 'after the change' });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('publishes a changed event when the data or the error changes, and only then', async () => {
    const hub = createHub();
    const events: ChangeEvent[] = [];
    hub.subscribe((e) => events.push(e));
    let value = 'one';
    let broken = false;
    const source = createPanelSource({
      name: 'github',
      hub,
      load: async () => {
        if (broken) throw new PanelError('gh-offline', 'offline');
        return { value };
      },
    });

    await source.get(); // first data
    await source.get(true); // same data: no event
    value = 'two';
    await source.get(true); // new data
    broken = true;
    await source.get(true); // now an error
    await source.get(true); // the same error again: no event
    broken = false;
    await source.get(true); // recovered, same data as before the error ('two' again): a change from the error

    expect(events.map((e) => e.module)).toEqual(['github', 'github', 'github', 'github']);
    for (const e of events) expect(Number.isNaN(Date.parse(e.at))).toBe(false);
  });

  it('start() loads once at once and then on every interval, and stop() ends the polling', async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => ({ at: Date.now() }));
    const source = createPanelSource({ name: 'git', hub: createHub(), load, everyMs: 60_000 });

    source.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(load).toHaveBeenCalledTimes(4);

    source.stop();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('start() without an interval loads once and does not poll', async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => 1);
    const source = createPanelSource({ name: 'docs', hub: createHub(), load });
    source.start();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(load).toHaveBeenCalledTimes(1);
    source.stop();
  });
});
