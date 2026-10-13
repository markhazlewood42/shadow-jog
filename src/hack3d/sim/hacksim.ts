/**
 * The hack simulation: PURE TypeScript (docs/engine/interfaces.md section 12, "the hack simulation
 * is pure and DOM-free"). It knows nothing about Three, Pixi or the browser, so Vitest runs it the
 * way it runs `src/battle`.
 *
 * It is FIXED-STEP and SEEDED. One call to `step()` is one tick (1/60 s). The same seed and the same
 * number of steps always give the same state, on every machine. Everything random comes from one
 * seeded generator (`Rng`, mulberry32), drawn in a fixed order.
 *
 * The picture it describes (a first draft, for Mark's review): the player's persona runs forward
 * along a neon grid and weaves from side to side. Pieces of ICE (the defences of a system, in
 * Shadowrun Matrix terms) drift down the grid toward the persona. Each time a piece of ICE passes
 * through the persona it adds to TRACE. If TRACE reaches the limit the hack FAILS. If the time runs
 * out first, it SUCCEEDS. There is no input yet (the engine has none until M1): the persona is on
 * autopilot, so a hack plays out the same way every time for a given definition.
 *
 * Coordinates are Three's: x to the right, y up, and the persona runs toward -z. The persona stays
 * at z = 0 and the WORLD moves toward it, so no value in here ever grows large.
 */
// The engine's seeded generator, from its core (level 0: no Pixi, no Three, no DOM). The sim must import nothing from `src/engine`, which M8 deletes.
import { Rng } from '../../sje/core/rng';

/** The shapes of ICE the look draws. The simulation only names them. */
export const ICE_KINDS = ['icosahedron', 'cube', 'chip', 'shard', 'shard', 'shard'] as const;
export type IceKind = (typeof ICE_KINDS)[number];

export interface SimDef {
  /** Seeds every random choice. */
  seed: number;
  /** How long the hack lasts, in ticks (60 per second). The hack succeeds when this runs out. */
  ticks: number;
  /** How many pieces of ICE (1 to 5). */
  iceCount: number;
  /** TRACE (0 to 100) at which the hack fails: it fails the tick TRACE reaches this. TRACE stops at 100, so a limit ABOVE 100 can never fail. */
  traceLimit: number;
  /** TRACE added by each hit. */
  hitCost: number;
}

export interface IceState {
  kind: IceKind;
  x: number;
  y: number;
  z: number;
  /** Rotation in radians. */
  rx: number;
  ry: number;
  rz: number;
  /** Radians per tick. */
  spinX: number;
  spinY: number;
  spinZ: number;
  /** Bobbing phase and base height. */
  phase: number;
  baseY: number;
  /** True while this piece has already crossed the persona on this pass (one hit chance per pass). */
  spent: boolean;
}

export interface PersonaState {
  x: number;
  /** Small up and down motion of a runner. */
  bob: number;
  /** Stride phase: the legs swing with this. */
  stride: number;
  /** Sideways lean, from how fast x is changing. */
  lean: number;
}

export type SimStatus = 'running' | 'success' | 'fail';

/**
 * Everything the sim needs to continue from a tick (editor contract item d). Plain data: it survives a JSON round trip, and it shares no object with the
 * sim it came from. The weave is not in it: it is derived from the seed in the constructor, so a restore goes into a sim made with the same definition.
 */
export interface HackSimSnapshot {
  tick: number;
  travel: number;
  trace: number;
  hits: number;
  status: SimStatus;
  persona: PersonaState;
  ice: IceState[];
  /** The state of the seeded generator (mulberry32 has one 32-bit number). */
  rng: number;
}

/** How fast the world comes at the persona, in units per tick (21 units per second). */
export const RUN_SPEED = 0.35;
/** The z the persona stands at, and how far ahead new ICE appears. */
export const PERSONA_Z = 0;
export const SPAWN_NEAR = -34;
export const SPAWN_FAR = -78;
/** ICE that has gone this far behind the persona (toward the camera) is respawned ahead. */
export const DESPAWN_Z = 3;
/** The persona is hit when ICE passes z = 0 within this sideways distance. */
export const HIT_RADIUS = 2.2;

export class HackSim {
  tick = 0;
  /** Total distance the world has moved past the persona (the grid scrolls by this). */
  travel = 0;
  trace = 0;
  hits = 0;
  status: SimStatus = 'running';
  readonly persona: PersonaState = { x: 0, bob: 0, stride: 0, lean: 0 };
  readonly ice: IceState[] = [];
  private readonly rng: Rng;
  private readonly weave: { a1: number; a2: number; f1: number; f2: number; p2: number };

  constructor(readonly def: SimDef) {
    this.rng = new Rng(def.seed);
    // The weave is part of the seed: a different seed runs a different line.
    this.weave = { a1: 4.2, a2: 1.4, f1: 0.021 + this.rng.range(0, 0.006), f2: 0.053 + this.rng.range(0, 0.01), p2: this.rng.range(0, 6.28) };
    const n = Math.max(1, Math.min(5, Math.round(def.iceCount)));
    for (let i = 0; i < n; i++) {
      const kind = ICE_KINDS[i % ICE_KINDS.length] ?? 'cube';
      this.ice.push(this.spawn(kind, SPAWN_NEAR + (i * (SPAWN_FAR - SPAWN_NEAR)) / n));
    }
    this.updatePersona();
  }

  /** One fixed tick. Does nothing once the hack is over. */
  step(): void {
    if (this.status !== 'running') return;
    this.tick++;
    this.travel += RUN_SPEED;
    const lastX = this.persona.x;
    this.updatePersona();
    this.persona.lean = (this.persona.x - lastX) * 0.9;
    for (const ice of this.ice) this.stepIce(ice);
    if (this.trace >= this.def.traceLimit) this.status = 'fail';
    else if (this.tick >= this.def.ticks) this.status = 'success';
  }

  /** The whole state as plain data (a deep copy). See `HackSimSnapshot`. */
  snapshot(): HackSimSnapshot {
    return {
      tick: this.tick,
      travel: this.travel,
      trace: this.trace,
      hits: this.hits,
      status: this.status,
      persona: { ...this.persona },
      ice: this.ice.map((i) => ({ ...i })),
      rng: this.rng.state,
    };
  }

  /** Replace the whole state with a snapshot of a sim of the same definition. The snapshot is copied: later steps do not change it. */
  restore(s: HackSimSnapshot): void {
    // The Look builds one mesh for each ICE of the constructor: a snapshot with another count would leave ICE with no mesh (never drawn). Refuse it before anything changes.
    if (s.ice.length !== this.ice.length) throw new Error(`HackSim.restore: the snapshot has ${s.ice.length} ICE, this sim has ${this.ice.length} (restore into a sim made with the same definition)`);
    // The other fields too: a status that the definition could not produce would end the scene at once with a result the definition never gives.
    const bad = this.snapshotProblem(s);
    if (bad) throw new Error(`HackSim.restore: ${bad} (restore into a sim made with the same definition)`);
    this.tick = s.tick;
    this.travel = s.travel;
    this.trace = s.trace;
    this.hits = s.hits;
    this.status = s.status;
    Object.assign(this.persona, s.persona);
    this.ice.length = 0;
    for (const i of s.ice) this.ice.push({ ...i });
    this.rng.state = s.rng;
  }

  /** Why a snapshot cannot belong to a sim of this definition, or null. The state must be one that `step` could have reached: a status that fits the tick and the TRACE limit. */
  private snapshotProblem(s: HackSimSnapshot): string | null {
    const { ticks, traceLimit } = this.def;
    if (s.status !== 'running' && s.status !== 'success' && s.status !== 'fail') return `the status "${String(s.status)}" is not running, success or fail`;
    if (!Number.isInteger(s.tick) || s.tick < 0 || s.tick > ticks) return `the tick ${s.tick} is outside 0 to ${ticks}`;
    if (!Number.isFinite(s.travel)) return `the travel ${s.travel} is not a number`;
    if (!Number.isFinite(s.rng)) return `the rng state ${s.rng} is not a number`;
    if (!Number.isFinite(s.trace) || s.trace < 0) return `the trace ${s.trace} is not a number from 0 up`;
    if (s.status === 'fail' && s.trace < traceLimit) return `the status is fail but the trace ${s.trace} is under this sim's limit ${traceLimit}`;
    if (s.status !== 'fail' && s.trace >= traceLimit) return `the trace ${s.trace} is at or over this sim's limit ${traceLimit}, so the status can only be fail`;
    if (s.status === 'running' && s.tick >= ticks) return `the status is running but the tick ${s.tick} is the last one (${ticks})`;
    if (s.status === 'success' && s.tick < ticks) return `the status is success but the tick ${s.tick} is under ${ticks}`;
    return null;
  }

  /** Run `n` ticks (stops early when the hack ends). */
  run(n: number): void {
    for (let i = 0; i < n && this.status === 'running'; i++) this.step();
  }

  /** TRACE as a whole percent, 0 to 100, for the HUD. */
  get tracePercent(): number {
    return Math.min(100, Math.floor(this.trace));
  }

  private updatePersona(): void {
    const t = this.tick;
    const w = this.weave;
    this.persona.x = w.a1 * Math.sin(t * w.f1) + w.a2 * Math.sin(t * w.f2 + w.p2);
    this.persona.stride = t * 0.32;
    this.persona.bob = Math.abs(Math.sin(this.persona.stride)) * 0.18;
  }

  private spawn(kind: IceKind, z: number): IceState {
    const r = this.rng;
    // Draw order is fixed (x, height, spins, phase) so the same seed always gives the same ICE.
    const x = r.range(-8, 8);
    const baseY = r.range(1.6, 3.4);
    return {
      kind,
      x,
      y: baseY,
      z,
      rx: r.range(0, 6.28),
      ry: r.range(0, 6.28),
      rz: r.range(0, 6.28),
      spinX: r.range(0.004, 0.02) * (r.chance(0.5) ? 1 : -1),
      spinY: r.range(0.01, 0.035) * (r.chance(0.5) ? 1 : -1),
      spinZ: r.range(0.002, 0.012) * (r.chance(0.5) ? 1 : -1),
      phase: r.range(0, 6.28),
      baseY,
      spent: false,
    };
  }

  private stepIce(ice: IceState): void {
    const before = ice.z;
    ice.z += RUN_SPEED;
    // The ICE leans toward the persona's lane a little as it comes (it is hunting).
    ice.x += (this.persona.x - ice.x) * 0.006;
    ice.rx += ice.spinX;
    ice.ry += ice.spinY;
    ice.rz += ice.spinZ;
    ice.y = ice.baseY + Math.sin(this.tick * 0.05 + ice.phase) * 0.35;
    // It crossed the persona's depth this tick: a hit if it is close enough sideways.
    if (!ice.spent && before < PERSONA_Z && ice.z >= PERSONA_Z) {
      ice.spent = true;
      if (Math.abs(ice.x - this.persona.x) < HIT_RADIUS) {
        this.hits++;
        this.trace = Math.min(100, this.trace + this.def.hitCost);
      }
    }
    if (ice.z > DESPAWN_Z) {
      const fresh = this.spawn(ice.kind, SPAWN_FAR + this.rng.range(0, SPAWN_NEAR - SPAWN_FAR));
      Object.assign(ice, fresh);
    }
  }
}
