/**
 * The field's two windows as kit parts (M8c group G; docs/engine/m8-brief.md, "Mark decided on 2026-10-15: port those windows in M8c").
 *
 * The field had two screen-space overlays that it painted with canvas calls into its picture every frame: the OBJECTIVE box (the current goal, in the top-left corner)
 * and the AREA BANNER (the map's name, fading in and out over the top of the screen). Both are display objects in the scene's ui layer now: `TextObject` lines and
 * one-color pictures for their plates. The world, the actors, the emotes, the cue, the curtains and the weather stay canvas pictures (they are art in the world).
 *
 * Like the old code, `sync` runs once for each drawn frame (the `prerender` handler of the scene), because the objective's flash counts drawn frames. A box is built
 * again only when what it shows changes: the objective when its text or its flash changes, the banner when its text changes. The banner's rule that grows and the
 * fade of both are a scale, a position and an alpha, never a build.
 */
import { type CanvasImage, Container, measure, UI, wrap } from '../../sje';
import { W } from '../../sje/core/size';
import { bandGradient } from '../../ui/draw';
import { FIELD_OBJ_W } from '../../ui/layout';
import type { FieldScene } from '../field';
import { applyOps, type Op } from '../uiops';
import { ViewBuilder } from '../uiview';

/** The banner's band: 26 px tall, 40 px wider than its text, 18 px from the top. */
const BANNER_Y = 18, BANNER_H = 26;

export class FieldHud {
  private objectiveBox!: Container;
  private objectiveKey = '';
  private bannerBox!: Container;
  private bannerKey = '';
  private rule: CanvasImage | null = null;
  // The objective's own state (it was fields of the scene): what it shows, wrapped, and the frames of its flash.
  private objText = '';
  private objLines: string[] = [];
  private objW = 0;
  private objFlash = 0;

  constructor(private readonly s: FieldScene) {}

  /** Make the two layers. Call it from the scene's `create` (a display object needs the running scene). */
  create(): void {
    const ui = this.s.sys.ui;
    this.objectiveBox = new Container(this.s, 0, 0, 'field-objective');
    this.bannerBox = new Container(this.s, 0, 0, 'field-banner');
    ui.add([this.bannerBox, this.objectiveBox]);
  }

  /** Bring both up to date with the scene: once for each drawn frame. */
  sync(): void {
    this.syncBanner();
    this.syncObjective();
  }

  /**
   * The current objective, always on screen in the top-left corner (dimmer while walking, hidden during cutscenes and dialogue); it flashes amber for a moment when it
   * changes. While it is hidden nothing about it moves on (the flash holds), as it was.
   */
  private syncObjective(): void {
    const s = this.s;
    const text = s.objective;
    if (!text || s.busy || s.def.kind === 'interior') {
      this.objectiveBox.setVisible(false);
      return;
    }
    this.objectiveBox.setVisible(true);
    if (text !== this.objText) {
      this.objFlash = this.objText ? 150 : 0;
      this.objText = text;
      this.objLines = wrap(text, FIELD_OBJ_W);
      this.objW = Math.max(...this.objLines.map(measure)) + 16;
    }
    if (this.objFlash > 0) this.objFlash--;
    const flash = this.objFlash > 0 && Math.floor(this.objFlash / 10) % 2 === 0;
    const h = 4 + this.objLines.length * 10;
    const ops: Op[] = [
      { k: 'rect', x: 4, y: 4, w: this.objW, h, color: 'rgba(10,9,19,0.78)' },
      { k: 'rect', x: 4, y: 4, w: 2, h, color: flash ? '#ffcc3d' : '#6a5a2a' },
      ...this.objLines.map((line, i): Op => ({ k: 'text', x: 9, y: 6 + i * 10, s: (i === 0 ? '{y}▶{/} ' : '   ') + line, style: { color: flash ? '#ffe7a0' : '#d8d6ec', shadow: false } })),
    ];
    const key = JSON.stringify(ops);
    if (key !== this.objectiveKey) {
      this.objectiveKey = key;
      this.objectiveBox.removeAll(true);
      applyOps(s, this.objectiveBox, ops);
    }
    this.objectiveBox.setAlpha(s.leader.moving ? 0.55 : 0.9);
  }

  /** The area banner: a dark band with the map's name over a pink rule that grows from the middle, fading in over 20 ticks and out over the last 30 of 200. */
  private syncBanner(): void {
    const s = this.s;
    const b = s.bannerNow;
    const t = b?.t ?? 0;
    const a = t < 20 ? t / 20 : t > 170 ? Math.max(0, (200 - t) / 30) : 1;
    if (!b || a <= 0) {
      this.bannerBox.setVisible(false);
      return;
    }
    this.bannerBox.setVisible(true);
    const w = measure(b.text) + 40;
    const x = Math.round((W - w) / 2);
    const key = JSON.stringify([b.text, b.sub]);
    if (key !== this.bannerKey) {
      this.bannerKey = key;
      this.bannerBox.removeAll(true);
      const v = new ViewBuilder(s, this.bannerBox);
      v.pic(x, BANNER_Y, w, BANNER_H, (c) => {
        c.fillStyle = bandGradient(c, 0, w, 0.2, 0.85);
        c.fillRect(0, 0, w, BANNER_H);
      });
      // The rule is one pink pixel, stretched to its width each tick.
      this.rule = v.pic(0, BANNER_Y + 13, 1, 1, (c) => {
        c.fillStyle = UI.pink;
        c.fillRect(0, 0, 1, 1);
      });
      v.text(W / 2, BANNER_Y + 3, b.text, { align: 'center', color: '#ffffff' });
      if (b.sub) v.text(W / 2, BANNER_Y + 16, b.sub, { align: 'center', color: UI.dim });
    }
    const lw = Math.min(w - 40, Math.round((t / 30) * (w - 40)));
    const rule = this.rule;
    if (rule) {
      rule.setVisible(lw > 0);
      rule.setScale(Math.max(1, lw), 1);
      rule.setPosition(Math.round(W / 2 - lw / 2), BANNER_Y + 13);
    }
    this.bannerBox.setAlpha(a);
  }
}
