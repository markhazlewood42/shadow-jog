import type { Hono } from 'hono';
import type { AgentsLive } from '../../shared/types';
import type { PanelSource } from '../source';
import { type PanelRouteOptions, registerPanelRoute } from './panel';

/**
 * Adds `GET /api/agents` to `app`: the Panel of the Claude sessions that are alive now, with their agents and workflows. The request
 * takes nothing from the client but `?refresh=1` (see routes/panel.ts): no path, no session id and no process id is read from it,
 * so the files that are read are the ones that the config and the process list name.
 */
export function registerAgentsRoutes(app: Hono, agents: PanelSource<AgentsLive>, options: PanelRouteOptions = {}): void {
  registerPanelRoute(app, '/api/agents', agents, options);
}
