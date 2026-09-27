/** Map registry. */
import type { MapDef } from '../../field/types';
import { lanternRow } from './lantern_row';

const MAPS: Record<string, MapDef> = {
  lantern_row: lanternRow,
};

export function getMap(id: string): MapDef {
  const m = MAPS[id];
  if (!m) throw new Error(`Unknown map: ${id}`);
  return m;
}

export function registerMaps(defs: MapDef[]): void {
  for (const d of defs) MAPS[d.id] = d;
}

export function mapIds(): string[] {
  return Object.keys(MAPS);
}
