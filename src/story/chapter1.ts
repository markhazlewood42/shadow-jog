/**
 * Chapter 1 — "Milk Run". Story beats as field scripts.
 * Flags: intro, first_fight, met_dutch, met_hex, rustyard_gate, knuckles, coprocessor, hex_joined,
 * sinkline_gate, floodgate, lurker, annex_key, sable_joined, warden, chapter_end.
 */
import type { ScriptApi, ScriptFn } from '../game/script';

export const OBJ = {
  dutch: 'Meet Dutch at the Drowned Saint (north side of the street).',
  hex: 'Find Hex. She lives above Chrome+Circuit, by the canal.',
  mags: 'Get the coprocessor from Old Mags in the Rustyard, east of Lantern Row.',
  knuckles: 'Take the coprocessor back from Knuckles’ hideout, north end of the Rustyard.',
  bringChip: 'Bring the coprocessor to Hex in Lantern Row.',
  sinkline: 'Enter the Sinkline. The station is south of Lantern Row, over the canal.',
  flood: 'Find a way across the flooded junction.',
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
  await s.say('rook', 'Up. Dutch called.');
  s.face('player', 'right');
  await s.emote('player', '...');
  await s.say('kit', 'Dutch calls every day. Dutch calls to tell us the rent is late.', { face: 'smirk' });
  s.face('rook', 'left');
  await s.say('rook', 'Dutch called with work.');
  await s.emote('player', '!');
  await s.say('kit', 'Real work? Like, paying work? Not "hold this bag and don’t look inside" work?', { face: 'surprised' });
  await s.say('rook', 'The Drowned Saint. Ten minutes. And eat something first. Nobody punches well on an empty stomach.');
  await s.say('kit', 'Hungry’s fine. Hungry’s how I win.', { face: 'happy' });
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
  await s.say('Rustfang Punk', 'Well, well. Rook’s little stray. Nice jacket. Bet it looks better on me.');
  await s.say('kit', 'Bet it looks better on you when you’re not face down in a puddle.', { face: 'smirk' });
  await s.say('rook', 'Two Rustfangs. Try not to show off.');
  await s.tutorial('BATTLE BASICS', 'Choose {c}Fight{/} to give each crew member an order, then everyone acts by speed. {y}Techs{/} cost TP. {y}Skills{/} have limited uses that come back when you rest. Hit weaknesses for bonus damage.');
  const r = await s.battle('f_first_fight', { canRun: false, bg: 'street' });
  s.despawn('punk_a');
  s.despawn('punk_b');
  if (r !== 'win') return;
  s.set('first_fight');
  await s.say('rook', 'Sloppy. You dropped your guard twice.');
  await s.say('kit', 'I won, didn’t I?', { face: 'happy' });
  await s.say('rook', 'You beat Rustfangs. That’s like beating the weather. Come on.');
};

// ------------------------------------------------------------------ the job
export const meetDutch: ScriptFn = async (s) => {
  if (s.flag('met_dutch')) {
    await s.say('dutch', s.flag('sable_joined') ? 'Whoever that is with you, darlin’, I never saw them. I never saw any of you.' : 'The meter’s running on Mr. Pale’s patience. Go find your decker.');
    return;
  }
  await s.say('dutch', 'There they are. My favorite disaster and his apprentice. Sit, sit. Mind the stain, it’s load-bearing.', { face: 'happy' });
  await s.say('dutch', 'This is Mr. Pale. He represents, let’s say, an interested party.');
  await s.narrate('Mr. Pale sets a brass wind-up watch face-up on the table. No chip, no signal. Nothing in the bar can read it but him.');
  await s.say('pale', 'A pleasure. I’ll be brief; I bill by the minute. Under the flooded Sinkline there is a sealed research annex. Kessler-Mori wrote it off after the flood of ’61.');
  await s.say('pale', 'Inside is a {y}data core{/}. Bring it to me intact and you will be paid {y}three thousand cred{/}.');
  await s.say('kit', 'Three thou—', { face: 'surprised' });
  await s.say('rook', 'Kit.');
  await s.say('rook', 'A written-off annex. A milk run. You could send anybody. Why us?');
  await s.say('pale', 'Because "anybody" asks more questions. Also, the annex doors are still corporate-locked. You will need a decker.', { face: 'smirk' });
  await s.say('dutch', 'Which you haven’t got, since your last one moved to Neo-Lagos and stopped taking my calls.');
  await s.say('rook', '...Hex.');
  await s.say('dutch', 'Hex! Hex owes me money. Two birds, one run. Tell her if she does this, her tab goes in the canal.', { face: 'happy' });
  await s.give('pale_chip', 1);
  await s.say('pale', 'Expenses. I will not be asking for receipts.');
  await s.cred(250);
  await s.say('pale', 'Loading Dock 7, when you have it. I keep very exact hours.');
  await s.say('pale', 'Miss Kit. The two Rustfangs outside. I watched from the window.', { face: 'smirk' });
  await s.say('pale', 'Nine seconds, no weapon, no chrome in those hands. Nothing on your breath but noodles.');
  await s.say('kit', 'So?', { face: 'angry' });
  await s.say('pale', 'So nothing. I collect numbers. That one is unusual.');
  await s.say('rook', 'She’s not part of the price.');
  await s.say('pale', 'Everything is part of the price, Mr. Rook. Most things just haven’t been told yet.');
  await s.narrate('He winds the watch twice, pockets it, and is gone before the door finishes swinging.');
  s.despawn('pale');
  s.sfx('door');
  await s.wait(20);
  await s.say('dutch', 'Word of advice? Get paid before you get proud.');
  await s.say('kit', 'Why would I lick—', { face: 'angry' });
  await s.say('dutch', 'People do things, darlin’. Oh, and if you need pocket money, the {c}job board{/} by the door always has something.');
  s.set('met_dutch');
  s.objective(OBJ.hex);
};

// ------------------------------------------------------------------ Hex
export const meetHex: ScriptFn = async (s) => {
  if (s.flag('hex_joined')) return;
  if (s.flag('coprocessor')) {
    await s.say('hex', 'Is that— is that a Stingray? Don’t drop it. Please don’t drop it. Slowly. Give it here slowly.', { face: 'surprised' });
    s.take('coprocessor');
    await s.fadeOut(30);
    s.sfx('code');
    await s.wait(50);
    await s.fadeIn(30);
    await s.say('hex', 'Aaand she lives. Hi, baby. Did you miss me? You missed me.', { face: 'happy' });
    await s.say('hex', 'Okay. A deal’s a deal. I’m going to regret this. I’m already regretting it. Let’s go rob a haunted subway.');
    s.despawn('hex');
    await s.join('hex');
    s.set('hex_joined');
    await s.say('hex', 'Also, my emergency fund. It’s mostly been emergencies.');
    await s.cred(80);
    await s.say('hex', 'One more thing. I run a scanner, {c}Analyze{/}. Feed its target data into Rook’s smartgun and he literally cannot miss. I call it {y}Target Lock{/}. Patent pending.');
    await s.tutorial('COMBOS', 'Some abilities fuse when chosen in the {y}same round{/}. Try {c}Hex: Analyze{/} with {c}Rook: Quickdraw{/}. A {y}★{/} hint appears when a pairing will combo. Found combos are listed under {c}Combos{/} in the menu.');
    s.objective(OBJ.sinkline);
    return;
  }
  if (s.flag('met_hex')) {
    await s.say('hex', 'Rustyard. Old Mags. Stingray, the one with the little fin logo. I’ll be here. Checking the door locks. Twice.');
    return;
  }
  await s.say('hex', 'I didn’t do it. Whatever it is. Oh— it’s you. Hi, Rook. Hi, Rook’s kid.', { face: 'surprised' });
  await s.say('kit', 'Kit. My name’s been Kit for nineteen years.', { face: 'angry' });
  await s.say('hex', 'Right. Knew that. Hi, Kit.');
  await s.say('rook', 'We have a job. Corporate doors, down in the Sinkline.');
  await s.say('hex', 'No. Absolutely not. Also I can’t, because my deck is dead. I fried the coprocessor pulling an all-nighter on a, um, hobby. Look at her. She’s crying.', { face: 'sad' });
  await s.say('kit', 'So buy a new one.');
  await s.say('hex', 'With what cred? The cred I owe Dutch? A Stingray coprocessor costs more than this building. Which I also owe money on.');
  await s.say('rook', 'Dutch will forget your debt.');
  await s.say('hex', '...How much of it?', { face: 'smirk' });
  await s.say('rook', 'Some.');
  await s.say('hex', 'Some is a number. I can work with a number. There’s a scavver in the Rustyard, {y}Old Mags{/}. She had a Stingray last month. Rustyard’s east, past the Barrens. Get me that chip and I’m your decker. Your professional, sober decker.');
  await s.say('hex', 'The Barrens are nasty. Here, I can spare these.', { face: 'happy' });
  await s.give('detox', 2);
  s.set('met_hex');
  s.objective(OBJ.mags);
};

// ------------------------------------------------------------------ Rustyard
export const rustyardGate: ScriptFn = async (s) => {
  s.followers(true);
  await s.say('mags', 'Off my lot. Forty years I’ve held this yard against worse than you, and I’m still counting.', { face: 'angry' });
  await s.say('Rustfang Punk', 'Knuckles says this yard pays tribute now, grandma. Hounds! Fetch.');
  await s.say('kit', 'Hey! Grandma says no.', { face: 'angry' });
  const r = await s.battle('f_rustyard_gate', { canRun: false, bg: 'rustyard' });
  if (r !== 'win') return;
  s.despawn('gate_punk');
  await s.say('Rustfang Punk', 'Knuckles is gonna hear about this! He’s gonna feed you to the hounds!');
  await s.say('mags', 'Hmph. Didn’t need help. Didn’t mind it, either. What do you want?', { face: 'smirk' });
  await s.say('kit', 'A Stingray coprocessor. For Hex.');
  await s.say('mags', 'Ha! Had one. Knuckles’ boys took it, along with half my stock. Hauled it all up to the old {y}tire depot{/} at the north end of the yard.');
  await s.say('rook', 'Then we’ll get it back.');
  await s.say('mags', 'You do that and the chip’s yours. Plus a discount at my counter. Deal’s a deal.', { face: 'happy' });
  s.set('rustyard_gate');
  s.objective(OBJ.knuckles);
};

export const knucklesFight: ScriptFn = async (s) => {
  await s.say('"Knuckles" Tran', 'So these are the heroes. Know what I do to heroes? I charge ’em rent.');
  await s.say('rook', 'We’ll pay you in teeth.');
  const r = await s.battle('f_knuckles', { canRun: false, boss: true, bg: 'rustyard' });
  if (r !== 'win') return;
  s.despawn('knuckles');
  await s.say('"Knuckles" Tran', 'Ugh... fine... take your junk... I’m moving to Neo-Lagos...');
  s.set('knuckles');
  await s.say('kit', 'The crate. Mags’ stuff should be in there.', { face: 'happy' });
};

export const magsReward: ScriptFn = async (s) => {
  if (!s.flag('knuckles')) {
    await s.say('mags', 'Tire depot, north end. Knuckles is the big one with the chrome hands. Can’t miss him. Wish I could.');
    return;
  }
  if (!s.flag('coprocessor_given')) {
    await s.say('mags', 'Well, well. Knuckles is limping all the way to Neo-Lagos, I hear. Here. As promised.', { face: 'happy' });
    await s.give('coprocessor', 1);
    s.set('coprocessor');
    s.set('coprocessor_given');
    await s.say('mags', 'And this. The camp took up a collection for whoever ran Knuckles off. Don’t argue with me, I’m old.');
    await s.cred(150);
    await s.say('mags', 'And tell Hex she still owes me for the last one.');
    s.objective(OBJ.bringChip);
    return;
  }
  const c = await s.ask('mags', 'Shopping? The crew that ran Knuckles off my lot gets fair prices. For once.', ['Shop', 'Talk', 'Leave'], { cancel: 2 });
  if (c === 0) await s.shop('rustyard');
  else if (c === 1) await s.say('mags', 'The Sinkline? Flooded in ’61, whole trains still down there. Things live in the water now. Big things. Bring fire. Or a bigger thing.');
};

// ------------------------------------------------------------------ Sinkline
export const sinklineGate: ScriptFn = async (s) => {
  if (!s.inParty('hex')) {
    await s.narrate('A transit-authority service gate. The lock panel blinks {r}LOCKED{/}: corporate encryption.');
    await s.say('rook', 'This is what the decker’s for.');
    return;
  }
  await s.say('hex', 'Transit authority lock with Kessler-Mori wrapping. Cute. Give me a second.');
  s.sfx('code');
  await s.wait(40);
  s.sfx('door');
  s.set('sinkline_gate');
  await s.say('hex', 'Done. Welcome to the Sinkline. Mind the gap. Mind the ghosts. Mind the everything.', { face: 'happy' });
  s.objective(OBJ.flood);
};

export const deadCrew: ScriptFn = async (s) => {
  await s.narrate('Three bodies in expensive gear, slumped against the platform. Whatever got them wasn’t a ghoul. Their wounds are cauterized.');
  await s.say('hex', 'That’s the {c}Glass Wolves{/}. Runners out of Harbor Ward. Good ones.', { face: 'sad' });
  await s.narrate('One of them clutches a data slate. The last message reads: {c}"Pale says it’s a milk run. In and out."{/}');
  await s.say('kit', 'Pale. As in, our Mr. Pale?', { face: 'surprised' });
  await s.say('rook', 'Same job. Different crew. Before us.');
  await s.say('rook', 'Eyes open.');
  await s.give('trauma_patch', 2);
};

/** Pump intakes, west to east, and the order they must be opened in (lowest pressure first). */
/** Intake 1 on the track bed, 2 in the service bay, 3 in the pump station. */
const VALVES: Record<string, number> = { v1: 50, v2: 30, v3: 70 };
const INTAKE: Record<string, string> = { v1: 'Intake 1', v2: 'Intake 2', v3: 'Intake 3' };
const VALVE_ORDER = Object.keys(VALVES).sort((a, b) => VALVES[a]! - VALVES[b]!);

export const pumpValve = (id: string): ScriptFn => async (s) => {
  const psi = VALVES[id]!;
  const opened = Number(s.get('valves') ?? 0);
  if (s.flag('floodgate') || opened >= VALVE_ORDER.length || s.flag(`valve_${id}`)) {
    await s.narrate(`${INTAKE[id]}, open. The gauge sits steady at {c}${psi} psi{/}.`);
    return;
  }
  const pick = await s.ask(null, `${INTAKE[id]}: a rusted valve wheel. Its gauge reads {c}${psi} psi{/}.`, ['Open it', 'Leave it'], { cancel: 1 });
  if (pick !== 0) return;
  if (VALVE_ORDER[opened] === id) {
    s.set(`valve_${id}`);
    s.set('valves', opened + 1);
    s.sfx('wave');
    if (opened + 1 < VALVE_ORDER.length) {
      await s.narrate(`The wheel grinds round. Water hisses into ${INTAKE[id]}, and somewhere across the level a pipe knocks in answer.`);
      return;
    }
    await s.narrate('The last wheel turns. Every pipe in the room drums once, then settles into a low, even hum.');
    await s.say('hex', 'Pressure’s balanced and the pumps are primed. Now the console in the pump room.', { face: 'happy' });
    return;
  }
  // Out of order: a pressure kick slams every valve shut.
  s.sfx('explosion');
  s.shake(30, 3);
  for (const v of VALVE_ORDER) s.set(`valve_${v}`, false);
  s.set('valves', 0);
  await s.narrate('{r}BANG.{/} A pressure kick hammers down the line and every valve slams shut.');
  if (!s.flag('valve_hint')) {
    s.set('valve_hint');
    await s.say('hex', 'Okay. Order matters. Lowest pressure first, and that means reading all three gauges before we touch anything. I did say that. Out loud.', { face: 'sad' });
  }
};

export const floodgate: ScriptFn = async (s) => {
  if (s.flag('floodgate')) {
    await s.narrate('The pump console hums. Water levels: {g}NOMINAL{/}.');
    return;
  }
  if (Number(s.get('valves') ?? 0) < VALVE_ORDER.length) {
    await s.narrate('The pump console flickers awake: {r}INTAKES DRY.{/} {c}PRIME: OPEN INTAKES 1–3, LOWEST PRESSURE FIRST.{/}\nIntake 1: platform track bed · Intake 2: service bay · Intake 3: this station.');
    if (!s.flag('pump_seen')) {
      s.set('pump_seen');
      await s.say('hex', 'Three intakes, all over the level. We read every gauge first. Then we open them lowest to highest. Nobody touches a wheel before that. Please.');
    }
    return;
  }
  await s.say('hex', 'Pump control. Still got power, somehow. If I spin up the drainage pumps, the junction should empty out.');
  await s.say('kit', 'And whatever lives in the junction?', { face: 'sad' });
  await s.say('hex', 'Will be a lot easier to see coming. Best I can do from a pump console.');
  s.sfx('code');
  s.shake(60, 2);
  await s.wait(30);
  s.sfx('wave');
  await s.fadeOut(40, '#07060d');
  s.set('floodgate');
  s.refreshMap();
  // Show the payoff where it happens: cut to the junction, drained, the catwalk standing clear.
  await s.pan(37, 16, 1);
  await s.fadeIn(40);
  s.sfx('wave');
  await s.narrate('Across the level, pumps groan to life. The black water in the junction falls away, and a catwalk rises out of it.');
  await s.fadeOut(20, '#07060d');
  await s.panBack(1);
  await s.fadeIn(20);
  s.objective(OBJ.flood);
};

export const lurkerFight: ScriptFn = async (s) => {
  s.shake(40, 3);
  await s.wait(20);
  await s.emote('player', '!!');
  await s.say('kit', 'The water— it’s moving on its own.', { face: 'surprised' });
  await s.say('hex', 'That is not water. That is a LOT of teeth.', { face: 'surprised' });
  const r = await s.battle('f_lurker', { canRun: false, boss: true, bg: 'junction' });
  if (r !== 'win') return;
  s.set('lurker');
  await s.say('rook', 'Everyone breathing?');
  await s.say('kit', 'Breathing. Mostly screaming internally.', { face: 'happy' });
  await s.say('hex', 'Maintenance shaft past the junction goes down. The annex should be under us.');
  s.objective(OBJ.deeper);
};

// ------------------------------------------------------------------ Annex 7
export const annexDoor: ScriptFn = async (s) => {
  if (s.flag('annex_key')) return;
  await s.narrate('A pressure door marked {c}K-M ANNEX 7 · AUTHORIZED PERSONNEL{/}. The lock wants a physical passkey.');
  await s.say('hex', 'Hardware key. I can’t crack a chunk of plastic. Somebody down here has one.');
};

export const annexGuards: ScriptFn = async (s) => {
  await s.say('K-M Sentinel', 'Contact! Unauthorized personnel in Annex 7! Lethal response authorized!');
  await s.say('kit', 'Written off, huh?', { face: 'angry' });
  const r = await s.battle('f_annex_door', { canRun: false, bg: 'lab' });
  if (r !== 'win') return;
  s.despawn('sentinel_a');
  s.despawn('sentinel_b');
  await s.narrate('One of the Sentinels wears a passkey on a lanyard. Hex lifts it off him with two fingers.');
  await s.give('annex_key', 1);
  s.set('annex_key');
  await s.say('hex', 'One chunk of plastic, acquired. Told you somebody down here had one.');
  await s.say('hex', 'Huh. The door log has us in it. “Contractor team, due the 14th. Status: pending resolution.” That’s a weird word for a door to use.');
  await s.say('rook', 'Active security in an abandoned lab. Pale lied.');
  await s.say('hex', 'Pale lied, the lab lied, the lights are lying. I read systems for a living, and nothing down here will tell me the truth.', { face: 'sad' });
  s.objective(OBJ.core);
};

/**
 * The laser lattice sealing the cryo wing has three emitters, fed by three relays. Relay A
 * feeds emitters 1+2, C feeds 2+3, B is wired to all three. Every relay toggles what it feeds;
 * the lattice drops when all three are dark. (From all-on, the only answer is B alone.)
 */
const RELAYS: Record<string, number[]> = { a: [0, 1], b: [0, 1, 2], c: [1, 2] };

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
  await s.narrate(`A security lattice: three emitters, beams humming across the passage.\nEmitters: ${emitterLine(emitters(s))}`);
  if (!s.flag('lattice_seen')) {
    s.set('lattice_seen');
    await s.say('hex', 'Can’t hack a laser. But lasers need power, and power comes through relays. Find the relays.');
  }
};

export const relay = (id: string): ScriptFn => async (s) => {
  const name = `Relay ${id.toUpperCase()}`;
  if (s.flag('lattice_off')) {
    await s.narrate(`${name}. The lattice is down; nothing left to route.`);
    return;
  }
  if (!s.flag('relay_seen')) {
    s.set('relay_seen');
    await s.say('hex', 'Security relay. I can cycle it, but I can’t see what it feeds from here. Only one way to find out.');
  }
  const pick = await s.ask(null, `${name}. Lattice emitters: ${emitterLine(emitters(s))}`, ['Cycle the relay', 'Leave it'], { cancel: 1 });
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
    await s.narrate('Down the hall, the laser lattice stutters, flickers, and dies.');
    await s.panBack(30);
    await s.say('hex', 'Lattice is down! Turns out I can lie to a lab too.', { face: 'happy' });
    return;
  }
  await s.narrate(`The relay clunks over. Lattice emitters: ${emitterLine(on)}`);
};

export const annexLog = (title: string, body: string): ScriptFn => async (s) => {
  s.sfx('code');
  await s.narrate(`{c}${title}{/}\n${body}`);
};

export const cryopod: ScriptFn = async (s) => {
  if (s.flag('sable_joined')) return;
  await s.narrate('A cryopod, humming, lit from within. Frost on the glass. Behind it, a figure: an orc, bone-white hair, eyes closed.');
  await s.say('hex', 'Label reads {c}ASSET S-7 · "VESSEL" · ESSENCE YIELD 94%{/}. Oh no. Oh no no no.', { face: 'sad' });
  await s.say('hex', 'This is the data core. It’s not data. It’s a person.', { face: 'sad' });
  await s.say('rook', '...');
  await s.say('kit', 'We’re getting them out.', { face: 'angry' });
  await s.say('rook', 'Kit. Three thousand cred, the rent, Hex’s debt—');
  await s.say('kit', 'Nine seconds. Pale timed me in the street and wrote it down.', { face: 'sad' });
  await s.say('kit', 'That’s how you end up in there, Rook. Somebody likes your numbers.');
  await s.say('kit', 'We’re getting them OUT.', { face: 'angry' });
  await s.say('rook', '...');
  await s.say('rook', 'Twenty years ago I stood in a lab like this. Different logo. My crew got paid, and I walked out past a tank with somebody still in it.');
  await s.say('rook', 'I told myself it wasn’t my job. I’ve been telling myself that every night since.');
  await s.say('rook', 'Do it, kid. Whatever it costs.');
  s.flash('#ffffff', 20);
  s.shake(30, 3);
  s.sfx('phase');
  await s.narrate('Kit’s hand touches the glass, and something in her answers. Ki surges up through her arm like a struck match. Frost blooms, cracks, and shatters.');
  s.music('sable');
  await s.wait(30);
  await s.say('sable', '...The crow was screaming. For so long. Now it’s quiet.', { face: 'sad' });
  await s.say('sable', 'You. Your hands are burning.');
  await s.say('kit', 'Started last month. I don’t know why.', { face: 'surprised' });
  await s.say('sable', 'Mm. The crow says you’re loud. That’s not an insult.');
  await s.say('sable', 'I am Sable. I don’t know how long I was in there. They took— they took a lot. I still have enough.');
  await s.say('rook', 'We’ll get you out of here. After that you owe us nothing.');
  await s.say('sable', 'Everyone who opened this glass said something kind. The crow remembers each of them.', { face: 'sad' });
  await s.say('kit', 'We’re not them.', { face: 'angry' });
  await s.say('sable', 'No. None of them burned.');
  await s.fadeOut(30, '#07060d');
  s.refreshMap(); // the pod, shattered and empty
  await s.wait(20);
  await s.narrate('Hex puts her jacket round Sable’s shoulders. Rook watches the door. Nobody says anything about three thousand cred.');
  await s.fadeIn(30);
  await s.join('sable');
  s.set('sable_joined');
  s.music('tension');
  s.shake(40, 2);
  s.sfx('alert');
  await s.narrate('{r}ALERT. ASSET S-7 CONTAINMENT BREACH. WARDEN PROTOCOL ENGAGED.{/}');
  await s.say('hex', 'WARDEN protocol. That sounds big. Things named "Warden" are always big.', { face: 'surprised' });
  await s.say('rook', 'Freight lift. South, through the containment door. Move.');
  await s.say('hex', 'One stop first: that armory by the hall had weapon cases. Whatever WARDEN is, I want to meet it holding something better.');
  s.objective(OBJ.escape);
};

export const wardenFight: ScriptFn = async (s) => {
  await s.narrate('The floor shudders. A security platform unfolds from the wall, three meters of plate and cannon. Something inside its chest glows and screams.');
  await s.say('sable', 'There’s a spirit in its heart. Bound. Starving. It was one of us once.', { face: 'angry' });
  await s.say('rook', 'Then we set it free. Crew, on me.');
  const r = await s.battle('f_warden', { canRun: false, boss: true, bg: 'core' });
  if (r !== 'win') return;
  s.set('warden');
  s.music('sable');
  await s.narrate('The spirit rises from the wreck, no longer screaming. It circles Sable once, like a bird, and fades into the pipes.');
  await s.say('sable', 'It thanked you. It said its name. I won’t repeat it; it was only for us.');
  await s.say('rook', 'Not this time. That’s all I wanted.');
  await s.say('sable', 'The crow has gone up the lift shaft ahead of us. It sees farther than I can.');
  await s.say('sable', 'Cars at the top. People waiting in the rain.');
  await s.say('rook', 'Pale’s pickup. He did say he keeps exact hours.');
  await s.say('hex', 'The lift’s live. Let’s never come back here.', { face: 'happy' });
};

// ------------------------------------------------------------------ Betrayal & end
export const betrayal: ScriptFn = async (s) => {
  // Wired to both the dock's onEnter and talking to Pale: it must only ever play once.
  if (s.flag('betrayal')) return;
  s.set('betrayal');
  s.music('tension');
  await s.wait(20);
  await s.narrate('Mr. Pale is waiting under the cranes, the brass watch open in his palm.');
  await s.say('pale', 'Three minutes early. I do appreciate punctuality in a liability. And my property, in better shape than I dared hope.', { face: 'smirk' });
  await s.say('kit', 'Your "property" is a person.', { face: 'angry' });
  await s.say('pale', 'Asset S-7 is Kessler-Mori property, recovered from a site we officially abandoned, by deniable contractors.');
  await s.say('pale', 'You were the deniable contractors.');
  await s.say('rook', 'And the three thousand?');
  await s.say('pale', 'A figure of speech.');
  await s.say('pale', 'Nine seconds, Miss Kit. I have thought about those nine seconds all night.', { face: 'smirk' });
  await s.say('pale', 'You came in as a contractor. You are leaving as a line item.');
  await s.say('pale', 'Except you, Miss Kit. The Vessel program is always short of subjects, and you have never once been measured.');
  await s.narrate('The watch snaps shut.');
  s.sfx('alert');
  await s.say('K-M Sentinel', 'Targets confirmed. Weapons free on your word, sir.');
  await s.say('rook', 'Kit. When I say run, you run. You don’t look back, you don’t wait for me.');
  await s.say('kit', 'Rook—', { face: 'sad' });
  await s.say('rook', 'Run.');
  s.flash('#ffffff', 30);
  s.sfx('explosion');
  s.shake(40, 4);
  await s.fadeOut(30, '#ffffff');
  await s.endChapter();
};

export const PANEL_SCRIPTS: Record<string, ScriptFn> = {};
export type { ScriptApi };
