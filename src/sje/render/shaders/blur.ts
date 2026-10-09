/**
 * The glow blur, vendored from the old presenter (src/engine/gl/presenter.ts `FS_BLUR`) and ported to a Pixi filter
 * (docs/engine/frame-and-rendering.md 6.5, shader inventory row `blur`). The engine owns the GLSL: game code never writes any.
 *
 * It is one pass of a separable Gaussian (nine taps folded into five with linear sampling, sigma about 2). The chain runs it four times:
 * the light at game size to half size across, half size down, half size to quarter size across, quarter size down.
 *
 * HOW A PIXI FILTER MAKES A FULL-TARGET PASS. The filter runs over a throwaway white sprite that is exactly as big as the target. The
 * filter ignores that picture (`uTexture`) and reads the light from `uSrc`, a texture of its own, at the same spot of the target, so
 * one pass writes the whole target. `uOut` is the target size in pixels: Pixi's filter input is padded up to a power of two, so
 * `vTextureCoord` runs from 0 to the frame size over that padded size, and `uv` below turns it back into 0..1 over the target.
 *
 * What differs from the old shader: the old one had its own vertex shader and wrote to a framebuffer; this one reads `vTextureCoord` and writes
 * `finalColor`. The weights and the offsets are the same.
 */
export const BLUR_FRAGMENT = `
uniform sampler2D uSrc;
uniform vec2 uOut;
uniform vec2 uStep;
void main() {
  vec2 uv = vTextureCoord * uInputSize.xy / uOut;
  vec4 c = texture(uSrc, uv) * 0.2270270270;
  c += (texture(uSrc, uv + uStep * 1.3846153846) + texture(uSrc, uv - uStep * 1.3846153846)) * 0.3162162162;
  c += (texture(uSrc, uv + uStep * 3.2307692308) + texture(uSrc, uv - uStep * 3.2307692308)) * 0.0702702703;
  finalColor = c;
}`;
