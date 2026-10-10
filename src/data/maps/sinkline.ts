/**
 * The Sinkline, level B1 — a flooded metro station. The junction drains when the pumps run.
 *
 * The map data is JSON now (M5 task 4): `sinkline_1.json`. This file is the BEHAVIOR the JSON refers to by id
 * (predicates and scripts, moved as they were) and the join (`joinMap`, `mapdata.ts`). `tests/mapdata-all.test.ts` proves each joined map equals
 * the old TypeScript map (`tests/fixtures/maps/sinkline-old.ts`).
 */
import { deadCrew, floodgate, lurkerFight, OBJ, pumpValve } from '../../story/chapter1';
import sinkline1Json from './sinkline_1.json' with { type: 'json' };
import { joinMap, type MapBehavior } from './mapdata';

export const sinkline1Behavior: MapBehavior = {
  when: {
    floodgate: (f) => !!f.floodgate,
    not_valve_v1: (f) => !f.valve_v1,
    valve_v1: (f) => !!f.valve_v1,
    not_valve_v2: (f) => !f.valve_v2,
    valve_v2: (f) => !!f.valve_v2,
    not_valve_v3: (f) => !f.valve_v3,
    valve_v3: (f) => !!f.valve_v3,
    floodgate_and_not_lurker: (f) => !!f.floodgate && !f.lurker,
    not_cat_found: (f) => !f.cat_found,
    not_floodgate: (f) => !f.floodgate,
    lurker: (f) => !!f.lurker,
  },
  scripts: {
    wire_talk: async (s) => {
      if (!s.flag('met_wire')) {
        s.set('met_wire');
        await s.say('Wire', 'Whoa, whoa. Runners? Down here? …Relax, I’m not K-M. I’m Wire. I live here. Rent’s free if you don’t mind ghosts.');
        await s.say('Wire', 'I fence what the tunnels cough up. You need gear, I got gear. Mags-grade, no backtracking.');
        // The puzzle, announced (Mark's playthrough, 2026-09-29: nothing said there was one).
        if (!s.flag('floodgate')) {
          await s.say('Wire', 'Going east? Junction’s been a lake since ’61. The old pump crew could drain it, though, if anybody still remembered how. Their pump room’s south of the platform.');
        }
      } else if (!s.flag('floodgate')) {
        await s.say('Wire', 'Junction still wet? Pump room’s south. The console down there still talks, if you ask it nicely.');
      }
      await s.shop('fence');
    },
    noodle_talk: async (s) => {
      await s.say('Noodle', 'Mrrrp?');
      await s.say('kit', 'Orange. One ear. You must be Noodle! Mama Ono misses you, you little drain gremlin.', { face: 'happy' });
      s.set('cat_found');
      s.despawn('noodle');
      await s.narrate('Noodle climbs into Kit’s jacket and refuses to leave. {c}Return Noodle to Mama Ono.{/}');
    },
    automat_run: async (s) => s.shop('automat'),
    dead_crew: deadCrew,
    floodgate: floodgate,
    valve1_run: pumpValve('v1'),
    valve2_run: pumpValve('v2'),
    valve3_run: pumpValve('v3'),
    flood_hint_run: async (s) => {
      await s.say('hex', 'The tracks run straight into the junction. Which is currently a lake.', { face: 'sad' });
      await s.say('rook', 'There’s a pump room somewhere down the maintenance corridor. Off the platform, south.');
      s.objective(OBJ.drain);
    },
    lurker_fight: lurkerFight,
    map_run: async (s) => {
      await s.narrate('A transit map, water-stained. {c}B1 Platforms{/} · {c}Pump Station{/} · {c}Junction 4{/} · {r}K-M Annex (restricted){/}.');
    },
    to_annex_blocked: async (s) => s.narrate('A maintenance hatch, rusted shut. Something big has been scraping at it from this side.'),
  },
};

export const sinkline1 = joinMap(sinkline1Json, sinkline1Behavior);
