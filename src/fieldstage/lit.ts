/**
 * A picture lit by the light map (M5 task 6, decision 3: the first form keeps the old canvas operations).
 *
 * The old field lit each sprite with `Lighting.drawLit` (src/field/lighting.ts): copy the sprite into a scratch the size of the sprite, multiply the light map's
 * rectangle under it (at `1 - spriteBoost`, so a sprite resists the dark), keep only the sprite's own pixels (`destination-in`), and draw the scratch onto the screen.
 * Here the scratch IS the picture's canvas (a `CanvasImage` of the sprite's size), so the same three operations run and the result is one small texture that the scene
 * sorts with the others. The overhead layer was lit the same way with `drawLitLayer`: no boost, one rectangle at a time.
 *
 * It lights again only when it could look different. The light on a spot of the world does not change while the camera moves (a steady light is fixed to the world; the
 * map is painted again for the new camera, but the same light lands on the same spot), so what the picture depends on is: the picture, where it stands in the world, the
 * flicker of the lights that reach it (`Lights.flickerSignature`), and the scene's `epoch` (bumped when the ambient color or the set of lights changes). A picture that
 * is partly off the screen is lit every frame, because the light map is only as big as the screen. That makes a still prop on a still camera free, and a walking actor
 * a few small copies a frame, where the old field did the same copies for every sprite on every frame.
 */
import { CanvasImage, type DisplayHost, H, W } from '../sje';

export class LitPicture {
  readonly image: CanvasImage;
  private src: CanvasImageSource | null = null;
  private wx = Number.NaN;
  private wy = Number.NaN;
  private sig = 0;
  private epoch = -1;
  /** How many times this picture was lit (for the tests and the hook). */
  lit = 0;

  constructor(host: DisplayHost, readonly w: number, readonly h: number) {
    this.image = new CanvasImage(host, 0, 0, w, h);
  }

  /**
   * Light the picture if it needs it. `src` is the sprite (all of it, or the rectangle `crop` of it); `(wx, wy)` is where its top-left corner is in the world; `(sx, sy)`
   * is where that is on the screen, which is where the light map is read. `map` is the light map's canvas, or null when the lights are off (the picture is then shown
   * as it is). Returns true when the canvas changed.
   */
  relight(src: CanvasImageSource, crop: { x: number; y: number } | null, map: HTMLCanvasElement | null, boost: number, wx: number, wy: number, sx: number, sy: number, sig: number, epoch: number): boolean {
    const edge = sx < 0 || sy < 0 || sx + this.w > W || sy + this.h > H;
    if (!edge && src === this.src && wx === this.wx && wy === this.wy && sig === this.sig && epoch === this.epoch) return false;
    this.src = src;
    this.wx = wx;
    this.wy = wy;
    this.sig = sig;
    this.epoch = epoch;
    const s = this.image.ctx;
    const w = this.w;
    const h = this.h;
    const draw = (): void => {
      if (crop) s.drawImage(src, crop.x, crop.y, w, h, 0, 0, w, h);
      else s.drawImage(src, 0, 0);
    };
    s.globalCompositeOperation = 'copy';
    draw();
    if (map) {
      s.globalCompositeOperation = 'multiply';
      s.globalAlpha = 1 - boost;
      s.drawImage(map, sx, sy, w, h, 0, 0, w, h);
      s.globalAlpha = 1;
      s.globalCompositeOperation = 'destination-in';
      draw();
    }
    s.globalCompositeOperation = 'source-over';
    this.image.refresh();
    this.lit++;
    return true;
  }
}

/** True when the canvas has no pixel with any alpha (a prop's emissive half is often empty, and such a picture is not worth a texture). Reads the pixels once. */
export function isBlank(canvas: HTMLCanvasElement): boolean {
  const probe = document.createElement('canvas');
  probe.width = canvas.width;
  probe.height = canvas.height;
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(canvas, 0, 0);
  const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return false;
  return true;
}
