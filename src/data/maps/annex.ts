/** K-M Annex 7 (B2) and the loading dock where the job goes wrong. */
import type { MapDef } from '../../field/types';
import { annexDoor, annexGuards, annexLog, betrayal, cryopod, lattice, latticeEmitters, relay, wardenFight } from '../../story/chapter1';
import { LOOKS } from '../looks';
import { Grid } from './grid';

const W = 44, H = 34;

// L lab wall · _ lab floor (halls) · c service concrete · a armory steel · f cryo frost ·
// r containment grating · D sealed door · Z laser lattice · + floor grate
const g = new Grid(W, H, 'L')
  // Service room (ladder down from the Sinkline)
  .rect(2, 2, 9, 6, 'c')
  // Corridor east to the security checkpoint
  .rect(6, 8, 3, 3, 'c')
  .rect(6, 10, 8, 2, 'c')
  .rect(14, 10, 1, 2, 'D')
  // Central lab hall
  .rect(15, 3, 15, 16, '_')
  // Side armory (west of the hall)
  .rect(15, 20, 6, 4, 'a')
  .rect(17, 19, 2, 1, 'a')
  // Cryo lab (north-east)
  .rect(31, 3, 11, 9, 'f')
  .rect(30, 6, 1, 3, '_')
  // Passage south to the Warden chamber
  .rect(26, 19, 3, 3, 'r')
  .rect(26, 22, 3, 1, 'D')
  // Warden chamber
  .rect(18, 23, 22, 9, 'r')
  // (The crawlspace behind the armory's loose panel is carved in by a patch.)
  .rect(37, 32, 3, 1, 'r');

export const annex: MapDef = {
  id: 'annex',
  name: 'K-M Annex 7',
  banner: 'ANNEX 7',
  bannerSub: 'Kessler-Mori · Decommissioned',
  kind: 'dungeon',
  terrain: g.rows(),
  legend: {
    L: 'lab_wall', _: 'lab_floor', c: 'floor_concrete', a: 'lab_floor_steel', f: 'lab_floor_frost', r: 'lab_floor_contain',
    D: 'lab_door', Z: 'lab_laser', z: 'lab_laser_off', '+': 'grate',
  },
  ambient: '#6a7aa0',
  weather: 'none',
  music: 'lab',
  battleBg: 'lab',
  entrance: { map: 'world', x: 26, y: 38 },
  encounters: [{ table: 'annex', rate: 22, bg: 'lab', rect: [15, 3, 27, 29] }],
  patches: [
    { when: (f) => !!f.annex_key, rects: [[14, 10, 1, 2, 'c']] },
    // The laser lattice across the cryo-wing passage: one beam row per emitter, live or dark,
    // sealed until all three are dark.
    ...[0, 1, 2].flatMap((i) => [
      { when: (f: Record<string, unknown>) => !f.lattice_off && !!latticeEmitters(f)[i], rects: [[30, 6 + i, 1, 1, 'Z']] as [number, number, number, number, string][] },
      { when: (f: Record<string, unknown>) => !f.lattice_off && !latticeEmitters(f)[i], rects: [[30, 6 + i, 1, 1, 'z']] as [number, number, number, number, string][] },
    ]),
    // A loose panel in the armory's west wall hides a crawlspace.
    { when: (f) => !!f.annex_panel, rects: [[11, 21, 3, 2, 'c'], [14, 22, 1, 1, 'c']] },
    { when: (f) => !!f.sable_joined, rects: [[26, 22, 3, 1, 'r']] },
  ],
  props: [
    { kind: 'ladder', x: 3, y: 2 },
    { kind: 'crates', x: 9, y: 3 },
    { kind: 'crates', x: 2, y: 6 },
    // Service bay: the building's plumbing, out in the open.
    { kind: 'pipe_v', x: 5, y: 2 },
    { kind: 'pipe_v', x: 8, y: 2 },
    { kind: 'barrel', x: 10, y: 6, color: '#8a6a2a' },
    { kind: 'desk', x: 17, y: 4, w: 2 },
    // The company crest over the central hall: the one thing in here meant to impress.
    { kind: 'crest', x: 21, y: 2, w: 3 },
    // Requisition terminal on the hall's south wall, by the Warden passage.
    { kind: 'vending', x: 23, y: 19, color: '#ff6a5a' },
    { kind: 'desk', x: 22, y: 4, w: 2 },
    { kind: 'terminal', x: 27, y: 3, color: '#3fe0f0' },
    { kind: 'terminal', x: 16, y: 12, color: '#3fe0f0' },
    { kind: 'terminal', x: 6, y: 2, color: '#3fe0f0' },
    { kind: 'tank', x: 18, y: 8 },
    { kind: 'tank', x: 20, y: 8 },
    { kind: 'tank', x: 24, y: 8, color: '#b07cff' },
    { kind: 'tank', x: 26, y: 8 },
    { kind: 'tank', x: 18, y: 15, color: '#ff6a5a' },
    { kind: 'tank', x: 22, y: 15 },
    { kind: 'screen', x: 20, y: 2, w: 3, color: '#3fe0f0' },
    { kind: 'screen', x: 33, y: 2, w: 3, color: '#9ad8ff' },
    { kind: 'cryopod', x: 36, y: 4, w: 2, when: (f) => !f.sable_joined },
    // After the rescue: the same pod, shattered and empty.
    { kind: 'cryopod', x: 36, y: 4, w: 2, color: 'empty', when: (f) => !!f.sable_joined },
    // The other subjects' pods: drained, dark, their labels still on.
    { kind: 'cryopod', x: 32, y: 4, w: 2, color: 'drained' },
    { kind: 'cryopod', x: 39, y: 4, w: 2, color: 'drained' },
    { kind: 'steam', x: 41, y: 8, color: '#dff6ff' },
    { kind: 'desk', x: 33, y: 9, w: 2 },
    { kind: 'rack', x: 16, y: 20, w: 2 },
    { kind: 'rack', x: 19, y: 20, w: 2 },
    { kind: 'crates', x: 15, y: 23 },
    { kind: 'tank', x: 21, y: 25, color: '#ff3a4a' },
    { kind: 'tank', x: 36, y: 25, color: '#ff3a4a' },
    // Containment: field pylons round the arena, coolant venting from the floor.
    { kind: 'pylon', x: 19, y: 24, color: '#ff3a4a' },
    { kind: 'pylon', x: 38, y: 24, color: '#ff3a4a' },
    { kind: 'pylon', x: 19, y: 30, color: '#ff3a4a' },
    { kind: 'pylon', x: 38, y: 30, color: '#ff3a4a' },
    { kind: 'steam', x: 24, y: 31, color: '#ff9aa8' },
    { kind: 'steam', x: 33, y: 31, color: '#ff9aa8' },
    { kind: 'barrier', x: 37, y: 31, w: 3, pass: true },
    // Wayfinding: the lab's own wall signs.
    { kind: 'sign_post', x: 9, y: 7, text: 'LABS ↓' },
    { kind: 'sign_post', x: 16, y: 18, text: 'ARMORY ↓' },
    { kind: 'sign_post', x: 27, y: 10, text: 'CRYO WING →' },
    { kind: 'sign_post', x: 25, y: 18, text: 'CONTAINMENT ↓' },
    // Lattice relays (red, unlike the cyan lore terminals): service room, hall, armory.
    { kind: 'terminal', x: 10, y: 4, color: '#ff6a5a' },
    { kind: 'terminal', x: 15, y: 8, color: '#ff6a5a' },
    { kind: 'terminal', x: 15, y: 21, color: '#ff6a5a' },
  ],
  chests: [
    { id: 'petrov', x: 11, y: 21, item: 'proto_chip', kind: 'case', when: (f) => !!f.annex_panel },
    { id: 'a1', x: 9, y: 6, item: 'trauma_patch', qty: 2, kind: 'locker' },
    { id: 'a2', x: 16, y: 22, item: 'mono_katana', kind: 'case' },
    { id: 'a3', x: 20, y: 22, item: 'smartpistol', kind: 'case' },
    { id: 'a4', x: 28, y: 17, item: 'dragon_fang', kind: 'case' },
    { id: 'a5', x: 41, y: 10, item: 'neurotab', qty: 3, kind: 'locker' },
    { id: 'a6', x: 15, y: 17, item: 'km_badge', qty: 2, kind: 'crate' },
    { id: 'a7', x: 39, y: 10, item: 'focus_rod', kind: 'case' },
  ],
  npcs: [
    { id: 'sentinel_a', x: 11, y: 10, dir: 'left', look: LOOKS.corpsec, name: 'K-M Sentinel', when: (f) => !f.annex_key, talk: annexGuards },
    { id: 'sentinel_b', x: 12, y: 11, dir: 'left', look: LOOKS.corpsec, name: 'K-M Sentinel', when: (f) => !f.annex_key, talk: annexGuards },
  ],
  events: [
    { id: 'guards', x: 8, y: 10, w: 2, h: 2, on: 'touch', once: true, when: (f) => !f.annex_key, run: annexGuards },
    { id: 'door', x: 14, y: 10, h: 2, on: 'action', when: (f) => !f.annex_key, run: annexDoor },
    {
      id: 'log1', x: 27, y: 3, on: 'action',
      run: annexLog('PROJECT VESSEL · OVERVIEW', 'Awakened subjects carry measurable essence reserves. Extraction yields a stable, transferable mana substrate. Applications: power, weapons, obedience.'),
    },
    {
      id: 'log2', x: 16, y: 12, on: 'action',
      run: async (s) => {
        await annexLog('SUBJECT LOG · S-3', 'Subject S-3 (human, hermetic) expired during extraction. Residual spirit bound to the WARDEN security core. Recommendation: repurpose all future expirees. Waste nothing.')(s);
        if (!s.flag('rook_log')) {
          s.set('rook_log');
          await s.say('rook', '...');
          await s.say('kit', 'Rook?');
          await s.say('rook', 'Seen a room like this before. Keep moving.');
        }
      },
    },
    {
      id: 'log3', x: 6, y: 2, on: 'action',
      run: async (s) => {
        await annexLog('MAIL · to: J. PALE', 'Your contractors should reach S-7 by the 14th. On recovery, contractor exposure is to be {r}resolved per standard protocol{/}. — Operations')(s);
        if (!s.flag('read_mail')) {
          s.set('read_mail');
          await s.say('kit', '“Resolved.” What does “resolved” mean?', { face: 'angry' });
          await s.say('rook', 'Nothing good.');
          await s.say('hex', 'Standard protocol. Great. Nobody in history has ever been resolved in a nice way, per standard protocol.', { face: 'sad' });
        }
      },
    },
    {
      id: 'log4', x: 33, y: 9, on: 'action',
      run: annexLog('SUBJECT LOG · S-7', 'Subject S-7 (orc, shamanic, "crow" totem). Resistance to sedation: high. Yield: exceptional. On completion, transfer to Arcology Level 90; residue to a WARDEN-class core, as with S-3.'),
    },
    { id: 'pod', x: 36, y: 4, w: 2, on: 'action', run: cryopod },
    { id: 'lattice', x: 30, y: 6, h: 3, on: 'action', when: (f) => !f.lattice_off, run: lattice },
    { id: 'relay_c', x: 10, y: 4, on: 'action', run: relay('c') },
    { id: 'relay_b', x: 15, y: 8, on: 'action', run: relay('b') },
    { id: 'relay_a', x: 15, y: 21, on: 'action', run: relay('a') },
    {
      id: 'memo', x: 17, y: 4, w: 2, on: 'action',
      run: annexLog('MEMO · LATTICE AUDIT', 'Relay A feeds emitters 1 and 2. Cycling a relay flips every emitter it feeds. The refit rewired B and C and nobody updated this memo, so watch the beams when you cycle them. Keep this taped to the desk, Dmitri.'),
    },
    {
      id: 'requisition', x: 23, y: 18, h: 2, on: 'action',
      run: async (s) => {
        if (!s.flag('req_badge')) {
          s.set('req_badge');
          await s.narrate('A badge is still clipped into the reader: {c}D. PETROV, FACILITIES{/}.');
          await s.say('hex', 'Dmitri’s badge is still live. Dmitri, you beautiful, careless man.', { face: 'happy' });
          // The clue to the crawlspace: Dmitri never left.
          await s.narrate('{c}EVAC HEADCOUNT · 41 OF 42.{/} Missing: D. Petrov, Facilities. Last badge-in: west utility corridor, the night of the evacuation.');
          await s.say('rook', 'Stock up. Whatever’s behind that door, it isn’t a vending machine.');
        }
        await s.shop('km_requisition');
      },
    },
    {
      id: 'panel', x: 14, y: 22, on: 'action', when: (f) => !f.annex_panel,
      run: async (s) => {
        if (!s.flag('req_badge')) {
          await s.narrate('A utility corridor wall panel, scuffed like everything down here.');
          return;
        }
        await s.narrate('The west utility corridor, where Dmitri last badged in. One wall panel sits a few millimetres proud of the rest. Scratches round the screws. Cold air on your fingers.');
        const pick = await s.ask(null, 'Pry the panel off?', ['Pry it off', 'Leave it'], { cancel: 1 });
        if (pick !== 0) return;
        s.sfx('door');
        s.set('annex_panel');
        s.refreshMap();
        await s.narrate('The panel comes away. Behind it, a crawlspace someone has been living in: a bedroll, ration wrappers, a K-M badge lanyard. {c}D. PETROV{/}.');
        await s.say('hex', 'Dmitri. He didn’t leave with everyone else. He hid.', { face: 'sad' });
      },
    },
    { id: 'pod_near', x: 35, y: 6, w: 4, h: 1, on: 'touch', once: true, when: (f) => !f.sable_joined, run: cryopod },
    { id: 'warden', x: 18, y: 24, w: 22, h: 1, on: 'touch', once: true, when: (f) => !!f.sable_joined && !f.warden, run: wardenFight },
    {
      id: 'sealed', x: 26, y: 22, w: 3, on: 'action', when: (f) => !f.sable_joined,
      run: async (s) => s.narrate('A heavy blast door. The panel reads {r}CONTAINMENT · LOCKED{/}.'),
    },
  ],
  warps: [
    { x: 3, y: 1, to: 'sinkline_1', tx: 44, ty: 29, dir: 'up', door: false },
    {
      x: 37, y: 32, w: 3, to: 'dock', tx: 9, ty: 4, dir: 'down',
      when: (f) => !!f.warden,
      confirm: 'The freight lift only goes up. Anything left in the Annex stays here for good. Ride up?',
      blocked: async (s) => s.narrate('The freight lift. The call panel is dead until the facility releases its security lock.'),
    },
  ],
  lights: [
    { x: 6, y: 4, r: 60, color: '#ffd89a', i: 0.5 },
    { x: 22, y: 6, r: 90, color: '#dff6ff', i: 0.55 },
    { x: 22, y: 14, r: 80, color: '#b8e8ff', i: 0.45 },
    { x: 36, y: 7, r: 80, color: '#cdeeff', i: 0.6 },
    { x: 29, y: 27, r: 110, color: '#ff3a4a', i: 0.45, flicker: true },
    { x: 18, y: 21, r: 60, color: '#ffb13d', i: 0.55 },
    { x: 23, y: 18, r: 40, color: '#ff6a5a', i: 0.4 },
    // One red glow per live emitter, so the lattice's state reads from across the hall.
    { x: 30, y: 6, r: 26, color: '#ff3a4a', i: 0.6, flicker: true, when: (f) => !f.lattice_off && !!latticeEmitters(f)[0] },
    { x: 30, y: 7, r: 26, color: '#ff3a4a', i: 0.6, flicker: true, when: (f) => !f.lattice_off && !!latticeEmitters(f)[1] },
    { x: 30, y: 8, r: 26, color: '#ff3a4a', i: 0.6, flicker: true, when: (f) => !f.lattice_off && !!latticeEmitters(f)[2] },
    // Cold light leaking round the loose panel: the only tell.
    { x: 14, y: 22, r: 18, color: '#9ad8ff', i: 0.5, flicker: true, when: (f) => !f.annex_panel },
    { x: 12, y: 21, r: 30, color: '#9ad8ff', i: 0.4, when: (f) => !!f.annex_panel },
  ],
};

const DW = 20, DH = 14;
const dg = new Grid(DW, DH, '#')
  .rect(1, 2, 18, 11, '=')
  .rect(1, 2, 18, 2, ',')
  .rect(8, 1, 3, 1, ',')
  // Loading bay markings, rain puddles and a drain in the asphalt.
  .rect(2, 6, 1, 6, '-')
  .rect(17, 6, 1, 6, '-')
  .dots([[5, 7], [6, 7], [12, 11], [13, 11], [4, 12], [15, 6]], 'o')
  .set(10, 8, '+');

export const dock: MapDef = {
  id: 'dock',
  name: 'Loading Dock 7',
  banner: 'LOADING DOCK 7',
  bannerSub: 'Street level · 03:12',
  kind: 'town',
  terrain: dg.rows(),
  legend: {},
  ambient: '#3a3a6a',
  weather: 'rain',
  music: 'tension',
  space: 'hall', // open air under the cranes, whatever room the cue came from
  battleBg: 'street',
  structures: [
    // The freight lift housing they came up in, and the K-M warehouse wall across the bay.
    { kind: 'building', x: 6, y: 0, w: 8, h: 1, style: 'concrete', doors: [], sign: { text: 'FREIGHT 7', color: '#ffcc3d' } },
  ],
  props: [
    // Pale's ride and the K-M vans boxing the crew in.
    { kind: 'car', x: 8, y: 11, w: 2, color: '#e4e4ea' },
    { kind: 'car', x: 3, y: 10, w: 2, color: '#1f2a44' },
    { kind: 'car', x: 14, y: 10, w: 2, color: '#1f2a44' },
    { kind: 'barrier', x: 1, y: 12, w: 3 },
    { kind: 'barrier', x: 16, y: 12, w: 3 },
    // Freight stacked for pickup that was never coming.
    { kind: 'crates', x: 1, y: 4 },
    { kind: 'crates', x: 1, y: 5 },
    { kind: 'crates', x: 2, y: 4 },
    { kind: 'crates', x: 17, y: 4 },
    { kind: 'crates', x: 17, y: 5 },
    { kind: 'barrel', x: 3, y: 4, color: '#3a5a6a' },
    { kind: 'barrel', x: 16, y: 4, color: '#5a3a2a' },
    { kind: 'barrel', x: 18, y: 7, color: '#3a5a6a' },
    { kind: 'tires', x: 1, y: 8 },
    { kind: 'dumpster', x: 16, y: 8, w: 2, color: '#2c3b5e' },
    { kind: 'hydrant', x: 1, y: 10 },
    // Floodlights on the bay and street lamps beyond.
    { kind: 'lampfloor', x: 4, y: 6, color: '#e8f4ff' },
    { kind: 'lampfloor', x: 15, y: 6, color: '#e8f4ff' },
    { kind: 'lamp', x: 5, y: 3, dir: 'right' },
    { kind: 'lamp', x: 15, y: 3, dir: 'left' },
    { kind: 'sign_post', x: 12, y: 2, text: 'K-M LOGISTICS' },
  ],
  npcs: [
    { id: 'pale', x: 9, y: 9, dir: 'up', look: LOOKS.pale, name: 'Mr. Pale', talk: betrayal },
    { id: 'guard1', x: 7, y: 10, dir: 'up', look: LOOKS.corpsec, name: 'K-M Sentinel', talk: ['Eyes front. Mr. Pale doesn’t like to be kept waiting.'] },
    { id: 'guard2', x: 11, y: 10, dir: 'up', look: LOOKS.corpsec, name: 'K-M Sentinel', talk: ['Nothing personal, runners. You’re a line item.'] },
  ],
  onEnter: async (s) => {
    if (s.flag('chapter_end')) return;
    await s.wait(30);
    await s.move('player', 'dd');
    await betrayal(s);
  },
  lights: [
    { x: 4, y: 11, r: 45, color: '#3f8af0', i: 0.55, flicker: true },
    { x: 15, y: 11, r: 45, color: '#ff3a3a', i: 0.55, flicker: true },
    { x: 9, y: 12, r: 40, color: '#fff0c0', i: 0.45 },
  ],
};
