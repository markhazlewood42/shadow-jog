/** Chapter 1's critical path as economy legs (shared by the economy and pacing tests). */
import type { Leg } from './economy';
import { stepsByTable } from './mapgraph';
import { STAGE_GEAR } from './stages';
/**
 * Steps walked on a leg: the shortest path through the leg's waypoints on the real map, split
 * by encounter zone, times an exploration factor (players wander, open chests, backtrack).
 */
export const EXPLORE = 1.25;
export function walk(map: string, ...pts: [number, number][]): [string, number, number][] {
  return Object.entries(stepsByTable(map, pts)).map(([k, n]) => {
    const [table, rate] = k.split('@');
    return [table!, Math.round(n * EXPLORE), Number(rate)];
  });
}

export const ROUTE: Leg[] = [
  { label: 'Opening fight (Lantern Row)', fixed: ['f_first_fight'], cred: 310, optional: 60 /* Pale's expenses (250) and Rook's rent tin (60, optional) */, supplies: 20, checkpoint: { name: 'CP1 before the Rustyard trip', levels: { kit: 1, rook: 10 }, buys: STAGE_GEAR.barrens } },
  { label: 'Walk to the Rustyard', walk: walk('world', [13, 22], [51, 9]) },
  { label: 'Rustyard gate', fixed: ['f_rustyard_gate'], walk: walk('rustyard', [15, 22], [16, 7]), cred: 120, optional: 120 /* the yard cache */, checkpoint: { name: 'CP2 Knuckles', levels: { kit: 2, rook: 10 }, buys: STAGE_GEAR.knuckles } },
  { label: 'Knuckles', fixed: ['f_knuckles'] },
  { label: 'Walk back, Hex joins', walk: [...walk('rustyard', [16, 7], [15, 26]), ...walk('world', [51, 13], [13, 22])], joins: ['hex'], cred: 230 /* the camp's collection from Mags, Hex's emergency fund */, rests: 1, supplies: 120, checkpoint: { name: 'CP3 into the Sinkline', levels: { kit: 3, rook: 10, hex: 3 }, buys: STAGE_GEAR.sinkline } },
  { label: 'Walk to the Sinkline', walk: walk('world', [13, 22], [26, 38]) },
  { label: 'Sinkline B1', walk: walk('sinkline_1', [6, 5], [6, 27], [18, 20], [2, 11], [12, 28], [6, 27], [33, 16], [44, 29]), cred: 470, optional: 220 /* chests on the path, the Glass Wolves' cred stick (90); chest c8 six tiles off the path, c2 beside it */, supplies: 120, checkpoint: { name: 'CP4 the Lurker', levels: { kit: 4, rook: 10, hex: 4 }, buys: STAGE_GEAR.lurker } },
  { label: 'The Lurker', fixed: ['f_lurker'], supplies: 100, checkpoint: { name: 'CP5 into Annex 7', levels: { kit: 5, rook: 10, hex: 5 }, buys: STAGE_GEAR.annex } },
  { label: 'Annex 7', fixed: ['f_annex_door'], walk: walk('annex', [4, 3], [8, 10], [16, 8], [36, 7], [27, 23], [38, 31]), joins: ['sable'], supplies: 320, checkpoint: { name: 'CP6 WARDEN', levels: { kit: 6, rook: 10, hex: 6, sable: 5 }, buys: STAGE_GEAR.warden } },
];
