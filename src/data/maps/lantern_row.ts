/** Lantern Row — the hub district. Night, rain, neon. */
import type { MapDef } from '../../field/types';
import { Grid } from './grid';

const W = 56, H = 40;

const g = new Grid(W, H, '#')
  .rect(0, 7, W, 2, ',')
  .rect(0, 9, W, 5, '=')
  .rect(0, 11, W, 1, '-')
  .rect(26, 9, 3, 5, ':')
  .rect(0, 14, W, 2, ',')
  .rect(13, 16, 2, 9, ';')
  .rect(41, 16, 2, 9, ';')
  .rect(0, 23, W, 2, ';')
  .rect(15, 16, 26, 16, 'p')
  .rect(0, 32, W, 2, ',')
  .rect(0, 34, W, 4, '~')
  .rect(0, 38, W, 2, '#')
  .dots([[6, 10], [7, 10], [39, 12], [40, 12], [17, 13], [48, 9], [2, 23], [45, 24], [30, 33], [8, 12]], 'o')
  .dots([[21, 12], [44, 10]], '+');

export const lanternRow: MapDef = {
  id: 'lantern_row',
  name: 'Lantern Row',
  banner: 'LANTERN ROW',
  bannerSub: 'Saltreach Lower Wards',
  kind: 'town',
  town: true,
  terrain: g.rows(),
  legend: {},
  ambient: '#3c4072',
  weather: 'rain',
  music: 'town',
  structures: [
    // North side
    { kind: 'building', x: 0, y: 0, w: 9, h: 7, style: 'tile', doors: [4], shopfront: true, sign: { text: '+ DOC YUN', color: '#62e06a' } },
    { kind: 'building', x: 9, y: 0, w: 8, h: 7, style: 'brick', doors: [12], shopfront: true, awning: '#8c2f39', sign: { text: 'IRON SAINT', color: '#ff6a3a' } },
    {
      kind: 'building', x: 17, y: 0, w: 12, h: 7, facade: 3, style: 'concrete', doors: [22],
      sign: { text: 'THE DROWNED SAINT', color: '#ff4fb0' },
      signs: [{ text: 'BAR', color: '#3fe0f0', vertical: true, x: 11, flicker: true }],
      roof: 'billboard', billboard: { text: 'KESSLER-MORI  //  TOMORROW, TODAY', color: '#3f8af0' },
    },
    {
      kind: 'building', x: 29, y: 0, w: 8, h: 7, style: 'tile', doors: [32],
      sign: { text: 'SLEEPTUBE 24H', color: '#3fe0f0' },
      signs: [{ text: 'HOTEL', color: '#b07cff', vertical: true, x: 0 }],
    },
    { kind: 'building', x: 37, y: 0, w: 8, h: 7, style: 'metal', doors: [40], shopfront: true, awning: '#1d5c6a', sign: { text: 'KOWLOON THREADS', color: '#b07cff' } },
    {
      kind: 'building', x: 45, y: 0, w: 11, h: 7, style: 'glass', shutters: [48, 49, 51, 52], roof: 'garden',
      sign: { text: 'PACHI-PALACE', color: '#ffcc3d', flicker: true },
    },
    // Middle block (faces the back alley)
    { kind: 'building', x: 0, y: 16, w: 13, h: 7, style: 'concrete', doors: [6], shopfront: true, awning: '#2f6a5a', sign: { text: 'KWIK-MART 24/7', color: '#62e0c0' } },
    { kind: 'building', x: 43, y: 16, w: 13, h: 7, style: 'metal', shutters: [45, 46, 52], doors: [49], sign: { text: 'NIX AUTO', color: '#ffa24a' } },
    // Rear block (faces the canal)
    { kind: 'building', x: 0, y: 25, w: 9, h: 7, style: 'brick', doors: [4], signs: [{ text: 'APTS', color: '#ffcc3d', vertical: true, x: 8 }] },
    { kind: 'building', x: 9, y: 25, w: 6, h: 7, style: 'shanty', doors: [11], sign: { text: 'CHROME+CIRCUIT', color: '#3fe0f0', flicker: true } },
    { kind: 'building', x: 41, y: 25, w: 8, h: 7, style: 'tile', doors: [44], shopfront: true, awning: '#d8452e', sign: { text: 'MAMA ONO', color: '#ff8a4a' } },
    { kind: 'building', x: 49, y: 25, w: 7, h: 7, style: 'metal', shutters: [51, 53], roof: 'garden' },
    // Far bank (roofs only)
    { kind: 'building', x: 0, y: 38, w: 14, h: 2, facade: 0, style: 'concrete' },
    { kind: 'building', x: 14, y: 38, w: 16, h: 2, facade: 0, style: 'brick' },
    { kind: 'building', x: 30, y: 38, w: 12, h: 2, facade: 0, style: 'metal' },
    { kind: 'building', x: 42, y: 38, w: 14, h: 2, facade: 0, style: 'tile' },
  ],
  props: [
    // Street lamps
    { kind: 'lamp', x: 3, y: 7, dir: 'right' },
    { kind: 'lamp', x: 15, y: 7, dir: 'right' },
    { kind: 'lamp', x: 37, y: 7, dir: 'left' },
    { kind: 'lamp', x: 50, y: 7, dir: 'left' },
    { kind: 'lamp', x: 9, y: 15, dir: 'right', color: '#a8e0ff' },
    { kind: 'lamp', x: 31, y: 15, dir: 'left', color: '#9ad8ff' },
    { kind: 'lamp', x: 46, y: 15, dir: 'right', color: '#9ad8ff' },
    { kind: 'lamp', x: 8, y: 32, dir: 'right' },
    { kind: 'lamp', x: 24, y: 32, dir: 'right' },
    { kind: 'lamp', x: 36, y: 32, dir: 'left' },
    { kind: 'lamp', x: 52, y: 32, dir: 'left' },
    // Road life
    { kind: 'car', x: 5, y: 13, w: 2, color: '#8c2f39' },
    { kind: 'car', x: 33, y: 9, w: 2, color: '#b8b0a0' },
    { kind: 'car', x: 43, y: 13, w: 2, color: '#1d5c6a' },
    { kind: 'vending', x: 16, y: 7, color: '#ff4fb0' },
    { kind: 'vending', x: 28, y: 7, color: '#3fe0f0' },
    { kind: 'hydrant', x: 44, y: 7 },
    { kind: 'trash', x: 8, y: 8 },
    { kind: 'trash', x: 53, y: 8 },
    { kind: 'dumpster', x: 1, y: 7, w: 2, color: '#2f5a4a' },
    { kind: 'bollard', x: 24, y: 14 },
    { kind: 'bollard', x: 30, y: 14 },
    { kind: 'steam', x: 21, y: 12 },
    { kind: 'steam', x: 44, y: 10 },
    // West barricade (chapter lock)
    { kind: 'barrier', x: 0, y: 9, w: 2 },
    { kind: 'barrier', x: 0, y: 11, w: 2 },
    { kind: 'barrier', x: 0, y: 13, w: 2 },
    { kind: 'cone', x: 2, y: 10 },
    { kind: 'cone', x: 2, y: 12 },
    // Plaza — the Lantern Market
    { kind: 'stall', x: 18, y: 18, w: 3, color: '#d8452e' },
    { kind: 'stall', x: 31, y: 18, w: 3, color: '#2f6a5a' },
    { kind: 'stall', x: 34, y: 26, w: 3, color: '#6a3fa0' },
    { kind: 'holo', x: 27, y: 23, color: '#ff4fb0', text: 'LANTERN' },
    { kind: 'tree', x: 16, y: 17, color: '#62e06a' },
    { kind: 'tree', x: 39, y: 17, color: '#3fe0f0' },
    { kind: 'tree', x: 16, y: 30, color: '#b07cff' },
    { kind: 'tree', x: 39, y: 30, color: '#62e06a' },
    { kind: 'bench', x: 21, y: 26, w: 2 },
    { kind: 'bench', x: 24, y: 29, w: 2 },
    { kind: 'planter', x: 25, y: 21 },
    { kind: 'planter', x: 30, y: 21 },
    { kind: 'vending', x: 40, y: 22, color: '#62e06a' },
    { kind: 'terminal', x: 15, y: 22, color: '#3fe0f0' },
    { kind: 'firebarrel', x: 13, y: 24 },
    { kind: 'crates', x: 42, y: 23 },
    { kind: 'trash', x: 14, y: 17 },
    { kind: 'dumpster', x: 53, y: 23, w: 2 },
    { kind: 'crates', x: 0, y: 24 },
    // Promenade
    { kind: 'bench', x: 18, y: 32, w: 2 },
    { kind: 'bench', x: 45, y: 32, w: 2 },
    { kind: 'fence', x: 0, y: 33, w: 3, pass: false },
  ],
  strings: [
    { a: [15, 16], b: [40, 16], sag: 14, lanterns: ['#ff5a3a', '#ffcc3d', '#ff4fb0'] },
    { a: [15, 20], b: [40, 20], sag: 12, lanterns: ['#ffcc3d', '#ff5a3a'] },
    { a: [15, 25], b: [40, 25], sag: 14, lanterns: ['#ff4fb0', '#ffcc3d', '#3fe0f0'] },
    { a: [4, 7], b: [22, 14], sag: 18 },
    { a: [34, 7], b: [52, 14], sag: 18 },
  ],
  lights: [
    { x: 21, y: 22, r: 70, color: '#ff9a5a', i: 0.55 },
    { x: 34, y: 22, r: 70, color: '#ff6fc8', i: 0.45 },
    { x: 27, y: 28, r: 80, color: '#ffb46a', i: 0.45 },
    { x: 20, y: 17, r: 60, color: '#ffcc3d', i: 0.35 },
    { x: 36, y: 17, r: 60, color: '#ff8a4a', i: 0.35 },
  ],
  warps: [
    { x: 55, y: 9, h: 5, to: 'world', tx: 12, ty: 14, dir: 'right', door: false },
  ],
};
