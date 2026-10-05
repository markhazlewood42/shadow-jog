/**
 * Free the GPU data of a Three object tree (docs/engine/frame-and-rendering.md 7.2, rule 8).
 * Three does not free geometry, materials or textures when an object is dropped: each has a
 * `dispose()`, and an object that is never disposed keeps its GL buffers and textures for good.
 * The leak test (10 enter-and-leave cycles, flat GL counts) is what proves this runs.
 */
import type { BufferGeometry, Material, Object3D, Texture } from 'three';

interface MaybeRenderable {
  geometry?: BufferGeometry;
  material?: Material | Material[];
}

const isTexture = (v: unknown): v is Texture => typeof v === 'object' && v !== null && (v as { isTexture?: boolean }).isTexture === true;

/**
 * Dispose every geometry, material and texture under `root`, and KEEP the objects. Safe to call twice.
 * Three treats `dispose()` as "free the GPU copy": the object is still good, and the next draw uploads it again.
 *
 * Used when the GL context is LOST. Every GPU object is gone then, and Three still has a record of each one,
 * with a dispose listener that deletes it. After a context restore Three builds NEW records and the old
 * listeners stay on every geometry. A dispose at scene end would then run the old ones too, and each of
 * them deletes a dead handle (the browser logs "object does not belong to this context", 168 times in
 * the lab). While the context is lost every GL call is a silent no-op, so disposing HERE removes the old
 * listeners for free. The new records are made when the scene draws again.
 */
export function releaseGpuData(root: Object3D): void {
  root.traverse((node) => {
    const o = node as unknown as MaybeRenderable;
    o.geometry?.dispose();
    const materials = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of materials) {
      // A texture lives in a property of the material (`map`, `emissiveMap`...). Find them all.
      for (const v of Object.values(m)) if (isTexture(v)) v.dispose();
      m.dispose();
    }
  });
}

/** Dispose every geometry, material and texture under `root`, then drop its children. Safe to call twice. */
export function disposeObject3D(root: Object3D): void {
  releaseGpuData(root);
  root.clear();
}
