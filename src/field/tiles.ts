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
  dfloor: C('#353a40'), dfloorD: C('#2d3237'), dfloorAlgae: C('#2c4038'), dfloorL: C('#40464d'),
  dwallFace: C('#454a55'), dwallFaceD: C('#3a3e48'), dwallSeam: C('#2b2e36'), dwallStain: C('#2f3a36'), dwallTop: C('#131417'), dwallEdge: C('#23252b'),
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
  if (h < 0.06) return P.dirtD;
  if (h > 0.95) return P.dirtL;
  return fbm(wx / 8, wy / 8, 2, 62) < 0.4 ? P.dirtD : P.dirt;
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

/** Heaped scrap: solid junk walls (Rustyard). Face shading where open ground is below. */
const JUNK_COLS: RGB[] = [C('#3a3d4a'), C('#4a4e5c'), C('#5a3e30'), C('#6a4a36'), C('#2a2c36'), C('#5a5f70'), C('#7a5a3a')];
const junk: Painter = (lx, ly, wx, wy, tx, ty, q) => {
  const below = q.at(tx, ty + 1);
  const n = valueNoise(wx / 5, wy / 5, 201);
  const h = hash2(Math.floor(wx / 3), Math.floor(wy / 2), 202);
  let c = JUNK_COLS[Math.floor(h * JUNK_COLS.length)]!;
  if (n > 0.66) c = lerpC(c, [255, 255, 255], 0.12);
  if (n < 0.3) c = lerpC(c, [0, 0, 0], 0.35);
  if (hash2(wx, wy, 203) < 0.02) c = C('#ffcc3d');
  if (hash2(wx, wy, 204) < 0.012) c = C('#3fe0f0');
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
  if ((lx + ly) % 8 === 0 && (lx - ly + 16) % 8 === 0) return P.carpetL;
  return hash2(wx, wy, 101) < 0.1 ? P.carpetD : P.carpet;
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

const labWallFace: Painter = (lx, ly) => {
  if (ly === 15) return P.labSeam;
  if (ly === 10 || ly === 11) return P.labStripe;
  if (lx === 0) return P.labSeam;
  if (ly <= 1) return P.labWallD;
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

const dwater = waterP(P.dwater, P.dwaterL, P.dwaterD, P.dfloorL, P.dfloorD, [8, 22, 18], C('#347060'));

const shallow: Painter = (lx, ly, wx, wy, tx, ty, q) => {
  const base = dfloor(lx, ly, wx, wy, tx, ty, q);
  const w = Math.sin(wx * 0.4 + wy * 1.1) > 0.9 ? P.shallowL : P.shallow;
  return lerpC(base, w, 0.72);
};

const catwalk: Painter = (lx, ly, wx, wy) => {
  if (ly === 0 || ly === 15) return P.catwalkD;
  if ((lx % 4 === 1 || lx % 4 === 2) && (ly % 4 === 1 || ly % 4 === 2)) return P.catwalkHole;
  void wx; void wy;
  return lx % 4 === 0 ? P.catwalkD : P.catwalk;
};

/** Abandoned-lab tiles: dust drifts, boot scuffs, the odd stain. */
const labFloor: Painter = (lx, ly, wx, wy) => {
  if (lx === 0 || ly === 0) return P.labSeam;
  let base = lx === 15 || ly === 15 ? P.labFloorD : P.labFloor;
  const dust = fbm(wx / 20, wy / 20, 3, 361);
  if (dust < 0.4) base = lerpC(base, P.labSeam, (0.4 - dust) * 1.5);
  if (hash2(Math.floor(wx / 6), Math.floor(wy / 3), 362) < 0.06 && (wx + wy * 2) % 7 === 0) return lerpC(base, [40, 44, 56], 0.3);
  if (hash2(wx, wy, 363) < 0.012) return P.labFloorD;
  return base;
};

const labDoor: Painter = (lx, ly) => {
  if (ly <= 1 || ly >= 14) return P.labSeam;
  if (lx === 7 || lx === 8) return C('#1a1e28');
  if (ly === 3 && lx >= 5 && lx <= 10) return C('#ff3a4a');
  if (lx <= 1 || lx >= 14) return P.labWallD;
  return ly % 4 === 0 ? P.labWallD : C('#a8b2c0');
};

// ---- world map
const wRoad: Painter = (lx, ly, wx, wy) => {
  const h = hash2(wx, wy, 141);
  if (h < 0.05) return P.wRoadD;
  void lx; void ly;
  return P.wRoad;
};

const wBarrens: Painter = (_lx, _ly, wx, wy) => {
  const n = fbm(wx / 9, wy / 9, 3, 151);
  const h = hash2(wx, wy, 152);
  if (h < 0.025) return P.rubbleL;
  if (n < 0.36) return P.wBarrenD;
  if (n > 0.66) return P.wBarrenL;
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

const wBlock: Painter = (lx, ly, wx, wy, tx, ty) => {
  // Dense rooftops: each tile is a roof with parapet, a few lit windows and HVAC dots.
  const seed = hash2(tx, ty, 171);
  if (lx === 0 || ly === 0) return P.blockRoofD;
  if (lx === 15 || ly === 15) return P.blockRoofD;
  if (lx === 1 || ly === 1) return P.blockRoofL;
  const hvx = 3 + ((seed * 9) | 0), hvy = 3 + ((seed * 71) % 8 | 0);
  if (lx >= hvx && lx <= hvx + 2 && ly >= hvy && ly <= hvy + 2) return P.blockRoofL;
  const wl = hash2(wx, wy, 172);
  if (wl < 0.012) return seed < 0.5 ? P.blockWin : seed < 0.8 ? P.blockWinC : P.blockWinP;
  return P.blockRoof;
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
  d_water: dwater, d_shallow: shallow, d_catwalk: catwalk,
  d_track: rail,
  lab_floor: labFloor,
  lab_wall: wallP('lab_wall', labWallFace, P.labTop, P.labEdge),
  lab_door: labDoor,
  w_ruins: rubble, w_road: wRoad, w_barrens: wBarrens, w_toxic: wToxic, w_park: grass, w_highway: wHighway,
  w_bridge: bridge, w_block: wBlock,
};

/** Terrain that blocks movement. */
export const SOLID_TERRAIN = new Set<TerrainId>([
  'void', 'water', 'wall', 'junk', 'lab_door', 'iwall', 'd_wall', 'd_water', 'lab_wall', 'w_toxic', 'w_highway', 'w_block',
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
