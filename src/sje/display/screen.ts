/**
 * Screen: the Pixi root of the whole picture, with its three shared roots
 * (docs/engine/scene-graph.md section 6, frame-and-rendering.md 6.2).
 *
 *   screen
 *    |- worldRoot    the `world` of the opaque base scene. Screen filters run here (M2: the `CompositeFilter`).
 *    |- fxRoot       the effects' own layers (M2): the layer that holds a scene's UI drawn on the effects path, and the particles. No filters.
 *    |- uiRoot       the `ui` of the base scene, then the `world` and `ui` of every scene above it.
 *    |                No screen filters, no shake.
 *    `- overlayRoot  game fade, game flash, notices. Nothing else.
 *
 * "Screen" means this Pixi root. The word "stage" always means the battle stage.
 *
 * Each scene owns two containers (`world` and `ui`). This class parents them under the shared
 * roots in stack order whenever the stack changes (`layout`), so the roots only hold what is drawn.
 */
import { Container as PixiContainer, type Filter, Rectangle } from 'pixi.js';
import { H, W } from '../core/size';
import type { BackBuffer } from '../render/backbuffer';
import { Container } from './container';
import type { DisplayHost } from './gameobject';

/** One scene's place in the picture. The runtime computes these from the stack flags. */
export interface ScreenSlot {
  readonly world: Container;
  readonly ui: Container;
  /** Drawn at all? A hidden scene (under an opaque one, or under a curtain) is left out. */
  readonly visible: boolean;
  /** The scene whose `world` goes under `worldRoot` (the opaque base). Only one slot is the base. */
  readonly base: boolean;
}

export class Screen {
  readonly worldRoot: Container;
  readonly uiRoot: Container;
  readonly overlayRoot: Container;
  /** @internal Owned by `FxSystem`: it adds its layers here. Between the world and the UI, so particles show over the filtered world and under the menus. */
  readonly fxRoot = new PixiContainer({ label: 'fxRoot' });
  private readonly root = new PixiContainer({ label: 'screen' });

  constructor(host: DisplayHost) {
    this.worldRoot = new Container(host, 0, 0, 'worldRoot');
    this.uiRoot = new Container(host, 0, 0, 'uiRoot');
    this.overlayRoot = new Container(host, 0, 0, 'overlayRoot');
    this.root.addChild(this.worldRoot._pixi, this.fxRoot, this.uiRoot._pixi, this.overlayRoot._pixi);
  }

  /**
   * Put a screen filter on the world (the composite of the effects), or take it off (null). The filter covers the whole picture, not just the
   * area its children fill: the vignette and the dim reach the corners, and the area is the same every frame so the render texture is too.
   */
  setWorldFilter(filter: Filter | null): void {
    const node = this.worldRoot._pixi;
    node.filters = filter ? [filter] : null;
    if (filter) node.filterArea = new Rectangle(0, 0, W, H);
    else delete node.filterArea;
  }

  /**
   * Parent the scenes' containers under the roots, bottom scene first. Call it when the stack or
   * the visibility flags change (not every frame).
   */
  layout(slots: readonly ScreenSlot[]): void {
    this.worldRoot.removeAll();
    this.uiRoot.removeAll();
    for (const s of slots) {
      if (!s.visible) continue;
      // Everything above the base goes under uiRoot, so the screen filters never touch it.
      (s.base ? this.worldRoot : this.uiRoot).add(s.world);
      this.uiRoot.add(s.ui);
    }
  }

  /** Draw the whole picture into the back buffer. */
  drawInto(backBuffer: BackBuffer): void {
    backBuffer.render(this.root);
  }
}
