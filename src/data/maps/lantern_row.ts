/** Lantern Row — the hub district. Night, rain, neon. */
import type { MapDef, NpcDef } from '../../field/types';
import { firstFight } from '../../story/chapter1';
import { LOOKS, randomLook, streetLook } from '../looks';
import { Grid } from './grid';

const ped = (id: string, x: number, y: number, seed: number, lines: string[], move: NpcDef['move'] = 'wander', dir: NpcDef['dir'] = 'down'): NpcDef => ({
  id, x, y, dir, look: streetLook(seed), name: 'Local', move, radius: 3, talk: lines,
});

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
  .dots([[21, 12], [44, 10]], '+')
  // Rain pooling in the plaza's low spots (it was paved over a canal basin; it still remembers).
  .dots([[20, 24], [21, 24], [33, 23], [36, 29], [37, 29], [23, 17]], 'o');

export const lanternRow: MapDef = {
  id: 'lantern_row',
  name: 'Lantern Row',
  banner: 'LANTERN ROW',
  bannerSub: 'Saltreach Lower Wards',
  kind: 'town',
  town: true,
  terrain: g.rows(),
  legend: {},
  ambient: '#4a4e84',
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
    { kind: 'pole', x: 15, y: 16, pass: true },
    { kind: 'pole', x: 40, y: 16, pass: true },
    { kind: 'pole', x: 15, y: 20, pass: true },
    { kind: 'pole', x: 40, y: 20, pass: true },
    { kind: 'pole', x: 15, y: 25, pass: true },
    { kind: 'pole', x: 40, y: 25, pass: true },
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
    { kind: 'holo', x: 27, y: 19, color: '#ff4fb0', text: 'LANTERN' },
    // The plaza's heart: the Drowned Saint, and a lantern for everyone the flood took.
    { kind: 'memorial', x: 27, y: 25, w: 2 },
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
    // The market's clutter, uneven on purpose: a tarp shelter and its crates on the west side, a
    // street shrine and a tea cart on the east, stools and rubbish where people actually stop.
    { kind: 'tent', x: 17, y: 22, color: '#3a5a8a' },
    { kind: 'crates', x: 19, y: 23 },
    { kind: 'stool', x: 19, y: 21 },
    { kind: 'stool', x: 33, y: 21 },
    { kind: 'crates', x: 34, y: 19 },
    { kind: 'shrine', x: 38, y: 24 },
    { kind: 'stall', x: 29, y: 29, w: 2, color: '#c8a040' },
    { kind: 'trash', x: 37, y: 27 },
    { kind: 'trash', x: 22, y: 19 },
    // Promenade
    { kind: 'bench', x: 18, y: 32, w: 2 },
    { kind: 'bench', x: 45, y: 32, w: 2 },
    { kind: 'fence', x: 0, y: 33, w: 3, pass: false },
  ],
  strings: [
    // (Plaza strings are tied off to poles at both ends; see the pole props.)
    { a: [15, 16], b: [40, 16], sag: 14, lanterns: ['#ff5a3a', '#ffcc3d', '#ff4fb0'] },
    { a: [15, 20], b: [40, 20], sag: 12, lanterns: ['#ffcc3d', '#ff5a3a'] },
    { a: [15, 25], b: [40, 25], sag: 14, lanterns: ['#ff4fb0', '#ffcc3d', '#3fe0f0'] },
    { a: [4, 7], b: [22, 14], sag: 18 },
    { a: [34, 7], b: [52, 14], sag: 18 },
  ],
  lights: [
    // Candles at the street shrine, and the tea cart's lamp.
    { x: 38, y: 24, r: 34, color: '#ffc070', i: 0.6, flicker: true },
    { x: 30, y: 29, r: 40, color: '#ffd080', i: 0.5 },
    { x: 21, y: 22, r: 70, color: '#ff9a5a', i: 0.55 },
    { x: 34, y: 22, r: 70, color: '#ff6fc8', i: 0.45 },
    { x: 27, y: 28, r: 80, color: '#ffb46a', i: 0.45 },
    { x: 20, y: 17, r: 60, color: '#ffcc3d', i: 0.35 },
    { x: 36, y: 17, r: 60, color: '#ff8a4a', i: 0.35 },
  ],
  warps: [
    { x: 55, y: 9, h: 5, to: 'world', tx: 13, ty: 22, dir: 'right', door: false },
    { x: 4, y: 6, to: 'clinic', tx: 7, ty: 8, dir: 'up' },
    { x: 12, y: 6, to: 'armory', tx: 7, ty: 8, dir: 'up' },
    { x: 22, y: 6, to: 'bar', tx: 11, ty: 12, dir: 'up' },
    { x: 32, y: 6, to: 'hotel', tx: 8, ty: 8, dir: 'up' },
    { x: 40, y: 6, to: 'threads', tx: 7, ty: 8, dir: 'up' },
    { x: 6, y: 22, to: 'kwikmart', tx: 7, ty: 8, dir: 'up' },
    { x: 4, y: 31, to: 'rook_flat', tx: 6, ty: 8, dir: 'up' },
    { x: 11, y: 31, to: 'hex_den', tx: 7, ty: 9, dir: 'up' },
    { x: 44, y: 31, to: 'noodles', tx: 7, ty: 8, dir: 'up' },
    {
      x: 49, y: 22, to: 'lantern_row', tx: 49, ty: 23, when: () => false,
      blocked: async (s) => s.narrate('A note on the shutter: {c}"NIX AUTO — CLOSED. GONE FISHING. DON’T STEAL ANYTHING."{/}'),
    },
  ],
  npcs: [
    {
      id: 'km_cop', x: 3, y: 11, dir: 'right', look: LOOKS.corpsec, name: 'K-M Civic Security', fixedDir: false,
      talk: [
        'Lower Wards Access Point Seven is closed by order of Kessler-Mori Civic Security.',
        'Registered residents may apply for a transit waiver. Processing time: six to eighteen months. Move along.',
      ],
    },
    ped('p1', 20, 23, 11, ['The lanterns are for the Drowned Festival. Every year we light one for everyone the flood took. Lot of lanterns.']),
    ped('p2', 33, 24, 12, ['My cousin went in for a K-M “aptitude screening” last spring. They said he tested gifted. We haven’t heard from him since.']),
    ped('p3', 24, 28, 13, ['Heading to the Rustyard? Go east out of the Row, follow the old highway, then cut across the Barrens. Watch for scrap hounds.']),
    ped('p4', 38, 29, 14, ['Eight hours on the pumps, two in the noodle queue. Whatever you’re selling, I’m not buying.']),
    ped('p5', 10, 8, 15, ['The Sinkline station’s south of here, across the canal. Folks say the water down there moves by itself.'], 'wander'),
    ped('p6', 45, 14, 16, ['Watch yourself east of here. Rustfangs have been collecting "tolls" on anyone walking alone.'], 'wander'),
    ped('p7', 30, 8, 17, ['If you’ve got a shaman friend and a decker friend, have ’em try working together. Spirits love a power surge. Or so I hear.'], 'wander'),
    ped('p8', 16, 33, 18, ['Autocabs will take you back to town from anywhere on the street. Cab Vouchers at the Kwik-Mart. Worth every cred.'], 'static', 'down'),
    {
      id: 'skewer', x: 19, y: 17, dir: 'down', look: randomLook(40), name: 'Skewer Vendor', fixedDir: true,
      talk: ['Rat-on-a-stick! Not glowrat, no no. Regular rat. Organic! Very fresh!'],
    },
    {
      id: 'junk', x: 32, y: 17, dir: 'down', look: LOOKS.mags, name: 'Junk Dealer', fixedDir: true,
      talk: ['Decks, chips, parts! You want a coprocessor? Ha! For those, try Old Mags out in the Rustyard. She gets the good salvage.'],
    },
    {
      id: 'fetish', x: 35, y: 25, dir: 'down', name: 'Charm Seller', fixedDir: true,
      look: { skin: '#8a9a6a', hair: '#e8e4da', hairStyle: 'long', top: '#6a3fa0', inner: '#3a2a24', accent: '#d9b36c', pants: '#4a3a30', boots: '#2a2020', accessories: ['tusks'] },
      talk: [
        'Charms against spirits, charms against corps. The corp ones don’t work, but they make people feel better.',
        'You smell of something waking, girl. Careful. Kessler-Mori pays well for people who smell like that.',
      ],
    },
    // The plaza in knots, not a grid: a queue at each stall, a mourner at the memorial, two
    // regulars trading the same rumor they trade every night.
    ped('q_skewer', 19, 19, 21, ['Two sticks. No, the organic ones. ...What do you mean they’re all organic?'], 'static', 'up'),
    ped('q_junk', 32, 19, 22, ['I’m just looking. I’ve been just looking for three hours.'], 'static', 'up'),
    ped('q_charm', 35, 27, 23, ['One for my sister. She’s got a K-M aptitude screening Tuesday.'], 'static', 'up'),
    ped('mourner', 28, 27, 24, ['There’s a lantern here for every name. My mother counted them every year. Now I do.'], 'static', 'up'),
    ped('gossip_a', 20, 28, 25, ['They say the Rustfangs got a new boss. Big guy. Calls himself Knuckles.'], 'static', 'right'),
    ped('gossip_b', 21, 28, 26, ['They always say that. It’s always a big guy.'], 'static', 'left'),
    { id: 'kids', x: 26, y: 26, dir: 'up', look: randomLook(55), name: 'Kid', move: 'wander', radius: 2, talk: ['Mom says don’t talk to runners. ...Are you runners? Mom says runners disappear.'] },
  ],
  events: [
    {
      id: 'memorial', x: 27, y: 24, w: 2, h: 2, on: 'action',
      run: async (s) => {
        await s.narrate('THE DROWNED SAINT · IN MEMORY OF THE LOWER WARDS, ’61. Somebody has hung a lantern for every name. There is room for more.');
        if (s.inParty('rook') && !s.flag('memorial_rook')) {
          s.set('memorial_rook');
          await s.say('rook', 'I hang one every year. Don’t ask me who for.');
        }
      },
    },
    { id: 'first_fight', x: 15, y: 16, w: 26, h: 1, on: 'touch', once: true, when: (f) => !!f.intro && !f.first_fight, run: firstFight },
    {
      id: 'barricade', x: 2, y: 9, h: 5, on: 'touch', run: async (s) => {
        await s.say('K-M Civic Security', 'Halt. Access Point Seven is closed. Turn around, citizen.');
        await s.move('player', 'r');
      },
    },
    {
      id: 'terminal', x: 15, y: 22, on: 'action', run: async (s) => {
        await s.narrate('{c}PUBLIC TERMINAL{/} · "Lantern Row. Saltreach Lower Wards. Population: unknown. Flood level: manageable. Have a K-M day."');
      },
    },
    {
      id: 'canal', x: 0, y: 33, w: 56, on: 'action', run: async (s) => {
        await s.narrate('The canal is black and slow. Lantern light floats on it like spilled paint.');
      },
    },
  ],
};
