/**
 * Chapter length model. The GDD targets 45–75 minutes for Chapter 1; this estimates it from the
 * critical path's real map distances, the economy route's expected fights, the balance sim's round
 * counts and the length of the script itself, so a change that bloats (or guts) the chapter fails
 * here rather than being discovered by a playtester.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runEconomy } from './economy';
import { grid, shortestPath } from './mapgraph';
import { ROUTE } from './route';

/** Seconds per tile: walking is 12 frames a tile, dashing 7; players mix the two. */
const TILE_S = 10 / 60;
/** Wandering, chests, dead ends and backtracking on top of the shortest path. */
const EXPLORE = 1.35;
/** Reading speed for dialogue (about 200 words a minute). */
const READ_CPS = 17;
/** Share of optional NPC and lore text a typical player stops to read. */
const OPTIONAL_READ = 0.4;
/** One battle round: giving four orders, then watching them play out. */
const ROUND_S = 11;
/** Per fight: the transition, intro, victory fanfare and rewards. */
const FIGHT_OVERHEAD_S = 9;
/** Trash fights: mean rounds from the balance sim (docs/quality/evidence/unit-tests.txt). */
const TRASH_ROUNDS = 2.6;
/** Scripted fights: sim mean rounds. */
const BOSS_ROUNDS: Record<string, number> = { f_first_fight: 2.5, f_rustyard_gate: 2.4, f_knuckles: 6.6, f_lurker: 7.7, f_annex_door: 3.2, f_warden: 10.8 };
/** Shopping, equipping and menus at each checkpoint. */
const MENU_S = 100;

/** Critical-path walking the economy route doesn't cover (towns have no encounters). */
const TOWN_WALKS: [string, [number, number][]][] = [
  // Out of Rook's flat to the Drowned Saint; then Hex's den; the shops; out to the Sprawl.
  ['lantern_row', [[4, 30], [22, 7], [11, 30], [12, 7], [40, 7], [54, 11]]],
  // Back from the Rustyard: Hex, a night at the hotel, the clinic, out to the Sinkline.
  ['lantern_row', [[54, 11], [11, 30], [32, 7], [4, 7], [54, 11]]],
];
/** Interiors entered on the critical path (flat, bar twice, den twice, shops, hotel, clinic). */
const INTERIOR_VISITS = 10;
const INTERIOR_STEPS = 22;

function pathSteps(map: string, pts: [number, number][]): number {
  const g = grid(map);
  // Waypoints name a door or shop front; walk to the nearest open tile beside it.
  const snap = ([x, y]: [number, number]): [number, number] => {
    for (let r = 0; r < 6; r++)
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (g.open(x + dx, y + dy)) return [x + dx, y + dy];
    throw new Error(`${map}: nothing open near ${x},${y}`);
  };
  const at = pts.map(snap);
  let n = 0;
  for (let i = 0; i + 1 < at.length; i++) n += shortestPath(g, at[i]!, at[i + 1]!).length - 1;
  return n;
}

/** Characters of prose in a source file: string literals long enough to be a line of dialogue. */
function proseChars(path: string): number {
  const src = readFileSync(path, 'utf8');
  let n = 0;
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.){12,})'|`([^`]{12,})`/g)) {
    const text = (m[1] ?? m[2] ?? '').replace(/\{[a-z/#0-9]*\}/g, '').replace(/\$\{[^}]*\}/g, '');
    if (text.includes(' ')) n += text.length;
  }
  return n;
}

describe('pacing', () => {
  const report = runEconomy(ROUTE, 150, { kit: 1, rook: 3 });
  const fights = report[report.length - 1]!.battles + 1; // + the Warden itself

  const routeSteps = ROUTE.reduce((n, leg) => n + (leg.walk ?? []).reduce((m, [, s]) => m + s, 0), 0);
  const townSteps = TOWN_WALKS.reduce((n, [map, pts]) => n + pathSteps(map, pts), 0) * EXPLORE + INTERIOR_VISITS * INTERIOR_STEPS;
  const walkS = (routeSteps + townSteps) * TILE_S;

  const fixed = ROUTE.flatMap((l) => l.fixed ?? []).concat('f_warden');
  const trash = fights - fixed.length;
  const fightS = trash * (TRASH_ROUNDS * ROUND_S + FIGHT_OVERHEAD_S) + fixed.reduce((n, f) => n + (BOSS_ROUNDS[f] ?? 3) * ROUND_S + FIGHT_OVERHEAD_S, 0);

  const story = proseChars('src/story/chapter1.ts') + proseChars('src/scenes/panels.ts');
  const optional = readdirSync('src/data/maps').filter((f) => f.endsWith('.ts')).reduce((n, f) => n + proseChars(`src/data/maps/${f}`), 0);
  const readS = (story + optional * OPTIONAL_READ) / READ_CPS;

  const menuS = report.filter((r) => r.label.startsWith('CP')).length * MENU_S;
  const total = (walkS + fightS + readS + menuS) / 60;

  it('estimates Chapter 1 inside the GDD’s 45–75 minute target', () => {
    console.log(
      [
        `walking   ${(walkS / 60).toFixed(1)} min (${Math.round(routeSteps + townSteps)} tiles)`,
        `fighting  ${(fightS / 60).toFixed(1)} min (${fights.toFixed(1)} fights: ${trash.toFixed(1)} random + ${fixed.length} scripted)`,
        `reading   ${(readS / 60).toFixed(1)} min (${story} chars of story, ${optional} optional × ${OPTIONAL_READ})`,
        `menus     ${(menuS / 60).toFixed(1)} min`,
        `total     ${total.toFixed(1)} min`,
      ].join('\n'),
    );
    expect(total).toBeGreaterThanOrEqual(45);
    expect(total).toBeLessThanOrEqual(75);
  });

  it('keeps fights under half the chapter (it is a story game with battles, not a battle game)', () => {
    expect(fightS / 60 / total).toBeLessThan(0.5);
  });
});
