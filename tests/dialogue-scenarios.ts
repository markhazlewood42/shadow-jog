/**
 * The runs of Chapter 1 that the dialogue move is proved on (M8a): each is one story script, started with the flags, party and
 * choice answers that take one branch. Together they reach every line the chapter's scripts can say (`tests/dialogue-data.test.ts`
 * checks that, against the old code and against the new ids). Used by the test and by the generator that froze the old lines.
 */
import {
  annexDoor, annexGuards, annexLog, betrayal, cryopod, deadCrew, firstFight, floodgate, introFlat, knucklesFight, lattice, lurkerFight, magsReward,
  meetDutch, meetHex, pumpValve, relay, rustyardGate, sinklineGate, wardenFight,
} from '../src/story/chapter1';
import type { ScriptFn } from '../src/game/script';
import type { World } from './dialogue-record';

export interface Scenario extends World {
  name: string;
  run: ScriptFn;
}

const sc = (name: string, run: ScriptFn, world: World = {}): Scenario => ({ name, run, ...world });

export const SCENARIOS: Scenario[] = [
  sc('intro_flat', introFlat),
  sc('first_fight_win', firstFight),
  sc('first_fight_lose', firstFight, { battle: 'lose' }),

  sc('meet_dutch_first', meetDutch),
  sc('meet_dutch_again', meetDutch, { flags: { met_dutch: true } }),
  sc('meet_dutch_again_sable', meetDutch, { flags: { met_dutch: true, sable_joined: true } }),

  sc('meet_hex_first', meetHex),
  sc('meet_hex_asked', meetHex, { flags: { met_hex: true } }),
  sc('meet_hex_chip', meetHex, { flags: { coprocessor: true } }),
  sc('meet_hex_done', meetHex, { flags: { hex_joined: true } }),

  sc('rustyard_gate_win', rustyardGate),
  sc('rustyard_gate_lose', rustyardGate, { battle: 'lose' }),
  sc('knuckles_win', knucklesFight),
  sc('knuckles_lose', knucklesFight, { battle: 'lose' }),

  sc('mags_early', magsReward),
  sc('mags_take_stash', magsReward, { flags: { knuckles: true, tribute_stash: true }, answers: [0] }),
  sc('mags_keep_stash', magsReward, { flags: { knuckles: true, tribute_stash: true }, answers: [1] }),
  sc('mags_take', magsReward, { flags: { knuckles: true }, answers: [0] }),
  sc('mags_keep', magsReward, { flags: { knuckles: true }, answers: [1] }),
  sc('mags_shop', magsReward, { flags: { knuckles: true, coprocessor_given: true }, answers: [0] }),
  sc('mags_talk', magsReward, { flags: { knuckles: true, coprocessor_given: true }, answers: [1] }),
  sc('mags_leave', magsReward, { flags: { knuckles: true, coprocessor_given: true }, answers: [2] }),

  sc('sinkline_gate_alone', sinklineGate),
  sc('sinkline_gate_hex', sinklineGate, { party: ['hex'] }),
  sc('dead_crew', deadCrew),

  sc('pump_v1_open', pumpValve('v1'), { flags: { floodgate: true } }),
  sc('pump_v2_open', pumpValve('v2'), { flags: { floodgate: true } }),
  sc('pump_v3_open', pumpValve('v3'), { flags: { floodgate: true } }),
  sc('pump_v2_leave_first', pumpValve('v2'), { answers: [1] }),
  sc('pump_v2_leave_seen', pumpValve('v2'), { flags: { pump_seen: true }, answers: [1] }),
  sc('pump_v2_right_first', pumpValve('v2'), { flags: { pump_seen: true }, answers: [0] }),
  sc('pump_v1_right_second', pumpValve('v1'), { flags: { pump_seen: true, valves: 1, valve_v2: true }, answers: [0] }),
  sc('pump_v3_right_last', pumpValve('v3'), { flags: { pump_seen: true, valves: 2, valve_v2: true, valve_v1: true }, answers: [0] }),
  sc('pump_v1_wrong_first_seen', pumpValve('v1'), { flags: { pump_seen: true }, answers: [0] }),
  sc('pump_v1_wrong_first_unseen', pumpValve('v1'), { flags: { valve_first: true }, answers: [0] }),
  sc('pump_v3_wrong_after_one', pumpValve('v3'), { flags: { valve_first: true, valves: 1, valve_v2: true, valve_hint: true }, answers: [0] }),
  sc('pump_v1_wrong_after_two', pumpValve('v1'), { flags: { valve_first: true, valves: 2, valve_v2: true, valve_v3: true, valve_hint: true }, answers: [0] }),

  sc('floodgate_done', floodgate, { flags: { floodgate: true } }),
  sc('floodgate_dry_first', floodgate),
  sc('floodgate_dry_seen', floodgate, { flags: { pump_seen: true } }),
  sc('floodgate_ready', floodgate, { flags: { valves: 3 } }),
  sc('lurker_win', lurkerFight),
  sc('lurker_lose', lurkerFight, { battle: 'lose' }),

  sc('annex_door_locked', annexDoor),
  sc('annex_door_open', annexDoor, { flags: { annex_key: true } }),
  sc('annex_guards_win', annexGuards),
  sc('annex_guards_lose', annexGuards, { battle: 'lose' }),

  sc('lattice_down', lattice, { flags: { lattice_off: true } }),
  sc('lattice_first', lattice),
  sc('lattice_seen_a', lattice, { flags: { lattice_seen: true, relay_a: true } }),
  sc('lattice_seen_b', lattice, { flags: { lattice_seen: true, relay_b: true } }),
  sc('lattice_seen_c', lattice, { flags: { lattice_seen: true, relay_c: true } }),

  sc('relay_a_down', relay('a'), { flags: { lattice_off: true } }),
  sc('relay_b_down', relay('b'), { flags: { lattice_off: true } }),
  sc('relay_c_down', relay('c'), { flags: { lattice_off: true } }),
  sc('relay_a_leave_first', relay('a'), { answers: [1] }),
  sc('relay_b_leave_first', relay('b'), { answers: [1] }),
  sc('relay_c_leave_first', relay('c'), { answers: [1] }),
  sc('relay_a_cycle', relay('a'), { flags: { relay_seen: true }, answers: [0] }),
  sc('relay_c_cycle', relay('c'), { flags: { relay_seen: true }, answers: [0] }),
  sc('relay_b_cycle_dark', relay('b'), { flags: { relay_seen: true }, answers: [0] }),
  sc('relay_b_cycle_first', relay('b'), { answers: [0] }),

  sc('annex_log', annexLog('SUBJECT LOG · S-7', 'Subject S-7 (orc, shamanic).')),
  sc('cryopod_done', cryopod, { flags: { sable_joined: true } }),
  sc('cryopod_full', cryopod),
  sc('warden_win', wardenFight),
  sc('warden_lose', wardenFight, { battle: 'lose' }),

  sc('betrayal_done', betrayal, { flags: { betrayal: true } }),
  sc('betrayal_go_for_pale', betrayal, { answers: [0] }),
  sc('betrayal_cover_crew', betrayal, { answers: [1] }),
];
