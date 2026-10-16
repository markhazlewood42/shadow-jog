import type { RoadmapData } from './gen-roadmap.mjs';

export const OWNER: string;
export const PROJECT_NUMBER: number;
export const AUTH_FIX: string;
export const STATUS_MAP: Record<string, string>;
export const KEY_ORDER: string[];
/** A gh runner: takes the arguments, returns stdout, throws on a non-zero exit. */
export type GhRunner = (args: string[]) => string;
export type BoardEntry = {
  number: number;
  url: string;
  title: string;
  state: 'open' | 'closed' | null;
  parent: number | null;
  group: string | null;
  kind: string | null;
  status: string | null;
  step: number | null;
  prs: { number: number; merged: boolean; mergedAt?: string; state?: string }[] | null;
};
export type SyncResult = { code: number; changed: boolean; added: string[]; stale: string[]; warnings: string[]; lines: string[] };
export function defaultGh(args: string[]): string;
export function labelFrom(title: string): string;
export function mergeBoard(current: RoadmapData, entries: (BoardEntry | null)[]): { data: RoadmapData; added: string[]; stale: string[]; warnings: string[] };
export function syncRoadmap(options?: { gh?: GhRunner; dir?: string; check?: boolean; today?: string }): SyncResult;
