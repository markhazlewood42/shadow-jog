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
/**
 * One battle round: giving four orders, then watching them play out. Re-estimated for the slower
 * pace of 2026-09-29 (animations at 0.65x, each action's effect let finish, a 22-frame beat after
 * it): about 1.6 s an action over about 5.5 actions, plus some 6 s of orders. Was 11.
 */
const ROUND_S = 15;
/** Per fight: the transition (now about 1.2 s), intro, victory fanfare and rewards. */
const FIGHT_OVERHEAD_S = 9.5;
/** Trash fights: mean rounds from the balance sim (docs/quality/evidence/unit-tests.txt). */
const TRASH_ROUNDS = 2.3;
/** Scripted fights: sim mean rounds (after the 2026-09-29 retune). */
const BOSS_ROUNDS: Record<string, number> = { f_first_fight: 2.0, f_rustyard_gate: 2.4, f_knuckles: 9.1, f_lurker: 8.9, f_annex_door: 3.2, f_warden: 12.1 };
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

/**
 * Characters of prose in a source file: string literals long enough to be a line of dialogue. `rest` is for a file whose dialogue has moved to a data
 * file (chapter 1, M8a): its comments are dropped and only single-quoted strings count (what is left is the tutorial cards and the objectives), because
 * a comment with an apostrophe, or a template literal in code, would otherwise pair with a quote far away and count code as prose.
 */
function proseChars(path: string, rest = false): number {
  const raw = readFileSync(path, 'utf8');
  const src = rest ? raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/ \/\/ .*$/gm, '') : raw;
  let n = 0;
  const pattern = rest ? /'((?:[^'\\\n]|\\.){12,})'/g : /'((?:[^'\\\n]|\\.){12,})'|`([^`]{12,})`/g;
  for (const m of src.matchAll(pattern)) {
    const text = (m[1] ?? m[2] ?? '').replace(/\{[a-z/#0-9]*\}/g, '').replace(/\$\{[^}]*\}/g, '');
    if (text.includes(' ')) n += text.length;
  }
  return n;
}

/**
 * Characters of prose in a map data file (M5): every string value of the JSON that is a line of text, counted as `proseChars` counts a literal.
 * The maps moved from TypeScript to JSON plus a behavior module, so the lines of the NPCs that only talk are in the JSON now.
 */
function proseCharsJson(path: string): number {
  let n = 0;
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (v.length >= 12 && v.includes(' ')) n += v.replace(/\{[a-z/#0-9]*\}/g, '').length;
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(JSON.parse(readFileSync(path, 'utf8')));
  return n;
}

/**
 * Characters of prose in the chapter 1 dialogue file (M8a): the text of every box, counted as `proseChars` counts a literal (the text codes and the
 * slots do not count: before the move a live value was `${...}`, which `proseChars` also dropped). The story's words moved here from `story/chapter1.ts`.
 */
function proseCharsDialogue(): number {
  const lines = (JSON.parse(readFileSync('src/data/dialogue.json', 'utf8')) as { lines: Record<string, { text: string; choices?: string[] }> }).lines;
  let n = 0;
  for (const l of Object.values(lines)) {
    for (const t of [l.text, ...(l.choices ?? [])]) {
      const text = t.replace(/\{[a-z/#0-9]*\}/g, '').replace(/\{[a-z_]+\}/g, '');
      if (text.length >= 12 && text.includes(' ')) n += text.length;
    }
  }
  return n;
}

/** The map files with prose in them: the maps' TypeScript (not the data loader, whose strings are error messages) and their JSON. */
function mapProse(): number {
  return readdirSync('src/data/maps')
    .filter((f) => f !== 'mapdata.ts')
    .reduce((n, f) => (f.endsWith('.ts') ? n + proseChars(`src/data/maps/${f}`) : f.endsWith('.json') ? n + proseCharsJson(`src/data/maps/${f}`) : n), 0);
}

describe('pacing', () => {
  const report = runEconomy(ROUTE, 150, { kit: 1, rook: 10 });
  const fights = report[report.length - 1]!.battles + 1; // + the Warden itself

  const routeSteps = ROUTE.reduce((n, leg) => n + (leg.walk ?? []).reduce((m, [, s]) => m + s, 0), 0);
  const townSteps = TOWN_WALKS.reduce((n, [map, pts]) => n + pathSteps(map, pts), 0) * EXPLORE + INTERIOR_VISITS * INTERIOR_STEPS;
  const walkS = (routeSteps + townSteps) * TILE_S;

  const fixed = ROUTE.flatMap((l) => l.fixed ?? []).concat('f_warden');
  const trash = fights - fixed.length;
  const fightS = trash * (TRASH_ROUNDS * ROUND_S + FIGHT_OVERHEAD_S) + fixed.reduce((n, f) => n + (BOSS_ROUNDS[f] ?? 3) * ROUND_S + FIGHT_OVERHEAD_S, 0);

  // The panels file counts as `rest` too (M8b phase 3): the native scene's comments name kit classes in backticks, which would pair across lines and count code as prose.
  const story = proseChars('src/story/chapter1.ts', true) + proseCharsDialogue() + proseChars('src/scenes/panels.ts', true);
  const optional = mapProse();
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
