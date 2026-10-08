import type { Hono } from 'hono';
import type { CiMain } from '../../shared/types';
import type { PanelSource } from '../source';
import { type PanelRouteOptions, registerPanelRoute } from './panel';

/**
 * Adds `GET /api/ci` to `app`: the Panel of the newest CI run on `main`. `?refresh=1` makes the source ask gh again, at most once in 10 seconds (see panel.ts),
 * which is the rule of the pull request route as well.
 */
export function registerCiRoutes(app: Hono, ci: PanelSource<CiMain>, options: PanelRouteOptions = {}): void {
  registerPanelRoute(app, '/api/ci', ci, options);
}
