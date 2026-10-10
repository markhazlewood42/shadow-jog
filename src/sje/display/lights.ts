/**
 * Lights: an ambient color and point lights, painted into a light map (docs/engine/scene-graph.md section 11, interfaces.md `Lights`).
 * Follows: nothing in Phaser (its `Lights` plugin is a normal-map renderer; only the name is shared). @ours (deviation)
 *
 * **The first form (M5 decision 3): the same canvas operations as today's `src/field/lighting.ts`, so the same numbers give the same
 * picture.** The light map is a 640x360 (`W` x `H`) picture the size of the camera. `paint` fills it with the ambient color, then adds
 * each point light as a 64 px radial sprite drawn with `'lighter'`. A scene shows the map above the world with a multiply blend. A GPU
 * form (a render texture, no canvas) is a later step, only if the measured cost needs it; the model below does not change for it.
 *
 * This class holds NO display object and no canvas. `paint` and `bloom` draw onto a 2D context the caller gives (a `CanvasImage.ctx`).
 * So the lights run in plain Node, and the test compares their operations with the old `Lighting` one by one
 * (`tests/sje-lights.test.ts`).
 *
 * What stays in code on purpose (the formula, not the tuning): the sprite's falloff stops, the shape of the flicker and the intensity-above-one second pass.
 * The positions, radii, colors, intensities, flicker flags and seeds are map data. The flicker numbers and `spriteBoost` (how strongly a lit sprite
 * resists the dark: 0 = the map decides, 1 = the map is ignored) are look values the game gives (the field: `src/data/fieldlook.json`).
 */
import { assert } from '../core/assert';
import { H, W } from '../core/size';

/** Side of the radial sprite in pixels. Lights are drawn scaled from it. */
export const LIGHT_RES = 64;

/**
 * The tuning of a failing neon tube (the numbers of the old `flickerAmount`). They are look values, so the game gives them (the field reads them from
 * `src/data/fieldlook.json`); the engine holds only the form: two sines and a hard dropout.
 */
export interface FlickerLook {
  /** The steady level of a flickering light, as a multiplier of its intensity. */
  readonly base: number;
  /** The slow wobble: its size and its speed (radians a frame). */
  readonly wobbleSlow: number;
  readonly rateSlow: number;
  /** The fast wobble. */
  readonly wobbleFast: number;
  readonly rateFast: number;
  /** A hard dropout: the hash of the frame mod `dropEvery` is below `dropBelow`, and the light falls to `dropTo`. */
  readonly dropEvery: number;
  readonly dropBelow: number;
  readonly dropTo: number;
}

export interface LightOptions {
  /** A failing neon tube: a slow wobble and now and then a hard dropout. */
  flicker?: boolean;
  /** Phase of the flicker. Default: from the light's position, so two lights flicker apart. */
  seed?: number;
}

/** One point light, as the map holds it. World pixels. */
export interface Light {
  readonly x: number;
  readonly y: number;
  /** Radius in pixels. */
  readonly r: number;
  readonly color: string;
  /** Intensity. Above 1 draws a second pass. */
  readonly i: number;
  readonly flicker: boolean;
  readonly seed: number | undefined;
}

export interface LightHandle {
  /** Take the light out of the set. Safe to call twice. */
  remove(): void;
}

/** Makes the radial sprite for a color. The default draws a gradient on a canvas; a test passes a fake. */
export type LightSpriteMaker = (color: string) => CanvasImageSource;

/**
 * How bright a light is at `frame`, as a multiplier of its intensity: 1 for a steady light. Pure in its arguments.
 * The form is the old `flickerAmount` (`src/field/lighting.ts`); the numbers are `look`.
 */
export function flickerAmount(l: { x: number; y: number; flicker?: boolean | undefined; seed?: number | undefined }, frame: number, look: FlickerLook): number {
  if (!l.flicker) return 1;
  const s = l.seed ?? l.x * 13 + l.y * 7;
  const t = frame + s;
  const base = look.base + Math.sin(t * look.rateSlow) * look.wobbleSlow + Math.sin(t * look.rateFast) * look.wobbleFast;
  // Occasional hard dropout, like a failing neon tube.
  const drop = ((t * 2654435761) >>> 0) % look.dropEvery < look.dropBelow ? look.dropTo : 1;
  return base * drop;
}

/** `#rgb` or `#rrggbb` to [r, g, b]. Anything else is a mistake and throws, not a silent black. */
export function parseRgb(color: string): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  assert(m, `a light color must be #rgb or #rrggbb, got "${color}"`);
  const h = m[1] ?? '000';
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The default sprite: a radial gradient of the color, opaque in the middle and clear at the edge (the old `lightSprite`). A `Lights` keeps the ones it made. */
function gradientSprite(color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = LIGHT_RES;
  canvas.height = LIGHT_RES;
  const ctx = canvas.getContext('2d');
  assert(ctx, 'a 2D canvas context (this browser has no canvas drawing)');
  const [r, g, b] = parseRgb(color);
  const c = LIGHT_RES / 2;
  const grd = ctx.createRadialGradient(c, c, 0, c, c, c);
  grd.addColorStop(0, `rgba(${r},${g},${b},1)`);
  grd.addColorStop(0.3, `rgba(${r},${g},${b},0.72)`);
  grd.addColorStop(0.62, `rgba(${r},${g},${b},0.28)`);
  grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, LIGHT_RES, LIGHT_RES);
  return canvas;
}

export class Lights {
  private ambient = '#ffffff';
  private readonly set: Light[] = [];
  private readonly sprites = new Map<string, CanvasImageSource>();
  private readonly makeSprite: LightSpriteMaker;
  /** When false, `paint` fills the ambient color and adds no light, and `bloom` draws nothing (the old `Lighting.enabled`). */
  enabled = true;
  /** How much sprites resist darkness: 0 = fully lit by the map, 1 = ignore the map. The game gives it (the field: 0.32). A scene's lit-sprite pass reads it. */
  spriteBoost: number;
  private readonly flickerLook: FlickerLook;

  /** `flicker` is the tuning of the failing tube (the game's data); `spriteBoost` defaults to 0, the map decides. */
  constructor(opts: { flicker: FlickerLook; sprite?: LightSpriteMaker; spriteBoost?: number }) {
    this.makeSprite = opts.sprite ?? gradientSprite;
    this.flickerLook = opts.flicker;
    this.spriteBoost = opts.spriteBoost ?? 0;
  }

  /** The ambient color: the color of a pixel no light reaches (`#ffffff` = no darkening). Phaser: `lights.setAmbientColor`. */
  setAmbientColor(color: string): this {
    parseRgb(color);
    this.ambient = color;
    return this;
  }

  get ambientColor(): string {
    return this.ambient;
  }

  /**
   * Add a point light at a world pixel. Phaser: `lights.addLight(x, y, radius, rgb, intensity)`; ours takes a CSS hex color.
   * @param radius pixels, above 0
   * @param intensity 0 or more; above 1 draws a second pass
   * @ours (arguments: `opts` has the flicker)
   */
  addLight(x: number, y: number, radius: number, color = '#ffffff', intensity = 1, opts?: LightOptions): LightHandle {
    assert(radius > 0, `addLight: the radius must be above 0, got ${radius}`);
    assert(intensity >= 0, `addLight: the intensity must be 0 or more, got ${intensity}`);
    parseRgb(color);
    const light: Light = { x, y, r: radius, color, i: intensity, flicker: opts?.flicker === true, seed: opts?.seed };
    this.set.push(light);
    return {
      remove: () => {
        const at = this.set.indexOf(light);
        if (at >= 0) this.set.splice(at, 1);
      },
    };
  }

  /** The lights now in the set, in the order they were added. */
  get lights(): readonly Light[] {
    return this.set;
  }

  get count(): number {
    return this.set.length;
  }

  /** Take every light out. The ambient color stays. */
  clear(): this {
    this.set.length = 0;
    return this;
  }

  /**
   * Paint the light map into `ctx` (a W x H context) for a camera at (camX, camY): the ambient fill, then each light. The operations are the
   * old `Lighting.build` ones, in the same order. A light whose square is wholly off the screen is skipped. Leaves `ctx` in `source-over`
   * at alpha 1.
   */
  paint(ctx: CanvasRenderingContext2D, camX: number, camY: number, frame: number): void {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = this.ambient;
    ctx.fillRect(0, 0, W, H);
    if (!this.enabled) return;
    ctx.globalCompositeOperation = 'lighter';
    for (const l of this.set) {
      const x = l.x - camX;
      const y = l.y - camY;
      if (x + l.r < 0 || y + l.r < 0 || x - l.r > W || y - l.r > H) continue;
      // Intensity above 1 is achieved with a second additive pass.
      let a = l.i * flickerAmount(l, frame, this.flickerLook);
      const img = this.sprite(l.color);
      const d = Math.round(l.r * 2);
      const lx = Math.round(x - l.r);
      const ly = Math.round(y - l.r);
      while (a > 0.01) {
        ctx.globalAlpha = Math.min(1, a);
        ctx.drawImage(img, lx, ly, d, d);
        a -= 1;
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Additive haze around the bright lights (intensity 0.5 or more), drawn onto the screen `ctx` (the old `Lighting.bloom`). */
  bloom(ctx: CanvasRenderingContext2D, camX: number, camY: number, frame: number, strength = 0.16): void {
    if (!this.enabled || strength <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const l of this.set) {
      if (l.i < 0.5) continue;
      const x = l.x - camX;
      const y = l.y - camY;
      const r = l.r * 0.55;
      if (x + r < 0 || y + r < 0 || x - r > W || y - r > H) continue;
      ctx.globalAlpha = strength * l.i * flickerAmount(l, frame, this.flickerLook);
      ctx.drawImage(this.sprite(l.color), Math.round(x - r), Math.round(y - r), Math.round(r * 2), Math.round(r * 2));
    }
    ctx.restore();
  }

  /**
   * A number that changes whenever the light that reaches the world rectangle (x, y, w, h) changes between frames: it mixes the flicker of every flickering light whose
   * lit circle touches the rectangle. 0 when none does. Steady lights are not in it: their light on a spot of the world does not change, whatever the camera does. A scene
   * uses it to skip lighting a sprite again when nothing it stands in has moved (@ours; the old field lit every sprite every frame).
   *
   * "Touches" is the circle, not its bounding square: the light sprite is clear outside its radius, so a corner of the square adds nothing. The test keeps a margin of the
   * sprite's own blur (one texel of the 64 px sprite, scaled to the light's size, plus the rounding of its place), so a rectangle that could take one pixel of the light
   * is always counted; the output is the same as lighting on every frame.
   */
  flickerSignature(x: number, y: number, w: number, h: number, frame: number): number {
    let sig = 0;
    for (const l of this.set) {
      if (!l.flicker) continue;
      // The distance from the light's center to the nearest point of the rectangle.
      const dx = Math.max(x - l.x, 0, l.x - (x + w));
      const dy = Math.max(y - l.y, 0, l.y - (y + h));
      const reach = l.r + l.r / (LIGHT_RES / 2) + 2;
      if (dx * dx + dy * dy > reach * reach) continue;
      sig = (Math.imul(sig, 31) + Math.round(l.i * flickerAmount(l, frame, this.flickerLook) * 4096) + 1) | 0;
    }
    return sig;
  }

  /** True when a flickering light is in the set. A scene with none can skip repainting the light map while the camera stands still. */
  get hasFlicker(): boolean {
    return this.set.some((l) => l.flicker);
  }

  private sprite(color: string): CanvasImageSource {
    let s = this.sprites.get(color);
    if (!s) {
      s = this.makeSprite(color);
      this.sprites.set(color, s);
    }
    return s;
  }
}
