/**
 * Effects: filters and masks on any display object (docs/engine/interfaces.md section 5,
 * frame-and-rendering.md 6.4, scene-graph.md 6.4). Follows: Phaser 4 `go.filters`, in the flat form
 * the design chose (no `enableFilters()`, no `internal` and `external` lists).
 *
 * An `Effect` wraps ONE Pixi filter, so a Pixi upgrade never reaches game code. Game code gets two
 * ways to make one:
 *   - `colorMatrixEffect(matrix)`   a built-in (Pixi's `ColorMatrixFilter`): tint, invert, grey...
 *   - `createEffect(spec)`          your own GLSL
 * and one way to use it: `object.filters.add(effect)`. Masks are `object.filters.addMask(maskObject)`.
 *
 * Built in step B2 as the SMALLEST part the spike's Part A needs (effects and masks on the 3D view
 * and on a container with sorted children). Not built yet: `update(tick)`, `padding` and `resolution`
 * tuning beyond what `EffectSpec` carries, the named built-ins (hit flash, ripple, outline, glow) and
 * `FxSystem`. They come with M2.
 *
 * WHERE FILTERS RUN. Every filter runs inside the 480x270 back buffer, at game resolution, so after
 * the integer upscale every filtered pixel is still an exact k-by-k block (frame-and-rendering.md
 * 6.3). The back buffer is a `RenderTexture` at resolution 1, and a filter inherits it.
 */
import { ColorMatrixFilter, defaultFilterVert, Filter } from 'pixi.js';
import { assert } from '../core/assert';
import type { GameObject } from './gameobject';

/** The types a custom effect's uniform may have, and the GLSL name of each. */
const GLSL_TYPE = { f32: 'float', 'vec2<f32>': 'vec2', 'vec3<f32>': 'vec3', 'vec4<f32>': 'vec4' } as const;
export type UniformType = keyof typeof GLSL_TYPE;

export interface Effect {
  readonly name: string;
  /** Change one uniform of a custom effect. */
  set(uniform: string, value: number | number[]): this;
  /** Free the shader. Remove the effect from every list first. */
  destroy(): void;
  /** @internal The Pixi filter. For src/sje/display only. */
  readonly filter: Filter;
}

export interface EffectSpec {
  name: string;
  /**
   * GLSL ES 3.00 fragment code: your helper functions and `void main()`. The engine puts in front of
   * it everything a filter needs, so you only write the part that is yours:
   *
   *     in vec2 vTextureCoord;        where to read the picture
   *     out vec4 finalColor;          what to write (PREMULTIPLIED alpha)
   *     uniform sampler2D uTexture;   the picture under the effect
   *     uniform highp vec4 uInputSize;   x, y: its size in pixels; z, w: one over that
   *     uniform <type> <name>;        one line for each entry of `uniforms`
   *
   * (Pixi 8.22 needs `uInputSize` declared in the fragment shader, or the shader fails and floods the
   * console with warnings.)
   */
  fragment: string;
  uniforms?: Record<string, { type: UniformType; value: number | number[] }>;
  /** Extra pixels around the object that the effect may draw on (blur, glow). */
  padding?: number;
}

class PixiEffect implements Effect {
  constructor(
    readonly name: string,
    readonly filter: Filter,
    /** The group that holds the custom uniforms (none for a built-in). */
    private readonly uniformGroupName: string | null,
    /** Why `set` refuses, when there is no group: a built-in, or a custom effect that declared no uniforms. */
    private readonly noGroupReason = 'is a built-in',
  ) {}

  set(uniform: string, value: number | number[]): this {
    assert(this.uniformGroupName !== null, `Effect "${this.name}" ${this.noGroupReason}: it has no uniform "${uniform}" to set`);
    const group = (this.filter.resources as Record<string, { uniforms: Record<string, unknown> }>)[this.uniformGroupName];
    assert(group && uniform in group.uniforms, `Effect "${this.name}" has no uniform "${uniform}"`);
    group.uniforms[uniform] = Array.isArray(value) ? new Float32Array(value) : value;
    return this;
  }

  destroy(): void {
    this.filter.destroy();
  }
}

/** A 4x5 colour matrix as a flat list of 20 numbers, row by row: R, G, B, A rows; the 5th column is a 0 to 1 offset. */
export function colorMatrixEffect(matrix: readonly number[]): Effect {
  assert(matrix.length === 20, `colorMatrixEffect needs 20 numbers (a 4x5 matrix), got ${matrix.length}`);
  const filter = new ColorMatrixFilter();
  filter.matrix = [...matrix] as typeof filter.matrix;
  return new PixiEffect('color-matrix', filter, null);
}

/** An effect from your own GLSL. Pixi 8.22 needs BOTH shaders: a fragment alone throws. The engine supplies the vertex one. */
export function createEffect(spec: EffectSpec): Effect {
  const uniforms = spec.uniforms ?? {};
  const declarations = Object.entries(uniforms)
    .map(([name, u]) => `uniform ${GLSL_TYPE[u.type]} ${name};`)
    .join('\n');
  const fragment = `in vec2 vTextureCoord;\nout vec4 finalColor;\nuniform sampler2D uTexture;\nuniform highp vec4 uInputSize;\n${declarations}\n${spec.fragment}`;
  const group: Record<string, { value: number | number[] | Float32Array; type: UniformType }> = {};
  for (const [name, u] of Object.entries(uniforms)) group[name] = { value: Array.isArray(u.value) ? new Float32Array(u.value) : u.value, type: u.type };
  const hasUniforms = Object.keys(group).length > 0;
  const filter = Filter.from({
    gl: { vertex: defaultFilterVert, fragment },
    // The uniforms go in one named group. Pixi reads each as a plain GLSL uniform in WebGL.
    // An EMPTY group is left out: Pixi 8.22 throws "Cannot read properties of undefined (reading 0)" at the first draw for one.
    resources: hasUniforms ? { effectUniforms: group } : {},
    padding: spec.padding ?? 0,
  });
  return new PixiEffect(spec.name, filter, hasUniforms ? 'effectUniforms' : null, 'declared no uniforms');
}

/**
 * The effects and the mask of one display object (`object.filters`). The list writes straight to
 * the Pixi node, so there is nothing to call after changing it.
 *
 * Pixi keeps ONE mask per node. `addMask` throws if there is one already (nest the object in a
 * container and mask that, to stack masks). A mask object must be in the display list, usually the
 * same container as the masked object, so that it moves with the camera. It draws nothing itself.
 */
export class FilterList {
  private effects: Effect[] = [];
  private mask: GameObject | null = null;

  constructor(private readonly owner: GameObject) {}

  get list(): readonly Effect[] {
    return this.effects;
  }

  add(effect: Effect): this {
    if (!this.effects.includes(effect)) this.effects.push(effect);
    return this.write();
  }

  remove(effect: Effect): this {
    this.effects = this.effects.filter((e) => e !== effect);
    return this.write();
  }

  clear(): this {
    this.effects = [];
    return this.write();
  }

  /**
   * Show the object only where `maskObject` has pixels. A `Graphics` mask uses the stencil buffer (a
   * hard edge); an `ImageObject` or `Sprite` mask uses its ALPHA, so a half-transparent pixel shows the
   * object half. `invert` shows it everywhere EXCEPT there.
   */
  addMask(maskObject: GameObject, invert = false): this {
    assert(this.mask === null, `FilterList.addMask: "${this.owner.name}" already has a mask. Pixi keeps one per node: nest it in a container to stack masks`);
    assert(!maskObject.destroyed, `FilterList.addMask: the mask object "${maskObject.name}" is already destroyed`);
    this.mask = maskObject;
    // The mask object tells this list when it is destroyed, so the list never keeps a dead mask.
    const users = maskObject._maskUsers ?? new Set<FilterList>();
    maskObject._maskUsers = users;
    users.add(this);
    // `channel: 'alpha'` is what makes a sprite mask mean "its ALPHA decides". Pixi's default reads the RED
    // channel of the premultiplied texel times its alpha: for a white mask that is alpha squared, so a half
    // transparent pixel shows a QUARTER of the object (spike lab, Part A: 1536 pixels off by up to 33/255).
    this.owner._pixi.setMask({ mask: maskObject._pixi, inverse: invert, channel: 'alpha' });
    return this;
  }

  /** Remove the mask (the mask object itself is not destroyed). Does nothing when there is none. */
  clearMask(): this {
    if (!this.mask) return this;
    this.mask._maskUsers?.delete(this);
    this.mask = null;
    // `setMask({ mask: null })` does nothing in Pixi 8.22 (it only acts on a truthy mask). Setting `mask` does the removal.
    this.owner._pixi.mask = null;
    this.owner._pixi.setMask({ inverse: false });
    return this;
  }

  private write(): this {
    // An empty list must be `null`: Pixi skips the filter pass entirely then.
    this.owner._pixi.filters = this.effects.length ? this.effects.map((e) => e.filter) : null;
    return this;
  }
}
