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
