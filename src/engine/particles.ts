/**
 * Particles for the GPU effects layer: the simulation only (plain arrays, no WebGL), so it can be
 * tested and so the presenter just reads the results. Up to `cap` particles live at once, stored
 * as parallel typed arrays (structure of arrays): nothing is allocated per particle or per frame.
 *
 * An emitter preset (src/data/fx.json, tuned in the FX lab) says how a burst looks: how many, how fast and which way,
 * how long they live, and how size, colour and opacity change over that life. `burst(preset, x, y)`
 * spawns one; `step(rate)` moves everything on; `write(out)` packs what's alive for drawing.
 *
 * Units: positions in back-buffer pixels (480×270), speeds in pixels per frame, time in frames.
 */

/** How a particle is drawn (the presenter's fragment shader makes each shape). */
export type ParticleShape = 'soft' | 'dot' | 'spark' | 'square' | 'ring';
export const SHAPE_ID: Record<ParticleShape, number> = { soft: 0, dot: 1, spark: 2, square: 3, ring: 4 };

export interface EmitterPreset {
  /** Particles per burst, a range. */
  count: readonly [number, number];
  /** How long each lives, in frames. */
  life: readonly [number, number];
  /** Launch speed, pixels per frame. */
  speed: readonly [number, number];
  /** Launch direction in degrees (0 = right, 90 = down, -90 = up), and the spread around it (360 = every way). */
  angle?: number;
  spread?: number;
  /** Spawn anywhere within this radius of the point. */
  radius?: number;
  /** Pull per frame, pixels per frame² (positive = down; negative rises, like heat). */
  gravity?: number;
  /** Speed kept each frame (1 = no drag). */
  drag?: number;
  /** Size in pixels at birth and at death (a spark's width; its length comes from `stretch`). */
  size: readonly [number, number];
  /** Colour over life, evenly spaced from birth to death ('#rrggbb'). */
  colors: readonly string[];
  /** Opacity at birth and at death. */
  alpha?: readonly [number, number];
  shape: ParticleShape;
  /** 'add' glows (light adds up); 'alpha' covers (smoke, debris). */
  blend?: 'add' | 'alpha';
  /** A spark is drawn this many frames of travel long, pointing the way it flies. */
  stretch?: number;
  /** Turning speed in radians per frame (squares and rings), a range around zero. */
  spin?: number;
  /** Sideways drift: amplitude in pixels. */
  wobble?: number;
  /** Squares snap to whole pixels, so debris matches the pixel art. */
  snap?: boolean;
  /**
   * Gather instead of burst: each starts on the edge of `radius` and flies in toward the point
   * (power gathering in a hand before a spell). Life should be about radius / speed.
   */
  inward?: boolean;
}

/** Floats per particle in the packed draw buffer: x, y, width, height, angle, r, g, b, a, shape. */
export const PARTICLE_STRIDE = 10;

interface Compiled {
  preset: EmitterPreset;
  rgb: Float32Array;
  add: boolean;
  shape: number;
}

function hexRgb(hex: string, out: Float32Array, at: number): void {
  const n = Number.parseInt(hex.slice(1), 16);
  out[at] = ((n >> 16) & 255) / 255;
  out[at + 1] = ((n >> 8) & 255) / 255;
  out[at + 2] = (n & 255) / 255;
}

export class ParticleSim {
  readonly cap: number;
  /** How many are alive; they occupy slots 0..count-1 (a dead one is swapped with the last). */
  count = 0;
  private x: Float32Array;
  private y: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private ang: Float32Array;
  private spin: Float32Array;
  private seed: Float32Array;
  private kind: Uint16Array;
  /** Each distinct preset once, in the order first used (particles refer to it by index). */
  private kinds: Compiled[] = [];
  private kindOf = new Map<EmitterPreset, number>();
  /** What write() returns (reused: nothing allocated per frame). */
  private counts = { add: 0, alpha: 0 };
  /** Deterministic noise for launches (a small LCG): the same bursts from the same seed. */
  private rs: number;

  constructor(cap = 4096, seed = 1) {
    this.cap = cap;
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.age = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.ang = new Float32Array(cap);
    this.spin = new Float32Array(cap);
    this.seed = new Float32Array(cap);
    this.kind = new Uint16Array(cap);
    this.rs = seed >>> 0 || 1;
  }

  private rand(): number {
    this.rs = (Math.imul(this.rs, 1664525) + 1013904223) >>> 0;
    return this.rs / 4294967296;
  }

  private range(r: readonly [number, number]): number {
    return r[0] + (r[1] - r[0]) * this.rand();
  }

  private compile(p: EmitterPreset): number {
    const known = this.kindOf.get(p);
    if (known !== undefined) return known;
    // Presets are compiled by identity, and the FX lab makes a new one for every edit: with
    // nothing alive, start the table over rather than let it grow.
    if (this.count === 0 && this.kinds.length > 64) {
      this.kinds.length = 0;
      this.kindOf.clear();
    }
    const rgb = new Float32Array(Math.max(1, p.colors.length) * 3);
    p.colors.forEach((c, i) => {
      hexRgb(c, rgb, i * 3);
    });
    const id = this.kinds.length;
    this.kinds.push({ preset: p, rgb, add: (p.blend ?? 'add') === 'add', shape: SHAPE_ID[p.shape] });
    this.kindOf.set(p, id);
    return id;
  }

  /**
   * Spawn a burst at (x, y). `angle` (degrees) overrides the preset's direction, e.g. away from the
   * attacker; `scale` multiplies the count (a bigger hit, a bigger burst). When full, the oldest
   * slots aren't touched: new particles are simply dropped.
   */
  burst(p: EmitterPreset, x: number, y: number, opts: { angle?: number; scale?: number } = {}): number {
    const k = this.compile(p);
    const n = Math.round(this.range(p.count) * (opts.scale ?? 1));
    const dir = ((opts.angle ?? p.angle ?? 0) * Math.PI) / 180;
    const spread = (((p.spread ?? 360) * Math.PI) / 180) / 2;
    let made = 0;
    for (let i = 0; i < n && this.count < this.cap; i++) {
      const j = this.count++;
      const ra = this.rand() * Math.PI * 2;
      // Gathering: on the ring's edge, heading for the middle. Bursting: anywhere inside, any way
      // within the spread.
      const r = (p.radius ?? 0) * (p.inward ? 0.75 + this.rand() * 0.25 : Math.sqrt(this.rand()));
      this.x[j] = x + Math.cos(ra) * r;
      this.y[j] = y + Math.sin(ra) * r;
      const a = p.inward ? ra + Math.PI + (this.rand() * 2 - 1) * spread * 0.1 : dir + (this.rand() * 2 - 1) * spread;
      const s = this.range(p.speed);
      this.vx[j] = Math.cos(a) * s;
      this.vy[j] = Math.sin(a) * s;
      this.age[j] = 0;
      this.life[j] = Math.max(1, this.range(p.life));
      this.ang[j] = this.rand() * Math.PI * 2;
      this.spin[j] = (this.rand() * 2 - 1) * (p.spin ?? 0);
      this.seed[j] = this.rand() * 100;
      this.kind[j] = k;
      made++;
    }
    return made;
  }

  /** Advance everything by `dt` frames (the battle's animation clock can run slower than real time). */
  step(dt = 1): void {
    let i = 0;
    while (i < this.count) {
      const age = (this.age[i] ?? 0) + dt;
      if (age >= (this.life[i] ?? 0)) {
        this.kill(i);
        continue;
      }
      const c = this.kinds[this.kind[i] ?? 0];
      if (!c) {
        this.kill(i);
        continue;
      }
      this.age[i] = age;
      const p = c.preset;
      const drag = p.drag ?? 1;
      const keep = drag === 1 ? 1 : drag ** dt;
      let vx = (this.vx[i] ?? 0) * keep, vy = (this.vy[i] ?? 0) * keep;
      vy += (p.gravity ?? 0) * dt;
      this.vx[i] = vx;
      this.vy[i] = vy;
      if (p.wobble) vx += Math.cos(age * 0.2 + (this.seed[i] ?? 0)) * p.wobble * 0.2;
      this.x[i] = (this.x[i] ?? 0) + vx * dt;
      this.y[i] = (this.y[i] ?? 0) + vy * dt;
      this.ang[i] = (this.ang[i] ?? 0) + (this.spin[i] ?? 0) * dt;
      i++;
    }
  }

  /** Remove particle i by moving the last one into its slot. */
  private kill(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.x[i] = this.x[last] ?? 0;
    this.y[i] = this.y[last] ?? 0;
    this.vx[i] = this.vx[last] ?? 0;
    this.vy[i] = this.vy[last] ?? 0;
    this.age[i] = this.age[last] ?? 0;
    this.life[i] = this.life[last] ?? 0;
    this.ang[i] = this.ang[last] ?? 0;
    this.spin[i] = this.spin[last] ?? 0;
    this.seed[i] = this.seed[last] ?? 0;
    this.kind[i] = this.kind[last] ?? 0;
  }

  clear(): void {
    this.count = 0;
  }

  /**
   * Pack the living particles for drawing: additive ones first, then covering ones, each
   * PARTICLE_STRIDE floats. Returns how many of each were written.
   */
  write(out: Float32Array): { add: number; alpha: number } {
    const counts = this.counts;
    let n = 0;
    const max = Math.floor(out.length / PARTICLE_STRIDE);
    let add = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < this.count && n < max; i++) {
        const c = this.kinds[this.kind[i] ?? 0];
        if (!c || c.add !== (pass === 0)) continue;
        this.pack(i, c, out, n++ * PARTICLE_STRIDE);
      }
      if (pass === 0) add = n;
    }
    counts.add = add;
    counts.alpha = n - add;
    return counts;
  }

  private pack(i: number, c: Compiled, out: Float32Array, o: number): void {
    const p = c.preset;
    const t = Math.min(1, (this.age[i] ?? 0) / (this.life[i] ?? 1));
    // Colour: across the stops, evenly spaced over life.
    const stops = p.colors.length;
    const f = t * Math.max(0, stops - 1);
    const s0 = Math.min(stops - 1, Math.floor(f)), s1 = Math.min(stops - 1, s0 + 1), k = f - s0;
    const size = p.size[0] + (p.size[1] - p.size[0]) * t;
    const a0 = p.alpha?.[0] ?? 1, a1 = p.alpha?.[1] ?? 0;
    let x = this.x[i] ?? 0, y = this.y[i] ?? 0;
    let w = size, h = size, ang = this.ang[i] ?? 0;
    if (c.shape === SHAPE_ID.spark) {
      // Length along the flight; the quad's x axis points the way it flies.
      const vx = this.vx[i] ?? 0, vy = this.vy[i] ?? 0;
      w = Math.max(size, Math.hypot(vx, vy) * (p.stretch ?? 3));
      ang = Math.atan2(vy, vx);
    }
    if (p.snap) {
      x = Math.round(x);
      y = Math.round(y);
      w = h = Math.max(1, Math.round(size));
      ang = 0;
    }
    out[o] = x;
    out[o + 1] = y;
    out[o + 2] = w;
    out[o + 3] = h;
    out[o + 4] = ang;
    out[o + 5] = (c.rgb[s0 * 3] ?? 1) + ((c.rgb[s1 * 3] ?? 1) - (c.rgb[s0 * 3] ?? 1)) * k;
    out[o + 6] = (c.rgb[s0 * 3 + 1] ?? 1) + ((c.rgb[s1 * 3 + 1] ?? 1) - (c.rgb[s0 * 3 + 1] ?? 1)) * k;
    out[o + 7] = (c.rgb[s0 * 3 + 2] ?? 1) + ((c.rgb[s1 * 3 + 2] ?? 1) - (c.rgb[s0 * 3 + 2] ?? 1)) * k;
    out[o + 8] = a0 + (a1 - a0) * t;
    out[o + 9] = c.shape;
  }
}
