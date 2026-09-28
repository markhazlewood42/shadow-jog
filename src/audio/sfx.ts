/** Synthesized sound effects. `sfx(name, pitch)` is fire-and-forget and safe before audio unlock. */
import { audio } from './engine';

type Maker = (c: AudioContext, out: AudioNode, t: number, p: number) => void;

function osc(c: AudioContext, type: OscillatorType, f0: number, f1: number, t: number, dur: number, vol: number, out: AudioNode, curve: 'exp' | 'lin' = 'exp'): void {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  else o.frequency.linearRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(c: AudioContext, t: number, dur: number, vol: number, out: AudioNode, filter: BiquadFilterType, f0: number, f1 = f0, q = 1): void {
  const n = audio.noiseSource();
  const f = c.createBiquadFilter();
  const g = c.createGain();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  n.connect(f).connect(g).connect(out);
  n.start(t);
  n.stop(t + dur + 0.02);
}

function notes(c: AudioContext, type: OscillatorType, freqs: number[], step: number, dur: number, vol: number, out: AudioNode, t: number): void {
  freqs.forEach((f, i) => {
    osc(c, type, f, f, t + i * step, dur, vol, out);
  });
}

const S: Record<string, Maker> = {
  // UI
  cursor: (c, o, t) => osc(c, 'square', 1320, 1320, t, 0.035, 0.05, o),
  confirm: (c, o, t) => notes(c, 'square', [880, 1320], 0.04, 0.05, 0.06, o, t),
  cancel: (c, o, t) => notes(c, 'square', [660, 440], 0.04, 0.05, 0.05, o, t),
  buzz: (c, o, t) => osc(c, 'square', 140, 110, t, 0.14, 0.08, o, 'lin'),
  blip: (c, o, t, p) => osc(c, 'square', 520 * p, 520 * p, t, 0.03, 0.028, o),
  page: (c, o, t) => osc(c, 'triangle', 900, 1200, t, 0.05, 0.05, o),
  door: (c, o, t) => {
    noise(c, t, 0.25, 0.12, o, 'lowpass', 1200, 200);
    osc(c, 'sine', 120, 60, t + 0.18, 0.12, 0.2, o);
  },
  chest: (c, o, t) => {
    noise(c, t, 0.08, 0.1, o, 'highpass', 2000);
    notes(c, 'square', [660, 880, 1320], 0.06, 0.1, 0.05, o, t + 0.08);
  },
  cred: (c, o, t) => notes(c, 'square', [1560, 2080], 0.06, 0.12, 0.05, o, t),
  item: (c, o, t) => notes(c, 'triangle', [784, 988, 1175, 1568], 0.05, 0.14, 0.09, o, t),
  keyitem: (c, o, t) => notes(c, 'triangle', [523, 659, 784, 1047, 1319], 0.07, 0.3, 0.1, o, t),
  save: (c, o, t) => notes(c, 'sine', [784, 1175, 1568], 0.09, 0.4, 0.1, o, t),
  buy: (c, o, t) => {
    noise(c, t, 0.05, 0.08, o, 'bandpass', 3000, 3000, 4);
    notes(c, 'square', [1319, 1760], 0.05, 0.1, 0.05, o, t + 0.04);
  },
  alert: (c, o, t) => notes(c, 'square', [1175, 1568], 0.05, 0.08, 0.06, o, t),
  emote: (c, o, t) => osc(c, 'triangle', 600, 900, t, 0.1, 0.06, o),
  bump: (c, o, t) => {
    osc(c, 'sine', 120, 70, t, 0.06, 0.07, o);
    noise(c, t, 0.03, 0.03, o, 'lowpass', 300);
  },
  // Footsteps by surface (pitch alternates left/right foot).
  step: (c, o, t, p = 1) => noise(c, t, 0.035, 0.045, o, 'lowpass', 520 * p),
  step_soft: (c, o, t, p = 1) => noise(c, t, 0.05, 0.035, o, 'lowpass', 300 * p),
  step_metal: (c, o, t, p = 1) => {
    noise(c, t, 0.025, 0.035, o, 'bandpass', 2600 * p, 2600 * p, 6);
    osc(c, 'square', 180 * p, 140 * p, t, 0.03, 0.02, o);
  },
  step_water: (c, o, t, p = 1) => noise(c, t, 0.09, 0.05, o, 'bandpass', 1400 * p, 700 * p, 1.5),
  heal_field: (c, o, t) => notes(c, 'sine', [523, 659, 784, 1047], 0.06, 0.3, 0.08, o, t),
  // Battle
  encounter: (c, o, t) => {
    osc(c, 'sawtooth', 200, 1600, t, 0.35, 0.08, o);
    osc(c, 'square', 400, 3200, t + 0.05, 0.3, 0.05, o);
    noise(c, t + 0.2, 0.3, 0.08, o, 'highpass', 800, 4000);
  },
  swing: (c, o, t) => noise(c, t, 0.12, 0.08, o, 'bandpass', 800, 3000, 2),
  cast: (c, o, t) => {
    osc(c, 'sine', 400, 1200, t, 0.3, 0.06, o);
    osc(c, 'triangle', 800, 2400, t + 0.05, 0.25, 0.04, o);
  },
  enemy_act: (c, o, t) => osc(c, 'square', 300, 180, t, 0.08, 0.05, o),
  slash: (c, o, t) => noise(c, t, 0.14, 0.18, o, 'highpass', 3000, 800),
  gun: (c, o, t) => {
    for (let i = 0; i < 3; i++) {
      noise(c, t + i * 0.07, 0.07, 0.2, o, 'lowpass', 4000, 300);
      osc(c, 'square', 180, 60, t + i * 0.07, 0.05, 0.08, o);
    }
  },
  zap: (c, o, t) => {
    osc(c, 'sawtooth', 1800, 200, t, 0.25, 0.08, o);
    noise(c, t, 0.2, 0.1, o, 'bandpass', 6000, 2000, 3);
  },
  fire: (c, o, t) => noise(c, t, 0.5, 0.2, o, 'lowpass', 1800, 300),
  code: (c, o, t) => {
    for (let i = 0; i < 6; i++) osc(c, 'square', 800 + ((i * 373) % 900), 800 + ((i * 373) % 900), t + i * 0.035, 0.03, 0.04, o);
  },
  heal: (c, o, t) => notes(c, 'sine', [659, 784, 988, 1319], 0.05, 0.25, 0.07, o, t),
  punch: (c, o, t) => {
    osc(c, 'sine', 160, 50, t, 0.14, 0.3, o);
    noise(c, t, 0.08, 0.14, o, 'lowpass', 1200, 200);
  },
  spirit: (c, o, t) => {
    osc(c, 'sine', 300, 900, t, 0.5, 0.06, o, 'lin');
    osc(c, 'sine', 310, 880, t, 0.5, 0.05, o, 'lin');
  },
  beam: (c, o, t) => {
    osc(c, 'sawtooth', 80, 800, t, 0.6, 0.12, o, 'lin');
    noise(c, t, 0.8, 0.16, o, 'lowpass', 600, 3000);
  },
  wave: (c, o, t) => noise(c, t, 0.7, 0.2, o, 'lowpass', 300, 1500),
  hit: (c, o, t) => {
    noise(c, t, 0.08, 0.2, o, 'lowpass', 2500, 400);
    osc(c, 'square', 220, 90, t, 0.07, 0.08, o);
  },
  crit: (c, o, t) => {
    noise(c, t, 0.12, 0.26, o, 'lowpass', 4000, 300);
    osc(c, 'square', 1760, 1760, t + 0.02, 0.1, 0.05, o);
    osc(c, 'sine', 180, 40, t, 0.2, 0.3, o);
  },
  hurt: (c, o, t) => {
    osc(c, 'sawtooth', 180, 70, t, 0.16, 0.12, o);
    noise(c, t, 0.1, 0.12, o, 'lowpass', 1500, 200);
  },
  miss: (c, o, t) => noise(c, t, 0.15, 0.06, o, 'bandpass', 1200, 2800, 2),
  enemy_die: (c, o, t) => {
    osc(c, 'square', 600, 60, t, 0.4, 0.07, o);
    noise(c, t, 0.35, 0.12, o, 'lowpass', 3000, 100);
  },
  ko: (c, o, t) => notes(c, 'triangle', [440, 330, 220], 0.12, 0.2, 0.1, o, t),
  revive: (c, o, t) => notes(c, 'sine', [392, 523, 659, 784, 1047], 0.06, 0.4, 0.08, o, t),
  buff: (c, o, t) => osc(c, 'triangle', 400, 1200, t, 0.25, 0.07, o),
  debuff: (c, o, t) => osc(c, 'triangle', 900, 250, t, 0.25, 0.07, o),
  tick: (c, o, t) => osc(c, 'square', 300, 200, t, 0.06, 0.04, o),
  flee: (c, o, t) => {
    for (let i = 0; i < 4; i++) noise(c, t + i * 0.06, 0.04, 0.08, o, 'lowpass', 900);
  },
  summon: (c, o, t) => {
    osc(c, 'sawtooth', 100, 600, t, 0.5, 0.08, o, 'lin');
    osc(c, 'square', 1200, 1200, t + 0.4, 0.2, 0.04, o);
  },
  phase: (c, o, t) => {
    noise(c, t, 1.5, 0.3, o, 'lowpass', 200, 5000);
    osc(c, 'sawtooth', 40, 400, t, 1.4, 0.15, o, 'lin');
    notes(c, 'sine', [110, 104, 98], 0.3, 0.8, 0.2, o, t + 0.5);
  },
  combo: (c, o, t) => {
    notes(c, 'sawtooth', [523, 659, 784, 1047], 0.0, 0.5, 0.05, o, t);
    notes(c, 'square', [1047, 1319, 1568, 2093], 0.05, 0.2, 0.04, o, t + 0.1);
    noise(c, t, 0.4, 0.1, o, 'highpass', 2000, 8000);
  },
  // Combo signatures, layered under the shared fanfare: each pair has its own motif and colour.
  sting_rift: (c, o, t) => {
    notes(c, 'sawtooth', [330, 494, 659], 0.04, 0.25, 0.05, o, t);
    noise(c, t + 0.1, 0.5, 0.18, o, 'bandpass', 5000, 900, 3);
    osc(c, 'square', 1200, 180, t + 0.1, 0.35, 0.05, o);
  },
  sting_lock: (c, o, t) => {
    notes(c, 'square', [1568, 1568, 2093], 0.07, 0.06, 0.05, o, t);
    osc(c, 'sine', 2093, 2093, t + 0.22, 0.3, 0.06, o, 'lin');
  },
  sting_circuit: (c, o, t) => {
    notes(c, 'square', [392, 784, 587, 1175, 880], 0.035, 0.08, 0.045, o, t);
    notes(c, 'sine', [220, 330], 0.2, 0.5, 0.08, o, t + 0.1);
  },
  sting_pyre: (c, o, t) => {
    noise(c, t, 0.9, 0.22, o, 'lowpass', 600, 4000);
    notes(c, 'sawtooth', [196, 294, 392], 0.08, 0.4, 0.05, o, t + 0.05);
  },
  sting_crow: (c, o, t) => {
    notes(c, 'triangle', [880, 740, 988, 880], 0.06, 0.18, 0.06, o, t);
    noise(c, t, 0.3, 0.1, o, 'bandpass', 1200, 2400, 2);
  },
  sting_life: (c, o, t) => notes(c, 'sine', [523, 784, 1047, 1319, 1568], 0.06, 0.5, 0.06, o, t),
  sting_ward: (c, o, t) => {
    notes(c, 'triangle', [294, 440, 587], 0.0, 0.9, 0.06, o, t);
    notes(c, 'sine', [1175, 880], 0.12, 0.4, 0.04, o, t + 0.15);
  },
  combo_ready: (c, o, t) => notes(c, 'triangle', [1319, 1760, 2349], 0.04, 0.12, 0.06, o, t),
  explosion: (c, o, t) => {
    noise(c, t, 1.2, 0.35, o, 'lowpass', 3000, 80);
    osc(c, 'sine', 90, 30, t, 0.8, 0.4, o);
  },
  levelup: (c, o, t) => notes(c, 'square', [523, 659, 784, 1047, 784, 1047], 0.07, 0.14, 0.06, o, t),
  // Gear: a short metal clank and a settle.
  equip: (c, o, t) => {
    noise(c, t, 0.06, 0.12, o, 'bandpass', 3400, 1800, 5);
    osc(c, 'square', 330, 220, t, 0.06, 0.05, o);
    notes(c, 'triangle', [880, 1175], 0.04, 0.08, 0.05, o, t + 0.05);
  },
  // Status ailments each get their own cue.
  st_poison: (c, o, t) => notes(c, 'sine', [620, 520, 440, 370], 0.045, 0.07, 0.07, o, t),
  st_burn: (c, o, t) => {
    noise(c, t, 0.35, 0.12, o, 'highpass', 1800, 3200);
    osc(c, 'sawtooth', 200, 90, t, 0.25, 0.05, o);
  },
  st_stun: (c, o, t) => {
    osc(c, 'square', 1400, 1100, t, 0.08, 0.06, o);
    osc(c, 'square', 1400, 1100, t + 0.1, 0.08, 0.06, o);
    notes(c, 'triangle', [2093, 2637, 2093], 0.05, 0.06, 0.04, o, t + 0.2);
  },
  st_blind: (c, o, t) => {
    noise(c, t, 0.4, 0.1, o, 'lowpass', 3000, 200);
    osc(c, 'sine', 700, 200, t, 0.35, 0.05, o);
  },
  st_jammed: (c, o, t) => notes(c, 'square', [1760, 220, 1480, 196, 1320], 0.03, 0.03, 0.05, o, t),
  // Victory cheer: a spray of sparkle over a short whoosh, under the fanfare.
  cheer: (c, o, t) => {
    noise(c, t, 0.35, 0.08, o, 'bandpass', 3200);
    notes(c, 'triangle', [1568, 2093, 2637, 3136, 2637, 3136], 0.035, 0.08, 0.05, o, t + 0.05);
  },
};

let last = new Map<string, number>();

export function sfx(name: string, pitch = 1): void {
  const c = audio.ctx;
  if (!c || !audio.unlocked) return;
  const make = S[name];
  if (!make) return;
  // Rate-limit identical sounds in the same instant (e.g. 4 hits at once).
  const now = c.currentTime;
  const prev = last.get(name) ?? -1;
  if (now - prev < 0.025 && name !== 'blip') return;
  last.set(name, now);
  if (last.size > 64) last = new Map();
  // Each effect at its category's loudness (see LEVEL); most need a boost, which goes on a
  // per-call gain so the synths themselves keep their internal balance.
  const level = LEVEL[name] ?? 1;
  if (level === 1) make(c, audio.sfx, now + 0.005, pitch);
  else {
    const g = c.createGain();
    g.gain.value = level;
    g.connect(audio.sfx);
    make(c, g, now + 0.005, pitch);
    setTimeout(() => g.disconnect(), 4000);
  }
  if (HEAVY.has(name)) audio.duckForHit(name === 'crit' || name === 'combo' ? 0.5 : 0.62);
}

/**
 * Per-effect loudness, calibrated from offline renders (e2e/audio-evidence.spec.ts) against the
 * music's ~-20 dBFS RMS: footsteps a soft texture (~-32 dBFS peak), menu ticks light (~-24), UI
 * confirmations ~-19, hits and casts clearly over the score (~-14), big impacts loudest (-10 to
 * -6). The synths were written at wildly different levels (-65 to -11 dBFS); a hit sat 15 dB
 * under the music.
 */
const LEVEL: Record<string, number> = {
  alert: 6.33, beam: 3.29, blip: 25.88, buff: 10.59, bump: 17.59, buy: 2.44, buzz: 8.64, cancel: 4.1, cast: 4.78, cheer: 4.0, chest: 4.2, code: 3.21, combo: 5.15, combo_ready: 3.8, confirm: 3.63, cred: 2.81, crit: 4.06, cursor: 14.49, debuff: 10.64, door: 1.13, emote: 14.64, encounter: 2.79, enemy_act: 20.06, enemy_die: 4.97, equip: 2.62, explosion: 1.73, fire: 4.37, flee: 8.8, gun: 1.14, heal: 2.28, heal_field: 1.81, hit: 11.46, hurt: 9.57, item: 2.3, keyitem: 1.61, ko: 3.42, levelup: 3.38, miss: 30.4, page: 14.06, phase: 1.69, punch: 4.95, revive: 1.55, save: 1.7, slash: 6.45, spirit: 7.38, st_blind: 4.37, st_burn: 3.48, st_jammed: 3.96, st_poison: 2.79, st_stun: 3.42, step: 25.86, step_metal: 11.5, step_soft: 29.37, step_water: 8.87, sting_circuit: 2.31, sting_crow: 3.8, sting_life: 2.34, sting_lock: 4.7, sting_pyre: 3.33, sting_rift: 1.89, sting_ward: 2.46, summon: 7.2, swing: 31.62, tick: 16.78, wave: 9.77, zap: 7.22,
};

/** Every effect's name (the audio evidence measures them all). */
export const SFX_NAMES = (): string[] => Object.keys(S);

/** Render one effect offline through the full mix graph (dev tooling: the audio evidence). */
export function renderSfx(name: string, seconds = 2): Promise<AudioBuffer> {
  const off = new OfflineAudioContext(2, Math.ceil(44100 * seconds), 44100);
  return audio.renderOffline(off, 'hall', () => sfx(name));
}

/** Impacts big enough to dip the music under them. */
const HEAVY = new Set(['explosion', 'crit', 'combo', 'phase', 'beam', 'wave', 'summon', 'ko']);
