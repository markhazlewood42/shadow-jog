import type { ChangeEvent, ModuleName, Panel } from '../shared/types';
import type { Hub } from './hub';

/**
 * A load that failed in a way the page should name. `code` is a short stable word the page can
 * test for (for example `gh-not-signed-in`); `message` is the sentence a person reads.
 * Any other error that `load` throws is shown with the code `load-failed`.
 */
export class PanelError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PanelError';
    this.code = code;
  }
}

/**
 * How often a source that asks an outside program (git, gh) looks again when nothing tells it that
 * something changed: every 60 seconds, as the design says for GitHub. A source of files can add a
 * faster trigger of its own (the status module also loads again when its docs change).
 */
export const POLL_EVERY_MS = 60_000;

/** One source of data, ready to be served as a Panel. */
export type PanelSource<T> = {
  /**
   * The current panel. It answers from the last load unless `refresh` is true, or there is no
   * load yet. A load that throws is not an error for the caller: it gives a failed panel that
   * keeps the last good data.
   */
  get(refresh?: boolean): Promise<Panel<T>>;
  /** Loads once at once, and then every `everyMs` when that is set. */
  start(): void;
  /** Stops the polling. */
  stop(): void;
};

/**
 * Wraps a `load` function as a PanelSource.
 *
 * - It keeps the last good data (`lastGood`) and the current error, so one failing source shows
 *   an error and its older data, and never takes a page down.
 * - It publishes a ChangeEvent on the hub when the data or the error is different from before,
 *   so open pages reload only when there is something new.
 * - Loads never overlap: a refresh that is asked for while a load runs waits for it and then loads
 *   once more, because the running load may have read its data before the change that caused the
 *   refresh.
 */
export function createPanelSource<T>(options: {
  name: ModuleName;
  load: () => Promise<T>;
  hub: Hub;
  everyMs?: number;
}): PanelSource<T> {
  const { name, load, hub, everyMs } = options;

  let current: Panel<T> | null = null;
  let lastGood: { data: T; updatedAt: string } | null = null;
  let running: Promise<Panel<T>> | null = null;
  let queued: Promise<Panel<T>> | null = null;
  let timer: NodeJS.Timeout | null = null;

  /** What makes two panels the same for the page: the data, or the error. The times are left out. */
  function signature(panel: Panel<T>): string {
    return JSON.stringify(panel.ok ? [true, panel.data] : [false, panel.error.code, panel.error.message]);
  }

  async function loadOnce(): Promise<Panel<T>> {
    let next: Panel<T>;
    try {
      const data = await load();
      lastGood = { data, updatedAt: new Date().toISOString() };
      next = { ok: true, data, updatedAt: lastGood.updatedAt };
    } catch (error) {
      next = {
        ok: false,
        error: {
          code: error instanceof PanelError ? error.code : 'load-failed',
          message: error instanceof Error ? error.message : String(error),
        },
        updatedAt: lastGood?.updatedAt ?? null,
        lastGood,
      };
    }
    const changed = current === null || signature(current) !== signature(next);
    current = next;
    if (changed) {
      const event: ChangeEvent = { module: name, at: new Date().toISOString() };
      hub.publish(event);
    }
    return next;
  }

  function reload(): Promise<Panel<T>> {
    if (!running) {
      running = loadOnce().finally(() => {
        running = null;
      });
      return running;
    }
    // One extra load is queued behind the running one, and every caller that arrives meanwhile shares it.
    queued ??= running
      .then(
        () => undefined,
        () => undefined,
      )
      .then(() => {
        queued = null;
        return reload();
      });
    return queued;
  }

  /** A load nobody waits for. A failure inside it must still be seen, so it goes to the console. */
  function reloadInBackground(): void {
    reload().catch((error: unknown) => {
      console.error(`The ${name} source could not refresh:`, error);
    });
  }

  return {
    get(refresh = false) {
      if (!refresh) {
        if (current) return Promise.resolve(current);
        if (running) return running;
      }
      return reload();
    },

    start() {
      reloadInBackground();
      if (everyMs !== undefined && timer === null) {
        timer = setInterval(() => {
          // A load that is slower than the interval is not stacked up.
          if (!running) reloadInBackground();
        }, everyMs);
        // The polling alone must not keep the process alive when everything else has stopped.
        timer.unref();
      }
    },

    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}
