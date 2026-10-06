import type { Hono } from 'hono';
import type { Decision } from '../../shared/types';
import type { PanelSource } from '../source';

// The route of the engine review module. It is a GET, as every data route is (the server's method
// gate refuses every other method), and it takes nothing from the request.

/**
 * Adds `GET /api/engine/decisions` to `app`: the Panel of every decision of the engine docs, with its
 * status. The answer is a Panel whatever its state: a module that failed answers `ok: false` with
 * the reason, and the page shows it in the panel's own error state. (It is not an HTTP error: a
 * browser logs each of those as an error of the page.)
 */
export function registerEngineRoutes(app: Hono, engine: PanelSource<Decision[]>): void {
  app.get('/api/engine/decisions', async (c) => {
    let panel = await engine.get();
    // The module loads again by itself when one of its docs changes, and a failure has often been put right by
    // an edit that it has heard of. A failure that has another cause (git was busy) is not put right by anything,
    // so a request looks again: that is what the Retry button of the panel asks for.
    if (!panel.ok) panel = await engine.get(true);
    return c.json(panel);
  });
}
