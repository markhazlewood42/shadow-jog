/**
 * The 2D HUD of the test hack: a few panels and lines of text in the game's own pixel font, drawn by
 * the engine's ordinary 2D objects in the scene's `ui` layer, OVER the 3D picture.
 *
 * This is the point of the shared-context design (decision E3): the 3D picture is just a texture to
 * Pixi, so ordinary 2D objects sit on top of it and stay exactly on the 480x270 pixel grid, however
 * much the 3D underneath blooms and moves. Every panel here is OPAQUE (flat colours), so a CPU
 * drawing of the same panel matches it pixel for pixel: the e2e spec checks that.
 *
 * Text is drawn into small canvases with the game's own font code (`src/engine/font.ts`) and shown
 * as images. A line is redrawn only when its text changes (the upload to the GPU costs a little).
 */
import { drawText, measure } from '../engine/font';
import { type AnyScene, type Container, type Graphics, type ImageObject, W } from '../sje';
import type { HackSim } from './sim/hacksim';

/** Colours (CSS strings for text, numbers for rectangles), from the game's palette. */
// A little brighter than the game's own dim text (#8b8fa8, 6.2:1 on the panel): the HUD text must reach 7:1.
const TEXT_DIM = '#b0b4cc';
const TEXT_BRIGHT = '#f4f1ff';
const CYAN = '#3fe0f0';
const PANEL = 0x0a0918;
const EDGE = 0x1f5cff;
const BAR_BACK = 0x1c1636;
/** The TRACE meter's fill: green while it is low, yellow, then pink near the limit. */
const BAR_LOW = 0x62e06a;
const BAR_MID = 0xffcc3d;
const BAR_HIGH = 0xff4fb0;

/** Layout in screen pixels. Every number the HUD draws at is here, so a change has one place. */
const STATS = { x: 6, y: 6, w: 124, h: 44 };
/** The TRACE meter: a dark track, and a fill of up to `w` pixels over it, inside the stats panel. */
const BAR = { x: 12, y: 38, w: 112, h: 5 };
/** The caption strip along the bottom: its 1 px top edge, its fill, and the caption text row. */
const STRIP = { edgeY: 253, y: 254, h: 16, textY: 257 };

/**
 * Where the fixed parts of the HUD are, so the e2e spec can draw the same parts with Canvas 2D and
 * compare (the "2D over 3D is exact" check). Screen pixels.
 */
export const HUD_FIXED = {
  /** The top right panel: a 1 px edge, a dark fill, and the text "NODE 07" inside it. */
  node: { x: W - 6 - 78, y: 6, w: 78, h: 18, text: 'NODE 07', textX: W - 6 - 78 + 6, textY: 11, textColor: CYAN },
  /** The bottom strip: a 1 px edge on top of a dark fill, with a centred caption. */
  caption: { edgeY: STRIP.edgeY, y: STRIP.y, h: STRIP.h, textY: STRIP.textY, textColor: TEXT_DIM },
  edge: EDGE,
  panel: PANEL,
};

/** The caption of a hack: its seed is part of it. */
export const captionFor = (seed: number): string => `TEST HACK   SEED ${seed}`;

/** One line of text that can change. */
class HudLine {
  private shown = '';
  private readonly ctx: CanvasRenderingContext2D;
  private readonly refresh: () => void;
  readonly image: ImageObject;

  constructor(
    scene: AnyScene,
    parent: Container,
    readonly key: string,
    x: number,
    y: number,
    width: number,
    private readonly color: string,
  ) {
    // 11 pixels tall: the font is 9 high and draws a 1 px shadow.
    const made = scene.textures.createCanvas(key, width + 2, 11);
    this.ctx = made.ctx;
    this.refresh = made.refresh;
    this.image = scene.add.image(x, y, key).setOrigin(0, 0).setDepth(5);
    parent.add(this.image);
  }

  set(text: string): void {
    if (text === this.shown) return;
    this.shown = text;
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    drawText(this.ctx, text, 0, 0, { color: this.color });
    this.refresh();
  }
}

/** The HUD, built into a scene's `ui` layer. `update` reads the simulation each frame. */
export class HackHud {
  private readonly lines: HudLine[] = [];
  private readonly keys: string[] = [];
  private readonly ice: HudLine;
  private readonly trace: HudLine;
  private readonly node: HudLine;
  private readonly caption: HudLine;
  private readonly bar: Graphics;
  private lastBar = -1;

  constructor(
    private readonly scene: AnyScene,
    private readonly sim: HackSim,
    title: string,
  ) {
    // A constructor that throws gives its caller nothing to destroy, so the textures made so far are freed here
    // (the display objects go with the scene).
    try {
      const ui = scene.add.layer({ ui: true });
      const g = scene.add.graphics().setDepth(1);
      ui.add(g);
      const panel = (x: number, y: number, w: number, h: number): void => {
        // A 1 px blue edge around an opaque dark panel: two rectangles, whole pixels, no blending.
        g.fillStyle(EDGE).fillRect(x, y, w, h);
        g.fillStyle(PANEL).fillRect(x + 1, y + 1, w - 2, h - 2);
      };
      // Top left: the ICE count and the TRACE meter.
      panel(STATS.x, STATS.y, STATS.w, STATS.h);
      // Top right: which node this is.
      panel(HUD_FIXED.node.x, HUD_FIXED.node.y, HUD_FIXED.node.w, HUD_FIXED.node.h);
      // Bottom: a thin caption strip across the whole width.
      g.fillStyle(EDGE).fillRect(0, STRIP.edgeY, W, 1);
      g.fillStyle(PANEL).fillRect(0, STRIP.y, W, STRIP.h);
      g.fillStyle(BAR_BACK).fillRect(BAR.x, BAR.y, BAR.w, BAR.h);
      this.bar = scene.add.graphics().setDepth(2);
      ui.add(this.bar);

      const make = (name: string, x: number, y: number, w: number, color: string): HudLine => {
        const key = `hud-${scene.key}-${name}`;
        this.keys.push(key);
        const line = new HudLine(scene, ui, key, x, y, w, color);
        this.lines.push(line);
        return line;
      };
      this.ice = make('ice', 12, 11, 110, CYAN);
      this.trace = make('trace', 12, 24, 110, TEXT_BRIGHT);
      this.node = make('node', HUD_FIXED.node.textX, HUD_FIXED.node.textY, 66, CYAN);
      this.caption = make('caption', 0, STRIP.textY, measure(title) + 2, TEXT_DIM);
      // Centre the caption: its width is known now.
      this.caption.image.setPosition(Math.floor((W - measure(title)) / 2), STRIP.textY);
      this.caption.set(title);
      this.node.set(HUD_FIXED.node.text);
      this.update();
    } catch (e) {
      this.destroy();
      throw e;
    }
  }

  /** Copy the simulation's numbers to the HUD. */
  update(): void {
    const s = this.sim;
    this.ice.set(`ICE  ${s.ice.length}`);
    const pct = s.tracePercent;
    this.trace.set(`TRACE  ${pct}%`);
    // The bar is redrawn only when its width changes.
    const w = Math.round((pct / 100) * BAR.w);
    if (w !== this.lastBar) {
      this.lastBar = w;
      this.bar.clear();
      if (w > 0) this.bar.fillStyle(pct < 50 ? BAR_LOW : pct < 80 ? BAR_MID : BAR_HIGH).fillRect(BAR.x, BAR.y, w, BAR.h);
    }
  }

  /** Free the HUD's textures. (The display objects are freed with the scene.) */
  destroy(): void {
    for (const key of this.keys) this.scene.textures.remove(key);
  }
}
