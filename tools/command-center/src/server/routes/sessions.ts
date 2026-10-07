import type { Hono } from 'hono';
import type { SessionsInfo } from '../../shared/types';
import type { PanelSource } from '../source';
import { type PanelRouteOptions, registerPanelRoute } from './panel';

/**
 * Adds `GET /api/sessions` to `app`: the Panel of the Claude sessions about Shadow Jog, with their agents and
 * workflows. The request takes nothing from the client but `?refresh=1` (see routes/panel.ts): no path, no
 * session id and no folder name is read from it, so the folders that are read are the ones the config names.
 */
export function registerSessionsRoutes(app: Hono, sessions: PanelSource<SessionsInfo>, options: PanelRouteOptions = {}): void {
  registerPanelRoute(app, '/api/sessions', sessions, options);
}
