import type { ChangeEvent } from '../shared/types';

/**
 * The hub is how one part of the server tells the others that something changed. A module
 * publishes "docs changed" and everything that listens hears it: the event stream that tells
 * open pages to reload (see app.ts), and other modules that depend on the same data.
 */
export type Hub = {
  publish(event: ChangeEvent): void;
  /** Starts listening. Returns the function that stops it. */
  subscribe(listener: (event: ChangeEvent) => void): () => void;
};

export function createHub(): Hub {
  const listeners = new Set<(event: ChangeEvent) => void>();

  return {
    publish(event) {
      // Walk a copy, because a listener may unsubscribe (itself or another one) while it runs.
      for (const listener of [...listeners]) {
        // A listener removed by an earlier one in this same round is not called.
        if (!listeners.has(listener)) continue;
        try {
          listener(event);
        } catch (error) {
          // One broken listener must not stop the others or the module that published. It is
          // reported, not hidden.
          console.error(`A listener of the ${event.module} change event threw an error:`, error);
        }
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
