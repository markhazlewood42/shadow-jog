/** Map registry. */
import type { MapDef } from '../../field/types';
import { lanternRow } from './lantern_row';
import { INTERIORS } from './interiors';
import { world } from './world';
import { rustyard } from './rustyard';
import { sinkline1 } from './sinkline';
import { annex, dock } from './annex';

const MAPS: Record<string, MapDef> = {
  lantern_row: lanternRow,
  world,
  rustyard,
  sinkline_1: sinkline1,
  annex,
  dock,
};
for (const m of INTERIORS) MAPS[m.id] = m;

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
