import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModuleName, Panel } from '../shared/types';
import { getPanel, mergeLastGood, subscribeEvents } from './api';

export type PanelState = 'loading' | 'ready' | 'error';

/** What a page gets for one panel. */
export type PanelResult<T> = {
  /** `loading` until the first answer, then `ready` or `error` (a failed panel may still carry old data). */
  state: PanelState;
  /** The latest panel, or null before the first answer. */
  panel: Panel<T> | null;
  /** Loads again now (the Retry button). */
  reload: () => void;
};

/**
 * Runs `task` when asked, never two at once. A request that arrives while it runs is not lost
 * and not doubled: the task runs once more after it, however many requests came. This is what
 * keeps a burst of "changed" events down to one more load, and makes sure the last load starts
 * after the last change.
 */
export function createCoalescingRunner(task: () => Promise<void>): { trigger(): void } {
  let running = false;
  let again = false;

  async function run(): Promise<void> {
    running = true;
    try {
      do {
        again = false;
        try {
          await task();
        } catch (error) {
          console.error('A panel could not be loaded:', error);
        }
      } while (again);
    } finally {
      running = false;
    }
  }

  return {
    trigger() {
      if (running) again = true;
      else void run();
    },
  };
}

/**
 * Loads a panel with `load`, and loads it again whenever the server says one of `modules`
 * changed, and whenever the event stream says hello (it opened, or came back after a cut).
 * `load` must be the same function on every render (wrap it in useCallback), or the panel
 * would reload on every render.
 */
export function useLoadedPanel<T>(load: () => Promise<Panel<T>>, modules: readonly ModuleName[]): PanelResult<T> {
  const [panel, setPanel] = useState<Panel<T> | null>(null);
  const runner = useRef<{ trigger(): void } | null>(null);
  // The list as one string: a new array with the same names must not restart the effect.
  const modulesKey = modules.join(',');

  useEffect(() => {
    let active = true;
    const listensTo = new Set(modulesKey === '' ? [] : modulesKey.split(','));
    setPanel(null);

    const run = createCoalescingRunner(async () => {
      const next = await load();
      // An answer that arrives after the page moved on is dropped.
      if (active) setPanel((previous) => mergeLastGood(previous, next));
    });
    runner.current = run;
    run.trigger();

    const unsubscribe = subscribeEvents((event) => {
      if (event.type === 'hello' || (event.type === 'changed' && listensTo.has(event.event.module))) run.trigger();
    });

    return () => {
      active = false;
      runner.current = null;
      unsubscribe();
    };
  }, [load, modulesKey]);

  const reload = useCallback(() => runner.current?.trigger(), []);
  const state: PanelState = panel === null ? 'loading' : panel.ok ? 'ready' : 'error';
  return { state, panel, reload };
}

/** Loads the Panel that a data endpoint (a URL under /api) serves, and keeps it current. */
export function usePanel<T>(url: string, modules: readonly ModuleName[]): PanelResult<T> {
  const load = useCallback(() => getPanel<T>(url), [url]);
  return useLoadedPanel(load, modules);
}
