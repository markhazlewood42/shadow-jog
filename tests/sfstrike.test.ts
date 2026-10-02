import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { Raw } from '../src/art/rig2/sfgeom';
import { boxOf } from '../src/art/rig2/sfgeom';
import { SF_ANCHORS, SF_FRAME_MS, SF_KEYS, SF_POSES, SF_ROOM, SF_UP, SF_DIP, SF_WINDUP, SF_SWIPES, bend, buildSfStrike, frontBoot, rightmost, sfBeat, sfLength, sfTimeline, soles, splitSword } from '../src/art/rig2/sfstrike';

/**
 * Rook's strike from Mark's Sprite Fusion frames (spike side-battle, item G-sf-rook-strike). The timeline tests run everywhere; the anchor tests read Mark's
 * git-excluded PNGs and are skipped where they are absent (so a regenerated frame fails here, where its recorded anchors would otherwise silently go stale).
 */
const DIR = 'spritefusion-tests';
const have = existsSync(`${DIR}/rook-battle-strike1.png`) && existsSync(`${DIR}/extracted/rook-battle-idle/spritesheet.png`);

/** A minimal PNG reader: 8-bit RGBA, not interlaced (what Sprite Fusion writes). */
function readPng(path: string): Raw {
  const b = readFileSync(path);
  let p = 8;
  let w = 0, h = 0;
  const idat: Buffer[] = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString('ascii', p + 4, p + 8);
    if (type === 'IHDR') { w = b.readUInt32BE(p + 8); h = b.readUInt32BE(p + 12); }
    if (type === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = new Uint8ClampedArray(w * h * 4);
  const stride = w * 4;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)] ?? 0;
    for (let x = 0; x < stride; x++) {
      const cur = raw[y * (stride + 1) + 1 + x] ?? 0;
      const left = x >= 4 ? (px[y * stride + x - 4] ?? 0) : 0;
      const up = y > 0 ? (px[(y - 1) * stride + x] ?? 0) : 0;
      const ul = x >= 4 && y > 0 ? (px[(y - 1) * stride + x - 4] ?? 0) : 0;
      let v = cur;
      if (f === 1) v += left;
      else if (f === 2) v += up;
      else if (f === 3) v += Math.floor((left + up) / 2);
      else if (f === 4) {
        const pa = Math.abs(up - ul), pb = Math.abs(left - ul), pc = Math.abs(left + up - 2 * ul);
        v += pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
      }
      px[y * stride + x] = v & 255;
    }
  }
  return { w, h, px };
}

function idleFrames(): Raw[] {
  const meta = JSON.parse(readFileSync(`${DIR}/extracted/rook-battle-idle/metadata.json`, 'utf8')) as { frame_w: number; frame_count: number };
  const s = readPng(`${DIR}/extracted/rook-battle-idle/spritesheet.png`);
  return Array.from({ length: meta.frame_count }, (_, i) => {
    const px = new Uint8ClampedArray(meta.frame_w * s.h * 4);
    for (let y = 0; y < s.h; y++) px.set(s.px.subarray((y * s.w + i * meta.frame_w) * 4, (y * s.w + (i + 1) * meta.frame_w) * 4), y * meta.frame_w * 4);
    return { w: meta.frame_w, h: s.h, px };
  });
}

describe('the strike timeline', () => {
  it('lays the blade on the target a frame before the effect and holds the blow through it', () => {
    for (const at of [12, 18, 24, 40]) {
      const tl = sfTimeline(at);
      let t = 0;
      const start: Record<string, number> = {};
      for (const s of tl) {
        if (!(s.key in start)) start[s.key] = t;
        t += s.frames;
      }
      // Swing B (the blade on the target) starts one frame before the effect; the follow-through is held through the cut line, the damage and the hitstop.
      expect(start.swingB).toBe(Math.max(at - 1, SF_WINDUP - 2 - 1));
      expect(tl.find((s) => s.key === 'follow')?.frames).toBeGreaterThanOrEqual(12);
      expect(sfLength(at)).toBe(t);
      expect(sfBeat(start.swingB ?? 0, at).key).toBe('swingB');
      expect(sfBeat(start.swingB ?? 0, at).contact).toBe(true);
      expect(sfBeat((start.swingB ?? 0) - 1, at).contact).toBe(false);
    }
  });

  it('is a 17-frame lead (about 435 ms at the real 25.6 ms pose frame): his crouch, the stand-up in two steps, a short overhead, the swing', () => {
    const tl = sfTimeline(SF_WINDUP);
    const keys = tl.map((s) => s.key);
    const frames = (k: string): number => tl.find((s) => s.key === k)?.frames ?? 0;
    expect(SF_WINDUP).toBeLessThanOrEqual(17);
    expect(SF_WINDUP * SF_FRAME_MS).toBeLessThan(450);
    expect(SF_FRAME_MS).toBeCloseTo(25.6, 0);
    expect(frames('dip')).toBeGreaterThanOrEqual(3);
    // The overhead is short (3 frames) and the body RISES into it through two stand-up frames (the charge), not a frozen 9-frame hold.
    expect(frames('windup')).toBeLessThanOrEqual(5);
    expect(keys.indexOf('dip')).toBe(keys.indexOf('riseA') - 1);
    expect(keys.indexOf('riseA')).toBe(keys.indexOf('rise') - 1);
    expect(keys.indexOf('rise')).toBe(keys.indexOf('windup') - 1);
    expect(keys.indexOf('windup')).toBe(keys.indexOf('smearA') - 1);
    expect(keys.indexOf('smearA')).toBe(keys.indexOf('mid') - 1);
    expect(keys.indexOf('mid')).toBe(keys.indexOf('smearB') - 1);
    expect(keys.indexOf('recover')).toBe(keys.indexOf('follow') + 1);
    expect(keys.at(-1)).toBe('ready');
    // The overhead is held the same however long the ready stance runs; the extra time (a timing ring) is the breathing ready stance.
    for (const t of [12, 18, 30]) expect(sfTimeline(t).find((s) => s.key === 'windup')?.frames).toBe(SF_UP);
    expect(sfTimeline(30)[0]?.frames).toBeGreaterThan(sfTimeline(SF_WINDUP)[0]?.frames ?? 99);
    expect(SF_DIP).toBeGreaterThanOrEqual(3);
  });

  it('keeps a crewmate in his way stepping back into the second row before he dashes and down again after he has passed (a function of the beat, not of his lunge)', () => {
    expect(SF_ROOM.up).toBeGreaterThan(8);
    expect(SF_ROOM.left).toBeGreaterThanOrEqual(0);
    const at = SF_WINDUP;
    expect(sfBeat(0, at).room).toBe(0);
    expect(sfBeat(sfLength(at) - 1, at).room).toBe(0);
    const tl = sfTimeline(at);
    let k = 0;
    for (const s of tl) {
      // She is fully back by the first dash frame (so he never runs into her mid-swing) and stays back until he is home.
      if (s.key === 'smearA') expect(sfBeat(k, at).room).toBe(1);
      k += s.frames;
    }
    for (let i = 1; i < sfLength(at); i++) expect(Math.abs(sfBeat(i, at).room - sfBeat(i - 1, at).room)).toBeLessThanOrEqual(0.55);
  });

  it('lunges at a steady rate through the swing (about 0.14 a frame), each step starting where the one before ended', () => {
    const tl = sfTimeline(18);
    const swing = tl.filter((s) => s.key === 'smearA' || s.key === 'mid' || s.key === 'smearB' || s.key === 'swingB');
    // The lunge at each swing FRAME, in order: no frame skips more than 0.2 of the dash (round 3 skipped 0.32 to 0.50 in one).
    const per: number[] = [];
    for (const s of swing) for (let i = 0; i < s.frames; i++) per.push(s.frames > 1 ? s.from + ((s.to - s.from) * i) / (s.frames - 1) : s.from);
    for (let i = 1; i < per.length; i++) expect((per[i] ?? 0) - (per[i - 1] ?? 0)).toBeLessThanOrEqual(0.2);
    for (let i = 1; i < per.length; i++) expect((per[i] ?? 0) - (per[i - 1] ?? 0)).toBeGreaterThan(0.05);
    expect(sfBeat(0, 18).lunge).toBe(0);
    expect(sfBeat(sfLength(18) - 1, 18).lunge).toBe(0);
  });

  it('draws no dither: the swipes are solid bands (data: three tones, a leading blade only where the sword is cut out of strike1)', () => {
    for (const k of ['smearA', 'mid'] as const) expect(SF_SWIPES[k].blade).toBeGreaterThan(30);
    for (const k of ['smearB', 'swingB', 'followFade'] as const) expect(SF_SWIPES[k].blade).toBe(0);
    // No swipe reaches over the name plate (a vertical reach over 37 art px from the wind-up hands would): checked on the built frames below.
    expect(SF_SWIPES.smearA.ry).toBeLessThanOrEqual(37);
  });
});

describe.skipIf(!have)('anchors on Mark\'s frames', () => {
  const s1 = have ? readPng(`${DIR}/rook-battle-strike1.png`) : { w: 0, h: 0, px: new Uint8ClampedArray(0) };
  const s2 = have ? readPng(`${DIR}/rook-battle-strike2.png`) : { w: 0, h: 0, px: new Uint8ClampedArray(0) };
  const idle = have ? idleFrames() : [];
  const crouch = have ? readPng(`${DIR}/rook-battle-crouched.png`) : { w: 0, h: 0, px: new Uint8ClampedArray(0) };

  it('re-measures to the recorded data (a regenerated frame must be re-measured)', () => {
    expect([s1.w, s1.h]).toEqual([SF_ANCHORS.windup.w, SF_ANCHORS.windup.h]);
    expect([s2.w, s2.h]).toEqual([SF_ANCHORS.follow.w, SF_ANCHORS.follow.h]);
    expect(frontBoot(s1)).toBe(SF_ANCHORS.windup.frontBoot);
    expect(soles(s1)).toBe(SF_ANCHORS.windup.soles);
    expect(frontBoot(s2)).toBe(SF_ANCHORS.follow.frontBoot);
    expect(soles(s2)).toBe(SF_ANCHORS.follow.soles);
    expect(rightmost(s2)).toEqual([...SF_ANCHORS.follow.tip]);
    expect([crouch.w, crouch.h]).toEqual([SF_ANCHORS.crouch.w, SF_ANCHORS.crouch.h]);
    expect(frontBoot(crouch)).toBe(SF_ANCHORS.crouch.frontBoot);
    expect(soles(crouch)).toBe(SF_ANCHORS.crouch.soles);
    const fb = idle.reduce((n, r) => n + frontBoot(r), 0) / idle.length;
    expect(Math.abs(fb - SF_ANCHORS.idle.frontBoot)).toBeLessThan(0.3);
    for (const r of idle) expect(soles(r)).toBe(SF_ANCHORS.idle.soles);
  });

  it('puts every frame on one canvas size with the soles on the bottom row and the front boot on the same column', () => {
    const b = buildSfStrike(idle, s1, s2, crouch);
    const first = b.frames.ready;
    for (const k of SF_KEYS) {
      const f = b.frames[k];
      expect([f.w, f.h]).toEqual([first.w, first.h]);
      expect(boxOf(f).y1).toBe(f.h - 1);
    }
    // The stamping foot does not slide between the wind-up, the smears and the follow-through (the idle's own boots are measured on its own loop).
    const col = (k: (typeof SF_KEYS)[number]): number => frontBoot(b.frames[k]);
    expect(col('windup')).toBe(col('follow'));
    expect(Math.abs(col('ready') - col('follow'))).toBeLessThanOrEqual(1);
    expect(col('smearB')).toBe(col('follow'));
    expect(col('swingB')).toBe(col('follow'));
    expect(col('rise')).toBe(col('windup'));
    expect(col('riseA')).toBe(col('windup'));
    // Mark's own crouch frame is the dip: its front boot is on the idle's within a pixel too.
    expect(Math.abs(col('dip') - col('ready'))).toBeLessThanOrEqual(1);
    expect(Math.abs(col('recover') - col('ready'))).toBeLessThanOrEqual(1);
    // The name plate (about 24 screen px under the top edge, 40 tall at the strike's row) is 24 px clear: no frame reaches more than 113 art px above the soles.
    expect(b.topRows).toBeLessThanOrEqual(113);
    // Measured reach: the blade's point is in front of the axis and just above the soles.
    expect(b.measured.tipDx).toBeGreaterThan(b.measured.footDx);
    expect(b.measured.tipUp).toBe(SF_ANCHORS.follow.soles - SF_ANCHORS.follow.tip[1]);
    expect(b.axis * 2).toBe(first.w);
  });

  it('squashes by rows without losing a pixel or moving the soles, and cuts his own sword (guard and all) out of the wind-up whole', () => {
    const count = (r: Raw): number => r.px.reduce((n, v, i) => (i % 4 === 3 && v > 0 ? n + 1 : n), 0);
    const gold = (r: Raw): number => {
      let n = 0;
      for (let i = 0; i < r.px.length; i += 4) if ((r.px[i + 3] ?? 0) > 0 && (r.px[i] ?? 0) > 200 && (r.px[i + 1] ?? 0) > 140 && (r.px[i + 2] ?? 0) < 110) n++;
      return n;
    };
    const { body, sword } = splitSword(s1);
    // A squash only drops the rows it lists: nothing else is lost (the soles stay on the last row), and nothing above moves sideways when lean is 0.
    const inRows = (r: Raw, rows: readonly number[]): number => rows.reduce((n, y) => n + count({ w: r.w, h: 1, px: r.px.subarray(y * r.w * 4, (y + 1) * r.w * 4) }), 0);
    expect(count(body) + count(sword)).toBe(count(s1));
    const rise = bend(s1, SF_POSES.rise).raw;
    expect(count(rise)).toBe(count(s1) - inRows(s1, SF_POSES.rise.del));
    expect(boxOf(rise).y1).toBe(boxOf(s1).y1);
    // The swipe frame's body has none of the sword left (the swipe is the blade): the guard's gold is gone from it.
    expect(gold(sword)).toBeGreaterThanOrEqual(3);
    const top = (r: Raw): Raw => ({ w: r.w, h: 26, px: r.px.subarray(0, r.w * 26 * 4) });
    expect(gold(top(body))).toBe(gold(top(s1)) - gold(sword));
  });
});
