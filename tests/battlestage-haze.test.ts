/**
 * The depth haze, NOT mocked (cleanup item C3 of docs/spikes/engine-platform.md). `tests/battlestage-figure.test.ts` replaces `hazedTexture` with a stub
 * that only registers a canvas, so nothing there proves what the haze does to a pixel. This file runs the REAL `hazedTexture`, `variantOf` (through
 * `hazedTexture`, `flashTexture` and `tintTexture`, its three users), `readTexture`, `rawToCanvas` and the real engine `TextureManager` and `Figure`.
 *
 * Node has no canvas, so the one thing faked is the canvas itself: a small in-memory 2D canvas that stores RGBA bytes (put, get and copy of whole
 * pictures, the only calls these code paths make). It keeps colour as written. A real browser canvas stores colour premultiplied by alpha, which loses a
 * little on half transparent pixels, so the half transparent pixel here is not a claim about the browser: the browser's haze frame is checked against
 * the Phaser spike by the parity spec (the `haze` frame of e2e/sjestage.spec.ts). Opaque and fully transparent pixels are exact in both.
 *
 * The expected pixels are worked out by hand in each test from the rule "blend toward the fog by `amount`, round each channel": for the street's fog
 * #34305a = (52, 48, 90) and the row amounts 0.12, 0.09, 0.06, 0.03 and 0 of `src/data/stages.json` (the fixture copy, so Mark's editing never breaks this).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TextureManager } from '../src/sje';
import { Scene } from '../src/sje';
import { Figure, type FigureSpec } from '../src/battlestage/figure';
import { enemySlots, type StageConfig } from '../src/battlestage/config';
import { flashTexture, hazedTexture, rawToCanvas, readTexture, tintTexture, addCanvasOnce } from '../src/battlestage/textures';
import type { Raw } from '../src/battlestage/pixels';
import { fixtureStages } from './stagefiles';
import { headlessGame } from './sjekit';

// ------------------------------------------------------------------ an in-memory canvas

class FakeCanvas {
  private bytes = new Uint8ClampedArray(0);
  private w = 300;
  private h = 150;
  get width(): number {
    return this.w;
  }
  set width(v: number) {
    this.w = v;
    this.bytes = new Uint8ClampedArray(0);
  }
  get height(): number {
    return this.h;
  }
  set height(v: number) {
    this.h = v;
    this.bytes = new Uint8ClampedArray(0);
  }
  /** The pixels, made on first use at the size the canvas has by then. */
  get px(): Uint8ClampedArray {
    if (this.bytes.length !== this.w * this.h * 4) this.bytes = new Uint8ClampedArray(this.w * this.h * 4);
    return this.bytes;
  }
  getContext(): FakeContext {
    return new FakeContext(this);
  }
}

class FakeImageData {
  readonly data: Uint8ClampedArray;
  constructor(
    data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {
    this.data = data;
  }
}

class FakeContext {
  imageSmoothingEnabled = true;
  constructor(private readonly canvas: FakeCanvas) {}
  putImageData(img: FakeImageData, x: number, y: number): void {
    if (x !== 0 || y !== 0 || img.width !== this.canvas.width || img.height !== this.canvas.height) throw new Error('the fake canvas only puts a whole picture at 0,0');
    this.canvas.px.set(img.data);
  }
  getImageData(x: number, y: number, w: number, h: number): FakeImageData {
    if (x !== 0 || y !== 0 || w !== this.canvas.width || h !== this.canvas.height) throw new Error('the fake canvas only reads a whole picture');
    return new FakeImageData(new Uint8ClampedArray(this.canvas.px), w, h);
  }
  drawImage(src: FakeCanvas, x: number, y: number): void {
    if (x !== 0 || y !== 0 || src.width !== this.canvas.width || src.height !== this.canvas.height) throw new Error('the fake canvas only copies a whole picture at 0,0');
    this.canvas.px.set(src.px);
  }
}

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => new FakeCanvas() });
  vi.stubGlobal('HTMLCanvasElement', FakeCanvas);
  vi.stubGlobal('ImageData', FakeImageData);
});
afterEach(() => vi.unstubAllGlobals());

// ------------------------------------------------------------------ a known picture

/** A 4x1 two-cell sheet (cells of 2x1): [opaque orange, opaque black | transparent white, half transparent orange]. */
const PIXELS: Array<[number, number, number, number]> = [
  [200, 100, 50, 255],
  [0, 0, 0, 255],
  [255, 255, 255, 0],
  [200, 100, 50, 128],
];

function addSheet(textures: TextureManager, key = 'sheet'): string {
  const raw: Raw = { w: 4, h: 1, px: new Uint8ClampedArray(PIXELS.flat()) };
  addCanvasOnce(textures, key, rawToCanvas(raw));
  textures.addFrames(key, { 0: [0, 0, 2, 1], 1: [2, 0, 2, 1] });
  return key;
}

const pixelsOf = (textures: TextureManager, key: string): number[][] => {
  const raw = readTexture(textures, key);
  const out: number[][] = [];
  for (let i = 0; i < raw.px.length; i += 4) out.push([raw.px[i] ?? 0, raw.px[i + 1] ?? 0, raw.px[i + 2] ?? 0, raw.px[i + 3] ?? 0]);
  return out;
};

const FOG = '#34305a'; // (52, 48, 90)

describe('hazedTexture, un-mocked: the pixels of a depth-hazed picture', () => {
  it('blends every drawn pixel toward the fog by the amount, rounds each channel, and leaves alpha alone (amount 0.09, the street’s row 1)', () => {
    const { game } = headlessGame();
    const sheet = addSheet(game.textures);
    const key = hazedTexture(game.textures, sheet, FOG, 0.09);
    expect(key).toBe('haze-sheet-34305a-9');
    // Orange (200, 100, 50): r 200 + (52 - 200) * 0.09 = 186.68 -> 187, g 100 + (48 - 100) * 0.09 = 95.32 -> 95, b 50 + (90 - 50) * 0.09 = 53.6 -> 54.
    // Black (0, 0, 0): 4.68 -> 5, 4.32 -> 4, 8.1 -> 8.
    expect(pixelsOf(game.textures, key)).toEqual([
      [187, 95, 54, 255],
      [5, 4, 8, 255],
      // A fully transparent pixel is not drawn, so it keeps the colour it had.
      [255, 255, 255, 0],
      // Half transparent: the colour is blended and the alpha stays 128.
      [187, 95, 54, 128],
    ]);
  });

  it('gives the other rows their own numbers: 0.12 (the farthest row), 0.06 and 0.03 on the same orange', () => {
    const { game } = headlessGame();
    const sheet = addSheet(game.textures);
    // 0.12: r 182.24 -> 182, g 93.76 -> 94, b 54.8 -> 55.
    expect(pixelsOf(game.textures, hazedTexture(game.textures, sheet, FOG, 0.12))[0]).toEqual([182, 94, 55, 255]);
    // 0.06: r 200 - 8.88 = 191.12 -> 191, g 100 - 3.12 = 96.88 -> 97, b 50 + 2.4 = 52.4 -> 52.
    expect(pixelsOf(game.textures, hazedTexture(game.textures, sheet, FOG, 0.06))[0]).toEqual([191, 97, 52, 255]);
    // 0.03: r 200 - 4.44 = 195.56 -> 196, g 100 - 1.56 = 98.44 -> 98, b 50 + 1.2 = 51.2 -> 51.
    expect(pixelsOf(game.textures, hazedTexture(game.textures, sheet, FOG, 0.03))[0]).toEqual([196, 98, 51, 255]);
  });

  it('keeps the size and the named frames of the picture (a sheet’s cells), and does not change the original', () => {
    const { game } = headlessGame();
    const sheet = addSheet(game.textures);
    const key = hazedTexture(game.textures, sheet, FOG, 0.09);
    const base = game.textures.get(sheet);
    const hazed = game.textures.get(key);
    expect([hazed.width, hazed.height]).toEqual([base.width, base.height]);
    expect([...hazed.frames.keys()].sort()).toEqual([...base.frames.keys()].sort());
    for (const [name, f] of base.frames) expect(hazed.frames.get(name)).toMatchObject({ x: f.x, y: f.y, w: f.w, h: f.h });
    expect(pixelsOf(game.textures, sheet)).toEqual(PIXELS.map((p) => [...p]));
  });

  it('bakes each copy once: asking again finds the same key and adds no texture; no haze (amount 0 or less) is the picture itself', () => {
    const { game } = headlessGame();
    const sheet = addSheet(game.textures);
    const a = hazedTexture(game.textures, sheet, FOG, 0.09);
    const count = game.textures.getTextureKeys().length;
    expect(hazedTexture(game.textures, sheet, FOG, 0.09)).toBe(a);
    expect(game.textures.getTextureKeys().length).toBe(count);
    expect(hazedTexture(game.textures, sheet, FOG, 0)).toBe(sheet);
    expect(hazedTexture(game.textures, sheet, FOG, -0.5)).toBe(sheet);
    // Another amount, another fog: another copy under another name.
    expect(hazedTexture(game.textures, sheet, FOG, 0.12)).toBe('haze-sheet-34305a-12');
    expect(hazedTexture(game.textures, sheet, '#2a4a44', 0.09)).toBe('haze-sheet-2a4a44-9');
  });
});

describe('variantOf, un-mocked: the other two users of it, flash and tint', () => {
  it('a full flash washes the lit pixels 85% toward white and keeps the dark outline as it is', () => {
    const { game } = headlessGame();
    const sheet = addSheet(game.textures);
    const key = flashTexture(game.textures, sheet, 1);
    expect(key).toBe('flash-sheet');
    // Orange has luminance 124 (at least 40): r 200 + 55 * 0.85 = 246.75 -> 247, g 100 + 155 * 0.85 = 231.75 -> 232, b 50 + 205 * 0.85 = 224.25 -> 224.
    // Black has luminance 0 (under 40): unchanged.
    expect(pixelsOf(game.textures, key)).toEqual([
      [247, 232, 224, 255],
      [0, 0, 0, 255],
      [255, 255, 255, 0],
      [247, 232, 224, 128],
    ]);
  });

  it('a half tint (strength 0.5, two steps) washes the lit pixels a quarter toward red and keeps the dark ones', () => {
    const { game } = headlessGame();
    const sheet = addSheet(game.textures);
    const key = tintTexture(game.textures, sheet, 0.5);
    expect(key).toBe('tint2-ff3b3b-sheet');
    // Red (255, 59, 59), mix 0.5 * (2 / 4) = 0.25: r 200 + 55 * 0.25 = 213.75 -> 214, g 100 - 41 * 0.25 = 89.75 -> 90, b 50 + 9 * 0.25 = 52.25 -> 52.
    expect(pixelsOf(game.textures, key)[0]).toEqual([214, 90, 52, 255]);
    expect(pixelsOf(game.textures, key)[1]).toEqual([0, 0, 0, 255]);
    expect(tintTexture(game.textures, sheet, 0)).toBe(sheet);
  });
});

// ------------------------------------------------------------------ the haze through a real Figure

class Host extends Scene<void> {
  fixedUpdate(): void {}
}

function setup(): { scene: Host; textures: TextureManager; stage: StageConfig; sheet: string } {
  const { game } = headlessGame();
  const scene = new Host();
  void game.run(scene);
  const sheet = addSheet(game.textures, 'hero');
  const stage = fixtureStages().street;
  if (!stage?.depthTint) throw new Error('the fixture street has no depth haze');
  return { scene, textures: game.textures, stage, sheet };
}

function heroOn(stage: StageConfig, row: number): FigureSpec {
  const slot = stage.party.find((s) => s.row === row);
  if (!slot) throw new Error(`no party slot on row ${row}`);
  const art = { raw: { w: 2, h: 1, px: new Uint8ClampedArray(8) }, box: { x0: 0, y0: 0, x1: 1, y1: 0, feet: 1 }, foot: { x: 1, y: 1 }, face: { x: 0, y: 0 }, grain: 1 };
  return { id: `hero-row-${row}`, side: 'party', name: 'Hero', boss: false, slot, baseTex: 'hero', fig: art, art, mirror: false, idle: 'still', uid: 0, cellW: 2, cellH: 1, axisKey: 'kit', sheet: { fps: 8, count: 2, phase: 0 } };
}

describe('Figure, with the real haze: which picture a figure shows on which row', () => {
  it('shows the hazed picture on a hazed row, the plain one on the nearest row, and the plain one for the acting hero and the target even on a hazed row (exemptActive)', () => {
    const { scene, textures, stage } = setup();
    const tint = stage.depthTint;
    if (!tint) throw new Error('no haze');
    const amounts = tint.amounts;
    const shown = (row: number, mark?: 'active' | 'target'): string => {
      const f = new Figure(scene, heroOn(stage, row), stage, 0);
      f.applyAxis({ x: 0, y: 0 });
      f.place(stage, heroOn(stage, row).slot);
      if (mark === 'active') f.active = true;
      if (mark === 'target') f.target = true;
      f.restyle({ stage, textures, worldFrame: 0 });
      return f.describe().body.texture;
    };
    // The fixture's street: rows 0 to 4 have amounts 0.12, 0.09, 0.06, 0.03, 0 (the nearest row is on the bottom).
    expect(amounts).toEqual([0.12, 0.09, 0.06, 0.03, 0]);
    expect(shown(1)).toBe('haze-hero-34305a-9');
    expect(shown(2)).toBe('haze-hero-34305a-6');
    expect(shown(3)).toBe('haze-hero-34305a-3');
    expect(shown(4), 'the nearest row has no haze').toBe('hero');
    expect(tint.exemptActive).toBe(true);
    expect(shown(1, 'active'), 'the acting hero is exempt').toBe('hero');
    expect(shown(1, 'target'), 'the target is exempt').toBe('hero');
    // And the picture on the hazed row really is the hazed pixels, not the plain ones.
    expect(pixelsOf(textures, 'haze-hero-34305a-9')[0]).toEqual([187, 95, 54, 255]);
  });

  it('an enemy on the farthest row of group "3" gets the 0.12 haze', () => {
    const { scene, textures, stage } = setup();
    const slot = enemySlots(stage, '3')[0];
    if (!slot) throw new Error('no enemy slot');
    expect(slot.row).toBe(0);
    const { sheet: _heroSheet, ...heroSpec } = heroOn(stage, 1);
    const spec: FigureSpec = { ...heroSpec, side: 'enemy', slot, id: 'foe#0', mirror: true };
    const f = new Figure(scene, spec, stage, undefined);
    f.applyAxis({ x: 0, y: 0 });
    f.place(stage, slot);
    f.restyle({ stage, textures, worldFrame: 0 });
    expect(f.describe().body.texture).toBe('haze-hero-34305a-12');
  });
});
