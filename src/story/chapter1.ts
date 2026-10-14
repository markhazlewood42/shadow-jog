/**
 * Chapter 1 — "Milk Run". Story beats as field scripts.
 *
 * The words are not here. A box is s.line("scene.who.n") (or s.choose for a question), and its speaker, face and text are in
 * src/data/dialogue.json under that id (M8a; shape in docs/engine/m8a-data-format.md). The script decides whether and when a box
 * plays; a live value in the text is a named slot the script fills: s.line("pump.open", { intake, psi }) for {intake} and {psi}.
 * The tutorial cards (s.tutorial), the objective texts (OBJ) and annexLog (its text comes from the map files) are still written here.
 * tests/dialogue-data.test.ts keeps this file and the JSON in step: every id used here exists, and no id in the file is unused.
 *
 * Story flags, in the order the chapter sets them (the ones that gate the way forward first):
 *   intro, first_fight, met_dutch, met_hex, rustyard_gate, knuckles, coprocessor, coprocessor_given,
 *   hex_joined, sinkline_gate, valve_v1..3 + valves (the intake count), floodgate, lurker,
 *   annex_key, relay_a..c, lattice_off, sable_joined, warden, betrayal, chapter_end.
 * Ability unlocks (CH1_STORY_FLAGS, set with s.unlock): stingray_seated and rook_tuned at Hex's,
 *   rook_mended when Sable joins.
 * Side paths and choices: tribute_hint, tribute_stash, camp_kept (Mags' fork), annex_panel,
 *   req_badge, rent_tin, cat_found / job_cat_done, job_case_done, job_bounty_done, ono_free.
 * Seen-once lines (so a beat isn't repeated): met_wire, met_mary, pump_seen, valve_first, valve_hint,
 *   lattice_seen, relay_seen, read_mail, rook_log, memorial_rook, ate, rumor, tut_whiff.
 * (tests/maps.test.ts sets them in this order and checks, at every step, that no map strands the
 *  player: from every arrival a way out is walkable.)
 */
import type { ScriptApi, ScriptFn } from '../game/script';

export const OBJ = {
  dutch: 'Meet Dutch at the Drowned Saint (north side of the street).',
  hex: 'Find Hex. They live above Chrome+Circuit, by the canal.',
  mags: 'Get the coprocessor from Old Mags in the Rustyard, east of Lantern Row.',
  knuckles: 'Take the coprocessor back from Knuckles’ hideout, north end of the Rustyard.',
  bringChip: 'Bring the coprocessor to Hex in Lantern Row.',
  sinkline: 'Enter the Sinkline. The station is south of Lantern Row, over the canal.',
  flood: 'Find a way across the flooded junction.',
  drain: 'Drain the junction: the pump room is south of the platform.',
  cross: 'Cross the drained junction. The way down is past Signal Island, in the south-east.',
  deeper: 'Go deeper. Find Annex 7.',
  core: 'Find the data core.',
  escape: 'Gear up from the Annex armory, then head for the freight lift in the south wing.',
};

// ------------------------------------------------------------------ opening
export const introFlat: ScriptFn = async (s) => {
  await s.panels('intro');
  s.followers(false);
  s.actor('rook', 9, 3, 'up');
  s.face('player', 'down');
  await s.fadeIn(50);
  await s.wait(30);
  await s.line('intro.rook.1');
  s.face('player', 'right');
  await s.emote('player', '...');
  await s.line('intro.kit.1');
  s.face('rook', 'left');
  await s.line('intro.rook.2');
  await s.emote('player', '!');
  await s.line('intro.kit.2');
  await s.line('intro.rook.3');
  await s.line('intro.kit.3');
  await s.line('intro.narrate.1');
  await s.line('intro.kit.4');
  await s.line('intro.rook.4');
  await s.move('rook', 'lld', { speed: 14 });
  s.regroup();
  s.set('intro');
  s.objective(OBJ.dutch);
  await s.tutorial('HOW TO PLAY', 'Move with {c}Arrows/WASD{/} and hold {c}Shift{/} to dash. Talk and examine with {c}Z/Enter{/}. Open the menu with {c}X/Esc{/}: items, gear, status, combos and saving.');
};

// ------------------------------------------------------------------ first fight (plaza)
export const firstFight: ScriptFn = async (s) => {
  s.spawn('punk_a', 26, 20, 'up', 'ganger');
  s.spawn('punk_b', 28, 20, 'up', 'ganger');
  await s.emote('player', '!');
  await s.line('plaza.rustfang_punk.1');
  await s.line('plaza.kit.1');
  await s.line('plaza.rook.1');
  await s.tutorial('BATTLE BASICS', 'Choose {c}Fight{/} to give each crew member an order, then everyone acts by speed. {y}Techs{/} cost TP. {y}Skills{/} have limited uses that come back when you rest. Hit weaknesses for bonus damage.');
  const r = await s.battle('f_first_fight', { canRun: false, bg: 'street' });
  s.despawn('punk_a');
  s.despawn('punk_b');
  if (r !== 'win') return;
  s.set('first_fight');
  await s.line('plaza.rook.2');
  await s.line('plaza.kit.2');
  await s.line('plaza.rook.3');
  await s.line('plaza.narrate.1');
  await s.tutorial('ROOK IS WOUNDED', 'Rook is a veteran (level 10), but he came into this job hurt: less HP, attack and speed, a charge short on each skill, and some skills locked. His {c}Status{/} page shows what it costs him. The job may yet fix him.');
};

// ------------------------------------------------------------------ the job
export const meetDutch: ScriptFn = async (s) => {
  if (s.flag('met_dutch')) {
    await s.line(s.flag('sable_joined') ? 'saint.dutch.again_sable' : 'saint.dutch.again');
    return;
  }
  await s.line('saint.dutch.1');
  await s.line('saint.dutch.2');
  await s.line('saint.narrate.1');
  await s.line('saint.pale.1');
  await s.line('saint.pale.2');
  await s.line('saint.kit.1');
  await s.line('saint.rook.1');
  await s.line('saint.rook.2');
  await s.line('saint.pale.3');
  await s.line('saint.dutch.3');
  await s.line('saint.rook.3');
  await s.line('saint.dutch.4');
  await s.give('pale_chip', 1);
  await s.line('saint.pale.4');
  await s.cred(250);
  await s.line('saint.pale.5');
  await s.line('saint.pale.6');
  await s.line('saint.kit.2');
  await s.line('saint.pale.7');
  await s.line('saint.rook.4');
  await s.line('saint.pale.8');
  await s.line('saint.narrate.2');
  await s.line('saint.dutch.5');
  s.despawn('pale');
  s.sfx('door');
  await s.wait(20);
  await s.line('saint.dutch.6');
  await s.line('saint.kit.3');
  await s.line('saint.dutch.7');
  s.set('met_dutch');
  s.objective(OBJ.hex);
};

// ------------------------------------------------------------------ Hex
export const meetHex: ScriptFn = async (s) => {
  if (s.flag('hex_joined')) return;
  if (s.flag('coprocessor')) {
    await s.line('hexden.hex.1');
    s.take('coprocessor');
    await s.line('hexden.hex.2');
    await s.deck('seat');
    s.unlock('stingray_seated');
    await s.line('hexden.narrate.1');
    await s.line('hexden.hex.3');
    await s.line('hexden.hex.4');
    await s.line('hexden.rook.1');
    await s.line('hexden.hex.5');
    s.sfx('code');
    await s.line('hexden.narrate.2');
    const tuned = s.unlock('rook_tuned');
    s.sfx('levelup');
    await s.line('hexden.tuned', { unlocked: tuned.join('{/} and {y}') });
    await s.line('hexden.hex.6');
    await s.line('hexden.hex.7');
    s.despawn('hex');
    await s.join('hex');
    s.set('hex_joined');
    await s.line('hexden.hex.8');
    await s.cred(80);
    await s.line('hexden.hex.9');
    await s.tutorial('COMBOS', 'Some abilities fuse when chosen in the {y}same round{/}. Try {c}Hex: Analyze{/} with {c}Rook: Quickdraw{/}. A {y}★{/} hint appears when a pairing will combo. Found combos are listed under {c}Combos{/} in the menu.');
    s.objective(OBJ.sinkline);
    return;
  }
  if (s.flag('met_hex')) {
    await s.line('hexden.hex.10');
    return;
  }
  await s.line('hexden.hex.11');
  await s.line('hexden.kit.1');
  await s.line('hexden.hex.12');
  await s.line('hexden.rook.2');
  await s.line('hexden.hex.13');
  await s.deck('dead');
  await s.line('hexden.kit.2');
  await s.line('hexden.hex.14');
  await s.line('hexden.rook.3');
  await s.line('hexden.hex.15');
  await s.line('hexden.rook.4');
  await s.line('hexden.hex.16');
  await s.line('hexden.hex.17');
  await s.give('detox', 2);
  s.set('met_hex');
  s.objective(OBJ.mags);
};

// ------------------------------------------------------------------ Rustyard
export const rustyardGate: ScriptFn = async (s) => {
  s.followers(true);
  await s.line('gate.mags.1');
  await s.line('gate.rustfang_punk.1');
  await s.line('gate.kit.1');
  const r = await s.battle('f_rustyard_gate', { canRun: false, bg: 'rustyard' });
  if (r !== 'win') return;
  s.despawn('gate_punk');
  await s.line('gate.rustfang_punk.2');
  await s.line('gate.mags.2');
  await s.line('gate.kit.2');
  await s.line('gate.mags.3');
  await s.line('gate.rook.1');
  await s.line('gate.mags.4');
  s.set('rustyard_gate');
  s.objective(OBJ.knuckles);
};

export const knucklesFight: ScriptFn = async (s) => {
  await s.line('knuckles.knuckles_tran.1');
  await s.line('knuckles.rook.1');
  const r = await s.battle('f_knuckles', { canRun: false, boss: true, bg: 'rustyard' });
  if (r !== 'win') return;
  s.despawn('knuckles');
  await s.line('knuckles.knuckles_tran.2');
  await s.line('knuckles.knuckles_tran.3');
  await s.line('knuckles.rook.2');
  await s.line('knuckles.kit.1');
  await s.line('knuckles.rook.3');
  s.set('knuckles');
  await s.line('knuckles.kit.2');
};

export const magsReward: ScriptFn = async (s) => {
  if (!s.flag('knuckles')) {
    await s.line('rustyard.mags.1');
    return;
  }
  if (!s.flag('coprocessor_given')) {
    await s.line('rustyard.mags.2');
    await s.give('coprocessor', 1);
    s.set('coprocessor');
    s.set('coprocessor_given');
    await s.line('rustyard.mags.3');
    if (s.flag('tribute_stash')) {
      await s.line('rustyard.kit.1');
      await s.line('rustyard.mags.4');
    }
    // A real fork: the cred now, or the camp keeps it and Mags remembers (a fifth off her stock).
    const keep = await s.choose('rustyard.mags.fork');
    if (keep === 0) await s.cred(150);
    else {
      s.set('camp_kept');
      await s.line('rustyard.mags.kept_kit');
      await s.line('rustyard.mags.kept_reply');
    }
    await s.line('rustyard.mags.7');
    s.objective(OBJ.bringChip);
    return;
  }
  const c = await s.choose('rustyard.mags.menu');
  if (c === 0) await s.shop('rustyard');
  else if (c === 1) await s.line('rustyard.mags.9');
};

// ------------------------------------------------------------------ Sinkline
export const sinklineGate: ScriptFn = async (s) => {
  if (!s.inParty('hex')) {
    await s.line('sinkline.narrate.1');
    await s.line('sinkline.rook.1');
    return;
  }
  await s.line('sinkline.hex.1');
  s.sfx('code');
  await s.wait(40);
  s.sfx('door');
  s.set('sinkline_gate');
  await s.line('sinkline.hex.2');
  s.objective(OBJ.flood);
};

export const deadCrew: ScriptFn = async (s) => {
  await s.line('crew.narrate.1');
  await s.line('crew.hex.1');
  await s.line('crew.narrate.2');
  await s.line('crew.kit.1');
  await s.line('crew.rook.1');
  await s.line('crew.hex.2');
  await s.line('crew.rook.2');
  await s.line('crew.rook.3');
  await s.give('trauma_patch', 2);
  await s.line('crew.narrate.3');
  await s.line('crew.hex.3');
  await s.line('crew.rook.4');
  await s.cred(90);
};

/** Pump intakes, west to east, and the order they must be opened in (lowest pressure first). */
/** Intake 1 on the track bed, 2 in the service bay, 3 in the pump station. */
const VALVES: Record<string, number> = { v1: 50, v2: 30, v3: 70 };
const INTAKE: Record<string, string> = { v1: 'Intake 1', v2: 'Intake 2', v3: 'Intake 3' };
const intake = (id: string): string => INTAKE[id] ?? id;
const VALVE_ORDER = Object.keys(VALVES).sort((a, b) => VALVES[a]! - VALVES[b]!);

export const pumpValve = (id: string): ScriptFn => async (s) => {
  const psi = VALVES[id]!;
  const opened = Number(s.get('valves') ?? 0);
  if (s.flag('floodgate') || opened >= VALVE_ORDER.length || s.flag(`valve_${id}`)) {
    await s.line('pump.open', { intake: intake(id), psi });
    return;
  }
  // A wheel found before the console: point at the console, once, without giving the order away.
  if (!s.flag('pump_seen') && !s.flag('valve_first')) {
    s.set('valve_first');
    await s.line('pump.hex.1');
  }
  const pick = await s.choose('pump.wheel', { intake: intake(id), psi });
  if (pick !== 0) return;
  if (VALVE_ORDER[opened] === id) {
    s.set(`valve_${id}`);
    s.set('valves', opened + 1);
    s.refreshMap(); // the wheel turns green, its light changes, water runs
    s.sfx('valve');
    await s.wait(50);
    if (opened + 1 < VALVE_ORDER.length) {
      await s.line('pump.grinds', { intake: intake(id) });
      return;
    }
    s.sfx('pipes_prime');
    s.shake(24, 1);
    await s.wait(40);
    await s.line('pump.narrate.1');
    await s.line('pump.hex.2');
    return;
  }
  // Out of order: a pressure kick slams the last intake you opened shut again (one step back,
  // not all three: the lesson is the order, not a re-walk of the whole level).
  s.sfx('explosion');
  s.shake(30, 3);
  const last = opened > 0 ? VALVE_ORDER[opened - 1]! : null;
  if (last) {
    s.set(`valve_${last}`, false);
    s.set('valves', opened - 1);
    s.refreshMap();
  }
  if (last) await s.line('pump.bang_spins', { intake: intake(last) });
  else await s.line('pump.bang_stuck');
  if (!s.flag('valve_hint')) {
    s.set('valve_hint');
    await s.line(s.flag('pump_seen') ? 'pump.hex.order_seen' : 'pump.hex.order_unseen');
  }
};

export const floodgate: ScriptFn = async (s) => {
  if (s.flag('floodgate')) {
    await s.line('floodgate.narrate.1');
    return;
  }
  if (Number(s.get('valves') ?? 0) < VALVE_ORDER.length) {
    await s.line('floodgate.narrate.2');
    if (!s.flag('pump_seen')) {
      s.set('pump_seen');
      await s.line('floodgate.hex.1');
    }
    return;
  }
  await s.line('floodgate.hex.2');
  await s.line('floodgate.kit.1');
  await s.line('floodgate.hex.3');
  s.sfx('code');
  await s.wait(20);
  s.sfx('pumps');
  s.shake(90, 2);
  await s.wait(50);
  await s.fadeOut(40, '#07060d');
  s.set('floodgate');
  s.refreshMap();
  // Show the payoff where it happens: cut to the junction, drained, the catwalk standing clear.
  await s.pan(37, 16, 1);
  await s.fadeIn(40);
  s.sfx('wave');
  await s.line('floodgate.narrate.3');
  await s.fadeOut(20, '#07060d');
  await s.panBack(1);
  await s.fadeIn(20);
  s.objective(OBJ.cross);
};

export const lurkerFight: ScriptFn = async (s) => {
  s.shake(40, 3);
  await s.wait(20);
  await s.emote('player', '!!');
  await s.line('lurker.kit.1');
  await s.line('lurker.hex.1');
  const r = await s.battle('f_lurker', { canRun: false, boss: true, bg: 'junction' });
  if (r !== 'win') return;
  s.set('lurker');
  await s.line('lurker.rook.1');
  await s.line('lurker.kit.2');
  await s.line('lurker.hex.2');
  s.objective(OBJ.deeper);
};

// ------------------------------------------------------------------ Annex 7
export const annexDoor: ScriptFn = async (s) => {
  if (s.flag('annex_key')) return;
  await s.line('annexdoor.narrate.1');
  await s.line('annexdoor.hex.1');
};

export const annexGuards: ScriptFn = async (s) => {
  await s.line('guards.k_m_sentinel.1');
  await s.line('guards.kit.1');
  const r = await s.battle('f_annex_door', { canRun: false, bg: 'lab' });
  if (r !== 'win') return;
  s.despawn('sentinel_a');
  s.despawn('sentinel_b');
  await s.line('guards.narrate.1');
  await s.give('annex_key', 1);
  s.set('annex_key');
  await s.line('guards.hex.1');
  await s.line('guards.hex.2');
  await s.line('guards.rook.1');
  await s.line('guards.hex.3');
  s.objective(OBJ.core);
};

/**
 * The laser lattice sealing the cryo wing has three emitters, fed by three relays. Relay A
 * feeds emitters 1+2, C feeds 2+3, B is wired to all three. Every relay toggles what it feeds;
 * the lattice drops when all three are dark. (From all-on, the only answer is B alone.)
 */
export const RELAYS: Record<string, number[]> = { a: [0, 1], b: [0, 1, 2], c: [1, 2] };
/**
 * Each relay's cable colour: on its terminal's screen, and on the loom that runs into the lattice's
 * frame, tapping the emitters it really feeds. The memo is wrong; the cables aren't.
 */
export const RELAY_COLOR: Record<string, { hex: string; name: string }> = {
  a: { hex: '#ffcc3d', name: 'amber' },
  b: { hex: '#62e06a', name: 'green' },
  c: { hex: '#b07cff', name: 'violet' },
};

/** Which emitters are live, from the relay flags. Shared with the map, which draws each beam row. */
export function latticeEmitters(flags: Record<string, unknown>): boolean[] {
  const on = [true, true, true];
  for (const [r, feeds] of Object.entries(RELAYS)) if (flags[`relay_${r}`]) for (const i of feeds) on[i] = !on[i];
  return on;
}

function emitters(s: ScriptApi): boolean[] {
  return latticeEmitters({ relay_a: s.flag('relay_a'), relay_b: s.flag('relay_b'), relay_c: s.flag('relay_c') });
}

const emitterLine = (on: boolean[]) => on.map((e, i) => `${i + 1} ${e ? '{r}LIVE{/}' : '{g}DARK{/}'}`).join('  ·  ');

export const lattice: ScriptFn = async (s) => {
  if (s.flag('lattice_off')) return;
  await s.line('lattice.look', { emitters: emitterLine(emitters(s)) });
  if (!s.flag('lattice_seen')) {
    s.set('lattice_seen');
    await s.line('lattice.hex.1');
  }
};

export const relay = (id: string): ScriptFn => async (s) => {
  const name = `Relay ${id.toUpperCase()} (${RELAY_COLOR[id]?.name ?? 'unmarked'} cable)`;
  if (s.flag('lattice_off')) {
    await s.line('relay.down', { relay: name });
    return;
  }
  if (!s.flag('relay_seen')) {
    s.set('relay_seen');
    await s.line('relay.hex.1');
  }
  const pick = await s.choose('relay.cycle', { relay: name, emitters: emitterLine(emitters(s)) });
  if (pick !== 0) return;
  s.set(`relay_${id}`, !s.flag(`relay_${id}`));
  s.sfx('code');
  s.refreshMap(); // the beams down the hall change as the relay flips
  const on = emitters(s);
  if (on.every((e) => !e)) {
    // Watch it go: the camera finds the lattice, which stutters twice and dies.
    await s.pan(30, 7, 36);
    for (let i = 0; i < 2; i++) {
      s.set('lattice_off');
      s.refreshMap();
      await s.wait(5);
      s.set('lattice_off', false);
      s.refreshMap();
      await s.wait(8);
    }
    s.set('lattice_off');
    s.sfx('phase');
    s.shake(10, 1);
    s.refreshMap();
    await s.wait(24);
    await s.line('relay.narrate.1');
    await s.panBack(30);
    await s.line('relay.hex.2');
    return;
  }
  await s.line('relay.clunk', { emitters: emitterLine(on) });
};

export const annexLog = (title: string, body: string): ScriptFn => async (s) => {
  s.sfx('code');
  await s.narrate(`{c}${title}{/}\n${body}`);
};

export const cryopod: ScriptFn = async (s) => {
  if (s.flag('sable_joined')) return;
  await s.line('cryopod.narrate.1');
  await s.line('cryopod.hex.1');
  await s.line('cryopod.hex.2');
  await s.line('cryopod.rook.1');
  await s.line('cryopod.kit.1');
  await s.line('cryopod.rook.2');
  await s.line('cryopod.kit.2');
  await s.line('cryopod.kit.3');
  await s.line('cryopod.kit.4');
  await s.line('cryopod.rook.3');
  await s.line('cryopod.rook.4');
  await s.line('cryopod.rook.5');
  await s.line('cryopod.rook.6');
  await s.line('cryopod.kit.5');
  await s.line('cryopod.rook.7');
  await s.line('cryopod.hex.3');
  s.flash('#ffffff', 20);
  s.shake(30, 3);
  s.sfx('phase');
  await s.line('cryopod.narrate.2');
  s.music('sable');
  await s.wait(30);
  await s.line('cryopod.sable.1');
  await s.line('cryopod.sable.2');
  await s.line('cryopod.kit.6');
  await s.line('cryopod.sable.3');
  await s.line('cryopod.sable.4');
  await s.line('cryopod.rook.8');
  await s.line('cryopod.sable.5');
  await s.line('cryopod.kit.7');
  await s.line('cryopod.sable.6');
  await s.line('cryopod.sable.7');
  await s.line('cryopod.hex.4');
  await s.line('cryopod.narrate.3');
  await s.line('cryopod.hex.5');
  await s.line('cryopod.sable.8');
  await s.fadeOut(30, '#07060d');
  s.refreshMap(); // the pod, shattered and empty
  await s.wait(20);
  await s.line('cryopod.narrate.4');
  await s.line('cryopod.narrate.5');
  await s.fadeIn(30);
  await s.join('sable');
  s.set('sable_joined');
  await s.line('cryopod.sable.9');
  await s.line('cryopod.rook.9');
  await s.line('cryopod.sable.10');
  s.flash('#ffffff', 10);
  s.sfx('spirit');
  await s.line('cryopod.narrate.6');
  const mended = s.unlock('rook_mended');
  s.sfx('levelup');
  await s.line('cryopod.mended', { mended: mended.join('{/} and {y}') });
  await s.line('cryopod.rook.10');
  await s.line('cryopod.kit.8');
  s.music('tension');
  s.shake(40, 2);
  s.sfx('alert');
  await s.line('cryopod.narrate.7');
  await s.line('cryopod.hex.6');
  await s.line('cryopod.rook.11');
  await s.line('cryopod.hex.7');
  s.objective(OBJ.escape);
};

export const wardenFight: ScriptFn = async (s) => {
  await s.line('warden.narrate.1');
  await s.line('warden.sable.1');
  await s.line('warden.rook.1');
  const r = await s.battle('f_warden', { canRun: false, boss: true, bg: 'core' });
  if (r !== 'win') return;
  s.set('warden');
  s.music('sable');
  await s.line('warden.narrate.2');
  await s.line('warden.sable.2');
  await s.line('warden.rook.2');
  await s.line('warden.sable.3');
  await s.line('warden.sable.4');
  await s.line('warden.rook.3');
  await s.line('warden.hex.1');
};

// ------------------------------------------------------------------ Betrayal & end
export const betrayal: ScriptFn = async (s) => {
  // Wired to both the dock's onEnter and talking to Pale: it must only ever play once.
  if (s.flag('betrayal')) return;
  s.set('betrayal');
  s.music('tension');
  await s.wait(20);
  await s.line('betrayal.narrate.1');
  await s.line('betrayal.pale.1');
  await s.line('betrayal.kit.1');
  await s.line('betrayal.pale.2');
  await s.line('betrayal.pale.3');
  await s.line('betrayal.rook.1');
  await s.line('betrayal.pale.4');
  await s.line('betrayal.pale.5');
  await s.line('betrayal.narrate.2');
  await s.line('betrayal.pale.6');
  await s.line('betrayal.pale.7');
  await s.line('betrayal.narrate.3');
  s.sfx('alert');
  await s.line('betrayal.k_m_sentinel.1');
  // The struggle: Kit acts before Rook's plan does. Either way the dock is lost; how she loses it is hers.
  const act = await s.choose('betrayal.act');
  if (act === 0) {
    s.sfx('punch');
    s.shake(12, 3);
    await s.line('betrayal.narrate.5');
    await s.line('betrayal.pale.8');
  } else {
    s.sfx('buff');
    await s.line('betrayal.narrate.6');
    await s.line('betrayal.pale.9');
  }
  await s.line('betrayal.rook.2');
  await s.line('betrayal.narrate.7');
  await s.line('betrayal.kit.2');
  await s.line('betrayal.rook.3');
  s.flash('#ffffff', 30);
  s.sfx('explosion');
  s.shake(40, 4);
  await s.fadeOut(30, '#ffffff');
  await s.endChapter();
};

export const PANEL_SCRIPTS: Record<string, ScriptFn> = {};
export type { ScriptApi };
