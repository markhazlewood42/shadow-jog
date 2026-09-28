/**
 * Level connectivity: from every tile the player can arrive on, every chest, NPC, event and
 * exit of each map must be reachable once the story has opened everything up. Catches a
 * hand-authored grid that silently walls off content.
 */
import { describe, expect, it } from 'vitest';
import { mapIds } from '../src/data/maps';
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
