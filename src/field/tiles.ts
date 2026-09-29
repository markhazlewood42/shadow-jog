/**
 * Procedural terrain painters. Each painter colors one 16×16 tile pixel-by-pixel into a shared
 * RGBA buffer, using stable hash noise so the same map always bakes identically.
 */
import { rgb, type RGB } from '../engine/color';
import { fbm, hash2, valueNoise } from '../engine/rng';
import type { TerrainId } from './types';

export const TS = 16;

export interface PixelBuf {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

export interface TerrainQuery {
  at(tx: number, ty: number): TerrainId;
  w: number;
  h: number;
}

type Painter = (lx: number, ly: number, wx: number, wy: number, tx: number, ty: number, q: TerrainQuery) => RGB;

const C = (h: string) => rgb(h);

const ROADS = new Set<TerrainId>(['asphalt', 'roadline', 'crosswalk', 'puddle', 'grate']);
const isRoad = (t: TerrainId) => ROADS.has(t);
const WATERS = new Set<TerrainId>(['water', 'd_water', 'w_toxic']);
export const isWater = (t: TerrainId) => WATERS.has(t);

// ------------------------------------------------------------------ palettes
const P = {
  asphalt: C('#282c42'), asphaltD: C('#20233a'), asphaltL: C('#2f334b'), asphaltSpeck: C('#383d56'), asphaltDark: C('#1b1d2e'),
  line: C('#d1aa3c'), lineD: C('#9a7e30'),
  stripe: C('#b8bccc'), stripeD: C('#8a8ea2'),
  side: C('#454a62'), sideD: C('#3a3f55'), sideSeam: C('#2e3246'), sideL: C('#50566f'),
  curbTop: C('#727894'), curbFace: C('#575c78'), gutter: C('#16182a'),
  alley: C('#2d2e3c'), alleyD: C('#242532'), alleyL: C('#363846'),
  puddle: C('#131a2f'), puddleRim: C('#1d2542'), puddleHi: C('#56669a'),
  grate: C('#44485c'), grateD: C('#101220'),
  water: C('#0f2b3a'), waterL: C('#16384a'), waterD: C('#0a1f2c'), lip: C('#4f5570'), lipD: C('#3b4057'), waterShadow: C('#081721'),
  plank: C('#4e3f3a'), plankD: C('#3a2e2b'), plankGap: C('#1c1618'),
  plazaA: C('#3f3c56'), plazaB: C('#48456a'), plazaSeam: C('#2c2a40'),
  wall: C('#151421'), void: C('#07060d'),
  dirt: C('#4a3b31'), dirtD: C('#3d3029'), dirtL: C('#57473b'),
  grass: C('#1f4533'), grassD: C('#18382a'), grassL: C('#2a5c42'), glow: C('#62e06a'),
  rubble: C('#3d3b40'), rubbleD: C('#2c2a30'), rubbleL: C('#57545c'),
  rail: C('#7a7f90'), tie: C('#3a2e28'),
  wood: C('#5c3d30'), woodD: C('#4a3027'), woodSeam: C('#2a1a16'), woodL: C('#6a4838'),
  tileA: C('#3c4c5c'), tileB: C('#354352'), grout: C('#27313c'),
  metal: C('#4a4f60'), metalD: C('#3a3e4d'), metalL: C('#5f6577'),
  carpet: C('#5a2a3c'), carpetD: C('#4a2230'), carpetL: C('#6e3a4a'),
  conc: C('#4a4a55'), concD: C('#3f3f4a'), concL: C('#55555f'),
  iwallFace: C('#3b3150'), iwallFaceD: C('#332a46'), iwallTrim: C('#5b4b74'), iwallBase: C('#1d1828'), iwallTop: C('#15121f'), iwallEdge: C('#2c2540'),
  // Sinkline: the floor is the lighter plane and the walls sit darker, so the walkable path reads
  // at a glance in the flooded gloom (they used to be the other way round, and read as one mass).
  dfloor: C('#4a5058'), dfloorD: C('#40464e'), dfloorAlgae: C('#3a5246'), dfloorL: C('#585e67'),
  dwallFace: C('#343944'), dwallFaceD: C('#2d313b'), dwallSeam: C('#22252c'), dwallStain: C('#28322f'), dwallTop: C('#101114'), dwallEdge: C('#1e2026'),
  dwater: C('#13302b'), dwaterL: C('#1b4038'), dwaterD: C('#0c2420'),
  shallow: C('#233f3f'), shallowL: C('#2d504e'),
  catwalk: C('#555b6a'), catwalkD: C('#3c4150'), catwalkHole: C('#0b1a18'),
  labFloor: C('#b9c3d0'), labFloorD: C('#a6b0be'), labSeam: C('#8a94a4'), labWallFace: C('#d3dbe6'), labWallD: C('#bcc6d2'), labStripe: C('#2fb8c8'), labTop: C('#1a1e28'), labEdge: C('#2a303e'),
  wRoad: C('#3a3a48'), wRoadD: C('#30303c'), wRoadLine: C('#6a6450'),
  wBarren: C('#5a4a3a'), wBarrenD: C('#4a3c30'), wBarrenL: C('#6a5846'),
  toxic: C('#1c3a1e'), toxicL: C('#2f6a2a'), toxicGlow: C('#7af06a'),
  hwy: C('#4a4d5c'), hwyD: C('#383a46'), hwyLine: C('#c9b04a'),
  blockRoof: C('#2a2c3c'), blockRoofL: C('#343748'), blockRoofD: C('#1e2030'), blockWin: C('#e8c46a'), blockWinC: C('#7ad8ff'), blockWinP: C('#ff6fc8'),
};

function lerpC(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// ------------------------------------------------------------------ painters
const asphalt: Painter = (_lx, _ly, wx, wy) => {
  const h = hash2(wx, wy, 11);
  if (h < 0.035) return P.asphaltSpeck;
  if (h > 0.965) return P.asphaltDark;
  const stain = valueNoise(wx / 23, wy / 17, 5);
  if (stain < 0.18) return P.asphaltDark;
  const n = fbm(wx / 7, wy / 7, 2, 3);
  if (n > 0.64) return P.asphaltL;
  if (n < 0.36) return P.asphaltD;
  return P.asphalt;
};

const roadline: Painter = (lx, ly, wx, wy, tx, ty, q) => {
  if ((ly === 7 || ly === 8) && wx % 32 < 18 && hash2(wx, wy, 4) > 0.12) return ly === 7 ? P.line : P.lineD;
  return asphalt(lx, ly, wx, wy, tx, ty, q);
};

const crosswalk: Painter = (lx, ly, wx, wy, tx, ty, q) => {
  // Zebra bands run with the traffic (horizontal for an east-west road).
  const edgeL = q.at(tx - 1, ty) !== 'crosswalk' && lx < 2;
  const edgeR = q.at(tx + 1, ty) !== 'crosswalk' && lx > 13;
  const band = wy % 8;
  if (!edgeL && !edgeR && band >= 2 && band <= 5 && hash2(wx, wy, 8) > 0.09) return band === 5 ? P.stripeD : P.stripe;
  return asphalt(lx, ly, wx, wy, tx, ty, q);
};

const sidewalk: Painter = (lx, ly, wx, wy, tx, ty, q) => {
  const below = q.at(tx, ty + 1);
  const above = q.at(tx, ty - 1);
  const left = q.at(tx - 1, ty);
  const right = q.at(tx + 1, ty);
  // Curb faces the road below (3/4 view: visible face).
  if (isRoad(below) || isWater(below)) {
    if (ly === 12) return P.curbTop;
    if (ly === 13 || ly === 14) return P.curbFace;
    if (ly === 15) return P.gutter;
  }
  if (isRoad(above) || isWater(above)) {
    if (ly === 0) return P.curbTop;
    if (ly === 1) return P.curbFace;
  }
  if (isRoad(left) && lx === 0) return P.curbTop;
  if (isRoad(right) && lx === 15) return P.curbFace;
  // Slab seams every 16px, offset every other row for a laid look.
  const off = ty % 2 === 0 ? 0 : 8;
  const sx = (lx + off) % 16;
  if (ly === 0 || sx === 0) return P.sideSeam;
  if (ly === 1 || sx === 1) return P.sideL;
  const h = hash2(wx, wy, 21);
  if (h < 0.03) return P.sideD;
  if (h > 0.985) return P.sideL;
  const stain = valueNoise(wx / 11, wy / 9, 9);
  if (stain < 0.22) return P.sideD;
  return P.side;
};

const alley: Painter = (_lx, _ly, wx, wy) => {
  const h = hash2(wx, wy, 31);
  if (h < 0.05) return P.alleyD;
  if (h > 0.97) return P.alleyL;
  const n = fbm(wx / 9, wy / 9, 3, 7);
  if (n < 0.34) return P.alleyD;
  if (n > 0.68) return P.alleyL;
  return P.alley;
};

const puddle: Painter = (lx, ly, wx, wy, tx, ty, q) => {
  const cx = lx - 7.5, cy = ly - 7.5;
  const r = Math.sqrt(cx * cx * 0.7 + cy * cy * 1.4) + (valueNoise(wx / 3, wy / 3, 13) - 0.5) * 4;
  if (r < 5.5) {
    const h = hash2(wx, wy, 14);
    if (h < 0.06) return P.puddleHi;
    return P.puddle;
  }
  if (r < 6.6) return P.puddleRim;
  return asphalt(lx, ly, wx, wy, tx, ty, q);
};

const grate: Painter = (lx, ly) => {
  if (lx < 2 || lx > 13 || ly < 2 || ly > 13) return lx === 1 || ly === 1 ? P.metalL : P.asphaltD;
  if (lx === 2 || lx === 13 || ly === 2 || ly === 13) return P.grate;
  return lx % 3 === 0 ? P.grate : P.grateD;
};

const bank = (t: TerrainId) => !isWater(t) && t !== 'bridge' && t !== 'w_bridge';

/**
 * Water sunk below the walkway: a lit lip and cast shadow under the far bank, dark lips on
 * the side and near banks, ripples, and (optionally) caustic light webs.
 */
const waterP = (base: RGB, light: RGB, dark: RGB, lipC: RGB, lipDC: RGB, shadow: RGB, caustic?: RGB): Painter =>
  (lx, ly, wx, wy, tx, ty, q) => {
    if (bank(q.at(tx, ty - 1))) {
      if (ly === 0) return lipC;
      if (ly === 1) return lipDC;
      if (ly <= 3) return shadow;
    }
    const bl = bank(q.at(tx - 1, ty)), br = bank(q.at(tx + 1, ty));
    if ((bl && lx === 0) || (br && lx === 15) || (bank(q.at(tx, ty + 1)) && ly === 15)) return lipDC;
    if ((bl && lx === 1) || (br && lx === 14)) return shadow;
    if (caustic) {
      const c1 = Math.abs(Math.sin(wx * 0.31 + Math.sin(wy * 0.23) * 2.2));
      const c2 = Math.abs(Math.sin(wy * 0.37 + Math.sin(wx * 0.19) * 2.4));
      if ((c1 < 0.1 || c2 < 0.1) && hash2(wx, wy, 5) > 0.3) return caustic;
    }
    const wave = Math.sin(wx * 0.35 + Math.sin(wy * 0.5) * 2 + wy * 0.9);
    if (wave > 0.85 && hash2(wx, wy, 3) > 0.3) return light;
    const n = fbm(wx / 13, wy / 6, 2, 17);
    if (n < 0.38) return dark;
    return base;
  };

const water = waterP(P.water, P.waterL, P.waterD, P.lip, P.lipD, P.waterShadow);

const bridge: Painter = (lx, ly, wx, wy) => {
  if (ly % 4 === 3) return P.plankGap;
  const shift = Math.floor(ly / 4) * 5;
  if ((lx + shift + Math.floor(wx / 16) * 3) % 16 === 0) return P.plankGap;
  const h = hash2(wx, wy, 41);
  if (h < 0.07) return P.plankD;
  if (ly % 4 === 0) return lerpC(P.plank, P.woodL, 0.4);
  return P.plank;
};

/** Checkered paving with wear: grimy traffic lanes, cracked and chipped slabs. */
const plaza: Painter = (lx, ly, wx, wy) => {
  const grime = fbm(wx / 24, wy / 24, 3, 53);
  if (lx % 8 === 0 || ly % 8 === 0) return grime < 0.42 ? lerpC(P.plazaSeam, [0, 0, 0], 0.3) : P.plazaSeam;
  const sx = wx % 8, sy = wy % 8;
  const slab = hash2(Math.floor(wx / 8), Math.floor(wy / 8), 54);
  const checker = (Math.floor(wx / 8) + Math.floor(wy / 8)) % 2 === 0;
  let base = checker ? P.plazaA : P.plazaB;
  if (grime < 0.45) base = lerpC(base, P.plazaSeam, (0.45 - grime) * 1.4);
  // Cracked slab: one hairline diagonal, direction per slab.
  if (slab < 0.09 && (slab < 0.045 ? sx + sy : sx - sy + 7) === 3 + Math.floor(slab * 60) % 5) return P.plazaSeam;
  // Chipped corner.
  if (slab > 0.94 && sx + sy <= 2) return P.sideD;
  if (hash2(wx, wy, 51) < 0.025) return P.sideD;
  if (sx === 1 || sy === 1) return lerpC(base, [255, 255, 255], 0.06);
  return base;
};

const solid = (c: RGB): Painter => () => c;

const dirt: Painter = (_lx, _ly, wx, wy) => {
  const h = hash2(wx, wy, 61);
  if (h < 0.025) return P.dirtD;
  if (h > 0.985) return P.dirtL;
  const n = fbm(wx / 10, wy / 10, 2, 62);
  return n < 0.36 ? lerpC(P.dirt, P.dirtD, 0.55) : P.dirt;
};

const grass: Painter = (lx, ly, wx, wy) => {
  const h = hash2(wx, wy, 71);
  if (h < 0.006) return P.glow;
  const blade = hash2(wx, Math.floor(wy / 2), 72);
  if (blade < 0.12 && ly % 2 === 0) return P.grassL;
  const n = fbm(wx / 10, wy / 10, 2, 73);
  if (n < 0.38) return P.grassD;
  void lx;
  return P.grass;
};

/** Broken stone: domain-warped so heaps don't repeat on a grid, lit from the upper left. */
const rubble: Painter = (_lx, _ly, wx, wy) => {
  const warp = (fbm(wx / 13, wy / 13, 2, 83) - 0.5) * 10;
  const at = (x: number, y: number) => fbm((x + warp) / 5, (y - warp) / 5, 3, 81);
  const n = at(wx, wy);
  const h = hash2(wx, wy, 82);
  if (n > 0.58) {
    const slope = n - at(wx - 1, wy - 1);
    if (slope > 0.025) return P.rubbleL;
    if (slope < -0.025) return P.rubbleD;
    return h < 0.12 ? P.rubbleL : P.rubble;
  }
  if (n < 0.36) return P.rubbleD;
  return h < 0.06 ? P.rubbleL : lerpC(P.rubble, P.dirt, 0.45);
};

/**
 * The Barrens' ruins at world scale: the footprints of buildings that came down. Each 48px lot
 * holds one (or stands empty): wall stubs, lit on top, broken where the noise says so, round a
 * darker floor slab, with the rubble spilling out through the gaps. Structure you can read from
 * the road, where plain rubble reads as empty ground.
 */
const RUIN_TOP = C('#9a94a4'), RUIN_FACE = C('#4a4552'), RUIN_SLAB = C('#24222c');
const wRuins: Painter = (lx, ly, wx, wy, tx, ty, q) => {
  const base = rubble(lx, ly, wx, wy, tx, ty, q);
  const L = 48;
  const lx0 = Math.floor(wx / L), ly0 = Math.floor(wy / L);
  const lot = hash2(lx0, ly0, 301);
  if (lot < 0.2) return base;
  const px = wx - lx0 * L, py = wy - ly0 * L;
  const x0 = 4 + Math.floor(hash2(lx0, ly0, 302) * 8), y0 = 4 + Math.floor(hash2(lx0, ly0, 303) * 8);
  const x1 = L - 5 - Math.floor(hash2(lx0, ly0, 304) * 8), y1 = L - 5 - Math.floor(hash2(lx0, ly0, 305) * 8);
  if (px < x0 || px > x1 || py < y0 || py > y1) return base;
  const wallX = px <= x0 + 1 || px >= x1 - 1, wallY = py <= y0 + 1 || py >= y1 - 1;
  if (wallX || wallY) {
    if (valueNoise(wx / 7, wy / 7, 306) < 0.36) return lerpC(base, RUIN_SLAB, 0.25);
    // The top course catches the light; the rest is face.
    return (wallY && py <= y0) || (wallX && px <= x0) ? RUIN_TOP : RUIN_FACE;
  }
  // Inside: the slab, darkest in the lee of the north and west walls.
  const lee = py <= y0 + 4 || px <= x0 + 3;
  return lerpC(base, RUIN_SLAB, lee ? 0.7 : 0.5);
};

/**
 * A cracked stretch of tunnel wall you can squeeze through: the brick face, split by a jagged
 * dark fissure top to bottom, with cold air (a faint cyan) at its foot. Walkable; the tell is
 * the crack and the draught, nothing else.
 */
const dWallCrack: Painter = (lx, ly, wx, wy, tx, ty, q) => {
  const face = dwallFace(lx, ly, wx, wy, tx, ty, q);
  const mid = 7 + Math.round(Math.sin(ly * 0.9) * 2);
  if (Math.abs(lx - mid) <= (ly > 10 ? 2 : 1)) return ly > 12 ? K_1E3A44 : K_06080C;
  if (Math.abs(lx - mid) === (ly > 10 ? 3 : 2)) return lerpC(face, K_06080C, 0.5);
  return face;
};

/**
 * A heap of loose scrap you can crawl through: the same junk, with a dark gap running through its
 * middle where someone has pulled a way in. Walkable.
 */
const junkLoose: Painter = (lx, ly, wx, wy, tx, ty, q) => {
  const heap = junk(lx, ly, wx, wy, tx, ty, q);
  if (ly >= 6 && ly <= 10) return ly === 6 || ly === 10 ? lerpC(heap, K_06080C, 0.55) : lerpC(K_15121A, heap, 0.25);
  return heap;
};

/** Heaped scrap: solid junk walls (Rustyard). Face shading where open ground is below. */
const JUNK_COLS: RGB[] = [C('#3a3d4a'), C('#4a4e5c'), C('#5a3e30'), C('#6a4a36'), C('#2a2c36'), C('#5a5f70'), C('#7a5a3a')];
const junk: Painter = (lx, ly, wx, wy, tx, ty, q) => {
  const below = q.at(tx, ty + 1);
  // Larger salvage chunks with soft shading read as heaped scrap rather than static.
  const n = valueNoise(wx / 7, wy / 7, 201);
  const h = hash2(Math.floor(wx / 6), Math.floor(wy / 4), 202);
  let c = lerpC(JUNK_COLS[Math.floor(h * JUNK_COLS.length)]!, [52, 44, 48], 0.3);
  if (n > 0.66) c = lerpC(c, [255, 255, 255], 0.1);
  if (n < 0.3) c = lerpC(c, [0, 0, 0], 0.3);
  if (hash2(wx, wy, 203) < 0.005) c = C('#ffcc3d');
  if (hash2(wx, wy, 204) < 0.003) c = C('#3fe0f0');
  // Bottom edge darkens where the pile meets open ground.
  if (below !== 'junk' && ly >= 13) return lerpC(c, [8, 6, 12], (ly - 12) / 4);
  void lx;
  return c;
};

const rail: Painter = (lx, ly, wx, wy, tx, ty, q) => {
  if (lx % 8 < 3 && lx % 8 >= 1) return P.tie;
  if (ly === 4 || ly === 11) return P.rail;
  if (ly === 5 || ly === 12) return lerpC(P.rail, [0, 0, 0], 0.4);
  return alley(lx, ly, wx, wy, tx, ty, q);
};

// ---- interiors
const floorWood: Painter = (lx, ly, wx, wy) => {
  const row = Math.floor(wy / 4);
  if (wy % 4 === 3) return P.woodSeam;
  const seamX = (hash2(row, 0, 91) * 32) | 0;
  if ((wx + seamX) % 32 === 0) return P.woodSeam;
  const grain = hash2(wx, wy, 92);
  if (grain < 0.08) return P.woodD;
  if (wy % 4 === 0) return P.woodL;
  void lx; void ly;
  return P.wood;
};

const floorTile: Painter = (lx, ly, wx, wy) => {
  if (lx % 8 === 0 || ly % 8 === 0) return P.grout;
  const checker = (Math.floor(wx / 8) + Math.floor(wy / 8)) % 2 === 0;
  return checker ? P.tileA : P.tileB;
};

const floorMetal: Painter = (lx, ly) => {
  if (lx === 0 || ly === 0) return P.metalD;
  if (lx === 15 || ly === 15) return P.metalD;
  const d = (lx + ly * 2) % 6;
  const e = (lx * 2 + ly) % 6;
  if (d === 0 && ly % 3 === 1) return P.metalL;
  if (e === 3 && lx % 3 === 1) return P.metalL;
  return P.metal;
};

const floorCarpet: Painter = (lx, ly, wx, wy) => {
  const d = Math.abs(lx - 7.5) + Math.abs(ly - 7.5);
  if (Math.round(d) === 6) return P.carpetL;
  if (d < 1.5) return P.carpetD;
  if (Math.round(d) === 3 && (lx + ly) % 2 === 0) return lerpC(P.carpet, P.carpetL, 0.5);
  if (hash2(wx, wy, 103) < 0.003) return [26, 14, 20];
  const faded = fbm(wx / 36, wy / 36, 2, 107) > 0.6;
  const base = faded ? lerpC(P.carpet, P.carpetL, 0.22) : P.carpet;
  return hash2(wx, wy, 101) < 0.06 ? P.carpetD : base;
};

const floorConcrete: Painter = (_lx, _ly, wx, wy) => {
  const h = hash2(wx, wy, 111);
  if (h < 0.05) return P.concD;
  if (h > 0.97) return P.concL;
  return fbm(wx / 12, wy / 12, 2, 112) < 0.4 ? P.concD : P.conc;
};

/** 3/4-view wall autotile: face where the tile below is open, cap elsewhere. */
function wallP(id: TerrainId, face: Painter, top: RGB, edge: RGB): Painter {
  return (lx, ly, wx, wy, tx, ty, q) => {
    const below = q.at(tx, ty + 1);
    if (below !== id && below !== 'void') return face(lx, ly, wx, wy, tx, ty, q);
    const l = q.at(tx - 1, ty), r = q.at(tx + 1, ty), u = q.at(tx, ty - 1);
    if ((l !== id && l !== 'void' && lx === 0) || (r !== id && r !== 'void' && lx === 15) || (u !== id && u !== 'void' && ly === 0)) return edge;
    return top;
  };
}

const iwallFace: Painter = (_lx, ly, wx) => {
  if (ly <= 1) return P.iwallTrim;
  if (ly >= 13) return ly === 13 ? P.iwallTrim : P.iwallBase;
  return wx % 6 === 0 ? P.iwallFaceD : P.iwallFace;
};

const dwallFace: Painter = (lx, ly, wx, wy) => {
  if (ly === 15) return P.dwallSeam;
  const brickRow = Math.floor(ly / 5);
  const off = brickRow % 2 === 0 ? 0 : 6;
  if (ly % 5 === 4 || (lx + off + (Math.floor(wx / 16) * 4)) % 12 === 0) return P.dwallSeam;
  if (valueNoise(wx / 5, wy / 9, 121) < 0.28) return P.dwallStain;
  if (ly % 5 === 0) return lerpC(P.dwallFace, [255, 255, 255], 0.07);
  return hash2(wx, wy, 122) < 0.1 ? P.dwallFaceD : P.dwallFace;
};

/** Wing colours for the Annex tiles below, parsed once (painters run per pixel at bake). */
const K_15121A = C('#15121a');
const K_2A2620 = C('#2a2620');
const K_2A2A30 = C('#2a2a30');
const K_2C2834 = C('#2c2834');
const K_2C313A = C('#2c313a');
const K_347060 = C('#347060');
const K_383E49 = C('#383e49');
const K_3A3542 = C('#3a3542');
const K_3C3642 = C('#3c3642');
const K_4A2A30 = C('#4a2a30');
const K_4E5664 = C('#4e5664');
const K_6A1A26 = C('#6a1a26');
const K_6A6E7A = C('#6a6e7a');
const K_77808F = C('#77808f');
const K_8A8E9A = C('#8a8e9a');
const K_9AB4CC = C('#9ab4cc');
const K_C4D6E6 = C('#c4d6e6');
const K_CDEEFF = C('#cdeeff');
const K_D6E4F0 = C('#d6e4f0');
const K_E8C040 = C('#e8c040');
const K_EEF6FC = C('#eef6fc');
const K_EEF8FF = C('#eef8ff');
const K_F6FBFF = C('#f6fbff');
const K_FF3A4A = C('#ff3a4a');
const K_FFB13D = C('#ffb13d');
const K_2A2E38 = C('#2a2e38');
const K_1E1A24 = C('#1e1a24');
const K_1E3A44 = C('#1e3a44');
const K_2A2630 = C('#2a2630');
const K_06080C = C('#06080c');

/**
 * Lab wall face. Its trim stripe takes the colour of the wing it faces (the floor below it), so
 * each wing reads at a glance: cyan halls, amber armory, ice cryo wing, red containment, and a
 * hazard band over the service bay.
 */
const WING_STRIPE: Partial<Record<TerrainId, RGB>> = {
  lab_floor_steel: K_FFB13D, lab_floor_frost: K_CDEEFF, lab_floor_contain: K_FF3A4A, lab_floor_plate: K_FF3A4A,
};
const labWallFace: Painter = (lx, ly, _wx, _wy, tx, ty, q) => {
  const wing = q.at(tx, ty + 1);
  if (ly === 15) return P.labSeam;
  if (ly === 10 || ly === 11) {
    if (wing === 'floor_concrete') return (lx + ly) % 6 < 3 ? K_E8C040 : K_2A2A30;
    return WING_STRIPE[wing] ?? P.labStripe;
  }
  if (lx === 0) return P.labSeam;
  if (ly <= 1) return P.labWallD;
  // Containment's walls are scorched darker; the cryo wing's carry a rime line under the trim.
  if (wing === 'lab_floor_contain' || wing === 'lab_floor_plate') return ly >= 12 ? K_6A6E7A : K_8A8E9A;
  if (wing === 'lab_floor_frost' && ly === 12) return K_EEF8FF;
  // Below the trim, a wainscot washed in the wing's colour: wayfinding at a glance, not a line.
  const tint = WING_STRIPE[wing];
  if (tint && ly >= 12) return lerpC(P.labWallFace, tint, ly === 12 ? 0.55 : 0.32);
  return P.labWallFace;
};

const dfloorDry: Painter = (_lx, _ly, wx, wy) => {
  const h = hash2(wx, wy, 131);
  if (h < 0.05) return P.dfloorD;
  if (h > 0.975) return P.dfloorL;
  const a = valueNoise(wx / 14, wy / 10, 132);
  if (a < 0.25) return P.dfloorAlgae;
  if (wx % 32 === 0 || wy % 32 === 0) return P.dfloorD;
  return P.dfloor;
};

/** Dungeon floor, darkened and algae-stained where it meets the flood (wet lips). */
const dfloor: Painter = (lx, ly, wx, wy, tx, ty, q) => {
  const c = dfloorDry(lx, ly, wx, wy, tx, ty, q);
  const wet = (dx: number, dy: number, d: number) => isWater(q.at(tx + dx, ty + dy)) && d < 4 && (d < 2 || hash2(wx, wy, 134) < 0.5);
  if (wet(0, 1, 15 - ly) || wet(-1, 0, lx) || wet(1, 0, 15 - lx) || wet(0, -1, ly)) return lerpC(c, P.dwaterD, 0.45);
  return c;
};

const dwater = waterP(P.dwater, P.dwaterL, P.dwaterD, P.dfloorL, P.dfloorD, [8, 22, 18], K_347060);

/**
 * Ankle-deep water over the floor. The floor shows through, bent by the surface; the surface
 * carries horizontal ripple streaks and sparse glints; and where the water meets dry ground
 * there's a waterline (a dark wet lip and a thin bright edge), so a pool reads as a pool.
 */
const WET = new Set<TerrainId>(['d_shallow', 'd_water']);
const shallow: Painter = (lx, ly, wx, wy, tx, ty, q) => {
  // Waterline against dry neighbours.
  const dryUp = !WET.has(q.at(tx, ty - 1)), dryDown = !WET.has(q.at(tx, ty + 1));
  const dryLeft = !WET.has(q.at(tx - 1, ty)), dryRight = !WET.has(q.at(tx + 1, ty));
  if ((dryUp && ly === 0) || (dryLeft && lx === 0) || (dryRight && lx === 15)) return P.shallowL;
  if ((dryUp && ly === 1) || (dryLeft && lx === 1) || (dryRight && lx === 14) || (dryDown && ly === 15)) return lerpC(P.shallow, [8, 16, 18], 0.5);
  // The floor underneath, bent by the surface.
  const bend = Math.round(Math.sin(wy / 3 + wx / 17) * 1.5);
  const base = dfloorDry(lx, ly, wx + bend, wy, tx, ty, q);
  const n = fbm(wx / 10, wy / 7, 2, 141);
  let w = lerpC(P.shallow, P.shallowL, Math.min(1, Math.max(0, (n - 0.55) * 2.5)));
  // Ripple streaks: short horizontal highlights where a stretched noise band crests.
  const band = valueNoise(wx / 9, wy / 2.2, 143);
  if (band > 0.74 && band < 0.8) w = lerpC(P.shallowL, [120, 170, 170], 0.35);
  if (hash2(wx, wy, 142) < 0.006) w = [140, 190, 190];
  return lerpC(base, w, 0.62);
};

const catwalk: Painter = (lx, ly, wx, wy) => {
  if (ly === 0 || ly === 15) return P.catwalkD;
  if ((lx % 4 === 1 || lx % 4 === 2) && (ly % 4 === 1 || ly % 4 === 2)) return P.catwalkHole;
  void wx; void wy;
  return lx % 4 === 0 ? P.catwalkD : P.catwalk;
};

/**
 * Water under a catwalk reads the walkway as raised over the flood: the deck's steel fascia along
 * the edge, struts going down into the water every eight pixels, and the deck's shadow on the
 * surface fading out below. Water beside a catwalk gets a thinner side shadow.
 */
function underCatwalk(p: Painter): Painter {
  return (lx, ly, wx, wy, tx, ty, q) => {
    const c = p(lx, ly, wx, wy, tx, ty, q);
    if (q.at(tx, ty - 1) === 'd_catwalk') {
      if (ly <= 1) return ly === 0 ? P.catwalkD : K_2A2E38;
      if (wx % 8 === 3 && ly <= 10) return lerpC(K_2A2E38, c, ly / 14);
      if (ly <= 7) return lerpC(c, K_06080C, 0.6 - ly * 0.07);
    }
    if (q.at(tx - 1, ty) === 'd_catwalk' && lx <= 2) return lerpC(c, K_06080C, 0.45 - lx * 0.12);
    if (q.at(tx + 1, ty) === 'd_catwalk' && lx >= 14) return lerpC(c, K_06080C, 0.2);
    return c;
  };
}

/** Abandoned-lab tiles: dust drifts, boot scuffs, the odd stain. */
const labFloor: Painter = (lx, ly, wx, wy) => {
  if (lx === 0 || ly === 0) return P.labSeam;
  let base = lx === 15 || ly === 15 ? P.labFloorD : P.labFloor;
  const scuff = fbm(wx / 24, wy / 24, 2, 361);
  if (scuff < 0.3) base = lerpC(base, P.labSeam, (0.3 - scuff) * 0.8);
  // Polished sheen: a soft diagonal highlight across each tile.
  if (lx + ly === 9 || lx + ly === 10) base = lerpC(base, [255, 255, 255], 0.12);
  if (hash2(wx, wy, 363) < 0.003) return P.labFloorD;
  return base;
};

/** Armory: steel tread plate, raised diagonal bosses lit from the upper left, oil and grime. */
const labFloorSteel: Painter = (lx, ly, wx, wy) => {
  if (lx === 0 || ly === 0) return K_2C313A;
  const bx = lx >> 2, by = ly >> 2, ix = lx & 3, iy = ly & 3;
  let base = K_4E5664;
  const back = (bx + by) % 2 === 0;
  const on = back ? ix === iy && ix >= 1 && ix <= 2 : ix + iy === 3 && ix >= 1 && ix <= 2;
  const under = back ? ix === iy + 1 && ix >= 2 : ix + iy === 4 && ix >= 2;
  if (on) base = K_77808F;
  else if (under) base = K_383E49;
  const grime = fbm(wx / 18, wy / 18, 2, 371);
  if (grime < 0.32) base = lerpC(base, K_2A2620, (0.32 - grime) * 1.4);
  return base;
};

/** Cryo wing: pale tile under rime, crystalline frost veins, a cold sheen. */
const labFloorFrost: Painter = (lx, ly, wx, wy) => {
  if (lx === 0 || ly === 0) return K_9AB4CC;
  let base = K_C4D6E6;
  if (lx + ly === 9 || lx + ly === 10) base = K_D6E4F0;
  const rime = fbm(wx / 7, wy / 7, 2, 381);
  if (rime > 0.6) base = lerpC(base, K_EEF6FC, Math.min(1, (rime - 0.6) * 4));
  const vein = valueNoise(wx / 9 + valueNoise(wx / 23, wy / 23, 383) * 1.6, wy / 9, 382);
  if (Math.abs(vein - 0.5) < 0.016) return K_F6FBFF;
  return base;
};

/** Containment: dark grating over a red-lit void, heavier seams where the plates meet. */
const labFloorContain: Painter = (lx, ly, wx, wy) => {
  if (lx === 0 || ly === 0) return K_3C3642;
  // Grating bars every 4px, with red light from the sump below glowing through in slow patches.
  if (lx % 4 === 0 || ly % 4 === 0) {
    const glow = valueNoise(wx / 40, wy / 30, 391);
    return lerpC(K_15121A, K_6A1A26, Math.max(0, glow - 0.45) * 1.2);
  }
  if (hash2(wx, wy, 392) < 0.006) return K_4A2A30;
  return K_2C2834;
};

/**
 * The Warden chamber's deck: heavy 32px plates, bevelled (lit from the upper left), riveted at
 * the corners, stained where coolant has run. Large, calm shapes, so the room's centrepiece (the
 * binding circle) is what the eye finds, not a field of grating.
 */
const labFloorPlate: Painter = (_lx, _ly, wx, wy) => {
  const px = ((wx % 32) + 32) % 32, py = ((wy % 32) + 32) % 32;
  if (px === 0 || py === 0) return K_15121A;
  if (px === 1 || py === 1) return K_3C3642;
  if (px === 31 || py === 31) return K_1E1A24;
  if ((px === 4 || px === 28) && (py === 4 || py === 28)) return K_4E5664;
  let base = K_2A2630;
  const stain = valueNoise(wx / 26, wy / 18, 395);
  if (stain < 0.28) base = lerpC(base, K_4A2A30, (0.28 - stain) * 1.6);
  if (hash2(wx, wy, 396) < 0.004) return K_3A3542;
  return base;
};

/** Security laser lattice across a doorway: emitter posts at the tile edges, red beams between. */
/** Under a live lattice: the floor washed red along the beams (the beams themselves are the 'laser' prop). */
const labLaser: Painter = (lx, ly, wx, wy, tx, ty, q) => {
  const floor = labFloor(lx, ly, wx, wy, tx, ty, q);
  if (lx === 3 || lx === 8 || lx === 12) return lerpC(floor, C('#ff3a4a'), 0.55);
  if (lx === 2 || lx === 4 || lx === 7 || lx === 9 || lx === 11 || lx === 13) return lerpC(floor, C('#ff3a4a'), 0.2);
  return floor;
};

/** A lattice row whose emitter is dark: empty housings, dead lenses. Still sealed by the interlock. */
const labLaserOff: Painter = (lx, ly, wx, wy, tx, ty, q) => {
  const floor = labFloor(lx, ly, wx, wy, tx, ty, q);
  // Where the beams ran: faint scorch lines, dashed, cold.
  if ((lx === 3 || lx === 8 || lx === 12) && ly % 4 !== 1) return lerpC(floor, C('#3a1a20'), 0.35);
  return floor;
};

const labDoor: Painter = (lx, ly) => {
  if (ly <= 1 || ly >= 14) return P.labSeam;
  if (lx === 7 || lx === 8) return C('#1a1e28');
  if (ly === 3 && lx >= 5 && lx <= 10) return C('#ff3a4a');
  if (lx <= 1 || lx >= 14) return P.labWallD;
  return ly % 4 === 0 ? P.labWallD : C('#a8b2c0');
};

// ---- world map
/** The Sprawl's arterials: patched asphalt, oil stains, hairline cracks, aggregate glints. */
const wRoad: Painter = (_lx, _ly, wx, wy) => {
  const h = hash2(wx, wy, 141);
  if (h < 0.03) return P.wRoadD;
  if (h > 0.988) return lerpC(P.wRoad, [140, 140, 160], 0.35);
  const patch = hash2(Math.floor(wx / 23), Math.floor(wy / 17), 143) < 0.2;
  let base: RGB = patch ? lerpC(P.wRoad, P.wRoadD, 0.6) : P.wRoad;
  const stain = valueNoise(wx / 19, wy / 14, 144);
  if (stain < 0.22) base = lerpC(base, [20, 20, 28], 0.45);
  const n = fbm(wx / 8, wy / 8, 2, 145);
  if (n > 0.66) base = lerpC(base, [96, 96, 116], 0.2);
  else if (n < 0.34) base = lerpC(base, [16, 16, 22], 0.2);
  const crack = valueNoise(wx / 13 + valueNoise(wx / 31, wy / 31, 147) * 2.2, wy / 13, 146);
  if (Math.abs(crack - 0.5) < 0.014) return lerpC(base, [8, 8, 14], 0.7);
  return base;
};

/**
 * Broken ground: cracked earth, weed clumps, rain puddles, brick and glass shards. Detail comes
 * in clusters (rubble drifts, weed clumps) over broad tonal patches, never as per-pixel speckle:
 * at 2x on a busy overworld, independent random pixels read as TV static.
 */
const wBarrens: Painter = (_lx, _ly, wx, wy) => {
  const puddle = valueNoise(wx / 26, wy / 18, 153);
  if (puddle < 0.12) return puddle < 0.06 ? [30, 36, 52] : [44, 50, 66];
  // Rubble drifts: sparse chips only inside a low-frequency mask.
  const drift = valueNoise(wx / 11, wy / 11, 159);
  if (drift > 0.78) {
    const h = hash2(wx, wy, 152);
    if (h < 0.1) return P.rubbleL;
    if (h > 0.97) return [150, 96, 70]; // brick chips
  }
  // Weed clumps: solid, two-toned by a smooth field (light on the clump's upper side).
  const weeds = valueNoise(wx / 7, wy / 7, 154);
  if (weeds > 0.82) return valueNoise(wx / 7, (wy - 2) / 7, 154) > 0.84 ? [96, 108, 60] : [72, 88, 50];
  const crack = valueNoise(wx / 15 + valueNoise(wx / 40, wy / 40, 158) * 2, wy / 15, 157);
  if (Math.abs(crack - 0.5) < 0.012) return lerpC(P.wBarrenD, [0, 0, 0], 0.4);
  const n = fbm(wx / 14, wy / 14, 2, 151);
  if (n < 0.3) return P.wBarrenD;
  if (n > 0.72) return P.wBarrenL;
  return P.wBarren;
};

const wToxic: Painter = (_lx, ly, wx, wy, tx, ty, q) => {
  const above = q.at(tx, ty - 1);
  if (!isWater(above) && above !== 'w_bridge') {
    if (ly === 0) return P.wBarrenL;
    if (ly <= 2) return [10, 24, 12];
  }
  const h = hash2(wx, wy, 161);
  if (h < 0.012) return P.toxicGlow;
  const n = fbm(wx / 7, wy / 7, 2, 162);
  if (n > 0.62) return P.toxicL;
  return P.toxic;
};

const wHighway: Painter = (lx, ly, wx) => {
  if (ly === 0 || ly === 15) return P.hwyD;
  if (ly === 7 && wx % 12 < 6) return P.hwyLine;
  void lx;
  return P.hwy;
};

/**
 * City blocks seen from above: buildings three tiles by two, each a roof with a parapet round its
 * own edge and one feature of its own (HVAC plant, water tank, skylights, a rooftop garden, a
 * helipad, a dish), so the Sprawl reads as a city rather than a grid of identical squares.
 */
const K_GARDEN = C('#2a4432'), K_GARDEN_L = C('#3a5a3e'), K_PAD = C('#2a2a34'), K_PAINT = C('#c8c0a0'), K_TANK = C('#4a4a58'), K_TANK_L = C('#6a6a7a');
const wBlock: Painter = (lx, ly, wx, wy, tx, ty, q) => {
  const bx0 = Math.floor(tx / 3) * 3, by0 = Math.floor(ty / 2) * 2;
  const bx = wx - bx0 * 16, by = wy - by0 * 16;
  const seed = hash2(bx0, by0, 171);
  // Parapet: the building's own edge, or wherever the block meets other ground.
  const edgeL = bx === 0 || (lx === 0 && q.at(tx - 1, ty) !== 'w_block');
  const edgeR = bx === 47 || (lx === 15 && q.at(tx + 1, ty) !== 'w_block');
  const edgeT = by === 0 || (ly === 0 && q.at(tx, ty - 1) !== 'w_block');
  const edgeB = by === 31 || (ly === 15 && q.at(tx, ty + 1) !== 'w_block');
  if (edgeL || edgeT) return P.blockRoofL;
  if (edgeR || edgeB) return P.blockRoofD;
  const kind = Math.floor(seed * 6);
  const cx = 24 + Math.round((hash2(bx0, by0, 173) - 0.5) * 16), cy = 16;
  switch (kind) {
    case 0: // HVAC plant: two units and a duct between
      if ((bx >= cx - 12 && bx <= cx - 5 && by >= 9 && by <= 15) || (bx >= cx + 4 && bx <= cx + 10 && by >= 14 && by <= 21)) return (bx + by) % 3 === 0 ? P.blockRoofD : P.blockRoofL;
      if (by === 12 && bx > cx - 5 && bx < cx + 4) return P.blockRoofD;
      break;
    case 1: { // water tank on legs
      const d = Math.hypot(bx - cx, by - cy);
      if (d < 6) return d > 4.8 ? K_TANK_L : K_TANK;
      if (d < 7.2 && by > cy) return P.blockRoofD;
      break;
    }
    case 2: // skylights: a grid of lit panes
      if (bx >= 8 && bx <= 39 && by >= 8 && by <= 23 && bx % 6 < 4 && by % 5 < 3) return hash2(bx0 + bx, by0 + by, 174) < 0.5 ? P.blockWin : P.blockWinC;
      break;
    case 3: // a rooftop garden
      if (bx >= 6 && bx <= 41 && by >= 6 && by <= 25) return valueNoise(wx / 5, wy / 5, 175) > 0.55 ? K_GARDEN_L : K_GARDEN;
      break;
    case 4: { // helipad: a dark square, a painted ring and an H
      const ax = Math.abs(bx - cx), ay = Math.abs(by - cy);
      if (ax <= 10 && ay <= 10) {
        const r = Math.hypot(bx - cx, by - cy);
        if (r > 8 && r < 9.2) return K_PAINT;
        if ((ax === 3 && ay <= 4) || (ay === 0 && ax <= 3)) return K_PAINT;
        return K_PAD;
      }
      break;
    }
    default: { // a dish and a mast
      const d = Math.hypot(bx - cx, by - cy);
      if (d < 4.5) return d > 3.4 ? P.blockRoofL : P.blockRoofD;
      if (bx === cx + 9 && by >= 6 && by <= 20) return P.blockRoofD;
      if (bx === cx + 9 && by === 5) return P.blockWinP;
    }
  }
  // A few lit windows along the roof edge and the odd vent, otherwise plain roof.
  const wl = hash2(wx, wy, 172);
  if (wl < 0.008) return seed < 0.5 ? P.blockWin : seed < 0.8 ? P.blockWinC : P.blockWinP;
  return (bx + by * 3) % 23 === 0 ? P.blockRoofD : P.blockRoof;
};

export const PAINTERS: Record<TerrainId, Painter> = {
  void: solid(P.void),
  asphalt, roadline, crosswalk, sidewalk, alley, puddle, grate, water, bridge, plaza,
  wall: solid(P.wall),
  dirt, grass, rubble, rail, junk,
  floor_wood: floorWood, floor_tile: floorTile, floor_metal: floorMetal, floor_carpet: floorCarpet, floor_concrete: floorConcrete,
  iwall: wallP('iwall', iwallFace, P.iwallTop, P.iwallEdge),
  d_floor: dfloor,
  d_wall: wallP('d_wall', dwallFace, P.dwallTop, P.dwallEdge),
  d_water: underCatwalk(dwater), d_shallow: underCatwalk(shallow), d_catwalk: catwalk, d_wall_crack: dWallCrack, junk_loose: junkLoose,
  d_track: rail,
  lab_floor: labFloor, lab_floor_steel: labFloorSteel, lab_floor_frost: labFloorFrost, lab_floor_contain: labFloorContain, lab_floor_plate: labFloorPlate,
  lab_wall: wallP('lab_wall', labWallFace, P.labTop, P.labEdge),
  lab_door: labDoor,
  lab_laser: labLaser,
  lab_laser_off: labLaserOff,
  w_ruins: wRuins, w_road: wRoad, w_barrens: wBarrens, w_toxic: wToxic, w_park: grass, w_highway: wHighway,
  w_bridge: bridge, w_block: wBlock,
};

/** Terrain that blocks movement. */
export const SOLID_TERRAIN = new Set<TerrainId>([
  'void', 'water', 'wall', 'junk', 'lab_door', 'lab_laser', 'lab_laser_off', 'iwall', 'd_wall', 'd_water', 'lab_wall', 'w_toxic', 'w_highway', 'w_block',
]);

/** Terrain with a 3/4 wall face (for lighting / occlusion decisions). */
export const WALL_TERRAIN = new Set<TerrainId>(['iwall', 'd_wall', 'lab_wall']);

/**
 * Natural ground types blend into their neighbours: a higher-priority terrain bleeds into a
 * lower one over BLEND_BAND pixels with a noisy, ordered-dither falloff, so grass eats into
 * dirt and dirt into road instead of meeting on a ruler-straight tile seam. Built surfaces
 * (asphalt, walls, water, blocks) keep crisp edges.
 */
const BLEND: Partial<Record<TerrainId, number>> = {
  grass: 5, w_park: 5, dirt: 4, w_barrens: 4, rubble: 3, w_ruins: 3, w_road: 2, d_shallow: 2, d_floor: 1,
};
const BLEND_BAND = 6;
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

interface Bleed {
  dx: number;
  dy: number;
  id: TerrainId;
  p: number;
}

function bleeders(q: TerrainQuery, tx: number, ty: number, own: number): Bleed[] {
  const out: Bleed[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = tx + dx, ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= q.w || ny >= q.h) continue;
      const id = q.at(nx, ny);
      const p = BLEND[id];
      if (p !== undefined && p > own) out.push({ dx, dy, id, p });
    }
  return out;
}

export function paintTerrain(buf: PixelBuf, q: TerrainQuery): void {
  const { data, w } = buf;
  for (let ty = 0; ty < q.h; ty++) {
    for (let tx = 0; tx < q.w; tx++) {
      const id = q.at(tx, ty);
      const painter = PAINTERS[id] ?? PAINTERS.void;
      const own = BLEND[id];
      const nbs = own === undefined ? [] : bleeders(q, tx, ty, own);
      for (let ly = 0; ly < TS; ly++) {
        const wy = ty * TS + ly;
        for (let lx = 0; lx < TS; lx++) {
          const wx = tx * TS + lx;
          let c: RGB | null = null;
          if (nbs.length) {
            let best: Bleed | null = null;
            const dither = BAYER4[(wy & 3) * 4 + (wx & 3)]! / 16;
            const wobble = (valueNoise(wx / 5, wy / 5, 7) - 0.5) * 0.8;
            for (const nb of nbs) {
              const ddx = nb.dx < 0 ? lx : nb.dx > 0 ? TS - 1 - lx : Infinity;
              const ddy = nb.dy < 0 ? ly : nb.dy > 0 ? TS - 1 - ly : Infinity;
              const d = nb.dx && nb.dy ? Math.max(ddx, ddy) : Math.min(ddx, ddy);
              if (d >= BLEND_BAND) continue;
              const t = 1 - (d + 0.5) / BLEND_BAND + wobble;
              if (t > dither && (!best || nb.p > best.p)) best = nb;
            }
            if (best) c = (PAINTERS[best.id] ?? painter)(lx, ly, wx, wy, tx + best.dx, ty + best.dy, q);
          }
          c ??= painter(lx, ly, wx, wy, tx, ty, q);
          const i = (wy * w + wx) * 4;
          data[i] = c[0];
          data[i + 1] = c[1];
          data[i + 2] = c[2];
          data[i + 3] = 255;
        }
      }
    }
  }
}
