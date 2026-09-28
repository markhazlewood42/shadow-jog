/** The Sprawl — world map linking Lantern Row, the Rustyard and the Sinkline station. */
import type { MapDef } from '../../field/types';
import { sinklineGate } from '../../story/chapter1';
import { Grid } from './grid';

const W = 60, H = 42;

// B city blocks · R road · . barrens · r ruins · ~ toxic canal · = bridge · f awakened park · H highway
const g = new Grid(W, H, 'B')
  // Elevated highway sealing off the north (future chapters).
  .rect(0, 6, W, 2, 'H')
  // The Barrens: the east half, broken ground and ruins.
  .rect(28, 9, 32, 20, '.')
  .rect(34, 12, 6, 4, 'r')
  .rect(44, 18, 7, 5, 'r')
  .rect(30, 24, 5, 3, 'r')
  .rect(52, 22, 6, 5, 'r')
  // Hollowmere Park (awakened forest).
  .rect(20, 10, 10, 8, 'f')
  .rect(22, 9, 6, 1, 'f')
  // Main street east out of Lantern Row, then the old highway spur into the Barrens.
  .rect(12, 21, 28, 3, 'R')
  .rect(38, 12, 3, 12, 'R')
  .rect(38, 11, 14, 2, 'R')
  .rect(50, 9, 3, 4, 'R')
  // Side streets in the west blocks
  .rect(16, 12, 2, 9, 'R')
  .rect(16, 12, 5, 2, 'R')
  .rect(6, 24, 2, 8, 'R')
  // South: road to the canal bridge and the Sinkline station.
  .rect(18, 24, 3, 7, 'R')
  .rect(0, 31, W, 3, '~')
  .rect(18, 31, 3, 3, '=')
  .rect(18, 34, 3, 6, 'R')
  .rect(18, 38, 14, 2, 'R')
  .rect(32, 34, 14, 6, '.')
  .rect(36, 35, 4, 3, 'r')
  // Checkpoint road north to the arcology (blocked).
  .rect(28, 8, 3, 1, 'R')
  .rect(28, 6, 3, 2, 'R');

export const world: MapDef = {
  id: 'world',
  name: 'The Sprawl',
  banner: 'THE SPRAWL',
  bannerSub: 'Saltreach · Lower Wards',
  kind: 'world',
  terrain: g.rows(),
  legend: {
    B: 'w_block', R: 'w_road', '.': 'w_barrens', r: 'w_ruins', '~': 'w_toxic', '=': 'w_bridge', f: 'w_park', H: 'w_highway',
  },
  ambient: '#6a6aa8',
  weather: 'rain',
  music: 'world',
  battleBg: 'street',
  encounters: [
    { table: 'park', rate: 18, terrain: ['w_park'], bg: 'park' },
    { table: 'barrens', rate: 20, terrain: ['w_barrens', 'w_ruins'], bg: 'barrens' },
    { table: 'street', rate: 28, terrain: ['w_road', 'w_bridge'], bg: 'street' },
  ],
  structures: [
    // Lantern Row (west) — the way home.
    { kind: 'building', x: 5, y: 17, w: 7, h: 5, style: 'brick', doors: [], sign: { text: 'LANTERN ROW', color: '#ff4fb0' } },
    { kind: 'building', x: 5, y: 22, w: 7, h: 2, facade: 0, style: 'tile' },
    // Rustyard (north-east)
    { kind: 'building', x: 48, y: 3, w: 8, h: 6, style: 'shanty', sign: { text: 'RUSTYARD', color: '#86f08c' } },
    // Sinkline station (south, over the canal)
    { kind: 'building', x: 22, y: 34, w: 9, h: 4, style: 'concrete', doors: [26], sign: { text: 'SINKLINE', color: '#3fe0f0' } },
    // Kessler-Mori arcology beyond the highway.
    { kind: 'building', x: 24, y: 0, w: 12, h: 6, style: 'corp', roof: 'billboard', billboard: { text: 'KESSLER-MORI', color: '#3f8af0' } },
  ],
  props: [
    { kind: 'barrier', x: 28, y: 8, w: 3 },
    { kind: 'lamp', x: 14, y: 20, dir: 'right' },
    { kind: 'lamp', x: 24, y: 20, dir: 'right' },
    { kind: 'lamp', x: 34, y: 20, dir: 'left' },
    { kind: 'lamp', x: 17, y: 30, dir: 'right' },
    { kind: 'lamp', x: 21, y: 30, dir: 'left' },
    { kind: 'car', x: 44, y: 14, w: 2, color: '#3a3030' },
    { kind: 'firebarrel', x: 33, y: 22 },
    { kind: 'firebarrel', x: 49, y: 13 },
    { kind: 'tree', x: 21, y: 11, color: '#3fe0f0' },
    { kind: 'tree', x: 26, y: 15, color: '#b07cff' },
    { kind: 'tree', x: 28, y: 11, color: '#62e06a' },
    { kind: 'sign_post', x: 36, y: 20, text: 'RUSTYARD →' },
    { kind: 'sign_post', x: 21, y: 25, text: 'SINKLINE ↓' },
    { kind: 'lamp', x: 21, y: 37, dir: 'right' },
    { kind: 'car', x: 29, y: 21, w: 2, color: '#5a5f7a' },
  ],
  chests: [
    { id: 'park_cache', x: 23, y: 16, item: 'spirit_fetish', kind: 'case' },
    { id: 'barrens_cache', x: 57, y: 27, cred: 180, kind: 'crate' },
    { id: 'ruin_cache', x: 45, y: 19, item: 'neurotab', qty: 2, kind: 'crate' },
  ],
  npcs: [
    {
      id: 'km_gate', x: 29, y: 9, dir: 'down', name: 'K-M Checkpoint',
      look: { skin: '#d8b090', hair: '#20202a', hairStyle: 'cap', hat: '#1f2a44', top: '#2c3b5e', inner: '#2c3b5e', accent: '#9aa3b8', pants: '#1f2a44', boots: '#101018', accessories: ['visor'], visor: '#3fe0f0' },
      talk: ['Arcology access is restricted to Kessler-Mori personnel and registered guests.', 'You are neither. Please step back from the checkpoint.'],
    },
    {
      id: 'wanderer', x: 45, y: 25, dir: 'left', name: 'Scav', move: 'wander', radius: 3,
      look: { skin: '#a5673f', hair: '#4a2e22', hairStyle: 'hood', top: '#6a5040', inner: '#3a2a24', accent: '#ffa24a', pants: '#3d3a30', boots: '#2a2420', accessories: ['mask'], goggles: '#2a2420' },
      talk: ['The Barrens used to be a neighborhood. Then the tide came up, and the corps decided it wasn’t worth saving.', 'The Rustyard’s north-east. Follow the old highway spur.'],
    },
  ],
  warps: [
    { x: 12, y: 21, h: 3, to: 'lantern_row', tx: 54, ty: 11, dir: 'left', door: false },
    {
      x: 50, y: 9, w: 3, to: 'rustyard', tx: 15, ty: 22, dir: 'up', door: false,
      when: (f) => !!f.met_hex,
      blocked: async (s) => {
        await s.say('rook', s.flag('met_dutch') ? 'Rustyard. Nothing for us there until we know what Hex needs.' : 'The Rustyard. Scavs and scrap. We’ve got a meeting at the Drowned Saint first.');
      },
    },
    {
      x: 26, y: 37, to: 'sinkline_1', tx: 6, ty: 5, dir: 'down',
      when: (f) => !!f.sinkline_gate,
      blocked: sinklineGate,
    },
  ],
  lights: [
    { x: 26, y: 38, r: 50, color: '#3fe0f0', i: 0.6 },
    { x: 8, y: 21, r: 60, color: '#ff4fb0', i: 0.5 },
    { x: 52, y: 8, r: 50, color: '#86f08c', i: 0.5 },
  ],
};
