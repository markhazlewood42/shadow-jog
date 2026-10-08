/**
 * The pop-in table (src/scenes/fieldkit/popins.ts, decision D17 of docs/PIVOT-640.md): content that
 * the wider view shows. Mark picked a fix per item at Review 3 (2026-10-08), and the table ships those
 * picks. The table is data about maps, so these tests pin its shape: the four picks, every item on a
 * real map and inside it, the camera limit of P4 (where the camera stops, and that the crew is out
 * of the entrance view), a camera limit never strands the leader off screen, and the lookups and the
 * curtain math do what they say. The Record in docs/PIVOT-640.md ("WP3") lists the items and the
 * options Mark chose from.
 */
import { describe, expect, it } from 'vitest';
import { getMap } from '../src/data/maps';
import { H, W } from '../src/engine/game';
import { TS } from '../src/field/tiles';
import { LEADER_FOCUS_LIFT, cameraOrigin } from '../src/scenes/fieldkit/camera';
import { POPINS, cameraBoxFor, curtainClosed, curtainsFor, holdFor, type Curtain, type PopinEntry } from '../src/scenes/fieldkit/popins';
import { arrivals, grid } from './mapgraph';

const ids = Object.keys(POPINS);
const item = (id: string): PopinEntry => {
  const e = POPINS[id];
  if (!e) throw new Error(`no pop-in item ${id}`);
  return e;
};

describe('the pop-in table', () => {
  it('has the four items of D17, each on a real map and inside it', () => {
    expect(ids).toEqual(['P1', 'P2', 'P3', 'P4']);
    for (const [id, e] of Object.entries(POPINS)) {
      const def = getMap(e.map);
      const mw = def.terrain[0]!.length * TS, mh = def.terrain.length * TS;
      expect(e.what.length, `${id} says what shows`).toBeGreaterThan(20);
      const f = e.fix;
      if (f.kind === 'curtain') {
        const c = f.curtain;
        expect(c.box.x >= 0 && c.box.y >= 0 && c.box.x + c.box.w <= mw && c.box.y + c.box.h <= mh, `${id} curtain box inside the map`).toBe(true);
        if (c.mode === 'near') expect(c.focus.x >= 0 && c.focus.x <= mw && c.focus.y >= 0 && c.focus.y <= mh, `${id} focus inside the map`).toBe(true);
        if (c.mode === 'event') for (const ev of c.events) expect((def.events ?? []).some((d) => d.id === ev), `${id}: event ${ev} is on ${e.map}`).toBe(true);
      }
      if (f.kind === 'hold') expect(f.pan[0] * TS < mw && f.pan[1] * TS < mh && f.frames > 0, `${id} hold`).toBe(true);
    }
  });

  it('ships Mark’s Review 3 picks: P1, P2 and P3 option b (two curtains and a hold), P4 option a (a camera limit)', () => {
    expect(Object.fromEntries(ids.map((id) => [id, item(id).fix.kind]))).toEqual({ P1: 'curtain', P2: 'curtain', P3: 'hold', P4: 'camera' });
    const p1 = item('P1').fix, p2 = item('P2').fix;
    expect(p1.kind === 'curtain' && p1.curtain.mode).toBe('near');
    expect(p2.kind === 'curtain' && p2.curtain.mode).toBe('event');
  });

  it('the lookups return what the table ships on each map, and nothing on a map it does not name', () => {
    expect(cameraBoxFor('rustyard')).toEqual({ maxY: 128 });
    expect(cameraBoxFor('annex')).toBeNull();
    expect(curtainsFor('annex')).toHaveLength(2);
    expect(curtainsFor('rustyard')).toHaveLength(0);
    expect(holdFor('annex', 30, 7)).toBe(40);
    expect(holdFor('annex', 30, 8)).toBe(0);
    expect(holdFor('rustyard', 30, 7)).toBe(0);
    expect(cameraBoxFor('lantern_row')).toBeNull();
    expect(curtainsFor('lantern_row')).toEqual([]);
  });
});

describe('a camera limit (P4)', () => {
  /** Where the plain camera would put the focus, and where the camera with the table's limit does: a hero's tile centre, the camera looking `LEADER_FOCUS_LIFT` above their feet (`FieldScene.targetCam`). */
  const focusOf = (tx: number, ty: number) => ({ fx: tx * TS + TS / 2, fy: ty * TS + TS / 2 - LEADER_FOCUS_LIFT });

  it('P4: the camera stops at the table’s south limit, 40 px past the yard’s south edge', () => {
    const g = grid('rustyard');
    const mh = g.h * TS;
    const limit = item('P4').fix;
    expect(limit.kind).toBe('camera');
    if (limit.kind !== 'camera') return;
    // The southmost walkable tile: the camera at its most southern.
    let southTile = 0;
    for (let ty = 0; ty < g.h; ty++) for (let tx = 0; tx < g.w; tx++) if (g.open(tx, ty)) southTile = ty;
    const { fx, fy } = focusOf(0, southTile);
    const plain = cameraOrigin(fx, fy, g.w * TS, mh);
    const limited = cameraOrigin(fx, fy, g.w * TS, mh, cameraBoxFor('rustyard'));
    // The plain camera stops at the yard's south edge (the view's bottom is the map's bottom).
    expect(plain.y + H).toBe(mh);
    // The limited camera stops at the table's value, and the view then reaches 40 px past the edge: the b2 surround shows there.
    expect(limited.y).toBe(limit.box.maxY);
    expect(limited.y + H - mh).toBe(40);
  });

  it('P4: Knuckles’ crew is out of the view from the lot’s entrance', () => {
    const g = grid('rustyard');
    const crew = (getMap('rustyard').npcs ?? []).filter((n) => ['knuckles', 'guard_a', 'guard_b'].includes(n.id));
    expect(crew.map((n) => n.id).sort()).toEqual(['guard_a', 'guard_b', 'knuckles']);
    const entrances = arrivals('rustyard');
    expect(entrances.length).toBeGreaterThan(0);
    for (const [tx, ty] of entrances) {
      const { fx, fy } = focusOf(tx, ty);
      const o = cameraOrigin(fx, fy, g.w * TS, g.h * TS, cameraBoxFor('rustyard'));
      // Each crew member's tile ends at or above the view's top edge.
      for (const n of crew) expect((n.y + 1) * TS, `${n.id} from the entrance (${tx},${ty})`).toBeLessThanOrEqual(o.y);
    }
  });

  for (const [id, e] of Object.entries(POPINS)) {
    if (e.fix.kind !== 'camera') continue;
    it(`${id}: the leader stays on screen from every walkable tile, with the limit in force`, () => {
      const g = grid(e.map);
      const box = cameraBoxFor(e.map);
      expect(box).not.toBeNull();
      for (let ty = 0; ty < g.h; ty++) {
        for (let tx = 0; tx < g.w; tx++) {
          if (!g.open(tx, ty)) continue;
          const { fx, fy } = focusOf(tx, ty);
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
    // No two items share a map side in the shipped table, so the merge is tested on a small table of its own.
    const limit = (map: string, box: { minX?: number; maxX?: number; minY?: number; maxY?: number }): PopinEntry => ({ map, what: 'a made-up item for the merge test', fix: { kind: 'camera', box } });
    const table = { A: limit('m', { maxY: 128, minX: -10 }), B: limit('m', { maxY: 64, minX: -40, maxX: 500 }), C: limit('other', { maxY: 9999 }) };
    expect(cameraBoxFor('m', table)).toEqual({ minX: -40, maxX: 500, maxY: 128 });
    expect(cameraBoxFor('other', table)).toEqual({ maxY: 9999 });
    expect(cameraBoxFor('none', table)).toBeNull();
  });
});

describe('a curtain or a hold (P1, P2, P3)', () => {
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

  it('P1’s curtain is shut on the Annex’s first screen and open beside the cryo wing', () => {
    const p1 = item('P1').fix;
    expect(p1.kind).toBe('curtain');
    if (p1.kind !== 'curtain') return;
    // The arrival tile (3,1), and the corridor in front of the wing.
    expect(curtainClosed(p1.curtain, { x: 3 * TS + 8, y: 1 * TS + 8 }, null)).toBe(1);
    expect(curtainClosed(p1.curtain, { x: 36 * TS, y: 6 * TS }, null)).toBe(0);
  });

  it('P2’s curtain closes for relay B and relay C only', () => {
    const p2 = item('P2').fix;
    expect(p2.kind).toBe('curtain');
    if (p2.kind !== 'curtain') return;
    expect(curtainClosed(p2.curtain, { x: 0, y: 0 }, 'relay_b')).toBe(1);
    expect(curtainClosed(p2.curtain, { x: 0, y: 0 }, 'relay_c')).toBe(1);
    expect(curtainClosed(p2.curtain, { x: 0, y: 0 }, 'relay_a')).toBe(0);
  });
});
