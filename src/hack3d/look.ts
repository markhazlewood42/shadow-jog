/**
 * The LOOK of the test hack: a first draft for Mark's review, not final art.
 *
 * Inspired by the Shadowrun Genesis Matrix and by low-poly neon games (Beat Saber, Superhot,
 * Morphite): a blue neon grid running to a foggy horizon, a few slowly turning flat-shaded pieces of
 * ICE, a low-poly runner seen from behind, and bloom over all of it.
 *
 * Everything here builds Three objects ONCE (`buildLook`). Nothing here moves anything: the scene's
 * `sync3D` copies the simulation's numbers into these objects each frame.
 *
 * Look rules from docs/engine/frame-and-rendering.md 7.5, kept here:
 *  - Flat shading, flat colours, no textures. Colour management is off (see ThreeHost), so a colour
 *    written as 0xff4fb0 is exactly 0xff4fb0 in the picture before lighting.
 *  - Grid lines are built in SHORT SEGMENTS (8 units or less). SwiftShader (the software GL that CI
 *    uses) drops a long line that crosses the camera's near plane: the lab lost about 21% of the
 *    pixels of long lines near the camera. Short segments lose almost nothing.
 */
import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  type Camera,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Float32BufferAttribute,
  FogExp2,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Object3D,
  OctahedronGeometry,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import type { IceKind } from './sim/hacksim';

/** The palette. Hex numbers, as in src/art: the game's own pink, yellow, cyan, green, purple. */
export const PALETTE = {
  /** The void and the fog share one colour, so the horizon melts into the sky. */
  void: 0x070a22,
  gridMinor: 0x1f5cff,
  gridMajor: 0x3fe0f0,
  persona: 0x3fe0f0,
  personaBody: 0x2c2c78,
  ice: { icosahedron: 0xff4fb0, cube: 0xffcc3d, chip: 0x62e06a, shard: 0xb07cff } as Record<IceKind, number>,
} as const;

/** Grid cell size and the longest line segment, in world units. */
export const CELL = 4;
export const SEGMENT = 8;
/** Every 5th line is a major line, so the grid pattern repeats every 20 units. The grid scrolls by `travel % GRID_PERIOD`. */
export const GRID_PERIOD = CELL * 5;
const GRID_HALF_WIDTH = 48;
const GRID_FAR = -160;
const GRID_NEAR = 24;

export interface IceObject {
  group: Group;
}

export interface PersonaObject {
  group: Group;
  legL: Object3D;
  legR: Object3D;
  armL: Object3D;
  armR: Object3D;
}

export interface Look {
  grid: Group;
  ice: IceObject[];
  persona: PersonaObject;
}

/** Push the two end points of one line segment. */
function segment(out: number[], x0: number, z0: number, x1: number, z1: number): void {
  out.push(x0, 0, z0, x1, 0, z1);
}

/** A grid line from `a` to `b` along one axis, cut into pieces of at most SEGMENT units. */
function cutLine(out: number[], axis: 'x' | 'z', fixed: number, a: number, b: number): void {
  for (let from = a; from < b - 1e-6; from += SEGMENT) {
    const to = Math.min(from + SEGMENT, b);
    if (axis === 'z') segment(out, fixed, from, fixed, to);
    else segment(out, from, fixed, to, fixed);
  }
}

/** The grid: minor lines in blue, every 5th line in cyan. Two draw calls in all. */
export function buildGrid(): Group {
  const minor: number[] = [];
  const major: number[] = [];
  // Lines that run away from the camera (along z), one per cell across.
  for (let x = -GRID_HALF_WIDTH; x <= GRID_HALF_WIDTH; x += CELL) cutLine(x % GRID_PERIOD === 0 ? major : minor, 'z', x, GRID_FAR, GRID_NEAR);
  // Lines across (along x), one per cell in depth.
  for (let z = GRID_FAR; z <= GRID_NEAR; z += CELL) cutLine(z % GRID_PERIOD === 0 ? major : minor, 'x', z, -GRID_HALF_WIDTH, GRID_HALF_WIDTH);
  const group = new Group();
  group.name = 'grid';
  for (const [positions, colour] of [
    [minor, PALETTE.gridMinor],
    [major, PALETTE.gridMajor],
  ] as const) {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    group.add(new LineSegments(geo, new LineBasicMaterial({ color: colour })));
  }
  return group;
}

/** A lit flat-shaded solid with a bright outline: the whole "low-poly neon" look in one helper. */
function solid(geo: BufferGeometry, colour: number, emissive = 0.4): Group {
  const g = new Group();
  const c = new Color(colour);
  g.add(new Mesh(geo, new MeshLambertMaterial({ color: c, flatShading: true, emissive: c.clone().multiplyScalar(emissive) })));
  g.add(new LineSegments(new EdgesGeometry(geo), new LineBasicMaterial({ color: new Color(colour).lerp(new Color(0xffffff), 0.45) })));
  return g;
}

/** One piece of ICE of a kind, about 2 to 3 units across. */
export function buildIce(kind: IceKind): IceObject {
  const colour = PALETTE.ice[kind];
  const group = new Group();
  group.name = `ice-${kind}`;
  if (kind === 'icosahedron') group.add(solid(new IcosahedronGeometry(1.5, 0), colour));
  else if (kind === 'cube') group.add(solid(new BoxGeometry(2.1, 2.1, 2.1), colour));
  else if (kind === 'chip') {
    // A flat package with pins along its long sides: a data chip.
    group.add(solid(new BoxGeometry(3, 0.5, 2), colour, 0.25));
    for (let i = 0; i < 5; i++) {
      for (const side of [-1, 1]) {
        const pin = new Mesh(new BoxGeometry(0.28, 0.14, 0.4), new MeshBasicMaterial({ color: 0xd8d8e8 }));
        pin.position.set(-1.1 + i * 0.55, 0, side * 1.18);
        group.add(pin);
      }
    }
  } else {
    // A shard: a stretched octahedron.
    const geo = new OctahedronGeometry(1, 0);
    geo.scale(0.7, 1.7, 0.7);
    group.add(solid(geo, colour));
  }
  return { group };
}

/** A low-poly runner seen from behind: dark body, cyan outline, a glowing deck on the back. */
export function buildPersona(): PersonaObject {
  const group = new Group();
  group.name = 'persona';
  const body = (w: number, h: number, d: number): BufferGeometry => new BoxGeometry(w, h, d);
  const part = (geo: BufferGeometry): Group => solid(geo, PALETTE.personaBody, 0.5);
  const outlined = (geo: BufferGeometry): Group => {
    const g = part(geo);
    // Replace the pale outline with the persona's own cyan.
    const lines = g.children[1] as LineSegments;
    (lines.material as LineBasicMaterial).color.set(PALETTE.persona);
    return g;
  };
  // Legs and arms hang from a pivot at the hip and shoulder, so rotating the pivot swings the limb.
  const limb = (x: number, y: number, w: number, h: number): Group => {
    const pivot = new Group();
    pivot.position.set(x, y, 0);
    const mesh = outlined(body(w, h, w));
    mesh.position.y = -h / 2;
    pivot.add(mesh);
    return pivot;
  };
  const legL = limb(-0.24, 1.0, 0.36, 1.0);
  const legR = limb(0.24, 1.0, 0.36, 1.0);
  const armL = limb(-0.68, 2.0, 0.3, 0.95);
  const armR = limb(0.68, 2.0, 0.3, 0.95);
  const torso = outlined(body(0.95, 1.0, 0.5));
  torso.position.y = 1.5;
  const head = outlined(new IcosahedronGeometry(0.38, 0));
  head.position.y = 2.42;
  // The deck on the runner's back (the side the camera sees): a slab with a bright strip.
  const deck = outlined(body(0.7, 0.55, 0.16));
  deck.position.set(0, 1.55, 0.34);
  const strip = new Mesh(new BoxGeometry(0.5, 0.08, 0.02), new MeshBasicMaterial({ color: 0xffffff }));
  strip.position.set(0, 1.62, 0.43);
  group.add(legL, legR, armL, armR, torso, head, deck, strip);
  return { group, legL, legR, armL, armR };
}

/**
 * Build the whole look into `scene` and aim the camera. `iceKinds` is one entry per piece of ICE
 * the simulation has, in the same order.
 */
export function buildLook(scene: Scene, camera: Camera, iceKinds: readonly IceKind[]): Look {
  scene.background = new Color(PALETTE.void);
  scene.fog = new FogExp2(PALETTE.void, 0.026);
  scene.add(new AmbientLight(0x6a6aa8, 0.75));
  const sun = new DirectionalLight(0xffffff, 0.8);
  sun.position.set(4, 8, 6);
  scene.add(sun);

  const grid = buildGrid();
  scene.add(grid);
  const ice = iceKinds.map((kind) => buildIce(kind));
  for (const i of ice) scene.add(i.group);
  const persona = buildPersona();
  scene.add(persona.group);

  // The camera floats behind and above the runner and looks down the grid to the horizon.
  const cam = camera as PerspectiveCamera;
  cam.fov = 52;
  cam.near = 0.5;
  cam.far = 260;
  cam.position.set(0, 3.7, 8.4);
  cam.lookAt(0, 1.9, -14);
  cam.updateProjectionMatrix();
  return { grid, ice, persona };
}
