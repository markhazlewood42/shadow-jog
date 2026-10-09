/**
 * GlowChain: the bloom (docs/engine/frame-and-rendering.md 6.3 and 6.5, row "Bloom"). A port of the old presenter's first stage.
 *
 *   1. The LIGHT: the glow layer (what scenes drew into `glowLayer()`) plus the glowing particles, in a game-size render texture.
 *   2. Four blur passes: the light to half size across, half size down, half size to quarter size across, quarter size down.
 *      The composite (compositefilter.ts) adds the half and the quarter result and uses the light itself for the stage dim.
 *
 * All of it runs at GAME resolution, like every filter (frame-and-rendering.md 6.3): the blur is chunky on purpose, and after the integer upscale
 * every pixel of it is still an exact block. The old chain ran at the same sizes (W x H, then W/2, then W/4).
 *
 * The render textures are created ONCE and drawn into every frame the bloom runs. Nothing is allocated per frame. A pass is a Pixi filter over a throwaway
 * white sprite as big as its target (the shader is in render/shaders/blur.ts, which says how).
 */
import { defaultFilterVert, Container, Filter, RenderTexture, Sprite, Texture } from 'pixi.js';
import { H, W } from '../core/size';
import type { PixiRenderer } from '../render/pixirenderer';
import { BLUR_FRAGMENT } from '../render/shaders/blur';
import { FILTER_PRELUDE } from '../render/shaders/prelude';

const CLEAR: [number, number, number, number] = [0, 0, 0, 0];

function target(w: number, h: number): RenderTexture {
  // Linear: the old chain read every one of these with linear filtering (the half-size passes land between two source pixels on purpose).
  return RenderTexture.create({ width: w, height: h, resolution: 1, scaleMode: 'linear' });
}

/** One blur pass: reads `from` at a step of (dx, dy) texels and fills `to`. */
class BlurPass {
  readonly sprite: Sprite;
  readonly filter: Filter;

  constructor(
    from: RenderTexture,
    readonly to: RenderTexture,
    dx: number,
    dy: number,
  ) {
    this.filter = Filter.from({
      gl: { vertex: defaultFilterVert, fragment: FILTER_PRELUDE + BLUR_FRAGMENT },
      resources: {
        blurUniforms: {
          uOut: { value: new Float32Array([to.width, to.height]), type: 'vec2<f32>' },
          uStep: { value: new Float32Array([dx / from.width, dy / from.height]), type: 'vec2<f32>' },
        },
        uSrc: from.source,
      },
    });
    this.sprite = new Sprite(Texture.WHITE);
    this.sprite.width = to.width;
    this.sprite.height = to.height;
    this.sprite.filters = [this.filter];
  }

  run(pixi: PixiRenderer): void {
    pixi.renderer.render({ container: this.sprite, target: this.to, clear: true, clearColor: CLEAR });
  }

  destroy(): void {
    this.sprite.destroy();
    this.filter.destroy();
  }
}

export class GlowChain {
  /** The light, at game size. The composite reads it for the dim; the first pass reads it for the blur. */
  readonly lit = target(W, H);
  readonly half: [RenderTexture, RenderTexture];
  readonly quarter: [RenderTexture, RenderTexture];
  private readonly passes: BlurPass[];

  /** `litRoot` holds what makes the light (the glow layer's sprite and the light particles). It is NOT part of the picture. */
  constructor(private readonly litRoot: Container) {
    const halfH = Math.ceil(H / 2);
    const quarterH = Math.ceil(H / 4);
    this.half = [target(W / 2, halfH), target(W / 2, halfH)];
    this.quarter = [target(W / 4, quarterH), target(W / 4, quarterH)];
    const [h0, h1] = this.half;
    const [q0, q1] = this.quarter;
    this.passes = [new BlurPass(this.lit, h0, 1, 0), new BlurPass(h0, h1, 0, 1), new BlurPass(h1, q0, 1, 0), new BlurPass(q0, q1, 0, 1)];
  }

  /** Draw the light and blur it. Skipped by the caller when nothing glows (the composite then adds 0). */
  render(pixi: PixiRenderer): void {
    pixi.renderer.render({ container: this.litRoot, target: this.lit, clear: true, clearColor: CLEAR });
    for (const pass of this.passes) pass.run(pixi);
  }

  destroy(): void {
    for (const p of this.passes) p.destroy();
    for (const t of [this.lit, ...this.half, ...this.quarter]) t.destroy(true);
  }
}
