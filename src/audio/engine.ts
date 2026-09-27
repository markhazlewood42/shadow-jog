/**
 * WebAudio engine: master chain (compressor + reverb + delay sends), music and SFX buses,
 * and synthesized instruments. Nothing is sampled — every sound is built from oscillators and noise.
 */
import { settings } from '../game/settings';

export interface Voice {
  /** Start time (AudioContext seconds). */
  t: number;
  /** Duration in seconds (note length before release). */
  dur: number;
  freq: number;
  vel: number;
}

class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  music!: GainNode;
  sfx!: GainNode;
  reverb!: ConvolverNode;
  reverbSend!: GainNode;
  delay!: DelayNode;
  delaySend!: GainNode;
  noise!: AudioBuffer;
  unlocked = false;
  private listeners: (() => void)[] = [];

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.build();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (!this.unlocked) {
      this.unlocked = true;
      for (const l of this.listeners) l();
    }
  }

  onUnlock(fn: () => void): void {
    if (this.unlocked) fn();
    else this.listeners.push(fn);
  }

  private build(): void {
    const c = this.ctx!;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master = c.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp).connect(c.destination);
    this.music = c.createGain();
    this.sfx = c.createGain();
    this.music.connect(this.master);
    this.sfx.connect(this.master);
    // Reverb: synthetic impulse (decaying stereo noise).
    this.reverb = c.createConvolver();
    const len = Math.floor(c.sampleRate * 2.2);
    const ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.reverb.buffer = ir;
    this.reverbSend = c.createGain();
    this.reverbSend.gain.value = 0.22;
    this.reverbSend.connect(this.reverb).connect(this.master);
    // Tempo-free slapback/echo delay.
    this.delay = c.createDelay(1.5);
    this.delay.delayTime.value = 0.3;
    const fb = c.createGain();
    fb.gain.value = 0.32;
    const dl = c.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 2400;
    this.delaySend = c.createGain();
    this.delaySend.gain.value = 0.18;
    this.delaySend.connect(this.delay);
    this.delay.connect(dl).connect(fb).connect(this.delay);
    dl.connect(this.master);
    // White noise buffer for drums & effects.
    this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.applyVolumes();
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.music.gain.setTargetAtTime(settings.musicVol * 0.55, t, 0.05);
    this.sfx.gain.setTargetAtTime(settings.sfxVol * 0.7, t, 0.05);
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  noiseSource(): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    return s;
  }

  suspend(): void {
    if (this.ctx?.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx?.state === 'suspended' && this.unlocked) void this.ctx.resume();
  }
}

export const audio = new AudioEngine();

export function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C#4" / "Eb3" → midi number. */
export function noteToMidi(n: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(n);
  if (!m) throw new Error(`Bad note ${n}`);
  let v = NOTE[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  v += (Number(m[3]) + 1) * 12;
  return v;
}

// ------------------------------------------------------------------ instruments
export type InstId = 'lead' | 'lead2' | 'pluck' | 'arp' | 'bass' | 'sub' | 'pad' | 'bell' | 'choir' | 'organ' | 'kick' | 'snare' | 'hat' | 'ohat' | 'clap' | 'tom' | 'crash' | 'shaker';

interface Chain {
  out: AudioNode;
  end: number;
}

function env(g: GainNode, t: number, a: number, d: number, s: number, dur: number, r: number, peak: number): number {
  const p = g.gain;
  p.setValueAtTime(0.0001, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setTargetAtTime(peak * s, t + a, d / 3 + 0.001);
  const off = t + Math.max(a, dur);
  p.setTargetAtTime(0.0001, off, r / 4 + 0.001);
  return off + r + 0.05;
}

export function playNote(inst: InstId, v: Voice, dest: AudioNode, sends: { rev?: number; del?: number } = {}): void {
  const c = audio.ctx;
  if (!c) return;
  const { t, dur, freq, vel } = v;
  let chain: Chain | null = null;
  const out = c.createGain();
  switch (inst) {
    case 'lead':
    case 'lead2': {
      const o1 = c.createOscillator();
      const o2 = c.createOscillator();
      o1.type = inst === 'lead' ? 'square' : 'sawtooth';
      o2.type = 'sawtooth';
      o1.frequency.value = freq;
      o2.frequency.value = freq * 1.004;
      // Delayed vibrato
      const lfo = c.createOscillator();
      const lg = c.createGain();
      lfo.frequency.value = 5.5;
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(freq * 0.012, t + Math.min(0.35, dur * 0.6));
      lfo.connect(lg);
      lg.connect(o1.frequency);
      lg.connect(o2.frequency);
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 3;
      f.frequency.setValueAtTime(900, t);
      f.frequency.linearRampToValueAtTime(3200 + vel * 1500, t + 0.03);
      f.frequency.setTargetAtTime(1600, t + 0.05, 0.2);
      const mix = c.createGain();
      mix.gain.value = 0.5;
      o1.connect(mix);
      o2.connect(mix);
      mix.connect(f).connect(out);
      const end = env(out, t, 0.01, 0.15, 0.75, dur, 0.12, 0.16 * vel);
      for (const o of [o1, o2, lfo]) { o.start(t); o.stop(end); }
      chain = { out, end };
      break;
    }
    case 'pluck':
    case 'arp': {
      const o = c.createOscillator();
      o.type = inst === 'arp' ? 'square' : 'triangle';
      o.frequency.value = freq;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(inst === 'arp' ? 4200 : 3000, t);
      f.frequency.exponentialRampToValueAtTime(600, t + 0.18);
      o.connect(f).connect(out);
      const end = env(out, t, 0.003, 0.12, 0.25, Math.min(dur, 0.15), 0.12, (inst === 'arp' ? 0.07 : 0.12) * vel);
      o.start(t);
      o.stop(end);
      chain = { out, end };
      break;
    }
    case 'bass': {
      const o = c.createOscillator();
      const s = c.createOscillator();
      o.type = 'sawtooth';
      s.type = 'sine';
      o.frequency.value = freq;
      s.frequency.value = freq / 2;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 6;
      f.frequency.setValueAtTime(220, t);
      f.frequency.linearRampToValueAtTime(900 + vel * 900, t + 0.01);
      f.frequency.setTargetAtTime(260, t + 0.02, 0.09);
      const sg = c.createGain();
      sg.gain.value = 0.7;
      o.connect(f);
      s.connect(sg);
      f.connect(out);
      sg.connect(out);
      const end = env(out, t, 0.004, 0.2, 0.6, dur, 0.06, 0.22 * vel);
      o.start(t); s.start(t); o.stop(end); s.stop(end);
      chain = { out, end };
      break;
    }
    case 'sub': {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq;
      o.connect(out);
      const end = env(out, t, 0.006, 0.3, 0.8, dur, 0.08, 0.3 * vel);
      o.start(t);
      o.stop(end);
      chain = { out, end };
      break;
    }
    case 'pad':
    case 'choir':
    case 'organ': {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = inst === 'choir' ? 1400 : inst === 'organ' ? 2400 : 1100;
      f.Q.value = inst === 'choir' ? 8 : 1;
      const oscs: OscillatorNode[] = [];
      const detunes = inst === 'organ' ? [0, 1200, 1902] : [-9, 0, 9];
      for (const dt of detunes) {
        const o = c.createOscillator();
        o.type = inst === 'organ' ? 'sine' : inst === 'choir' ? 'triangle' : 'sawtooth';
        o.frequency.value = freq;
        o.detune.value = dt;
        o.connect(f);
        oscs.push(o);
      }
      if (inst === 'choir') {
        // Formant-ish shimmer
        const lfo = c.createOscillator();
        const lg = c.createGain();
        lfo.frequency.value = 0.8;
        lg.gain.value = 300;
        lfo.connect(lg).connect(f.frequency);
        oscs.push(lfo);
      }
      f.connect(out);
      const a = inst === 'organ' ? 0.02 : 0.35;
      const end = env(out, t, a, 0.5, 0.85, dur, inst === 'organ' ? 0.1 : 0.6, (inst === 'organ' ? 0.06 : 0.045) * vel);
      for (const o of oscs) { o.start(t); o.stop(end); }
      chain = { out, end };
      break;
    }
    case 'bell': {
      const car = c.createOscillator();
      const mod = c.createOscillator();
      const mg = c.createGain();
      car.type = 'sine';
      mod.type = 'sine';
      car.frequency.value = freq;
      mod.frequency.value = freq * 3.5;
      mg.gain.setValueAtTime(freq * 2.5, t);
      mg.gain.exponentialRampToValueAtTime(freq * 0.1, t + 0.8);
      mod.connect(mg).connect(car.frequency);
      car.connect(out);
      const end = env(out, t, 0.002, 0.6, 0.2, dur, 0.9, 0.12 * vel);
      car.start(t); mod.start(t); car.stop(end); mod.stop(end);
      chain = { out, end };
      break;
    }
    case 'kick': {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      o.connect(out);
      out.gain.setValueAtTime(0.55 * vel, t);
      out.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.start(t);
      o.stop(t + 0.4);
      chain = { out, end: t + 0.4 };
      break;
    }
    case 'snare':
    case 'clap': {
      const n = audio.noiseSource();
      const f = c.createBiquadFilter();
      f.type = inst === 'clap' ? 'bandpass' : 'highpass';
      f.frequency.value = inst === 'clap' ? 1400 : 1200;
      n.connect(f).connect(out);
      const peak = (inst === 'clap' ? 0.3 : 0.28) * vel;
      out.gain.setValueAtTime(0.0001, t);
      if (inst === 'clap') {
        for (let i = 0; i < 3; i++) {
          out.gain.setValueAtTime(peak, t + i * 0.012);
          out.gain.exponentialRampToValueAtTime(peak * 0.2, t + i * 0.012 + 0.01);
        }
        out.gain.setValueAtTime(peak, t + 0.036);
        out.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      } else {
        out.gain.linearRampToValueAtTime(peak, t + 0.002);
        out.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        const o = c.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(220, t);
        o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
        const og = c.createGain();
        og.gain.setValueAtTime(0.25 * vel, t);
        og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        o.connect(og).connect(out);
        o.start(t);
        o.stop(t + 0.12);
      }
      n.start(t);
      n.stop(t + 0.25);
      chain = { out, end: t + 0.25 };
      break;
    }
    case 'hat':
    case 'ohat':
    case 'shaker': {
      const n = audio.noiseSource();
      const f = c.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = inst === 'shaker' ? 5000 : 7500;
      n.connect(f).connect(out);
      const len = inst === 'ohat' ? 0.22 : inst === 'shaker' ? 0.06 : 0.04;
      out.gain.setValueAtTime((inst === 'shaker' ? 0.06 : 0.1) * vel, t);
      out.gain.exponentialRampToValueAtTime(0.001, t + len);
      n.start(t);
      n.stop(t + len + 0.02);
      chain = { out, end: t + len + 0.02 };
      break;
    }
    case 'tom': {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq || 180, t);
      o.frequency.exponentialRampToValueAtTime((freq || 180) * 0.5, t + 0.25);
      o.connect(out);
      out.gain.setValueAtTime(0.35 * vel, t);
      out.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.start(t);
      o.stop(t + 0.32);
      chain = { out, end: t + 0.32 };
      break;
    }
    case 'crash': {
      const n = audio.noiseSource();
      const f = c.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 3500;
      n.connect(f).connect(out);
      out.gain.setValueAtTime(0.14 * vel, t);
      out.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
      n.start(t);
      n.stop(t + 1.5);
      chain = { out, end: t + 1.5 };
      break;
    }
  }
  if (!chain) return;
  chain.out.connect(dest);
  if (sends.rev) {
    const g = c.createGain();
    g.gain.value = sends.rev;
    chain.out.connect(g).connect(audio.reverbSend);
  }
  if (sends.del) {
    const g = c.createGain();
    g.gain.value = sends.del;
    chain.out.connect(g).connect(audio.delaySend);
  }
}
