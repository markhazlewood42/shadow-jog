/**
 * Effects and masks (src/sje/display/effects.ts), the 3D view (view3d.ts) and the frame textures
 * (src/sje/render/frametexture.ts), in Node: Pixi builds filters, sprites and texture sources
 * without a GPU, so everything that does not need to DRAW can be checked here. What the GPU makes of
 * them (the pixels) is checked in the browser by e2e/sje-parta.spec.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { colorMatrixEffect, createEffect, FilterList } from '../src/sje/display/effects';
import { Container } from '../src/sje/display/container';
import type { DisplayHost } from '../src/sje/display/gameobject';
import { Graphics } from '../src/sje/display/graphics';
import { View3D } from '../src/sje/display/view3d';
import { CanvasFrameTexture, ExternalFrameTexture } from '../src/sje/render/frametexture';
import type { PixiRenderer } from '../src/sje/render/pixirenderer';
import { TextureManager } from '../src/sje/display/texturemanager';
import { fakeCanvas } from './sjekit';

// Pixi asks a throwaway canvas how precise fragment shaders are when it builds a shader program. Node has no canvas:
// a stand-in that has no WebGL makes Pixi use its default precision.
beforeAll(() => {
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
});
afterAll(() => vi.unstubAllGlobals());

const host = (): DisplayHost => ({ textures: new TextureManager() });

/** The bits of a Pixi node these tests read. */
interface PixiNode {
  filters: unknown[] | null;
  mask: unknown;
  _maskOptions?: { inverse?: boolean; channel?: string };
  position: { x: number; y: number };
  scale: { x: number; y: number };
  anchor: { x: number; y: number };
  destroyed: boolean;
}
const px = (o: { node: unknown }) => o.node as PixiNode;

describe('colorMatrixEffect (a built-in Pixi filter, behind our Effect)', () => {
  it('takes 20 numbers (a 4x5 matrix) and refuses anything else', () => {
    expect(() => colorMatrixEffect([1, 0, 0])).toThrow(/20 numbers/);
    const e = colorMatrixEffect([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]);
    expect(e.name).toBe('color-matrix');
    e.destroy();
  });

  it('a built-in has no uniforms to set, and says so', () => {
    const e = colorMatrixEffect(Array(20).fill(0));
    expect(() => e.set('uFoo', 1)).toThrow(/built-in/);
    e.destroy();
  });
});

describe('createEffect (your own GLSL, both shaders given to Pixi)', () => {
  const fragment = 'void main(void) { finalColor = texture(uTexture, vTextureCoord) * uAmount; }';

  it('puts the header in front of your code: the varyings, uTexture, uInputSize and one line per uniform', () => {
    const e = createEffect({ name: 'tint', fragment, uniforms: { uAmount: { type: 'f32', value: 0.5 }, uColour: { type: 'vec3<f32>', value: [1, 0.5, 0] } } });
    const source = (e.filter as unknown as { glProgram: { fragment: string } }).glProgram.fragment;
    expect(source).toContain('in vec2 vTextureCoord;');
    // (Pixi rewrites `out vec4 finalColor` for the GL version it compiles for, so that line is not checked here.)
    expect(source).toContain('uniform sampler2D uTexture;');
    // Pixi 8.22 needs this declared in the fragment shader or the shader fails and floods the console.
    expect(source).toContain('uniform highp vec4 uInputSize;');
    expect(source).toContain('uniform float uAmount;');
    expect(source).toContain('uniform vec3 uColour;');
    expect(source).toContain(fragment); // your code, untouched
    e.destroy();
  });

  it('uses the engine’s vertex shader (a fragment alone throws in Pixi 8.22)', () => {
    const e = createEffect({ name: 'plain', fragment: 'void main(void) { finalColor = texture(uTexture, vTextureCoord); }' });
    const program = (e.filter as unknown as { glProgram: { vertex: string } }).glProgram;
    expect(program.vertex).toContain('filterVertexPosition');
    e.destroy();
  });

  it('set() changes a uniform, rejects an unknown one, and chains', () => {
    const e = createEffect({ name: 'tint', fragment, uniforms: { uAmount: { type: 'f32', value: 0.5 } } });
    const group = (e.filter as unknown as { resources: { effectUniforms: { uniforms: Record<string, number> } } }).resources.effectUniforms.uniforms;
    expect(group.uAmount).toBe(0.5);
    expect(e.set('uAmount', 0.75)).toBe(e);
    expect(group.uAmount).toBe(0.75);
    expect(() => e.set('uNope', 1)).toThrow(/no uniform "uNope"/);
    e.destroy();
  });

  it('an effect with NO uniforms has no uniform group (an empty group crashed the first draw in Pixi 8.22), and set() says why it refuses', () => {
    const e = createEffect({ name: 'plain', fragment: 'void main(void) { finalColor = texture(uTexture, vTextureCoord); }' });
    expect((e.filter as unknown as { resources: Record<string, unknown> }).resources.effectUniforms).toBeUndefined();
    expect(() => e.set('uAmount', 1)).toThrow(/declared no uniforms/);
    // The same call with one uniform keeps its group (the other cases above read it).
    const withOne = createEffect({ name: 'one', fragment, uniforms: { uAmount: { type: 'f32', value: 1 } } });
    expect((withOne.filter as unknown as { resources: Record<string, unknown> }).resources.effectUniforms).toBeDefined();
    e.destroy();
    withOne.destroy();
  });

  it('padding goes to the filter', () => {
    const e = createEffect({ name: 'pad', fragment, uniforms: { uAmount: { type: 'f32', value: 1 } }, padding: 6 });
    expect((e.filter as unknown as { padding: number }).padding).toBe(6);
    e.destroy();
  });
});

describe('FilterList (go.filters, flat)', () => {
  const effect = () => colorMatrixEffect(Array(20).fill(0));

  it('add and remove write the Pixi node’s filters; an empty list is null so Pixi skips the filter pass', () => {
    const c = new Container(host());
    const a = effect();
    const b = effect();
    expect(px(c).filters ?? null).toBeNull();
    c.filters.add(a).add(b);
    expect(px(c).filters).toHaveLength(2);
    c.filters.add(a); // a repeat is ignored
    expect(px(c).filters).toHaveLength(2);
    c.filters.remove(a);
    expect(px(c).filters).toEqual([b.filter]);
    c.filters.clear();
    expect(px(c).filters ?? null).toBeNull();
    expect(c.filters.list).toEqual([]);
  });

  it('is made on first use, and the same list every time', () => {
    const c = new Container(host());
    expect(c.filters).toBe(c.filters);
    expect(c.filters).toBeInstanceOf(FilterList);
  });

  it('a Graphics mask: the mask is set on the node, and clearMask really removes it (Pixi’s setMask({ mask: null }) does not)', () => {
    const c = new Container(host());
    const m = new Graphics(host());
    c.filters.addMask(m);
    expect(px(c).mask).toBe(px(m));
    c.filters.clearMask();
    expect(px(c).mask ?? null).toBeNull();
    // And a mask can be set again afterwards.
    c.filters.addMask(m, true);
    expect(px(c).mask).toBe(px(m));
    expect(px(c)._maskOptions?.inverse).toBe(true);
  });

  it('a sprite mask reads the ALPHA channel (Pixi’s default reads red times alpha: alpha squared for a white mask)', () => {
    const h = host();
    h.textures.addCanvas('m', fakeCanvas(8, 8));
    const c = new Container(h);
    const m = new Graphics(h);
    c.filters.addMask(m);
    expect(px(c)._maskOptions?.channel).toBe('alpha');
  });

  it('destroying the MASK object clears the mask of the object it masked (no dead node is left behind)', () => {
    const c = new Container(host());
    const m = new Graphics(host());
    c.filters.addMask(m);
    m.destroy();
    expect(px(c).mask ?? null).toBeNull();
    // The list is free again: a new mask can be set.
    const m2 = new Graphics(host());
    c.filters.addMask(m2);
    expect(px(c).mask).toBe(px(m2));
  });

  it('destroying the MASKED object forgets it in the mask (the mask keeps no reference to a dead list)', () => {
    const c = new Container(host());
    const m = new Graphics(host());
    c.filters.addMask(m);
    expect(m._maskUsers.size).toBe(1);
    c.destroy();
    expect(m._maskUsers.size).toBe(0);
    m.destroy();
  });

  it('a destroyed object cannot be a mask', () => {
    const c = new Container(host());
    const m = new Graphics(host());
    m.destroy();
    expect(() => c.filters.addMask(m)).toThrow(/already destroyed/);
  });

  it('Pixi keeps one mask per node: a second addMask is an error, not a silent replace', () => {
    const c = new Container(host());
    c.filters.addMask(new Graphics(host()));
    expect(() => c.filters.addMask(new Graphics(host()))).toThrow(/already has a mask/);
  });
});

describe('View3D (the sprite that shows the 3D picture)', () => {
  const textureOf = (flipY: boolean) => {
    const t = new CanvasFrameTexture(fakeCanvas(480, 270));
    return flipY ? Object.defineProperty(t, 'flipY', { value: true }) : t;
  };

  it('a picture stored upside down (a GL render target) is mirrored: anchor y 1 and scale y -1, so its top-left corner lands at (x, y)', () => {
    const v = new View3D(host(), textureOf(true), 10, 20);
    expect(px(v).anchor).toMatchObject({ x: 0, y: 1 });
    expect(px(v).scale).toMatchObject({ x: 1, y: -1 });
    expect(px(v).position).toMatchObject({ x: 10, y: 20 });
    v.setScale(2);
    expect(px(v).scale).toMatchObject({ x: 2, y: -2 }); // the mirror stays when the scale changes
  });

  it('a picture the right way up (a canvas) is not mirrored', () => {
    const v = new View3D(host(), textureOf(false));
    expect(px(v).anchor).toMatchObject({ x: 0, y: 0 });
    expect(px(v).scale).toMatchObject({ x: 1, y: 1 });
  });

  it('it is a GameObject: depth, alpha, visible, snap to pixel, and the filter list all work', () => {
    const v = new View3D(host(), textureOf(true));
    v.setDepth(-1).setAlpha(0.5).setVisible(false);
    expect([v.depth, v.alpha, v.visible]).toEqual([-1, 0.5, false]);
    v.setPosition(3.4, 4.6);
    expect(px(v).position).toMatchObject({ x: 3, y: 5 }); // snapped like every other object (V3: one pixel grid)
    expect(v.filters).toBeInstanceOf(FilterList);
    expect([v.width, v.height]).toEqual([480, 270]);
  });

  it('destroying the view does NOT destroy the texture: the Frame3D that made it frees it', () => {
    const tex = new CanvasFrameTexture(fakeCanvas(480, 270));
    const destroy = vi.spyOn(tex.texture, 'destroy');
    const v = new View3D(host(), tex);
    v.destroy();
    expect(px(v).destroyed).toBe(true);
    expect(destroy).not.toHaveBeenCalled();
    tex.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe('frame textures (Pixi’s two ways to show a picture another library draws)', () => {
  it('a canvas frame is the right way up, and update() uploads the canvas again', () => {
    const t = new CanvasFrameTexture(fakeCanvas(480, 270));
    expect(t.flipY).toBe(false);
    expect([t.width, t.height]).toEqual([480, 270]);
    const update = vi.spyOn(t.texture.source, 'update');
    t.update();
    expect(update).toHaveBeenCalledTimes(1);
    t.destroy();
    t.update(); // after destroy: nothing, no throw
    expect(update).toHaveBeenCalledTimes(1);
    t.destroy(); // twice is fine
  });

  describe('an external frame (Three’s GL texture wrapped for Pixi)', () => {
    // A stand-in for a Pixi renderer, with just what `ExternalSource` reads: an id and a GL that knows its textures.
    const fakePixi = () => {
      const known = new Set<object>();
      const pixi = { renderer: { uid: 4242, gpu: undefined, gl: { isTexture: (t: object) => known.has(t) } } } as unknown as PixiRenderer;
      const make = () => {
        const tex = {} as WebGLTexture;
        known.add(tex);
        return tex;
      };
      return { pixi, make, forget: (t: WebGLTexture) => known.delete(t) };
    };

    it('is stored upside down (a GL render target keeps its first row at the bottom) and nearest-filtered by intent', () => {
      const { pixi, make } = fakePixi();
      const t = new ExternalFrameTexture(pixi, make(), 480, 270);
      expect(t.flipY).toBe(true);
      expect([t.texture.width, t.texture.height]).toEqual([480, 270]);
      expect(t.texture.source.scaleMode).toBe('nearest');
      t.destroy();
    });

    it('rewrap points it at a NEW GL texture (after a context restore or a resize), and refuses one the context does not know', () => {
      const { pixi, make } = fakePixi();
      const first = make();
      const t = new ExternalFrameTexture(pixi, first, 480, 270);
      const updated = vi.fn();
      t.texture.source.on('update', updated);
      const second = make();
      t.rewrap(second);
      expect(t.texture.source.resource).toBe(second);
      expect(updated).toHaveBeenCalled();
      expect(() => t.rewrap({} as WebGLTexture)).toThrow(/does not belong/);
      t.destroy();
    });

    it('destroy frees the Pixi side once, and rewrap after it does nothing (a restore can arrive after a scene closed)', () => {
      const { pixi, make } = fakePixi();
      const t = new ExternalFrameTexture(pixi, make(), 480, 270);
      t.destroy();
      expect(() => t.rewrap(make())).not.toThrow();
      expect(() => t.destroy()).not.toThrow();
    });
  });
});
