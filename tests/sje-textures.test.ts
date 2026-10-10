/**
 * The three TextureManager methods that moved into the engine in M3 (docs/engine/m3-brief.md task 2): `addCanvasOnce`, `variantOf` and `readPixels`,
 * and the one pixel type, `Raw` = { w, h, data }. Node has no canvas, so the one thing faked is a small in-memory 2D canvas that stores RGBA bytes
 * (the whole-picture and sub-rectangle copies these paths make). The texture manager, its frames and its keys are the real ones.
 *
 * What it pins: a key is built once (the second call does not call `build`), a raw picture becomes a canvas, a variant copies the frames and is found
 * again by its name, and `readPixels` gives back the bytes of the whole picture or of exactly one frame's rectangle (control: the wrong frame gives other
 * bytes, an unknown frame throws).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Raw, TextureManager } from '../src/sje';

class FakeCanvas {
  width = 300;
  height = 150;
  bytes = new Uint8ClampedArray(0);
  /** The pixels, made on first use at the size the canvas has by then. */
  get px(): Uint8ClampedArray {
    if (this.bytes.length !== this.width * this.height * 4) this.bytes = new Uint8ClampedArray(this.width * this.height * 4);
    return this.bytes;
  }
  getContext(): FakeContext {
    return new FakeContext(this);
  }
}

class FakeImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

class FakeContext {
  imageSmoothingEnabled = true;
  constructor(private readonly canvas: FakeCanvas) {}
  putImageData(img: FakeImageData): void {
    this.canvas.px.set(img.data);
  }
  getImageData(x: number, y: number, w: number, h: number): FakeImageData {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row++) out.set(this.canvas.px.subarray(((y + row) * this.canvas.width + x) * 4, ((y + row) * this.canvas.width + x + w) * 4), row * w * 4);
    return new FakeImageData(out, w, h);
  }
  /** `drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh)` with equal source and destination sizes (all the engine does). */
  drawImage(src: FakeCanvas, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number): void {
    for (let row = 0; row < sh; row++) {
      const from = ((sy + row) * src.width + sx) * 4;
      this.canvas.px.set(src.px.subarray(from, from + sw * 4), ((dy + row) * this.canvas.width + dx) * 4);
    }
  }
}

const realDocument = (globalThis as { document?: unknown }).document;
const realImageData = (globalThis as { ImageData?: unknown }).ImageData;
beforeAll(() => {
  (globalThis as unknown as { document: unknown }).document = { createElement: () => new FakeCanvas() };
  (globalThis as unknown as { ImageData: unknown }).ImageData = FakeImageData;
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDocument;
  (globalThis as { ImageData?: unknown }).ImageData = realImageData;
});

/** A 4 x 2 picture whose every byte is different, so a wrong rectangle cannot match by accident. */
function sample(): Raw {
  return { w: 4, h: 2, data: Uint8ClampedArray.from({ length: 4 * 2 * 4 }, (_, i) => i + 1) };
}

describe('TextureManager.addCanvasOnce', () => {
  it('builds a key once: the second call returns the texture already there and does not call build', () => {
    const textures = new TextureManager();
    const build = vi.fn(() => sample());
    const a = textures.addCanvasOnce('pic', build);
    const b = textures.addCanvasOnce('pic', build);
    expect(build).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
    expect(textures.getTextureKeys()).toEqual(['pic']);
  });

  it('turns raw pixels into a canvas of the same size and the same bytes', () => {
    const textures = new TextureManager();
    const t = textures.addCanvasOnce('pic', () => sample());
    expect([t.width, t.height]).toEqual([4, 2]);
    expect(Array.from(textures.readPixels('pic').data)).toEqual(Array.from(sample().data));
  });

  it('takes a canvas as it is', () => {
    const textures = new TextureManager();
    const canvas = new FakeCanvas();
    canvas.width = 3;
    canvas.height = 2;
    const t = textures.addCanvasOnce('c', () => canvas as unknown as HTMLCanvasElement);
    expect([t.width, t.height]).toEqual([3, 2]);
  });
});

describe('TextureManager.readPixels', () => {
  it('gives the bytes of one frame only, and the whole picture without a frame (control: another frame gives other bytes)', () => {
    const textures = new TextureManager();
    textures.addCanvasOnce('sheet', () => sample());
    textures.addFrames('sheet', { 0: [0, 0, 2, 2], 1: [2, 0, 2, 2] });
    const whole = textures.readPixels('sheet');
    expect(whole.w).toBe(4);
    const left = textures.readPixels('sheet', 0);
    const right = textures.readPixels('sheet', 1);
    expect([left.w, left.h, right.w, right.h]).toEqual([2, 2, 2, 2]);
    // Frame 0 is columns 0 and 1 of both rows; frame 1 is columns 2 and 3.
    const px = (x: number, y: number): number[] => Array.from(sample().data.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 4));
    expect(Array.from(left.data)).toEqual([...px(0, 0), ...px(1, 0), ...px(0, 1), ...px(1, 1)]);
    expect(Array.from(right.data)).toEqual([...px(2, 0), ...px(3, 0), ...px(2, 1), ...px(3, 1)]);
    expect(Array.from(left.data)).not.toEqual(Array.from(right.data));
  });

  it('throws for a frame or a key that is not there', () => {
    const textures = new TextureManager();
    textures.addCanvasOnce('sheet', () => sample());
    expect(() => textures.readPixels('sheet', 'nope')).toThrow(/frame "nope"/);
    expect(() => textures.readPixels('missing')).toThrow(/texture "missing"/);
  });
});

describe('TextureManager.variantOf', () => {
  it('paints a copy under the new key with the same named frames, once (control: the base is untouched)', () => {
    const textures = new TextureManager();
    textures.addCanvasOnce('sheet', () => sample());
    textures.addFrames('sheet', { 0: [0, 0, 2, 2], 1: [2, 0, 2, 2] });
    const paint = vi.fn((src: HTMLCanvasElement) => {
      const out = new FakeCanvas();
      out.width = src.width;
      out.height = src.height;
      out.px.set((src as unknown as FakeCanvas).px);
      out.px[0] = 200;
      return out as unknown as HTMLCanvasElement;
    });
    const v = textures.variantOf('sheet', 'sheet-red', paint);
    expect(v.key).toBe('sheet-red');
    expect([...v.frames.keys()].map(String).sort()).toEqual(['0', '1']);
    expect(textures.readPixels('sheet-red').data[0]).toBe(200);
    expect(textures.readPixels('sheet').data[0]).toBe(1);
    // Asked again: the same texture, and paint is not called a second time.
    expect(textures.variantOf('sheet', 'sheet-red', paint)).toBe(v);
    expect(paint).toHaveBeenCalledTimes(1);
  });
});
