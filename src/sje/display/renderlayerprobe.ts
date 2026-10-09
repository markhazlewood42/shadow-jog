/**
 * RenderLayerProbe: a lab tool for Part A of the engine-platform spike (docs/spikes/engine-platform.md,
 * "Pixi RenderLayer with filters"). It is NOT part of the engine's API.
 *
 * The design says the engine has no `Layer` class and does not use Pixi's `RenderLayer`: a Pixi
 * doc note says children attached to a `RenderLayer` skip the filters of their ancestors, and that
 * was never tested here (scene-graph.md section 2, "About Layer"). This probe lets the lab test it
 * without letting game code touch Pixi: it wraps one `RenderLayer`, can attach a `GameObject`, and can
 * put one `Effect` on the layer itself. Nothing in the engine uses it.
 */
import { RenderLayer } from 'pixi.js';
import type { Container } from './container';
import type { Effect } from './effects';
import type { GameObject } from './gameobject';

export class RenderLayerProbe {
  private readonly layer = new RenderLayer();

  /** Put the layer in `parent`'s Pixi node (a layer draws at its place among the siblings that follow it). */
  constructor(parent: Container) {
    parent._pixi.addChild(this.layer);
  }

  /** Draw `object` through the layer. The object must already be in the display list: it keeps its parent for its transform. */
  attach(object: GameObject): this {
    this.layer.attach(object._pixi);
    return this;
  }

  /** Put one effect on the layer itself, or none. */
  setEffect(effect: Effect | null): this {
    this.layer.filters = effect ? [effect.filter] : null;
    return this;
  }

  destroy(): void {
    this.layer.destroy();
  }
}
