import type { Hono } from 'hono';
import type { GitInfo } from '../../shared/types';
import type { PanelSource } from '../source';
import { type PanelRouteOptions, registerPanelRoute } from './panel';

/** Adds `GET /api/git` to `app`: the Panel of the current branch, the branches and the newest commits. */
export function registerGitRoutes(app: Hono, git: PanelSource<GitInfo>, options: PanelRouteOptions = {}): void {
  registerPanelRoute(app, '/api/git', git, options);
}
