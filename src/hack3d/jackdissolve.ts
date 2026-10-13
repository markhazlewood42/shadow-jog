/**
 * Jack style B, the PIXEL DISSOLVE (decision D5, option B). DEV builds only until Mark picks a style: `jack.ts` loads this file with a dynamic `import()` behind
 * `import.meta.env.DEV`, so a shipped build holds none of it.
 *
 * The cover is a void-colored rectangle with a small shader on it. The shader keeps a block of game pixels (a seeded random threshold per block) where the block's random
 * number is below `uAmount`, and drops the rest, so the picture breaks into blocks of the void and, when the amount falls again, the blocks give way to what is under: the 3D
 * grid. A thin cyan rim marks the blocks that are about to go. The shader is a filter on the COVER, not on the world, so no world filter is ever on (pass line 23).
 *
 * At the level `none` the cover is a plain fade (`transition.ts`): this driver draws nothing for it and the shader is not built.
 */
import { createEffect, type Effect, type Game, Graphics, H, type Container, W } from '../sje';
import type { JackStyleDriver } from './jack';
import { type CoverFrame, type JackLevel, type Phase, type TransitionParams, VOID } from './transition';

const FRAGMENT = `
  // A hash of the block's cell, the seed and the pattern number, with no sine and no integer: the same blocks for the same seed on every load. (The shader
  // header is GLSL ES 1.00 style, so there are no 'uint's; the values stay small so even a mediump float holds them.)
  float rnd(vec2 cell) {
    vec2 p = cell + vec2(mod(uSeed, 251.0) * 1.7, mod(uSeed, 113.0) * 2.3 + mod(uPattern, 61.0) * 31.0);
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  void main() {
    vec4 c = texture(uTexture, vTextureCoord);
    vec2 cell = floor(vTextureCoord * uInputSize.xy / uBlock);
    float n = rnd(cell);
    float covered = step(n, uAmount);
    // The rim: blocks just above the threshold glow cyan for a moment.
    float rim = (1.0 - covered) * step(n, uAmount + 0.05) * step(0.0001, uAmount) * step(uAmount, 0.9999);
    vec4 rimColor = vec4(0.247, 0.878, 0.941, 1.0) * c.a;
    finalColor = c * covered + rimColor * rim * 0.85;
  }
`;

export class DissolveDriver implements JackStyleDriver {
  private veil: Graphics | null = null;
  private effect: Effect | null = null;

  constructor(
    private readonly game: Game,
    private readonly params: TransitionParams,
    private readonly seed: number,
  ) {}

  setup(root: Container): void {
    // The shader is only for the levels that draw the dissolve; at `none` the plain veil of `jack.ts` fades. Built here, once.
    if (this.game.fx.level === 'none') return;
    const veil = new Graphics(this.game).fillStyle(VOID, 1).fillRect(0, 0, W, H).setDepth(1).setVisible(false);
    const effect = createEffect({
      name: 'jack-dissolve',
      fragment: FRAGMENT,
      uniforms: {
        uAmount: { type: 'f32', value: 0 },
        uSeed: { type: 'f32', value: this.seed % 1_000_000 },
        uPattern: { type: 'f32', value: 0 },
        uBlock: { type: 'f32', value: this.params.block },
      },
    });
    veil.filters.add(effect);
    root.add(veil);
    this.veil = veil;
    this.effect = effect;
  }

  enter(_phase: Phase, _level: JackLevel): void {}

  paint(frame: CoverFrame, phase: Phase, _t: number, level: JackLevel): void {
    const veil = this.veil;
    const effect = this.effect;
    if (!veil || !effect || level === 'none') return;
    // The swap is the plain solid veil of `jack.ts` (cover 1). Around it the blocks come and go.
    const show = phase !== 'swap' && phase !== 'done' && frame.amount > 0;
    veil.setVisible(show);
    if (!show) return;
    effect.set('uAmount', frame.amount).set('uPattern', frame.pattern);
  }

  dispose(_level: JackLevel): void {
    this.veil?.destroy();
    this.effect?.destroy();
    this.veil = null;
    this.effect = null;
  }
}
