/**
 * Level connectivity: from every tile the player can arrive on, every chest, NPC, event and
 * exit of each map must be reachable once the story has opened everything up. Catches a
 * hand-authored grid that silently walls off content.
 */
import { describe, expect, it } from 'vitest';
import { getMap, mapIds } from '../src/data/maps';
import { measure } from '../src/engine/font';
import { H, W } from '../src/engine/game';
import { TS } from '../src/field/tiles';
import { SURROUND, surroundFor, voidShows, type SurroundEntry, type SurroundTheme, type SurroundView } from '../src/scenes/fieldkit/surround';
import { rgb } from '../src/engine/color';
import { THEMES, YARD, pictureKey } from '../src/scenes/fieldkit/surround-art';
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
        // src/dev holds dev-only tools (the FX lab) whose panel text is HTML in the browser's font.
        if (statSync(p).isDirectory()) {
          if (f !== 'dev') walk(p);
        } else if (f.endsWith('.ts') && !skip.has(f)) files.push(p);
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

describe('maps smaller than the view (D7, docs/PIVOT-640.md)', () => {
  // At 640x360 the camera shows 1.78 times the old area, so a map below the screen in either
  // direction is centered, and something must fill the margin (src/scenes/fieldkit/surround.ts).
  // This list is pinned, so a size change is deliberate: a map that grows past the screen leaves
  // the list and the surround table together, and a new small map must get a surround entry.
  // Sizes are in pixels (width, height).
  const SMALL: Record<string, [number, number]> = {
    rustyard: [544, 448],
    dock: [320, 224],
    rook_flat: [224, 160],
    bar: [352, 224],
    clinic: [224, 160],
    armory: [224, 160],
    threads: [224, 160],
    kwikmart: [224, 160],
    hotel: [256, 160],
    noodles: [224, 160],
    hex_den: [224, 176],
  };
  const sizeOf = (id: string): [number, number] => {
    const g = grid(id);
    return [g.w * TS, g.h * TS];
  };
  const smaller = (): string[] => mapIds().filter((id) => { const [w, h] = sizeOf(id); return w < W || h < H; });

  // Mark's rule (Review 3, 2026-10-08, "indoor areas blank fill (b1), outdoor areas themed (b2)"),
  // by the kind of map. A kind that is not here has no rule yet, and the test below fails for it
  // until someone chooses on purpose; there is no default.
  const RULE: Readonly<Record<string, 'b1' | 'b2'>> = { interior: 'b1', town: 'b2' };
  // The theme of each outdoor map's b2 surround, pinned the same way: a new outdoor map must pick one.
  const THEME_OF: Readonly<Record<string, SurroundTheme>> = { rustyard: 'yard', dock: 'dock' };

  it('the maps below the view are exactly the pinned list, at their pinned sizes', () => {
    expect(smaller().sort()).toEqual(Object.keys(SMALL).sort());
    for (const [id, size] of Object.entries(SMALL)) expect(sizeOf(id), id).toEqual(size);
  });

  it('every one of them has a surround entry, and the table holds no other map', () => {
    expect(Object.keys(SURROUND).sort()).toEqual(smaller().sort());
    for (const id of smaller()) expect(['b1', 'b2'], `${id} option`).toContain(SURROUND[id]?.option);
  });

  it('follows Mark’s rule: an indoor map gets the edge fill (b1), an outdoor map a themed surround (b2)', () => {
    for (const id of smaller()) {
      const kind = getMap(id).kind;
      const want = RULE[kind];
      expect(want, `${id} is a ${kind} map and Mark’s rule covers only ${Object.keys(RULE).join(' and ')}: ask him which surround it gets, then add the kind to RULE`).toBeDefined();
      expect(SURROUND[id]?.option, `${id} (${kind})`).toBe(want);
    }
  });

  it('a themed (b2) map names the theme that fits its place, and an edge-fill (b1) map names none', () => {
    for (const id of smaller()) {
      const e = SURROUND[id];
      if (e?.option === 'b2') {
        expect(THEME_OF[id], `${id} is a b2 map: pin its theme in THEME_OF`).toBeDefined();
        expect(e.theme, id).toBe(THEME_OF[id]);
      } else {
        expect(e && 'theme' in e, `${id}: b1 has no theme`).toBe(false);
      }
    }
  });

  it('every theme has its painter, and only the dock’s water moves', () => {
    expect(Object.keys(THEMES).sort()).toEqual(['dock', 'yard']);
    expect(typeof THEMES.dock.animate).toBe('function');
    expect(THEMES.yard.animate).toBeUndefined();
    // The compiler enforces a closed set of themes: a theme that does not exist is a type error,
    // so it can never fall back to another theme's art (`npm run check` runs tsc over the tests).
    // @ts-expect-error 'brick' is not a SurroundTheme
    const unknown: SurroundEntry = { option: 'b2', theme: 'brick' };
    // @ts-expect-error 'brick' has no entry in THEMES
    const painter = THEMES.brick;
    expect(unknown.option).toBe('b2');
    expect(painter).toBeUndefined();
  });

  it('a map with no entry (a big map) has no surround', () => {
    expect(surroundFor('lantern_row')).toBeNull();
    expect(surroundFor('world')).toBeNull();
  });

  describe('the painted picture is kept while only the shake changes', () => {
    const view = (over: Partial<SurroundView> = {}): SurroundView => ({
      id: 'dock', ground: {} as HTMLCanvasElement, mw: 320, mh: 224, cx: -160, cy: -68, camX: -160, camY: -68, frame: 0, ...over,
    });
    const entry: SurroundEntry = { option: 'b2', theme: 'dock' };
    const key = (v: SurroundView, e: SurroundEntry = entry) => pictureKey(v, e, '#000');

    it('the shake (the drawn camera moving while the camera at rest stays) does not change the key', () => {
      expect(key(view({ cx: -157, cy: -70 }))).toBe(key(view()));
      expect(key(view({ cx: -166, cy: -61, frame: 400 }))).toBe(key(view()));
    });

    it('a different map, theme, option, size, void color or resting camera does', () => {
      const base = key(view());
      expect(key(view({ id: 'rustyard' }))).not.toBe(base);
      expect(key(view(), { option: 'b2', theme: 'yard' })).not.toBe(base);
      expect(key(view(), { option: 'b1' })).not.toBe(base);
      expect(key(view({ mw: 352 }))).not.toBe(base);
      expect(pictureKey(view(), entry, '#fff')).not.toBe(base);
      // The Rustyard scrolls, so its picture follows the camera at rest.
      expect(key(view({ camY: -60 }))).not.toBe(base);
      expect(key(view({ camX: -150 }))).not.toBe(base);
    });
  });
});

describe('the void fill under a map that fills the screen (D15, docs/PIVOT-640.md)', () => {
  // The first D15 step skips the full-screen void fill while the map covers the screen. The ground
  // layer is opaque everywhere (the four-corner walk in e2e/economy.spec.ts checks that), so the fill
  // matters only where the view reaches past the map: at a clamped edge under a screen shake.
  it('is needed only when the view reaches past the map on some side, shake included', () => {
    expect(voidShows(0, 0, W, H)).toBe(false);
    expect(voidShows(0, 0, W + 100, H + 100)).toBe(false);
    expect(voidShows(100, 100, W + 100, H + 100)).toBe(false);
    // One pixel of shake past each edge of a map that fills the screen exactly.
    expect(voidShows(-1, 0, W, H)).toBe(true);
    expect(voidShows(0, -1, W, H)).toBe(true);
    expect(voidShows(1, 0, W, H)).toBe(true);
    expect(voidShows(0, 1, W, H)).toBe(true);
    // A map narrower than the view (the Rustyard): the margin is there at rest.
    expect(voidShows(-48, 0, W - 96, H + 88)).toBe(true);
  });
});

describe('the Rustyard surround reads as yard, not as a void (WP3 round 3)', () => {
  // The surround is drawn before the field's light multiplies the screen, so what the player sees is
  // each channel times the map's ambient. The strip below the yard measured about 4 of 255 in round 2
  // (luma, in the shot at the entrance) and read as black: Mark asked for it to be lifted to about the
  // yard's own shadowed ground (about 28 to 31). It measures about 25 now. The floor of 18 leaves room
  // to tune the art and still fails when the gravel goes back to a void color (the old gravel was 4).
  const ambient = rgb(getMap('rustyard').ambient);
  /** The brightness of a surround color on screen: its channels times the ambient, as Rec. 709 luma. */
  const lit = (hex: string): number => {
    const [r, g, b] = rgb(hex).map((c, i) => (c * ambient[i]!) / 255) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const FLOOR = 18;

  it('the gravel is lit well above the void', () => {
    expect(lit(YARD.gravelGround)).toBeGreaterThanOrEqual(FLOOR);
    for (const speck of YARD.gravelSpecks) expect(lit(speck)).toBeGreaterThanOrEqual(FLOOR);
  });

  it('the fence reads at the same level: its ribs on average, and no part (a post, a heap) near the void', () => {
    const ribs = YARD.fenceRibs.reduce((sum, c) => sum + lit(c), 0) / YARD.fenceRibs.length;
    expect(ribs).toBeGreaterThanOrEqual(FLOOR);
    // The posts and the heaps are the darkest accents of the surround, so they get half the floor.
    for (const c of [...YARD.fenceRibs, YARD.postBody, YARD.heapBody]) expect(lit(c)).toBeGreaterThanOrEqual(FLOOR / 2);
  });

  it('the fade does not black out the strip (its far alpha stays under a half)', () => {
    expect(YARD.fadeFar).toBeLessThanOrEqual(0.5);
  });
});
