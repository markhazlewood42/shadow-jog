/**
 * The live battle on the stage (src/battlestage/live.ts, liveview.ts, livenumbers.ts; M3 task 6), against the REAL engine classes in Node. As in
 * tests/sje-stage-contract.test.ts the texture helpers that need a browser canvas are replaced by ones that register fake canvases; the scene, its figures, the HUD's objects,
 * the display list, the texture manager and the scene stack are the real ones. The battle scene is a stand-in object with the members the stage reads (the real one needs a
 * browser), holding a REAL `Battle` of the demo party against real enemies, so the HUD's numbers are the game's own.
 *
 * What it pins, each with a control:
 *  - the stage follows the battle's display state: a figure takes its alpha, lunge, hop, shake and blink from `Disp`; a change in `Disp` changes the figure and nothing else does;
 *  - the HUD view: the phase of each mode, the displayed health (not the engine's), the order (fallen fighters have no chip), the known weak spots only, the small banner only;
 *  - the HUD is rebuilt only when what it shows changes (a tick with nothing new costs no rebuild);
 *  - the roster: a summoned enemy is on stage when playback shows it and not before; a form change swaps the picture when the roster version says so, not before;
 *  - the numbers: one image per floater, moved by the rule, gone when the floater is;
 *  - the push camera starts when the battle makes a push; a heavy hit freezes the stage; the stage answers the battle in WORLD pixels;
 *  - the HUD's `menus: 'game'` leaves the command strip out, `'hud'` draws it (control).
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Battle, enemyCombatant } from '../src/battle/engine';
import { enemyParty } from '../src/battle/setup';
import type { BattleScene } from '../src/scenes/battle';
import type { Disp, Floater } from '../src/scenes/battlekit/types';
import { BHT, BW } from '../src/art/worldsize';
import { BG_IDS } from '../src/art/battlebg480';
import { demoParty } from '../src/battlestage/demo';
import { checkStageConfig, stageOf } from '../src/battlestage/config';
import { LiveStageScene, liveStage, shakeOffset } from '../src/battlestage/live';
import { LiveNumbers } from '../src/battlestage/livenumbers';
import { floaterMotion } from '../src/scenes/battlekit/geom';
import { liveTags, liveView, type LiveMode, type LiveSource, phaseOf, slotOf, timelineOrder, viewSignature } from '../src/battlestage/liveview';
import { Hud } from '../src/battlestage/hud';
import { STAGE_KNOWN } from '../src/battlestage/known';
import { Rng, Scene, type TextureManager } from '../src/sje';
import { state } from '../src/game/state';
import { fakeCanvas, headlessGame } from './sjekit';
import { fixtureStages } from './stagefiles';

// A canvas stand-in, so the effects layer's `CanvasImage` works in Node (the same trick as tests/sje-game.test.ts).
const noop = () => undefined;
const fakeCtx = new Proxy({}, { get: () => noop, set: () => true });
const realDocument = (globalThis as { document?: unknown }).document;
(globalThis as unknown as { document: unknown }).document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => fakeCtx }) };
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDocument;
});

vi.mock('../src/battlestage/textures', () => {
  const add = (textures: TextureManager, key: string, w: number, h: number): string => {
    if (!textures.exists(key)) textures.addCanvas(key, fakeCanvas(w, h));
    return key;
  };
  const sheetArt = (w: number, h: number) => ({ raw: { w, h, data: new Uint8ClampedArray(w * h * 4) }, box: { x0: 10, y0: 8, x1: w - 11, y1: h - 2, feet: Math.floor(w / 2) }, foot: { x: Math.floor(w / 2), y: h - 1 }, face: { x: 3, y: 4 }, grain: 1 });
  return {
    PREFIX: { shadow: 'shadow-', ring: 'ring-', face: 'face-' },
    pruneTextures: (textures: TextureManager, prefix: string, inUse: ReadonlySet<string>) => textures.prune(prefix, inUse),
    shadowTexture: (textures: TextureManager, width: number) => add(textures, `shadow-${width}`, width + 8 + (width % 2), 10),
    ringTexture: (textures: TextureManager, width: number, color: string) => add(textures, `ring-${width}-${color.slice(1)}`, width + 6, 12),
    hazedTexture: (_t: TextureManager, base: string) => base,
    flashTexture: (_t: TextureManager, base: string, strength: number) => `flash${Math.round(strength * 4)}-${base}`,
    tintTexture: (_t: TextureManager, base: string, strength: number) => `tint${Math.round(strength * 4)}-${base}`,
    faceTexture: (textures: TextureManager, name: string, _fig: unknown, size: number) => add(textures, `face-${name}-${size}`, size, size),
    surface: () => {
      throw new Error('no canvas in Node');
    },
    bakeStage: (textures: TextureManager, stage: { id: string }) => ({ key: add(textures, `stage-${stage.id}`, 480, 270) }),
    registerCrew: (textures: TextureManager, metas: Record<string, { frame_w: number; frame_h: number; frame_count: number }>, ids: readonly string[]) => {
      const out: Record<string, unknown> = {};
      for (const id of ids) {
        const m = metas[id];
        if (!m) throw new Error(`No metadata for ${id}`);
        const key = `crewb-${id}`;
        if (!textures.exists(key)) {
          textures.addCanvas(key, fakeCanvas(m.frame_w * m.frame_count, m.frame_h));
          const frames: Record<number, [number, number, number, number]> = {};
          for (let i = 0; i < m.frame_count; i++) frames[i] = [i * m.frame_w, 0, m.frame_w, m.frame_h];
          textures.addFrames(key, frames);
        }
        out[id] = { texture: key, frameW: m.frame_w, frameH: m.frame_h, foot: { x: 32, y: m.frame_h - 1 }, fig: sheetArt(m.frame_w, m.frame_h), plan: {}, drawn: { frames: [], foot: { x: 32, y: 63 } }, footDelta: { x: 0, y: 0 } };
      }
      return out;
    },
    addEnemy: (textures: TextureManager, sprite: string, copy: number) => {
      const key = add(textures, `enemy-${sprite}-${copy}`, 85, 97);
      return { key, width: 85, height: 97, idleShadow: 0, idle: 'breathe', fig: sheetArt(85, 97) };
    },
  };
});

// The HUD's texture makers register fake canvases under their own keys; everything else of the kit (the colors, the widths of the game's font) is real.
vi.mock('../src/battlestage/hudkit', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/battlestage/hudkit')>();
  const add = (textures: TextureManager, key: string, w: number, h: number): string => {
    if (!textures.exists(key)) textures.addCanvas(key, fakeCanvas(Math.max(1, w), Math.max(1, h)));
    return key;
  };
  return {
    ...real,
    textTexture: (textures: TextureManager, text: string, opts: { color?: string; scale?: number; prefix?: string; shadow?: string | false } = {}) => {
      const scale = opts.scale ?? 1;
      const w = Math.max(1, real.textWidth(text, scale)) + 2;
      const h = 9 * scale + 2;
      const key = `${opts.prefix ?? real.TEXT_PREFIX}${text}|${opts.color ?? ''}|${scale}`;
      add(textures, key, w, h);
      return { key, w, h, pad: 0 };
    },
    windowTexture: (textures: TextureManager, w: number, h: number, accent: string) => add(textures, `${real.WINDOW_PREFIX}${w}x${h}-${accent}`, w + 2, h + 2),
    chipTexture: (textures: TextureManager, o: { size: number; faceKey: string; foe: boolean; dim?: number; glow?: string | null }) => add(textures, `${real.CHIP_PREFIX}${o.size}-${o.faceKey}-${o.foe}-${o.dim ?? 0}-${o.glow ?? ''}`, o.size + 4, o.size + 4),
    iconTexture: (textures: TextureManager, name: string) => add(textures, `${real.CHIP_PREFIX}icon-${name}`, 16, 16),
    statusIconTexture: (textures: TextureManager, id: string) => add(textures, `${real.CHIP_PREFIX}status-${id}`, 7, 7),
  };
});

const META = {
  kit: { frame_w: 64, frame_h: 64, frame_count: 8, fps: 8 },
  rook: { frame_w: 79, frame_h: 68, frame_count: 8, fps: 8 },
  hex: { frame_w: 64, frame_h: 64, frame_count: 8, fps: 8 },
  sable: { frame_w: 64, frame_h: 64, frame_count: 8, fps: 8 },
};

const stage = () => stageOf(fixtureStages(), 'street');

const disp = (hp: number, maxTp = 0): Disp => ({ hp, tp: maxTp, shownHp: hp, shownTp: maxTp, lagHp: hp, lagHold: 0, flash: 0, shake: 0, hop: 0, alpha: 1, dying: 0, lunge: 0, hidden: false, pose: 'idle', poseT: 0, afterimage: 0 });

/** The view's source with its members writable (the real scene changes them as the fight goes). */
type Writable = { -readonly [K in keyof LiveSource]: LiveSource[K] } & Record<string, unknown>;

/** A stand-in for the battle scene: the members the stage reads, over a real `Battle`. */
function fakeHost(foes: string[] = ['rustfang_punk', 'glowrat']): { host: BattleScene; src: Writable; shown: Set<number>; disps: Map<number, Disp> } {
  const st = stage();
  const party = demoParty({ ...st.demo, party: st.demo.party.slice(0, 2), lineup: st.demo.lineup.slice(0, 2) });
  const battle = new Battle(party, enemyParty(foes), new Rng(7), { canRun: true });
  const disps = new Map<number, Disp>();
  for (const u of battle.units) disps.set(u.uid, disp(u.hp, u.base.maxTp));
  const shown = new Set(battle.units.map((u) => u.uid));
  const host: Record<string, unknown> = {
    battle,
    mode: 'round' as LiveMode,
    actor: undefined,
    cmds: [],
    targetList: [] as number[],
    targetIdx: 0,
    banner: null,
    message: null,
    floaters: [] as Floater[],
    push: null,
    frozen: false,
    defeatT: 0,
    rosterVersion: 0,
    fx: { busy: false, render: () => undefined },
    timing: { prompt: null, isOpen: false },
    d: (uid: number) => disps.get(uid),
    hasDisp: (uid: number) => shown.has(uid),
    actors: () => battle.party.filter((p) => p.hp > 0),
    twins: (u: { uid: number; key: string }) => battle.enemies.some((o) => o.uid !== u.uid && o.key === (u as { key: string }).key),
    dupIndex: (u: { uid: number }) => battle.enemies.findIndex((o) => o.uid === u.uid),
    drawOverStage: () => undefined,
  };
  return { host: host as unknown as BattleScene, src: host as unknown as Writable, shown, disps };
}

function run(foes?: string[]) {
  const h = fakeHost(foes);
  const { game } = headlessGame();
  const names = h.host.battle.enemies.map((e) => e.key);
  const scene = new LiveStageScene({ stages: fixtureStages(), stageId: 'street', metas: META, standIns: true, lineup: h.host.battle.party.map((p) => p.key), setKey: String(names.length), enemies: names }, h.host);
  game.run(scene).catch((e: unknown) => {
    throw e;
  });
  return { ...h, scene, game };
}

describe('the live view of the HUD (liveview.ts)', () => {
  it('each mode of the battle is a phase of the HUD, and an unknown one is not made up', () => {
    expect(phaseOf('round')).toBe('choose');
    expect(phaseOf('command')).toBe('choose');
    expect(phaseOf('list')).toBe('choose');
    expect(phaseOf('target')).toBe('target');
    expect(phaseOf('play')).toBe('act');
    expect(phaseOf('end')).toBe('act');
    expect(phaseOf('intro')).toBe('act');
  });

  it('shows the DISPLAYED health: a hero hit but not yet shown reads the old number (control: the engine\'s)', () => {
    const { src, disps } = fakeHost();
    const hero = src.battle.party[0];
    if (!hero) throw new Error('no hero');
    const before = liveView(src).party[0];
    expect(before?.hp).toBe(hero.hp);
    // The engine takes 20, the display has not caught up: the HUD says what the player has seen.
    hero.hp -= 20;
    expect(liveView(src).party[0]?.hp).toBe(hero.hp + 20);
    // The display eases down: the HUD follows the displayed value, rounded.
    const d = disps.get(hero.uid);
    if (!d) throw new Error('no disp');
    d.hp = hero.hp;
    d.shownHp = hero.hp + 7.4;
    expect(liveView(src).party[0]?.hp).toBe(Math.round(hero.hp + 7.4));
    // A fighter whose display says down reads 0 at once.
    d.hp = 0;
    expect(liveView(src).party[0]?.hp).toBe(0);
  });

  it('the turn order: orders given and the rest attacking while orders are open, the engine\'s own queue while the round plays, nothing in the intro, fallen fighters have no chip', () => {
    const { src } = fakeHost();
    src.mode = 'round';
    const order = timelineOrder(src);
    expect(order.sort((a, b) => a - b)).toEqual([0, 1, 10, 11]);
    // The same round in play mode: the engine's queue.
    src.battle.startRound(src.actors().map((p) => ({ actor: p.uid, type: 'attack' as const, target: -1 })));
    src.mode = 'play';
    expect(timelineOrder(src).sort((a, b) => a - b)).toEqual([0, 1, 10, 11]);
    // Control: a fallen enemy has no chip.
    const foe = src.battle.enemies[0];
    if (!foe) throw new Error('no foe');
    foe.hp = 0;
    expect(timelineOrder(src)).not.toContain(slotOf(src.battle, foe.uid));
    src.mode = 'intro';
    expect(timelineOrder(src)).toEqual([]);
    src.mode = 'end';
    expect(timelineOrder(src)).toEqual([]);
  });

  it('an enemy summoned but not yet shown has no row and no chip', () => {
    const { src, shown, disps } = fakeHost(['rustfang_punk']);
    const extra = enemyCombatant('rustfang_punk', 100, 1);
    // The engine's list has it (a summon resolves at once), the display does not yet.
    (src.battle.enemies as Combatant[]).push(extra);
    (src.battle.units as Combatant[]).push(extra);
    expect(liveView(src).foes).toHaveLength(1);
    expect(timelineOrder(src)).not.toContain(11);
    shown.add(100);
    disps.set(100, disp(extra.hp));
    expect(liveView(src).foes).toHaveLength(2);
  });

  it('a foe\'s tags are its states and the weak spots the crew KNOWS (control: all of them once analyzed)', () => {
    const { src } = fakeHost();
    const foe = src.battle.enemies[0];
    if (!foe) throw new Error('no foe');
    const had = { ...state.weakSeen };
    try {
      state.weakSeen = {};
      foe.analyzed = false;
      expect(liveTags(foe).filter((t) => t.tone === 'cyan')).toEqual([]);
      state.weakSeen = { [foe.key]: ['shock'] };
      expect(liveTags(foe).map((t) => t.text)).toContain('WEAK: SHOCK');
      state.weakSeen = {};
      foe.weak = { shock: 2, fire: 1.5 };
      expect(liveTags(foe).filter((t) => t.tone === 'cyan')).toEqual([]);
      foe.analyzed = true;
      expect(liveTags(foe).map((t) => t.text).join()).toMatch(/SHOCK/);
      foe.status.push({ id: 'burn', turns: 2 });
      expect(liveTags(foe).map((t) => t.text)).toContain('BURNING');
    } finally {
      state.weakSeen = had;
    }
  });

  it('only the small banner is the HUD\'s; the big band stays the old picture\'s', () => {
    const { src } = fakeHost();
    src.banner = { text: 'Arc Cut', big: false };
    expect(liveView(src).banner).toBe('Arc Cut');
    src.banner = { text: 'COMBO!', big: true };
    expect(liveView(src).banner).toBeNull();
    src.banner = null;
    expect(liveView(src).banner).toBeNull();
  });

  it('aiming: an enemy under the cursor is the foe box\'s target, an ally under the cursor is rung (control: no cursor, no target)', () => {
    const { src } = fakeHost();
    src.mode = 'target';
    const foe = src.battle.enemies[1];
    const ally = src.battle.party[1];
    if (!foe || !ally) throw new Error('no one');
    src.targetList = [src.battle.enemies[0]?.uid ?? 0, foe.uid];
    src.targetIdx = 1;
    expect(liveView(src).target).toBe(1);
    src.targetList = [ally.uid];
    src.targetIdx = 0;
    const v = liveView(src);
    expect(v.target).toBeNull();
    expect(v.allyTarget).toBe(ally.uid);
    src.mode = 'round';
    expect(liveView(src).target).toBeNull();
  });

  it('the signature changes with anything the HUD shows, and with nothing else', () => {
    const { src, disps } = fakeHost();
    const a = viewSignature(liveView(src));
    expect(viewSignature(liveView(src))).toBe(a);
    const hero = src.battle.party[0];
    if (!hero) throw new Error('no hero');
    const d = disps.get(hero.uid);
    if (!d) throw new Error('no disp');
    // A change of the hit flash or the alpha is not something the HUD shows.
    d.flash = 5;
    d.alpha = 0.5;
    expect(viewSignature(liveView(src))).toBe(a);
    // A change of the displayed health is.
    d.hp = hero.hp - 3;
    d.shownHp = hero.hp - 3;
    expect(viewSignature(liveView(src))).not.toBe(a);
  });
});

describe('the stage follows the battle (live.ts)', () => {
  it('stands the figures of the party and the enemies, builds the HUD, and is the current stage until it closes (control: not before, not after)', () => {
    expect(liveStage()).toBeNull();
    const { scene } = run();
    expect(liveStage()).toBe(scene);
    expect(scene.figures.map((f) => f.id)).toEqual(['kit', 'rook', 'rustfang_punk#0', 'glowrat#1']);
    const d = scene.describe();
    expect(d.hud.regions).toBeGreaterThan(2);
    expect(d.hud.builds).toBeGreaterThanOrEqual(1);
    // The draw order follows the feet.
    for (const a of d.figures) for (const b of d.figures) if (a.y < b.y) expect(d.order.indexOf(a.id)).toBeLessThan(d.order.indexOf(b.id));
    // The pictures made for the HUD and the numbers are there while the stage is (control), and none outlives it.
    const transient = () => scene.textures.getTextureKeys().filter((k) => /^(txt-|win-|chip-|face-|num-|bartag-)/.test(k));
    expect(transient().length).toBeGreaterThan(5);
    scene.close();
    expect(liveStage()).toBeNull();
    expect(transient()).toEqual([]);
  });

  it('a figure takes its look from the display state: alpha, lunge, hop, shake, the blink; a figure whose state is at rest stays at rest (control)', () => {
    const { scene, host, disps, game } = run();
    const k = scene.k;
    const foe = host.battle.enemies[0];
    const hero = host.battle.party[0];
    if (!foe || !hero) throw new Error('no one');
    const df = disps.get(foe.uid);
    const dh = disps.get(hero.uid);
    if (!df || !dh) throw new Error('no disp');
    game.step(1);
    for (const f of scene.figures) expect([f.alpha, f.flash, f.tint, f.offX, f.offY, f.bodyDx, f.down]).toEqual([1, 0, 0, 0, 0, 0, false]);
    df.alpha = 0.4;
    df.lunge = 10;
    df.flash = 12; // 12 % 4 = 0: a lit blink frame
    df.shake = 3; // 3 % 4 = 3: the "left" half of the shake
    dh.hop = 4;
    dh.lunge = 6;
    dh.flash = 12;
    game.step(1);
    const f = scene.figures.find((x) => x.id.startsWith('rustfang_punk'));
    const h = scene.figures.find((x) => x.id === 'kit');
    expect(f?.alpha).toBe(0.4);
    expect(f?.offX, 'an enemy lunges toward the party, which is to the left').toBe(-Math.round(10 * k));
    expect(f?.flash, 'a hit enemy blinks white').toBeGreaterThan(0);
    expect(f?.bodyDx).toBe(-2 * k);
    expect(h?.tint, 'a hit hero is washed red').toBeGreaterThan(0);
    expect(h?.flash, 'a hero never blinks white').toBe(0);
    expect(h?.offY).toBe(-Math.round(4 * k));
    expect(h?.offX, 'a hero lunges toward the enemies, which is to the right').toBe(Math.round(6 * k));
    // The other enemy did not change.
    const other = scene.figures.find((x) => x.id.startsWith('glowrat'));
    expect([other?.alpha, other?.flash, other?.offX]).toEqual([1, 0, 0]);
    // The blink goes off on the off frames.
    df.flash = 10;
    game.step(1);
    expect(f?.flash).toBe(0);
  });

  it('a hero who has fallen sinks into the fog and is see-through; an enemy that is dying carries no bar', () => {
    const { scene, host, disps, game } = run();
    const hero = host.battle.party[1];
    const foe = host.battle.enemies[0];
    if (!hero || !foe) throw new Error('no one');
    const dh = disps.get(hero.uid);
    const df = disps.get(foe.uid);
    if (!dh || !df) throw new Error('no disp');
    game.step(1);
    expect(scene.figures.find((x) => x.id === 'rook')?.down).toBe(false);
    hero.hp = 0;
    dh.hp = 0;
    game.step(1);
    const rook = scene.figures.find((x) => x.id === 'rook');
    expect(rook?.down).toBe(true);
    expect(rook?.alpha).toBeLessThan(1);
    const punk = scene.figures.find((x) => x.id.startsWith('rustfang_punk'));
    expect(punk?.bar).not.toBeNull();
    df.dying = 3;
    game.step(1);
    expect(punk?.bar).toBeNull();
  });

  it('who has a ring follows the mode: the member giving orders, the foe under the cursor; nobody on the round menu (control)', () => {
    const { scene, host, src, game } = run();
    game.step(1);
    expect(scene.describe().figures.map((f) => f.ring)).toEqual([null, null, null, null]);
    const hero = host.battle.party[1];
    if (!hero) throw new Error('no hero');
    (src as Record<string, unknown>).mode = 'command';
    (src as Record<string, unknown>).actor = hero;
    game.step(1);
    expect(scene.describe().figures.map((f) => f.ring)).toEqual([null, 'active', null, null]);
    (src as Record<string, unknown>).mode = 'target';
    (src as Record<string, unknown>).targetList = host.battle.enemies.map((e) => e.uid);
    (src as Record<string, unknown>).targetIdx = 1;
    game.step(1);
    expect(scene.describe().figures.map((f) => f.ring)).toEqual([null, 'active', null, 'target']);
    (src as Record<string, unknown>).mode = 'round';
    (src as Record<string, unknown>).actor = undefined;
    game.step(1);
    expect(scene.describe().figures.map((f) => f.ring)).toEqual([null, null, null, null]);
  });

  it('rebuilds the HUD only when something it shows changed (control: it does rebuild then)', () => {
    const { scene, host, disps, game } = run();
    game.step(5);
    const builds = scene.hudBuilds;
    game.step(30);
    expect(scene.hudBuilds, 'thirty quiet ticks cost no rebuild').toBe(builds);
    const hero = host.battle.party[0];
    if (!hero) throw new Error('no hero');
    const d = disps.get(hero.uid);
    if (!d) throw new Error('no disp');
    d.hp = hero.hp - 5;
    d.shownHp = hero.hp - 5;
    game.step(1);
    expect(scene.hudBuilds).toBe(builds + 1);
  });

  it('a summoned enemy is on stage when playback shows it, and not before; a form change swaps the picture when the roster version says so', () => {
    const { scene, host, src, shown, disps, game } = run(['rustfang_punk']);
    expect(scene.figures.filter((f) => f.side === 'enemy')).toHaveLength(1);
    const extra = enemyCombatant('rustfang_punk', 100, 1);
    (host.battle.enemies as Combatant[]).push(extra);
    (host.battle.units as Combatant[]).push(extra);
    game.step(2);
    expect(scene.figures.filter((f) => f.side === 'enemy'), 'the engine has it, the display has not shown it').toHaveLength(1);
    shown.add(100);
    disps.set(100, { ...disp(extra.hp), alpha: 0 });
    game.step(1);
    const foes = scene.figures.filter((f) => f.side === 'enemy');
    expect(foes.map((f) => f.id)).toEqual(['rustfang_punk#0', 'rustfang_punk#1']);
    expect(foes[1]?.alpha, 'it fades in from the display state').toBe(0);
    // A form change: the engine swaps the key at once; the stage keeps the picture until playback bumps the roster version.
    const boss = host.battle.enemies[0];
    if (!boss) throw new Error('no boss');
    boss.key = 'glowrat';
    game.step(2);
    expect(scene.figures.find((f) => f.side === 'enemy')?.id).toBe('rustfang_punk#0');
    (src as Record<string, unknown>).rosterVersion = 1;
    game.step(1);
    expect(scene.figures.find((f) => f.side === 'enemy')?.id).toBe('glowrat#0');
  });

  it('answers the battle in WORLD pixels: a fighter\'s middle is inside the world, the head is above the middle, targeting runs left to right', () => {
    const { scene, host } = run(['rustfang_punk', 'glowrat', 'rustfang_punk']);
    for (const u of host.battle.units) {
      const p = scene.pos(u.uid);
      const head = scene.headPos(u.uid);
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(BW);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(BHT);
      expect(head.y, 'the head is above the middle').toBeLessThan(p.y);
    }
    // The world has the stage's pixels divided by k.
    const f = scene.figures[0];
    expect(scene.footX(host.battle.party[0]?.uid ?? 0)).toBeCloseTo((f?.x ?? 0) / scene.k, 6);
    // Heroes stand left of enemies.
    const heroX = Math.max(...host.battle.party.map((p) => scene.footX(p.uid)));
    const foeX = Math.min(...host.battle.enemies.map((e) => scene.footX(e.uid)));
    expect(heroX).toBeLessThan(foeX);
    // An uid the battle does not have answers with the middle of the world and no throw.
    expect(scene.pos(999)).toEqual({ x: BW / 2, y: BHT / 2 });
  });

  it('starts the push camera when the battle makes a push, once per push (control: no push, no camera move)', () => {
    const { scene, src, game } = run();
    game.step(3);
    expect(scene.pushing).toBe(false);
    expect(scene.sys.world.scaleX).toBe(1);
    (src as Record<string, unknown>).push = { x: BW / 2, y: BHT / 2, t: 0, life: 20 };
    game.step(4);
    expect(scene.pushing).toBe(true);
    expect(scene.sys.world.scaleX).toBeGreaterThan(1);
    game.step(30);
    expect(scene.pushing, 'one push does not start itself again').toBe(false);
  });

  it('a heavy hit freezes the stage: the world clock holds while the real one counts (control: it runs without it)', () => {
    const { scene, src, game } = run();
    game.step(10);
    const w = scene.worldFrame;
    (src as Record<string, unknown>).frozen = true;
    game.step(10);
    expect(scene.worldFrame).toBe(w);
    expect(scene.frame).toBe(20);
    (src as Record<string, unknown>).frozen = false;
    game.step(10);
    expect(scene.worldFrame).toBe(w + 10);
  });
});

describe('the shake of a hit', () => {
  it('is the old picture’s rule, frame by frame: 2 world pixels to one side for two frames, then the other, and nothing at rest', () => {
    const old = (shake: number): number => (shake > 0 ? (shake % 4 < 2 ? 2 : -2) : 0);
    for (let left = 0; left <= 12; left++) expect(shakeOffset(left), `left ${left}`).toBe(old(left));
    // Control: the rule does shake, both ways.
    expect(new Set([1, 2, 3, 4].map(shakeOffset)).size).toBe(2);
  });
});

describe('the numbers (livenumbers.ts)', () => {
  const floater = (over: Partial<Floater> = {}): Floater => ({ text: '12', x: 100, y: 80, t: 0, color: '#ffb23a', style: 'hit', uid: 10, ...over });

  function numbers() {
    const { game } = headlessGame();
    class Host extends Scene<void> {
      fixedUpdate(): void {}
    }
    const scene = new Host();
    void game.run(scene);
    return { scene, layer: new LiveNumbers(scene, 1.5) };
  }

  it('one image per floater, moved by the rule of the old picture, gone when the floater is (control: they stay while the floater stays)', () => {
    const { layer } = numbers();
    const a = floater();
    const b = floater({ text: 'WEAK!', style: 'label', color: '#6ff3ff' });
    layer.update([a, b]);
    expect(layer.count).toBe(2);
    const first = layer.shown[0];
    const y0 = first?.y ?? 0;
    // Age the hit: it rises by the rule (the stage's pixels are 1.5 per world pixel).
    a.t = 8;
    layer.update([a, b]);
    const m = floaterMotion('hit', 8);
    expect(first?.y).toBeCloseTo(y0 - Math.round(m.rise + m.bounce) * 1.5, -1);
    expect(first?.y ?? 0).toBeLessThan(y0);
    expect(first?.alpha).toBe(1);
    // Late in its life it fades.
    a.t = 45;
    layer.update([a, b]);
    expect(first?.alpha).toBeLessThan(1);
    expect(layer.count).toBe(2);
    // The scene drops one: its image goes.
    layer.update([b]);
    expect(layer.count).toBe(1);
    layer.update([]);
    expect(layer.count).toBe(0);
  });

  it('a damage-over-time tick sinks while a hit rises (the two styles move opposite ways)', () => {
    const { layer } = numbers();
    const hit = floater();
    const tick = floater({ style: 'tick', text: '3' });
    layer.update([hit, tick]);
    const [h, t] = layer.shown;
    const hy = h?.y ?? 0;
    const ty = t?.y ?? 0;
    hit.t = 20;
    tick.t = 20;
    layer.update([hit, tick]);
    expect((h?.y ?? 0) - hy).toBeLessThan(0);
    expect((t?.y ?? 0) - ty).toBeGreaterThan(0);
  });
});

describe('the HUD\'s menus (hud.ts)', () => {
  function hudFor(menus: 'hud' | 'game') {
    const { game } = headlessGame();
    class Host extends Scene<void> {
      fixedUpdate(): void {}
    }
    const scene = new Host();
    void game.run(scene);
    const { src } = fakeHost();
    const faces = { party: (i: number, size: number) => addFace(scene, `p${i}`, size), foe: (i: number, size: number) => addFace(scene, `f${i}`, size) };
    const hud = new Hud(scene, faces, menus);
    const view = liveView(src);
    const geo = { party: [], foes: [] };
    hud.render(stage(), { ...view, active: 0 }, geo);
    return hud;
  }
  const addFace = (scene: Scene<void>, name: string, size: number): string => {
    const key = `face-${name}-${size}`;
    if (!scene.textures.exists(key)) scene.textures.addCanvas(key, fakeCanvas(size, size));
    return key;
  };

  it('with the game\'s own menus the command strip is not drawn; the HUD\'s own mode draws it (control)', () => {
    expect(hudFor('game').box('commands')).toBeUndefined();
    expect(hudFor('hud').box('commands')).toBeDefined();
    // The timeline, the party table and the foe box are the HUD's in both modes.
    for (const menus of ['game', 'hud'] as const) {
      const hud = hudFor(menus);
      expect(hud.box('turnOrder')).toBeDefined();
      expect(hud.box('partyStatus')).toBeDefined();
      expect(hud.box('enemyInfo')).toBeDefined();
    }
  });

  it('the stage the HUD is made for is a valid one (the fixture the tests use passes the stage file\'s own check)', () => {
    expect(checkStageConfig(stage(), BG_IDS, STAGE_KNOWN)).toEqual([]);
  });
});

type Combatant = import('../src/battle/types').Combatant;
