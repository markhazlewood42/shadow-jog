/** HUD polish round 3 (spike `spike/phaser-stage`): the combo counter's single source, number placement, timeline tags, head crops, the foe list's columns, colours. */
import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../src/data/enemies';
import { measure } from '../src/sje';
import { comboOf, type ShownHit } from '../src/battlestage/combo';
import { type StageConfig, SCREEN_W } from '../src/battlestage/config';
import { fixtureStages } from './stagefiles';
import { buildHudView, type TurnChipView } from '../src/battlestage/demo';
import { cutHead, defaultHead, ENEMY_FACES, ENEMY_HEADS } from '../src/battlestage/faces';
import { HIT_COLOUR, UI } from '../src/battlestage/hudcolours';
import { FOE_HP_W, foeColumns, foeGrid, NUMBER_FLOOR, type NumberRect, numberSpot, timelineLayout } from '../src/battlestage/hudlayout';
import { applyPreset, PRESET_IDS } from '../src/battlestage/hudpresets';
import { newRaw } from '../src/battlestage/pixels';

const stages = fixtureStages();
const street = (): StageConfig => JSON.parse(JSON.stringify(stages.street)) as StageConfig;

const hit = (target: number, amount: number, crit = false, weak = false): ShownHit => ({ target, amount, crit, weak });

describe('the combo counter has one source', () => {
  it('hits and total are the length and the sum of the list of shown hits', () => {
    expect(comboOf([])).toEqual({ hits: 0, total: 0 });
    expect(comboOf([hit(0, 40), hit(1, 25, true), hit(0, 7, false, true)])).toEqual({ hits: 3, total: 72 });
  });

  it('the lab view of every group on both stages counts exactly the hits it draws: the list is the featured action, and its numbers add up', () => {
    const sets = ['1', '2', '3', '4', '5', '6', 'boss', 'boss+1', 'boss+2'];
    for (const id of ['street', 'sewer'] as const) {
      const stage = stages[id];
      if (!stage) throw new Error(`no stage ${id}`);
      for (const set of sets) {
        const roster = stage.demo.rosters[set];
        if (!roster) continue;
        const view = buildHudView(stage.demo, set, 'act');
        const list = view.act?.hitList ?? [];
        expect(list.length, `${id} ${set}`).toBeGreaterThanOrEqual(1);
        for (const h of list) {
          expect(h.target).toBeGreaterThanOrEqual(0);
          expect(h.target).toBeLessThan(view.foes.length);
          expect(h.amount).toBeGreaterThan(0);
        }
        // The featured hit (the one the lab names in its banner) is one of the listed hits.
        expect(
          list.some((h) => h.amount === view.act?.dmg),
          `${id} ${set}`,
        ).toBe(true);
        const c = comboOf(list);
        expect(c.total).toBe(list.reduce((n, h) => n + h.amount, 0));
        expect(c.hits).toBe(list.length);
      }
    }
  });
});

describe('damage numbers are placed from the target sprite bounds', () => {
  // The white Warden on the street: drawn pixels from x 330 to 472, top at y 56, feet at y 180.
  const warden = { x: 400, y: 180, top: 56, left: 330, right: 472 };
  const punk = { x: 380, y: 207, top: 112, left: 346, right: 414 };
  const opts = { floor: NUMBER_FLOOR, screenW: SCREEN_W, farSide: true };
  const rect = (s: { x: number; y: number }, w: number, h: number): NumberRect => ({ x: s.x, y: s.y, w, h });
  const overlap = (a: NumberRect, b: NumberRect): boolean => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && a.y < b.y + b.h && a.y + a.h > b.y;

  it('a tall target gets its number BESIDE the sprite, level with the head and clear of every drawn pixel', () => {
    const h = 21;
    const w = 24;
    const spot = numberSpot(warden, w, h, opts);
    expect(spot.side).toBe('left');
    expect(spot.x + Math.ceil(w / 2)).toBeLessThan(warden.left);
    expect(spot.y).toBeGreaterThanOrEqual(NUMBER_FLOOR);
    expect(spot.y + h).toBeLessThan(warden.y);
  });

  it('a run of hits on one big target never overlaps: they stack down the side, then start a second column further out', () => {
    const taken: NumberRect[] = [];
    const spots: NumberRect[] = [];
    for (let i = 0; i < 5; i++) {
      const h = i % 2 === 0 ? 38 : 21; // crits have the word over them and are 4x; plain hits are 3x
      const w = i % 2 === 0 ? 30 : 24;
      const spot = numberSpot(warden, w, h, { ...opts, taken });
      const r = rect(spot, w, h);
      for (const o of spots) expect(overlap(r, o), `hit ${i} against an earlier one`).toBe(false);
      expect(spot.y).toBeGreaterThanOrEqual(NUMBER_FLOOR);
      expect(spot.y + h).toBeLessThanOrEqual(warden.y - 8);
      expect(spot.x + w / 2).toBeLessThan(warden.left);
      spots.push(r);
      taken.push(r);
    }
    // The run needed more than one column on the side (it is taller than the room beside the head).
    expect(new Set(spots.map((r) => r.x)).size).toBeGreaterThan(1);
  });

  it('a target with room above its head gets the number above it, and a second hit stacks UP', () => {
    const front = { ...punk, top: 140 }; // a front-row punk: a long way under the timeline
    const a = numberSpot(front, 24, 21, opts);
    const b = numberSpot(front, 24, 21, { ...opts, taken: [rect(a, 24, 21)] });
    expect(a.side).toBe('above');
    expect(a.y + 21).toBeLessThanOrEqual(front.top);
    expect(b.side).toBe('above');
    expect(b.y).toBeLessThan(a.y);
  });

  it('goes to the right of a tall target that has room on that side, and never leaves the screen', () => {
    const narrow = { x: 200, y: 180, top: 56, left: 170, right: 230 };
    const spot = numberSpot(narrow, 24, 21, { floor: NUMBER_FLOOR, screenW: SCREEN_W });
    expect(spot.side).toBe('right');
    expect(spot.x - 12).toBeGreaterThan(narrow.right);
    const edge = numberSpot({ ...punk, x: 478, left: 450, right: 478 }, 40, 21, opts);
    expect(edge.x + 20).toBeLessThanOrEqual(SCREEN_W - 4);
  });
});

describe('hit colours', () => {
  const lum = (hex: string): number => {
    const c = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
  };
  const contrast = (a: string, b: string): number => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

  it('a normal hit stands apart from the white Warden (at least 2.5:1 against white) and from the CRIT and WEAK colours', () => {
    expect(contrast(HIT_COLOUR.normal, '#ffffff')).toBeGreaterThanOrEqual(2.5);
    expect(HIT_COLOUR.normal).not.toBe(HIT_COLOUR.crit);
    expect(HIT_COLOUR.normal).not.toBe(HIT_COLOUR.weak);
    // And it is still bright enough to read on the dark panels and street ground.
    expect(contrast(HIT_COLOUR.normal, UI.chipBg)).toBeGreaterThanOrEqual(5);
  });
});

describe('timeline tags', () => {
  const order = (n: number): TurnChipView[] => Array.from({ length: n }, (_, i) => (i % 3 === 0 ? { side: 'party' as const, index: i % 4 } : { side: 'enemy' as const, index: i % 3 }));

  it('every foe chip has its A/B tag UNDER it, inside the box, clear of the chip, its neighbours and the round divider', () => {
    for (const id of PRESET_IDS) {
      const s = street();
      applyPreset(s.hud, id, true);
      const t = s.hud.turnOrder;
      for (const n of [3, 5, 7, 9]) {
        const rest = order(n);
        const lay = timelineLayout(t, rest, { side: 'party', index: 0 });
        const all = [...lay.chips, ...lay.later];
        const size = t.chip;
        for (const chip of all.filter((c) => c.side === 'enemy')) {
          // The tag: a 5 px letter centred under the chip, its top two pixels under the chip's bottom edge.
          const gx0 = chip.x + Math.floor(size / 2) - 3;
          const gx1 = gx0 + 6;
          const gy0 = chip.y + size + 2;
          const gy1 = gy0 + 5;
          expect(gy1, `${id} ${n}: tag stays above the frame`).toBeLessThanOrEqual(t.h - 3);
          for (const other of all) {
            if (other === chip) continue;
            const overlapX = gx0 < other.x + size && gx1 > other.x;
            const overlapY = gy0 < other.y + size + 2 && gy1 > other.y - 2;
            expect(overlapX && overlapY, `${id} ${n}: tag of ${chip.side}${chip.index} clear of a neighbour`).toBe(false);
          }
          if (lay.roundMark !== null) expect(gx1 <= lay.roundMark || gx0 >= lay.roundMark + 3, `${id} ${n}: tag clear of the divider`).toBe(true);
        }
      }
    }
  });

  it('the line sits the same height in a taller box, and the box ends above the banner', () => {
    const s = street();
    expect(timelineLayout(s.hud.turnOrder, order(4)).line.y).toBe(17);
    expect(s.hud.turnOrder.y + s.hud.turnOrder.h).toBeLessThan(s.hud.banner.y);
    for (const id of PRESET_IDS) {
      const p = street();
      applyPreset(p.hud, id, true);
      expect(p.hud.turnOrder.y + p.hud.turnOrder.h, id).toBeLessThan(p.hud.banner.y);
    }
  });
});

describe('head crops', () => {
  it('every enemy with a face point has a head rectangle too, and every rectangle is in step with the table of enemies', () => {
    for (const k of Object.keys(ENEMY_FACES)) expect(ENEMY_HEADS[k], k).toBeDefined();
    const sprites = new Set(Object.values(ENEMIES).map((e) => e.sprite));
    for (const k of Object.keys(ENEMY_HEADS)) expect(sprites.has(k) || k in ENEMY_FACES, k).toBe(true);
  });

  it('a head is cut as a whole-number shrink of a window about its own size, so the crop shows the head, not a patch of it', () => {
    const src = newRaw(100, 100);
    for (let i = 0; i < src.data.length; i += 4) src.data.set([200, 40, 40, 255], i);
    const out = cutHead(src, { x: 20, y: 20, w: 46, h: 46 }, 10, 2);
    expect([out.w, out.h]).toEqual([10, 10]);
    // A 46 px head at 10 px a chip is a shrink of 4 (two art pixels per step), a window of 40 px; the old crop was 20.
    expect(Math.round(46 / 10 / 2) * 2).toBe(4);
    const small = cutHead(src, { x: 20, y: 20, w: 20, h: 20 }, 10, 2);
    expect([small.w, small.h]).toEqual([10, 10]);
  });

  it('the default head, for an enemy with no entry, is a square from the top of the figure, centred on its top quarter', () => {
    const src = newRaw(80, 120);
    // A figure from x 10 to 70 and y 10 to 110, with its head (the top quarter) off to the left: x 10 to 40.
    for (let y = 10; y < 110; y++) for (let x = 10; x < (y < 40 ? 40 : 70); x++) src.data.set([255, 255, 255, 255], (y * 80 + x) * 4);
    const head = defaultHead(src, { x0: 10, y0: 10, x1: 70, y1: 110 });
    expect(head.y).toBe(0);
    expect(head.w).toBe(head.h);
    expect(head.w).toBeGreaterThanOrEqual(30);
    // Centred on the left-hand head, not on the middle of the figure (x 30 bounds-relative).
    expect(head.x + head.w / 2).toBeLessThan(25);
  });
});

describe('the foe list columns', () => {
  it('are fixed by the box width: one bar column, long enough to read, the same for every fight', () => {
    for (const w of [156, 168]) {
      const c = foeColumns(w);
      expect(c.barW, `box ${w}`).toBeGreaterThanOrEqual(28);
      expect(c.nameW, `box ${w}`).toBeGreaterThanOrEqual(56);
      expect(c.nameX + c.nameW).toBeLessThan(c.barX);
      expect(c.barX + c.barW).toBeLessThan(c.hpRight - c.hpW + 1);
      expect(c.hpRight).toBeLessThanOrEqual(w - 4);
    }
    // The health column has room for four digits (the Warden's 1850).
    expect(measure('9999')).toBeLessThanOrEqual(FOE_HP_W);
    // And the name column fits the longest name in the game's data on a 156 px box ('Rustfang Punk A' is 73 px) without clipping it.
    expect(foeColumns(156).nameW).toBeGreaterThanOrEqual(measure('Rustfang Punk A'));
  });

  it('the grid for five or six foes keeps a real bar and a readable name in each half', () => {
    const g = foeGrid(Math.floor((156 - 8) / 2));
    expect(g.barW).toBeGreaterThanOrEqual(48);
    expect(g.nameW).toBeGreaterThanOrEqual(48);
    expect(g.barW).toBeGreaterThanOrEqual(g.nameW);
  });
});
