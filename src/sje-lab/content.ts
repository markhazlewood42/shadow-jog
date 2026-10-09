/**
 * The lab's sandbox scene: a small picture made of code-drawn textures, so the canary suite has pixels to
 * check that do not depend on any game art. It is built from the engine's own display objects (the
 * facade, `../sje`), so building it, drawing it and tearing it down exercises the same paths a scene will.
 *
 * What is in it, and which check it serves:
 *  - Banded background and a 1 px grid: hard edges everywhere, so a blurred or unevenly scaled picture shows.
 *  - A tile sheet with four frames, one row at whole-pixel positions: sprite and frame drawing.
 *  - A ship sprite that moves by a fractional amount each tick, and a mirrored copy: snap to pixel, flip.
 *  - A masked panel (a `Graphics` mask): the stencil canary reads it back.
 *  - A seeded noise sprite: every pixel different, so a frame hash changes if any one pixel moves.
 *
 * `enter()` and `leave()` build and tear down the whole thing. Ten cycles must leave the GL object counts where
 * they were (the leak canary).
 */
import { Container, type DisplayHost, Graphics, H, ImageObject, Sprite, type TextureManager, W } from '../sje';

/** The colors of the background bands (0xRRGGBB). */
const BANDS = [0x1b1a38, 0x23224a, 0x2c2a5c, 0x23224a];
/** Where the masked panel and its mask sit (screen pixels). The stencil canary reads these. */
export const PANEL = { x: 40, y: 40, w: 96, h: 64 } as const;
/** The part of the panel that the mask lets through. */
export const PANEL_MASK = { x: 56, y: 48, w: 40, h: 32 } as const;
/** The color of the panel's fill, bright, so "drawn outside the mask" shows. */
export const PANEL_COLOR = 0xff4fb0;

/** A tiny seeded generator (mulberry32), so the noise is the same on every page load. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** Draw the lab's textures and register them under the keys `lab/...`. */
function addTextures(textures: TextureManager): string[] {
  const keys: string[] = [];
  // The tile sheet: four 16x16 frames side by side. Each has a diagonal and a border, so the frame edges are hard.
  const tiles = textures.createCanvas('lab/tiles', 64, 16);
  const tileColors = [0x3fe0f0, 0xffb040, 0x7cff6b, 0xb06bff];
  tileColors.forEach((c, i) => {
    tiles.ctx.fillStyle = hex(c);
    tiles.ctx.fillRect(i * 16, 0, 16, 16);
    tiles.ctx.fillStyle = '#07060d';
    tiles.ctx.fillRect(i * 16 + 1, 1, 14, 14);
    tiles.ctx.fillStyle = hex(c);
    for (let d = 0; d < 12; d++) tiles.ctx.fillRect(i * 16 + 2 + d, 2 + d, 1, 1);
  });
  tiles.refresh();
  textures.addFrames('lab/tiles', { 0: [0, 0, 16, 16], 1: [16, 0, 16, 16], 2: [32, 0, 16, 16], 3: [48, 0, 16, 16] });
  keys.push('lab/tiles');
  // The ship: asymmetric (so a mirror shows), 24x16.
  const ship = textures.createCanvas('lab/ship', 24, 16);
  ship.ctx.fillStyle = '#ff4fb0';
  ship.ctx.fillRect(0, 6, 20, 4);
  ship.ctx.fillStyle = '#3fe0f0';
  ship.ctx.fillRect(14, 2, 6, 12);
  ship.ctx.fillStyle = '#ffffff';
  ship.ctx.fillRect(20, 7, 4, 2);
  ship.refresh();
  keys.push('lab/ship');
  // Noise: 64x32, every pixel from a seeded generator.
  const noise = textures.createCanvas('lab/noise', 64, 32);
  const rand = rng(1234);
  const img = noise.ctx.createImageData(64, 32);
  for (let i = 0; i < 64 * 32; i++) {
    img.data[i * 4] = Math.floor(rand() * 256);
    img.data[i * 4 + 1] = Math.floor(rand() * 256);
    img.data[i * 4 + 2] = Math.floor(rand() * 256);
    img.data[i * 4 + 3] = 255;
  }
  noise.ctx.putImageData(img, 0, 0);
  noise.refresh();
  keys.push('lab/noise');
  return keys;
}

/** The built scene: the root container, the things a test needs to reach, and a way to tear it down. */
export class LabContent {
  readonly root: Container;
  /** The moving ship and its mirrored copy. */
  readonly ship: Sprite;
  readonly mirror: ImageObject;
  /** The masked panel's pieces. */
  readonly panel: Container;
  readonly panelFill: Graphics;
  readonly panelMask: Graphics;
  private readonly keys: string[];
  private readonly textures: TextureManager;

  constructor(host: DisplayHost) {
    this.textures = host.textures;
    this.keys = addTextures(host.textures);
    this.root = new Container(host, 0, 0, 'lab');

    // Background bands, 20 px high, and a 1 px grid every 40 px.
    const bg = new Graphics(host).setDepth(0);
    for (let y = 0, i = 0; y < H; y += 20, i++) bg.fillStyle(BANDS[i % BANDS.length] ?? 0).fillRect(0, y, W, 20);
    bg.lineStyle(1, 0x4a4f86, 1);
    for (let x = 0; x <= W; x += 40) bg.lineBetween(x, 0, x, H);
    for (let y = 0; y <= H; y += 40) bg.lineBetween(0, y, W, y);
    bg.name = 'bg';
    this.root.add(bg);

    // One row of tiles at whole-pixel positions, one at half-pixel positions (they snap to the next pixel).
    for (let i = 0; i < 8; i++) {
      const t = new ImageObject(host, 160 + i * 20, 24, 'lab/tiles', i % 4).setOrigin(0, 0).setDepth(2);
      t.name = `tile${i}`;
      this.root.add(t);
      const half = new ImageObject(host, 160.5 + i * 20, 48.5, 'lab/tiles', (i + 1) % 4).setOrigin(0, 0).setDepth(2);
      half.name = `half${i}`;
      this.root.add(half);
    }

    // The moving ship, and a mirrored copy under it.
    this.ship = new Sprite(host, 40, 200, 'lab/ship').setOrigin(0, 0).setDepth(3);
    this.ship.name = 'ship';
    this.mirror = new ImageObject(host, 40, 232, 'lab/ship').setOrigin(0, 0).setFlipX(true).setDepth(3);
    this.mirror.name = 'mirror';
    this.root.add([this.ship, this.mirror]);

    // The noise sprite at scale 1, and again at scale 2 (an integer enlargement stays crisp).
    const n1 = new ImageObject(host, 420, 24, 'lab/noise').setOrigin(0, 0).setDepth(2);
    const n2 = new ImageObject(host, 420, 80, 'lab/noise').setOrigin(0, 0).setScale(2).setDepth(2);
    n1.name = 'noise1';
    n2.name = 'noise2';
    this.root.add([n1, n2]);

    // The masked panel: a bright fill with a mask that lets a smaller rectangle through.
    this.panel = new Container(host, 0, 0, 'panel');
    this.panelFill = new Graphics(host).setDepth(1);
    this.panelFill.fillStyle(PANEL_COLOR).fillRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h);
    this.panelFill.name = 'panel-fill';
    this.panelMask = new Graphics(host);
    this.panelMask.fillStyle(0xffffff).fillRect(PANEL_MASK.x, PANEL_MASK.y, PANEL_MASK.w, PANEL_MASK.h);
    this.panelMask.name = 'panel-mask';
    this.panel.add([this.panelFill, this.panelMask]);
    this.panelFill.filters.addMask(this.panelMask);
    this.root.add(this.panel.setDepth(5));
  }

  /** One simulation step: the ship moves by a fractional amount, so snap to pixel matters. */
  fixedUpdate(tick: number): void {
    this.ship.setPosition(40 + ((tick * 1.5) % 540), 200);
    this.mirror.setPosition(40 + ((tick * 1.5) % 540), 232);
    const frame = Math.floor(tick / 15) % 4;
    for (const o of this.root.list) {
      if (o instanceof ImageObject && o.name.startsWith('tile') && o.frame !== (Number(o.name.slice(4)) + frame) % 4) o.setTexture('lab/tiles', (Number(o.name.slice(4)) + frame) % 4);
    }
  }

  /** Tear it all down: the objects, then the textures. */
  destroy(): void {
    this.root.destroy();
    for (const k of this.keys) this.textures.remove(k);
  }
}
