/** The Sinkline, level B1 — a flooded metro station. The junction drains when the pumps run. */
import type { MapDef } from '../../field/types';
import { deadCrew, floodgate, lurkerFight, pumpValve } from '../../story/chapter1';
import { Grid } from './grid';

const W = 48, H = 38;

// X wall · . floor · t track · w shallow water · ~ deep water · = catwalk · + grate
const g = new Grid(W, H, 'X')
  // Concourse
  .rect(2, 2, 17, 6, '.')
  // Long platform
  .rect(2, 8, 28, 2, '.')
  // Track bed with standing water
  .rect(2, 10, 28, 4, 't')
  .rect(4, 12, 3, 2, 'w')
  .rect(20, 11, 4, 3, 'w')
  // Stairs up to the junction catwalk
  .rect(27, 5, 3, 3, '.')
  // The flooded junction chamber with a catwalk along its north wall
  .rect(30, 5, 16, 1, '=')
  .rect(30, 6, 16, 25, '~')
  // The chamber's own shape: a landing under the stairs, a broken service ledge on the east wall.
  .rect(30, 6, 2, 4, '.')
  .rect(44, 16, 2, 5, '.')
  // Signal Island 4: a catwalk ring around a sump, the Lurker's lair. Cut off until the drain.
  .rect(33, 12, 9, 9, '=')
  .rect(35, 14, 5, 5, '~')
  // Maintenance corridor south to the pump room
  .rect(8, 14, 3, 12, '.')
  .rect(11, 17, 4, 3, '.')
  .rect(11, 21, 7, 1, '.')
  .rect(17, 19, 6, 5, '.')
  // The flooded west service tunnel: a second way from the track bed down to the pump room (and
  // the short way from Intake 1 to Intake 3), with a niche halfway where someone kept supplies.
  .rect(2, 14, 2, 12, 'w')
  .rect(4, 19, 2, 2, '.')
  // A maintenance closet sealed off in '61; the wall between it and the pump room has cracked.
  .rect(12, 23, 3, 2, '.')
  .set(13, 25, '%')
  // Pump room
  .rect(3, 26, 14, 7, '.')
  .rect(6, 28, 2, 2, 'w');

export const sinkline1: MapDef = {
  id: 'sinkline_1',
  name: 'The Sinkline · B1',
  banner: 'THE SINKLINE',
  bannerSub: 'Flooded since ’61',
  kind: 'dungeon',
  terrain: g.rows(),
  legend: { X: 'd_wall', '.': 'd_floor', t: 'd_track', w: 'd_shallow', '~': 'd_water', '=': 'd_catwalk', '+': 'grate', '%': 'd_wall_crack' },
  ambient: '#56628e',
  weather: 'drip',
  music: 'dungeon',
  battleBg: 'sewer',
  entrance: { map: 'world', x: 26, y: 38 },
  encounters: [{ table: 'sinkline', rate: 24, bg: 'sewer' }],
  patches: [
    {
      when: (f) => !!f.floodgate,
      rects: [
        [30, 6, 16, 25, 'w'],
        [30, 6, 2, 4, '.'],
        [44, 16, 2, 5, '.'],
        [33, 12, 9, 9, '='],
        [35, 14, 5, 5, '~'],
        [31, 24, 3, 3, '~'],
        [42, 9, 3, 3, '~'],
        [30, 10, 1, 4, 't'],
        [44, 30, 1, 1, '+'],
        // Only reachable once the water is gone: the old locker room under the junction.
        [38, 31, 5, 3, '.'],
        [40, 30, 1, 1, '.'],
      ],
    },
  ],
  props: [
    { kind: 'vending', x: 12, y: 2, color: '#3fe0f0' },
    { kind: 'barrier', x: 3, y: 6, w: 3 },
    { kind: 'barrier', x: 9, y: 6, w: 3 },
    { kind: 'sign_post', x: 3, y: 2, text: 'STREET ↑' },
    { kind: 'sign_post', x: 16, y: 7, text: 'PLATFORM 2' },
    { kind: 'train', x: 12, y: 10, w: 7 },
    { kind: 'bench', x: 22, y: 8, w: 2 },
    { kind: 'trash', x: 18, y: 3 },
    { kind: 'crates', x: 2, y: 3 },
    { kind: 'terminal', x: 6, y: 26, color: '#62e06a' },
    // Three intakes in three corners of the level: the order is a route, not a lookup.
    { kind: 'valve', x: 2, y: 10 },
    { kind: 'valve', x: 18, y: 19 },
    { kind: 'valve', x: 13, y: 26 },
    { kind: 'sign_post', x: 3, y: 9, text: 'INTAKE 1' },
    { kind: 'sign_post', x: 19, y: 19, text: 'INTAKE 2' },
    { kind: 'sign_post', x: 14, y: 26, text: 'INTAKE 3' },
    { kind: 'crates', x: 12, y: 31 },
    { kind: 'sign_post', x: 10, y: 14, text: 'PUMPS ↓' },
    { kind: 'sign_post', x: 4, y: 14, text: 'SERVICE ↓' },
    { kind: 'crates', x: 4, y: 20, pass: true },
    { kind: 'sign_post', x: 28, y: 7, text: 'JUNCTION 4 →' },
    { kind: 'sign_post', x: 16, y: 26, text: 'PUMP STATION' },
    // Signal Island 4: floodlamps on the ring, a warning board, the wreck it dragged down.
    { kind: 'lampfloor', x: 33, y: 12 },
    { kind: 'lampfloor', x: 41, y: 12 },
    { kind: 'lampfloor', x: 33, y: 20 },
    { kind: 'lampfloor', x: 41, y: 20, color: '#ff8a6a' },
    { kind: 'sign_post', x: 37, y: 12, text: 'DANGER · SUMP' },
    { kind: 'wreck', x: 43, y: 23, w: 2 },
    // Flood debris: what the water brought down with it in '61.
    // The junction's bones: support columns standing in the flood round Signal Island, and a
    // train car that went into the sump in '61 and never came out.
    { kind: 'pillar', x: 31, y: 11 },
    { kind: 'pillar', x: 43, y: 11 },
    { kind: 'pillar', x: 31, y: 21 },
    { kind: 'pillar', x: 43, y: 21 },
    { kind: 'train', x: 33, y: 27, w: 5 },
    { kind: 'barrel', x: 31, y: 9, color: '#3a5a4a', pass: true },
    { kind: 'barrel', x: 44, y: 14, color: '#5a3a2a', pass: true },
    { kind: 'barrel', x: 36, y: 24, color: '#3a5a4a', pass: true },
    { kind: 'crates', x: 43, y: 9, pass: true },
    { kind: 'crates', x: 32, y: 21, pass: true },
    { kind: 'body', x: 40, y: 21, color: '#3a3848' },
    { kind: 'body', x: 13, y: 18, color: '#2c3b5e' },
    { kind: 'body', x: 12, y: 19, color: '#4a2a2a' },
    { kind: 'body', x: 14, y: 17, color: '#34344a' },
    { kind: 'crates', x: 22, y: 20 },
    // Wire's corner of the concourse: a fire, a bed, the stuff he's salvaged.
    { kind: 'firebarrel', x: 14, y: 5 },
    { kind: 'bedroll', x: 17, y: 6, pass: true },
    { kind: 'crates', x: 13, y: 6 },
    // The platform, where the '61 crowd was waiting: a dropped bag, a fallen timetable, a body
    // nobody came back for, cases bobbing in the track water.
    { kind: 'trash', x: 6, y: 8 },
    { kind: 'body', x: 10, y: 9, color: '#3a3848' },
    { kind: 'sign_board', x: 20, y: 8 },
    { kind: 'barrel', x: 9, y: 12, color: '#3a4a5a', pass: true },
    { kind: 'barrel', x: 25, y: 12, color: '#5a3a2a', pass: true },
    { kind: 'barrel', x: 15, y: 31, color: '#3a5a4a' },
    { kind: 'barrel', x: 3, y: 31, color: '#3a5a4a' },
    { kind: 'ladder', x: 44, y: 30 },
  ],
  chests: [
    { id: 'drowned_locker', x: 41, y: 33, item: 'flood_charm', kind: 'locker', when: (f) => !!f.floodgate },
    { id: 'c1', x: 17, y: 2, item: 'medkit', qty: 2, kind: 'locker' },
    { id: 'c2', x: 27, y: 12, cred: 160, kind: 'crate' },
    { id: 'c3', x: 45, y: 5, item: 'neural_buffer', kind: 'case' },
    { id: 'c4', x: 16, y: 27, item: 'neurotab', qty: 2, kind: 'locker' },
    { id: 'c5', x: 22, y: 19, item: 'grounding_coil', kind: 'case' },
    { id: 'c6', x: 45, y: 20, item: 'adrenal_stim', qty: 1, kind: 'locker' },
    { id: 'c7', x: 3, y: 12, item: 'omni_patch', qty: 1, kind: 'crate' },
    { id: 'c8', x: 22, y: 23, cred: 220, kind: 'locker' },
    { id: 'c9', x: 5, y: 19, item: 'detox', qty: 2, kind: 'locker' },
    // Behind the cracked wall: what the pump crew locked away when the water came.
    { id: 'closet', x: 12, y: 23, item: 'cyber_eye', kind: 'case' },
    { id: 'closet2', x: 14, y: 23, cred: 180, kind: 'locker' },
  ],
  npcs: [
    {
      id: 'wire', x: 16, y: 4, dir: 'down', name: 'Wire', fixedDir: false,
      look: { skin: '#c28a64', hair: '#b07cff', hairStyle: 'spiky', top: '#2a2a36', coat: '#2a2a36', inner: '#ff4fb0', accent: '#ff4fb0', pants: '#1e1c26', boots: '#1a1418', accessories: ['visor'], visor: '#ff4fb0' },
      talk: async (s) => {
        if (!s.flag('met_wire')) {
          s.set('met_wire');
          await s.say('Wire', 'Whoa, whoa. Runners? Down here? …Relax, I’m not K-M. I’m Wire. I live here. Rent’s free if you don’t mind ghosts.');
          await s.say('Wire', 'I fence what the tunnels cough up. You need gear, I got gear. Mags-grade, no backtracking.');
        }
        await s.shop('fence');
      },
    },
    { id: 'noodle', x: 20, y: 22, dir: 'left', look: { skin: '#fff', hair: '#fff', hairStyle: 'bald', top: '#fff', accent: '#fff', pants: '#fff', boots: '#fff' }, critter: 'cat', name: 'Noodle', move: 'wander', radius: 1,
      when: (f) => !f.cat_found,
      talk: async (s) => {
        await s.say('Noodle', 'Mrrrp?');
        await s.say('kit', 'Orange. One ear. You must be Noodle! Mama Ono misses you, you little drain gremlin.', { face: 'happy' });
        s.set('cat_found');
        s.despawn('noodle');
        await s.narrate('Noodle climbs into Kit’s jacket and refuses to leave. {c}Return Noodle to Mama Ono.{/}');
      },
    },
  ],
  events: [
    { id: 'automat', x: 12, y: 2, h: 2, on: 'action', run: async (s) => s.shop('automat') },
    { id: 'crew', x: 12, y: 17, w: 3, h: 3, on: 'touch', once: true, run: deadCrew },
    { id: 'pump', x: 6, y: 26, on: 'action', run: floodgate },
    { id: 'valve1', x: 2, y: 10, h: 2, on: 'action', run: pumpValve('v1') },
    { id: 'valve2', x: 18, y: 19, h: 2, on: 'action', run: pumpValve('v2') },
    { id: 'valve3', x: 13, y: 26, h: 2, on: 'action', run: pumpValve('v3') },
    {
      id: 'flood_hint', x: 29, y: 8, h: 2, on: 'touch', once: true, when: (f) => !f.floodgate,
      run: async (s) => {
        await s.say('hex', 'The tracks run straight into the junction. Which is currently a lake.', { face: 'sad' });
        await s.say('rook', 'There’s a pump room somewhere down the maintenance corridor. Off the platform, south.');
      },
    },
    { id: 'lurker', x: 34, y: 12, w: 7, h: 9, on: 'touch', once: true, when: (f) => !!f.floodgate && !f.lurker, run: lurkerFight },
    {
      id: 'map', x: 8, y: 2, on: 'action', run: async (s) => {
        await s.narrate('A transit map, water-stained. {c}B1 Platforms{/} · {c}Pump Station{/} · {c}Junction 4{/} · {r}K-M Annex (restricted){/}.');
      },
    },
  ],
  warps: [
    { x: 5, y: 1, w: 3, to: 'world', tx: 26, ty: 38, dir: 'down', door: false },
    {
      x: 44, y: 30, to: 'annex', tx: 4, ty: 3, dir: 'down',
      when: (f) => !!f.lurker,
      blocked: async (s) => s.narrate('A maintenance hatch, rusted shut. Something big has been scraping at it from this side.'),
    },
  ],
  lights: [
    // The closet's emergency lamp, still on, leaking through the crack.
    { x: 13, y: 24, r: 22, color: '#6ad8e8', i: 0.45, flicker: true },
    { x: 14, y: 5, r: 50, color: '#ff9a4a', i: 0.6, flicker: true },
    { x: 6, y: 3, r: 60, color: '#b8d8ff', i: 0.5, flicker: true },
    { x: 14, y: 3, r: 50, color: '#3fe0f0', i: 0.5 },
    { x: 8, y: 8, r: 55, color: '#ffd07a', i: 0.55, flicker: true },
    { x: 18, y: 8, r: 55, color: '#ffd07a', i: 0.45 },
    { x: 26, y: 8, r: 55, color: '#ffd07a', i: 0.5, flicker: true },
    { x: 9, y: 20, r: 40, color: '#ff6a5a', i: 0.45, flicker: true },
    { x: 9, y: 29, r: 70, color: '#62e06a', i: 0.55 },
    // A dim work light left on in the drowned locker room since ’61.
    { x: 40, y: 32, r: 36, color: '#ffd07a', i: 0.45, flicker: true, when: (f) => !!f.floodgate },
    // Each intake gets a green work light, so the three read as one system across the map.
    { x: 2, y: 11, r: 34, color: '#62e06a', i: 0.5 },
    { x: 18, y: 20, r: 34, color: '#62e06a', i: 0.5 },
    { x: 13, y: 27, r: 30, color: '#62e06a', i: 0.45 },
    { x: 20, y: 21, r: 40, color: '#ffd07a', i: 0.4 },
    { x: 37, y: 16, r: 70, color: '#4affb0', i: 0.5 },
    { x: 41, y: 20, r: 40, color: '#ff6a5a', i: 0.45, flicker: true },
    { x: 38, y: 5, r: 60, color: '#ffd07a', i: 0.4, flicker: true },
    { x: 44, y: 30, r: 40, color: '#ffcc3d', i: 0.5 },
    // Emergency strip lights along the corridor and catwalk, so the layout reads in the dark.
    { x: 9, y: 16, r: 45, color: '#ffd07a', i: 0.4, flicker: true },
    { x: 9, y: 24, r: 45, color: '#ffd07a', i: 0.4 },
    { x: 14, y: 21, r: 40, color: '#ffd07a', i: 0.35 },
    { x: 34, y: 5, r: 50, color: '#b8d8ff', i: 0.4 },
    { x: 42, y: 5, r: 50, color: '#b8d8ff', i: 0.4, flicker: true },
    { x: 33, y: 27, r: 50, color: '#4affb0', i: 0.3 },
  ],
};
