/**
 * The cube scene: the technical test scene of the 3D proof (M1b, docs/engine/m1b-brief.md). A lit, spinning cube on a visible,
 * non-black background, drawn by a `Scene3D` on the scene runtime, with a few Pixi objects (a small HUD) next to it.
 *
 * It is not a game scene. The lab runs it (threelab.ts) and the unit test runs it with a fake frame (tests/sje-scene3d.test.ts).
 *
 *  - `update3D` is pure sim: two angles from the tick. It touches no Object3D, so the same tick count gives the same angles.
 *  - `sync3D` writes the angles into the cube. It runs once per drawn frame.
 *  - A filter and an iris mask can go on the `View3D` (`setFilterAndMask`): a Pixi effect and a `Graphics` mask over the Three picture
 *    on the shared context (migration.md pass line 6).
 *
 * The non-black background matters: the stale-clear-color canary needs a 3D picture that differs from Three's leftover clear color.
 */
import { AmbientLight, BoxGeometry, Color, DirectionalLight, Mesh, MeshLambertMaterial, PerspectiveCamera, type Scene as ThreeScene } from 'three';
import { colorMatrixEffect, type Effect, Graphics, H, must, type Pixels, W } from '../sje';
import { type Frame3D, type HackResult, Scene3D, type Scene3DAbort, type Scene3DOptions } from '../sje/three';

/** The default background, a dark violet. */
export const CUBE_BACKGROUND = 0x180830;

/** Radius of the iris mask, in game pixels. */
export const IRIS_RADIUS = Math.floor(H / 2) - 40;

/** The face colors. */
const FACES = [0xff4fb0, 0x3fe0f0, 0xffb040, 0x7cff6b, 0xb06bff, 0xffffff];

/**
 * The cube, its camera and its lights, into `world`. Shared by the scene and by the lab's bare-frame check (the context-restore canary
 * needs a frame that outlives a lost context, which a scene does not).
 */
export function buildCubeWorld(world: ThreeScene, background: number): { camera: PerspectiveCamera; cube: Mesh } {
  world.background = new Color(background);
  const camera = new PerspectiveCamera(50, W / H, 0.1, 20);
  // From a little above, so the spin shows more than one face at a time.
  camera.position.set(0, 1.5, 4);
  camera.lookAt(0, 0, 0);
  const cube = new Mesh(
    new BoxGeometry(1.6, 1.6, 1.6),
    FACES.map((c) => new MeshLambertMaterial({ color: new Color(c) })),
  );
  world.add(cube, new AmbientLight(0xffffff, 1.4));
  const sun = new DirectionalLight(0xffffff, 1.6);
  sun.position.set(2, 3, 5);
  world.add(sun);
  return { camera, cube };
}

export interface CubeOptions extends Scene3DOptions {
  /** Three's scene background, 0xRRGGBB. Default a dark violet. */
  background?: number;
  /** Add the bloom pass (default true). The exact-pixel canaries turn it off. */
  bloom?: boolean;
  /** TEST ONLY, the leak check's control: the scene never frees its frame or its Three objects at shutdown. */
  skipDispose?: boolean;
}

export class CubeScene extends Scene3D<HackResult> {
  /** The sim state: two angles. A function of the tick and of nothing else. */
  private ax = 0;
  private ay = 0;
  private cube: Mesh | null = null;
  /** The filter and the iris, while they are on. */
  private effect: Effect | null = null;
  private iris: Graphics | null = null;
  private extra = 0;

  constructor(private readonly cubeOptions: CubeOptions = {}) {
    super(cubeOptions);
  }

  create3D(): void {
    const { camera, cube } = buildCubeWorld(this.world3D, this.cubeOptions.background ?? CUBE_BACKGROUND);
    this.camera3D = camera;
    this.cube = cube;
    if (this.cubeOptions.bloom !== false) this.bloom = { strength: 0.5, radius: 0.4, threshold: 0.85 };
    // Pixi objects next to the 3D picture: three swatches in the top left corner of the scene's ui layer (the 3D view is in its world).
    const hud = new Graphics(this);
    for (const [i, c] of FACES.slice(0, 3).entries()) hud.fillStyle(c).fillRect(8 + i * 12, 8, 10, 6);
    hud.name = 'cube-hud';
    this.sys.ui.add(hud);
    // The extra draws of the speed line's negative control run after the scene's own draw (this listener is added once `create` has ended).
    this.events.once('create', () => this.events.on('prerender', this.drawExtra));
    this.events.on('shutdown', this.freeEffect);
    // The control: take off every shutdown listener, the base class's frame and Three disposal included.
    if (this.cubeOptions.skipDispose) this.events.off('shutdown');
  }

  update3D(tick: number): void {
    this.ax = tick * 0.03;
    this.ay = tick * 0.05;
  }

  sync3D(): void {
    must(this.cube, 'cube').rotation.set(this.ax, this.ay, 0);
  }

  abortResult(reason: Scene3DAbort): HackResult {
    return { status: 'aborted', reason };
  }

  /** The sim state, for the unit test. */
  get angles(): { x: number; y: number } {
    return { x: this.ax, y: this.ay };
  }

  /** The cube's rotation as Three holds it, for the unit test (it changes only in `sync3D`). */
  get cubeRotation(): { x: number; y: number } {
    const r = must(this.cube, 'cube').rotation;
    return { x: r.x, y: r.y };
  }

  /** Draw the 3D frame `n` more times per drawn frame (the negative control of the speed line). 0 turns it off. */
  setExtraRenders(n: number): void {
    this.extra = n;
  }
  private readonly drawExtra = (): void => {
    for (let i = 0; i < this.extra; i++) this.frame.render();
  };

  /** The frame, for lab checks that need it (describe, read the pixels, the rewrap control). */
  frameOf(): Frame3D {
    return this.frame;
  }
  describeFrame(): ReturnType<Frame3D['describe']> & { contextLost: boolean } {
    return { ...this.frame.describe(), contextLost: this.frame.contextLost };
  }
  readFramePixels(): Pixels {
    return this.frame.readPixels();
  }

  /**
   * Put a Pixi effect and an iris mask on the `View3D`, or take them off. The effect inverts the colors, so a pixel through the filter is
   * easy to tell from a raw one. The iris is a `Graphics` disc in the middle of the picture (rows of rectangles: `Graphics` has no circle).
   * `parts` turns one half off: the control of the mask check is a filter with no mask.
   */
  setFilterAndMask(on: boolean, parts: { filter?: boolean; mask?: boolean } = {}): void {
    const view = this.frame.sprite;
    view.filters.clear();
    view.filters.clearMask();
    this.freeEffect();
    this.iris?.destroy();
    this.iris = null;
    if (!on) return;
    if (parts.filter !== false) {
      this.effect = colorMatrixEffect([-1, 0, 0, 0, 1, 0, -1, 0, 0, 1, 0, 0, -1, 0, 1, 0, 0, 0, 1, 0]);
      view.filters.add(this.effect);
    }
    if (parts.mask !== false) {
      const iris = new Graphics(this);
      iris.name = 'iris';
      iris.fillStyle(0xffffff);
      const cx = Math.floor(W / 2);
      const cy = Math.floor(H / 2);
      for (let dy = -IRIS_RADIUS; dy < IRIS_RADIUS; dy++) {
        const half = Math.floor(Math.sqrt(IRIS_RADIUS * IRIS_RADIUS - dy * dy));
        iris.fillRect(cx - half, cy + dy, half * 2, 1);
      }
      // The mask goes in the same container as the masked view, so they move together.
      this.sys.world.add(iris);
      view.filters.addMask(iris);
      this.iris = iris;
    }
  }

  private readonly freeEffect = (): void => {
    this.effect?.destroy();
    this.effect = null;
  };
}
