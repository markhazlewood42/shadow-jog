/**
 * GPU effects, as the game sees them. Scenes ask for moments (a shockwave where a blow lands, a
 * colour split on a critical, a burst of embers), draw what should glow into the glow layer, and
 * draw their UI into the UI layer; the WebGL presenter (engine/gl/presenter.ts) turns all of it
 * into the final frame. With GPU effects off (Options) or no WebGL, `active` is false, every call
 * here does nothing, and the game draws exactly as it did before this layer existed.
 *
 * Coordinates are the back buffer's (W×H from engine/game.ts, y down). Durations are frames at 60/s.
 */
import type { Ctx } from './canvas';
// game.ts imports this module, so the two form a cycle: W and H are read only inside methods, at
// call time, never while this module loads (at that moment they would still be uninitialized).
import { H, W } from './game';
import { type EmitterPreset, ParticleSim } from './particles';

/** A ring of distortion spreading out from a point. */
export interface Shock {
  x: number;
  y: number;
  /** Frames since it started, and how long it runs. */
  t: number;
  life: number;
  /** Peak displacement in pixels, and the ring's thickness. */
  strength: number;
  width: number;
  /** How far the ring travels over its life, in pixels. */
  reach: number;
}

/** The most shockwaves at once (the shader has this many slots). */
export const MAX_SHOCKS = 4;

/** Heat shimmer over a patch of the picture (fire, a hot muzzle, a furnace), rising as it wavers. */
export interface Haze {
  x: number;
  y: number;
  radius: number;
  /** Peak waver in pixels. */
  strength: number;
  t: number;
  life: number;
}
/** The most heat hazes at once. */
export const MAX_HAZES = 4;

/** Corruption over a rectangle (a hack, a glitch): slices of it slide sideways and split colour. */
export interface Glitch {
  x: number;
  y: number;
  /** Width and height of the rectangle, centred on (x, y). */
  w: number;
  h: number;
  /** How far slices slide, in pixels. */
  strength: number;
  t: number;
  life: number;
  /** Its own pattern (two glitches don't slice in step). */
  seed: number;
}
/** The most glitches at once. */
export const MAX_GLITCHES = 2;

/**
 * How much of the haze, glitch or dim shows `t` frames into a `life`-frame run: in over `fadeIn`
 * frames, out over the last `fadeOut`.
 */
export function envelope(t: number, life: number, fadeIn: number, fadeOut: number): number {
  if (t < 0 || t >= life) return 0;
  return Math.min(1, t / Math.max(1, fadeIn), (life - t) / Math.max(1, fadeOut));
}

class PostFx {
  /** True while the WebGL presenter is drawing the frames (Display sets it). */
  active = false;
  /** Player comfort settings: shockwaves follow Screen shake, pulses follow Screen flash (0 = off). */
  motion = 1;
  intensity = 1;
  /** Effect frames per real frame (the battle's animation clock; 1 elsewhere). */
  rate = 1;
  /** How strongly the glow layer blooms, and how dark the corners are (scenes set these). */
  bloom = 1;
  vignette = 0.22;
  readonly shocks: Shock[] = [];
  /**
   * Colour split: pixels of offset, easing out, and the point it spreads from. `aberrate()` always
   * sets the point, and the presenter ignores it while the offset is 0, so the point starts at 0
   * rather than at the screen center (reading W and H here, while the module loads, would hit the
   * import cycle with game.ts).
   */
  aberration = 0;
  aberrationX = 0;
  aberrationY = 0;
  /** Extra bloom for a moment (a combo landing), easing out. */
  pulse = 0;
  readonly hazes: Haze[] = [];
  readonly glitches: Glitch[] = [];
  /**
   * The stage dimmed around a big spell, so its light stands out: how dark (0..1) at full, and how
   * far through its run. Anything glowing stays lit (the presenter spares the light layer).
   */
  dimAmount = 0;
  dimT = 0;
  dimLife = 0;
  /** Frames the effects clock has run (the haze and glitch patterns move with it). */
  time = 0;
  /** The game-wide flash, drawn by the presenter over the world but not the UI. Set each frame by
   *  Game.render (fades stay in the UI layer, under the notices, as in 2D). */
  flashColor = '#ffffff';
  flashAlpha = 0;
  /** GPU effects switched themselves off this session because the game couldn't keep up (main.ts). */
  suspended = false;
  readonly particles = new ParticleSim(4096, 7);
  /** Particles show only inside this rectangle (the battlefield, above the status cards), or anywhere. */
  clip: { x: number; y: number; w: number; h: number } | null = null;
  /** The layers the presenter composites (Display provides them while active). Draw into the glow
   *  layer through `glowLayer()`, which marks it used (an unused one isn't cleared or blurred). */
  glow: Ctx | null = null;
  ui: Ctx | null = null;
  glowUsed = false;

  /** The glow layer to draw into this frame, or null with GPU effects off. */
  glowLayer(): Ctx | null {
    if (!this.glow) return null;
    this.glowUsed = true;
    return this.glow;
  }

  /** A shockwave from (x, y): `strength` in pixels of push, `reach` how far it spreads. */
  shock(x: number, y: number, opts: { strength?: number; reach?: number; life?: number; width?: number } = {}): void {
    if (!this.active || this.motion <= 0) return;
    const s: Shock = { x, y, t: 0, life: opts.life ?? 26, strength: (opts.strength ?? 3) * this.motion, width: opts.width ?? 10, reach: opts.reach ?? 90 };
    if (this.shocks.length >= MAX_SHOCKS) this.shocks.shift();
    this.shocks.push(s);
  }

  /** Split the colour channels by `amount` pixels, spreading from (x, y; the screen center by default), easing out. */
  aberrate(amount: number, x = W / 2, y = H / 2): void {
    if (!this.active || this.intensity <= 0) return;
    const a = amount * this.intensity;
    if (a < this.aberration) return;
    this.aberration = a;
    this.aberrationX = x;
    this.aberrationY = y;
  }

  /** Heat shimmer around (x, y) for `life` frames. */
  haze(x: number, y: number, opts: { radius?: number; strength?: number; life?: number } = {}): void {
    if (!this.active || this.motion <= 0) return;
    if (this.hazes.length >= MAX_HAZES) this.hazes.shift();
    this.hazes.push({ x, y, t: 0, radius: opts.radius ?? 40, strength: (opts.strength ?? 1.5) * this.motion, life: opts.life ?? 60 });
  }

  /** Corrupt a w x h rectangle centred on (x, y) for `life` frames. */
  glitch(x: number, y: number, opts: { w?: number; h?: number; strength?: number; life?: number } = {}): void {
    if (!this.active || this.motion <= 0) return;
    if (this.glitches.length >= MAX_GLITCHES) this.glitches.shift();
    this.glitches.push({ x, y, t: 0, w: opts.w ?? 90, h: opts.h ?? 60, strength: (opts.strength ?? 6) * this.motion, life: opts.life ?? 24, seed: Math.random() * 100 });
  }

  /** Dim the stage by `amount` (0..1) for `life` frames, easing in and out; a deeper dim wins. */
  dim(amount: number, life = 60): void {
    if (!this.active) return;
    const now = this.dimAmount * envelope(this.dimT, this.dimLife, 10, 16);
    if (amount < now) return;
    this.dimAmount = amount;
    this.dimT = 0;
    this.dimLife = life;
  }

  /** How dim the stage is this frame. */
  get dimNow(): number {
    return this.dimAmount * envelope(this.dimT, this.dimLife, 10, 16);
  }

  /** Brighten the bloom for a moment. */
  flare(amount: number): void {
    if (!this.active || this.intensity <= 0) return;
    this.pulse = Math.max(this.pulse, amount * this.intensity);
  }

  /** Calls waiting on the effects clock (a moment's delayed layers). */
  private pending: { t: number; fn: () => void }[] = [];

  /** Run `fn` after `frames` frames of the effects clock (dropped if the effects are cleared first). */
  later(frames: number, fn: () => void): void {
    if (!this.active) return;
    this.pending.push({ t: frames, fn });
  }

  /** A particle burst at (x, y). */
  emit(p: EmitterPreset, x: number, y: number, opts: { angle?: number; scale?: number } = {}): void {
    if (!this.active) return;
    this.particles.burst(p, x, y, opts);
  }

  /** One real frame: shocks spread, pulses fade, particles move (on the scene's clock). */
  update(): void {
    const dt = this.rate;
    let keep = 0;
    for (const s of this.shocks) {
      s.t += dt;
      if (s.t < s.life) this.shocks[keep++] = s;
    }
    this.shocks.length = keep;
    this.time += dt;
    const age = <T extends { t: number; life: number }>(list: T[]) => {
      let k = 0;
      for (const h of list) {
        h.t += dt;
        if (h.t < h.life) list[k++] = h;
      }
      list.length = k;
    };
    age(this.hazes);
    age(this.glitches);
    if (this.dimLife) {
      this.dimT += dt;
      if (this.dimT >= this.dimLife) this.dimAmount = this.dimLife = this.dimT = 0;
    }
    this.aberration = this.aberration < 0.05 ? 0 : this.aberration * 0.86 ** dt;
    this.pulse = this.pulse < 0.01 ? 0 : this.pulse * 0.9 ** dt;
    if (this.particles.count) this.particles.step(dt);
    if (this.pending.length) {
      let keepP = 0;
      const due: (() => void)[] = [];
      for (const p of this.pending) {
        p.t -= dt;
        if (p.t <= 0) due.push(p.fn);
        else this.pending[keepP++] = p;
      }
      this.pending.length = keepP;
      for (const fn of due) fn();
    }
  }

  /** Drop everything in flight (a scene change: effects don't follow you out of a fight). */
  clear(): void {
    this.shocks.length = 0;
    this.hazes.length = 0;
    this.glitches.length = 0;
    this.dimAmount = this.dimLife = this.dimT = 0;
    this.aberration = 0;
    this.pulse = 0;
    this.particles.clear();
    this.pending.length = 0;
    this.clip = null;
    this.rate = 1;
  }
}

export const postfx = new PostFx();
