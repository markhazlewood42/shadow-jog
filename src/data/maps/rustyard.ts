/**
 * The Rustyard — a scavenger camp in the Barrens, under Rustfang pressure.
 *
 * The map is data now (M5 task 3): the grid, props, lights, npcs, warps, events and chests are in `rustyard.json`; this file is its BEHAVIOR,
 * the predicates and scripts the JSON refers to by id, and the join (`joinMap`, `mapdata.ts`). The scripts are moved as they were, word for word.
 * `tests/mapdata.test.ts` proves the joined map equals the old TypeScript map (`tests/fixtures/maps/rustyard-old.ts`).
 */
import { knucklesFight, magsReward, rustyardGate } from '../../story/chapter1';
import data from './rustyard.json' with { type: 'json' };
import { joinMap, type MapBehavior } from './mapdata';

export const rustyardBehavior: MapBehavior = {
  when: {
    // The Rustfangs' tribute stash, found (the west heap pulled aside) or not yet.
    tribute_found: (f) => !!f.tribute_stash,
    tribute_unfound: (f) => !f.tribute_stash,
    // The camp's gate: the Rustfangs hold it until the first talk with Mags.
    gate_unpassed: (f) => !f.rustyard_gate,
    knuckles_alive: (f) => !f.knuckles,
    // The tire depot is open once the gate is passed and until Knuckles is beaten.
    depot_open: (f) => !!f.rustyard_gate && !f.knuckles,
  },
  scripts: {
    mags_reward: magsReward,
    knuckles_fight: knucklesFight,
    rustyard_gate: rustyardGate,
    tobin: async (s) => {
      if (!s.flag('rustyard_gate')) await s.say('Tobin', 'Auntie Mags says don’t fight the Rustfangs. They broke Pell’s hands last week for coming up short on tribute.');
      else if (!s.flag('knuckles')) await s.say('Tobin', 'Knuckles lives up at the tire depot, past the scrap maze. The heaps shift every time it rains; follow the painted arrows, we move them when the heaps move. Mind the hounds.');
      else {
        await s.say('Tobin', 'You beat KNUCKLES? Can I have your autograph? Can I have your jacket?');
        // The maze's middle board, owned up to.
        await s.say('Tobin', 'Oh, and the SINKHOLE board in the maze? There’s no sinkhole. I painted that. Rustfangs are scared of holes. Don’t tell.');
      }
    },
    // The clue to the tribute stash: where the camp leaves what the Rustfangs take.
    scav_kid: async (s) => {
      if (s.flag('coprocessor_given')) {
        await s.say('Scav Kid', 'You got our filter back! The water tastes like water again. Mostly.');
        if (s.flag('camp_kept')) await s.say('Scav Kid', 'And Auntie says you didn’t take the collection. She says that’s stupid. She was smiling when she said it.');
        return;
      }
      await s.say('Scav Kid', 'The Rustfangs took our water filter. Auntie Mags says we’ll get it back. She doesn’t look like she believes it.');
      if (s.flag('tribute_stash')) return;
      await s.say('Scav Kid', 'Every week we leave the tribute at the west heap. The one with their tag on it. They come for it at night, and they never take it far.');
      s.set('tribute_hint');
    },
    loose_scrap: async (s) => {
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
    depot_lock: async (s) => {
      await s.say('rook', 'Talk to the locals first. We’re not here to pick fights for free.');
      await s.move('player', 'd');
    },
  },
};

export const rustyard = joinMap(data, rustyardBehavior);
