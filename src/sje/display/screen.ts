/**
 * Screen: the Pixi root of the whole picture, with its three shared roots
 * (docs/engine/scene-graph.md section 6, frame-and-rendering.md 6.2).
 *
 *   screen
 *    |- worldRoot    the `world` of the opaque base scene. Screen filters run here (M2).
 *    |- uiRoot       the `ui` of the base scene, then the `world` and `ui` of every scene above it.
 *    |                No screen filters, no shake.
 *    `- overlayRoot  game fade, game flash, notices. Nothing else.
 *
 * "Screen" means this Pixi root. The word "stage" always means the battle stage.
 *
 * Each scene owns two containers (`world` and `ui`). This class parents them under the shared
 * roots in stack order whenever the stack changes (`layout`), so the roots only hold what is drawn.
 */
import { Container as PixiContainer } from 'pixi.js';
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
  private readonly root = new PixiContainer({ label: 'screen' });

  constructor(host: DisplayHost) {
    this.worldRoot = new Container(host, 0, 0, 'worldRoot');
    this.uiRoot = new Container(host, 0, 0, 'uiRoot');
    this.overlayRoot = new Container(host, 0, 0, 'overlayRoot');
    for (const r of [this.worldRoot, this.uiRoot, this.overlayRoot]) this.root.addChild(r._pixi);
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
