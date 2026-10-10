/**
 * Lantern Row interiors.
 *
 * The map data is JSON now (M5 task 4): `rook_flat.json`, `bar.json`, `clinic.json`, `armory.json`, `threads.json`, `kwikmart.json`, `hotel.json`, `noodles.json`, `hex_den.json`. This file is the BEHAVIOR the JSON refers to by id
 * (predicates and scripts, moved as they were) and the join (`joinMap`, `mapdata.ts`). `tests/mapdata-all.test.ts` proves each joined map equals
 * the old TypeScript map (`tests/fixtures/maps/interiors-old.ts`).
 */
import type { ScriptFn } from '../../game/script';
import { introFlat, meetDutch, meetHex } from '../../story/chapter1';
import rookFlatJson from './rook_flat.json' with { type: 'json' };
import barJson from './bar.json' with { type: 'json' };
import clinicJson from './clinic.json' with { type: 'json' };
import armoryJson from './armory.json' with { type: 'json' };
import threadsJson from './threads.json' with { type: 'json' };
import kwikmartJson from './kwikmart.json' with { type: 'json' };
import hotelJson from './hotel.json' with { type: 'json' };
import noodlesJson from './noodles.json' with { type: 'json' };
import hexDenJson from './hex_den.json' with { type: 'json' };
import type { MapDef } from '../../field/types';
import { joinMap, type MapBehavior } from './mapdata';

const shopTalk = (who: string, shop: string, line?: string): ScriptFn => async (s) => {
  if (line) await s.say(who, line);
  await s.shop(shop);
};

export const rookFlatBehavior: MapBehavior = {
  when: {},
  scripts: {
    on_enter: async (s) => {
      if (!s.flag('intro')) await introFlat(s);
    },
    bed_run: async (s) => s.inn(0, 'Kit’s own bed: lumpy, familiar, free'),
    fridge_run: async (s) => {
      if (!s.flag('ate')) {
        s.set('ate');
        await s.narrate('Half a carton of soy-noodles and a suspicious egg. Kit eats the noodles. The egg stays a mystery.');
        await s.give('medkit', 1);
      } else await s.narrate('The suspicious egg regards you. You regard it back.');
    },
    rent_tin_run: async (s) => {
      if (s.flag('rent_tin')) {
        await s.narrate('The rent tin. Lighter than it should be. Everything is.');
        return;
      }
      s.set('rent_tin');
      await s.narrate('A biscuit tin behind the kettle, RENT scratched in the lid.');
      await s.say('rook', 'Take half. The landlord can wait a week. The Rustfangs won’t.');
      await s.cred(60);
    },
    rack_run: async (s) => {
      await s.say('rook', 'Hands off the rack. Every blade there has a story, and every story ends with somebody bleeding.');
    },
    tv_run: async (s) => {
      await s.narrate('{c}K-M NEWSFEED:{/} “…Kessler-Mori reminds citizens that Woken individuals must register their abilities. Registration is free, safe, and mandatory…”');
    },
  },
};

export const rookFlat = joinMap(rookFlatJson, rookFlatBehavior);

export const barBehavior: MapBehavior = {
  when: {
    not_met_dutch: (f) => !f.met_dutch,
  },
  scripts: {
    meet_dutch: meetDutch,
    barkeep_talk: async (s) => {
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
          'Kessler-Mori’s buying up every Woken kid in the Wards. “Scholarships.” Right.',
          'A crew called the Glass Wolves drank here last week. Big job, big talk. Haven’t seen ’em since.',
        ];
        await s.say('Saint', rumors[(s.get('rumor') as number | undefined ?? 0) % rumors.length]!);
        s.set('rumor', ((s.get('rumor') as number | undefined) ?? 0) + 1);
      }
    },
    board_run: async (s) => {
      const jobs = [
        s.flag('job_cat_done') ? '{d}[DONE] Lost cat “Noodle”.{/}' : s.flag('cat_found') ? '{g}[FOUND] Return Noodle to Mama Ono.{/}' : '{y}LOST CAT{/}: “Noodle”, orange, one ear. Last seen near the Sinkline. Reward from Mama Ono.',
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
    jukebox_run: async (s) => {
      await s.narrate('The jukebox plays the same slow song it always plays. It feels like rain.');
    },
  },
};

export const bar = joinMap(barJson, barBehavior);

export const clinicBehavior: MapBehavior = {
  when: {},
  scripts: {
    yun_talk: async (s) => {
      if (s.has('med_case')) {
        s.take('med_case');
        s.set('job_case_done');
        await s.say('yun', 'My case! Every scalpel still here. I could kiss you. I won’t, hygiene. Take these.', { face: 'happy' });
        await s.give('trauma_patch', 3);
        await s.give('adrenal_stim', 1);
        return;
      }
      await s.clinic();
    },
  },
};

export const clinic = joinMap(clinicJson, clinicBehavior);

export const armoryBehavior: MapBehavior = {
  when: {},
  scripts: {
    tomas_talk: shopTalk('Brother Tomas', 'lr_weapons', 'Every blade here is blessed. The guns are merely loaded. Browse, child.'),
  },
};

export const armory = joinMap(armoryJson, armoryBehavior);

export const threadsBehavior: MapBehavior = {
  when: {},
  scripts: {
    wen_talk: shopTalk('Auntie Wen', 'lr_armor', 'Ah! Rook’s girl. You’re too skinny for that jacket. Let Auntie fix it.'),
  },
};

export const threads = joinMap(threadsJson, threadsBehavior);

export const kwikmartBehavior: MapBehavior = {
  when: {},
  scripts: {
    clerk_talk: shopTalk('Clerk', 'lr_items'),
  },
};

export const kwikmart = joinMap(kwikmartJson, kwikmartBehavior);

export const hotelBehavior: MapBehavior = {
  when: {},
  scripts: {
    hotelclerk_talk: async (s) => {
      await s.say('Desk Clerk', 'Welcome to Sleeptube. Clean tubes, working locks, no questions.');
      await s.inn(10);
    },
  },
};

export const hotel = joinMap(hotelJson, hotelBehavior);

export const noodlesBehavior: MapBehavior = {
  when: {
    job_cat_done: (f) => !!f.job_cat_done,
  },
  scripts: {
    ono_talk: async (s) => {
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
};

export const noodles = joinMap(noodlesJson, noodlesBehavior);

export const hexDenBehavior: MapBehavior = {
  when: {
    not_hex_joined: (f) => !f.hex_joined,
  },
  scripts: {
    meet_hex: meetHex,
    deck_run: async (s) => {
      await s.narrate(s.flag('hex_joined') ? 'Hex’s spare deck, patched together with tape and optimism.' : 'Hex’s cyberdeck. A thin curl of smoke rises from the coprocessor slot.');
    },
  },
};

export const hexDen = joinMap(hexDenJson, hexDenBehavior);

export const INTERIORS: MapDef[] = [rookFlat, bar, clinic, armory, threads, kwikmart, hotel, noodles, hexDen];
