/**
 * FROZEN COPY of `src/data/maps/world.ts` as it was before the M5 map-data move (task 4, 2026-10-10). Do not edit it, and do not "tidy" it:
 * `tests/mapdata.test.ts` joins each map's JSON with its behavior module and requires the result to equal the object THIS file builds.
 * Only the import paths changed (this file lives two folders deeper). When a map changes on purpose, change the data file, then update this
 * copy in the same commit and say so in the commit message.
 */
/** The Sprawl — world map linking Lantern Row, the Rustyard and the Sinkline station. */
import type { MapDef } from '../../../src/field/types';
import { sinklineGate } from '../../../src/story/chapter1';
import { Grid } from '../../../src/data/maps/grid';

const W = 60, H = 42;

// B city blocks · R road · . barrens · r ruins · ~ toxic canal · = bridge · f woken park · H highway
const g = new Grid(W, H, 'B')
  // Elevated highway sealing off the north (future chapters).
  .rect(0, 6, W, 2, 'H')
  // The Barrens: the east half, broken ground and ruins.
  .rect(28, 9, 32, 20, '.')
  .rect(34, 12, 6, 4, 'r')
  .rect(44, 18, 7, 5, 'r')
  .rect(30, 24, 5, 3, 'r')
  .rect(52, 22, 6, 5, 'r')
  // Hollowmere Park (a Woken forest).
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
  // ...joined to the main street below Lantern Row's wall.
  .rect(8, 24, 5, 1, 'R')
  // An empty lot off the west side street, where Static Mary broadcasts from.
  .rect(2, 27, 4, 4, '.')
  // South: road to the canal bridge and the Sinkline station.
  .rect(18, 24, 3, 7, 'R')
  .rect(0, 31, W, 3, '~')
  .rect(18, 31, 3, 3, '=')
  .rect(18, 34, 3, 6, 'R')
  .rect(18, 38, 14, 2, 'R')
  .rect(32, 34, 14, 6, '.')
  .rect(36, 35, 4, 3, 'r')
  // An old outflow pipe across the canal from the east Barrens: the scavs' short way down to the
  // station, if you know to look past the ruins.
  .rect(45, 29, 1, 2, '.')
  .rect(45, 31, 1, 3, '=')
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
  // Lifted (was #6a6aa8) with the streets, curbs and block facades (2026-09-29): the Sprawl's
  // walkable streets and its rooftops had merged into one dark mass.
  ambient: '#8080b4',
  weather: 'rain',
  music: 'world',
  battleBg: 'street',
  events: [
    {
      id: 'av_wreck', x: 41, y: 35, w: 2, on: 'action',
      run: async (s) => {
        await s.narrate('A Kessler-Mori courier AV, nose-down in the mud. Two weeks down, by the rust. The flight recorder has been pried out, neatly.');
        if (s.inParty('hex')) await s.say('hex', 'Somebody came back for the black box and left the pilot. That’s a very K-M set of priorities.', { face: 'sad' });
        else await s.say('rook', 'They came back for the black box. Not the pilot.');
      },
    },
  ],
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
    // Landmarks you can steer by: the fallen dome in the west blocks, Static Mary's mast over her
    // lot, water towers on the roofs, and a wreck pile where the spur meets the Barrens.
    { kind: 'dome', x: 1, y: 9, w: 7 },
    { kind: 'mast', x: 1, y: 25 },
    { kind: 'watertower', x: 10, y: 2 },
    { kind: 'watertower', x: 56, y: 29 },
    { kind: 'watertower', x: 9, y: 35 },
    { kind: 'wreck', x: 41, y: 25, w: 2 },
    { kind: 'car', x: 43, y: 26, w: 2, color: '#4a3a30' },
    { kind: 'tires', x: 40, y: 27 },
    // The pipe crossing's tell: a scav's fire at the north end, a rag tied to the rail.
    { kind: 'firebarrel', x: 46, y: 28 },
    { kind: 'lamp', x: 14, y: 20, dir: 'right' },
    { kind: 'lamp', x: 24, y: 20, dir: 'right' },
    { kind: 'lamp', x: 34, y: 20, dir: 'left' },
    { kind: 'lamp', x: 17, y: 30, dir: 'right' },
    { kind: 'lamp', x: 21, y: 30, dir: 'left' },
    { kind: 'car', x: 44, y: 14, w: 2, color: '#3a3030' },
    { kind: 'firebarrel', x: 33, y: 22 },
    { kind: 'firebarrel', x: 49, y: 13 },
    { kind: 'wildtree', x: 21, y: 11, color: '#3fe0f0' },
    { kind: 'wildtree', x: 26, y: 15, color: '#b07cff' },
    { kind: 'wildtree', x: 28, y: 11, color: '#62e06a' },
    { kind: 'wildtree', x: 24, y: 12, color: '#62e06a' },
    { kind: 'wildtree', x: 20, y: 16, color: '#3fe0f0' },
    { kind: 'wildtree', x: 29, y: 16, color: '#62e06a' },
    { kind: 'wildtree', x: 25, y: 9, color: '#b07cff' },
    { kind: 'sign_post', x: 36, y: 20, text: 'RUSTYARD →' },
    { kind: 'sign_post', x: 21, y: 25, text: 'SINKLINE ↓' },
    { kind: 'lamp', x: 21, y: 37, dir: 'right' },
    { kind: 'car', x: 29, y: 21, w: 2, color: '#5a5f7a' },
    // Barrens landmarks: a scav camp, dead cars, the road north to the arcology.
    { kind: 'sign_post', x: 31, y: 10, text: 'ARCOLOGY ↑' },
    { kind: 'wreck', x: 33, y: 14, w: 2 },
    { kind: 'wreck', x: 42, y: 26, w: 2 },
    { kind: 'tent', x: 54, y: 16, w: 2, color: '#5a4a3a' },
    { kind: 'firebarrel', x: 56, y: 18 },
    { kind: 'crates', x: 57, y: 16 },
    { kind: 'tires', x: 47, y: 25 },
    { kind: 'tires', x: 48, y: 25 },
    { kind: 'barrier', x: 29, y: 15, w: 2 },
    // POI: the wayside shrine deep in Hollowmere Park.
    { kind: 'shrine', x: 22, y: 13, w: 2 },
    // POI: a K-M courier AV that came down in the south barrens.
    { kind: 'wreck', x: 41, y: 35, w: 2 },
    { kind: 'body', x: 43, y: 36, color: '#2c3b5e' },
    { kind: 'firebarrel', x: 39, y: 38 },
    { kind: 'crates', x: 44, y: 38 },
    // POI: pirate radio in the empty lot.
    { kind: 'tent', x: 2, y: 27, w: 2, color: '#4a3a5a' },
    { kind: 'pole', x: 5, y: 27 },
    { kind: 'firebarrel', x: 5, y: 30 },
  ],
  chests: [
    { id: 'park_cache', x: 23, y: 16, item: 'ghost_lens', kind: 'case' },
    { id: 'barrens_cache', x: 57, y: 27, cred: 180, kind: 'crate' },
    { id: 'ruin_cache', x: 45, y: 19, item: 'neurotab', qty: 2, kind: 'crate' },
    { id: 'shrine_offering', x: 21, y: 13, item: 'omni_patch', qty: 2, kind: 'crate' },
    { id: 'av_locker', x: 44, y: 37, item: 'trauma_patch', qty: 2, kind: 'locker' },
    { id: 'radio_stash', x: 2, y: 30, item: 'adrenal_stim', qty: 2, kind: 'crate' },
  ],
  npcs: [
    {
      id: 'km_gate', x: 29, y: 9, dir: 'down', name: 'K-M Checkpoint',
      look: { skin: '#d8b090', hair: '#20202a', hairStyle: 'cap', hat: '#1f2a44', top: '#2c3b5e', inner: '#2c3b5e', accent: '#9aa3b8', pants: '#1f2a44', boots: '#101018', accessories: ['visor'], visor: '#3fe0f0' },
      // The checkpoint notices what the crew has been up to.
      talk: async (s) => {
        if (s.flag('warden')) await s.say('K-M Checkpoint', 'All units, Annex 7 is dark. Repeat, Annex 7 is— …Step back, citizen. Please. Today of all days.');
        else if (s.flag('lurker')) await s.say('K-M Checkpoint', 'Something tripped every sensor in the Sinkline an hour ago. Probably rats. Very large rats. …Why am I telling you this? Step back.');
        else if (s.flag('annex_key')) await s.say('K-M Checkpoint', 'Tonight’s registration drive is running late in the Lower Wards. If a van stops for you, get in. It is easier for everyone if you get in.');
        else if (s.flag('hex_joined')) await s.say('K-M Checkpoint', 'Registered guests only. Your jockey friend is not a registered guest. We have their face on file. We have several of their faces on file.');
        else {
          await s.say('K-M Checkpoint', 'Arcology access is restricted to Kessler-Mori personnel and registered guests.');
          await s.say('K-M Checkpoint', 'You are neither. Please step back from the checkpoint.');
        }
      },
    },
    {
      id: 'hermit', x: 24, y: 14, dir: 'left', name: 'Old Marrow', move: 'static',
      look: { skin: '#9a8a6a', hair: '#e8e4da', hairStyle: 'long', top: '#3a4a3a', coat: '#3a4a3a', inner: '#2a2a24', accent: '#62e06a', pants: '#2a2a24', boots: '#1a1a14', accessories: ['beard'] },
      talk: async (s) => {
        await s.say('Old Marrow', 'The trees woke up before the people did. This shrine was here before both.');
        await s.say('Old Marrow', 'Spirits don’t mind blades. They mind will. Hit them with what you believe, not what you’re holding.');
        if (s.inParty('sable')) await s.say('sable', 'The crow knows this place. It says the old man is right, and also that he talks too much.');
      },
    },
    {
      id: 'fisher', x: 20, y: 32, dir: 'right', name: 'Canal Fisher', move: 'static',
      look: { skin: '#c28a64', hair: '#3a3a36', hairStyle: 'cap', hat: '#5a4a2a', top: '#4a5a6a', inner: '#2a2a30', accent: '#ffcc3d', pants: '#2a2a33', boots: '#1a1418' },
      talk: async (s) => {
        await s.say('Canal Fisher', 'Nothing bites in the canal. Not since ’61. Whatever lives down the Sinkline outflow ate everything with fins.');
        await s.say('Canal Fisher', 'Saw it once, from the bridge. Big as a train car. Hates light. Hates heat worse. And my old taser gave it a real bad day.');
      },
    },
    {
      id: 'dj', x: 3, y: 29, dir: 'right', name: 'Static Mary', move: 'static',
      look: { skin: '#8a5a3a', hair: '#ff4fb0', hairStyle: 'bob', top: '#2a2438', coat: '#2a2438', inner: '#ff4fb0', accent: '#3fe0f0', pants: '#1e1c26', boots: '#1a1418', accessories: ['shades'] },
      // Pirate radio: she has already heard about whatever the crew just did.
      talk: async (s) => {
        if (s.flag('lurker')) await s.say('Static Mary', 'Breaking news on Radio Static: something the size of a train died under Junction 4. The rats are throwing a parade. Was that you? That was you.');
        else if (s.flag('hex_joined')) await s.say('Static Mary', 'Hex! You tell Hex they still owe me a jingle. Thirty seconds. Something catchy about not paying people.');
        else if (s.flag('met_dutch')) await s.say('Static Mary', 'K-M trucks have been going down the Sinkline at night. No lights, no plates. That’s tonight’s top story, and nobody’s listening.');
        else await s.say('Static Mary', 'You’re listening to Radio Static, the only station in Saltreach nobody paid for. Including me.');
        if (!s.flag('met_mary')) {
          s.set('met_mary');
          await s.say('Static Mary', 'Stash behind the tent’s for runners. Take what you need. Tell people where you heard it.');
        }
      },
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
    { x: 46, y: 28, r: 40, color: '#ff9a4a', i: 0.55, flicker: true },
    { x: 26, y: 38, r: 50, color: '#3fe0f0', i: 0.6 },
    { x: 8, y: 21, r: 60, color: '#ff4fb0', i: 0.5 },
    { x: 52, y: 8, r: 50, color: '#86f08c', i: 0.5 },
    { x: 4, y: 28, r: 40, color: '#ff4fb0', i: 0.5, flicker: true },
  ],
};
