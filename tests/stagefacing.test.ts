/**
 * Enemy facing (Phaser spike `spike/phaser-stage`): the `enemyfacing.json` loader and its coverage rule, the pure maths
 * that mirrors a figure's measurements about its feet, and how the editor's Mirror switch saves.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENEMY_ART_KEYS } from '../src/art/enemies';
import { ENEMIES } from '../src/data/enemies';
import { setMirror } from '../src/stage/edit/model';
import { FACING_FILE, formatFacing, prepareSave } from '../src/stage/edit/save';
import { Session } from '../src/stage/edit/session';
import { checkFacing, ENEMY_SPRITES, flipRaw, type FacingFile, figureFor, isMirrored, loadFacing, mirrorFigure } from '../src/stage/facing';
import type { FigureArt } from '../src/stage/textures';
import { formatJson } from '../src/tools/jsonfmt';
import { fixtureEntries, fixtureFacing, fixtureFacingJson, fixtureHeroes, fixtureHud, shippedFacing, shippedFacingJson } from './stagefiles';

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// Mark's file, as it is now: invariants only (it loads, it covers every sprite). Whether a sprite is mirrored is his call.
describe('the shipped enemy facing file', () => {
  it('passes the loader', () => {
    expect(checkFacing(copy(shippedFacingJson))).toEqual([]);
    expect(() => loadFacing(copy(shippedFacingJson))).not.toThrow();
  });

  it('has an entry for every sprite key any enemy uses', () => {
    const file = shippedFacing();
    for (const e of Object.values(ENEMIES)) expect(file[e.sprite], `${e.id} uses the sprite "${e.sprite}"`).toBeDefined();
  });

  it('has no entry for a sprite nothing uses, and every sprite is one the art generator can draw', () => {
    expect(Object.keys(shippedFacing()).sort()).toEqual([...ENEMY_SPRITES].sort());
    for (const key of ENEMY_SPRITES) expect(ENEMY_ART_KEYS, key).toContain(key);
  });

  it('is written in the stable format, so saving without a change changes nothing', () => {
    const text = readFileSync(new URL('../src/data/enemyfacing.json', import.meta.url), 'utf8');
    expect(formatFacing(JSON.parse(text))).toBe(text);
  });
});

describe('the fixture enemy facing file', () => {
  it('passes the loader and covers every sprite', () => {
    expect(checkFacing(copy(fixtureFacingJson))).toEqual([]);
    expect(Object.keys(fixtureFacing()).sort()).toEqual([...ENEMY_SPRITES].sort());
    expect(ENEMY_SPRITES.length).toBe(21);
  });

  it('says in a sentence why each sprite is or is not mirrored', () => {
    for (const [key, e] of Object.entries(fixtureFacing())) expect(e.note.length, key).toBeGreaterThan(20);
  });

  it('mirrors a sprite exactly when its entry says so', () => {
    const file = fixtureFacing();
    for (const [key, e] of Object.entries(file)) expect(isMirrored(file, key), key).toBe(e.mirror);
    expect(isMirrored(file, 'no-such-sprite')).toBe(false);
  });
});

describe('checking a facing file', () => {
  const sprites = ['punk', 'rat'];
  const good = (): FacingFile => ({
    punk: { mirror: true, facing: 'front', note: 'The club points right.' },
    rat: { mirror: false, facing: 'left', note: 'Side view, nose on the left.' },
  });

  it('accepts a good file', () => {
    expect(checkFacing(good(), sprites)).toEqual([]);
  });

  it('refuses a file that is not an object', () => {
    expect(checkFacing([], sprites)[0]).toMatch(/must be an object/);
    expect(checkFacing(null, sprites)[0]).toMatch(/must be an object/);
  });

  it('names a sprite with no entry', () => {
    const f = good() as Record<string, unknown>;
    delete f.rat;
    expect(checkFacing(f, sprites)).toEqual(['enemy facing: no entry for the sprite "rat" (every enemy sprite needs one)']);
  });

  it('names an entry no enemy uses', () => {
    const f = { ...good(), ghost: { mirror: false, facing: 'front', note: 'Nothing uses this.' } };
    expect(checkFacing(f, sprites)).toEqual(['enemy facing "ghost": no enemy uses this sprite']);
  });

  it('refuses a mirror that is not true or false, a facing that is not a direction, and an empty note', () => {
    const f = copy(good()) as unknown as Record<string, Record<string, unknown>>;
    (f.punk as Record<string, unknown>).mirror = 'yes';
    (f.rat as Record<string, unknown>).facing = 'up';
    (f.rat as Record<string, unknown>).note = '  ';
    const problems = checkFacing(f, sprites);
    expect(problems).toContain('enemy facing "punk": mirror must be true or false');
    expect(problems).toContain('enemy facing "rat": facing must be "left", "right" or "front"');
    expect(problems).toContain('enemy facing "rat": note must say in a sentence why');
  });

  it('loads with one readable error listing every problem', () => {
    expect(() => loadFacing({}, sprites)).toThrow(/enemyfacing\.json is not valid[\s\S]*"punk"[\s\S]*"rat"/);
  });
});

// ------------------------------------------------------------------ mirroring a figure

/** A 10 x 6 picture with a lopsided shape: a 3 px wide body (columns 3-5), feet at column 4, and a "club" sticking out to the right (columns 6-8, row 1). */
function lopsided(): FigureArt {
  const w = 10;
  const h = 6;
  const px = new Uint8ClampedArray(w * h * 4);
  const put = (x: number, y: number, r: number): void => {
    const i = (y * w + x) * 4;
    px[i] = r;
    px[i + 3] = 255;
  };
  for (let y = 0; y < h; y++) for (let x = 3; x <= 5; x++) put(x, y, 10 + x);
  for (let x = 6; x <= 8; x++) put(x, 1, 100 + x);
  return { raw: { w, h, px }, box: { x0: 3, x1: 8, y0: 0, y1: 5, feet: 4.5 }, foot: { x: 4, y: 6 }, face: { x: 4, y: 1 }, head: { x: 3, y: 0, w: 3, h: 3 }, grain: 2 };
}

describe('mirroring a figure about its feet', () => {
  it('reverses the pixels left-to-right and nothing else', () => {
    const f = lopsided();
    const flipped = flipRaw(f.raw);
    expect(flipped.w).toBe(10);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 10; x++) for (let c = 0; c < 4; c++) expect(flipped.px[(y * 10 + (9 - x)) * 4 + c]).toBe(f.raw.px[(y * 10 + x) * 4 + c]);
  });

  it('puts the club on the left, the same distance from the feet', () => {
    const m = mirrorFigure(lopsided());
    // The club's far tip was 8 - 4 = 4 px right of the foot column's left edge; now it is the same distance left of the mirrored foot.
    const before = lopsided();
    expect(m.foot.x).toBe(10 - before.foot.x);
    expect(m.box.x0 - m.foot.x).toBe(-(before.box.x1 + 1 - before.foot.x));
    expect(m.box.x1 + 1 - m.foot.x).toBe(-(before.box.x0 - before.foot.x));
    expect(m.box.y0).toBe(before.box.y0);
    expect(m.box.y1).toBe(before.box.y1);
    expect(m.foot.y).toBe(before.foot.y);
  });

  it('keeps the box true to the pixels it describes', () => {
    const m = mirrorFigure(lopsided());
    let x0 = 99;
    let x1 = -1;
    for (let y = 0; y < m.raw.h; y++) for (let x = 0; x < m.raw.w; x++) if ((m.raw.px[(y * m.raw.w + x) * 4 + 3] ?? 0) > 0) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    expect(m.box.x0).toBe(x0);
    expect(m.box.x1).toBe(x1);
  });

  it('moves the face point and the head crop to the mirrored place', () => {
    const f = lopsided();
    const m = mirrorFigure(f);
    expect(m.face).toEqual({ x: 10 - 1 - f.face.x, y: f.face.y });
    expect(m.head).toEqual({ x: 10 - 3 - 3, y: 0, w: 3, h: 3 });
    // The face point still lands on a drawn pixel of the mirrored picture.
    expect(m.raw.px[(m.face.y * m.raw.w + m.face.x) * 4 + 3]).toBe(255);
  });

  it('mirrored twice is the original', () => {
    const f = lopsided();
    const twice = mirrorFigure(mirrorFigure(f));
    expect(twice.box).toEqual(f.box);
    expect(twice.foot).toEqual(f.foot);
    expect(twice.face).toEqual(f.face);
    expect(twice.head).toEqual(f.head);
    expect(Array.from(twice.raw.px)).toEqual(Array.from(f.raw.px));
  });

  it('remembers what it came from, and is made once', () => {
    const f = lopsided();
    const m = mirrorFigure(f);
    expect(m.mirrorOf).toBe(f);
    expect(mirrorFigure(f)).toBe(m);
    expect(f.mirrorOf).toBeUndefined();
  });

  it('does not touch the original figure', () => {
    const f = lopsided();
    const before = JSON.stringify({ box: f.box, foot: f.foot, face: f.face, head: f.head });
    const px = Array.from(f.raw.px);
    mirrorFigure(f);
    expect(JSON.stringify({ box: f.box, foot: f.foot, face: f.face, head: f.head })).toBe(before);
    expect(Array.from(f.raw.px)).toEqual(px);
  });

  it('figureFor picks the original or the mirror', () => {
    const f = lopsided();
    expect(figureFor(f, false)).toBe(f);
    expect(figureFor(f, true)).toBe(mirrorFigure(f));
  });

  it('a figure with no head crop stays without one', () => {
    const f = lopsided();
    delete (f as { head?: unknown }).head;
    expect(mirrorFigure(f).head).toBeUndefined();
  });
});

// ------------------------------------------------------------------ the editor's Mirror switch and Save

describe('the Mirror switch in the editor session', () => {
  const make = (): Session => new Session({ stages: fixtureEntries(), axes: {}, hud: fixtureHud(), facing: fixtureFacing(), heroes: fixtureHeroes() }, 'street', formatJson);

  it('is one undo step, marks only the facing file as unsaved, and undo and redo bring it back', () => {
    const se = make();
    const was = se.data.facing.rat?.mirror;
    expect(se.dirtyParts).toEqual([]);
    se.edit('Mirror Glowrat', (d) => setMirror(d, 'rat', !was));
    expect(se.data.facing.rat?.mirror).toBe(!was);
    expect(se.dirtyParts).toEqual(['facing']);
    expect(se.nextUndoLabel).toBe('Mirror Glowrat');
    se.undo();
    expect(se.data.facing.rat?.mirror).toBe(was);
    expect(se.dirty).toBe(false);
    se.redo();
    expect(se.data.facing.rat?.mirror).toBe(!was);
    expect(se.dirtyParts).toEqual(['facing']);
  });

  it('is saved, and "unsaved" clears once the file is written', () => {
    const se = make();
    const was = se.data.facing.rat?.mirror;
    se.edit('Mirror Glowrat', (d) => setMirror(d, 'rat', !was));
    expect(se.saved.facing.rat?.mirror).toBe(was);
    se.markSaved(['facing']);
    expect(se.dirty).toBe(false);
    expect(se.saved.facing.rat?.mirror).toBe(!was);
  });

  it('switching one sprite leaves every other entry as it was', () => {
    const se = make();
    const others = Object.keys(se.data.facing).filter((k) => k !== 'rat');
    se.edit('Mirror Glowrat', (d) => setMirror(d, 'rat', !se.data.facing.rat?.mirror));
    for (const k of others) expect(se.data.facing[k]).toEqual(fixtureFacing()[k]);
  });
});

describe('saving the facing file with the others', () => {
  const body = (): { stages: unknown; axes: unknown; hud: unknown; facing: unknown } => ({ stages: copy(fixtureEntries()), axes: {}, hud: copy(fixtureHud()), facing: fixtureFacing() });

  it('writes it together with the stages, when it is posted', () => {
    const made = prepareSave(body());
    expect(made).toMatchObject({ ok: true });
    if (made.ok) {
      expect(made.write).toEqual(['stages', 'axes', 'hud', 'facing']);
      expect(made.facingText).toBe(formatFacing(fixtureFacing()));
    }
  });

  it('writes only the files named in write', () => {
    const made = prepareSave({ ...body(), write: ['facing'] });
    expect(made).toMatchObject({ ok: true, write: ['facing'] });
  });

  it('leaves the facing file alone when it is not posted', () => {
    const { facing: _unused, ...rest } = body();
    const made = prepareSave(rest);
    expect(made).toMatchObject({ ok: true });
    if (made.ok) {
      expect(made.write).not.toContain('facing');
      expect(made.facingText).toBeUndefined();
    }
  });

  it('refuses a bad facing file, naming the file, and writes nothing', () => {
    const bad = fixtureFacing() as Record<string, unknown>;
    delete bad.rat;
    const made = prepareSave({ ...body(), facing: bad });
    expect(made.ok).toBe(false);
    if (!made.ok) expect(made.problems[0]).toContain(`${FACING_FILE}: enemy facing: no entry for the sprite "rat"`);
  });

  it('refuses a write list that names the facing file when none was posted', () => {
    const { facing: _unused, ...rest } = body();
    expect(prepareSave({ ...rest, write: ['facing'] })).toMatchObject({ ok: false });
  });
});
