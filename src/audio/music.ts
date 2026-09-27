/**
 * Music sequencer with a tiny composition DSL.
 *
 * A song = chord progression + hand-written melody lines + generated parts (bass, arp, pad, drums).
 * Bars are separated by `|`. Each bar's tokens divide it evenly (16 tokens = 16ths, 8 = 8ths …).
 * Melody tokens: note (`A4`, `C#5`), `-` hold, `.` rest. Chord tokens: `Am7`, `F`, `C/E`, `.` = same.
 */
import { audio, midiToFreq, noteToMidi, playNote, type InstId } from './engine';
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
}

interface Ev {
  inst: InstId;
  midi: number[];
  len: number;
  vel: number;
  vol: number;
  rev: number;
  del: number;
}

interface Compiled {
  bpm: number;
  swing: number;
  length: number;
  loopStep: number;
  loop: boolean;
  steps: Ev[][];
}

// ------------------------------------------------------------------ chord parsing
const QUAL: Record<string, number[]> = {
  '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], dim: [0, 3, 6], dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10], sus2: [0, 2, 7], sus4: [0, 5, 7], add9: [0, 4, 7, 14], m9: [0, 3, 7, 10, 14], '9': [0, 4, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14], '6': [0, 4, 7, 9], m6: [0, 3, 7, 9], aug: [0, 4, 8], '5': [0, 7], madd9: [0, 3, 7, 14], mmaj7: [0, 3, 7, 11],
};

interface Chord {
  root: number;
  tones: number[];
  bass: number;
}

function parseChord(sym: string): Chord {
  const [main, slash] = sym.split('/');
  const m = /^([A-G][#b]?)(.*)$/.exec(main!);
  if (!m) throw new Error(`Bad chord ${sym}`);
  const root = noteToMidi(m[1]! + '3') % 12;
  const iv = QUAL[m[2]!];
  if (!iv) throw new Error(`Unknown chord quality ${sym}`);
  const bass = slash ? noteToMidi(slash + '3') % 12 : root;
  return { root, tones: iv.map((i) => root + i), bass };
}

/** Split a bar-string into per-step tokens with durations. */
function stepsOf(src: string): { tok: string; step: number; len: number }[] {
  const bars = src.split('|').map((b) => b.trim()).filter((b) => b.length);
  const out: { tok: string; step: number; len: number }[] = [];
  bars.forEach((bar, bi) => {
    const toks = bar.split(/\s+/);
    const len = STEPS / toks.length;
    toks.forEach((t, i) => out.push({ tok: t, step: bi * STEPS + Math.round(i * len), len }));
  });
  return out;
}

function chordTimeline(src: string): { chords: (Chord | null)[]; bars: number } {
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
        push(t.step, { ...base, midi: names.map(noteToMidi), len, vel: acc ? 1 : 0.8 });
      }
      continue;
    }
    const oct = part.octave ?? 3;
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
        case 'bells':
          if (segStart) push(s, { ...base, midi: [tone(ch.tones.length > 3 ? 3 : 2, oct)], len: 6, vel: 0.7 });
          break;
      }
    }
  }

  // Drums
  const dv = spec.drumVol ?? 1;
  const drum = (s: number, inst: InstId, vel: number) => push(s, { inst, midi: [0], len: 1, vel: vel * dv, vol: 1, rev: inst === 'snare' || inst === 'clap' ? 0.25 : 0.04, del: 0 });
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
    }
  }
  const loopStep = (spec.loopBar ?? 0) * STEPS;
  return { bpm: spec.bpm, swing: spec.swing ?? 0, length, loopStep, loop: spec.loop !== false, steps };
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
}

let current: Playing | null = null;
let pendingName: string | null = null;
let timer: number | null = null;
const stack: { name: string; step: number }[] = [];

function stepDur(song: Compiled): number {
  return 60 / song.bpm / 4;
}

function tick(): void {
  const c = audio.ctx;
  if (!c || !current) return;
  const p = current;
  const ahead = c.currentTime + 0.14;
  while (p.nextTime < ahead) {
    if (p.step >= p.song.length) {
      if (!p.song.loop) {
        current = null;
        return;
      }
      p.step = p.song.loopStep;
    }
    const sd = stepDur(p.song);
    const swingOff = p.step % 2 === 1 ? p.song.swing * sd : 0;
    const t = p.nextTime + swingOff;
    for (const e of p.song.steps[p.step]!) {
      for (const m of e.midi) {
        playNote(e.inst, { t, dur: e.len * sd * 0.95, freq: m ? midiToFreq(m) : 0, vel: e.vel * e.vol }, p.gain, { rev: e.rev, del: e.del });
      }
    }
    p.step++;
    p.nextTime += sd;
  }
}

function startTimer(): void {
  if (timer === null) timer = window.setInterval(tick, 25);
}

function begin(name: string, fromStep = 0, fadeIn = 0): void {
  const c = audio.ctx;
  const song = get(name);
  if (!c || !song) return;
  const gain = c.createGain();
  gain.connect(audio.music);
  if (fadeIn > 0) {
    gain.gain.setValueAtTime(0.0001, c.currentTime);
    gain.gain.linearRampToValueAtTime(1, c.currentTime + fadeIn);
  }
  current = { name, song, gain, step: fromStep % song.length, nextTime: c.currentTime + 0.06 };
  startTimer();
}

function stopCurrent(fade: number): void {
  const c = audio.ctx;
  if (!current || !c) return;
  const g = current.gain;
  g.gain.cancelScheduledValues(c.currentTime);
  g.gain.setValueAtTime(g.gain.value, c.currentTime);
  g.gain.linearRampToValueAtTime(0.0001, c.currentTime + Math.max(0.02, fade));
  setTimeout(() => g.disconnect(), (fade + 1.5) * 1000);
  current = null;
}

/**
 * Play a song (no-op if it's already playing). `fade` is in frames (60/s) for the outgoing song.
 * Call with null to stop.
 */
export function music(name: string | null, fade = 30): void {
  if (!audio.unlocked) {
    pendingName = name;
    return;
  }
  if (name && current?.name === name) return;
  stopCurrent(fade / 60);
  if (name) begin(name, 0, 0);
}

/** Save the current song position and switch (battles). */
export function pushMusic(name: string): void {
  if (current) stack.push({ name: current.name, step: current.step });
  music(name, 8);
}

/** Resume the song saved by pushMusic from where it left off. */
export function popMusic(): void {
  const prev = stack.pop();
  stopCurrent(0.3);
  if (prev && audio.unlocked) begin(prev.name, prev.step, 1.2);
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
