import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VisibilitySource, createPoller } from '../src/web/hosted/poller';

// The poll loop of the hosted page (design 4.3): it runs only while the tab is visible, runs at once when the tab shows again, and never overlaps itself.

/** A tab that the test shows and hides. */
function fakeTab(visible = true): VisibilitySource & { set(visible: boolean): void; listeners: number } {
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
    get listeners() {
      return callbacks.size;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createPoller', () => {
  it('runs at once, then every interval after the last run ended', async () => {
    const run = vi.fn(async () => {});
    const poller = createPoller({ run, intervalMs: 15_000, visibility: fakeTab() });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(run).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it('does not run while the tab is hidden, and runs at once when it shows again', async () => {
    const tab = fakeTab();
    const run = vi.fn(async () => {});
    const poller = createPoller({ run, intervalMs: 10_000, visibility: tab });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);

    tab.set(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(run).toHaveBeenCalledTimes(1);

    tab.set(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it('does not run at start when the tab is hidden, and starts when it shows', async () => {
    const tab = fakeTab(false);
    const run = vi.fn(async () => {});
    const poller = createPoller({ run, intervalMs: 10_000, visibility: tab });
    poller.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).not.toHaveBeenCalled();
    tab.set(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it('never has two runs at the same time', async () => {
    const tab = fakeTab();
    let active = 0;
    let most = 0;
    const run = vi.fn(async () => {
      active += 1;
      most = Math.max(most, active);
      await new Promise((resolve) => setTimeout(resolve, 30_000));
      active -= 1;
    });
    const poller = createPoller({ run, intervalMs: 5_000, visibility: tab });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    // The tab hides and shows again while the first run is still in flight: no second run starts at once.
    tab.set(false);
    tab.set(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(most).toBe(1);
    poller.stop();
  });

  it('queues one refresh when the tab shows during a run, and starts it as soon as the run ends', async () => {
    const tab = fakeTab();
    let finish: () => void = () => {};
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const poller = createPoller({ run, intervalMs: 60_000, visibility: tab });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    // Hidden and shown twice while the run is in flight: still one queued refresh, not two.
    tab.set(false);
    tab.set(true);
    tab.set(false);
    tab.set(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    // The refresh starts at once, long before the 60 s interval.
    expect(run).toHaveBeenCalledTimes(2);
    finish();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it('does not start the queued refresh when the tab is hidden again before the run ends', async () => {
    const tab = fakeTab();
    let finish: () => void = () => {};
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const poller = createPoller({ run, intervalMs: 1_000, visibility: tab });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    tab.set(false);
    tab.set(true);
    tab.set(false);
    finish();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it('goes on after a run that throws', async () => {
    const run = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);
    const poller = createPoller({ run, intervalMs: 1_000, visibility: fakeTab() });
    poller.start();
    await vi.advanceTimersByTimeAsync(2_500);
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2);
    poller.stop();
  });

  it('stop ends the loop and the listener on the tab', async () => {
    const tab = fakeTab();
    const run = vi.fn(async () => {});
    const poller = createPoller({ run, intervalMs: 1_000, visibility: tab });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(tab.listeners).toBe(1);
    poller.stop();
    expect(tab.listeners).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
    tab.set(false);
    tab.set(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('start twice does not double the loop', async () => {
    const run = vi.fn(async () => {});
    const poller = createPoller({ run, intervalMs: 1_000, visibility: fakeTab() });
    poller.start();
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    poller.stop();
  });
});
