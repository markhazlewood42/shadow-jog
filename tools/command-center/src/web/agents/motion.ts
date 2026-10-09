import { useEffect, useRef, useState } from 'react';

// The motion of the Agents diagram that CSS cannot do alone (design 5.4, revision 2). CSS does the moving: a box slides to its new place (a transition on `transform`), fades
// in (an animation), and fades out (a transition on `opacity`). But a box that leaves is gone from the data, and React removes its element at once, so there is nothing left to fade.
// And CSS cannot tell that a count grew. These two hooks keep what CSS needs, for as long as it needs it:
// - `useLeaving` keeps an item that left the list for 200 ms, marked as leaving, so that CSS can fade it out;
// - `useFlash` marks a line for 1 second after its count grew, so that CSS can flash it.
// Both do nothing when the person asked for less motion (the setting `prefers-reduced-motion`): then an item is gone at once and nothing flashes. The CSS has the same
// setting on its own side (src/web/theme.css), so a change of the setting works at once for both.

/** How long a box takes to fade out: the same 200 ms as the slide and the fade-in. */
export const EXIT_MS = 200;

/** How long a dashed line flashes when its count grows. */
export const FLASH_MS = 1000;

/** Whether the person asked the system for less motion. Asked at the moment it matters, so a change of the setting counts at once. */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** An item to draw, and whether it has left the list and is only waiting to fade out. */
export type Leaving<T> = { item: T; leaving: boolean };

/** An item that left the list and is still drawn. `token` tells one leave from another leave of the same key. `after` is the key of the item that stood before it in the list that it left. */
type Ghost<T> = { item: T; token: number; after: string | null };

type LeavingState<T> = {
  /** The list as it was at the last look: what the next list is compared with. */
  seen: readonly T[];
  /** The items that left and are still drawn, by key. */
  ghosts: ReadonlyMap<string, Ghost<T>>;
  tokens: number;
};

/**
 * The list to draw: the items in the order of the data, and each ghost in the place that it left, right after the item that stood before it. A ghost must keep its place in the
 * list because of how React draws a list: an element whose place changed is moved in the page with `insertBefore`, and the browser takes an element that was moved for a new one, so
 * its CSS transition does not run. A ghost at the end of the list would be moved, and would not fade. (The item before a ghost may itself be a ghost that is not placed yet, or may be
 * gone: the loop goes round until nothing more can be placed, and then puts what is left at the end.)
 */
function listWithGhosts<T>(items: readonly T[], ghosts: ReadonlyMap<string, Ghost<T>>, keyOf: (item: T) => string): Leaving<T>[] {
  const drawn: Leaving<T>[] = items.map((item) => ({ item, leaving: false }));
  const present = new Set(items.map(keyOf));
  let waiting = [...ghosts].filter(([key]) => !present.has(key)).map(([, ghost]) => ghost);
  while (waiting.length > 0) {
    const unplaced: Ghost<T>[] = [];
    for (const ghost of waiting) {
      const before = ghost.after === null ? -1 : drawn.findIndex((entry) => keyOf(entry.item) === ghost.after);
      if (ghost.after !== null && before === -1) unplaced.push(ghost);
      else drawn.splice(before + 1, 0, { item: ghost.item, leaving: true });
    }
    if (unplaced.length === waiting.length) {
      for (const ghost of unplaced) drawn.push({ item: ghost.item, leaving: true });
      break;
    }
    waiting = unplaced;
  }
  return drawn;
}

/**
 * The items of a list, and with them the items that left it during the last 200 ms, last known state and all, marked `leaving`, each in the place where it left. A page draws a
 * leaving item as it was and lets CSS fade it. After 200 ms it is dropped. An item that comes back while it fades is a normal item again (its element is reused, so it does not
 * blink), and every item has its own 200 ms, however many leave one after another.
 *
 * `items` must keep its identity from one render to the next while nothing changed (a list made in the render goes in `useMemo`), because the hook compares it with the last one.
 * React lets a component set its own state during the render to follow a change of its input (the way it is meant for "keep what the last list had"): the render runs again at
 * once, before anything is drawn, so no frame is drawn without the item that is leaving.
 */
export function useLeaving<T>(items: readonly T[], keyOf: (item: T) => string): Leaving<T>[] {
  const [state, setState] = useState<LeavingState<T>>({ seen: items, ghosts: new Map(), tokens: 0 });
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  if (state.seen !== items) {
    const keys = new Set(items.map(keyOf));
    const ghosts = new Map(state.ghosts);
    for (const key of keys) ghosts.delete(key);
    let tokens = state.tokens;
    if (!prefersReducedMotion()) {
      for (const [index, item] of state.seen.entries()) {
        const key = keyOf(item);
        if (!keys.has(key)) {
          tokens += 1;
          const before = state.seen[index - 1];
          ghosts.set(key, { item, token: tokens, after: before === undefined ? null : keyOf(before) });
        }
      }
    }
    setState({ seen: items, ghosts, tokens });
  }

  // Each ghost gets one timer, the first time it is drawn. The timer drops that ghost only: if the same key left again since, it has another token and is not touched.
  useEffect(() => {
    for (const [key, { token }] of state.ghosts) {
      if (timers.current.has(token)) continue;
      timers.current.set(
        token,
        setTimeout(() => {
          timers.current.delete(token);
          setState((current) => {
            if (current.ghosts.get(key)?.token !== token) return current;
            const ghosts = new Map(current.ghosts);
            ghosts.delete(key);
            return { ...current, ghosts };
          });
        }, EXIT_MS),
      );
    }
  }, [state.ghosts]);
  // A timer must not outlive the list that it belongs to.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return listWithGhosts(items, state.ghosts, keyOf);
}

type FlashState = {
  /** The counts at the last look: what the next ones are compared with. */
  seen: ReadonlyMap<string, number>;
  /** The lines that flash now, by key, each with the token of the growth that started it. */
  flashing: ReadonlyMap<string, number>;
  tokens: number;
};

/**
 * Which lines flash now: the key of each line whose count grew in the last second, with a token that changes at every growth. A page puts the token in the `key` of the line,
 * so the element is made again and its CSS animation starts again when the count grows a second time during a flash.
 *
 * A line flashes only when its count grew from a count that was there: the first look, a count that is new, and a count that stays or falls flash nothing. `counts` must keep its
 * identity while nothing changed (put it in `useMemo`), as for `useLeaving`.
 */
export function useFlash(counts: ReadonlyMap<string, number>): ReadonlyMap<string, number> {
  const [state, setState] = useState<FlashState>({ seen: counts, flashing: new Map(), tokens: 0 });
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  if (state.seen !== counts) {
    const flashing = new Map(state.flashing);
    let tokens = state.tokens;
    if (!prefersReducedMotion()) {
      for (const [key, count] of counts) {
        const before = state.seen.get(key);
        if (before !== undefined && count > before) {
          tokens += 1;
          flashing.set(key, tokens);
        }
      }
    }
    setState({ seen: counts, flashing, tokens });
  }

  useEffect(() => {
    for (const [key, token] of state.flashing) {
      if (timers.current.has(token)) continue;
      timers.current.set(
        token,
        setTimeout(() => {
          timers.current.delete(token);
          setState((current) => {
            if (current.flashing.get(key) !== token) return current;
            const flashing = new Map(current.flashing);
            flashing.delete(key);
            return { ...current, flashing };
          });
        }, FLASH_MS),
      );
    }
  }, [state.flashing]);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return state.flashing;
}
