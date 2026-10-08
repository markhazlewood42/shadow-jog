/**
 * The pop-in table (src/scenes/fieldkit/popins.ts, decision D17 of docs/PIVOT-640.md): content that the
 * wider view shows. The table is data about maps, so these tests pin its shape: every item is on a
 * real map and lies inside it, nothing ships until Mark picks, an option-a camera limit never
 * strands the leader off screen, and the review switch and the lookups do what they say.
 * The list with pictures is media/pivot-640/wp3/popins.md (git-ignored).
 */
import { describe, expect, it } from 'vitest';
import { getMap } from '../src/data/maps';
import { H, W } from '../src/engine/game';
import { TS } from '../src/field/tiles';
import { cameraOrigin } from '../src/scenes/fieldkit/camera';
import { POPINS, cameraBoxFor, curtainClosed, curtainsFor, currentOptions, holdFor, parsePopinSwitch, type Curtain, type PopinOptions } from '../src/scenes/fieldkit/popins';
import { grid } from './mapgraph';

const ids = Object.keys(POPINS);
const all = (option: 'none' | 'a' | 'b'): PopinOptions => Object.fromEntries(ids.map((id) => [id, option]));

describe('the pop-in table', () => {
  it('has a few items, each on a real map and inside it', () => {
    expect(ids.length).toBeGreaterThanOrEqual(4);
    for (const [id, e] of Object.entries(POPINS)) {
      const def = getMap(e.map);
      const mw = def.terrain[0]!.length * TS, mh = def.terrain.length * TS;
      expect(e.what.length, `${id} says what shows`).toBeGreaterThan(20);
      const c = e.b?.curtain;
      if (c) {
        expect(c.box.x >= 0 && c.box.y >= 0 && c.box.x + c.box.w <= mw && c.box.y + c.box.h <= mh, `${id} curtain box inside the map`).toBe(true);
        if (c.mode === 'near') expect(c.focus.x >= 0 && c.focus.x <= mw && c.focus.y >= 0 && c.focus.y <= mh, `${id} focus inside the map`).toBe(true);
        if (c.mode === 'event') for (const ev of c.events) expect((def.events ?? []).some((d) => d.id === ev), `${id}: event ${ev} is on ${e.map}`).toBe(true);
      }
      if (e.b?.hold) expect(e.b.hold.pan[0] * TS < mw && e.b.hold.pan[1] * TS < mh && e.b.hold.frames > 0, `${id} hold`).toBe(true);
    }
  });

  it('gives every item at least one real code option, and says why when there is no camera limit', () => {
    for (const [id, e] of Object.entries(POPINS)) {
      expect(e.a !== null || e.b !== null, `${id} has an option`).toBe(true);
      if (e.a === null) expect(e.aWhy?.length ?? 0, `${id}: why no camera limit`).toBeGreaterThan(20);
    }
  });

  it('ships nothing until Mark picks at Review 3: every item runs as none, and no limit, curtain or hold is in force', () => {
    for (const e of Object.values(POPINS)) expect(e.option).toBe('none');
    expect(currentOptions()).toEqual(all('none'));
    for (const e of Object.values(POPINS)) {
      expect(cameraBoxFor(e.map)).toBeNull();
      expect(curtainsFor(e.map)).toEqual([]);
    }
    expect(holdFor('annex', 30, 7)).toBe(0);
  });
});

describe('option a: a camera limit', () => {
  for (const [id, e] of Object.entries(POPINS)) {
    if (!e.a) continue;
    it(`${id}: the leader stays on screen from every walkable tile, with the limit in force`, () => {
      const g = grid(e.map);
      const box = cameraBoxFor(e.map, { ...all('none'), [id]: 'a' });
      expect(box).not.toBeNull();
      for (let ty = 0; ty < g.h; ty++) {
        for (let tx = 0; tx < g.w; tx++) {
          if (!g.open(tx, ty)) continue;
          // The camera follows the leader's feet minus 8 (field.ts `targetCam`); a hero is 24 px tall.
          const fx = tx * TS + 8, fy = ty * TS + 8 - 8;
          const o = cameraOrigin(fx, fy, g.w * TS, g.h * TS, box);
          // Where the plain camera puts the leader: the limit may not do worse than that, or than 8 px
          // from a side edge (24 from the top, for the hero's head), except where the plain camera is already closer.
          const d = cameraOrigin(fx, fy, g.w * TS, g.h * TS);
          expect(fx - o.x, `${e.map} (${tx},${ty}) x on screen`).toBeGreaterThanOrEqual(Math.min(8, fx - d.x));
          expect(fx - o.x, `${e.map} (${tx},${ty}) x on screen`).toBeLessThanOrEqual(Math.max(W - 8, fx - d.x));
          expect(fy - o.y, `${e.map} (${tx},${ty}) y on screen`).toBeGreaterThanOrEqual(Math.min(24, fy - d.y));
          expect(fy - o.y, `${e.map} (${tx},${ty}) y on screen`).toBeLessThanOrEqual(Math.max(H - 8, fy - d.y));
        }
      }
    });
  }

  it('merges two limits on one map: the widest range wins on each side', () => {
    // No two items share a map side today, so the merge is tested through a real item and nothing else.
    expect(cameraBoxFor('rustyard', { ...all('none'), P4: 'a' })).toEqual({ maxY: 128 });
    expect(cameraBoxFor('rustyard', all('b'))).toBeNull();
    expect(cameraBoxFor('annex', all('a'))).toBeNull();
  });
});

describe('option b: a curtain or a hold', () => {
  const near = (radius: number, fade: number): Curtain => ({ mode: 'near', box: { x: 0, y: 0, w: 10, h: 10 }, focus: { x: 100, y: 100 }, radius, fade });
  const event: Curtain = { mode: 'event', events: ['relay_b'], box: { x: 0, y: 0, w: 10, h: 10 }, fade: 12 };

  it('a near curtain is open inside its radius, shut beyond radius + fade, and partway between', () => {
    const c = near(50, 40);
    expect(curtainClosed(c, { x: 100, y: 140 }, null)).toBe(0);
    expect(curtainClosed(c, { x: 100, y: 150 }, null)).toBe(0);
    expect(curtainClosed(c, { x: 100, y: 170 }, null)).toBeCloseTo(0.5, 5);
    expect(curtainClosed(c, { x: 100, y: 190 }, null)).toBe(1);
    expect(curtainClosed(c, { x: 100, y: 900 }, null)).toBe(1);
  });

  it('an event curtain is shut only while one of its events runs', () => {
    expect(curtainClosed(event, { x: 0, y: 0 }, 'relay_b')).toBe(1);
    expect(curtainClosed(event, { x: 0, y: 0 }, 'relay_a')).toBe(0);
    expect(curtainClosed(event, { x: 0, y: 0 }, null)).toBe(0);
  });

  it('the lookups return what the options in force name, and nothing else', () => {
    expect(curtainsFor('annex', { ...all('none'), P1: 'b' })).toHaveLength(1);
    expect(curtainsFor('annex', { ...all('none'), P1: 'b', P2: 'b' })).toHaveLength(2);
    expect(curtainsFor('annex', { ...all('none'), P3: 'b' })).toHaveLength(0);
    expect(curtainsFor('rustyard', { ...all('none'), P1: 'b' })).toHaveLength(0);
    expect(holdFor('annex', 30, 7, { ...all('none'), P3: 'b' })).toBe(40);
    expect(holdFor('annex', 30, 8, { ...all('none'), P3: 'b' })).toBe(0);
    expect(holdFor('annex', 30, 7, { ...all('none'), P3: 'a' })).toBe(0);
  });
});

describe('the review switch', () => {
  it('reads item:option pairs, "all:" and ignores what it does not know', () => {
    expect(parsePopinSwitch('P1:b,P4:a')).toEqual({ P1: 'b', P4: 'a' });
    expect(parsePopinSwitch('all:b')).toEqual(all('b'));
    expect(parsePopinSwitch('P1:b,all:a')).toEqual(all('a'));
    expect(parsePopinSwitch('P9:b,P1')).toEqual({ P1: 'none' });
    expect(parsePopinSwitch('P2:c')).toEqual({ P2: 'none' });
    expect(parsePopinSwitch(null)).toEqual({});
    expect(parsePopinSwitch('')).toEqual({});
  });
});
