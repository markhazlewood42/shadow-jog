/**
 * The field's lights on the new engine (M5 task 6, decision 3 first form).
 *
 * `Lights` (src/sje/display/lights.ts) is the model and the painter: the same canvas operations and numbers as the old `Lighting` (src/field/lighting.ts), proved equal
 * by tests/sje-lights.test.ts. This class is the display half the engine leaves to the scene: a `CanvasImage` the light map is painted into and a multiply blend that shows
 * it over the world, and a second `CanvasImage`, additive, for the haze around the bright lights. Both are the size of the screen and pinned to it.
 *
 * Repainting. The map is a picture of the screen, so a camera move needs a new one. With the camera still, only flickering lights change it. `paint` therefore skips
 * the work (and the 640x360 upload) when neither happened, which is most frames of a room.
 */
import { CanvasImage, type DisplayHost, H, Lights, W } from '../sje';
import { LAYER } from './params';
import type { StageMap } from './view';

export class LightRig {
  readonly lights = new Lights();
  /** The light map, multiplied over the world. */
  readonly map: CanvasImage;
  /** The haze, added over the world. */
  readonly bloom: CanvasImage;
  /** Bumped when the ambient color or the set of lights changes, so lit pictures know to light again. */
  epoch = 0;
  /** Times the map was painted (the hook and the tests). */
  paints = 0;
  private cx = Number.NaN;
  private cy = Number.NaN;
  private sig = 0;
  private strength = -1;
  private hazy = false;

  constructor(host: DisplayHost, add: (o: CanvasImage) => void) {
    this.map = new CanvasImage(host, 0, 0, W, H);
    this.map.setDepth(LAYER.LIGHT).setBlendMode('multiply');
    this.bloom = new CanvasImage(host, 0, 0, W, H);
    this.bloom.setDepth(LAYER.BLOOM).setBlendMode('add');
    add(this.map);
    add(this.bloom);
  }

  /** The lights of a map. The old field built its `BakedLight` list once per map; the rig copies it into the model. */
  load(map: StageMap): void {
    this.lights.clear();
    this.lights.setAmbientColor(map.def.ambient);
    for (const l of map.lights) this.lights.addLight(l.x, l.y, l.r, l.color, l.i, { flicker: l.flicker === true, ...(l.seed !== undefined ? { seed: l.seed } : {}) });
    // Any picture lit under the old lights is out of date; the camera key forces the map itself to paint again.
    this.epoch++;
    this.cx = Number.NaN;
    this.cy = Number.NaN;
    this.hazy = map.lights.some((l) => l.i >= 0.5);
  }

  /** Change the ambient color of the map on show (a script or a tool did): every lit picture lights again and the map paints on the next frame. */
  setAmbient(color: string): void {
    this.lights.setAmbientColor(color);
    this.epoch++;
    this.cx = Number.NaN;
    this.cy = Number.NaN;
  }

  /** The multiply sprite of the light map. */
  get mapCanvas(): HTMLCanvasElement {
    return this.map.canvas;
  }

  /**
   * Paint the light map and the haze for this camera and frame, if they changed. `strength` is the haze's strength (the old `Lighting.bloom` argument). Returns true
   * when the map was painted.
   */
  paint(cx: number, cy: number, frame: number, strength: number): boolean {
    const sig = this.lights.flickerSignature(cx, cy, W, H, frame);
    if (cx === this.cx && cy === this.cy && sig === this.sig && strength === this.strength) return false;
    this.cx = cx;
    this.cy = cy;
    this.sig = sig;
    this.strength = strength;
    this.paints++;
    this.lights.paint(this.map.ctx, cx, cy, frame);
    this.map.refresh();
    this.bloom.visible = this.hazy && strength > 0;
    if (this.bloom.visible) {
      const b = this.bloom.ctx;
      b.clearRect(0, 0, W, H);
      this.lights.bloom(b, cx, cy, frame, strength);
      this.bloom.refresh();
    }
    return true;
  }
}
