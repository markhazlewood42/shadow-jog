/**
 * The battle stage slice's own numbers and its place in the code base (src/battlestage, step B1 of the engine-platform spike). The
 * pure modules it brought from the Phaser spike have their own tests (tests/stage*.test.ts, ported unchanged but for the folder name);
 * the Figure is in tests/battlestage-figure.test.ts; the picture is in e2e/sjestage.spec.ts.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../src/data/enemies';
import { enemySlots, stageOf } from '../src/battlestage/config';
import { CREW_IDS } from '../src/battlestage/crew';
import { enemyIdle, idleFrame } from '../src/battlestage/idle';
import slice from '../src/battlestage/slice.json';
import { fixtureStages, shippedStages } from './stagefiles';

const ROOT = resolve(import.meta.dirname, '..');

describe('the B1 slice (src/battlestage/slice.json)', () => {
  it('names one stage, one hero (Kit) and one enemy (the punk), the HUD off', () => {
    expect(slice.stageId).toBe('street');
    expect(slice.lineup).toEqual(['kit']);
    expect(slice.enemies).toEqual(['rustfang_punk']);
    expect(slice.setKey).toBe('1');
  });

  it('is made of things that exist: the stage, the crew member, the enemy, and a slot for each', () => {
    for (const stages of [shippedStages(), fixtureStages()]) {
      const stage = stageOf(stages, slice.stageId);
      for (const id of slice.lineup) expect(CREW_IDS).toContain(id);
      expect(stage.party.length).toBeGreaterThanOrEqual(slice.lineup.length);
      for (const key of slice.enemies) expect(ENEMIES[key], `enemy ${key}`).toBeDefined();
      expect(enemySlots(stage, slice.setKey)).toHaveLength(slice.enemies.length);
      expect(slice.active).toBeGreaterThanOrEqual(0);
      expect(slice.active).toBeLessThan(slice.lineup.length);
      expect(slice.target).toBeGreaterThanOrEqual(0);
      expect(slice.target).toBeLessThan(slice.enemies.length);
    }
  });

  it('compares three ticks: the first picture, a mid-idle one and a later one, in order, where the animation really is somewhere else each time', () => {
    const t = slice.ticks;
    expect(t).toHaveLength(3);
    expect(t[0]).toBe(0);
    expect([...t].sort((a, b) => a - b)).toEqual(t);
    expect(new Set(t).size).toBe(3);
    // The stand-in hero's sheet is 8 frames at 8 fps: the three ticks show three different frames (so a wrong frame rule cannot hide in a still).
    const frames = t.map((tick) => idleFrame(tick, 8, 8, 0));
    expect(new Set(frames).size).toBe(3);
    // And the enemy has moved from where it stood at the start by the later ticks (some kind of idle motion is in the picture).
    const punk = ENEMIES[slice.enemies[0] ?? '']?.sprite ?? 'punk';
    expect(punk).toBeTruthy();
    const kinds = ['bob', 'hover', 'sway', 'breathe', 'flicker'] as const;
    expect(kinds.some((k) => t.some((tick) => enemyIdle(k, tick, 0).y !== 0 || enemyIdle(k, tick, 0).x !== 0))).toBe(true);
  });

  it('has a seed (a whole number: it is the floor seed of the references)', () => {
    expect(Number.isInteger(slice.seed)).toBe(true);
    expect(stageOf(shippedStages(), slice.stageId).floor.seed).toBeTypeOf('number');
  });
});

describe('the modules brought over from the spike are pure', () => {
  /** The pure modules of the spike. Their header comments still say "Phaser spike": they are records. `Raw` is the engine's `{ w, h, data }` in them (M3 decision 6), the only change. */
  const COPIED = ['hudpresets', 'feet', 'floor', 'shadow', 'rules', 'proportions', 'facing', 'crew', 'known', 'pixels', 'faces', 'sewerwall', 'idle'];

  it('none of the copied modules imports Phaser (or Pixi, or the engine): they are pure', () => {
    for (const name of COPIED) {
      const text = readFileSync(join(ROOT, 'src/battlestage', `${name}.ts`), 'utf8');
      const imports = [...text.matchAll(/^\s*import[^'"\n]*from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? '');
      expect(imports.filter((s) => /^(phaser|pixi\.js|three)/.test(s) || /\/sje(\/|$)/.test(s)), `${name}.ts`).toEqual([]);
    }
  });
});

describe('config.ts uses the engine for the draw order (M3 task 3)', () => {
  it('takes exactly `depthFor` and `PART` from the facade, and has no other engine import', () => {
    const text = readFileSync(join(ROOT, 'src/battlestage/config.ts'), 'utf8');
    const engine = [...text.matchAll(/^\s*import\s*\{([^}]*)\}\s*from\s*['"]\.\.\/sje['"]/gm)].map((m) => (m[1] ?? '').trim());
    expect(engine).toEqual(['depthFor as engineDepthFor, PART']);
    // And it holds no formula of its own: the engine's `y * 1000` is not written in config.ts.
    expect(text).not.toMatch(/y \* 1000/);
  });
});

describe('the stage picture’s name (stagePictureKey)', () => {
  it('names a stage picture after what decides how it looks: the same config gives the same name, and a change to the floor, the rows or a slot gives another', async () => {
    const { stagePictureKey } = await import('../src/battlestage/textures');
    const stage = stageOf(fixtureStages(), 'street');
    const key = stagePictureKey(stage);
    expect(key).toMatch(/^stage-street-[0-9a-z]+$/);
    expect(stagePictureKey(structuredClone(stage))).toBe(key);
    expect(stagePictureKey({ ...stage, floor: { ...stage.floor, seed: (stage.floor.seed ?? 0) + 1 } }), 'another floor seed').not.toBe(key);
    expect(stagePictureKey({ ...stage, rows: stage.rows.map((r, i) => (i === 0 ? { ...r, y: r.y + 1 } : r)) }), 'a row moved').not.toBe(key);
    const party = stage.party.map((p, i) => (i === 0 ? { ...p, x: p.x + 1 } : p));
    expect(stagePictureKey({ ...stage, party }), 'a slot moved (the puddles keep clear of the slots)').not.toBe(key);
    // The draw order of a slot does not change the picture, so it does not change the name.
    const reordered = stage.party.map((p, i) => (i === 0 ? { ...p, order: 1 as const } : p));
    expect(stagePictureKey({ ...stage, party: reordered }), 'a slot’s draw order').toBe(key);
    // `slotsFrom` (a drag in an editor): the picture is painted from the OLD slots, so the name follows them.
    expect(stagePictureKey({ ...stage, party }, stage)).toBe(key);
  });
});
