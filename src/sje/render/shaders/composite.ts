/**
 * The screen composite, vendored from the old presenter (src/engine/gl/presenter.ts `FS_COMPOSITE`) and ported to a Pixi filter
 * (docs/engine/frame-and-rendering.md 6.5, shader inventory row `comp`). The engine owns the GLSL: game code never writes any.
 *
 * ONE pass over the world (the picture without the UI): shockwave rings push it outward, heat hazes shimmer it, glitch rectangles slide slices
 * sideways, the color channels part near an impact, the stage dims around a big spell (but not what glows), the blurred glow is added, the
 * game flash washes it, and the corners darken. The math is the old shader's, line for line. Only the plumbing changed:
 *
 *   old                                         here
 *   `vUv` (bottom-left origin) and `toUv`       `gp` is the pixel in the picture, top row first, from `vTextureCoord` and `uInputSize`.
 *                                               Pixi stores render textures so that a texture reads top row first as well: no flip.
 *   `uScene` (a W x H texture, clamp to edge)   `uTexture`, Pixi's input: padded up to a power of two, so the read is clamped by hand.
 *   `uBloomA`, `uBloomB`, `uLight`              the same three textures, but they are Pixi render textures now (resources of the filter).
 *   writes `o`                                  writes `finalColor`. Alpha is 1, as before: the world is opaque.
 *
 * The slot counts come from the caller (`FxState` owns them: MAX_SHOCKS, MAX_HAZES, MAX_GLITCHES), so the shader and the state cannot disagree.
 */
export interface CompositeSlots {
  shocks: number;
  hazes: number;
  glitches: number;
}

export function compositeFragment(slots: CompositeSlots): string {
  return `
uniform sampler2D uBloomA;
uniform sampler2D uBloomB;
uniform sampler2D uLight;
uniform vec2 uRes;
uniform vec4 uShock[${slots.shocks}];
uniform float uShockW[${slots.shocks}];
uniform vec3 uAberr;
uniform float uBloom;
uniform vec4 uFlash;
uniform float uVignette;
uniform vec4 uHaze[${slots.hazes}];
uniform vec4 uGlitch[${slots.glitches}];
uniform vec2 uGlitchP[${slots.glitches}];
uniform float uTime;
uniform float uDim;
uniform float uLightOn;
// The input is padded to a power of two: read it by pixel, and clamp to the picture like the old clamp-to-edge texture.
vec3 scn(vec2 p) { return texture(uTexture, clamp(p, vec2(0.0), uRes - 0.001) * uInputSize.zw).rgb; }
void main() {
  vec2 gp = vTextureCoord * uInputSize.xy;
  // Shockwaves: each a ring (radius z) that pushes the picture outward by up to w pixels.
  vec2 off = vec2(0.0);
  for (int i = 0; i < ${slots.shocks}; i++) {
    vec4 s = uShock[i];
    if (s.w == 0.0) continue;
    vec2 d = gp - s.xy;
    float dist = length(d);
    float x = (dist - s.z) / uShockW[i];
    off += (d / max(dist, 0.001)) * exp(-x * x) * s.w;
  }
  // Heat haze: a shimmer, strongest mid-patch, wavering upward as time runs.
  for (int i = 0; i < ${slots.hazes}; i++) {
    vec4 h = uHaze[i];
    if (h.w == 0.0) continue;
    vec2 d = (gp - h.xy) / h.z;
    float f = 1.0 - dot(d, d);
    if (f <= 0.0) continue;
    f *= f;
    off += vec2(sin(gp.y * 0.45 + uTime * 0.21), sin(gp.x * 0.3 + gp.y * 0.2 + uTime * 0.33)) * h.w * f;
  }
  // Glitch: inside each rectangle, 3-pixel slices slide sideways (a new pattern every 4 frames)
  // and the colour channels part.
  float split = 0.0;
  for (int i = 0; i < ${slots.glitches}; i++) {
    vec2 gs = uGlitchP[i];
    if (gs.x == 0.0) continue;
    vec4 r = uGlitch[i];
    vec2 d = abs(gp - r.xy);
    if (d.x > r.z * 0.5 || d.y > r.w * 0.5) continue;
    float n = fract(sin(floor(gp.y / 3.0) * 12.9898 + floor(uTime / 4.0) * 78.233 + gs.y) * 43758.5453);
    if (n > 0.5) {
      off.x += (n - 0.75) * 4.0 * gs.x;
      split = max(split, gs.x * 0.35);
    }
  }
  vec2 p = gp - off;
  vec3 col;
  if (uAberr.x > 0.0) {
    // Red out, blue in, along the line from the impact.
    vec2 dir = gp - uAberr.yz;
    dir = dir / max(length(dir), 0.001) * uAberr.x;
    col = vec3(scn(p + dir).r, scn(p).g, scn(p - dir).b);
  } else {
    col = scn(p);
  }
  if (split > 0.0) {
    col.r = scn(p + vec2(split, 0.0)).r;
    col.b = scn(p - vec2(split, 0.0)).b;
  }
  vec2 bu = p / uRes;
  // The stage dimmed for a big spell: the picture darkens, but not what glows (the light layer).
  if (uDim > 0.0) {
    vec3 l = uLightOn > 0.0 ? texture(uLight, bu).rgb : vec3(0.0);
    col *= 1.0 - uDim * (1.0 - clamp(max(l.r, max(l.g, l.b)) * 3.0, 0.0, 1.0));
  }
  col += (texture(uBloomA, bu).rgb * 0.9 + texture(uBloomB, bu).rgb * 0.8) * uBloom;
  col = mix(col, uFlash.rgb, uFlash.a);
  vec2 q = gp / uRes - 0.5;
  col *= 1.0 - uVignette * dot(q, q) * 2.0;
  finalColor = vec4(col, 1.0);
}`;
}
