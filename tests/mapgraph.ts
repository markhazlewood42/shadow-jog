/**
 * Map walkability for tests: terrain + legend + patches, evaluated as if every story flag were
 * set (the post-progress state). Props and NPCs are ignored (they would only block more), so
 * reachability here is an upper bound and path lengths are a lower bound on steps walked.
 */
import { getMap, mapIds } from '../src/data/maps';
import { DEFAULT_LEGEND } from '../src/field/fieldmap';
import { SOLID_TERRAIN } from '../src/field/tiles';
import type { MapDef, TerrainId } from '../src/field/types';

/** Flags proxy for patch/when guards: every flag reads as set. */
const ALL_SET = new Proxy({} as Record<string, unknown>, { get: () => true });

export interface Grid {
  def: MapDef;
  w: number;
  h: number;
  at(x: number, y: number): TerrainId;
  open(x: number, y: number): boolean;
}

/** The map's walkable grid with its patches evaluated against `flags` (default: every flag set). */
export function grid(id: string, flags: Record<string, unknown> = ALL_SET): Grid {
  const def = getMap(id);
  const legend = { ...DEFAULT_LEGEND, ...def.legend };
  const rows = def.terrain.map((r) => r.split(''));
  for (const patch of def.patches ?? []) {
    if (!patch.when(flags)) continue;
    for (const [px, py, pw, ph, ch] of patch.rects) for (let y = py; y < py + ph; y++) for (let x = px; x < px + pw; x++) if (rows[y]) rows[y]![x] = ch;
  }
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const at = (x: number, y: number): TerrainId => (x < 0 || y < 0 || x >= w || y >= h ? 'void' : legend[rows[y]![x] ?? ' '] ?? 'void');
  return { def, w, h, at, open: (x, y) => !SOLID_TERRAIN.has(at(x, y)) };
}

/** Tiles where the player can arrive on this map: every warp in any map that leads here. */
export function arrivals(id: string): [number, number][] {
  const out: [number, number][] = [];
  for (const other of mapIds()) for (const wp of getMap(other).warps ?? []) if (wp.to === id) out.push([wp.tx, wp.ty]);
  return out;
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Breadth-first distances from a set of start tiles over walkable terrain. */
export function distances(g: Grid, starts: [number, number][]): Map<number, number> {
  const d = new Map<number, number>();
  const q: [number, number][] = [];
  for (const [x, y] of starts) if (g.open(x, y)) {
    d.set(y * g.w + x, 0);
    q.push([x, y]);
  }
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i]!;
    const k = d.get(y * g.w + x)!;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h || !g.open(nx, ny) || d.has(ny * g.w + nx)) continue;
      d.set(ny * g.w + nx, k + 1);
      q.push([nx, ny]);
    }
  }
  return d;
}

/**
 * Shortest walk through waypoints, split by the encounter table in force on each step
 * (a zone applies when its terrain filter and rectangle match the tile).
 */
export function stepsByTable(id: string, waypoints: [number, number][]): Record<string, number> {
  const g = grid(id);
  const out: Record<string, number> = {};
  for (let i = 0; i + 1 < waypoints.length; i++) {
    const path = shortestPath(g, waypoints[i]!, waypoints[i + 1]!);
    for (const [x, y] of path.slice(1)) {
      const t = g.at(x, y);
      const zone = (g.def.encounters ?? []).find((z) => (!z.terrain || z.terrain.includes(t)) && (!z.rect || (x >= z.rect[0] && y >= z.rect[1] && x < z.rect[0] + z.rect[2] && y < z.rect[1] + z.rect[3])));
      if (zone) out[`${zone.table}@${zone.rate}`] = (out[`${zone.table}@${zone.rate}`] ?? 0) + 1;
    }
  }
  return out;
}

export function shortestPath(g: Grid, from: [number, number], to: [number, number]): [number, number][] {
  const d = distances(g, [to]);
  if (!d.has(from[1] * g.w + from[0])) throw new Error(`${g.def.id}: no path ${from} → ${to}`);
  const path: [number, number][] = [from];
  let [x, y] = from;
  while (x !== to[0] || y !== to[1]) {
    const k = d.get(y * g.w + x)!;
    const next = DIRS.map(([dx, dy]) => [x + dx, y + dy] as [number, number]).find(([nx, ny]) => d.get(ny * g.w + nx) === k - 1)!;
    [x, y] = next;
    path.push(next);
  }
  return path;
}
