import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { boxOf } from '../src/art/rig2/sfgeom';
import {
  PUNCH,
  PUNCH_ANCHORS,
  PUNCH_FRAME_MS,
  PUNCH_KEYS,
  PUNCH_KICK_SHIFT,
  despeckle,
  PUNCH_KICK_SHORT,
  PUNCH_MEASURED,
  PUNCH_RUN_MIN,
  PUNCH_SQUASH,
  PUNCH_BEND,
  PUNCH_LEG,
  buildSfPunch,
  dropStrays,
  plantOf,
  poseLeg,
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
function starts(at: number, reach: number, low = false): Record<string, number> {
  const out: Record<string, number> = {};
  let t = 0;
  for (const s of punchTimeline(at, reach, low)) {
    if (!(s.key in out)) out[s.key] = t;
    t += s.frames;
  }
  return out;
}
/** The key sequence, one entry per step. */
const keys = (at: number, reach: number, low = false): string[] => punchTimeline(at, reach, low).map((s) => s.key);

describe('the punch timeline', () => {
  it('lands the jab, the cross and the kick on the first frame of their trail frames, the frames after the first blow that punchHits says', () => {
    for (const reach of [0, 8, 14, 30, 74]) {
      for (const at of [punchWindup(reach), 20, 33]) {
        const st = starts(at, reach);
        const first = Math.max(Math.round(at), punchLead(reach));
        const hits = punchHits();
        expect(hits.map((h) => h.key)).toEqual(['jab', 'cross', 'kick']);
        expect(st.jabT).toBe(first);
        expect(st.crossT).toBe(first + (hits[1]?.at ?? 0));
        expect(st.kickT).toBe(first + (hits[2]?.at ?? 0));
        // A smear comes just before each blow, the blow is a contact frame, and `hit` is set on its first frame only.
        const trail = ['jabT', 'crossT', 'kickT'];
        for (const [i, h] of hits.entries()) {
          const k = first + h.at;
          expect(punchBeat(k, at, reach).key).toBe(trail[i]);
          expect(punchBeat(k, at, reach).contact).toBe(true);
          expect(punchBeat(k, at, reach).hit).toBe(i);
          expect(punchBeat(k - 1, at, reach).contact).toBe(false);
          expect(punchBeat(k + 0.4, at, reach).hit).toBe(i);
          expect(punchBeat(k + 1, at, reach).hit).toBe(-1);
          expect(punchBeat(k + 1, at, reach).contact).toBe(true);
        }
      }
    }
  });

  it('is a short lead from the order to the first blow (about 100 ms near, about 300 ms with the longest run) and holds the last blow through the damage', () => {
    expect(punchLead(0) * PUNCH_FRAME_MS).toBeLessThan(110);
    expect(punchLead(200) * PUNCH_FRAME_MS).toBeLessThan(320);
    expect(PUNCH_FRAME_MS).toBeCloseTo(25.6, 0);
    const tl = punchTimeline(punchWindup(10), 10);
    expect(tl.find((s) => s.key === 'kick')?.frames).toBeGreaterThanOrEqual(10);
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

  it('carries the body to the target and home with no frame skipping far, starting and ending in its place, and shoves it forward a little on each blow', () => {
    for (const reach of [8, 48, 74]) {
      const at = punchWindup(reach);
      const n = punchLength(at, reach);
      expect(punchBeat(0, at, reach).lunge).toBe(0);
      expect(punchBeat(n - 1, at, reach).lunge).toBe(0);
      expect(punchBeat(n - 1, at, reach).push).toBe(0);
      let prev = 0;
      let prevPush = 0;
      for (let k = 0; k < n; k++) {
        const b = punchBeat(k, at, reach);
        // One pose frame never carries her more than 20 world px (a run covers .86 of the way over at least 3 frames; a near target is a step of a few px) and the shove is under 2 px a frame.
        expect(Math.abs(b.lunge - prev) * reach).toBeLessThanOrEqual(20);
        expect(Math.abs(b.push - prevPush)).toBeLessThanOrEqual(2);
        prev = b.lunge;
        prevPush = b.push;
        expect(b.lunge).toBeGreaterThanOrEqual(0);
        expect(b.lunge).toBeLessThanOrEqual(1);
      }
      // She is at the target (.9 or more) for every blow, and the shove grows jab < cross < kick.
      const first = Math.max(at, punchLead(reach));
      const pushes = punchHits().map((h) => punchBeat(first + h.at + 1, at, reach).push);
      for (const h of punchHits()) expect(punchBeat(first + h.at, at, reach).lunge).toBeGreaterThanOrEqual(0.9);
      expect(pushes[0]).toBeGreaterThan(0);
      expect(pushes[1]).toBeGreaterThan(pushes[0] ?? 0);
      expect(pushes[2]).toBeGreaterThan(pushes[1] ?? 0);
    }
  });

  it('smears each blow for two frames and lets a trail linger on its first (the streak is on screen 3 pose frames, about 77 ms, not 1), with the arm coming back between the blows and a chamber and a settle round the kick', () => {
    const at = punchWindup(10);
    const tl = punchTimeline(at, 10);
    const s = (k: string): number => tl.find((x) => x.key === k)?.frames ?? 0;
    expect(s('jabS') + s('jabT')).toBeGreaterThanOrEqual(3);
    expect(s('crossS') + s('crossT')).toBeGreaterThanOrEqual(3);
    expect(s('kickS') + s('kickT')).toBeGreaterThanOrEqual(3);
    expect(tl.filter((x) => x.dash).every((x) => /S$/.test(x.key) || x.key === 'run')).toBe(true);
    // jab -> load (the arm comes back) -> cross -> load, kickC (the chamber: the knee up; round 4 dropped the rising-knee frame) -> kick -> kickD, kickE, load (the foot comes back down in two) -> ready.
    const seq = keys(at, 10).join(' ');
    expect(seq).toContain('jabT jab load crossS crossT cross load kickC kickS kickT kick kickD kickE load ready');
    for (const [a, b] of [['jab', 'cross'], ['cross', 'kick']] as const) expect(tl.findIndex((x) => x.key === b) - tl.findIndex((x) => x.key === a)).toBeGreaterThanOrEqual(3);
    expect(PUNCH.hold).toBeGreaterThanOrEqual(10);
  });

  it('plays only the first blow when the combo is called off (a miss), then settles and goes home with no more blows', () => {
    const reach = 10;
    const at = punchWindup(reach);
    const first = Math.max(at, punchLead(reach));
    for (const stop of [first, first + 2, first + 5]) {
      const n = punchLength(at, reach);
      for (let k = 0; k < n; k++) {
        const b = punchBeat(k, at, reach, false, stop);
        if (k > stop) {
          expect(b.hit).toBe(-1);
          expect(b.contact).toBe(false);
          expect(['load', 'ready']).toContain(b.key);
        }
        expect(b.lunge).toBeGreaterThanOrEqual(0);
      }
      expect(punchBeat(stop + PUNCH.settle + PUNCH.back + 1, at, reach, false, stop).lunge).toBe(0);
    }
  });

  it('has a crouch variant for a short target: two low blows, no kick, the first at the same lead', () => {
    expect(punchHits(true, true).map((h) => h.key)).toEqual(['low', 'low2']);
    const at = punchWindup(10, true);
    const k = keys(at, 10, true);
    expect(k).toContain('lowT');
    expect(k.some((x) => /kick|cross|jab/.test(x))).toBe(false);
    const first = Math.max(at, punchLead(10, true));
    expect(starts(at, 10, true).lowT).toBe(first);
    expect(punchBeat(first, at, 10, true).hit).toBe(0);
    expect(punchBeat(first + (punchHits(true, true)[1]?.at ?? 0), at, 10, true).hit).toBe(1);
    expect(punchLead(10, true) * PUNCH_FRAME_MS).toBeLessThan(110);
  });

  it('stands the kick short of the fists by toeShort minus the stand-off, so the toe ends on the target body front', () => {
    expect(PUNCH_MEASURED.toeShort).toBeGreaterThan(PUNCH_KICK_SHORT);
    const at = punchWindup(10);
    const first = Math.max(at, punchLead(10));
    const kick = punchBeat(first + (punchHits()[2]?.at ?? 0) + 1, at, 10);
    expect(kick.push).toBeCloseTo(PUNCH_MEASURED.toeShort - PUNCH_KICK_SHORT, 5);
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
  const low = still('kit-battle-crouched');
  const idle = have ? sheetFrames(DIR, 'kit-battle-idle') : [];

  /** The back foot's centre column: the leftmost group of columns in the lowest eight rows (gaps of up to three columns join). */
  const rearBoot = (r: typeof load): number => {
    const b = boxOf(r);
    const cols = new Set<number>();
    for (let y = b.y1 - 7; y <= b.y1; y++) for (let x = 0; x < r.w; x++) if ((r.px[(y * r.w + x) * 4 + 3] ?? 0) > 0) cols.add(x);
    const xs = [...cols].sort((p, q) => p - q);
    let end = xs[0] ?? 0;
    for (const x of xs) {
      if (x - end > 3) break;
      end = x;
    }
    return ((xs[0] ?? 0) + end + 1) / 2;
  };
  /** The reaching fist of the crouch: the rightmost opaque pixel at head-to-waist height (the front boot is further right but lower). */
  const lowFist = (r: typeof low): [number, number] => {
    let tx = 0;
    for (let y = 20; y < 42; y++) for (let x = 0; x < r.w; x++) if ((r.px[(y * r.w + x) * 4 + 3] ?? 0) > 0) tx = Math.max(tx, x);
    let n = 0, sum = 0;
    for (let y = 20; y < 42; y++) for (let x = tx - 2; x <= tx; x++) if ((r.px[(y * r.w + x) * 4 + 3] ?? 0) > 0) { n++; sum += y; }
    return [tx, Math.round(sum / Math.max(1, n))];
  };

  it('re-measures to the recorded data (a regenerated frame must be re-measured)', () => {
    const A = PUNCH_ANCHORS;
    expect(frontBoot(load)).toBe(A.load.frontBoot);
    expect(rearBoot(load)).toBe(A.load.rearBoot);
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
    expect(soles(low)).toBe(A.low.soles);
    expect(lowFist(low)).toEqual([...A.low.tip]);
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

  it('puts every frame on one canvas with the soles on the bottom row, the planted boot on the idle column, the kick on the load back foot and all four blows on one column', () => {
    const b = buildSfPunch(idle, run, load, jab, cross, kick, low);
    const first = b.frames.ready;
    for (const k of PUNCH_KEYS) {
      const f = b.frames[k];
      expect([f.w, f.h]).toEqual([first.w, first.h]);
      expect(boxOf(f).y1).toBe(f.h - 1);
    }
    const col = (k: (typeof PUNCH_KEYS)[number]): number => frontBoot(b.frames[k]);
    // The planted foot does not slide through the combo (the idle's own boots are measured on its own loop, so within a pixel), smears and trails included.
    expect(col('jab')).toBe(col('jabS'));
    // The trail frame (the first of the blow) has the fist PUNCH_SQUASH px past its resting column.
    expect(col('jabT') - col('jab')).toBe(PUNCH_SQUASH);
    expect(col('cross')).toBe(col('crossS'));
    expect(col('crossT') - col('cross')).toBe(PUNCH_SQUASH);
    expect(Math.abs(col('jab') - col('ready'))).toBeLessThanOrEqual(1);
    expect(Math.abs(col('cross') - col('ready'))).toBeLessThanOrEqual(1);
    expect(Math.abs(col('load') - col('ready'))).toBeLessThanOrEqual(1);
    // The kick stands PUNCH_KICK_SHIFT art px forward of the load's back foot (a weight shift: the torso leans back by the rest), within a pixel and a half.
    const plant = (k: 'kick' | 'kickS' | 'kickT'): number => plantOf(b.frames[k]);
    expect(Math.abs(plant('kick') - PUNCH_KICK_SHIFT - rearBoot(b.frames.load))).toBeLessThanOrEqual(1.5);
    expect(plant('kickS')).toBe(plant('kick'));
    // All four blows end on the measured column: the fist of the jab and of the cross (a pixel apart, as drawn) and the crouch's reaching hand; the kick's toe is `toeShort` world px short.
    const tip = (k: 'jab' | 'cross' | 'kick'): number => rightmost(b.frames[k])[0] + 1 - b.axis;
    expect(tip('jab')).toBe(b.measured.tipDx);
    expect(Math.abs(tip('cross') - tip('jab'))).toBeLessThanOrEqual(1);
    expect(b.measured.tipDx - tip('kick')).toBe(b.measured.toeShort * 2);
    expect(b.measured.toeShort).toBeGreaterThan(PUNCH_KICK_SHORT);
    expect(b.measured.toeShort).toBeLessThan(6);
    expect(lowFist(b.frames.low)[0] + 1 - b.axis).toBe(b.measured.tipDx);
    expect(b.measured.tipDx).toBeGreaterThan(b.measured.footDx);
    expect(b.measured.up.kick).toBeGreaterThan(b.measured.up.jab);
    expect(b.measured.up.low).toBeLessThan(b.measured.up.jab / 1.4);
    expect(b.axis * 2).toBe(first.w);
    // The smear and trail frames carry the same body plus the streak or the crescent, behind it (the arm and the fist are all still there: only pixels are added).
    const opaque = (r: typeof first): number => r.px.reduce((n, v, i) => (i % 4 === 3 && v > 0 ? n + 1 : n), 0);
    for (const k of ['jab', 'cross', 'kick', 'low'] as const) {
      const body = opaque(b.frames[k]);
      expect(opaque(b.frames[`${k === 'low' ? 'low' : k}S` as 'jabS'])).toBeGreaterThan(body + 20);
      expect(opaque(b.frames[`${k}T` as 'jabT'])).toBeGreaterThan(body + 5);
      expect(opaque(b.frames[`${k}S` as 'jabS'])).toBeGreaterThan(opaque(b.frames[`${k}T` as 'jabT']));
    }
    // The body is untouched under the streak: every pixel of the plain jab is the same colour in the smear frame.
    const same = (a: typeof first, c: typeof first): boolean => {
      for (let i = 0; i < a.px.length; i += 4) if ((a.px[i + 3] ?? 0) > 0 && (a.px[i] !== c.px[i] || a.px[i + 1] !== c.px[i + 1] || a.px[i + 2] !== c.px[i + 2])) return false;
      return true;
    };
    for (const k of ['jab', 'cross', 'kick', 'low'] as const) expect(same(b.frames[k], b.frames[`${k}S` as 'jabS'])).toBe(true);
    // No smear reaches above the kick's own top (the name plate stays clear): the canvas is no taller than the kick (64 rows).
    expect(b.topRows).toBeLessThanOrEqual(64);
  });

  it('re-poses the kick leg about the hip and the knee without adding a colour, leaving the body and the standing leg as drawn', () => {
    const colours = (r: typeof kick): Set<number> => {
      const o = new Set<number>();
      for (let i = 0; i < r.px.length; i += 4) if ((r.px[i + 3] ?? 0) > 0) o.add(((r.px[i] ?? 0) << 16) | ((r.px[i + 1] ?? 0) << 8) | (r.px[i + 2] ?? 0));
      return o;
    };
    const base = colours(kick);
    const opaque = (r: typeof kick): number => r.px.reduce((n, v, i) => (i % 4 === 3 && v > 0 ? n + 1 : n), 0);
    for (const k of ['kickC', 'kickD', 'kickE'] as const) {
      const bent = poseLeg(kick, PUNCH_BEND[k].thigh, PUNCH_BEND[k].shin);
      for (const c of colours(bent)) expect(base.has(c)).toBe(true);
      // Left of the hip (the head, the torso, the standing leg's lower half) nothing moved.
      for (let y = 0; y < kick.h; y++) for (let x = 0; x < PUNCH_LEG.hip[0] - 4; x++) if ((kick.px[(y * kick.w + x) * 4 + 3] ?? 0) > 0) for (let c = 0; c < 4; c++) expect(bent.px[(y * bent.w + x) * 4 + c]).toBe(kick.px[(y * kick.w + x) * 4 + c]);
      // The foot swung down (the toe is lower than the kick's), and the pixel count is within a fifth of the kick's.
      expect(Math.abs(opaque(bent) - opaque(kick))).toBeLessThan(opaque(kick) / 5);
      expect(rightmost(bent)[1]).toBeGreaterThan(rightmost(kick)[1]);
    }
    // The chamber folds the shin more than the way down does, and the foot is lowest on the last frame of the drop.
    expect(PUNCH_BEND.kickC.shin).toBeGreaterThan(PUNCH_BEND.kickD.shin);
    expect(PUNCH_BEND.kickE.thigh).toBeGreaterThan(PUNCH_BEND.kickD.thigh);
  });
  it('despeckle removes islands of 5 px or fewer and keeps the biggest piece, whatever its size', () => {
    const w = 8, h = 8;
    const px = new Uint8ClampedArray(w * h * 4);
    const on = (x: number, y: number): void => { px.set([10, 20, 30, 255], (y * w + x) * 4); };
    for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) on(x, y); // the body: 16 px
    on(0, 0); // a fleck
    on(7, 6); on(7, 7); // a two-pixel island
    const out = despeckle({ w, h, px }, 5);
    const alive = (x: number, y: number): boolean => (out.px[(y * w + x) * 4 + 3] ?? 0) > 0;
    expect(alive(3, 3)).toBe(true);
    expect(alive(0, 0)).toBe(false);
    expect(alive(7, 6)).toBe(false);
    expect(alive(7, 7)).toBe(false);
    // a diagonal touch joins a speck to the body (8-connected), so it stays
    const px2 = new Uint8ClampedArray(px);
    px2.set([10, 20, 30, 255], (1 * w + 1) * 4);
    expect((despeckle({ w, h, px: px2 }, 5).px[(1 * w + 1) * 4 + 3] ?? 0) > 0).toBe(true);
  });
});
