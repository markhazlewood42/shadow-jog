/**
 * The battle stage's Figure (src/battlestage/figure.ts) against the REAL engine display classes, in Node (no GPU, no canvas). Step B1 of
 * the engine-platform spike. The texture helpers that need a browser canvas (`shadowTexture`, `ringTexture`, `hazedTexture`) are replaced by
 * versions that register a fake canvas; everything else is the real engine: `Container`, `ImageObject`, `Sprite`, `TextureManager`, depth.
 *
 * What it pins: where a figure stands, what depth it draws at, the parts sorting inside it (shadow, ring, body), the mirror (the anchor rule),
 * the hero's idle frame and the enemy's sway as functions of the tick, the ring rules, and that destroying a figure frees its textures' users.
 * The picture itself (parity with the Phaser spike) is checked in a browser: e2e/sjestage.spec.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEPTH, PART as ENGINE_PART, depthFor as engineDepthFor, Scene, type TextureManager } from '../src/sje';
import { PART as CONFIG_PART, depthFor, enemySlots, slotPoint, type StageConfig } from '../src/battlestage/config';
import { Figure, type FigureSpec } from '../src/battlestage/figure';
import { enemyIdle, idleFrame } from '../src/battlestage/idle';
import { fixtureStages } from './stagefiles';
import { fakeCanvas, headlessGame } from './sjekit';

// The browser-only texture helpers, in a form Node can run: each registers a fake canvas under a key made from its arguments.
vi.mock('../src/battlestage/textures', () => {
  const add = (textures: TextureManager, key: string, w: number, h: number): string => {
    if (!textures.exists(key)) textures.addCanvas(key, fakeCanvas(w, h));
    return key;
  };
  // A copy of a texture under a new name: the size and the frames of the base.
  const variant = (textures: TextureManager, base: string, key: string): string => {
    if (!textures.exists(key)) {
      const from = textures.get(base);
      textures.addCanvas(key, fakeCanvas(from.width, from.height));
      const frames: Record<string | number, [number, number, number, number]> = {};
      for (const [name, f] of from.frames) frames[name] = [f.x, f.y, f.w, f.h];
      if (from.frames.size > 0) textures.addFrames(key, frames);
    }
    return key;
  };
  return {
    // Even in both directions, as the real ones are (shadowSize and ringSize), so the default origin is a whole pixel.
    shadowTexture: (textures: TextureManager, width: number) => add(textures, `shadow-${width}`, width + 8 + (width % 2), 10),
    ringTexture: (textures: TextureManager, width: number, color: string) => add(textures, `ring-${width}-${color.slice(1)}`, width + 6, 12),
    // The live battle's picture variants (M3 task 6): a named copy of the base, the same size and frames, like the hazed one.
    flashTexture: (textures: TextureManager, base: string, strength: number) => variant(textures, base, `flash${Math.round(strength * 4)}-${base}`),
    tintTexture: (textures: TextureManager, base: string, strength: number) => variant(textures, base, `tint${Math.round(strength * 4)}-${base}`),
    // A hazed copy has the size and the frames of the base (the real one does).
    hazedTexture: (textures: TextureManager, base: string, _fog: string, amount: number) => {
      if (amount <= 0) return base;
      const key = `haze-${base}-${Math.round(amount * 100)}`;
      if (!textures.exists(key)) {
        const from = textures.get(base);
        textures.addCanvas(key, fakeCanvas(from.width, from.height));
        const frames: Record<string | number, [number, number, number, number]> = {};
        for (const [name, f] of from.frames) frames[name] = [f.x, f.y, f.w, f.h];
        textures.addFrames(key, frames);
      }
      return key;
    },
  };
});

class Host extends Scene<void> {
  fixedUpdate(): void {}
}

interface PixiBits {
  position: { x: number; y: number };
  scale: { x: number; y: number };
  anchor: { x: number; y: number };
  zIndex: number;
}
const pixi = (o: { node: unknown }) => o.node as PixiBits;

/** A fake figure picture: a 2-cell sheet (hero) or one picture (enemy), with the measurements Figure reads. */
function art(w: number, h: number): FigureSpec['fig'] {
  return { raw: { w, h, data: new Uint8ClampedArray(0) }, box: { x0: 10, y0: 8, x1: w - 11, y1: h - 2, feet: Math.floor(w / 2) }, foot: { x: Math.floor(w / 2), y: h - 1 }, face: { x: 0, y: 0 }, grain: 1 };
}

function setup(): { scene: Host; textures: TextureManager; stage: StageConfig } {
  const { game } = headlessGame();
  const scene = new Host();
  void game.run(scene);
  const textures = game.textures;
  textures.addCanvas('hero', fakeCanvas(128, 64));
  textures.addFrames('hero', { 0: [0, 0, 64, 64], 1: [64, 0, 64, 64] });
  textures.addCanvas('foe', fakeCanvas(85, 97));
  const stage = fixtureStages().street;
  if (!stage) throw new Error('the fixture has no street');
  return { scene, textures, stage };
}

function heroSpec(stage: StageConfig, over: Partial<FigureSpec> = {}): FigureSpec {
  const slot = stage.party[0];
  if (!slot) throw new Error('no party slot');
  return { id: 'kit', side: 'party', name: 'Kit', boss: false, slot, baseTex: 'hero', fig: art(64, 64), art: art(64, 64), mirror: false, idle: 'still', uid: 0, cellW: 64, cellH: 64, axisKey: 'kit', sheet: { fps: 8, count: 2, phase: 0 }, ...over };
}

function foeSpec(stage: StageConfig, over: Partial<FigureSpec> = {}): FigureSpec {
  const slot = enemySlots(stage, '1')[0];
  if (!slot) throw new Error('no enemy slot');
  return { id: 'punk#0', side: 'enemy', name: 'Punk', boss: false, slot, baseTex: 'foe', fig: art(85, 97), art: art(85, 97), mirror: true, idle: 'sway', uid: 0, cellW: 85, cellH: 97, axisKey: 'punk', ...over };
}

/** A figure made the way the scene makes one: built, given its axis, placed, restyled. */
function made(scene: Host, stage: StageConfig, textures: TextureManager, spec: FigureSpec, first?: number): Figure {
  const f = new Figure(scene, spec, stage, first);
  f.applyAxis({ x: 0, y: 0 });
  f.place(stage, spec.slot);
  f.restyle({ stage, textures, worldFrame: 0 });
  return f;
}

describe('the depth numbers (the stage config uses the engine’s: one formula, one table)', () => {
  it('the part offsets are the spike’s (shadow -0.5, ring -0.4, body 0, smear 0.1, bar 0.25), and the config holds no copy: it is the engine’s table', () => {
    expect({ ...ENGINE_PART }).toEqual({ SHADOW: -0.5, RING: -0.4, BODY: 0, SMEAR: 0.1, BAR: 0.25 });
    expect(CONFIG_PART).toBe(ENGINE_PART);
  });

  it('the stage config’s depthFor(y, x, side, order) IS the engine’s depthFor(y, closeness, side, order) with the closeness worked out (the engine formula is not copied)', () => {
    for (const [y, x, side, order] of [
      [207, 46, 'party', 0],
      [157, 361, 'enemy', 0],
      [140, 240, 'party', 1],
      [191, 0, 'enemy', -1],
    ] as const) {
      const closeness = 240 - Math.min(240, Math.abs(x - 480 / 2));
      expect(engineDepthFor(y, closeness, side === 'enemy' ? 1 : 0, order)).toBe(depthFor(y, x, side, order));
    }
  });

  it('the backdrop band is below every figure, and the HUD band above them', () => {
    expect(DEPTH.BACKDROP).toBeLessThan(0);
    expect(depthFor(0, 0)).toBeGreaterThanOrEqual(0);
    expect(depthFor(270, 240, 'enemy', 1)).toBeLessThan(DEPTH.ACTORS + 300_000);
    expect(DEPTH.HUD).toBeGreaterThan(DEPTH.MARKS);
  });
});

describe('Figure: where it stands and what it draws at', () => {
  it('stands on the slot’s feet (slotPoint) and has the depth depthFor gives for them', () => {
    const { scene, textures, stage } = setup();
    const hero = made(scene, stage, textures, heroSpec(stage), 0);
    const foe = made(scene, stage, textures, foeSpec(stage));
    const heroSlot = stage.party[0];
    const foeSlot = enemySlots(stage, '1')[0];
    if (!heroSlot || !foeSlot) throw new Error('slots');
    const hp = slotPoint(stage, heroSlot);
    const fp = slotPoint(stage, foeSlot);
    expect([hero.x, hero.y, hero.baseX, hero.baseY]).toEqual([hp.x, hp.y, hp.x, hp.y]);
    expect([foe.x, foe.y]).toEqual([fp.x, fp.y]);
    const d = hero.describe();
    expect([d.x, d.y]).toEqual([hp.x, hp.y]);
    expect(d.depth).toBe(depthFor(hp.y, hp.x, 'party', heroSlot.order ?? 0));
    expect(foe.describe().depth).toBe(depthFor(fp.y, fp.x, 'enemy', foeSlot.order ?? 0));
  });

  it('the parts sit one pixel under the feet row, and sort inside the figure: shadow (-0.5), ring (-0.4), body (0)', () => {
    const { scene, textures, stage } = setup();
    const hero = made(scene, stage, textures, heroSpec(stage), 0);
    hero.active = true;
    hero.restyle({ stage, textures, worldFrame: 0 });
    const d = hero.describe();
    expect([d.body.x, d.body.y]).toEqual([0, 1]);
    expect(d.shadow).toEqual({ visible: true, depth: ENGINE_PART.SHADOW });
    expect(d.ring).toEqual({ visible: true, depth: ENGINE_PART.RING });
    expect(hero.container.drawOrder().map((o) => o.getData<string>('part'))).toEqual(['shadow', 'ring', 'body']);
  });

  it('a figure on a lower row (nearer) draws after one on a higher row, whatever order they were made in', () => {
    const { scene, textures, stage } = setup();
    // The same picture twice, on row 0 (far) and row 4 (near), made near first.
    const slots = stage.party;
    const near = slots.find((s) => s.row === Math.max(...slots.map((q) => q.row)));
    const far = slots.find((s) => s.row === Math.min(...slots.map((q) => q.row)));
    if (!near || !far) throw new Error('rows');
    const a = made(scene, stage, textures, heroSpec(stage, { id: 'near', slot: near }), 0);
    const b = made(scene, stage, textures, heroSpec(stage, { id: 'far', slot: far }), 0);
    expect(a.depth).toBeGreaterThan(b.depth);
    expect(scene.sys.world.drawOrder().map((o) => o.name)).toEqual(['figure far', 'figure near']);
  });

  it('a forward override (slot.order 1) brings a figure over a neighbour on its row, but never over a nearer row', () => {
    const { scene, textures, stage } = setup();
    const first = stage.party[0];
    if (!first) throw new Error('slot');
    // Row 3, with row 4 (the nearest) still to come.
    const slot = { ...first, row: 3 };
    const plain = made(scene, stage, textures, heroSpec(stage, { id: 'plain', slot: { ...slot, order: 0 } }), 0);
    const forward = made(scene, stage, textures, heroSpec(stage, { id: 'forward', slot: { ...slot, order: 1 } }), 0);
    expect(forward.depth).toBeGreaterThan(plain.depth);
    // One row nearer is at least 14 px = 14,000 deeper than the forward override's 1,000.
    const nearer = made(scene, stage, textures, heroSpec(stage, { id: 'nearer', slot: { ...slot, row: 4 } }), 0);
    expect(nearer.depth).toBeGreaterThan(forward.depth);
  });
});

describe('Figure: origin and mirror', () => {
  it('the body’s origin is the feet as a fraction of its picture, so the position is where it stands', () => {
    const { scene, textures, stage } = setup();
    const hero = made(scene, stage, textures, heroSpec(stage), 0);
    const d = hero.describe();
    expect(d.body.originX).toBeCloseTo(32 / 64, 10);
    expect(d.body.originY).toBeCloseTo(63 / 64, 10);
    // And the foot-anchor correction moves the origin: one pixel of correction is one pixel of figure.
    hero.applyAxis({ x: 2, y: -1 });
    expect(hero.describe().body.originX).toBeCloseTo(34 / 64, 10);
    expect(hero.describe().body.originY).toBeCloseTo(62 / 64, 10);
  });

  it('a mirrored enemy flips about the middle of its picture: scale.x is -1 and the anchor is 1 - origin (Phaser’s flip, scene-graph.md section 7)', () => {
    const { scene, textures, stage } = setup();
    const foe = made(scene, stage, textures, foeSpec(stage));
    const body = foe.container.list.find((o) => o.getData<string>('part') === 'body');
    if (!body) throw new Error('no body');
    expect(foe.describe().body.flipX).toBe(true);
    expect(pixi(body).scale.x).toBe(-1);
    expect(pixi(body).anchor.x).toBeCloseTo(1 - 42 / 85, 10);
    // A hero is not mirrored: scale 1 and the anchor is the origin itself.
    const hero = made(scene, stage, textures, heroSpec(stage), 0);
    const hb = hero.container.list.find((o) => o.getData<string>('part') === 'body');
    if (!hb) throw new Error('no body');
    expect(pixi(hb).scale.x).toBe(1);
    expect(pixi(hb).anchor.x).toBeCloseTo(0.5, 10);
  });
});

describe('Figure: everything that moves is a function of the tick', () => {
  it('a hero shows the idle frame of the tick (idleFrame), and the sprite is only touched when the frame changes', () => {
    const { scene, textures, stage } = setup();
    const hero = made(scene, stage, textures, heroSpec(stage, { sheet: { fps: 8, count: 2, phase: 1 } }), idleFrame(0, 8, 2, 1));
    const seen: Array<string | number | undefined> = [];
    for (let t = 1; t <= 120; t++) {
      hero.tick(t);
      expect(hero.describe().body.frame).toBe(idleFrame(t, 8, 2, 1));
      seen.push(hero.describe().body.frame);
    }
    // 8 frames a second of a 2-frame loop: the frame flips about every 7.5 ticks, 16 times in 120 ticks.
    expect(seen.filter((f, i) => i > 0 && f !== seen[i - 1]).length).toBeGreaterThanOrEqual(15);
  });

  it('an enemy sways by enemyIdle(kind, tick, uid): its body moves, its shadow and ring stay on the floor', () => {
    const { scene, textures, stage } = setup();
    for (const kind of ['bob', 'hover', 'sway', 'breathe', 'flicker', 'still'] as const) {
      const foe = made(scene, stage, textures, foeSpec(stage, { idle: kind, uid: 2 }));
      for (const t of [0, 1, 17, 30, 31, 90, 241]) {
        foe.tick(t);
        const o = enemyIdle(kind, t, 2);
        const d = foe.describe();
        expect([d.body.x, d.body.y - 1], `${kind} at tick ${t}`).toEqual([o.x, o.y]);
        expect(d.shadow.depth).toBe(ENGINE_PART.SHADOW);
      }
    }
  });

  it('two enemies of one kind are out of step (uid)', () => {
    const { scene, textures, stage } = setup();
    const a = made(scene, stage, textures, foeSpec(stage, { id: 'a', idle: 'hover', uid: 0 }));
    const b = made(scene, stage, textures, foeSpec(stage, { id: 'b', idle: 'hover', uid: 1 }));
    const apart = [3, 20, 41, 75].some((t) => {
      a.tick(t);
      b.tick(t);
      return a.describe().body.y !== b.describe().body.y;
    });
    expect(apart).toBe(true);
  });
});

describe('Figure: the shadow and the ring', () => {
  it('the shadow follows the sprite width (shadowWidth) and the ring appears only for the acting hero (cyan) and the target (amber)', () => {
    const { scene, textures, stage } = setup();
    const foe = made(scene, stage, textures, foeSpec(stage));
    expect(foe.describe().shadow.visible).toBe(true);
    expect(foe.describe().ring.visible, 'no ring when nobody is acting or aimed at').toBe(false);
    foe.target = true;
    foe.restyle({ stage, textures, worldFrame: 0 });
    expect(foe.describe().ring.visible).toBe(true);
    expect(textures.getTextureKeys().some((k) => k.startsWith('ring-') && k.endsWith('ffcc3d'))).toBe(true);
    foe.target = false;
    foe.active = true;
    foe.restyle({ stage, textures, worldFrame: 0 });
    expect(textures.getTextureKeys().some((k) => k.startsWith('ring-') && k.endsWith(stage.shadow.activeRing?.color.slice(1) ?? 'x'))).toBe(true);
    foe.active = false;
    foe.restyle({ stage, textures, worldFrame: 0 });
    expect(foe.describe().ring.visible).toBe(false);
  });

  it('the acting hero and the target are exempt from the row’s depth haze; a figure not marked is hazed on a row that has some', () => {
    const { scene, textures, stage } = setup();
    // A row with haze in the config (the far rows have some).
    const hazyRow = stage.depthTint?.amounts.findIndex((a) => a > 0) ?? -1;
    expect(hazyRow, 'the fixture street has a hazy row').toBeGreaterThanOrEqual(0);
    const slot = { ...(stage.party[0] ?? { x: 100, row: 0 }), row: hazyRow };
    const plain = made(scene, stage, textures, heroSpec(stage, { slot }), 0);
    expect(plain.describe().body.texture).toMatch(/^haze-hero-/);
    plain.active = true;
    plain.restyle({ stage, textures, worldFrame: 0 });
    expect(plain.describe().body.texture, 'the acting hero is exempt').toBe('hero');
  });
});

describe('Figure: dispose', () => {
  it('destroying a figure destroys every part and lets go of the textures it showed', () => {
    const { scene, textures, stage } = setup();
    const hero = made(scene, stage, textures, heroSpec(stage), 0);
    const users = (key: string) => (textures.get(key) as unknown as { useCount: number }).useCount;
    expect(users('hero')).toBeGreaterThan(0);
    const shadowKey = hero.partTextures()[0] ?? '';
    expect(users(shadowKey)).toBe(1);
    hero.destroy();
    expect(users('hero')).toBe(0);
    expect(users(shadowKey)).toBe(0);
    expect(hero.container.destroyed).toBe(true);
    expect(scene.sys.world.list).toHaveLength(0);
    // Twice is safe.
    expect(() => hero.destroy()).not.toThrow();
  });
});

describe('Figure: the state of a live battle (M3 task 6)', () => {
  it('a figure at rest draws what it always drew: no flash, no wash, no bar (the parity frames depend on it)', () => {
    const { scene, textures, stage } = setup();
    const foe = made(scene, stage, textures, foeSpec(stage));
    expect([foe.flash, foe.tint, foe.down, foe.bar]).toEqual([0, 0, false, null]);
    expect(foe.describe().body.texture.startsWith('flash')).toBe(false);
    expect(foe.describe().body.texture.startsWith('tint')).toBe(false);
  });

  it('a hit enemy shows its flashed picture, and the plain one again when the flash ends (control)', () => {
    const { scene, textures, stage } = setup();
    const foe = made(scene, stage, textures, foeSpec(stage));
    const plain = foe.describe().body.texture;
    foe.flash = 0.5;
    foe.restyle({ stage, textures, worldFrame: 0 });
    expect(foe.describe().body.texture).toBe('flash2-foe');
    foe.flash = 0;
    foe.restyle({ stage, textures, worldFrame: 0 });
    expect(foe.describe().body.texture).toBe(plain);
  });

  it('a hit hero is washed red; a fallen hero sinks into the fog (the fog is the haze texture of its own look); a fallen ENEMY is not given the fog of a hero', () => {
    const { scene, textures, stage } = setup();
    const hero = made(scene, stage, textures, heroSpec(stage), 0);
    hero.tint = 0.5;
    hero.restyle({ stage, textures, worldFrame: 0 });
    expect(hero.describe().body.texture).toContain('tint2-');
    hero.tint = 0;
    hero.down = true;
    hero.restyle({ stage, textures, worldFrame: 0 });
    // The fallen look is the haze at the fallen amount (DOWN_FOG_AMOUNT 0.55), not the wash.
    expect(hero.describe().body.texture).toBe('haze-hero-55');
    const foe = made(scene, stage, textures, foeSpec(stage));
    const plain = foe.describe().body.texture;
    foe.down = true;
    foe.restyle({ stage, textures, worldFrame: 0 });
    expect(foe.describe().body.texture).toBe(plain);
  });

  it('the on-stage bar: a figure that carries one draws it under its shadow, sorted with it; with no bar, or for a hero, it is not drawn (control)', () => {
    const { scene, textures, stage } = setup();
    const spec = stage.hud.enemyInfo.barsOnStage;
    expect(spec, 'the fixture asks for bars on the stage').toBeTruthy();
    const foe = made(scene, stage, textures, foeSpec(stage));
    const parts = () => foe.container.list.filter((c) => c.depth === ENGINE_PART.BAR);
    expect(parts()).toHaveLength(0);
    foe.bar = { ratio: 0.5, tag: '' };
    foe.restyle({ stage, textures, worldFrame: 0 });
    expect(parts(), 'the bar is a part of the figure at the bar depth').toHaveLength(1);
    expect(parts()[0]?.visible).toBe(true);
    // It goes when the figure has none.
    foe.bar = null;
    foe.restyle({ stage, textures, worldFrame: 0 });
    expect(parts()[0]?.visible).toBe(false);
    // A hero never draws one, even if it were given a bar.
    const hero = made(scene, stage, textures, heroSpec(stage), 0);
    hero.bar = { ratio: 1, tag: '' };
    hero.restyle({ stage, textures, worldFrame: 0 });
    expect(hero.container.list.filter((c) => c.depth === ENGINE_PART.BAR)).toHaveLength(0);
  });

  it('the bar fades with the figure', () => {
    const { scene, textures, stage } = setup();
    const foe = made(scene, stage, textures, foeSpec(stage));
    foe.bar = { ratio: 1, tag: '' };
    foe.alpha = 0.3;
    foe.restyle({ stage, textures, worldFrame: 0 });
    expect(foe.container.list.find((c) => c.depth === ENGINE_PART.BAR)?.alpha).toBeCloseTo(0.3, 6);
  });
});
