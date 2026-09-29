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

declare global {
  interface Window {
    /** Safari before 14.1 only has the prefixed constructor, which lib.dom doesn't declare. */
    webkitAudioContext?: typeof AudioContext;
  }
}

/** Acoustic spaces: each is a synthetic impulse (length, decay curve, damping, early echoes) plus an echo time. */
export type Space = 'room' | 'hall' | 'cave' | 'tunnel';
interface SpaceDef {
  len: number;
  decay: number;
  /** One-pole lowpass on the tail, 0..1 (higher = darker). */
  damp: number;
  /** Discrete early reflections: [seconds, gain]. */
  early: [number, number][];
  echo: number;
  feedback: number;
}
const SPACES: Record<Space, SpaceDef> = {
  // The bar, interiors: short and close.
  room: { len: 0.7, decay: 3.5, damp: 0.35, early: [[0.011, 0.5], [0.019, 0.35]], echo: 0.14, feedback: 0.18 },
  // Streets, the overworld, battles: the default open reverb.
  hall: { len: 2.2, decay: 2.6, damp: 0.15, early: [], echo: 0.3, feedback: 0.32 },
  // The Sinkline: long, dark, dripping.
  cave: { len: 3.6, decay: 2.1, damp: 0.6, early: [[0.045, 0.45], [0.11, 0.3], [0.19, 0.2]], echo: 0.42, feedback: 0.42 },
  // Annex 7: hard metal corridors, a ringing flutter echo.
  tunnel: { len: 1.6, decay: 3.0, damp: 0.1, early: [[0.023, 0.55], [0.046, 0.4], [0.069, 0.3], [0.092, 0.2]], echo: 0.23, feedback: 0.38 },
};

function impulse(c: BaseAudioContext, sp: SpaceDef): AudioBuffer {
  const len = Math.floor(c.sampleRate * sp.len);
  const ir = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const n = Math.random() * 2 - 1;
      lp += (n - lp) * (1 - sp.damp);
      d[i] = lp * (1 - i / len) ** sp.decay;
    }
    for (const [sec, g] of sp.early) {
      const k = Math.floor(sec * c.sampleRate * (ch ? 1.07 : 1));
      if (k < len) d[k] = d[k]! + g * (ch ? -1 : 1);
    }
  }
  return ir;
}

class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  music!: GainNode;
  /** Sits after the music bus: dips the score while someone is talking. */
  private duckNode!: GainNode;
  /** A second, momentary dip under heavy impacts (explosions, crits, combos). */
  private hitDuck!: GainNode;
  private ducks = 0;
  sfx!: GainNode;
  /** Two convolvers so a change of space crossfades instead of swapping a ringing buffer. */
  private verbs!: [ConvolverNode, ConvolverNode];
  private verbGains!: [GainNode, GainNode];
  private verbActive = 0;
  reverbSend!: GainNode;
  delay!: DelayNode;
  private delayFb!: GainNode;
  private spaces = new Map<Space, AudioBuffer>();
  private space: Space | null = null;
  delaySend!: GainNode;
  noise!: AudioBuffer;
  unlocked = false;
  /**
   * The page is going away (pagehide). Firefox throws on every audio call made after navigation
   * starts, and the music scheduler and effects would keep making them until teardown.
   */
  closing = false;
  private listeners: (() => void)[] = [];

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.build();
    }
    if (this.ctx.state === 'suspended') this.wake();
    if (!this.unlocked) {
      this.unlocked = true;
      // Starting the pending song (compiling it, scheduling notes) waits a task, so it doesn't
      // add to the keypress that unlocked audio.
      const ls = this.listeners.splice(0);
      setTimeout(() => {
        for (const l of ls) l();
      }, 0);
    }
  }

  onUnlock(fn: () => void): void {
    if (this.unlocked) fn();
    else this.listeners.push(fn);
  }

  private build(): void {
    const c = this.ctx!;
    // Mix: music and SFX are compressed separately (so a pile-up of hits can't pump the score),
    // then meet at a brick-wall limiter that only catches true peaks.
    const comp = (threshold: number, ratio: number, attack: number, release: number) => {
      const k = c.createDynamicsCompressor();
      k.threshold.value = threshold;
      k.knee.value = 8;
      k.ratio.value = ratio;
      k.attack.value = attack;
      k.release.value = release;
      return k;
    };
    const limiter = comp(-2, 20, 0.002, 0.12);
    limiter.knee.value = 0;
    this.master = c.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(limiter).connect(c.destination);
    this.music = c.createGain();
    this.sfx = c.createGain();
    this.duckNode = c.createGain();
    this.hitDuck = c.createGain();
    // The music bus is shaped before its compressor: the sub trimmed and the low mids cleared
    // (every part's fundamentals pile up there), presence lifted so leads have edge, a gentle
    // tape-style saturation for harmonics, and a stereo chorus on everything above the bass for
    // width and sheen. (The offline renders in docs/quality/evidence/audio.txt measured the old
    // bus at ~50% of its energy under 120 Hz and ~1% at 2-6 kHz.)
    const musicComp = comp(-15, 1.8, 0.02, 0.3);
    const eq = (type: BiquadFilterType, f: number, gain = 0, q = 0.7) => {
      const k = c.createBiquadFilter();
      k.type = type;
      k.frequency.value = f;
      k.gain.value = gain;
      k.Q.value = q;
      return k;
    };
    const sat = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(1.6 * x) / Math.tanh(1.6);
    }
    sat.curve = curve;
    sat.oversample = '2x';
    const shaped = this.music.connect(eq('highpass', 32)).connect(eq('lowshelf', 180, -3.5)).connect(eq('peaking', 380, -2, 0.9)).connect(eq('highshelf', 3000, 4.5)).connect(sat);
    shaped.connect(musicComp);
    const chorusIn = eq('highpass', 350);
    shaped.connect(chorusIn);
    for (const [side, rate, base] of [[-1, 0.31, 0.011], [1, 0.37, 0.014]] as const) {
      const d = c.createDelay(0.05);
      d.delayTime.value = base;
      const lfo = c.createOscillator();
      lfo.frequency.value = rate;
      const depth = c.createGain();
      depth.gain.value = 0.0025;
      lfo.connect(depth).connect(d.delayTime);
      lfo.start();
      const pan = c.createStereoPanner();
      pan.pan.value = side * 0.7;
      const mix = c.createGain();
      mix.gain.value = 0.22;
      chorusIn.connect(d).connect(pan).connect(mix).connect(musicComp);
    }
    musicComp.connect(this.duckNode).connect(this.hitDuck).connect(this.master);
    this.sfx.connect(comp(-12, 4, 0.003, 0.15)).connect(this.master);
    // Reverb: one synthetic impulse per acoustic space, swapped when the song changes. Only the
    // first is built now: unlock runs inside the player's first keypress, and building all four
    // there cost ~60 ms (a visible hitch on the first step). The rest are built at idle moments.
    this.prewarmSpaces();
    this.reverbSend = c.createGain();
    this.reverbSend.gain.value = 0.22;
    this.verbs = [c.createConvolver(), c.createConvolver()];
    this.verbGains = [c.createGain(), c.createGain()];
    // The wet returns are music (only song notes send to them), so they come back in through the
    // music bus: the volume slider, the bus compressor and the dialogue/hit ducks all act on the
    // tails too. Returned straight to master, music at 0 still left reverb and echo audible.
    for (let i = 0; i < 2; i++) {
      this.verbs[i]!.buffer = this.impulseFor('hall');
      this.verbGains[i]!.gain.value = i === 0 ? 1 : 0;
      this.reverbSend.connect(this.verbs[i]!).connect(this.verbGains[i]!).connect(this.music);
    }
    this.space = 'hall';
    // Tempo-free slapback/echo delay.
    this.delay = c.createDelay(1.5);
    this.delay.delayTime.value = 0.3;
    const fb = c.createGain();
    fb.gain.value = 0.32;
    this.delayFb = fb;
    const dl = c.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 2400;
    this.delaySend = c.createGain();
    this.delaySend.gain.value = 0.18;
    this.delaySend.connect(this.delay);
    this.delay.connect(dl).connect(fb).connect(this.delay);
    dl.connect(this.music);
    // White noise buffer for drums & effects.
    this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.applyVolumes();
  }

  /** A space's impulse, built on first use. */
  private impulseFor(space: Space): AudioBuffer {
    let b = this.spaces.get(space);
    if (!b) {
      b = impulse(this.ctx!, SPACES[space]);
      this.spaces.set(space, b);
    }
    return b;
  }

  /** Build the remaining impulses one at a time, when the page is idle. */
  private prewarmSpaces(): void {
    const todo = (Object.keys(SPACES) as Space[]).filter((s) => s !== 'hall');
    // requestIdleCallback is missing in older Safari: fall back to a short timer there.
    const ric = (window as Partial<Pick<Window, 'requestIdleCallback'>>).requestIdleCallback?.bind(window);
    const idle = (fn: () => void) => (ric ? ric(fn, { timeout: 2000 }) : setTimeout(fn, 200));
    const next = () => {
      const s = todo.shift();
      if (!s || !this.ctx || this.closing) return;
      this.impulseFor(s);
      idle(next);
    };
    idle(next);
  }

  /**
   * Render into an offline context (dev tooling: the audio evidence renders every song). Builds
   * the whole mix graph on `off`, lets `schedule` queue notes from t = 0, renders, and puts the
   * live graph back untouched. OfflineAudioContext provides every node factory the graph uses;
   * the live-only members (resume, suspend) are never reached on this path, hence the cast.
   */
  async renderOffline(off: OfflineAudioContext, space: Space, schedule: () => void): Promise<AudioBuffer> {
    const saved = {
      ctx: this.ctx, master: this.master, music: this.music, duckNode: this.duckNode, hitDuck: this.hitDuck, sfx: this.sfx,
      verbs: this.verbs, verbGains: this.verbGains, verbActive: this.verbActive, reverbSend: this.reverbSend, delay: this.delay,
      delayFb: this.delayFb, spaces: this.spaces, space: this.space, delaySend: this.delaySend, noise: this.noise, unlocked: this.unlocked,
    };
    try {
      this.ctx = off as unknown as AudioContext;
      this.spaces = new Map();
      this.verbActive = 0;
      this.build();
      this.unlocked = true;
      this.setSpace(space);
      schedule();
      return await off.startRendering();
    } finally {
      Object.assign(this, saved);
    }
  }

  /** Move the music into a different acoustic space (reverb character and echo). */
  setSpace(space: Space): void {
    if (!this.ctx || space === this.space) return;
    const sp = SPACES[space];
    const t = this.ctx.currentTime;
    // Load the new space into the idle convolver and crossfade over ~0.5 s.
    const next = 1 - this.verbActive;
    this.verbs[next]!.buffer = this.impulseFor(space);
    this.verbGains[next]!.gain.cancelScheduledValues(t);
    this.verbGains[next]!.gain.setTargetAtTime(1, t, 0.15);
    this.verbGains[this.verbActive]!.gain.cancelScheduledValues(t);
    this.verbGains[this.verbActive]!.gain.setTargetAtTime(0, t, 0.15);
    this.verbActive = next;
    this.delay.delayTime.setTargetAtTime(sp.echo, t, 0.05);
    this.delayFb.gain.setTargetAtTime(sp.feedback, t, 0.05);
    this.space = space;
  }

  /** Dip the music under dialogue. Calls nest; every `duck(true)` needs a `duck(false)`. */
  duck(on: boolean): void {
    this.ducks = Math.max(0, this.ducks + (on ? 1 : -1));
    if (!this.ctx) return;
    this.duckNode.gain.setTargetAtTime(this.ducks > 0 ? 0.55 : 1, this.ctx.currentTime, on ? 0.08 : 0.25);
  }

  /** Briefly pull the music down under a big hit so the impact reads, then let it swell back. */
  private lastHitDuck = -1;
  duckForHit(depth = 0.6): void {
    if (!this.ctx) return;
    const g = this.hitDuck.gain, t = this.ctx.currentTime;
    // One dip per quarter second at most: a chain of crits shouldn't pump the score.
    if (t - this.lastHitDuck < 0.25) return;
    this.lastHitDuck = t;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(depth, t + 0.02);
    g.setTargetAtTime(1, t + 0.16, 0.18);
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.music.gain.setTargetAtTime(settings.musicVol * 0.78, t, 0.05);
    this.sfx.gain.setTargetAtTime(settings.sfxVol * 0.7, t, 0.05);
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /**
   * A song's air: filtered noise very low in the mix, breathing slowly, like rain on glass or tape
   * hiss. The quiet cues had almost nothing above 6 kHz; this puts a sheen over them without a
   * new part. Returns the source so the caller can stop it.
   */
  airBed(dest: AudioNode, level: number, at: number, until?: number): AudioBufferSourceNode | null {
    const c = this.ctx;
    if (!c) return null;
    const src = this.noiseSource();
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6500;
    hp.Q.value = 0.6;
    const g = c.createGain();
    g.gain.value = level;
    const lfo = c.createOscillator();
    const lg = c.createGain();
    lfo.frequency.value = 0.09;
    lg.gain.value = level * 0.35;
    lfo.connect(lg).connect(g.gain);
    src.connect(hp).connect(g).connect(dest);
    src.start(at);
    lfo.start(at);
    if (until !== undefined) {
      src.stop(until);
      lfo.stop(until);
    }
    src.onended = () => {
      try {
        lfo.stop();
      } catch {
        /* already stopped */
      }
      g.disconnect();
    };
    return src;
  }

  noiseSource(): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    return s;
  }

  suspend(): void {
    // Firefox rejects a pending suspend/resume with InvalidStateError when the page navigates
    // away (bug 1528319); that's expected, not an error.
    if (this.ctx?.state === 'running') this.ctx.suspend().catch(() => undefined);
  }

  /** At most one resume in flight: every keypress calls unlock, and each would queue another. */
  private waking: Promise<void> | null = null;
  private wake(): void {
    if (!this.ctx || this.waking) return;
    this.waking = this.ctx
      .resume()
      .catch(() => undefined)
      .finally(() => {
        this.waking = null;
      });
  }

  /** Leaving the page: go quiet and make no more audio calls. */
  close(): void {
    this.closing = true;
    this.unlocked = false;
  }

  /**
   * An audio call failed because the document is going away (Firefox throws InvalidStateError
   * from navigation start, before pagehide): close quietly. Anything else is a real error.
   */
  gone(e: unknown): boolean {
    if (!(e instanceof DOMException) || e.name !== 'InvalidStateError') return false;
    this.close();
    return true;
  }

  /** Back from the back/forward cache: the context is still ours. */
  reopen(): void {
    if (!this.closing) return;
    this.closing = false;
    this.unlocked = !!this.ctx;
  }

  resume(): void {
    if (this.ctx?.state === 'suspended' && this.unlocked) this.wake();
  }
}

export const audio = new AudioEngine();

export function midiToFreq(m: number): number {
  return 440 * 2 ** ((m - 69) / 12);
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
export type InstId = 'lead' | 'lead2' | 'reed' | 'pluck' | 'twang' | 'arp' | 'bass' | 'sub' | 'pad' | 'bell' | 'choir' | 'organ' | 'kick' | 'snare' | 'hat' | 'ohat' | 'clap' | 'tom' | 'crash' | 'shaker';

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

/** A fixed stereo position for one voice inside a patch. */
function spread(c: AudioContext, p: number): StereoPannerNode {
  const n = c.createStereoPanner();
  n.pan.value = p;
  return n;
}

/**
 * Where each instrument sits in the stereo field: rhythm section and bass centred, lead just
 * left, plucks and bells right, arps drifting side to side, chords spread by pitch.
 */
/** Patches that spread their own oscillators across the stereo field; they bypass placement(). */
const SELF_SPREAD = new Set<InstId>(['lead', 'lead2', 'pad', 'choir', 'organ']);

function placement(inst: InstId, freq: number, t: number): number {
  switch (inst) {
    case 'bass': case 'sub': case 'kick': case 'snare': return 0;
    case 'clap': return 0.1;
    case 'lead': case 'lead2': return -0.12;
    case 'reed': return -0.18;
    case 'pluck': return 0.32;
    case 'twang': return -0.28;
    case 'bell': return 0.24;
    case 'arp': return Math.sin(t * 1.7) * 0.5;
    case 'hat': case 'ohat': return 0.3;
    case 'shaker': return -0.32;
    case 'crash': return -0.2;
    case 'tom': return Math.max(-0.45, Math.min(0.45, (140 - freq) / 180));
    default: {
      const midi = 69 + 12 * Math.log2(Math.max(20, freq) / 440);
      return Math.max(-0.3, Math.min(0.3, (midi - 60) / 30));
    }
  }
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
      f.frequency.setTargetAtTime(2500, t + 0.05, 0.2);
      const mix = c.createGain();
      mix.gain.value = 0.5;
      o1.connect(spread(c, -0.35)).connect(mix);
      o2.connect(spread(c, 0.35)).connect(mix);
      mix.connect(f).connect(out);
      const end = env(out, t, 0.01, 0.15, 0.75, dur, 0.12, 0.16 * vel);
      for (const o of [o1, o2, lfo]) { o.start(t); o.stop(end); }
      chain = { out, end };
      break;
    }
    case 'reed': {
      // Breathy reed (lounge sax): saw + thin square through a nasal formant, slow swell,
      // late vibrato, and a puff of breath noise on the attack.
      const o1 = c.createOscillator();
      const o2 = c.createOscillator();
      o1.type = 'sawtooth';
      o2.type = 'square';
      o1.frequency.value = freq;
      o2.frequency.value = freq * 0.998;
      const lfo = c.createOscillator();
      const lg = c.createGain();
      lfo.frequency.value = 4.8;
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(0, t + Math.min(0.25, dur * 0.4));
      lg.gain.linearRampToValueAtTime(freq * 0.009, t + Math.min(0.6, dur * 0.8));
      lfo.connect(lg);
      lg.connect(o1.frequency);
      lg.connect(o2.frequency);
      const sq = c.createGain();
      sq.gain.value = 0.35;
      const formant = c.createBiquadFilter();
      formant.type = 'bandpass';
      formant.frequency.value = 1150;
      formant.Q.value = 1.6;
      const body = c.createBiquadFilter();
      body.type = 'lowpass';
      body.frequency.setValueAtTime(1400, t);
      body.frequency.linearRampToValueAtTime(2600 + vel * 800, t + 0.08);
      o1.connect(formant);
      o2.connect(sq).connect(formant);
      o1.connect(body);
      formant.connect(out);
      body.connect(out);
      const breath = audio.noiseSource();
      const bf = c.createBiquadFilter();
      bf.type = 'bandpass';
      bf.frequency.value = 2800;
      bf.Q.value = 0.8;
      const bg = c.createGain();
      bg.gain.setValueAtTime(0.0001, t);
      bg.gain.linearRampToValueAtTime(0.035 * vel, t + 0.03);
      bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      breath.connect(bf).connect(bg).connect(out);
      const end = env(out, t, 0.045, 0.2, 0.8, dur, 0.18, 0.13 * vel);
      for (const o of [o1, o2, lfo]) { o.start(t); o.stop(end); }
      breath.start(t);
      breath.stop(t + 0.2);
      chain = { out, end };
      break;
    }
    case 'twang': {
      // Rusty steel string: a saw that bends down into pitch, a resonant filter snap, and a
      // quieter octave for the metallic ring.
      const o = c.createOscillator();
      const hi = c.createOscillator();
      o.type = 'sawtooth';
      hi.type = 'triangle';
      o.frequency.setValueAtTime(freq * 1.035, t);
      o.frequency.exponentialRampToValueAtTime(freq, t + 0.07);
      hi.frequency.setValueAtTime(freq * 2.07, t);
      hi.frequency.exponentialRampToValueAtTime(freq * 2, t + 0.07);
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 8;
      f.frequency.setValueAtTime(3400 + vel * 900, t);
      f.frequency.exponentialRampToValueAtTime(1300, t + 0.28);
      const hg = c.createGain();
      hg.gain.value = 0.25;
      o.connect(f);
      hi.connect(hg).connect(f);
      f.connect(out);
      const end = env(out, t, 0.002, 0.2, 0.22, Math.min(dur, 0.25), 0.16, 0.1 * vel);
      for (const x of [o, hi]) { x.start(t); x.stop(end); }
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
      f.frequency.setValueAtTime(inst === 'arp' ? 5200 : 3800, t);
      f.frequency.exponentialRampToValueAtTime(1800, t + 0.18);
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
      f.frequency.value = inst === 'choir' ? 2000 : inst === 'organ' ? 3200 : 2100;
      f.Q.value = inst === 'choir' ? 6 : 1;
      const oscs: OscillatorNode[] = [];
      const detunes = inst === 'organ' ? [0, 1200, 1902] : [-9, 0, 9];
      detunes.forEach((dt, i) => {
        const o = c.createOscillator();
        o.type = inst === 'organ' ? 'sine' : inst === 'choir' ? 'triangle' : 'sawtooth';
        o.frequency.value = freq;
        o.detune.value = dt;
        o.connect(spread(c, (i - 1) * 0.55)).connect(f);
        oscs.push(o);
      });
      if (inst === 'choir') {
        // Formant-ish shimmer
        const lfo = c.createOscillator();
        const lg = c.createGain();
        lfo.frequency.value = 0.8;
        lg.gain.value = 300;
        lfo.connect(lg).connect(f.frequency);
        oscs.push(lfo);
      }
      if (inst === 'organ') {
        // The organ's drawbars stack octaves over the chord root; under a boss's bass and arp its
        // low end was mud. Cut below 200 Hz.
        const hp = c.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 200;
        f.connect(hp).connect(out);
      } else f.connect(out);
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
  let pan: AudioNode;
  if (SELF_SPREAD.has(inst)) {
    pan = chain.out;
    pan.connect(dest);
  } else {
    const p = c.createStereoPanner();
    p.pan.value = placement(inst, freq, t);
    chain.out.connect(p).connect(dest);
    pan = p;
  }
  if (sends.rev) {
    const g = c.createGain();
    g.gain.value = sends.rev;
    pan.connect(g).connect(audio.reverbSend);
  }
  if (sends.del) {
    const g = c.createGain();
    g.gain.value = sends.del;
    pan.connect(g).connect(audio.delaySend);
  }
}
