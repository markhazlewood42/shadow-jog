/**
 * Level connectivity: from every tile the player can arrive on, every chest, NPC, event and
 * exit of each map must be reachable once the story has opened everything up. Catches a
 * hand-authored grid that silently walls off content.
 */
import { describe, expect, it } from 'vitest';
import { getMap, mapIds } from '../src/data/maps';
import { measure } from '../src/engine/font';
import { arrivals, distances, grid } from './mapgraph';

const NEAR = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const;

describe('map connectivity', () => {
  for (const id of mapIds()) {
    it(`${id}: all content reachable from where the player arrives`, () => {
      const g = grid(id);
      const starts = arrivals(id);
      if (!starts.length) return; // the opening flat is only ever entered by the intro script
      const d = distances(g, starts);
      const reach = (x: number, y: number) => d.has(y * g.w + x);
      const nearby = (x: number, y: number) => NEAR.some(([dx, dy]) => reach(x + dx, y + dy));
      const inRect = (x: number, y: number, w: number, h: number, test: (x: number, y: number) => boolean) => {
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (test(xx, yy)) return true;
        return false;
      };
      const bad: string[] = [];
      for (const c of g.def.chests ?? []) if (!nearby(c.x, c.y)) bad.push(`chest ${c.id} (${c.x},${c.y})`);
      for (const n of g.def.npcs ?? []) if (n.talk && !nearby(n.x, n.y)) bad.push(`npc ${n.id} (${n.x},${n.y})`);
      for (const e of g.def.events ?? []) {
        const ok = inRect(e.x, e.y, e.w ?? 1, e.h ?? 1, e.on === 'touch' ? reach : nearby);
        if (!ok) bad.push(`event ${e.id} (${e.x},${e.y})`);
      }
      for (const w of g.def.warps ?? []) if (!inRect(w.x, w.y, w.w ?? 1, w.h ?? 1, nearby)) bad.push(`warp to ${w.to} (${w.x},${w.y})`);
      expect(bad).toEqual([]);
    });
  }
});

/**
 * The story's flags in the order the chapter sets them (see the header of src/story/chapter1.ts).
 * At every point along it, no map may strand the player: from wherever they can arrive, some
 * way out has to be walkable. (The all-flags test above can't see a mid-story dead end.)
 */
const STORY = ['intro', 'first_fight', 'met_dutch', 'met_hex', 'rustyard_gate', 'tribute_stash', 'knuckles', 'coprocessor', 'coprocessor_given', 'hex_joined', 'sinkline_gate', 'valve_v2', 'valve_v1', 'valve_v3', 'floodgate', 'lurker', 'annex_key', 'relay_a', 'relay_b', 'lattice_off', 'annex_panel', 'sable_joined', 'warden', 'betrayal'];

describe('no mid-story dead ends', () => {
  for (let i = 0; i <= STORY.length; i++) {
    const flags: Record<string, unknown> = Object.fromEntries(STORY.slice(0, i).map((f) => [f, true]));
    const stage = i ? `after ${STORY[i - 1]}` : 'at the start';
    it(`${stage}: from every arrival on every map, a way out is walkable`, () => {
      const stuck: string[] = [];
      for (const id of mapIds()) {
        const g = grid(id, flags);
        const exits = (g.def.warps ?? []).filter((w) => !w.when || w.when(flags));
        if (!exits.length) continue;
        for (const start of arrivals(id)) {
          if (!g.open(start[0], start[1])) continue;
          const d = distances(g, [start]);
          const reach = (x: number, y: number) => NEAR.some(([dx, dy]) => d.has((y + dy) * g.w + x + dx));
          const out = exits.some((w) => {
            for (let yy = w.y; yy < w.y + (w.h ?? 1); yy++) for (let xx = w.x; xx < w.x + (w.w ?? 1); xx++) if (reach(xx, yy)) return true;
            return false;
          });
          if (!out) stuck.push(`${id} from (${start[0]},${start[1]})`);
        }
      }
      expect(stuck).toEqual([]);
    });
  }
});

describe('text style', () => {
  it('player-facing strings use typographic apostrophes (’), never escaped straight ones', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const skip = new Set(['font.ts', 'fonttest.ts']); // glyph tables show the straight quote on purpose
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (f.endsWith('.ts') && !skip.has(f)) files.push(p);
      }
    };
    walk('src');
    const escapedQuote = /(?<!\\)\\'/;
    const bad = files.filter((p) => escapedQuote.test(readFileSync(p, 'utf8')));
    expect(bad).toEqual([]);
  });
});

describe('annex lattice', () => {
  it('each relay flips the emitters it feeds, and only a dark set opens the passage', async () => {
    const { latticeEmitters } = await import('../src/story/chapter1');
    expect(latticeEmitters({})).toEqual([true, true, true]);
    expect(latticeEmitters({ relay_a: true })).toEqual([false, false, true]);
    expect(latticeEmitters({ relay_c: true })).toEqual([true, false, false]);
    expect(latticeEmitters({ relay_b: true })).toEqual([false, false, false]);
    expect(latticeEmitters({ relay_a: true, relay_c: true })).toEqual([false, true, false]);
  });
});

describe('font coverage', () => {
  it('every character in the game’s text has a glyph (no fallback boxes on screen)', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { hasGlyph } = await import('../src/engine/font');
    const skip = new Set(['font.ts', 'fonttest.ts']);
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (f.endsWith('.ts') && !skip.has(f)) files.push(p);
      }
    };
    walk('src');
    const missing = new Map<string, string>();
    for (const p of files) {
      const src = readFileSync(p, 'utf8');
      for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'|`([^`]*)`/g)) {
        for (const ch of m[1] ?? m[2] ?? '') if (ch.charCodeAt(0) > 126 && !hasGlyph(ch) && !missing.has(ch)) missing.set(ch, p);
      }
    }
    expect([...missing].map(([ch, p]) => `${ch} (${p})`)).toEqual([]);
  });
});

describe('props', () => {
  it('every prop placed on every map has a painter (no stand-in crates in the shipped game)', async () => {
    const { getMap } = await import('../src/data/maps');
    const { PROPS } = await import('../src/field/props');
    const missing = mapIds().flatMap((id) => (getMap(id).props ?? []).filter((p) => !PROPS[p.kind]).map((p) => `${id}: ${p.kind}`));
    expect(missing).toEqual([]);
  });
});

describe('signs', () => {
  it('no two sign boards on a map overlap (their text would be clipped under the other)', () => {
    const clashes: string[] = [];
    for (const id of mapIds()) {
      const signs = (getMap(id).props ?? [])
        .filter((p) => p.kind === 'sign_post')
        .map((p) => {
          // As drawn (props.ts sign_post): a board measure(text) + 6 wide, centred on its tile.
          const w = Math.max(12, measure(p.text ?? '→') + 6);
          const x = p.x * 16 + Math.round((16 - w) / 2);
          return { text: p.text ?? '→', y: p.y, x0: x, x1: x + w, when: p.when };
        });
      for (let i = 0; i < signs.length; i++)
        for (let j = i + 1; j < signs.length; j++) {
          const a = signs[i]!, b = signs[j]!;
          if (Math.abs(a.y - b.y) > 0 || a.when || b.when) continue;
          if (a.x0 < b.x1 && b.x0 < a.x1) clashes.push(`${id}: "${a.text}" and "${b.text}"`);
        }
    }
    expect(clashes).toEqual([]);
  });
});

describe('secrets are reachable', () => {
  // The connectivity tests above ignore props; this one doesn't. Props block their footprint (as
  // field/props.ts blockFoot does by default: x..x+w-1, y..y+h-1, unless `pass`), in every story
  // state they appear in (a valve's closed and opened versions both count), and so do the other
  // chests. Each chest must have a walkable tile beside it that the player can reach from where
  // they arrive on the map. (Found by round 13: Intake 3's valve stood on the only way into the
  // Sinkline's sealed closet.)
  for (const id of mapIds()) {
    const def = getMap(id);
    if (!def.chests?.length) continue;
    it(`${id}: every chest can be reached`, () => {
      const g = grid(id);
      const blocked = new Set<number>();
      for (const p of def.props ?? []) {
        if ((p as { pass?: boolean }).pass) continue;
        for (let y = p.y; y < p.y + ((p as { h?: number }).h ?? 1); y++) for (let x = p.x; x < p.x + (p.w ?? 1); x++) blocked.add(y * g.w + x);
      }
      for (const c of def.chests ?? []) blocked.add(c.y * g.w + c.x);
      const open = (x: number, y: number) => g.open(x, y) && !blocked.has(y * g.w + x);
      const walk = { ...g, open };
      const starts = arrivals(id).filter(([x, y]) => g.open(x, y));
      if (def.entrance) starts.push([def.entrance.x, def.entrance.y]);
      const d = distances(walk, starts);
      const stuck = (def.chests ?? []).filter((c) => ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => d.has((c.y + dy!) * g.w + c.x + dx!))).map((c) => c.id);
      expect(stuck).toEqual([]);
    });
  }
});
