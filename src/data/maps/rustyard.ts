/** The Rustyard — a scavenger camp in the Barrens, under Rustfang pressure. */
import type { MapDef } from '../../field/types';
import { knucklesFight, magsReward, rustyardGate } from '../../story/chapter1';
import { LOOKS, randomLook } from '../looks';
import { Grid } from './grid';

const W = 34, H = 28;

// J junk walls · d dirt · r rubble · K concrete pad
const g = new Grid(W, H, 'J')
  .rect(1, 1, 32, 21, 'd')
  .rect(13, 22, 5, 6, 'd')
  // Camp pad
  .rect(6, 14, 22, 7, 'K')
  // Scrap maze between the camp and Knuckles' yard. Three ways in from the camp: the
  // obvious middle one dead-ends at a scav's stash; west and east both come out north.
  .paste(0, 8, [
    'JJJJdJJJJJJJJJJJJJJJJJJJJJdJJJJJJJ',
    'JJJJdddddJJJJJJddddddddJJJdddddJJJ',
    'JJJJJJJJdJJJJJJdJJJJJJdJJJJJJJdJJJ',
    'JJdddddddddJJJJdJJddddddJJJJJJdJJJ',
    'JJdJJJJJJJdJJJJdJJJJJJJJJJdddddJJJ',
  ])
  // Behind the scav stash's dead end, a crawl-through the camp keeps open: loose scrap east to the
  // far route, with a pocket halfway where the kids hide things.
  .rect(24, 11, 6, 1, 'L')
  .set(26, 10, 'L')
  // North yard texture
  .rect(3, 3, 5, 3, 'r')
  .rect(24, 2, 6, 4, 'r')
  .rect(9, 6, 3, 2, 'J')
  .rect(22, 6, 2, 2, 'J')
  // Camp corners (the west one hides the Rustfangs' tribute stash; see patches)
  .rect(1, 12, 3, 3, 'J')
  .rect(30, 12, 3, 4, 'J');

export const rustyard: MapDef = {
  id: 'rustyard',
  name: 'The Rustyard',
  banner: 'THE RUSTYARD',
  bannerSub: 'Scavenger camp · the Barrens',
  kind: 'town',
  town: true,
  terrain: g.rows(),
  legend: { J: 'junk', d: 'dirt', r: 'rubble', K: 'floor_concrete', L: 'junk_loose' },
  ambient: '#605a86',
  weather: 'rain',
  music: 'rustyard',
  battleBg: 'rustyard',
  encounters: [{ table: 'barrens', rate: 16, rect: [1, 1, 32, 8], bg: 'rustyard' }],
  structures: [
    { kind: 'building', x: 11, y: 0, w: 12, h: 5, style: 'shanty', shutters: [14, 15, 19], sign: { text: 'TIRE DEPOT', color: '#ff6a3a', flicker: true } },
    { kind: 'building', x: 18, y: 12, w: 8, h: 3, style: 'shanty', sign: { text: 'MAGS SALVAGE', color: '#86f08c' } },
  ],
  props: [
    { kind: 'stall', x: 20, y: 16, w: 3, color: '#2f6a44' },
    { kind: 'tent', x: 7, y: 14, w: 2, color: '#6a5a3a' },
    { kind: 'tent', x: 11, y: 14, w: 2, color: '#4a5a6a' },
    { kind: 'tent', x: 7, y: 18, w: 2, color: '#6a3a3a' },
    { kind: 'firebarrel', x: 14, y: 17 },
    { kind: 'firebarrel', x: 26, y: 19 },
    { kind: 'firebarrel', x: 25, y: 8 },
    { kind: 'crates', x: 25, y: 15 },
    { kind: 'crates', x: 2, y: 20 },
    { kind: 'barrel', x: 3, y: 20, color: '#5a3a2a' },
    { kind: 'barrel', x: 28, y: 17, color: '#3a5a6a' },
    { kind: 'tires', x: 4, y: 2 },
    { kind: 'tires', x: 5, y: 2 },
    { kind: 'tires', x: 27, y: 6 },
    { kind: 'tires', x: 9, y: 4 },
    { kind: 'tires', x: 29, y: 2 },
    { kind: 'car', x: 2, y: 6, w: 2, color: '#4a3030' },
    { kind: 'car', x: 26, y: 3, w: 2, color: '#2a3a4a' },
    { kind: 'lamp', x: 12, y: 21, dir: 'right' },
    { kind: 'lamp', x: 18, y: 21, dir: 'left' },
    { kind: 'dumpster', x: 23, y: 20, w: 2, color: '#5a3a2a' },
    // Rustfang territory: tags on the scrap walls facing the camp, banners staking the north yard.
    // The scavs' own wayfinding through the maze, repainted whenever the heaps shift; the middle
    // way's sign is a warning that marks somebody's stash.
    { kind: 'sign_post', x: 11, y: 13, text: 'DEPOT ↑' },
    { kind: 'sign_post', x: 16, y: 13, text: 'KEEP OUT' },
    { kind: 'sign_post', x: 25, y: 13, text: 'DEPOT ↑' },
    // A painted arrow at the stash's dead end, pointing into the heap (the camp's own mark).
    { kind: 'sign_post', x: 23, y: 12, text: '→' },
    { kind: 'tag', x: 5, y: 12 },
    // Their mark on the loose scrap in the camp's west corner: where they stash the tribute.
    { kind: 'tag', x: 2, y: 14, color: '#ffb02e' },
    { kind: 'tag', x: 21, y: 12 },
    { kind: 'tag', x: 12, y: 24 },
    { kind: 'tag', x: 18, y: 25, color: '#ffb02e' },
    { kind: 'tag', x: 10, y: 7 },
    { kind: 'tag', x: 22, y: 7, color: '#ffb02e' },
    { kind: 'banner', x: 3, y: 7 },
    { kind: 'banner', x: 27, y: 7 },
    { kind: 'banner', x: 15, y: 3 },
    { kind: 'banner', x: 19, y: 3 },
  ],
  patches: [
    { when: (f) => !!f.tribute_stash, rects: [[1, 12, 3, 2, 'd'], [2, 14, 1, 1, 'd']] },
  ],
  chests: [
    { id: 'tribute', x: 1, y: 12, cred: 320, kind: 'crate', when: (f) => !!f.tribute_stash },
    { id: 'depot_case', x: 21, y: 6, item: 'med_case', kind: 'case' },
    { id: 'yard_cache', x: 2, y: 3, cred: 120, kind: 'crate' },
    { id: 'maze_cache', x: 31, y: 7, item: 'trauma_patch', qty: 2, kind: 'crate' },
    { id: 'maze_stash', x: 18, y: 11, item: 'flashbang', qty: 2, kind: 'crate' },
    // In the crawl-through's pocket: the kids' hoard.
    { id: 'heap_pocket', x: 26, y: 10, cred: 140, kind: 'crate' },
  ],
  npcs: [
    {
      id: 'mags', x: 23, y: 16, dir: 'down', look: LOOKS.mags, name: 'Old Mags', fixedDir: true, talk: magsReward,
    },
    {
      id: 'gate_punk', x: 21, y: 18, dir: 'up', look: LOOKS.ganger, name: 'Rustfang Punk', when: (f) => !f.rustyard_gate,
      talk: ['Get lost. Tribute collection in progress.'],
    },
    {
      id: 'knuckles', x: 16, y: 6, dir: 'down', name: '“Knuckles” Tran', when: (f) => !f.knuckles,
      look: { body: 'big', skin: '#b87a52', hair: '#e8452e', hairStyle: 'mohawk', top: '#4a2a2a', sleeves: '#b87a52', inner: '#2a2a30', accent: '#ffcc3d', pants: '#2a2a33', boots: '#1a1418', cyberArm: 'right', accessories: ['visor'], visor: '#ff3a3a' },
      talk: knucklesFight,
    },
    { id: 'guard_a', x: 14, y: 7, dir: 'down', look: LOOKS.ganger, name: 'Rustfang', when: (f) => !f.knuckles, talk: ['Boss is busy. Busy hitting you, soon.'] },
    { id: 'guard_b', x: 18, y: 7, dir: 'down', look: randomLook(99), name: 'Rustfang', when: (f) => !f.knuckles, talk: ['Heh. Heh heh.'] },
    {
      id: 'nephew', x: 17, y: 20, dir: 'down', name: 'Tobin', look: randomLook(310), move: 'static',
      talk: async (s) => {
        if (!s.flag('rustyard_gate')) await s.say('Tobin', 'Auntie Mags says don’t fight the Rustfangs. They broke Pell’s hands last week for coming up short on tribute.');
        else if (!s.flag('knuckles')) await s.say('Tobin', 'Knuckles lives up at the tire depot, past the scrap maze. The heaps shift every time it rains; follow the painted arrows, we move them when the heaps move. Mind the hounds.');
        else await s.say('Tobin', 'You beat KNUCKLES? Can I have your autograph? Can I have your jacket?');
      },
    },
    {
      id: 'scav_cook', x: 13, y: 18, dir: 'right', name: 'Scav', look: randomLook(311), fixedDir: true,
      talk: ['Stew’s on. It isn’t good. It’s hot. Some weeks that has to be enough.'],
    },
    {
      id: 'scav_old', x: 9, y: 17, dir: 'down', name: 'Old Scav', look: randomLook(312), move: 'wander', radius: 2,
      talk: [
        'Before the flood, this was a tire factory. Before that, a swamp. Before that, the sea. Water always comes back for what’s hers.',
        'The Sinkline? Took a whole train in ’61. Some nights the lights still come on down there.',
      ],
    },
    {
      id: 'scav_kid', x: 24, y: 17, dir: 'left', name: 'Scav Kid', look: randomLook(313), move: 'wander', radius: 2,
      // The clue to the tribute stash: where the camp leaves what the Rustfangs take.
      talk: async (s) => {
        if (s.flag('coprocessor_given')) {
          await s.say('Scav Kid', 'You got our filter back! The water tastes like water again. Mostly.');
          return;
        }
        await s.say('Scav Kid', 'The Rustfangs took our water filter. Auntie Mags says we’ll get it back. She doesn’t look like she believes it.');
        if (s.flag('tribute_stash')) return;
        await s.say('Scav Kid', 'Every week we leave the tribute at the west heap. The one with their tag on it. They come for it at night, and they never take it far.');
        s.set('tribute_hint');
      },
    },
  ],
  events: [
    {
      id: 'loose_scrap', x: 2, y: 14, on: 'action', when: (f) => !f.tribute_stash,
      run: async (s) => {
        if (!s.flag('tribute_hint')) {
          await s.narrate('Scrap, stacked loose, a Rustfang tag sprayed across it. Their mark is on half the camp.');
          return;
        }
        await s.narrate('The heap with the tag on it, where the camp leaves its tribute. The scrap is stacked loose. Someone moves it often.');
        const pick = await s.ask(null, 'Pull it aside?', ['Pull it aside', 'Leave it'], { cancel: 1 });
        if (pick !== 0) return;
        s.sfx('bump');
        s.set('tribute_stash');
        s.refreshMap();
        await s.narrate('Behind it, a hollow in the heap: a crate of cred, the Rustfangs’ tribute from the whole camp.');
        await s.say('rook', 'Mags’ people paid that. We’ll see it gets back where it belongs.');
      },
    },
    { id: 'gate', x: 13, y: 20, w: 5, h: 1, on: 'touch', once: true, when: (f) => !f.rustyard_gate, run: rustyardGate },
    { id: 'depot', x: 12, y: 5, w: 10, h: 4, on: 'touch', when: (f) => !!f.rustyard_gate && !f.knuckles, run: knucklesFight },
    {
      id: 'depot_lock', x: 12, y: 5, w: 10, h: 4, on: 'touch', when: (f) => !f.rustyard_gate,
      run: async (s) => {
        await s.say('rook', 'Talk to the locals first. We’re not here to pick fights for free.');
        await s.move('player', 'd');
      },
    },
  ],
  warps: [{ x: 13, y: 27, w: 5, to: 'world', tx: 51, ty: 13, dir: 'down', door: false }],
  lights: [
    { x: 21, y: 16, r: 60, color: '#86f08c', i: 0.5 },
    { x: 16, y: 3, r: 70, color: '#ff6a3a', i: 0.5, flicker: true },
  ],
};
