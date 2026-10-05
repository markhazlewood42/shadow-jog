/**
 * The lab's content, written ONCE as plain data (no engine objects), so two different programs can
 * draw it and be compared:
 *   - lab.ts builds a Shadow Jog Engine scene from it (Pixi, on the GPU);
 *   - reference.ts draws it with plain Canvas 2D (on the CPU), the way the shipped game does.
 * The e2e spec then checks that the two pictures match (docs/engine/tooling-and-testing.md, "Parity").
 *
 * It uses the game's OWN code-drawn art, so the lab looks like Shadow Jog: the street and barrens
 * battle backdrops (src/art/battlebg.ts), two enemies (src/art/enemies.ts), and text in the game's
 * pixel font (src/engine/font.ts).
 *
 * The screen is 480x270. The WORLD is two screens wide (960x270) and a slow camera pan shows both.
 * The UI layer does not move with the camera.
 */
import { battleBg } from '../art/battlebg';
import { enemyArt } from '../art/enemies';
import { surface } from '../engine/canvas';
import { drawText, measure } from '../engine/font';
import { must } from '../sje';

/** One canvas the lab hands to the TextureManager. `frames` are `[x, y, w, h]`. */
export interface LabTexture {
  key: string;
  canvas: HTMLCanvasElement;
  frames?: Record<string, [number, number, number, number]>;
}

interface Common {
  name: string;
  /** A higher depth draws later, among siblings. */
  depth: number;
}

export interface ImageLeaf extends Common {
  kind: 'image';
  tex: string;
  frame?: string;
  x: number;
  y: number;
  originX: number;
  originY: number;
  scale: number;
  flipX: boolean;
  alpha: number;
  /** An animated sprite: which frame to show at this tick. The scene calls setFrame; the reference reads it. */
  frameAt?: (tick: number) => string;
}

export interface RectLeaf extends Common {
  kind: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  color: number;
  alpha: number;
}

export interface LineLeaf extends Common {
  kind: 'line';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: number;
  alpha: number;
}

export type Leaf = ImageLeaf | RectLeaf | LineLeaf;

/** A container: its children sort among themselves, and move with it. */
export interface GroupNode extends Common {
  kind: 'group';
  x: number;
  y: number;
  children: Leaf[];
}

export type LabNode = Leaf | GroupNode;

export type LayoutName =
  | 'titleBar' | 'row1' | 'row2' | 'row3' | 'whole' | 'fracHalf' | 'fracQuarter' | 'flipped' | 'unflipped' | 'animated' | 'scaled2x' | 'halfAlpha'
  | 'rectOpaque' | 'rectAlpha' | 'rectEdge' | 'lineH' | 'lineV' | 'text' | 'sort' | 'sortRedOnly' | 'sortRedGreen' | 'sortAll' | 'sortGreenBlue';

export interface LabRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LabContent {
  textures: LabTexture[];
  world: LabNode[];
  ui: LabNode[];
  /** The probe sprite the test hook moves (a leaf in `ui`). */
  probe: ImageLeaf;
  /** Camera scroll at a tick, BEFORE rounding. A slow triangle wave across the 960 px world (0.4 px per tick). */
  panX(tick: number): number;
  /** Where things are, for the tests to look at. Screen pixels. */
  layout: Record<LayoutName, LabRect>;
}

export const WORLD_W = 960;

/** The frame every animated sprite shows at a tick: changes every 8 ticks. */
export const animFrame = (tick: number): string => `p${Math.floor(tick / 8) % 4}`;

const PANEL = 0x0e0c1c;

/** A 32x8 sheet of four 8x8 probe pictures, each lopsided so a flip or a shift shows at once. */
function probeSheet(): LabTexture {
  const s = surface(32, 8);
  const c = s.ctx;
  const px = (x: number, y: number, col: string) => {
    c.fillStyle = col;
    c.fillRect(x, y, 1, 1);
  };
  // p0: a checker, with a red top-left corner and a cyan bottom-right corner
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) px(x, y, (x + y) % 2 ? '#f4f1ff' : '#b07cff');
  px(0, 0, '#ff4fb0');
  px(7, 7, '#3fe0f0');
  // p1: an arrow pointing right, with a yellow tail
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) px(8 + x, y, '#1c1636');
  for (let i = 0; i < 4; i++) for (let y = 3 - i; y <= 4 + i; y++) px(8 + 3 + i, y, '#3fe0f0');
  for (let x = 0; x < 4; x++) {
    px(8 + x, 3, '#ffcc3d');
    px(8 + x, 4, '#ffcc3d');
  }
  // p2: vertical stripes of the game's palette
  const cols = ['#ff4fb0', '#ffcc3d', '#3fe0f0', '#62e06a'];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) px(16 + x, y, cols[x >> 1] ?? '#fff');
  // p3: a diagonal with a dot in the corner
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) px(24 + x, y, x === y ? '#f4f1ff' : x > y ? '#2a1446' : '#4a1e58');
  px(24 + 7, 0, '#ffcc3d');
  return { key: 'probe', canvas: s.canvas, frames: { p0: [0, 0, 8, 8], p1: [8, 0, 8, 8], p2: [16, 0, 8, 8], p3: [24, 0, 8, 8] } };
}

/** Three solid 24x24 swatches (red, green, blue), each with a light 1 px rim, in one sheet. */
function swatchSheet(): LabTexture {
  const s = surface(72, 24);
  const c = s.ctx;
  ['#e8452e', '#62e06a', '#3a6aff'].forEach((col, i) => {
    c.fillStyle = col;
    c.fillRect(i * 24, 0, 24, 24);
    c.fillStyle = '#f4f1ff';
    c.fillRect(i * 24, 0, 24, 1);
    c.fillRect(i * 24, 0, 1, 24);
  });
  return { key: 'swatches', canvas: s.canvas, frames: { r: [0, 0, 24, 24], g: [24, 0, 24, 24], b: [48, 0, 24, 24] } };
}

/** One line of text in the game's font, on a transparent canvas just big enough (the font draws a 1 px shadow). */
function textTexture(key: string, text: string, color: string): LabTexture {
  const s = surface(measure(text) + 2, 11);
  drawText(s.ctx, text, 0, 0, { color });
  return { key, canvas: s.canvas };
}

/** Even-width art only: the origin of a 0.5 picture is then a whole pixel. Feet-down origin: bottom middle. */
function feetOrigin(canvas: HTMLCanvasElement): { originX: number; originY: number } {
  return { originX: Math.floor(canvas.width / 2) / canvas.width, originY: 1 };
}

export function buildLabContent(): LabContent {
  const street = battleBg('street');
  const barrens = battleBg('barrens');
  const punk = enemyArt('punk');
  const hound = enemyArt('hound');

  const textures: LabTexture[] = [
    { key: 'bg-street', canvas: street.canvas },
    { key: 'bg-barrens', canvas: barrens.canvas },
    { key: 'enemy-punk', canvas: punk.canvas },
    { key: 'enemy-hound', canvas: hound.canvas },
    probeSheet(),
    swatchSheet(),
    textTexture('txt-title', 'SHADOW JOG ENGINE LAB', '#3fe0f0'),
    textTexture('txt-a', 'Kit: Quit stalling. The Milk Run waits for nobody.', '#f4f1ff'),
    textTexture('txt-b', '0123456789 HP 42/60 TP 12  Gold 1,305', '#ffcc3d'),
    textTexture('txt-c', 'The quick brown fox jumps over the lazy dog.', '#8b8fa8'),
  ];
  const tex = (key: string) => must(textures.find((t) => t.key === key), `lab texture ${key}`);

  // ---------------------------------------------------------------- world (pans with the camera)
  const world: LabNode[] = [];
  // The backdrops are 240x135 pictures, shown at 2x: the battle's own "grain 2" (design: scene-graph 7).
  world.push({ kind: 'image', name: 'street', tex: 'bg-street', x: 0, y: 0, originX: 0, originY: 0, scale: 2, flipX: false, alpha: 1, depth: -1 });
  world.push({ kind: 'image', name: 'barrens', tex: 'bg-barrens', x: 480, y: 0, originX: 0, originY: 0, scale: 2, flipX: false, alpha: 1, depth: -1 });
  // Thin 1 px vertical lines every 40 px: the harshest test for a shimmering pan.
  for (let x = 20; x < WORLD_W; x += 40) world.push({ kind: 'line', name: `tick-${x}`, x0: x, y0: 150, x1: x, y1: 166, color: 0xffcc3d, alpha: 1, depth: 1 });
  // A translucent ground stripe across the whole world.
  world.push({ kind: 'rect', name: 'ground-stripe', x: 0, y: 238, w: WORLD_W, h: 6, color: 0x3fe0f0, alpha: 0.5, depth: 2 });
  // Enemies: the punk at 2x on a whole pixel, the hound at 1:1 on a FRACTIONAL position (it draws at 301,225),
  // and a mirrored punk in the second screen.
  world.push({ kind: 'image', name: 'punk', tex: 'enemy-punk', x: 120, y: 236, ...feetOrigin(punk.canvas), scale: 2, flipX: false, alpha: 1, depth: 10 });
  world.push({ kind: 'image', name: 'hound', tex: 'enemy-hound', x: 300.5, y: 224.5, ...feetOrigin(hound.canvas), scale: 1, flipX: false, alpha: 1, depth: 11 });
  world.push({ kind: 'image', name: 'punk-mirrored', tex: 'enemy-punk', x: 640, y: 236, ...feetOrigin(punk.canvas), scale: 2, flipX: true, alpha: 1, depth: 10 });

  // ---------------------------------------------------------------- ui (fixed on the screen)
  const ui: LabNode[] = [];
  const layout = {} as LabContent['layout']; // every name is filled in below
  const rect = (name: string, x: number, y: number, w: number, h: number, color: number, alpha = 1, depth = 0): void => {
    ui.push({ kind: 'rect', name, x, y, w, h, color, alpha, depth });
  };
  // Title bar and an opaque panel behind each test area, so each area has a flat, known background.
  rect('title-bar', 0, 0, 480, 18, PANEL);
  ui.push({ kind: 'image', name: 'title', tex: 'txt-title', x: 6, y: 4, originX: 0, originY: 0, scale: 1, flipX: false, alpha: 1, depth: 5 });
  layout.titleBar = { x: 0, y: 0, w: 480, h: 18 };

  // Row 1: sprites at whole and fractional positions, flipped, animated, scaled, translucent.
  rect('row1-panel', 4, 22, 296, 30, PANEL);
  layout.row1 = { x: 4, y: 22, w: 296, h: 30 };
  const sprite = (name: string, x: number, y: number, extra: Partial<ImageLeaf> = {}): ImageLeaf => {
    const leaf: ImageLeaf = { kind: 'image', name, tex: 'probe', frame: 'p0', x, y, originX: 0.5, originY: 0.5, scale: 1, flipX: false, alpha: 1, depth: 5, ...extra };
    ui.push(leaf);
    return leaf;
  };
  sprite('whole', 20, 36);
  sprite('frac-half', 40.5, 36.5); // draws at 41,37 (Math.round)
  sprite('frac-quarter', 60.25, 36.75); // draws at 60,37
  sprite('flipped', 80, 36, { frame: 'p1', flipX: true });
  sprite('unflipped', 100, 36, { frame: 'p1' });
  sprite('animated', 120, 36, { frame: 'p0', frameAt: animFrame });
  sprite('scaled2x', 144, 36, { frame: 'p3', scale: 2 });
  rect('bright-bg', 160, 28, 24, 16, 0xf4f1ff, 1, 4);
  sprite('half-alpha', 172, 36, { frame: 'p2', alpha: 0.5 });
  const probe = sprite('probe', 220, 36, { frame: 'p3', depth: 9 });
  layout.whole = { x: 16, y: 32, w: 8, h: 8 };
  layout.fracHalf = { x: 37, y: 33, w: 8, h: 8 }; // 41-4, 37-4
  layout.fracQuarter = { x: 56, y: 33, w: 8, h: 8 };
  layout.flipped = { x: 76, y: 32, w: 8, h: 8 };
  layout.unflipped = { x: 96, y: 32, w: 8, h: 8 };
  layout.animated = { x: 116, y: 32, w: 8, h: 8 };
  layout.scaled2x = { x: 136, y: 28, w: 16, h: 16 };
  layout.halfAlpha = { x: 168, y: 32, w: 8, h: 8 };

  // Row 2: Graphics. Opaque and translucent rectangles, and 1 px lines.
  rect('row2-panel', 4, 56, 296, 34, PANEL);
  layout.row2 = { x: 4, y: 56, w: 296, h: 34 };
  rect('rect-opaque', 10, 62, 40, 12, 0xff4fb0, 1, 3);
  rect('rect-alpha', 56, 62, 40, 12, 0x3fe0f0, 0.5, 3);
  rect('rect-edge-a', 102, 62, 10, 12, 0xffcc3d, 1, 3); // two rectangles that touch
  rect('rect-edge-b', 112, 62, 10, 12, 0x62e06a, 1, 3);
  ui.push({ kind: 'line', name: 'line-h', x0: 130, y0: 68, x1: 170, y1: 68, color: 0xffffff, alpha: 1, depth: 3 });
  ui.push({ kind: 'line', name: 'line-v', x0: 176, y0: 60, x1: 176, y1: 86, color: 0xffffff, alpha: 1, depth: 3 });
  ui.push({ kind: 'line', name: 'line-d', x0: 184, y0: 60, x1: 208, y1: 84, color: 0xffffff, alpha: 1, depth: 3 });
  ui.push({ kind: 'line', name: 'line-d2', x0: 212, y0: 84, x1: 236, y1: 60, color: 0xff4fb0, alpha: 1, depth: 3 });
  layout.rectOpaque = { x: 10, y: 62, w: 40, h: 12 };
  layout.rectAlpha = { x: 56, y: 62, w: 40, h: 12 };
  layout.rectEdge = { x: 102, y: 62, w: 20, h: 12 };
  layout.lineH = { x: 130, y: 68, w: 41, h: 1 };
  layout.lineV = { x: 176, y: 60, w: 1, h: 27 };

  // Row 3: game-font text.
  rect('row3-panel', 4, 94, 296, 44, PANEL);
  layout.row3 = { x: 4, y: 94, w: 296, h: 44 };
  ui.push({ kind: 'image', name: 'text-a', tex: 'txt-a', x: 10, y: 98, originX: 0, originY: 0, scale: 1, flipX: false, alpha: 1, depth: 5 });
  ui.push({ kind: 'image', name: 'text-b', tex: 'txt-b', x: 10, y: 110, originX: 0, originY: 0, scale: 1, flipX: false, alpha: 1, depth: 5 });
  ui.push({ kind: 'image', name: 'text-c', tex: 'txt-c', x: 10, y: 122, originX: 0, originY: 0, scale: 1, flipX: false, alpha: 1, depth: 5 });
  layout.text = { x: 10, y: 98, w: Math.max(tex('txt-a').canvas.width, tex('txt-b').canvas.width, tex('txt-c').canvas.width), h: 35 };

  // A container with children added in the order red, green, blue but with depths 3, 1, 2:
  // they must DRAW green, blue, red (red on top).
  rect('sort-panel', 312, 22, 164, 68, PANEL);
  layout.sort = { x: 312, y: 22, w: 164, h: 68 };
  ui.push({
    kind: 'group',
    name: 'sorted',
    x: 330,
    y: 30,
    depth: 6,
    children: [
      { kind: 'image', name: 'red', tex: 'swatches', frame: 'r', x: 0, y: 0, originX: 0, originY: 0, scale: 1, flipX: false, alpha: 1, depth: 3 },
      { kind: 'image', name: 'green', tex: 'swatches', frame: 'g', x: 10, y: 10, originX: 0, originY: 0, scale: 1, flipX: false, alpha: 1, depth: 1 },
      { kind: 'image', name: 'blue', tex: 'swatches', frame: 'b', x: 20, y: 20, originX: 0, originY: 0, scale: 1, flipX: false, alpha: 1, depth: 2 },
    ],
  });
  // Where each square is on the screen (330 + local, 30 + local), and three probe points:
  layout.sortRedOnly = { x: 331, y: 31, w: 1, h: 1 }; // only red covers this
  layout.sortRedGreen = { x: 342, y: 42, w: 1, h: 1 }; // red and green overlap: red wins (depth 3 > 1)
  layout.sortAll = { x: 352, y: 52, w: 1, h: 1 }; // all three overlap: red wins
  layout.sortGreenBlue = { x: 360, y: 60, w: 1, h: 1 }; // green and blue overlap: blue wins (2 > 1)

  return {
    textures,
    world,
    ui,
    probe,
    panX: (tick) => {
      const u = (tick * 0.4) % (WORLD_W);
      return u < WORLD_W / 2 ? u : WORLD_W - u;
    },
    layout,
  };
}
