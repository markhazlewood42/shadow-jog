/** Lantern Row interiors. */
import type { MapDef, NpcDef } from '../../field/types';
import type { ScriptFn } from '../../game/script';
import { introFlat, meetDutch, meetHex } from '../../story/chapter1';
import { LOOKS, randomLook } from '../looks';
import { Grid } from './grid';

/** A room: two wall rows on top (cap + face), side walls, floor, and a door gap at the bottom. */
function room(w: number, h: number, floor: string, doorX: number): string[] {
  const g = new Grid(w, h, 'I');
  g.rect(1, 2, w - 2, h - 3, floor);
  g.set(doorX, h - 1, floor);
  return g.rows();
}

const exit = (_w: number, h: number, doorX: number, tx: number, ty: number) => ({ x: doorX, y: h - 1, to: 'lantern_row', tx, ty, dir: 'down' as const });

const shopTalk = (who: string, shop: string, line?: string): ScriptFn => async (s) => {
  if (line) await s.say(who, line);
  await s.shop(shop);
};

const patron = (id: string, x: number, y: number, seed: number, name: string, lines: string[], dir: NpcDef['dir'] = 'down', move: NpcDef['move'] = 'static'): NpcDef => ({
  id, x, y, dir, look: randomLook(seed), name, move, talk: lines, radius: 2,
});

// ------------------------------------------------------------------ Rook & Kit's flat
export const rookFlat: MapDef = {
  id: 'rook_flat', name: 'Rook’s Flat', kind: 'interior',
  terrain: room(14, 10, 'W', 6), legend: {},
  ambient: '#7a76a8', music: 'town', battleBg: 'street',
  props: [
    { kind: 'bed', x: 1, y: 2, color: '#8c2f39' },
    { kind: 'couch', x: 3, y: 5, w: 3, color: '#4a3a5a' },
    { kind: 'table', x: 4, y: 6, w: 2 },
    { kind: 'window', x: 8, y: 1, w: 3 },
    { kind: 'screen', x: 3, y: 1, w: 2, color: '#62e06a' },
    { kind: 'rack', x: 12, y: 2 },
    { kind: 'counter', x: 9, y: 6, w: 3, color: '#3a3448' },
    { kind: 'plant', x: 1, y: 7 },
    { kind: 'lampfloor', x: 12, y: 7 },
    { kind: 'poster', x: 6, y: 1, color: '#ff4fb0' },
  ],
  lights: [{ x: 6, y: 5, r: 70, color: '#ffcf9a', i: 0.5 }],
  warps: [exit(14, 10, 6, 4, 32)],
  onEnter: async (s) => {
    if (!s.flag('intro')) await introFlat(s);
  },
  events: [
    {
      id: 'fridge', x: 10, y: 5, on: 'action', run: async (s) => {
        if (!s.flag('ate')) {
          s.set('ate');
          await s.narrate('Half a carton of soy-noodles and a suspicious egg. Kit eats the noodles. The egg stays a mystery.');
          await s.give('medkit', 1);
        } else await s.narrate('The suspicious egg regards you. You regard it back.');
      },
    },
    {
      id: 'rent_tin', x: 9, y: 6, w: 3, on: 'action', run: async (s) => {
        if (s.flag('rent_tin')) {
          await s.narrate('The rent tin. Lighter than it should be. Everything is.');
          return;
        }
        s.set('rent_tin');
        await s.narrate('A biscuit tin behind the kettle, RENT scratched in the lid.');
        await s.say('rook', 'Take half. The landlord can wait a week. The Rustfangs won’t.');
        await s.cred(60);
      },
    },
    {
      id: 'rack', x: 12, y: 3, on: 'action', run: async (s) => {
        await s.say('rook', 'Hands off the rack. Every blade there has a story, and every story ends with somebody bleeding.');
      },
    },
    {
      id: 'tv', x: 3, y: 2, w: 2, on: 'action', run: async (s) => {
        await s.narrate('{c}K-M NEWSFEED:{/} "...Kessler-Mori reminds citizens that Awakened individuals must register their abilities. Registration is free, safe, and mandatory..."');
      },
    },
  ],
};

// ------------------------------------------------------------------ The Drowned Saint
const BAR_W = 22, BAR_H = 14;
export const bar: MapDef = {
  id: 'bar', name: 'The Drowned Saint', kind: 'interior',
  terrain: room(BAR_W, BAR_H, 'C', 11), legend: {},
  ambient: '#6a5a9a', music: 'bar', battleBg: 'street',
  props: [
    { kind: 'bar', x: 2, y: 4, w: 9 },
    { kind: 'shelf', x: 2, y: 2, w: 3 },
    { kind: 'shelf', x: 6, y: 2, w: 3 },
    { kind: 'screen', x: 10, y: 1, w: 3, color: '#ff4fb0' },
    { kind: 'screen', x: 16, y: 1, w: 2, color: '#3fe0f0' },
    { kind: 'stool', x: 3, y: 5 },
    { kind: 'stool', x: 5, y: 5 },
    { kind: 'stool', x: 7, y: 5 },
    { kind: 'stool', x: 9, y: 5 },
    { kind: 'couch', x: 15, y: 2, w: 3, color: '#6a2a3a' },
    { kind: 'table', x: 15, y: 4, w: 3 },
    { kind: 'couch', x: 15, y: 7, w: 3, color: '#6a2a3a' },
    { kind: 'table', x: 15, y: 9, w: 3 },
    { kind: 'table', x: 4, y: 9, w: 2 },
    { kind: 'table', x: 8, y: 9, w: 2 },
    { kind: 'jukebox', x: 20, y: 11 },
    { kind: 'arcade', x: 1, y: 11, color: '#3fe0f0' },
    { kind: 'plant', x: 20, y: 2 },
    { kind: 'sign_board', x: 13, y: 1, w: 2 },
    { kind: 'poster', x: 1, y: 1, color: '#ff4fb0' },
    { kind: 'poster', x: 9, y: 1, color: '#ffcc3d' },
    { kind: 'poster', x: 19, y: 1, color: '#3fe0f0' },
    { kind: 'poster', x: 20, y: 1, color: '#b07cff' },
    { kind: 'trash', x: 18, y: 12 },
    { kind: 'crates', x: 11, y: 2 },
    // The floor: a keg at the bar's end, seats at the tables, a lamp by the booths, the house
    // hologram over the dance floor, a plant nobody waters.
    { kind: 'barrel', x: 11, y: 4, color: '#5a3a2a' },
    { kind: 'stool', x: 3, y: 9 },
    { kind: 'stool', x: 10, y: 9 },
    { kind: 'lampfloor', x: 13, y: 5, color: '#ffb46a' },
    { kind: 'holo', x: 14, y: 11, color: '#ff4fb0', text: 'SAINT' },
    { kind: 'plant', x: 1, y: 7 },
  ],
  lights: [
    { x: 6, y: 4, r: 70, color: '#ff6fc8', i: 0.55 },
    { x: 16, y: 5, r: 60, color: '#ffb46a', i: 0.55 },
    { x: 7, y: 10, r: 60, color: '#8a6aff', i: 0.35 },
    { x: 14, y: 10, r: 44, color: '#ff4fb0', i: 0.45 },
  ],
  npcs: [
    { id: 'dutch', x: 16, y: 3, dir: 'down', look: LOOKS.dutch, name: 'Dutch', talk: meetDutch, fixedDir: false },
    { id: 'pale', x: 17, y: 5, dir: 'up', look: LOOKS.pale, name: 'Mr. Pale', when: (f) => !f.met_dutch, talk: meetDutch },
    {
      id: 'barkeep', x: 6, y: 3, dir: 'down', look: randomLook(501), name: 'Saint', fixedDir: true,
      talk: async (s) => {
        const c = await s.ask('Saint', 'What’s your poison? House special’s called the Drowned Saint. It’s mostly drain cleaner.', ['Buy a round (30¢)', 'Rumors', 'Nothing'], { cancel: 2 });
        if (c === 0) {
          if (s.credits() < 30) {
            await s.say('Saint', 'Cred first, friend.');
            return;
          }
          await s.cred(-30, true);
          // A drink sharpens the mind, not the body: TP and skill uses, no healing.
          s.refreshFocus();
          s.sfx('heal');
          await s.say('Saint', 'On the house. Well, on your house. Everyone feels sharper and twenty years dumber. TP’s back; bruises aren’t.');
        } else if (c === 1) {
          const rumors = [
            'Knuckles and the Rustfangs have been leaning on the Rustyard. Old Mags won’t pay. Good for her.',
            'Folk who go down the Sinkline hear commuters. The last train left in ’61.',
            'Kessler-Mori’s buying up every Awakened kid in the Wards. "Scholarships." Right.',
            'A crew called the Glass Wolves drank here last week. Big job, big talk. Haven’t seen ’em since.',
          ];
          await s.say('Saint', rumors[(s.get('rumor') as number | undefined ?? 0) % rumors.length]!);
          s.set('rumor', ((s.get('rumor') as number | undefined) ?? 0) + 1);
        }
      },
    },
    patron('old_runner', 9, 9, 777, 'Old Runner', [
      'Rook? Rook ran with the best crew in the Wards, back before your time, kid.',
      'He and his old partner had a move: she’d {y}blur in fast{/}, he’d {y}follow through with the heaviest cut{/} he had. Same breath. Called it the {c}Thunder Rift{/}.',
      'Pick a quick strike for you and Rook’s big cut in the same round. You’ll see.',
    ], 'up'),
    patron('drinker', 4, 10, 402, 'Patron', ['I’m not drunk. I’m Awakened. The room is spinning magically.'], 'up'),
    patron('dancer', 12, 11, 118, 'Regular', ['The jukebox only plays one song. Nobody knows who put it there. Nobody’s brave enough to unplug it.'], 'left', 'wander'),
  ],
  events: [
    {
      id: 'board', x: 13, y: 2, w: 2, on: 'action', run: async (s) => {
        const jobs = [
          s.flag('job_cat_done') ? '{d}[DONE] Lost cat "Noodle".{/}' : s.flag('cat_found') ? '{g}[FOUND] Return Noodle to Mama Ono.{/}' : '{y}LOST CAT{/}: "Noodle", orange, one ear. Last seen near the Sinkline. Reward from Mama Ono.',
          s.flag('job_case_done') ? '{d}[DONE] Doc Yun’s med-case.{/}' : '{y}STOLEN{/}: Doc Yun’s medical case, taken by Rustfangs. Probably stashed in the Rustyard. Reward.',
          s.flag('job_bounty_done') ? '{d}[DONE] Rustfang bounty.{/}' : `{y}BOUNTY{/}: Rustfangs defeated: ${Math.min(10, (s.get('rustfangs') as number | undefined) ?? 0)}/10. Dutch pays 250¢.`,
        ];
        await s.narrate(`{c}JOB BOARD{/}\n${jobs.join('\n')}`);
        if (!s.flag('job_bounty_done') && ((s.get('rustfangs') as number | undefined) ?? 0) >= 10) {
          s.set('job_bounty_done');
          await s.say('dutch', 'Ten Rustfangs? Remind me never to owe you money. Here.', { face: 'happy' });
          await s.cred(250);
        }
      },
    },
    {
      id: 'jukebox', x: 20, y: 10, on: 'action', run: async (s) => {
        await s.narrate('The jukebox plays the same slow song it always plays. It feels like rain.');
      },
    },
  ],
  warps: [exit(BAR_W, BAR_H, 11, 22, 7)],
};

// ------------------------------------------------------------------ Doc Yun's clinic
export const clinic: MapDef = {
  id: 'clinic', name: 'Doc Yun’s Clinic', kind: 'interior',
  terrain: room(14, 10, 'T', 7), legend: {},
  ambient: '#86a8b0', music: 'town', battleBg: 'street',
  props: [
    { kind: 'counter', x: 3, y: 4, w: 6, color: '#dfe6ee' },
    { kind: 'shelf', x: 2, y: 2, w: 2 },
    { kind: 'shelf', x: 5, y: 2, w: 2 },
    { kind: 'bed', x: 11, y: 2, color: '#6ab0a8' },
    { kind: 'bed', x: 11, y: 5, color: '#6ab0a8' },
    { kind: 'screen', x: 8, y: 1, w: 2, color: '#62e06a' },
    { kind: 'plant', x: 1, y: 7 },
  ],
  lights: [{ x: 6, y: 4, r: 80, color: '#dff6ff', i: 0.6 }],
  npcs: [
    { id: 'yun', x: 5, y: 3, dir: 'down', look: { skin: '#e8c8a0', hair: '#1a1418', hairStyle: 'bob', top: '#e8ecf0', inner: '#6ab0a8', accent: '#62e06a', pants: '#3a3a48', boots: '#1a1418' }, name: 'Doc Yun', fixedDir: true, talk: async (s) => {
      if (s.has('med_case')) {
        s.take('med_case');
        s.set('job_case_done');
        await s.say('yun', 'My case! Every scalpel still here. I could kiss you. I won’t, hygiene. Take these.', { face: 'happy' });
        await s.give('trauma_patch', 3);
        await s.give('adrenal_stim', 1);
        return;
      }
      await s.clinic();
    } },
    { id: 'patient', x: 10, y: 7, dir: 'up', look: randomLook(88), name: 'Patient', talk: ['Doc put in a new liver. Secondhand. Keeps craving whiskey I’ve never tasted.'] },
  ],
  warps: [exit(14, 10, 7, 4, 7)],
};

// ------------------------------------------------------------------ Iron Saint Arms
export const armory: MapDef = {
  id: 'armory', name: 'Iron Saint Arms', kind: 'interior',
  terrain: room(14, 10, 'M', 7), legend: {},
  ambient: '#8a7a8a', music: 'town', battleBg: 'street',
  props: [
    { kind: 'counter', x: 3, y: 4, w: 8, color: '#4a3a30' },
    { kind: 'rack', x: 2, y: 2, w: 2 },
    { kind: 'rack', x: 5, y: 2, w: 2 },
    { kind: 'rack', x: 9, y: 2, w: 3 },
    { kind: 'screen', x: 7, y: 1, w: 2, color: '#ff6a3a' },
    { kind: 'barrel', x: 1, y: 7, color: '#5a3a2a' },
    { kind: 'crates', x: 12, y: 7 },
  ],
  lights: [{ x: 7, y: 4, r: 80, color: '#ffb46a', i: 0.55 }],
  npcs: [
    {
      id: 'tomas', x: 7, y: 3, dir: 'down', name: 'Brother Tomas', fixedDir: true,
      look: { skin: '#c28a64', hair: '#3a2a20', hairStyle: 'bald', top: '#4a3a30', coat: '#4a3a30', inner: '#8c2f39', accent: '#d9b36c', pants: '#2a2a33', boots: '#1a1418', accessories: ['beard'] },
      talk: shopTalk('Brother Tomas', 'lr_weapons', 'Every blade here is blessed. The guns are merely loaded. Browse, child.'),
    },
  ],
  warps: [exit(14, 10, 7, 12, 7)],
};

// ------------------------------------------------------------------ Kowloon Threads
export const threads: MapDef = {
  id: 'threads', name: 'Kowloon Threads', kind: 'interior',
  terrain: room(14, 10, 'C', 7), legend: { C: 'floor_carpet' },
  ambient: '#8a78a8', music: 'town', battleBg: 'street',
  props: [
    { kind: 'counter', x: 8, y: 4, w: 4, color: '#3a2a4a' },
    { kind: 'rack', x: 1, y: 2, w: 2 },
    { kind: 'rack', x: 4, y: 2, w: 2 },
    { kind: 'rack', x: 1, y: 6, w: 2 },
    { kind: 'plant', x: 12, y: 2 },
    { kind: 'screen', x: 9, y: 1, w: 2, color: '#b07cff' },
    { kind: 'lampfloor', x: 12, y: 7, color: '#ff9ad2' },
  ],
  lights: [{ x: 7, y: 5, r: 80, color: '#ffd0f0', i: 0.5 }],
  npcs: [
    {
      id: 'wen', x: 10, y: 3, dir: 'down', name: 'Auntie Wen', fixedDir: true,
      look: { skin: '#e8c8a0', hair: '#c9c4bb', hairStyle: 'bun', top: '#b07cff', inner: '#2a2438', accent: '#ffcc3d', pants: '#3a3350', boots: '#2a2030' },
      talk: shopTalk('Auntie Wen', 'lr_armor', 'Ah! Rook’s girl. You’re too skinny for that jacket. Let Auntie fix it.'),
    },
    patron('shopper', 5, 7, 311, 'Shopper', ['Auntie Wen sewed a ballistic lining into my wedding dress. Best day of my life. Only got shot twice.'], 'up'),
  ],
  warps: [exit(14, 10, 7, 40, 7)],
};

// ------------------------------------------------------------------ Kwik-Mart
export const kwikmart: MapDef = {
  id: 'kwikmart', name: 'Kwik-Mart 24/7', kind: 'interior',
  terrain: room(14, 10, 'T', 7), legend: {},
  ambient: '#9ab0b0', music: 'town', battleBg: 'street',
  props: [
    { kind: 'counter', x: 9, y: 3, w: 3, color: '#2f6a5a' },
    { kind: 'shelf', x: 1, y: 2, w: 3 },
    { kind: 'shelf', x: 5, y: 2, w: 3 },
    { kind: 'shelf', x: 2, y: 5, w: 4 },
    { kind: 'vending', x: 12, y: 6, color: '#62e0c0' },
    { kind: 'arcade', x: 1, y: 7, color: '#ffcc3d' },
  ],
  lights: [{ x: 7, y: 4, r: 90, color: '#e6fff6', i: 0.55 }],
  npcs: [
    { id: 'clerk', x: 10, y: 2, dir: 'down', look: randomLook(420), name: 'Clerk', fixedDir: true, talk: shopTalk('Clerk', 'lr_items') },
    patron('kid', 2, 8, 64, 'Kid', ['This arcade cabinet has a ghost in it. A real one. It’s really good at Street Samurai IV.'], 'up'),
  ],
  warps: [exit(14, 10, 7, 6, 23)],
};

// ------------------------------------------------------------------ Sleeptube 24H (inn)
export const hotel: MapDef = {
  id: 'hotel', name: 'Sleeptube 24H', kind: 'interior',
  terrain: room(16, 10, 'T', 8), legend: {},
  ambient: '#7a8ab8', music: 'town', battleBg: 'street',
  props: [
    { kind: 'counter', x: 2, y: 4, w: 4, color: '#2c3b5e' },
    { kind: 'capsule', x: 8, y: 2, w: 2 },
    { kind: 'capsule', x: 11, y: 2, w: 2 },
    { kind: 'capsule', x: 8, y: 6, w: 2 },
    { kind: 'capsule', x: 11, y: 6, w: 2 },
    { kind: 'screen', x: 2, y: 1, w: 3, color: '#3fe0f0' },
    { kind: 'plant', x: 14, y: 2 },
    { kind: 'vending', x: 1, y: 7, color: '#3fe0f0' },
  ],
  lights: [{ x: 8, y: 4, r: 90, color: '#b8d8ff', i: 0.5 }],
  npcs: [
    {
      id: 'hotelclerk', x: 3, y: 3, dir: 'down', name: 'Desk Clerk', fixedDir: true,
      look: { skin: '#f2c9a5', hair: '#3fe0f0', hairStyle: 'short', top: '#2c3b5e', inner: '#e8e8f0', accent: '#3fe0f0', pants: '#1f2a44', boots: '#101018', accessories: ['visor'], visor: '#3fe0f0' },
      talk: async (s) => {
        await s.say('Desk Clerk', 'Welcome to Sleeptube. Clean tubes, working locks, no questions.');
        await s.inn(10, 'Capsules at 10¢ a head');
      },
    },
    patron('sleeper', 14, 7, 902, 'Guest', ['I’ve lived in tube 44 for six years. It’s cozy. The walls are close enough to hug.'], 'left'),
  ],
  warps: [exit(16, 10, 8, 32, 7)],
};

// ------------------------------------------------------------------ Mama Ono's
export const noodles: MapDef = {
  id: 'noodles', name: 'Mama Ono’s', kind: 'interior',
  terrain: room(14, 10, 'W', 7), legend: {},
  ambient: '#9a7a70', music: 'town', battleBg: 'street',
  props: [
    { kind: 'counter', x: 2, y: 4, w: 9, color: '#8a4a2a' },
    { kind: 'shelf', x: 2, y: 2, w: 3 },
    { kind: 'stool', x: 3, y: 5 },
    { kind: 'stool', x: 5, y: 5 },
    { kind: 'stool', x: 7, y: 5 },
    { kind: 'stool', x: 9, y: 5 },
    { kind: 'window', x: 8, y: 1, w: 3 },
    { kind: 'table', x: 11, y: 7, w: 2 },
    { kind: 'lampfloor', x: 1, y: 7, color: '#ff9a4a' },
  ],
  lights: [{ x: 6, y: 4, r: 80, color: '#ffb46a', i: 0.65 }],
  npcs: [
    {
      id: 'ono', x: 6, y: 3, dir: 'down', name: 'Mama Ono', fixedDir: true,
      look: { skin: '#e0b08a', hair: '#e8e4da', hairStyle: 'bun', top: '#d8452e', inner: '#efe6d4', accent: '#ffcc3d', pants: '#3a3448', boots: '#2a2420' },
      talk: async (s) => {
        if (s.flag('cat_found') && !s.flag('job_cat_done')) {
          s.set('job_cat_done');
          await s.say('Mama Ono', 'NOODLE! My baby! Where did you— the SINKLINE? You smell like a drain! Come here!');
          await s.say('Mama Ono', 'You, crew. Free noodles for life. Well. For a while. Here.');
          await s.give('noodles', 5);
          return;
        }
        if (!s.flag('ono_free')) {
          s.set('ono_free');
          await s.say('Mama Ono', 'Kit! Too skinny. Always too skinny. First bowl is free, sit, sit.');
          await s.give('noodles', 1);
        }
        await s.shop('noodles');
      },
    },
    patron('regular', 9, 6, 250, 'Regular', ['Mama Ono’s cat ran off last week. She pretends she doesn’t care. She cares. She put up a notice on the Drowned Saint’s board.'], 'up'),
    { id: 'noodle_cat', x: 12, y: 8, dir: 'left', look: LOOKS.kit, critter: 'cat', name: 'Noodle', when: (f) => !!f.job_cat_done, move: 'wander', radius: 1, talk: ['Mrrp.'] },
  ],
  warps: [exit(14, 10, 7, 44, 32)],
};

// ------------------------------------------------------------------ Hex's den
export const hexDen: MapDef = {
  id: 'hex_den', name: 'Chrome+Circuit (upstairs)', kind: 'interior',
  terrain: room(14, 11, 'M', 7), legend: {},
  ambient: '#6a6aa0', music: 'town', battleBg: 'street',
  props: [
    { kind: 'desk', x: 2, y: 3, w: 3 },
    { kind: 'desk', x: 8, y: 3, w: 3 },
    { kind: 'screen', x: 2, y: 1, w: 3, color: '#3fe0f0' },
    { kind: 'screen', x: 8, y: 1, w: 3, color: '#62e06a' },
    { kind: 'crates', x: 12, y: 2 },
    { kind: 'crates', x: 1, y: 7 },
    { kind: 'couch', x: 9, y: 7, w: 3, color: '#3a3a5a' },
    { kind: 'rack', x: 12, y: 5 },
    { kind: 'lampfloor', x: 6, y: 7, color: '#b07cff' },
    { kind: 'poster', x: 6, y: 1, color: '#3fe0f0' },
  ],
  lights: [
    { x: 4, y: 3, r: 60, color: '#3fe0f0', i: 0.5 },
    { x: 9, y: 3, r: 60, color: '#62e06a', i: 0.45 },
  ],
  npcs: [{ id: 'hex', x: 6, y: 4, dir: 'down', look: LOOKS.hex, name: 'Hex', talk: meetHex, when: (f) => !f.hex_joined }],
  events: [
    {
      id: 'deck', x: 3, y: 4, on: 'action', run: async (s) => {
        await s.narrate(s.flag('hex_joined') ? 'Hex’s spare deck, patched together with tape and optimism.' : 'Hex’s cyberdeck. A thin curl of smoke rises from the coprocessor slot.');
      },
    },
  ],
  warps: [exit(14, 11, 7, 11, 32)],
};

export const INTERIORS: MapDef[] = [rookFlat, bar, clinic, armory, threads, kwikmart, hotel, noodles, hexDen];
