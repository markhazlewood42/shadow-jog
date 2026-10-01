/**
 * The WebGL presenter: the GPU effects layer's back end. Each frame it takes the finished 480×270
 * back buffer plus two layers the scenes drew (engine/postfx.ts: `glow`, what should bloom, and
 * `ui`, what must stay crisp on top), and draws the final picture at the screen's resolution:
 *
 *   1. bloom: the glow layer blurred at half and quarter size (separable Gaussian), so light
 *      spreads softly around whatever was drawn into it (spells, neon, embers);
 *   2. composite: the frame, sampled nearest-neighbour so the pixel art stays sharp, bent by any
 *      shockwaves, its colour channels split near an impact, with the bloom added, the hit flash
 *      and a vignette;
 *   3. particles (engine/particles.ts), drawn as instanced quads, clipped to the battlefield;
 *   4. the UI layer, untouched by any of the above (fades and notices are drawn into it, as in 2D).
 *
 * It draws into its own canvas laid exactly over the game's 2D canvas (#screen), which keeps its
 * size, focus and input. If WebGL 2 is missing or a shader fails, `create` returns null and the
 * game presents in 2D as before; so does a software-only WebGL (no GPU, or a blocklisted one); a
 * lost context falls back the same way until it's restored.
 */
import { H, W } from '../game';
import { PARTICLE_STRIDE } from '../particles';
import { MAX_GLITCHES, MAX_HAZES, MAX_SHOCKS, envelope, postfx } from '../postfx';

const VS_FULL = `#version 300 es
out vec2 vUv;
void main() {
  // One triangle that covers the screen: no vertex buffer needed.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FS_BLUR = `#version 300 es
precision mediump float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
uniform vec2 uStep;
void main() {
  // Nine taps folded into five with linear sampling (weights of a Gaussian, sigma about 2).
  vec4 c = texture(uTex, vUv) * 0.2270270270;
  c += (texture(uTex, vUv + uStep * 1.3846153846) + texture(uTex, vUv - uStep * 1.3846153846)) * 0.3162162162;
  c += (texture(uTex, vUv + uStep * 3.2307692308) + texture(uTex, vUv - uStep * 3.2307692308)) * 0.0702702703;
  o = c;
}`;

const FS_COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uScene;
uniform sampler2D uBloomA;
uniform sampler2D uBloomB;
uniform sampler2D uLight;
uniform vec2 uRes;
uniform vec4 uShock[${MAX_SHOCKS}];
uniform float uShockW[${MAX_SHOCKS}];
uniform vec3 uAberr;
uniform float uBloom;
uniform vec4 uFlash;
uniform float uVignette;
uniform vec4 uHaze[${MAX_HAZES}];
uniform vec4 uGlitch[${MAX_GLITCHES}];
uniform vec2 uGlitchP[${MAX_GLITCHES}];
uniform float uTime;
uniform float uDim;
uniform float uLightOn;
vec2 toUv(vec2 p) { return vec2(p.x / uRes.x, 1.0 - p.y / uRes.y); }
void main() {
  vec2 gp = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  // Shockwaves: each a ring (radius z) that pushes the picture outward by up to w pixels.
  vec2 off = vec2(0.0);
  for (int i = 0; i < ${MAX_SHOCKS}; i++) {
    vec4 s = uShock[i];
    if (s.w == 0.0) continue;
    vec2 d = gp - s.xy;
    float dist = length(d);
    float x = (dist - s.z) / uShockW[i];
    off += (d / max(dist, 0.001)) * exp(-x * x) * s.w;
  }
  // Heat haze: a shimmer, strongest mid-patch, wavering upward as time runs.
  for (int i = 0; i < ${MAX_HAZES}; i++) {
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
  for (int i = 0; i < ${MAX_GLITCHES}; i++) {
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
    col = vec3(texture(uScene, toUv(p + dir)).r, texture(uScene, toUv(p)).g, texture(uScene, toUv(p - dir)).b);
  } else {
    col = texture(uScene, toUv(p)).rgb;
  }
  if (split > 0.0) {
    col.r = texture(uScene, toUv(p + vec2(split, 0.0))).r;
    col.b = texture(uScene, toUv(p - vec2(split, 0.0))).b;
  }
  // The stage dimmed for a big spell: the picture darkens, but not what glows (the light layer).
  if (uDim > 0.0) {
    vec3 l = uLightOn > 0.0 ? texture(uLight, toUv(p)).rgb : vec3(0.0);
    col *= 1.0 - uDim * (1.0 - clamp(max(l.r, max(l.g, l.b)) * 3.0, 0.0, 1.0));
  }
  vec2 bu = toUv(p);
  col += (texture(uBloomA, bu).rgb * 0.9 + texture(uBloomB, bu).rgb * 0.8) * uBloom;
  col = mix(col, uFlash.rgb, uFlash.a);
  vec2 q = vUv - 0.5;
  col *= 1.0 - uVignette * dot(q, q) * 2.0;
  o = vec4(col, 1.0);
}`;

const FS_LAYER = `#version 300 es
precision mediump float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
void main() { o = texture(uTex, vUv); }`;

const VS_PARTICLE = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aPosSize;
layout(location = 2) in float aAngle;
layout(location = 3) in vec4 aColor;
layout(location = 4) in float aShape;
uniform vec2 uRes;
out vec2 vLocal;
out vec4 vColor;
flat out int vShape;
void main() {
  float c = cos(aAngle), s = sin(aAngle);
  vec2 l = aCorner * aPosSize.zw * 0.5;
  vec2 p = aPosSize.xy + vec2(l.x * c - l.y * s, l.x * s + l.y * c);
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
  vLocal = aCorner;
  vColor = aColor;
  vShape = int(aShape + 0.5);
}`;

const FS_PARTICLE = `#version 300 es
precision mediump float;
in vec2 vLocal;
in vec4 vColor;
flat in int vShape;
out vec4 o;
void main() {
  float r = length(vLocal);
  float a;
  if (vShape == 0) a = pow(max(0.0, 1.0 - r), 2.0);                                 // soft glow
  else if (vShape == 1) a = step(r, 1.0);                                           // dot
  else if (vShape == 2) a = (1.0 - abs(vLocal.x)) * pow(max(0.0, 1.0 - abs(vLocal.y)), 2.0); // spark
  else if (vShape == 3) a = 1.0;                                                    // square
  else a = smoothstep(0.6, 0.8, r) * (1.0 - smoothstep(0.88, 1.0, r));              // ring
  a *= vColor.a;
  if (a <= 0.004) discard;
  o = vec4(vColor.rgb * a, a);
}`;

type GL = WebGL2RenderingContext;

/** The GPU resources (all rebuilt together after a lost context). */
interface Res {
  vao: WebGLVertexArrayObject;
  pVao: WebGLVertexArrayObject;
  pInst: WebGLBuffer;
  scene: WebGLTexture;
  glow: WebGLTexture;
  ui: WebGLTexture;
  /** The light that blooms, at game size: the glow layer plus the glowing particles. */
  lit: Target;
  half: [Target, Target];
  quarter: [Target, Target];
  blur: WebGLProgram;
  comp: WebGLProgram;
  layer: WebGLProgram;
  /** Every uniform location, looked up once (no string keys per frame). */
  u: {
    blur: Uni<'uTex' | 'uStep'>;
    comp: Uni<'uScene' | 'uBloomA' | 'uBloomB' | 'uRes' | 'uShock' | 'uShockW' | 'uAberr' | 'uBloom' | 'uFlash' | 'uVignette' | 'uLight' | 'uHaze' | 'uGlitch' | 'uGlitchP' | 'uTime' | 'uDim' | 'uLightOn'>;
    layer: Uni<'uTex'>;
    part: Uni<'uRes'>;
  };
  part: WebGLProgram;
}

const NO_PARTICLES = { add: 0, alpha: 0 } as const;

type Uni<K extends string> = Record<K, WebGLUniformLocation | null>;

function uniforms<K extends string>(gl: GL, p: WebGLProgram, names: readonly K[]): Uni<K> {
  const o = {} as Uni<K>;
  for (const n of names) o[n] = gl.getUniformLocation(p, n);
  return o;
}

interface Target {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
  w: number;
  h: number;
}

function compile(gl: GL, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error('WebGL: no shader');
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`WebGL shader: ${gl.getShaderInfoLog(s) ?? 'failed'}`);
  return s;
}

function program(gl: GL, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error('WebGL: no program');
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`WebGL program: ${gl.getProgramInfoLog(p) ?? 'failed'}`);
  return p;
}

function texture(gl: GL, w: number, h: number, filter: number): WebGLTexture {
  const t = gl.createTexture();
  if (!t) throw new Error('WebGL: no texture');
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function target(gl: GL, w: number, h: number): Target {
  const tex = texture(gl, w, h, gl.LINEAR);
  const fb = gl.createFramebuffer();
  if (!fb) throw new Error('WebGL: no framebuffer');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fb, w, h };
}

/** '#rrggbb' or '#rgb' into `out` as 0..1 channels (white if it can't be read). */
function rgbInto(hex: string, out: Float32Array): void {
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

/** Renderer names of WebGL drawn on the CPU (no GPU, or one the browser won't use). */
export const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software|basic render driver/i;

/** Is this context drawn in software? (By the unmasked driver name where the browser gives it.) */
export function softwareRenderer(gl: GL): boolean {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
  return SOFTWARE_GL.test(name);
}

export class GlPresenter {
  readonly canvas: HTMLCanvasElement;
  private gl: GL;
  /** False while the context is lost (the display presents in 2D meanwhile). */
  ok = true;
  private lostHandler = (e: Event) => {
    e.preventDefault();
    this.ok = false;
  };
  private restoredHandler = () => {
    try {
      this.r = this.build();
      this.ok = true;
    } catch {
      this.ok = false;
    }
  };
  /** Everything on the GPU, rebuilt if the context is lost and restored. */
  private r: Res;
  private pData = new Float32Array(4096 * PARTICLE_STRIDE);
  /** The flash colour, parsed only when it changes. */
  private flashHex = '';
  private flashRgb = new Float32Array([1, 1, 1]);
  private shockBuf = new Float32Array(MAX_SHOCKS * 4);
  private shockW = new Float32Array(MAX_SHOCKS);
  private hazeBuf = new Float32Array(MAX_HAZES * 4);
  private glitchBuf = new Float32Array(MAX_GLITCHES * 4);
  private glitchP = new Float32Array(MAX_GLITCHES * 2);

  private constructor(canvas: HTMLCanvasElement, gl: GL) {
    this.canvas = canvas;
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', this.lostHandler);
    canvas.addEventListener('webglcontextrestored', this.restoredHandler);
    this.r = this.build();
  }

  /** A presenter on a new canvas, or null when this browser can't (no WebGL 2, or a shader fails). */
  static create(): GlPresenter | null {
    const canvas = document.createElement('canvas');
    // failIfMajorPerformanceCaveat: no context on a software renderer (no GPU, or a blocklisted
    // one): drawing the effects on the CPU would slow the game to ~30 fps. The 2D path takes over.
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: true });
    if (!gl) return null;
    // Some software renderers don't count as a "major caveat" (headless Chromium's SwiftShader, on
    // CI, hands out a context and the game drops to ~25 fps), so ask the driver's name as well.
    if (softwareRenderer(gl)) {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return null;
    }
    try {
      return new GlPresenter(canvas, gl);
    } catch (e) {
      console.warn('GPU effects unavailable:', e);
      return null;
    }
  }

  private build(): Res {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    const pVao = gl.createVertexArray();
    const corners = gl.createBuffer();
    const pInst = gl.createBuffer();
    if (!vao || !pVao || !corners || !pInst) throw new Error('WebGL: no buffers');
    const halfH = Math.ceil(H / 2), quarterH = Math.ceil(H / 4);
    const r: Res = {
      vao,
      pVao,
      pInst,
      scene: texture(gl, W, H, gl.NEAREST),
      ui: texture(gl, W, H, gl.NEAREST),
      glow: texture(gl, W, H, gl.LINEAR),
      lit: target(gl, W, H),
      half: [target(gl, W / 2, halfH), target(gl, W / 2, halfH)],
      quarter: [target(gl, W / 4, quarterH), target(gl, W / 4, quarterH)],
      blur: program(gl, VS_FULL, FS_BLUR),
      comp: program(gl, VS_FULL, FS_COMPOSITE),
      layer: program(gl, VS_FULL, FS_LAYER),
      part: program(gl, VS_PARTICLE, FS_PARTICLE),
      u: { blur: {} as Uni<'uTex' | 'uStep'>, comp: {} as Res['u']['comp'], layer: {} as Uni<'uTex'>, part: {} as Uni<'uRes'> },
    };
    r.u = {
      blur: uniforms(gl, r.blur, ['uTex', 'uStep']),
      comp: uniforms(gl, r.comp, ['uScene', 'uBloomA', 'uBloomB', 'uRes', 'uShock', 'uShockW', 'uAberr', 'uBloom', 'uFlash', 'uVignette', 'uLight', 'uHaze', 'uGlitch', 'uGlitchP', 'uTime', 'uDim', 'uLightOn']),
      layer: uniforms(gl, r.layer, ['uTex']),
      part: uniforms(gl, r.part, ['uRes']),
    };
    // Particles: a unit quad (triangle strip) shared by every instance, and one packed buffer.
    gl.bindVertexArray(pVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, pInst);
    gl.bufferData(gl.ARRAY_BUFFER, this.pData.byteLength, gl.DYNAMIC_DRAW);
    for (const loc of [1, 2, 3, 4]) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribDivisor(loc, 1);
    }
    this.bindInstances(0);
    gl.bindVertexArray(null);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    return r;
  }

  /** Point the per-particle attributes at the buffer, starting from particle `first`. */
  private bindInstances(first: number): void {
    const gl = this.gl;
    const stride = PARTICLE_STRIDE * 4, base = first * stride;
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, base); // x, y, width, height
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, base + 4 * 4); // angle
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, base + 5 * 4); // r, g, b, a
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, base + 9 * 4); // shape
  }

  resize(w: number, h: number): void {
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  private upload(tex: WebGLTexture, src: HTMLCanvasElement): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
  }

  private blurPass(src: WebGLTexture, srcW: number, srcH: number, dst: Target, dx: number, dy: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.viewport(0, 0, dst.w, dst.h);
    gl.useProgram(this.r.blur);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(this.r.u.blur.uTex, 0);
    gl.uniform2f(this.r.u.blur.uStep, dx / srcW, dy / srcH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Draw one frame. `glowUsed`: a scene drew into the glow layer this frame (else bloom is skipped). */
  present(scene: HTMLCanvasElement, glow: HTMLCanvasElement, ui: HTMLCanvasElement, glowUsed: boolean): void {
    const gl = this.gl;
    if (!this.ok || gl.isContextLost()) return;
    gl.bindVertexArray(this.r.vao);
    gl.disable(gl.BLEND);
    this.upload(this.r.scene, scene);
    this.upload(this.r.ui, ui);
    // Particles are packed once and drawn twice: into the light (so they bloom) and on top, sharp.
    const parts = postfx.particles.count ? this.packParticles() : NO_PARTICLES;
    const bloom = glowUsed || parts.add ? postfx.bloom + postfx.pulse : 0;
    if (bloom > 0) {
      // The light: the glow layer, plus every glowing particle, at game size.
      const lit = this.r.lit;
      gl.bindFramebuffer(gl.FRAMEBUFFER, lit.fb);
      gl.viewport(0, 0, W, H);
      if (glowUsed) {
        this.upload(this.r.glow, glow);
        gl.useProgram(this.r.layer);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.r.glow);
        gl.uniform1i(this.r.u.layer.uTex, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      } else {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      if (parts.add) {
        gl.enable(gl.BLEND);
        this.drawParticles(parts, 1, true);
        gl.disable(gl.BLEND);
        gl.bindVertexArray(this.r.vao);
      }
      // Half size: blur across, then down. Quarter size: the same again, wider.
      const [h0, h1] = this.r.half, [q0, q1] = this.r.quarter;
      this.blurPass(lit.tex, W, H, h0, 1, 0);
      this.blurPass(h0.tex, h0.w, h0.h, h1, 0, 1);
      this.blurPass(h1.tex, h1.w, h1.h, q0, 1, 0);
      this.blurPass(q0.tex, q0.w, q0.h, q1, 0, 1);
    }
    // Composite into the canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const c = this.r.comp;
    gl.useProgram(c);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.r.scene);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.r.half[1].tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.r.quarter[1].tex);
    gl.uniform1i(this.r.u.comp.uScene, 0);
    gl.uniform1i(this.r.u.comp.uBloomA, 1);
    gl.uniform1i(this.r.u.comp.uBloomB, 2);
    // The full-size light, so the stage dim can spare what glows.
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.r.lit.tex);
    gl.uniform1i(this.r.u.comp.uLight, 3);
    gl.uniform1f(this.r.u.comp.uLightOn, bloom > 0 ? 1 : 0);
    gl.uniform1f(this.r.u.comp.uDim, postfx.dimNow);
    gl.uniform1f(this.r.u.comp.uTime, postfx.time);
    this.hazeBuf.fill(0);
    postfx.hazes.slice(0, MAX_HAZES).forEach((h, i) => {
      this.hazeBuf.set([h.x, h.y, h.radius, h.strength * envelope(h.t, h.life, 8, 20)], i * 4);
    });
    this.glitchBuf.fill(0);
    this.glitchP.fill(0);
    postfx.glitches.slice(0, MAX_GLITCHES).forEach((g, i) => {
      this.glitchBuf.set([g.x, g.y, g.w, g.h], i * 4);
      this.glitchP.set([g.strength * envelope(g.t, g.life, 2, 6), g.seed], i * 2);
    });
    gl.uniform4fv(this.r.u.comp.uHaze, this.hazeBuf);
    gl.uniform4fv(this.r.u.comp.uGlitch, this.glitchBuf);
    gl.uniform2fv(this.r.u.comp.uGlitchP, this.glitchP);
    gl.uniform2f(this.r.u.comp.uRes, W, H);
    this.shockBuf.fill(0);
    const shocks = postfx.shocks;
    for (let i = 0; i < shocks.length && i < MAX_SHOCKS; i++) {
      const s = shocks[i];
      if (!s) continue;
      const k = s.t / s.life;
      // The ring runs out to its reach, easing; its push fades as it goes.
      this.shockBuf[i * 4] = s.x;
      this.shockBuf[i * 4 + 1] = s.y;
      this.shockBuf[i * 4 + 2] = s.reach * (1 - (1 - k) ** 2);
      this.shockBuf[i * 4 + 3] = s.strength * (1 - k) ** 1.5;
      this.shockW[i] = s.width * (0.6 + k);
    }
    gl.uniform4fv(this.r.u.comp.uShock, this.shockBuf);
    gl.uniform1fv(this.r.u.comp.uShockW, this.shockW);
    gl.uniform3f(this.r.u.comp.uAberr, postfx.aberration, postfx.aberrationX, postfx.aberrationY);
    gl.uniform1f(this.r.u.comp.uBloom, bloom);
    if (postfx.flashColor !== this.flashHex) {
      this.flashHex = postfx.flashColor;
      rgbInto(this.flashHex, this.flashRgb);
    }
    gl.uniform4f(this.r.u.comp.uFlash, this.flashRgb[0] ?? 1, this.flashRgb[1] ?? 1, this.flashRgb[2] ?? 1, postfx.flashAlpha);
    gl.uniform1f(this.r.u.comp.uVignette, postfx.vignette);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // Particles, over the picture and under the UI.
    gl.enable(gl.BLEND);
    if (parts.add + parts.alpha) this.drawParticles(parts, this.canvas.width / W, false);
    // The UI layer on top (premultiplied alpha).
    gl.bindVertexArray(this.r.vao);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.r.layer);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.r.ui);
    gl.uniform1i(this.r.u.layer.uTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  /** Pack the living particles into the instance buffer (once a frame). */
  private packParticles(): { add: number; alpha: number } {
    const gl = this.gl;
    const counts = postfx.particles.write(this.pData);
    const n = counts.add + counts.alpha;
    if (n) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.r.pInst);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.pData, 0, n * PARTICLE_STRIDE);
    }
    return counts;
  }

  /**
   * Draw the packed particles into whatever framebuffer is bound, `k` output pixels per game pixel
   * (for the battlefield clip). `lightOnly`: just the additive ones (the bloom's light).
   */
  private drawParticles(counts: { add: number; alpha: number }, k: number, lightOnly: boolean): void {
    const gl = this.gl;
    gl.bindVertexArray(this.r.pVao);
    gl.useProgram(this.r.part);
    gl.uniform2f(this.r.u.part.uRes, W, H);
    const clip = postfx.clip;
    if (clip) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(Math.round(clip.x * k), Math.round((H - clip.y - clip.h) * k), Math.round(clip.w * k), Math.round(clip.h * k));
    }
    if (counts.add) {
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, counts.add);
    }
    if (counts.alpha && !lightOnly) {
      // The covering ones sit after the additive ones in the buffer: start the instances there.
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.r.pInst);
      this.bindInstances(counts.add);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, counts.alpha);
      this.bindInstances(0);
    }
    gl.disable(gl.SCISSOR_TEST);
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.lostHandler);
    this.canvas.removeEventListener('webglcontextrestored', this.restoredHandler);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.canvas.remove();
  }
}
