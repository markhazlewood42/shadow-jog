import type { Hono } from 'hono';
import type { GithubInfo } from '../../shared/types';
import type { PanelSource } from '../source';
import { type PanelRouteOptions, registerPanelRoute } from './panel';

/**
 * Adds `GET /api/github` to `app`: the Panel of the open pull requests and the ones merged in the
 * last week. `?refresh=1` makes the module ask gh again, at most once in 10 seconds (see panel.ts).
 */
export function registerGithubRoutes(app: Hono, github: PanelSource<GithubInfo>, options: PanelRouteOptions = {}): void {
  registerPanelRoute(app, '/api/github', github, options);
}
