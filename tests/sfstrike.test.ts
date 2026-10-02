import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { Raw } from '../src/art/rig2/sfgeom';
import { boxOf } from '../src/art/rig2/sfgeom';
import { SF_ANCHORS, SF_KEYS, SF_ROOM, SF_WINDUP, bend, buildSfStrike, frontBoot, rightmost, sfBeat, sfLength, sfTimeline, soles, splitSword, SF_POSES } from '../src/art/rig2/sfstrike';

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
      expect(start.swingB).toBe(at - 1);
      expect(tl.find((s) => s.key === 'follow')?.frames).toBeGreaterThanOrEqual(12);
      expect(sfLength(at)).toBe(t);
      expect(sfBeat(at - 1, at).key).toBe('swingB');
      expect(sfBeat(at - 1, at).contact).toBe(true);
      expect(sfBeat(at - 4, at).contact).toBe(false);
    }
  });

  it('has an anticipation dip before the overhead, no long static hold at the default timing, and a recover frame on the way home', () => {
    const tl = sfTimeline(SF_WINDUP);
    const keys = tl.map((s) => s.key);
    expect(keys.indexOf('dip')).toBe(keys.indexOf('windup') - 1);
    expect(keys.indexOf('windup')).toBeLessThan(keys.indexOf('swingA'));
    expect(keys.indexOf('recover')).toBe(keys.indexOf('follow') + 1);
    expect(keys.at(-1)).toBe('ready');
    // The overhead is held at most 6 frames when nothing stretches it (round 1 held it 10).
    expect(tl.find((s) => s.key === 'windup')?.frames).toBeLessThanOrEqual(6);
  });

  it('moves a crewmate out of his row before he moves, keeps her out until he is nearly home, and returns her to her place', () => {
    const at = SF_WINDUP;
    const tl = sfTimeline(at);
    const swingStart = tl.slice(0, 3).reduce((n, s) => n + s.frames, 0);
    expect(sfBeat(0, at).room).toBe(0);
    expect(sfBeat(swingStart - 1, at).room).toBeGreaterThan(0.95);
    expect(sfBeat(swingStart, at).room).toBeGreaterThan(0.95);
    for (let k = swingStart; k < sfLength(at) - 6; k++) expect(sfBeat(k, at).room).toBeGreaterThan(0.95);
    expect(sfBeat(sfLength(at) - 1, at).room).toBe(0);
    expect(SF_ROOM.dy).toBeGreaterThan(0);
  });

  it('lunges continuously: each step starts where the one before ended (the dash is the swing frames)', () => {
    const tl = sfTimeline(18);
    for (let i = 1; i < tl.length; i++) {
      const a = tl[i - 1];
      const b = tl[i];
      if (!a || !b) continue;
      // The only jumps are the three swing frames, which the engine draws with steel ghosts and a streak.
      if (b.key !== 'swingA' && b.key !== 'swingM' && b.key !== 'swingB') expect(Math.abs(b.from - a.to)).toBeLessThan(0.06);
    }
    expect(sfBeat(0, 18).lunge).toBe(0);
    expect(sfBeat(sfLength(18) - 1, 18).lunge).toBe(0);
  });
});

describe.skipIf(!have)('anchors on Mark\'s frames', () => {
  const s1 = have ? readPng(`${DIR}/rook-battle-strike1.png`) : { w: 0, h: 0, px: new Uint8ClampedArray(0) };
  const s2 = have ? readPng(`${DIR}/rook-battle-strike2.png`) : { w: 0, h: 0, px: new Uint8ClampedArray(0) };
  const idle = have ? idleFrames() : [];

  it('re-measures to the recorded data (a regenerated frame must be re-measured)', () => {
    expect([s1.w, s1.h]).toEqual([SF_ANCHORS.windup.w, SF_ANCHORS.windup.h]);
    expect([s2.w, s2.h]).toEqual([SF_ANCHORS.follow.w, SF_ANCHORS.follow.h]);
    expect(frontBoot(s1)).toBe(SF_ANCHORS.windup.frontBoot);
    expect(soles(s1)).toBe(SF_ANCHORS.windup.soles);
    expect(frontBoot(s2)).toBe(SF_ANCHORS.follow.frontBoot);
    expect(soles(s2)).toBe(SF_ANCHORS.follow.soles);
    expect(rightmost(s2)).toEqual([...SF_ANCHORS.follow.tip]);
    const fb = idle.reduce((n, r) => n + frontBoot(r), 0) / idle.length;
    expect(Math.abs(fb - SF_ANCHORS.idle.frontBoot)).toBeLessThan(0.3);
    for (const r of idle) expect(soles(r)).toBe(SF_ANCHORS.idle.soles);
  });

  it('puts every frame on one canvas size with the soles on the bottom row and the front boot on the same column', () => {
    const b = buildSfStrike(idle, s1, s2);
    const first = b.frames.ready;
    for (const k of SF_KEYS) {
      const f = b.frames[k];
      expect([f.w, f.h]).toEqual([first.w, first.h]);
      expect(boxOf(f).y1).toBe(f.h - 1);
    }
    // The stamping foot does not slide between the wind-up, the swing and the follow-through (the idle's own boots are measured on its own loop).
    const col = (k: (typeof SF_KEYS)[number]): number => frontBoot(b.frames[k]);
    expect(col('windup')).toBe(col('follow'));
    expect(Math.abs(col('ready') - col('follow'))).toBeLessThanOrEqual(1);
    expect(col('swingA')).toBe(col('windup'));
    expect(col('swingM')).toBe(col('windup'));
    expect(col('swingB')).toBe(col('follow'));
    expect(Math.abs(col('dip') - col('ready'))).toBeLessThanOrEqual(1);
    expect(Math.abs(col('recover') - col('ready'))).toBeLessThanOrEqual(1);
    // Measured reach: the blade's point is in front of the axis and just above the soles.
    expect(b.measured.tipDx).toBeGreaterThan(b.measured.footDx);
    expect(b.measured.tipUp).toBe(SF_ANCHORS.follow.soles - SF_ANCHORS.follow.tip[1]);
    expect(b.axis * 2).toBe(first.w);
  });

  it('bends by rows without losing a pixel or moving the soles, and keeps his own guard on his own sword', () => {
    const count = (r: Raw): number => r.px.reduce((n, v, i) => (i % 4 === 3 && v > 0 ? n + 1 : n), 0);
    const gold = (r: Raw): number => {
      let n = 0;
      for (let i = 0; i < r.px.length; i += 4) if ((r.px[i + 3] ?? 0) > 0 && (r.px[i] ?? 0) > 200 && (r.px[i + 1] ?? 0) > 140 && (r.px[i + 2] ?? 0) < 110) n++;
      return n;
    };
    const { body, sword } = splitSword(s1);
    // A bend only drops the rows it lists: nothing else is lost (the soles stay on the last row).
    const inRows = (r: Raw, rows: readonly number[]): number => rows.reduce((n, y) => n + count({ w: r.w, h: 1, px: r.px.subarray(y * r.w * 4, (y + 1) * r.w * 4) }), 0);
    expect(count(body) + count(sword)).toBe(count(s1));
    const bent = bend(body, SF_POSES.swingM).raw;
    expect(count(bent)).toBe(count(body) - inRows(body, SF_POSES.swingM.del));
    expect(boxOf(bent).y1).toBe(boxOf(body).y1);
    // The guard travels with the sword: it is in the sword layer, and the body has none of it left.
    expect(gold(sword)).toBeGreaterThanOrEqual(3);
    const b = buildSfStrike(idle, s1, s2);
    for (const k of ['swingA', 'swingM'] as const) expect(gold(b.frames[k])).toBeGreaterThanOrEqual(gold(sword) - 3);
  });
});
