/**
 * CompositeFilter: the one filter on the world root that does the screen effects (docs/engine/frame-and-rendering.md 6.5, interfaces.md section 5).
 * A port of the old presenter's `comp` program: 4 shockwave rings, 4 hazes, 2 glitches, the color split, the bloom (two blurred textures), the
 * light for the stage dim, the dim, the flash, the vignette and the effects clock. Same slots, same math (render/shaders/composite.ts).
 *
 * `update` is the per-frame half of the old `GlPresenter.present`: it copies the live state of `FxState` into the uniforms, with the same
 * easing curves (a ring's reach and push, the haze and glitch envelopes). It allocates nothing.
 */
import { defaultFilterVert, Filter, type TextureSource } from 'pixi.js';
import { H, W } from '../core/size';
import { compositeFragment } from '../render/shaders/composite';
import { FILTER_PRELUDE } from '../render/shaders/prelude';
import { envelope, type FxState, MAX_GLITCHES, MAX_HAZES, MAX_SHOCKS } from './fxstate';

type Uniforms = Record<string, number | Float32Array>;

/** '#rrggbb' or '#rgb' into `out` as 0..1 channels (white if it cannot be read). */
export function hexToRgb(hex: string, out: Float32Array): void {
  const h = hex.length === 4 ? `${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex.slice(1, 7);
  const n = Number.parseInt(h, 16);
  if (!Number.isFinite(n) || h.length !== 6) {
    out.fill(1);
    return;
  }
  out[0] = ((n >> 16) & 255) / 255;
  out[1] = ((n >> 8) & 255) / 255;
  out[2] = (n & 255) / 255;
}

export class CompositeFilter {
  readonly filter: Filter;
  private readonly u: Uniforms;
  private readonly shock = new Float32Array(MAX_SHOCKS * 4);
  private readonly shockW = new Float32Array(MAX_SHOCKS);
  private readonly haze = new Float32Array(MAX_HAZES * 4);
  private readonly glitch = new Float32Array(MAX_GLITCHES * 4);
  private readonly glitchP = new Float32Array(MAX_GLITCHES * 2);
  private readonly aberr = new Float32Array(3);
  private readonly flash = new Float32Array(4);
  private flashHex = '';

  constructor(bloomA: TextureSource, bloomB: TextureSource, light: TextureSource) {
    const group = {
      uRes: { value: new Float32Array([W, H]), type: 'vec2<f32>' },
      uShock: { value: this.shock, type: 'vec4<f32>', size: MAX_SHOCKS },
      uShockW: { value: this.shockW, type: 'f32', size: MAX_SHOCKS },
      uAberr: { value: this.aberr, type: 'vec3<f32>' },
      uBloom: { value: 0, type: 'f32' },
      uFlash: { value: this.flash, type: 'vec4<f32>' },
      uVignette: { value: 0, type: 'f32' },
      uHaze: { value: this.haze, type: 'vec4<f32>', size: MAX_HAZES },
      uGlitch: { value: this.glitch, type: 'vec4<f32>', size: MAX_GLITCHES },
      uGlitchP: { value: this.glitchP, type: 'vec2<f32>', size: MAX_GLITCHES },
      uTime: { value: 0, type: 'f32' },
      uDim: { value: 0, type: 'f32' },
      uLightOn: { value: 0, type: 'f32' },
    };
    this.flash.set([1, 1, 1, 0]);
    this.filter = Filter.from({
      gl: { vertex: defaultFilterVert, fragment: FILTER_PRELUDE + compositeFragment({ shocks: MAX_SHOCKS, hazes: MAX_HAZES, glitches: MAX_GLITCHES }) },
      resources: { compositeUniforms: group, uBloomA: bloomA, uBloomB: bloomB, uLight: light },
    });
    this.u = (this.filter.resources as unknown as { compositeUniforms: { uniforms: Uniforms } }).compositeUniforms.uniforms;
  }

  /** Copy this frame's state into the uniforms. `bloom` is the bloom strength (0 when nothing glows). */
  update(fx: FxState, bloom: number): void {
    const u = this.u;
    u.uLightOn = bloom > 0 ? 1 : 0;
    u.uDim = fx.dimNow;
    u.uTime = fx.time;
    this.haze.fill(0);
    for (let i = 0; i < fx.hazes.length && i < MAX_HAZES; i++) {
      const h = fx.hazes[i];
      if (!h) continue;
      this.haze[i * 4] = h.x;
      this.haze[i * 4 + 1] = h.y;
      this.haze[i * 4 + 2] = h.radius;
      this.haze[i * 4 + 3] = h.strength * envelope(h.t, h.life, 8, 20);
    }
    this.glitch.fill(0);
    this.glitchP.fill(0);
    for (let i = 0; i < fx.glitches.length && i < MAX_GLITCHES; i++) {
      const g = fx.glitches[i];
      if (!g) continue;
      this.glitch[i * 4] = g.x;
      this.glitch[i * 4 + 1] = g.y;
      this.glitch[i * 4 + 2] = g.w;
      this.glitch[i * 4 + 3] = g.h;
      this.glitchP[i * 2] = g.strength * envelope(g.t, g.life, 2, 6);
      this.glitchP[i * 2 + 1] = g.seed;
    }
    this.shock.fill(0);
    for (let i = 0; i < fx.shocks.length && i < MAX_SHOCKS; i++) {
      const s = fx.shocks[i];
      if (!s) continue;
      const k = s.t / s.life;
      // The ring runs out to its reach, easing; its push fades as it goes.
      this.shock[i * 4] = s.x;
      this.shock[i * 4 + 1] = s.y;
      this.shock[i * 4 + 2] = s.reach * (1 - (1 - k) ** 2);
      this.shock[i * 4 + 3] = s.strength * (1 - k) ** 1.5;
      this.shockW[i] = s.width * (0.6 + k);
    }
    this.aberr[0] = fx.aberration;
    this.aberr[1] = fx.aberrationX;
    this.aberr[2] = fx.aberrationY;
    u.uBloom = bloom;
    if (fx.flashColor !== this.flashHex) {
      this.flashHex = fx.flashColor;
      hexToRgb(this.flashHex, this.flash);
    }
    this.flash[3] = fx.flashAlpha;
    u.uVignette = fx.vignette;
  }

  destroy(): void {
    this.filter.destroy();
  }
}
