/**
 * Music sequencer with a tiny composition DSL.
 *
 * A song = chord progression + hand-written melody lines + generated parts (bass, arp, pad, drums).
 * Bars are separated by `|`. Each bar's tokens divide it evenly (16 tokens = 16ths, 8 = 8ths …).
 * Melody tokens: note (`A4`, `C#5`), `-` hold, `.` rest. Chord tokens: `Am7`, `F`, `C/E`, `.` = same.
 */
import { audio, midiToFreq, noteToMidi, playNote, type InstId, type Space } from './engine';
import { SONGS } from './songs';

const STEPS = 16;

export interface PartSpec {
  inst: InstId;
  vol?: number;
  rev?: number;
  del?: number;
  /** Explicit notes (melody / counter-melody). */
  notes?: string;
  /** Generated from chords. */
  gen?: string;
  octave?: number;
}

export interface SongSpec {
  bpm: number;
  swing?: number;
  chords: string;
  parts: PartSpec[];
  drums?: string;
  drumVol?: number;
  /** Bar index to loop back to (default 0). */
  loopBar?: number;
  loop?: boolean;
  /** Bars the drums sit out the first time through: the song arrives before the groove does. */
  intro?: number;
  /** Bars (0-based) where the drums rest on every pass: a breath inside the loop, so a long
   *  fight's theme surges and releases instead of sitting pinned at one level. */
  rests?: number[];
  /**
   * Loudness trim in dB, so every song sits at its intended level rather than wherever its
   * parts' volumes happened to sum (set from the offline renders: docs/quality/evidence/audio.txt;
   * targets about -21 dBFS RMS for places, -20 for fights, -22.5 for the quiet cues).
   */
  gain?: number;
  /**
   * An air bed under the song (linear level, ~0.01–0.03): filtered high noise that gives the quiet
   * cues a top end without another part.
   */
  air?: number;
  /**
   * Acoustic space the song plays in. 'here' keeps whatever room the player is already in: battle
   * music, jingles and story cues happen *in* the current place and must not re-reverb it.
   */
  space: Space | 'here';
}

interface Ev {
  inst: InstId;
  midi: number[];
  len: number;
  vel: number;
  vol: number;
  rev: number;
  del: number;
  /** Part of the generated drum kit (rests during an intro, humanised less). */
  drum?: boolean;
}

interface Compiled {
  bpm: number;
  swing: number;
  length: number;
  loopStep: number;
  loop: boolean;
  /** Steps at the top where drums rest on the first pass. */
  introSteps: number;
  /** Bars where the drums rest on every pass. */
  restBars: Set<number>;
  /** Linear loudness trim. */
  trim: number;
  steps: Ev[][];
}

// ------------------------------------------------------------------ chord parsing
const QUAL: Record<string, number[]> = {
  '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], dim: [0, 3, 6], dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10], sus2: [0, 2, 7], sus4: [0, 5, 7], add9: [0, 4, 7, 14], m9: [0, 3, 7, 10, 14], '9': [0, 4, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14], '6': [0, 4, 7, 9], m6: [0, 3, 7, 9], aug: [0, 4, 8], '5': [0, 7], madd9: [0, 3, 7, 14], mmaj7: [0, 3, 7, 11],
};

export interface Chord {
  root: number;
  tones: number[];
  bass: number;
}

function parseChord(sym: string): Chord {
  const [main, slash] = sym.split('/');
  const m = /^([A-G][#b]?)(.*)$/.exec(main!);
  if (!m) throw new Error(`Bad chord ${sym}`);
  const root = noteToMidi(`${m[1]!}3`) % 12;
  const iv = QUAL[m[2]!];
  if (!iv) throw new Error(`Unknown chord quality ${sym}`);
  const bass = slash ? noteToMidi(`${slash}3`) % 12 : root;
  return { root, tones: iv.map((i) => root + i), bass };
}

/** Split a bar-string into per-step tokens with durations. */
export function stepsOf(src: string): { tok: string; step: number; len: number }[] {
  const bars = src.split('|').map((b) => b.trim()).filter((b) => b.length);
  const out: { tok: string; step: number; len: number }[] = [];
  bars.forEach((bar, bi) => {
    const toks = bar.split(/\s+/);
    const len = STEPS / toks.length;
    toks.forEach((t, i) => {
      out.push({ tok: t, step: bi * STEPS + Math.round(i * len), len });
    });
  });
  return out;
}

/** The chord sounding on every step (exported for the harmony test). */
export function chordTimeline(src: string): { chords: (Chord | null)[]; bars: number } {
  const toks = stepsOf(src);
  const bars = src.split('|').filter((b) => b.trim().length).length;
  const chords: (Chord | null)[] = new Array(bars * STEPS).fill(null);
  let cur: Chord | null = null;
  for (const t of toks) {
    if (t.tok !== '.' && t.tok !== '-') cur = t.tok === 'N' ? null : parseChord(t.tok);
    for (let s = t.step; s < t.step + t.len; s++) chords[s] = cur;
  }
  return { chords, bars };
}

// ------------------------------------------------------------------ compile
export function compile(spec: SongSpec): Compiled {
  const { chords, bars } = chordTimeline(spec.chords);
  const length = bars * STEPS;
  const steps: Ev[][] = Array.from({ length }, () => []);
  const push = (step: number, e: Ev) => {
    if (step >= 0 && step < length) steps[step]!.push(e);
  };

  for (const part of spec.parts) {
    const base = { inst: part.inst, vol: part.vol ?? 1, rev: part.rev ?? 0.15, del: part.del ?? 0 };
    if (part.notes) {
      const toks = stepsOf(part.notes);
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i]!;
        if (t.tok === '-' || t.tok === '.') continue;
        let len = t.len;
        for (let j = i + 1; j < toks.length && toks[j]!.tok === '-'; j++) len += toks[j]!.len;
        const acc = t.tok.endsWith('!');
        const names = t.tok.replace('!', '').split('+');
        // Written accents (!) hit hardest; a note on the bar's downbeat leans in a little.
        push(t.step, { ...base, midi: names.map(noteToMidi), len, vel: acc ? 1 : t.step % STEPS === 0 ? 0.88 : 0.8 });
      }
      continue;
    }
    const oct = part.octave ?? 3;
    let counterPrev = -1;
    for (let s = 0; s < length; s++) {
      const ch = chords[s];
      if (!ch) continue;
      const bar = Math.floor(s / STEPS), pos = s % STEPS;
      const segStart = s === 0 || chords[s - 1] !== ch;
      const tone = (i: number, o = oct) => {
        const n = ch.tones.length;
        const t = ch.tones[((i % n) + n) % n]! + Math.floor(i / n) * 12;
        return t + (o + 1) * 12;
      };
      const bass = ch.bass + (oct + 1) * 12;
      switch (part.gen) {
        case 'pulse8':
          if (pos % 2 === 0) push(s, { ...base, midi: [bass], len: 1.6, vel: pos % 4 === 0 ? 1 : 0.75 });
          break;
        case 'octave':
          if (pos % 2 === 0) push(s, { ...base, midi: [bass + (pos % 4 === 2 ? 12 : 0)], len: 1.7, vel: 0.9 });
          break;
        case 'drive':
          push(s, { ...base, midi: [bass], len: 0.8, vel: pos % 4 === 0 ? 1 : 0.6 });
          break;
        case 'sync':
          if ([0, 3, 6, 8, 10, 12, 14].includes(pos)) push(s, { ...base, midi: [bass + (pos === 10 ? 12 : 0)], len: pos === 0 ? 2.5 : 1.5, vel: pos === 0 ? 1 : 0.8 });
          break;
        case 'long':
          if (segStart) {
            let len = 1;
            while (s + len < length && chords[s + len] === ch) len++;
            push(s, { ...base, midi: [bass], len, vel: 0.9 });
          }
          break;
        case 'walk': {
          if (pos % 4 !== 0) break;
          const beat = pos / 4;
          const next = chords[Math.min(length - 1, (bar + 1) * STEPS)] ?? ch;
          const walkNotes = [bass, tone(1, oct) , tone(2, oct), next.bass + (oct + 1) * 12 + (next.bass > ch.bass ? -1 : 1)];
          push(s, { ...base, midi: [walkNotes[beat]!], len: 3.5, vel: beat === 0 ? 1 : 0.75 });
          break;
        }
        case 'up16':
          push(s, { ...base, midi: [tone(pos % 8)], len: 0.9, vel: pos % 4 === 0 ? 0.9 : 0.6 });
          break;
        case 'updown': {
          const seq = [0, 1, 2, 3, 4, 3, 2, 1];
          push(s, { ...base, midi: [tone(seq[pos % 8]!)], len: 0.9, vel: pos % 4 === 0 ? 0.9 : 0.6 });
          break;
        }
        case 'up8':
          if (pos % 2 === 0) push(s, { ...base, midi: [tone((pos / 2) % 4)], len: 1.8, vel: 0.8 });
          break;
        case 'broken':
          if (pos % 2 === 0) push(s, { ...base, midi: [tone([0, 2, 4, 2, 1, 2, 4, 2][(pos / 2) % 8]!)], len: 1.8, vel: 0.75 });
          break;
        case 'chord':
          if (segStart) {
            let len = 1;
            while (s + len < length && chords[s + len] === ch) len++;
            push(s, { ...base, midi: ch.tones.map((t) => t + (oct + 1) * 12), len, vel: 0.9 });
          }
          break;
        case 'stab':
          if (pos % 4 === 2) push(s, { ...base, midi: ch.tones.slice(0, 3).map((t) => t + (oct + 1) * 12), len: 1, vel: 0.8 });
          break;
        case 'counter': {
          // A second voice: two notes a bar on the off-beats, each the chord tone nearest the
          // last one (voice-led), so it answers the melody rather than doubling it.
          if (pos !== 4 && pos !== 10) break;
          const lo = (oct + 1) * 12;
          const pool = ch.tones.flatMap((t) => [t + lo, t + lo + 12]);
          const target = counterPrev < 0 ? pool[1]! : counterPrev;
          const pick = pool.filter((m) => m !== counterPrev).sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0]!;
          counterPrev = pick;
          push(s, { ...base, midi: [pick], len: pos === 4 ? 5 : 6, vel: pos === 4 ? 0.75 : 0.65 });
          break;
        }
        case 'bells':
          if (segStart) push(s, { ...base, midi: [tone(ch.tones.length > 3 ? 3 : 2, oct)], len: 6, vel: 0.7 });
          break;
      }
    }
  }

  // Drums
  const dv = spec.drumVol ?? 1;
  const drum = (s: number, inst: InstId, vel: number) => push(s, { inst, midi: [0], len: 1, vel: vel * dv, vol: 1, rev: inst === 'snare' || inst === 'clap' ? 0.25 : 0.04, del: 0, drum: true });
  for (let s = 0; s < length; s++) {
    const pos = s % STEPS;
    const bar = Math.floor(s / STEPS);
    const lastBar = bar % 4 === 3;
    switch (spec.drums) {
      case 'synthwave':
        if (pos === 0 || pos === 8) drum(s, 'kick', 1);
        if (pos === 4 || pos === 12) drum(s, 'snare', 0.9);
        if (pos % 2 === 0) drum(s, 'hat', pos % 4 === 2 ? 0.8 : 0.4);
        if (lastBar && pos >= 12) drum(s, 'tom', 0.6);
        break;
      case 'lofi':
        if (pos === 0 || pos === 7 || pos === 10) drum(s, 'kick', pos === 0 ? 1 : 0.7);
        if (pos === 4 || pos === 12) drum(s, 'snare', 0.7);
        if (pos % 2 === 0) drum(s, 'shaker', 0.7);
        break;
      case 'battle':
        if (pos % 4 === 0 || pos === 10) drum(s, 'kick', 1);
        if (pos === 4 || pos === 12) drum(s, 'snare', 1);
        drum(s, 'hat', pos % 2 === 0 ? 0.7 : 0.35);
        if (lastBar && pos >= 12) drum(s, 'snare', 0.6);
        if (bar % 8 === 0 && pos === 0) drum(s, 'crash', 0.8);
        break;
      case 'boss':
        if (pos % 2 === 0 || pos === 7) drum(s, 'kick', pos % 4 === 0 ? 1 : 0.7);
        if (pos === 4 || pos === 12) drum(s, 'snare', 1);
        if (pos === 4 || pos === 12) drum(s, 'clap', 0.6);
        drum(s, 'hat', pos % 2 === 0 ? 0.6 : 0.3);
        if (bar % 4 === 0 && pos === 0) drum(s, 'crash', 0.9);
        break;
      case 'halftime':
        if (pos === 0 || pos === 6) drum(s, 'kick', 1);
        if (pos === 8) drum(s, 'snare', 0.9);
        if (pos % 4 === 2) drum(s, 'hat', 0.4);
        break;
      case 'march':
        if (pos === 0 || pos === 8) drum(s, 'kick', 1);
        if (pos % 4 === 0 && pos !== 0 && pos !== 8) drum(s, 'snare', 0.5);
        if (pos === 14 || pos === 15) drum(s, 'snare', 0.4);
        break;
      case 'sparse':
        if (pos === 0 && bar % 2 === 0) drum(s, 'kick', 0.8);
        if (pos === 10 && bar % 2 === 1) drum(s, 'tom', 0.5);
        if (pos % 8 === 4) drum(s, 'shaker', 0.5);
        break;
      case 'pulse':
        if (pos % 4 === 0) drum(s, 'kick', 0.8);
        if (pos % 4 === 2) drum(s, 'hat', 0.5);
        if (pos === 12) drum(s, 'clap', 0.5);
        break;
      case 'title':
        // Brooding half-time: a syncopated kick, one big snare, ghost hats; a tom fill every 4 bars.
        if (pos === 0 || pos === 11) drum(s, 'kick', pos === 0 ? 1 : 0.6);
        if (pos === 8) drum(s, 'snare', 0.85);
        if (pos % 4 === 2) drum(s, 'hat', 0.3);
        if (lastBar && (pos === 12 || pos === 14)) drum(s, 'tom', 0.55);
        break;
      case 'fanfare':
        // Victory: march snare with a pickup roll into every other bar, crash on the downbeat.
        if (pos === 0 || pos === 8) drum(s, 'kick', 1);
        if (pos === 4 || pos === 12) drum(s, 'snare', 0.9);
        if (bar % 2 === 1 && pos >= 12) drum(s, 'snare', 0.35 + (pos - 12) * 0.12);
        if (bar % 2 === 0 && pos === 0) drum(s, 'crash', 0.7);
        if (pos % 2 === 0) drum(s, 'hat', 0.35);
        break;
      case 'boss2':
        // The spirit phase: driving hats, kick on every 8th, toms rolling into each bar.
        if (pos % 2 === 0) drum(s, 'kick', pos % 8 === 0 ? 1 : 0.75);
        if (pos === 4 || pos === 12) {
          drum(s, 'snare', 1);
          drum(s, 'clap', 0.7);
        }
        drum(s, 'hat', pos % 4 === 2 ? 0.7 : 0.3);
        if (pos >= 13) drum(s, 'tom', 0.45 + (pos - 13) * 0.15);
        if (bar % 2 === 0 && pos === 0) drum(s, 'crash', 1);
        break;
      case 'heartbeat':
        // Tension: a lub-dub pulse and a rim tick; no backbeat to lean on.
        if (pos === 0 || pos === 8) drum(s, 'kick', 0.9);
        if (pos === 2 || pos === 10) drum(s, 'kick', 0.5);
        if (pos === 12) drum(s, 'hat', 0.45);
        if (lastBar && pos === 14) drum(s, 'tom', 0.4);
        break;
    }
  }
  const loopStep = (spec.loopBar ?? 0) * STEPS;
  return {
    bpm: spec.bpm, swing: spec.swing ?? 0, length, loopStep, loop: spec.loop !== false, introSteps: (spec.intro ?? 0) * STEPS,
    restBars: new Set(spec.rests ?? []), trim: 10 ** ((spec.gain ?? 0) / 20), steps,
  };
}

// ------------------------------------------------------------------ sequencer
const compiled = new Map<string, Compiled>();

function get(name: string): Compiled | null {
  let c = compiled.get(name);
  if (!c) {
    const spec = SONGS[name];
    if (!spec) return null;
    c = compile(spec);
    compiled.set(name, c);
  }
  return c;
}

interface Playing {
  name: string;
  song: Compiled;
  gain: GainNode;
  step: number;
  nextTime: number;
  /** Times round the loop (0 on the first pass, when an intro rests the drums). */
  pass: number;
  /** The song's air bed, if it has one (stopped with the song). */
  air: AudioBufferSourceNode | null;
}

let current: Playing | null = null;
let pendingName: string | null = null;
let timer: number | null = null;
const stack: { name: string; step: number }[] = [];

function stepDur(song: Compiled): number {
  return 60 / song.bpm / 4;
}

/** A repeatable pseudo-random value in [-1, 1) for a note, so humanising is the same every play. */
function jitter(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) & 0xffff) / 32768 - 1;
}

/**
 * Queue one step's notes at time `at` (the live scheduler and the offline render share this).
 * Played, not typed: each note lands a few milliseconds off the grid and a few percent off its
 * written velocity (drums much less, so the groove stays tight).
 */
function scheduleStep(song: Compiled, step: number, at: number, dest: AudioNode, pass: number): void {
  const sd = stepDur(song);
  const t0 = at + (step % 2 === 1 ? song.swing * sd : 0);
  const drumsRest = (pass === 0 && step < song.introSteps) || song.restBars.has(Math.floor(step / STEPS));
  // A rest bar is a real breakdown, not only a drum drop: the low end goes too and the chords
  // pull back, so the bar after it lands as a surge.
  const breakdown = song.restBars.has(Math.floor(step / STEPS));
  song.steps[step]!.forEach((e, i) => {
    if (e.drum && drumsRest) return;
    if (breakdown && (e.inst === 'bass' || e.inst === 'sub')) return;
    const pull = !breakdown ? 1 : e.inst === 'pad' || e.inst === 'organ' || e.inst === 'choir' ? 0.45 : 0.8;
    const k = jitter(step, i, pass);
    const t = Math.max(0, t0 + k * (e.drum ? 0.0015 : 0.004));
    const vel = pull * e.vel * e.vol * (1 + jitter(i, step, pass + 7) * (e.drum ? 0.04 : 0.07));
    for (const m of e.midi) playNote(e.inst, { t, dur: e.len * sd * 0.95, freq: m ? midiToFreq(m) : 0, vel }, dest, { rev: e.rev, del: e.del });
  });
}

function tick(): void {
  const c = audio.ctx;
  if (!c || !current || audio.closing) return;
  const p = current;
  const ahead = c.currentTime + 0.14;
  while (p.nextTime < ahead) {
    if (p.step >= p.song.length) {
      if (!p.song.loop) {
        current = null;
        return;
      }
      p.step = p.song.loopStep;
      p.pass++;
    }
    try {
      scheduleStep(p.song, p.step, p.nextTime, p.gain, p.pass);
    } catch (e) {
      if (audio.gone(e)) return;
      throw e;
    }
    p.step++;
    p.nextTime += stepDur(p.song);
  }
}

/**
 * Render `seconds` of a song offline, from the top, looping as it would in play (dev tooling:
 * the audio evidence). Uses the full mix graph, including the song's reverb space.
 */
export async function renderSong(name: string, seconds: number, rate = 44100): Promise<AudioBuffer | null> {
  const song = get(name);
  if (!song) return null;
  const off = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
  const sp = SONGS[name]?.space ?? 'hall';
  return audio.renderOffline(off, sp === 'here' ? 'hall' : sp, () => {
    const gain = off.createGain();
    gain.gain.value = song.trim;
    gain.connect(audio.music);
    const airLevel = SONGS[name]?.air;
    if (airLevel) audio.airBed(gain, airLevel, 0.05, seconds);
    let step = 0, pass = 0;
    for (let t = 0.05; t < seconds; t += stepDur(song)) {
      if (step >= song.length) {
        if (!song.loop) break;
        step = song.loopStep;
        pass++;
      }
      scheduleStep(song, step, t, gain, pass);
      step++;
    }
  });
}

/**
 * When a song first loops, in seconds from the start of a `renderSong` render, or null if it
 * doesn't loop: the seam the audio evidence measures.
 */
export function loopPoint(name: string): number | null {
  const song = get(name);
  if (!song?.loop) return null;
  return 0.05 + song.length * stepDur(song);
}

/** A bar's length in seconds (16 sixteenth-note steps), for measuring bar lines. */
export function barLength(name: string): number | null {
  const song = get(name);
  return song ? stepDur(song) * 16 : null;
}

function startTimer(): void {
  if (timer === null) timer = window.setInterval(tick, 25);
}

/** Start a song. `keepSpace` leaves the reverb where it is (a battle happens *here*). */
function begin(name: string, fromStep = 0, fadeIn = 0, keepSpace = false): void {
  const c = audio.ctx;
  const song = get(name);
  if (!c || !song) return;
  const gain = c.createGain();
  gain.connect(audio.music);
  if (fadeIn > 0) {
    gain.gain.setValueAtTime(0.0001, c.currentTime);
    gain.gain.linearRampToValueAtTime(song.trim, c.currentTime + fadeIn);
  } else gain.gain.value = song.trim;
  const space = SONGS[name]?.space ?? 'hall';
  if (!keepSpace && space !== 'here') audio.setSpace(space);
  // Resuming mid-song (after a battle) is not a first pass: no drum-less intro again.
  const airLevel = SONGS[name]?.air;
  const air = airLevel ? audio.airBed(gain, airLevel, c.currentTime + 0.05) : null;
  current = { name, song, gain, step: fromStep % song.length, nextTime: c.currentTime + 0.06, pass: fromStep > 0 ? 1 : 0, air };
  startTimer();
}

function stopCurrent(fade: number): void {
  const c = audio.ctx;
  if (!current || !c) return;
  const g = current.gain;
  g.gain.cancelScheduledValues(c.currentTime);
  g.gain.setValueAtTime(g.gain.value, c.currentTime);
  g.gain.linearRampToValueAtTime(0.0001, c.currentTime + Math.max(0.02, fade));
  current.air?.stop(c.currentTime + Math.max(0.02, fade) + 0.1);
  setTimeout(() => g.disconnect(), (fade + 1.5) * 1000);
  current = null;
}

/**
 * Play a song (no-op if it's already playing). `fade` is in frames (60/s) for the outgoing song.
 * Call with null to stop.
 */
export function music(name: string | null, fade = 30, fadeIn?: number): void {
  if (!audio.unlocked) {
    pendingName = name;
    return;
  }
  if (name && current?.name === name) return;
  // A song replacing another eases in under the outgoing fade instead of cutting in.
  const replacing = !!current && fade > 0;
  stopCurrent(fade / 60);
  if (name) begin(name, 0, fadeIn ?? (replacing ? Math.min(0.8, fade / 60) : 0));
}

/** Save the current song position and switch (battles). */
export function pushMusic(name: string): void {
  if (current) stack.push({ name: current.name, step: current.step });
  if (!audio.unlocked) {
    pendingName = name;
    return;
  }
  if (current?.name === name) return;
  // Battle music hits at full volume, but in the room the fight broke out in.
  stopCurrent(8 / 60);
  begin(name, 0, 0, true);
}

/** Resume the song saved by pushMusic from where it left off. */
export function popMusic(): void {
  const prev = stack.pop();
  stopCurrent(0.3);
  if (prev && audio.unlocked) begin(prev.name, prev.step, 1.2, true);
}

/** A place's song, in the place's acoustic space (its own, or the song's). */
export function placeMusic(name: string, space?: Space): void {
  music(name);
  const sp = space ?? SONGS[name]?.space;
  if (sp && sp !== 'here') audio.setSpace(sp);
}

/**
 * Let the player hear a new music volume. Usually a song is already playing; when none is, a
 * short chime through the music bus (so it carries the music level, not the sound-effects one).
 */
export function previewMusic(): void {
  const c = audio.ctx;
  if (!c || current) return;
  const g = c.createGain();
  g.connect(audio.music);
  const t = c.currentTime + 0.02;
  ['E5', 'B5'].forEach((n, i) => {
    playNote('bell', { t: t + i * 0.12, dur: 0.5, freq: midiToFreq(noteToMidi(n)), vel: 0.8 }, g, { rev: 0.4 });
  });
  setTimeout(() => g.disconnect(), 2500);
}

export function currentSong(): string | null {
  return current?.name ?? pendingName;
}

audio.onUnlock(() => {
  if (pendingName) {
    const n = pendingName;
    pendingName = null;
    music(n, 0);
  }
});
