/**
 * Lantern Row — the hub district. Night, rain, neon.
 *
 * The map data is JSON now (M5 task 4): `lantern_row.json`. This file is the BEHAVIOR the JSON refers to by id
 * (predicates and scripts, moved as they were) and the join (`joinMap`, `mapdata.ts`). `tests/mapdata-all.test.ts` proves each joined map equals
 * the old TypeScript map (`tests/fixtures/maps/lantern_row-old.ts`).
 */
import { firstFight } from '../../story/chapter1';
import lanternRowJson from './lantern_row.json' with { type: 'json' };
import { joinMap, type MapBehavior } from './mapdata';

export const lanternRowBehavior: MapBehavior = {
  when: {
    never: () => false,
    intro_and_not_first_fight: (f) => !!f.intro && !f.first_fight,
  },
  scripts: {
    to_lantern_row_blocked: async (s) => s.narrate('A note on the shutter: {c}“NIX AUTO — CLOSED. GONE FISHING. DON’T STEAL ANYTHING.”{/}'),
    junk_talk: async (s) => {
      if (!s.flag('coprocessor_given')) {
        await s.say('Hedda', 'Decks, chips, parts! You want a coprocessor? Ha! For those, try my sister, Old Mags, out in the Rustyard. She gets the good salvage.');
        return;
      }
      const c = await s.ask('Hedda', s.flag('camp_kept') ? 'Mags sent word: you left the camp its collection. Her stock, her prices, a fifth off. Family rates.' : 'Mags sent word you ran Knuckles off. I carry her stock in town now. Take a look.', ['Shop', 'Leave'], { cancel: 1 });
      if (c === 0) await s.shop('rustyard');
    },
    memorial_run: async (s) => {
      await s.narrate('THE DROWNED SAINT · IN MEMORY OF THE LOWER WARDS, ’61. Somebody has hung a lantern for every name. There is room for more.');
      if (s.inParty('rook') && !s.flag('memorial_rook')) {
        s.set('memorial_rook');
        await s.say('rook', 'I hang one every year. Don’t ask me who for.');
      }
    },
    first_fight: firstFight,
    barricade_run: async (s) => {
      await s.say('K-M Civic Security', 'Halt. Access Point Seven is closed. Turn around, citizen.');
      await s.move('player', 'r');
    },
    terminal_run: async (s) => {
      await s.narrate('{c}PUBLIC TERMINAL{/} · “Lantern Row. Saltreach Lower Wards. Population: unknown. Flood level: manageable. Have a K-M day.”');
    },
    canal_run: async (s) => {
      await s.narrate('The canal is black and slow. Lantern light floats on it like spilled paint.');
    },
  },
};

export const lanternRow = joinMap(lanternRowJson, lanternRowBehavior);
