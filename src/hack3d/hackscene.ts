/**
 * HackScene: the test hacking scene, a `Scene3D` (docs/engine/interfaces.md section 12). A story
 * script starts it with `await s.hack(def)` and always gets a result back.
 *
 * Its three jobs, in the order a frame happens:
 *   `update3D(tick)`  advance the pure simulation (`HackSim`), one fixed step per tick.
 *   `sync3D()`        copy the simulation's numbers into the Three objects, and into the 2D HUD.
 *   (the base class) draws the 3D frame and shows it under the HUD.
 *
 * The simulation never touches Three. This class is the only bridge between them. The scene has no input and no quit key (M7): it plays itself
 * for `def.ticks` ticks. The real hacking scene replaces it, with its own design (docs/IDEAS.md entry 2).
 */
import { Scene3D, type Scene3DAbort, type Scene3DOptions } from '../sje/three';
import { captionFor, HackHud } from './hud';
import { buildLook, GRID_PERIOD, type Look } from './look';
import type { HackDef, HackResult } from './result';
import { HackSim, ICE_KINDS, type IceKind } from './sim/hacksim';

/** Bloom: a soft glow on the bright neon, computed inside the picture so it stays on the pixel grid. */
const BLOOM = { strength: 0.6, radius: 0.4, threshold: 0.55 };

/** What a caller may set besides the hack itself (tests and the DEV entry; a story passes none). */
export interface HackOptions extends Scene3DOptions {
  /** False leaves the 2D HUD out. Headless tests have no canvas to draw its text on. Default true. */
  hud?: boolean;
}

export class HackScene extends Scene3D<HackResult> {
  readonly sim: HackSim;
  private look: Look | null = null;
  private hud: HackHud | null = null;
  /** True once `close(result)` ran. A scene that shuts down without it was abandoned. */
  private finished = false;
  /** Called (once) if the scene was dropped without a result: `game.abandon()` or `game.reset()`. */
  onAbandoned: (() => void) | null = null;

  private readonly hudOn: boolean;

  constructor(
    readonly def: HackDef,
    options: HackOptions = {},
  ) {
    super(options);
    this.hudOn = options.hud !== false;
    this.sim = new HackSim(def);
  }

  create3D(): void {
    const kinds: IceKind[] = this.sim.ice.map((i) => i.kind);
    this.look = buildLook(this.world3D, kinds);
    this.camera3D = this.look.camera;
    this.bloom = BLOOM;
  }

  protected override createHud(): void {
    if (!this.hudOn) return;
    this.hud = new HackHud(this, this.sim, captionFor(this.def.seed));
  }

  update3D(): void {
    this.sim.step();
    if (this.sim.status !== 'running') {
      this.close({ status: this.sim.status, data: { ticks: this.sim.tick, trace: this.sim.tracePercent, hits: this.sim.hits } });
    }
  }

  sync3D(): void {
    const look = this.look;
    if (!look) return;
    const sim = this.sim;
    // The grid slides toward the camera. Its pattern repeats every GRID_PERIOD, so the wrap is invisible.
    look.grid.position.z = sim.travel % GRID_PERIOD;
    sim.ice.forEach((ice, i) => {
      const o = look.ice[i];
      if (!o) return;
      o.group.position.set(ice.x, ice.y, ice.z);
      o.group.rotation.set(ice.rx, ice.ry, ice.rz);
    });
    const p = look.persona;
    p.group.position.set(sim.persona.x, sim.persona.bob, 0);
    p.group.rotation.z = -sim.persona.lean;
    const swing = Math.sin(sim.persona.stride) * 0.7;
    p.legL.rotation.x = swing;
    p.legR.rotation.x = -swing;
    p.armL.rotation.x = -swing * 0.8;
    p.armR.rotation.x = swing * 0.8;
    this.hud?.update();
  }

  abortResult(reason: Scene3DAbort): HackResult {
    return { status: 'aborted', reason };
  }

  /** Remember that a result was given, then close as the base class does. */
  override close(result: HackResult): void {
    this.finished = true;
    super.close(result);
  }

  protected override dispose3D(): void {
    const hud = this.hud;
    this.hud = null;
    try {
      hud?.destroy();
    } finally {
      // Dropped with no result (abandon or reset): tell whoever waits, so the story never hangs (decision E11).
      // This is in a `finally` ON PURPOSE: if the HUD cannot free a texture and throws, the story must still get its answer.
      // A scene that never finished starting is NOT abandoned: its `game.run` promise rejects, and that is an error.
      if (!this.finished && this.started) this.onAbandoned?.();
    }
  }
}

/** The kinds of ICE a hack can have, for tests that check the look covers each one. */
export const KNOWN_ICE: readonly IceKind[] = ICE_KINDS;
