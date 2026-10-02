import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { boxOf } from '../src/art/rig2/sfgeom';
import {
  PUNCH,
  PUNCH_ANCHORS,
  PUNCH_FRAME_MS,
  PUNCH_KEYS,
  PUNCH_RUN_MIN,
  buildSfPunch,
  dropStrays,
  plantOf,
  punchBeat,
  punchHits,
  punchLead,
  punchLength,
  punchTimeline,
  punchWindup,
  runFrames,
  tipOf,
} from '../src/art/rig2/sfpunch';
import { frontBoot, rightmost, soles } from '../src/art/rig2/sfstrike';
import { readPng, sheetFrames } from './png';

/**
 * Kit's punch combo from Mark's Sprite Fusion frames (spike side-battle, item H-sf-kit-punch). The timeline tests run everywhere; the anchor tests read Mark's
 * git-excluded PNGs and are skipped where they are absent (so a regenerated frame fails here, where its recorded anchors would otherwise silently go stale).
 */
const DIR = 'spritefusion-tests';
const have = existsSync(`${DIR}/kit-battle-punch2.png`) && existsSync(`${DIR}/extracted/kit-battle-idle/spritesheet.png`);

/** The frame each step starts on. */
function starts(at: number, reach: number): Record<string, number> {
  const out: Record<string, number> = {};
  let t = 0;
  for (const s of punchTimeline(at, reach)) {
    if (!(s.key in out)) out[s.key] = t;
    t += s.frames;
  }
  return out;
}

describe('the punch timeline', () => {
  it('lands the jab on the first frame of the held jab, the cross and the kick the frames after it that punchHits says', () => {
    for (const reach of [0, 8, 14, 30, 74]) {
      for (const at of [punchWindup(reach), 20, 33]) {
        const st = starts(at, reach);
        const first = Math.max(Math.round(at), punchLead(reach));
        expect(st.jab).toBe(first);
        const hits = punchHits();
        expect(hits.map((h) => h.key)).toEqual(['jab', 'cross', 'kick']);
        expect(st.cross).toBe(first + (hits[1]?.at ?? 0));
        expect(st.kick).toBe(first + (hits[2]?.at ?? 0));
        // A smear frame comes just before each blow, the blow is a contact frame, and `hit` is set on its first frame only.
        for (const [i, h] of hits.entries()) {
          const k = first + h.at;
          expect(punchBeat(k, at, reach).key).toBe(h.key);
          expect(punchBeat(k, at, reach).contact).toBe(true);
          expect(punchBeat(k, at, reach).hit).toBe(i);
          expect(punchBeat(k - 1, at, reach).contact).toBe(false);
          expect(punchBeat(k + 0.4, at, reach).hit).toBe(i);
          expect(punchBeat(k + 1, at, reach).hit).toBe(-1);
        }
      }
    }
  });

  it('is a short lead from the order to the first blow (about 100 ms near, about 300 ms with the longest run) and holds the last blow through the damage', () => {
    expect(punchLead(0) * PUNCH_FRAME_MS).toBeLessThan(110);
    expect(punchLead(200) * PUNCH_FRAME_MS).toBeLessThan(320);
    expect(PUNCH_FRAME_MS).toBeCloseTo(25.6, 0);
    const tl = punchTimeline(punchWindup(10), 10);
    expect(tl.find((s) => s.key === 'kick')?.frames).toBeGreaterThanOrEqual(12);
    expect(punchLength(20, 10)).toBe(punchTimeline(20, 10).reduce((n, s) => n + s.frames, 0));
    expect(punchTimeline(20, 10).at(-1)?.key).toBe('ready');
    // Extra time (a timing ring) is spent in the breathing guard, never in a held load or a held blow.
    expect(punchTimeline(40, 10)[0]?.frames).toBeGreaterThan(punchTimeline(20, 10)[0]?.frames ?? 99);
    for (const k of ['load', 'jab', 'cross'] as const) expect(punchTimeline(40, 10).find((s) => s.key === k)?.frames).toBe(punchTimeline(20, 10).find((s) => s.key === k)?.frames);
  });

  it('runs in only for a far target, longer for a farther one', () => {
    expect(runFrames(PUNCH_RUN_MIN)).toBe(0);
    expect(runFrames(PUNCH_RUN_MIN + 1)).toBeGreaterThanOrEqual(3);
    expect(runFrames(74)).toBeLessThanOrEqual(8);
    expect(runFrames(74)).toBeGreaterThan(runFrames(20));
    expect(punchTimeline(20, 8).some((s) => s.key === 'run')).toBe(false);
    expect(punchTimeline(20, 48).some((s) => s.key === 'run')).toBe(true);
  });

  it('carries the body to the target and home with no frame skipping far, starting and ending in its place', () => {
    for (const reach of [8, 48, 74]) {
      const at = punchWindup(reach);
      const n = punchLength(at, reach);
      expect(punchBeat(0, at, reach).lunge).toBe(0);
      expect(punchBeat(n - 1, at, reach).lunge).toBe(0);
      let prev = 0;
      for (let k = 0; k < n; k++) {
        const l = punchBeat(k, at, reach).lunge;
        // One pose frame never carries her more than 20 world px (a run covers .86 of the way over at least 3 frames; a near target is a step of a few px).
        expect(Math.abs(l - prev) * reach).toBeLessThanOrEqual(20);
        prev = l;
        expect(l).toBeGreaterThanOrEqual(0);
        expect(l).toBeLessThanOrEqual(1);
      }
      // She is at the target (.9 or more) for every blow.
      for (const h of punchHits()) expect(punchBeat(Math.max(at, punchLead(reach)) + h.at, at, reach).lunge).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('smears the frames just before the blows (a ghost trails them) and keeps the load for the guard after the kick', () => {
    const at = punchWindup(10);
    const st = starts(at, 10);
    expect(punchBeat(st.jabS ?? 0, at, 10).dash).toBe(true);
    expect(punchBeat(st.jab ?? 0, at, 10).dash).toBe(false);
    expect(punchTimeline(at, 10).filter((s) => s.key === 'load')).toHaveLength(2);
    expect(PUNCH.hold).toBeGreaterThanOrEqual(12);
  });
});

describe.skipIf(!have)("anchors on Mark's frames", () => {
  const empty = { w: 0, h: 0, px: new Uint8ClampedArray(0) };
  const still = (n: string) => (have ? readPng(`${DIR}/${n}.png`) : empty);
  const load = still('kit-battle-punch1');
  const jab = still('kit-battle-punch2');
  const cross = still('kit-battle-punch3');
  const kick = dropStrays(still('kit-battle-kick'));
  const run = still('kit-battle-running');
  const idle = have ? sheetFrames(DIR, 'kit-battle-idle') : [];

  it('re-measures to the recorded data (a regenerated frame must be re-measured)', () => {
    const A = PUNCH_ANCHORS;
    expect(frontBoot(load)).toBe(A.load.frontBoot);
    expect(soles(load)).toBe(A.load.soles);
    expect(frontBoot(jab)).toBe(A.jab.frontBoot);
    expect(soles(jab)).toBe(A.jab.soles);
    expect(tipOf(jab)).toEqual([...A.jab.tip]);
    expect(frontBoot(cross)).toBe(A.cross.frontBoot);
    expect(soles(cross)).toBe(A.cross.soles);
    expect(tipOf(cross)).toEqual([...A.cross.tip]);
    expect(plantOf(kick)).toBe(A.kick.plant);
    expect(soles(kick)).toBe(A.kick.soles);
    expect(tipOf(kick)).toEqual([...A.kick.tip]);
    expect(soles(run)).toBe(A.run.soles);
    const fb = idle.reduce((n, r) => n + frontBoot(r), 0) / idle.length;
    expect(Math.abs(fb - A.idle.frontBoot)).toBeLessThan(0.3);
    for (const r of idle) expect(soles(r)).toBe(A.idle.soles);
    // The jab's and the cross's fists are the same distance past the planted foot (so one reach serves both blows).
    expect(A.jab.tip[0] - A.jab.frontBoot).toBe(A.cross.tip[0] - A.cross.frontBoot);
    // Mark's kick has one magenta pixel at the hair; dropStrays takes only that.
    const count = (r: typeof kick): number => r.px.reduce((n, v, i) => (i % 4 === 3 && v > 0 ? n + 1 : n), 0);
    expect(count(still('kit-battle-kick')) - count(kick)).toBe(1);
    expect(count(still('kit-battle-punch2')) - count(dropStrays(still('kit-battle-punch2')))).toBe(0);
  });

  it('puts every frame on one canvas with the soles on the bottom row, the planted boot on the idle column and all three blows on one column', () => {
    const b = buildSfPunch(idle, run, load, jab, cross, kick);
    const first = b.frames.ready;
    for (const k of PUNCH_KEYS) {
      const f = b.frames[k];
      expect([f.w, f.h]).toEqual([first.w, first.h]);
      expect(boxOf(f).y1).toBe(f.h - 1);
    }
    const col = (k: (typeof PUNCH_KEYS)[number]): number => frontBoot(b.frames[k]);
    // The planted foot does not slide through the combo (the idle's own boots are measured on its own loop, so within a pixel).
    expect(col('jab')).toBe(col('jabS'));
    expect(Math.abs(col('jab') - col('ready'))).toBeLessThanOrEqual(1);
    expect(Math.abs(col('cross') - col('ready'))).toBeLessThanOrEqual(1);
    expect(Math.abs(col('load') - col('ready'))).toBeLessThanOrEqual(1);
    // All three blows end on the measured column: the fist of the jab and of the cross (a pixel apart, as drawn) and the kick's toe.
    const tip = (k: 'jab' | 'cross' | 'kick'): number => rightmost(b.frames[k])[0] + 1 - b.axis;
    expect(tip('jab')).toBe(b.measured.tipDx);
    expect(Math.abs(tip('cross') - tip('jab'))).toBeLessThanOrEqual(1);
    expect(tip('kick')).toBe(tip('jab'));
    expect(b.measured.tipDx).toBeGreaterThan(b.measured.footDx);
    expect(b.measured.up.kick).toBeGreaterThan(b.measured.up.jab);
    expect(b.axis * 2).toBe(first.w);
    // The smear frames carry the same body plus the streak or the crescent.
    const opaque = (r: typeof first): number => r.px.reduce((n, v, i) => (i % 4 === 3 && v > 0 ? n + 1 : n), 0);
    expect(opaque(b.frames.jabS)).toBeGreaterThan(opaque(b.frames.jab) - 40);
    expect(opaque(b.frames.kickS)).toBeGreaterThan(opaque(b.frames.kick));
    // No smear reaches above the kick's own top (the name plate stays clear): the canvas is no taller than the kick (64 rows).
    expect(b.topRows).toBeLessThanOrEqual(64);
  });
});
