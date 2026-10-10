/**
 * The Sprawl — world map linking Lantern Row, the Rustyard and the Sinkline station.
 *
 * The map data is JSON now (M5 task 4): `world.json`. This file is the BEHAVIOR the JSON refers to by id
 * (predicates and scripts, moved as they were) and the join (`joinMap`, `mapdata.ts`). `tests/mapdata-all.test.ts` proves each joined map equals
 * the old TypeScript map (`tests/fixtures/maps/world-old.ts`).
 */
import { sinklineGate } from '../../story/chapter1';
import worldJson from './world.json' with { type: 'json' };
import { joinMap, type MapBehavior } from './mapdata';

export const worldBehavior: MapBehavior = {
  when: {
    met_hex: (f) => !!f.met_hex,
    sinkline_gate: (f) => !!f.sinkline_gate,
  },
  scripts: {
    av_wreck_run: async (s) => {
      await s.narrate('A Kessler-Mori courier AV, nose-down in the mud. Two weeks down, by the rust. The flight recorder has been pried out, neatly.');
      if (s.inParty('hex')) await s.say('hex', 'Somebody came back for the black box and left the pilot. That’s a very K-M set of priorities.', { face: 'sad' });
      else await s.say('rook', 'They came back for the black box. Not the pilot.');
    },
    km_gate_talk: async (s) => {
      if (s.flag('warden')) await s.say('K-M Checkpoint', 'All units, Annex 7 is dark. Repeat, Annex 7 is— …Step back, citizen. Please. Today of all days.');
      else if (s.flag('lurker')) await s.say('K-M Checkpoint', 'Something tripped every sensor in the Sinkline an hour ago. Probably rats. Very large rats. …Why am I telling you this? Step back.');
      else if (s.flag('annex_key')) await s.say('K-M Checkpoint', 'Tonight’s registration drive is running late in the Lower Wards. If a van stops for you, get in. It is easier for everyone if you get in.');
      else if (s.flag('hex_joined')) await s.say('K-M Checkpoint', 'Registered guests only. Your jockey friend is not a registered guest. We have their face on file. We have several of their faces on file.');
      else {
        await s.say('K-M Checkpoint', 'Arcology access is restricted to Kessler-Mori personnel and registered guests.');
        await s.say('K-M Checkpoint', 'You are neither. Please step back from the checkpoint.');
      }
    },
    hermit_talk: async (s) => {
      await s.say('Old Marrow', 'The trees woke up before the people did. This shrine was here before both.');
      await s.say('Old Marrow', 'Spirits don’t mind blades. They mind will. Hit them with what you believe, not what you’re holding.');
      if (s.inParty('sable')) await s.say('sable', 'The crow knows this place. It says the old man is right, and also that he talks too much.');
    },
    fisher_talk: async (s) => {
      await s.say('Canal Fisher', 'Nothing bites in the canal. Not since ’61. Whatever lives down the Sinkline outflow ate everything with fins.');
      await s.say('Canal Fisher', 'Saw it once, from the bridge. Big as a train car. Hates light. Hates heat worse. And my old taser gave it a real bad day.');
    },
    dj_talk: async (s) => {
      if (s.flag('lurker')) await s.say('Static Mary', 'Breaking news on Radio Static: something the size of a train died under Junction 4. The rats are throwing a parade. Was that you? That was you.');
      else if (s.flag('hex_joined')) await s.say('Static Mary', 'Hex! You tell Hex they still owe me a jingle. Thirty seconds. Something catchy about not paying people.');
      else if (s.flag('met_dutch')) await s.say('Static Mary', 'K-M trucks have been going down the Sinkline at night. No lights, no plates. That’s tonight’s top story, and nobody’s listening.');
      else await s.say('Static Mary', 'You’re listening to Radio Static, the only station in Saltreach nobody paid for. Including me.');
      if (!s.flag('met_mary')) {
        s.set('met_mary');
        await s.say('Static Mary', 'Stash behind the tent’s for runners. Take what you need. Tell people where you heard it.');
      }
    },
    to_rustyard_blocked: async (s) => {
      await s.say('rook', s.flag('met_dutch') ? 'Rustyard. Nothing for us there until we know what Hex needs.' : 'The Rustyard. Scavs and scrap. We’ve got a meeting at the Drowned Saint first.');
    },
    sinkline_gate: sinklineGate,
  },
};

export const world = joinMap(worldJson, worldBehavior);
