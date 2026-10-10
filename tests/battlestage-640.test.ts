/**
 * M3 task 9 (decision 4): the 640x360 stage set. `scripts/stage-640.mjs` makes `src/data/stages-640.json` and `hud-640.json` from the 480x270 files with a fixed
 * transform. This file proves: the committed files are what the transform makes; the set loads through the same checks as the first set (at its own screen size);
 * the numbers moved as the script's header says; the checks reject a bad `screen`, `push` and `wallOffset`; the painters make a picture of the stage's size; the 480x270
 * files were not touched (no `screen`, no `push`, no `wallOffset`). Controls: a changed transform constant fails the comparison with the committed files.
 */
import { describe, expect, it } from 'vitest';
import { ART_KERB_ROW_640, DX, DY, LEGACY_PUSH as SCRIPT_PUSH, make, transformHud, transformStages } from '../scripts/stage-640.mjs';
import { BG_IDS } from '../src/art/battlebg';
import hud640Json from '../src/data/hud-640.json';
import hud480Json from '../src/data/hud.json';
import stages640Json from '../src/data/stages-640.json';
import stages480Json from '../src/data/stages.json';
import { artKerbRow, checkHudFile, checkStageConfig, checkStages, depthFor, loadHud, loadStages, SCREEN_H, SCREEN_W, type StageConfig, screenOf, slotPoint, snapSlot } from '../src/battlestage/config';
import { paintFloor, puddleSpots } from '../src/battlestage/floor';
import { newRaw } from '../src/battlestage/pixels';
import { LEGACY_PUSH } from '../src/battlestage/push';
import { layoutBreaks } from '../src/battlestage/rules';
import { paintWall } from '../src/battlestage/sewerwall';
import { STAGE_KNOWN } from '../src/battlestage/known';
import { H, W } from '../src/sje';

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const known = STAGE_KNOWN;
const hud640 = (): ReturnType<typeof loadHud> => loadHud(copy(hud640Json), { w: W, h: H });
const stages640 = (): Record<string, StageConfig> => loadStages(copy(stages640Json), BG_IDS, known, hud640());

describe('the 640x360 set is what the script makes', () => {
  it('stages-640.json and hud-640.json equal the transform of the committed 480x270 files (compared as data)', () => {
    const made = make();
    expect(made['stages-640.json']).toEqual(stages640Json);
    expect(made['hud-640.json']).toEqual(hud640Json);
  });

  it('CONTROL: one changed number in the made data fails the comparison with the committed file, so the comparison can fail', () => {
    const made = copy(make()['stages-640.json']) as Record<string, { rows: Array<{ y: number }> }>;
    made.street!.rows[0]!.y += 1;
    expect(made).not.toEqual(stages640Json);
    expect(transformStages(copy(stages480Json))).toEqual(stages640Json);
  });

  it('the transform does not change its input (the 480x270 files are the source, byte for byte)', () => {
    const before = JSON.stringify(stages480Json);
    const hudBefore = JSON.stringify(hud480Json);
    transformStages(stages480Json);
    transformHud(hud480Json);
    expect(JSON.stringify(stages480Json)).toBe(before);
    expect(JSON.stringify(hud480Json)).toBe(hudBefore);
  });

  it('the 480x270 files carry no 640 data: no screen, push or wall offset (principle 8)', () => {
    for (const [id, s] of Object.entries(stages480Json as Record<string, Record<string, unknown>>)) {
      expect(s.screen, id).toBeUndefined();
      expect(s.push, id).toBeUndefined();
      expect((s.backdrop as Record<string, unknown>).wallOffset, id).toBeUndefined();
    }
  });
});

describe('what the transform did to the numbers (the script header is the contract)', () => {
  const s480 = stages480Json as unknown as Record<string, StageConfig>;
  const s640 = stages640Json as unknown as Record<string, StageConfig>;

  it('the offsets are the centering offsets: 80 across and 45 down', () => {
    expect(DX).toBe((W - SCREEN_W) / 2);
    expect(DY).toBe((H - SCREEN_H) / 2);
    expect([DX, DY]).toEqual([80, 45]);
  });

  it('every stage: screen 640x360, the legacy push as data, rows down by DY, slots right by DX, floor to the bottom of the larger screen', () => {
    for (const id of Object.keys(s480)) {
      const a = s480[id]!;
      const b = s640[id]!;
      expect(b.screen).toEqual({ w: W, h: H });
      expect(b.push).toEqual(LEGACY_PUSH);
      expect(SCRIPT_PUSH).toEqual(LEGACY_PUSH);
      expect(b.rows.map((r) => r.y)).toEqual(a.rows.map((r) => r.y + DY));
      expect(b.party.map((q) => [q.x, q.row])).toEqual(a.party.map((q) => [q.x + DX, q.row]));
      for (const key of Object.keys(a.enemySets)) expect(b.enemySets[key]?.map((q) => [q.x, q.row, q.size])).toEqual(a.enemySets[key]?.map((q) => [q.x + DX, q.row, q.size]));
      expect(b.backdrop.horizonY).toBe(a.backdrop.horizonY + DY);
      expect(b.floor.y0).toBe(b.backdrop.horizonY);
      expect(b.floor.y1).toBe(H);
      expect(b.floor.stripes?.map((st) => st.y)).toEqual(a.floor.stripes?.map((st) => st.y + DY));
      // Unchanged on purpose: the look numbers the script does not name.
      expect(b.floor.colors).toEqual(a.floor.colors);
      expect(b.floor.grid).toEqual(a.floor.grid);
      expect(b.shadow).toEqual(a.shadow);
      expect(b.depthTint).toEqual(a.depthTint);
      expect(b.demo).toEqual(a.demo);
    }
  });

  it('a reproject backdrop is shifted so the 320x180 art’s kerb row (176) lands on the horizon; a replace wall carries the offset', () => {
    expect(ART_KERB_ROW_640).toBe(artKerbRow({ screen: { w: W, h: H } }));
    const street = s640.street!;
    expect(street.backdrop.mode).toBe('reproject');
    expect(street.backdrop.shiftY).toBe(street.backdrop.horizonY - ART_KERB_ROW_640);
    const sewer = s640.sewer!;
    expect(sewer.backdrop.mode).toBe('replace');
    expect(sewer.backdrop.wallOffset).toEqual({ x: DX, y: DY });
    expect(artKerbRow(s480.street!)).toBe(132);
  });

  it('the HUD is centered: every box moves right by DX; the lower boxes sit on the bottom edge, the upper ones keep their top', () => {
    const a = (hud480Json as unknown as { layout: Record<string, { x: number; y: number; w: number; h: number }> }).layout;
    const b = (hud640Json as unknown as { layout: Record<string, { x: number; y: number; w: number; h: number }> }).layout;
    for (const k of ['turnOrder', 'commands', 'partyStatus', 'enemyInfo', 'banner', 'combo']) {
      expect(b[k]?.x, k).toBe(a[k]!.x + DX);
      expect(b[k]?.w, k).toBe(a[k]!.w);
      expect(b[k]?.h, k).toBe(a[k]!.h);
      expect(b[k]?.y, k).toBe(a[k]!.y >= SCREEN_H / 2 ? a[k]!.y + 2 * DY : a[k]!.y);
    }
    // The bottom band keeps its height above the bottom edge (the HUD limit is the same 44).
    expect(H - b.partyStatus!.y).toBe(SCREEN_H - a.partyStatus!.y);
  });
});

describe('the set loads through the same checks, at its own size', () => {
  it('both files pass the checks (the HUD with the 640x360 screen)', () => {
    expect(checkHudFile(hud640Json, { w: W, h: H })).toEqual([]);
    expect(checkStages(stages640Json, BG_IDS, known)).toEqual([]);
    const loaded = stages640();
    expect(Object.keys(loaded)).toEqual(['street', 'sewer']);
    for (const s of Object.values(loaded)) expect(checkStageConfig(s, BG_IDS, known)).toEqual([]);
  });

  it('the 640 HUD does not fit the 480x270 screen (the size is checked, not ignored), and the 480 HUD still does', () => {
    expect(checkHudFile(hud640Json).join('\n')).toContain('reaches past');
    expect(checkHudFile(hud480Json)).toEqual([]);
  });

  it('the design rules pass at 640x360 as they do at 480x270 (the limits move by the centering offset)', () => {
    for (const s of Object.values(stages640())) expect(layoutBreaks(s), s.id).toEqual([]);
  });

  it('rejects a screen the art cannot paint, a bad push and a bad wall offset, in plain words', () => {
    const bad = (edit: (s: Record<string, unknown>) => void): string => {
      const d = copy(stages640Json) as Record<string, Record<string, unknown>>;
      edit(d.street!);
      return checkStages(d, BG_IDS, known).join('\n');
    };
    expect(bad((s) => { s.screen = { w: 500, h: 300 }; })).toContain('screen: must be one of 480x270, 640x360');
    expect(bad((s) => { (s.push as Record<string, unknown>).lifeFrames = 3; })).toContain('lifeFrames: must be more than rampFrames');
    expect(bad((s) => { (s.push as Record<string, unknown>).zoom = 2; })).toContain('push.zoom');
    expect(bad((s) => { (s.backdrop as Record<string, unknown>).wallOffset = { x: 1000, y: 0 }; })).toContain('wallOffset.x');
    // A y past the larger screen is refused, a y past the smaller one is fine on the larger.
    expect(bad((s) => { (s.floor as Record<string, unknown>).y1 = 361; })).toContain('floor.y1');
    // The same stage with no `screen` is a 480x270 stage, and the larger numbers do not fit it.
    expect(bad((s) => { delete s.screen; })).toContain('must be a whole number');
  });
});

describe('the painters follow the stage’s screen', () => {
  it('slots and the draw order use the stage’s width', () => {
    const s = stages640().street!;
    expect(slotPoint(s, { x: 900, row: 0 }).x).toBe(W);
    expect(snapSlot(s, 'enemy', 100, 200).x).toBe(W / 2);
    // The tie-break is "how close to the middle of the screen": the middle of the larger screen is 320.
    expect(depthFor(200, 320, 'party', 0, W)).toBeGreaterThan(depthFor(200, 240, 'party', 0, W));
    expect(depthFor(200, 240, 'party', 0)).toBeGreaterThan(depthFor(200, 320, 'party', 0));
  });

  it('paintFloor and paintWall make a picture of the stage’s size, opaque, and puddles stay on the screen and above the HUD band', () => {
    for (const s of Object.values(stages640())) {
      const wall = s.backdrop.mode === 'replace' ? paintWall(s.backdrop.wallId ?? '', s.backdrop.horizonY, screenOf(s), s.backdrop.wallOffset) : newRaw(W, H, [40, 40, 60]);
      expect([wall.w, wall.h]).toEqual([W, H]);
      const img = paintFloor(wall, s);
      expect([img.w, img.h]).toEqual([W, H]);
      for (let i = 3; i < img.data.length; i += 4 * 997) expect(img.data[i]).toBe(255);
      for (const p of puddleSpots(s, () => 0.5, s.floor.y0 + 2, 5)) {
        expect(p.cx).toBeGreaterThanOrEqual(20);
        expect(p.cx).toBeLessThanOrEqual(W - 20);
        expect(p.cy).toBeLessThanOrEqual(224 + (H - SCREEN_H));
      }
    }
  });

  it('the sewer wall painted for 640x360 is the 480x270 wall moved by the offset, with the edges repeated outwards', () => {
    const s = stages640().sewer!;
    const off = s.backdrop.wallOffset!;
    const big = paintWall('sewer-sidewall', s.backdrop.horizonY, screenOf(s), off);
    const small = paintWall('sewer-sidewall', s.backdrop.horizonY - off.y);
    const px = (r: { w: number; data: Uint8ClampedArray }, x: number, y: number): number[] => [0, 1, 2].map((c) => r.data[(y * r.w + x) * 4 + c] ?? -1);
    for (const [x, y] of [[0, 0], [100, 60], [479, 100], [200, 269]] as const) expect(px(big, x + off.x, y + off.y), `${x},${y}`).toEqual(px(small, x, y));
    // Outside the placed wall the nearest edge pixel is repeated.
    expect(px(big, 0, 100)).toEqual(px(small, 0, 100 - off.y));
    expect(px(big, W - 1, 200)).toEqual(px(small, SCREEN_W - 1, 200 - off.y));
    expect(px(big, 300, 0)).toEqual(px(small, 300 - off.x, 0));
  });
});

describe('a stage for the stage set is chosen from the page address', () => {
  it('the 640x360 set unless the address asks for the 480x270 one (the pictures of the look review)', async () => {
    const { stageSetFromSearch } = await import('../src/battlestage/liveopen');
    expect(stageSetFromSearch('?engine=sje')).toBe('640');
    expect(stageSetFromSearch('')).toBe('640');
    expect(stageSetFromSearch('?engine=sje&stageset=480')).toBe('480');
    expect(stageSetFromSearch('?stageset=999')).toBe('640');
  });
});
