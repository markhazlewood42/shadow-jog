import type { Hono } from 'hono';
import type { PanelSource } from '../source';

// The route that every data module of the status family shares (status, git and GitHub): it answers a
// source's Panel on a GET, and decides when a request may make the source load again. Each module
// adds its own path in its own file under routes/, as the docs and engine modules do.

/**
 * The least time between two forced loads that requests can cause. A forced load asks git or gh
 * again; a page that is reloaded in a loop, or a Retry button that is pressed hard, must not turn
 * into a stream of `gh` calls (GitHub has a rate limit, and every call starts a program).
 */
export const MIN_FORCED_REFRESH_GAP_MS = 10_000;

export type PanelRouteOptions = {
  /** The least time between two forced loads, in milliseconds. 10 000 when this is not set. The end-to-end server sets 0, so a test can change what the fake gh says and see it at once. */
  minGapMs?: number;
};

/**
 * Adds `GET <path>` to `app`: the source's Panel. The answer is a Panel whatever its state: a module
 * that failed answers `ok: false` with the reason and its last good data, and the page shows that in
 * the panel's own error state. (It is not an HTTP error: a browser logs each of those as an error of
 * the page.) The request takes nothing from the client except one thing, `?refresh=1`.
 *
 * A request asks the source to load again, at most once in `minGapMs` (the time is counted from the
 * last load that a request caused), in two cases:
 *
 * - `?refresh=1`: the caller wants the newest data.
 * - the panel that the source has is a failure. The Retry button of a panel sends no parameter, and
 *   a failure is often over (gh was offline, and is not now), so a request looks again.
 *
 * Anything else is answered from what the source has, so a page that is opened costs no `gh` call.
 */
export function registerPanelRoute<T>(app: Hono, path: string, source: PanelSource<T>, options: PanelRouteOptions = {}): void {
  const minGapMs = options.minGapMs ?? MIN_FORCED_REFRESH_GAP_MS;
  let lastForcedAt = Number.NEGATIVE_INFINITY;

  /** Whether a forced load may start now. When it may, the time is taken, so the next request has to wait. */
  function mayForce(): boolean {
    const now = Date.now();
    if (now - lastForcedAt < minGapMs) return false;
    lastForcedAt = now;
    return true;
  }

  app.get(path, async (c) => {
    let panel = await source.get(false);
    if ((c.req.query('refresh') === '1' || !panel.ok) && mayForce()) panel = await source.get(true);
    return c.json(panel);
  });
}
