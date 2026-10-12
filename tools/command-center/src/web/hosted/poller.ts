// A poll loop that runs only while the tab can be seen (design.md section 4.3: "only while the tab is visible"). A hidden tab does not poll: it would spend
// Vercel function calls, GitHub points and Upstash commands for a page that nobody looks at. When the tab shows again, the loop runs at once, so the page is fresh
// before the eye lands on it, and then it goes on at its interval.

/** Where the loop learns that the tab is visible or hidden. A test passes a fake. */
export type VisibilitySource = {
  isVisible(): boolean;
  /** Calls `callback` when the state changes. Returns the function that stops the calls. */
  onChange(callback: () => void): () => void;
};

/** The visibility of the browser tab (`document.visibilityState`). Outside a browser the tab counts as visible. */
export const documentVisibility: VisibilitySource = {
  isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  onChange(callback) {
    if (typeof document === 'undefined') return () => {};
    document.addEventListener('visibilitychange', callback);
    return () => document.removeEventListener('visibilitychange', callback);
  },
};

export type Poller = {
  /** Starts the loop. A visible tab runs `run` at once. Calling it again does nothing. */
  start(): void;
  /** Stops the loop and the visibility listener. A run that is in flight is allowed to end. */
  stop(): void;
};

/**
 * `run` does one poll. It must handle its own errors (a throw is caught and dropped here, so one bad poll never stops the loop). The next run starts `intervalMs`
 * after the last one ENDED, so two runs never overlap and a slow answer cannot pile requests up.
 */
export function createPoller(options: { run: () => Promise<void>; intervalMs: number; visibility?: VisibilitySource }): Poller {
  const visibility = options.visibility ?? documentVisibility;
  let started = false;
  let running = false;
  // The tab showed while a run was in flight: one more run follows at once when it ends, so the page is fresh when the eye lands on it.
  let refreshQueued = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopListening: (() => void) | null = null;

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  async function tick(): Promise<void> {
    clearTimer();
    if (running) {
      refreshQueued = true;
      return;
    }
    running = true;
    try {
      await options.run();
    } catch {
      // The run records its own errors. A throw must not end the loop.
    } finally {
      running = false;
    }
    if (!started) {
      refreshQueued = false;
      return;
    }
    // A refresh that was asked for during the run starts now, if the tab is still visible.
    if (refreshQueued) {
      refreshQueued = false;
      if (visibility.isVisible()) {
        void tick();
        return;
      }
    }
    // Schedule the next run only when the loop still runs and the tab is visible. A tab that went hidden during the run stays quiet until it shows again.
    if (visibility.isVisible()) timer = setTimeout(() => void tick(), options.intervalMs);
  }

  function onVisibility(): void {
    if (!started) return;
    if (visibility.isVisible()) void tick();
    else clearTimer();
  }

  return {
    start() {
      if (started) return;
      started = true;
      stopListening = visibility.onChange(onVisibility);
      if (visibility.isVisible()) void tick();
    },
    stop() {
      started = false;
      clearTimer();
      stopListening?.();
      stopListening = null;
    },
  };
}
