import type { Hono } from 'hono';
import type { Decision, DecisionsInfo, GithubInfo, Panel, SessionsInfo, StatusInfo, YourMoveInfo } from '../../shared/types';
import { buildYourMove } from '../now/yourMove';
import type { PanelSource } from '../source';

// The route of the Now page. The other panels of the page read the routes of their own modules (/api/sessions, /api/github, /api/status
// and /api/git); the list "Your move" is the one thing that the page cannot make by itself, because it is made from five sources, and
// the page would have to know how to read each of them. The route is a GET, as every data route is (the server's method gate refuses every
// other method), and it takes nothing from the request: no path, no id, no query.

export type NowRoutesDeps = {
  decisions: PanelSource<DecisionsInfo>;
  sessions: PanelSource<SessionsInfo>;
  status: PanelSource<StatusInfo>;
  github: PanelSource<GithubInfo>;
  /** The decisions of the engine docs (the source of the engine review). */
  engine: PanelSource<Decision[]>;
};

/**
 * Adds `GET /api/now/your-move` to `app`: the Panel of the list of what waits for Mark.
 *
 * The answer is a good Panel whatever the state of the sources: a source that failed is named inside the data (`missing`), and
 * the list is made from what the others have. (A failed panel is not an HTTP error, and it is not a failed Panel either: the list
 * itself was made, and it is the sources that are incomplete.) The route only reads what each source already has. It never asks a
 * source to look again: a failed source is put right by the route of its own panel (the Retry button of that panel) or by its own timer.
 */
export function registerNowRoutes(app: Hono, deps: NowRoutesDeps): void {
  app.get('/api/now/your-move', async (c) => {
    // The five reads do not depend on each other. A source that has not loaded yet makes its read wait for the first load.
    const [decisionIssues, sessions, status, github, docDecisions] = await Promise.all([deps.decisions.get(), deps.sessions.get(), deps.status.get(), deps.github.get(), deps.engine.get()]);
    // The list is as new as the moment it is made from the panels that the sources have now, so that is the time it carries.
    const panel: Panel<YourMoveInfo> = { ok: true, data: buildYourMove({ decisionIssues, sessions, status, github, docDecisions }), updatedAt: new Date().toISOString() };
    return c.json(panel);
  });
}
