import type { Hono } from 'hono';
import type { StatusInfo } from '../../shared/types';
import type { PanelSource } from '../source';
import { type PanelRouteOptions, registerPanelRoute } from './panel';

/** Adds `GET /api/status` to `app`: the Panel of the current "Right now" section of status.md and the milestones. */
export function registerStatusRoutes(app: Hono, status: PanelSource<StatusInfo>, options: PanelRouteOptions = {}): void {
  registerPanelRoute(app, '/api/status', status, options);
}
