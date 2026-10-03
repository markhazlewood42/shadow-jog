import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { boxOf, type Raw } from '../src/art/rig2/sfgeom';
import { dropStrays, PUNCH_KEYS } from '../src/art/rig2/sfpunch';
import { frontBoot, SF_KEYS, type SfKey } from '../src/art/rig2/sfstrike';
import { cutSheet, footAnchor } from '../src/stage/feet';
import { buildKitSet, buildStrikeSet, type StrikeSet } from '../src/stage/strike';
import { readPng } from './png';

/**
 * Rook's strike pictures on one canvas. The anchoring test reads Mark's git-excluded PNGs and is skipped where they are
 * absent; the stand-in test runs everywhere (it is what CI draws).
 */
const DIR = 'spritefusion-tests';
const have = existsSync(`${DIR}/rook-battle-strike1.png`) && existsSync(`${DIR}/extracted/rook-battle-idle/spritesheet.png`);

/** One named picture of a set, or a readable failure. */
function pic(set: StrikeSet | null, key: string): Raw {
  const f = set?.frames[key];
  if (!f) throw new Error(`no picture "${key}"`);
  return f;
}

function rookIdle(): ReturnType<typeof cutSheet> {
  const meta = JSON.parse(readFileSync(`${DIR}/extracted/rook-battle-idle/metadata.json`, 'utf8')) as { frame_w: number; frame_count: number };
  return cutSheet(readPng(`${DIR}/extracted/rook-battle-idle/spritesheet.png`), meta.frame_w, meta.frame_count);
}

describe.skipIf(!have)('Rook’s strike frames stand on one spot (Mark’s own drawings)', () => {
  const idle = have ? rookIdle() : [];
  const foot = have ? footAnchor(idle) : { x: 0, y: 0 };
  const set = have ? buildStrikeSet(idle, foot, { s1: dropStrays(readPng(`${DIR}/rook-battle-strike1.png`)), s2: dropStrays(readPng(`${DIR}/rook-battle-strike2.png`)), crouch: dropStrays(readPng(`${DIR}/rook-battle-crouched.png`)) }) : null;
  // The body frames that are Mark's drawings or his drawings with rows taken out (the swipe-only layers do not change the boots).
  const bodies: SfKey[] = ['ready', 'dip', 'riseA', 'rise', 'windup', 'smearA', 'mid', 'smearB', 'swingB', 'followFade', 'follow', 'recover'];

  it('every frame’s soles are on the row just above the axis (the floor)', () => {
    for (const k of SF_KEYS) expect(boxOf(pic(set, k)).y1 + 1, k).toBe(set?.axisY);
  });

  it('the front boot is at the same distance from the axis in every body frame, and equals the idle’s', () => {
    // The idle's own front boot relative to the foot the stage stands it on.
    const idleOffset = frontBoot(idle[0] as (typeof idle)[number]) - foot.x;
    for (const k of bodies) {
      const f = pic(set, k);
      if (!set) throw new Error('no set');
      // The front boot of the frame, relative to the axis. A pixel of rounding is the most the anchors allow.
      expect(Math.abs(frontBoot(f) - set.axisX - idleOffset), `${k}: boot ${frontBoot(f)} axis ${set.axisX} idle offset ${idleOffset}`).toBeLessThanOrEqual(1.5);
    }
  });

  it('keeps the axis inside the canvas of every frame, which all share one size', () => {
    const sizes = new Set(SF_KEYS.map((k) => `${pic(set, k).w}x${pic(set, k).h}`));
    expect(sizes.size).toBe(1);
    expect(set?.axisX).toBeGreaterThan(0);
    expect(set?.axisX).toBeLessThan(pic(set, 'ready').w);
  });
});

describe('the stand-ins that keep the strike running without Mark’s folder', () => {
  // A stand-in idle loop: the block figure the stage draws (79x68 cells).
  const block = (w: number, h: number): ReturnType<typeof cutSheet>[number] => {
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 8; y < h - 2; y++) for (let x = 30; x < 50; x++) px.set([106, 122, 58, 255], (y * w + x) * 4);
    return { w, h, px };
  };
  const idle = [block(79, 68), block(79, 68)];
  const foot = footAnchor(idle);
  const set = buildStrikeSet(idle, foot, null);

  it('draw every named frame on one canvas with the idle laid in under the axis', () => {
    const sizes = new Set(SF_KEYS.map((k) => `${pic(set, k).w}x${pic(set, k).h}`));
    expect(sizes.size).toBe(1);
    for (const k of SF_KEYS) expect(boxOf(pic(set, k)).y1 + 1, k).toBe(set.axisY);
    // The idle frame is laid in so that its own foot anchor lands exactly on the axis.
    const ready = boxOf(pic(set, 'ready'));
    expect(Math.abs((ready.x0 + ready.x1 + 1) / 2 - set.axisX)).toBeLessThanOrEqual(1);
  });

  it('are different pictures (a crouch is lower than the wind-up, the wind-up the tallest)', () => {
    const height = (k: SfKey): number => boxOf(pic(set, k)).y1 - boxOf(pic(set, k)).y0 + 1;
    expect(height('dip')).toBeLessThan(height('rise'));
    expect(height('rise')).toBeLessThanOrEqual(height('windup'));
    expect(height('follow')).toBeLessThan(height('windup'));
  });
});

describe.skipIf(!have || !existsSync(`${DIR}/kit-battle-punch1.png`))('Kit’s combo frames stand on one spot (Mark’s own drawings)', () => {
  const meta = have ? (JSON.parse(readFileSync(`${DIR}/extracted/kit-battle-idle/metadata.json`, 'utf8')) as { frame_w: number; frame_count: number }) : { frame_w: 64, frame_count: 1 };
  const idle = have ? cutSheet(readPng(`${DIR}/extracted/kit-battle-idle/spritesheet.png`), meta.frame_w, meta.frame_count) : [];
  const foot = have ? footAnchor(idle) : { x: 0, y: 0 };
  const png = (n: string): Raw => dropStrays(readPng(`${DIR}/${n}.png`));
  const set = have ? buildKitSet(idle, foot, { run: png('kit-battle-running'), load: png('kit-battle-punch1'), jab: png('kit-battle-punch2'), cross: png('kit-battle-punch3'), kick: png('kit-battle-kick'), low: png('kit-battle-crouched') }) : null;

  it('every frame is the same size, with its soles on the row above the axis (the kick, which has a raised foot, is the exception: its standing foot is)', () => {
    const sizes = new Set(PUNCH_KEYS.map((k) => `${pic(set, k).w}x${pic(set, k).h}`));
    expect(sizes.size).toBe(1);
    for (const k of ['ready', 'load', 'jab', 'cross', 'jabS', 'crossS', 'kick']) expect(boxOf(pic(set, k)).y1 + 1, k).toBeLessThanOrEqual((set?.axisY ?? 0) + 1);
    for (const k of ['ready', 'load', 'jab', 'cross']) expect(boxOf(pic(set, k)).y1 + 1, k).toBeGreaterThanOrEqual((set?.axisY ?? 0) - 1);
  });

  it('the planted front boot stays where the idle’s is through the punches', () => {
    const idleOffset = frontBoot(idle[0] as Raw) - foot.x;
    for (const k of ['ready', 'load', 'jab', 'cross']) expect(Math.abs(frontBoot(pic(set, k)) - (set?.axisX ?? 0) - idleOffset), k).toBeLessThanOrEqual(1.5);
  });
});

describe('the stand-in combo that keeps Kit’s moves running without Mark’s folder', () => {
  const idle = [{ w: 64, h: 64, px: new Uint8ClampedArray(64 * 64 * 4).map((_, i) => (i % 4 === 3 && Math.floor(i / 4 / 64) > 10 && (i / 4) % 64 > 22 && (i / 4) % 64 < 40 ? 255 : 0)) }];
  const foot = footAnchor(idle);
  const set = buildKitSet(idle, foot, null);
  it('has every named frame on one canvas, the arm longer for the cross than the jab and the leg out for the kick', () => {
    expect(new Set(PUNCH_KEYS.map((k) => `${pic(set, k).w}x${pic(set, k).h}`)).size).toBe(1);
    const reach = (k: string): number => boxOf(pic(set, k)).x1;
    expect(reach('cross')).toBeGreaterThanOrEqual(reach('jab'));
    expect(reach('kick')).toBeGreaterThan(reach('load'));
  });
});
