/**
 * The field's look data (M5 round 1, finding F1): `src/data/fieldlook.json` holds every tunable look value of the field stage that the map data and the old
 * lighting config do not hold. Four things are proved here:
 *  1. The loaded values equal the constants the code held before the move (written out below as plain literals, copied from the old `params.ts`, `stagescene.ts`
 *     and `lights.ts`), so the look did not change.
 *  2. `checkFieldLook` and `loadFieldLook` reject bad data, naming the field (every edit below is one bad change; a clean file gives no problem).
 *  3. The flicker the engine computes from the loaded numbers equals the old function with its numbers inline.
 *  4. No look number hides in the code: the stage's sources no longer name the old constants.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import raw from '../src/data/fieldlook.json' with { type: 'json' };
import { checkFieldLook, FIELD_LOOK, loadFieldLook } from '../src/data/fieldlook';
import { flickerAmount as oldFlicker } from '../src/field/lighting';
import { flickerAmount } from '../src/sje/display/lights';

const clone = (): Record<string, any> => JSON.parse(JSON.stringify(raw));

describe('fieldlook.json: the loaded values equal the old constants', () => {
  it('shadow, glow, bloom, chest halo and pulse', () => {
    expect(FIELD_LOOK.shadow).toEqual({ color: 0x05040c, alpha: 0.5, rects: [[-4, -1, 9, 2], [-3, -2, 7, 1], [-3, 1, 7, 1]] });
    expect(FIELD_LOOK.glow).toEqual({ interior: 0.5, outdoors: 0.9 });
    expect(FIELD_LOOK.bloom).toEqual({ outdoors: 0.14, interior: 0.08 });
    expect(FIELD_LOOK.chest.haloAt).toEqual({ x: -12, y: -4 });
    expect(FIELD_LOOK.chest.pulse).toEqual({ base: 0.5, swing: 0.3, rate: 0.06, phase: 1.7 });
  });

  it('the glint: timing, color and the pixel shape (the old inline fillRect calls)', () => {
    const g = FIELD_LOOK.chest.glint;
    expect([g.period, g.length, g.tileX, g.tileY]).toEqual([160, 10, 37, 53]);
    expect(g.color).toBe(0xffffff);
    // Old: fillRect(2 + g, 6, 1, 1); while 2 < g < 8: fillRect(2 + g, 5, 1, 3) and fillRect(1 + g, 6, 3, 1).
    expect(g.dot).toEqual([2, 6, 1, 1]);
    expect([g.starAfter, g.starBefore]).toEqual([2, 8]);
    expect(g.star).toEqual([[2, 5, 1, 3], [1, 6, 3, 1]]);
  });

  it('the lights: sprite boost and the flicker numbers', () => {
    expect(FIELD_LOOK.lights.spriteBoost).toBe(0.32);
    expect(FIELD_LOOK.lights.flicker).toEqual({ base: 0.85, wobbleSlow: 0.06, rateSlow: 0.13, wobbleFast: 0.05, rateFast: 0.47, dropEvery: 997, dropBelow: 12, dropTo: 0.35 });
  });

  it('the engine flicker from the loaded numbers equals the old function with its numbers inline', () => {
    const base = { r: 1, color: '#fff', i: 1, flicker: true };
    const lights = [{ ...base, x: 0, y: 0 }, { ...base, x: 300, y: 200, seed: 17 }, { ...base, x: 41, y: 977 }];
    for (const l of lights) for (let f = 0; f < 4000; f++) expect(flickerAmount(l, f, FIELD_LOOK.lights.flicker)).toBe(oldFlicker(l, f));
  });

  it('the shipped file is clean', () => {
    expect(checkFieldLook(raw)).toEqual([]);
  });
});

describe('checkFieldLook and loadFieldLook refuse bad data', () => {
  const edits: [string, (d: Record<string, any>) => void, string][] = [
    ['a section is missing', (d) => delete d.shadow, 'shadow: must be an object'],
    ['an unknown section', (d) => (d.extra = {}), '"extra" is not a section'],
    ['an unknown field', (d) => (d.glow.size = 1), 'glow: "size" is not a field here'],
    ['a shadow color that is not a hex color', (d) => (d.shadow.color = 'black'), 'shadow.color'],
    ['a shadow alpha above 1', (d) => (d.shadow.alpha = 1.5), 'shadow.alpha'],
    ['no shadow rectangles', (d) => (d.shadow.rects = []), 'shadow.rects'],
    ['a rectangle with a fraction', (d) => (d.shadow.rects[0] = [0.5, 0, 1, 1]), 'shadow.rects[0]'],
    ['a rectangle with no width', (d) => (d.shadow.rects[1] = [0, 0, 0, 1]), 'width and height'],
    ['a glow that is text', (d) => (d.glow.interior = '0.5'), 'glow.interior: must be a number'],
    ['a negative bloom', (d) => (d.bloom.outdoors = -0.1), 'bloom.outdoors'],
    ['a pulse that leaves 0 to 1', (d) => (d.chest.pulse.swing = 0.9), 'chest.pulse'],
    ['a glint period of 0', (d) => (d.chest.glint.period = 0), 'chest.glint.period'],
    ['a glint longer than its period', (d) => (d.chest.glint.length = 200), 'chest.glint.length'],
    ['a star window that is empty', (d) => (d.chest.glint.starAfter = 8), 'starAfter must be below starBefore'],
    ['a glint color that is not hex', (d) => (d.chest.glint.color = 'white'), 'chest.glint.color'],
    ['a sprite boost above 1', (d) => (d.lights.spriteBoost = 2), 'lights.spriteBoost'],
    ['a flicker rate that is NaN', (d) => (d.lights.flicker.rateSlow = Number.NaN), 'lights.flicker.rateSlow'],
    ['a dropout that never ends', (d) => (d.lights.flicker.dropBelow = 2000), 'dropBelow'],
    ['a dropout level above 1', (d) => (d.lights.flicker.dropTo = 1.5), 'dropTo'],
    ['a flicker that goes below 0', (d) => (d.lights.flicker.base = 0.05), 'below 0'],
  ];

  for (const [name, edit, word] of edits) {
    it(`refuses ${name}`, () => {
      const d = clone();
      edit(d);
      const problems = checkFieldLook(d);
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.join('\n')).toContain(word);
      expect(() => loadFieldLook(d)).toThrow(word);
    });
  }

  it('refuses a file that is not an object, and an unedited copy still loads (the control)', () => {
    expect(checkFieldLook(null)).toHaveLength(1);
    expect(checkFieldLook([])).toHaveLength(1);
    expect(() => loadFieldLook('x')).toThrow('fieldlook');
    expect(loadFieldLook(clone())).toEqual(FIELD_LOOK);
  });

  it('a color string is turned into a number only by the loader', () => {
    const d = clone();
    d.shadow.color = '#102030';
    expect(loadFieldLook(d).shadow.color).toBe(0x102030);
  });
});

describe('no look number hides in the stage code', () => {
  const read = (p: string): string => readFileSync(resolve(import.meta.dirname, '..', p), 'utf8');

  it('params.ts holds the layer table only, and the stage names no old constant', () => {
    const params = read('src/fieldstage/params.ts');
    for (const name of ['SHADOW', 'GLOW', 'BLOOM', 'CHEST_HALO_AT', 'CHEST_PULSE', 'CHEST_GLINT']) expect(params).not.toContain(`export const ${name}`);
    const stage = read('src/fieldstage/stagescene.ts');
    expect(stage).not.toMatch(/\b(CHEST_GLINT|CHEST_PULSE|CHEST_HALO_AT)\b/);
    // The glint pixel shape and its color are data now: no inline fillRect numbers for it, no 0xffffff.
    expect(stage).not.toContain('fillRect(2 + g');
    expect(stage).not.toContain('0xffffff');
  });

  it('the engine lights hold no flicker number', () => {
    const lights = read('src/sje/display/lights.ts');
    expect(lights).not.toMatch(/0\.85 \+|\* 0\.13|\* 0\.47|% 997|\? 0\.35/);
  });

  it('control: the scan sees a number that is there (the old function still has them)', () => {
    expect(read('src/field/lighting.ts')).toMatch(/0\.13/);
  });
});
