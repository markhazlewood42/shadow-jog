import { describe, expect, it } from 'vitest';
import { fixtureStages } from './stagefiles';
import { SCREEN_H, SCREEN_W, type StageConfig, type StageFile, stageOf } from '../src/battlestage/config';
import { CREW_FACES, cutFace, ENEMY_FACES, modeDown } from '../src/battlestage/faces';
import { floorBands, paintFloor, puddleSpots, reprojectWall } from '../src/battlestage/floor';
import { getRgb, hexRgb, mix, newRaw, type Raw, seeded, setRgb, th } from '../src/battlestage/pixels';
import { paintWall, WALL_IDS } from '../src/battlestage/sewerwall';
import { ringRaw, ringSize, shadowRaw, shadowSize } from '../src/battlestage/shadow';

const file: StageFile = fixtureStages();
const clone = (id: string): StageConfig => JSON.parse(JSON.stringify(stageOf(file, id))) as StageConfig;
const alphaAt = (r: Raw, x: number, y: number): number => r.data[(y * r.w + x) * 4 + 3] ?? 0;
const same = (a: Raw, b: Raw): boolean => a.w === b.w && a.h === b.h && a.data.every((v, i) => v === b.data[i]);

/** A stage with only the bands and their seams switched on, over a flat wall, to look at one layer at a time. */
function plain(id = 'street'): { stage: StageConfig; wall: Raw } {
  const stage = clone(id);
  const f = stage.floor;
  delete f.texture;
  delete f.grid;
  f.style = 'bands';
  f.laneSeams = null;
  f.stripes = [];
  f.reflections = null;
  f.neonSpill = null;
  f.haze = null;
  f.tint = null;
  return { stage, wall: newRaw(SCREEN_W, SCREEN_H, [40, 40, 60]) };
}

describe('the floor’s bands (the perspective trick: stripes that grow toward the camera)', () => {
  it('start at the top, tile the floor exactly, and each is taller than the one above (about 1.2x)', () => {
    const bands = floorBands(102, 270, 3, 1.2);
    expect(bands[0]?.[0]).toBe(102);
    expect(bands[bands.length - 1]?.[1]).toBe(270);
    for (let i = 1; i < bands.length; i++) expect(bands[i]?.[0]).toBe(bands[i - 1]?.[1]);
    const heights = bands.map(([a, b]) => b - a);
    for (let i = 1; i < heights.length - 1; i++) expect(heights[i] ?? 0).toBeGreaterThanOrEqual(heights[i - 1] ?? 99);
    expect(Math.max(...heights)).toBeGreaterThanOrEqual(heights[0] ?? 0) ;
    expect(heights[heights.length - 2] ?? 0).toBeGreaterThanOrEqual(10);
  });
});

describe('paintFloor', () => {
  it('is the same picture every time for the same config, and a different one for another seed', () => {
    const wall = paintWall('sewer-sidewall', 100);
    const sewer = clone('sewer');
    const a = paintFloor(wall, sewer);
    expect(same(a, paintFloor(wall, sewer))).toBe(true);
    sewer.floor.seed = 99;
    expect(same(a, paintFloor(wall, sewer))).toBe(false);
  });

  it('leaves the wall alone, paints the kerb (a lit row, then a darker one) and fills every row below it, opaque', () => {
    const { stage, wall } = plain();
    const out = paintFloor(wall, stage);
    const h0 = stage.backdrop.horizonY;
    for (let y = 0; y < h0; y++) for (const x of [0, 77, 240, 479]) expect(getRgb(out, x, y)).toEqual(getRgb(wall, x, y));
    const edge = hexRgb(stage.floor.edge ?? '#000000');
    expect(getRgb(out, 200, h0)).toEqual(edge);
    expect(getRgb(out, 200, h0 + 1)).toEqual(mix(edge, [0, 0, 0], 0.55));
    for (let y = 0; y < SCREEN_H; y++) expect(alphaAt(out, 5, y)).toBe(255);
    // Every floor row is a floor colour (one of the two band colours, or a seam mixed into one), never the wall's flat colour.
    for (let y = h0 + 2; y < stage.floor.y1; y++) expect(getRgb(out, 0, y)).not.toEqual([40, 40, 60]);
  });

  it('seams get stronger toward the camera: a dithered share of each band’s first row that follows the config', () => {
    const { stage, wall } = plain();
    const out = paintFloor(wall, stage);
    const bands = floorBands(stage.backdrop.horizonY + 2, stage.floor.y1, stage.floor.bandStart, stage.floor.bandGrowth);
    const share = (row: number, base: ReturnType<typeof hexRgb>): number => {
      let n = 0;
      for (let x = 0; x < SCREEN_W; x++) {
        const c = getRgb(out, x, row);
        if (c[0] !== base[0] || c[1] !== base[1] || c[2] !== base[2]) n++;
      }
      return n / SCREEN_W;
    };
    const colour = (i: number): ReturnType<typeof hexRgb> => hexRgb(stage.floor.colors[i % 2] ?? '#000000');
    const seam = stage.floor.seam;
    if (!seam) throw new Error('the street floor has no seam');
    const farBand = 1;
    const nearBand = bands.length - 3;
    const far = share(bands[farBand]?.[0] ?? 0, colour(farBand));
    const near = share(bands[nearBand]?.[0] ?? 0, colour(nearBand));
    expect(near).toBeGreaterThan(far);
    // Both within one dither step (1/16) of the strength the config asks for at that depth.
    const want = (i: number): number => seam.far + (seam.near - seam.far) * (((bands[i]?.[0] ?? 0) - (stage.backdrop.horizonY + 2)) / (stage.floor.y1 - (stage.backdrop.horizonY + 2)));
    expect(Math.abs(far - want(farBand))).toBeLessThan(1 / 16 + 0.02);
    expect(Math.abs(near - want(nearBand))).toBeLessThan(1 / 16 + 0.02);
  });

  it('puddles keep clear of every place anyone can stand, and there are as many as asked for', () => {
    for (const id of ['street', 'sewer']) {
      const stage = clone(id);
      const want = stage.floor.reflections?.count ?? 0;
      const spots = puddleSpots(stage, seeded(stage.floor.seed ?? 0), stage.backdrop.horizonY + 2, want);
      expect(spots).toHaveLength(want);
      const ys = stage.rows.map((r) => r.y);
      const slots = [...stage.party.map((p) => [p.x, ys[p.row] ?? 0]), ...Object.values(stage.enemySets).flatMap((set) => set.map((p) => [p.x, ys[p.row] ?? 0]))];
      for (const p of spots) for (const [sx, sy] of slots) expect(Math.abs(p.cx - (sx ?? 0)) < p.a + 24 && Math.abs(p.cy - (sy ?? 0)) < 14).toBe(false);
    }
  });

  it('haze pulls the far floor toward the fog colour, and less so lower down', () => {
    const { stage, wall } = plain();
    stage.floor.haze = { color: '#ff00ff', amount: 0.9, reach: 40 };
    const hazy = paintFloor(wall, stage);
    const clear = paintFloor(wall, { ...stage, floor: { ...stage.floor, haze: null } });
    const pink = (r: Raw, y: number): number => {
      let n = 0;
      for (let x = 0; x < SCREEN_W; x++) n += getRgb(r, x, y)[0] - getRgb(r, x, y)[1];
      return n;
    };
    const y0 = stage.backdrop.horizonY + 3;
    expect(pink(hazy, y0)).toBeGreaterThan(pink(clear, y0));
    expect(pink(hazy, y0) - pink(clear, y0)).toBeGreaterThan(pink(hazy, y0 + 30) - pink(clear, y0 + 30));
    // Beyond the reach, nothing changes.
    expect(pink(hazy, y0 + 60)).toBe(pink(clear, y0 + 60));
  });

  it('mirrors bright neon from the wall into the wet floor, and only when the stage asks', () => {
    const { stage, wall } = plain();
    for (let y = stage.backdrop.horizonY - 14; y < stage.backdrop.horizonY; y++) for (let x = 100; x < 140; x++) setRgb(wall, x, y, [255, 40, 200]);
    const off = paintFloor(wall, stage);
    stage.floor.neonSpill = { reach: 26, strength: 1, streaks: 0 };
    const on = paintFloor(wall, stage);
    const pinkish = (r: Raw): number => {
      let n = 0;
      for (let y = stage.backdrop.horizonY + 2; y < stage.backdrop.horizonY + 30; y++) for (let x = 100; x < 140; x++) if (getRgb(r, x, y)[0] > 100) n++;
      return n;
    };
    expect(pinkish(on)).toBeGreaterThan(pinkish(off));
    // Under the sign, not elsewhere.
    expect(getRgb(on, 300, stage.backdrop.horizonY + 5)).toEqual(getRgb(off, 300, stage.backdrop.horizonY + 5));
  });
});

describe('walls', () => {
  it('reproject slides the old picture so its kerb row lands on the horizon, fades the sky, and leaves the rest for the floor', () => {
    const stage = clone('street');
    const src = newRaw(SCREEN_W, SCREEN_H, [10, 10, 10]);
    for (let x = 0; x < SCREEN_W; x++) setRgb(src, x, 132, [200, 100, 50]);
    const out = reprojectWall(src, { ...stage, backdrop: { ...stage.backdrop, skyFade: null } });
    expect(getRgb(out, 33, stage.backdrop.horizonY)).toEqual([200, 100, 50]);
    expect(getRgb(out, 33, stage.backdrop.horizonY - 1)).toEqual([10, 10, 10]);
    expect(getRgb(out, 33, stage.backdrop.horizonY + 5)).toEqual([0, 0, 0]);
    const faded = reprojectWall(src, stage);
    let changed = 0;
    for (let x = 0; x < SCREEN_W; x++) if (getRgb(faded, x, 0).join() !== getRgb(out, x, 0).join()) changed++;
    expect(changed).toBeGreaterThan(SCREEN_W * 0.5);
    for (let x = 0; x < SCREEN_W; x++) expect(getRgb(faded, x, 30).join()).toBe(getRgb(out, x, 30).join());
  });

  it('the sewer’s side wall is a complete picture: lit grate in the middle, water along the base, deterministic', () => {
    expect(WALL_IDS).toContain('sewer-sidewall');
    expect(WALL_IDS).toContain(stageOf(file, 'sewer').backdrop.wallId);
    const wall = paintWall('sewer-sidewall', 100);
    expect(wall.w).toBe(SCREEN_W);
    expect(same(wall, paintWall('sewer-sidewall', 100))).toBe(true);
    for (let y = 0; y < 100; y += 9) expect(alphaAt(wall, 11, y)).toBe(255);
    const grate = getRgb(wall, 232, 52); // inside the grate
    expect(grate[1]).toBeGreaterThan(grate[0]);
    const water = getRgb(wall, 20, 92);
    expect(water[1]).toBeGreaterThan(water[0]);
    expect(() => paintWall('nowhere', 100)).toThrow(/No wall painter/);
  });
});

describe('shadows and rings', () => {
  const style = (stageOf(file, 'street').shadow);

  it('a shadow is centred in an even-sized picture, strongest at the middle, and wider ovals use more pixels', () => {
    for (const w of [16, 22, 33, 40, 75]) {
      const size = shadowSize(w, style.aspect);
      expect(size.w % 2).toBe(0);
      expect(size.h % 2).toBe(0);
      const s = shadowRaw(w, style);
      expect(s.w).toBe(size.w);
      expect(alphaAt(s, s.w / 2, s.h / 2)).toBe(Math.round(style.alpha * 255));
      expect(alphaAt(s, 0, 0)).toBe(0);
    }
    const count = (r: Raw): number => r.data.reduce((n, _v, i) => (i % 4 === 3 && (r.data[i] ?? 0) > 0 ? n + 1 : n), 0);
    expect(count(shadowRaw(40, style))).toBeGreaterThan(count(shadowRaw(20, style)));
  });

  it('a shadow’s rim is stippled and weaker than its middle', () => {
    const s = shadowRaw(40, style);
    const levels = new Set<number>();
    for (let i = 3; i < s.data.length; i += 4) if ((s.data[i] ?? 0) > 0) levels.add(s.data[i] ?? 0);
    expect([...levels].sort((a, b) => a - b)).toEqual([Math.round(style.edgeAlpha * 255), Math.round(style.alpha * 0.62 * 255), Math.round(style.alpha * 0.82 * 255), Math.round(style.alpha * 255)].sort((a, b) => a - b));
  });

  it('a ring is a one-pixel outline in its colour; a dotted ring is the same circle made of separate dots', () => {
    const solid = ringRaw(40, '#3fe0f0', false);
    const dots = ringRaw(40, '#3fe0f0', true);
    expect(solid.w).toBe(ringSize(40).w);
    const lit = (r: Raw): number => r.data.reduce((n, _v, i) => (i % 4 === 3 && (r.data[i] ?? 0) > 0 ? n + 1 : n), 0);
    expect(lit(solid)).toBeGreaterThan(40);
    expect(lit(dots)).toBeLessThan(lit(solid));
    // The middle of a ring is empty; every lit pixel of the solid ring is fully opaque and the right colour.
    expect(alphaAt(solid, solid.w / 2, solid.h / 2)).toBe(0);
    for (let i = 0; i < solid.data.length; i += 4) if ((solid.data[i + 3] ?? 0) > 0) expect([solid.data[i], solid.data[i + 1], solid.data[i + 2], solid.data[i + 3]]).toEqual([0x3f, 0xe0, 0xf0, 255]);
  });
});

describe('faces', () => {
  const block = (colors: Array<[number, number, number] | null>): Raw => {
    const r = newRaw(2, 2);
    colors.forEach((c, i) => {
      if (c) r.data.set([c[0], c[1], c[2], 255], i * 4);
    });
    return r;
  };

  it('shrinking by 2 keeps the commonest colour of each 2x2 block, the darker on a tie, and drops mostly empty blocks', () => {
    expect(modeDown(block([[9, 9, 9], [9, 9, 9], [200, 0, 0], null]), 2).data.slice(0, 4)).toEqual(new Uint8ClampedArray([9, 9, 9, 255]));
    expect(modeDown(block([[200, 0, 0], [10, 10, 10], null, null]), 2).data.slice(0, 4)).toEqual(new Uint8ClampedArray([10, 10, 10, 255]));
    expect(modeDown(block([[200, 0, 0], null, null, null]), 2).data[3]).toBe(0);
  });

  it('a grain-1 face is the square of pixels around the face point; a grain-2 face is cut twice as big, on the 2 px grid, and shrunk', () => {
    const src = newRaw(40, 40);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) src.data.set([x * 6, y * 6, 0, 255], (y * 40 + x) * 4);
    const f1 = cutFace(src, { x: 20, y: 20 }, 8, 1);
    expect([f1.w, f1.h]).toEqual([8, 8]);
    expect(Array.from(f1.data.slice(0, 4))).toEqual([16 * 6, 16 * 6, 0, 255]);
    const f2 = cutFace(src, { x: 21, y: 21 }, 8, 2);
    expect([f2.w, f2.h]).toEqual([8, 8]);
    expect(alphaAt(f2, 0, 0)).toBe(255);
    // Off the picture is empty, not wrapped.
    expect(alphaAt(cutFace(src, { x: 2, y: 2 }, 8, 1), 0, 0)).toBe(0);
  });

  it('every hero and enemy that can appear has a face point', () => {
    expect(Object.keys(CREW_FACES).sort()).toEqual(['hex', 'kit', 'rook', 'sable']);
    for (const s of Object.values(file)) for (const roster of Object.values(s.demo.rosters)) expect(roster.length).toBeGreaterThan(0);
    expect(Object.keys(ENEMY_FACES)).toEqual(expect.arrayContaining(['punk', 'rat', 'warden', 'lurker', 'ghoul']));
  });
});

describe('pixel helpers', () => {
  it('the dither threshold spreads any strength evenly: a strength of s lights about s of every 4x4 block', () => {
    for (const s of [0.125, 0.25, 0.5, 0.75]) {
      let n = 0;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (th(x, y) < s) n++;
      expect(n / 16).toBeCloseTo(s, 1);
    }
  });

  it('a seeded generator repeats its run for the same seed and differs for another', () => {
    const a = seeded(7);
    const b = seeded(7);
    const c = seeded(8);
    const run = (r: () => number): number[] => Array.from({ length: 5 }, r);
    expect(run(a)).toEqual(run(b));
    expect(run(seeded(7))).not.toEqual(run(c));
    for (const v of run(seeded(1))) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
