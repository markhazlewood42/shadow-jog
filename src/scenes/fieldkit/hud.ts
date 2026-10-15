/**
 * The field's two windows as kit parts (M8c group G; docs/engine/m8-brief.md, "Mark decided on 2026-10-15: port those windows in M8c").
 *
 * The field had two screen-space overlays that it painted with canvas calls into its picture every frame: the OBJECTIVE box (the current goal, in the top-left corner)
 * and the AREA BANNER (the map's name, fading in and out over the top of the screen). Their text is `TextObject` lines in the scene's ui layer now. The world, the actors,
 * the emotes, the cue, the curtains, the weather, the banner's scrim (a dark band with a growing rule, `FieldScene.renderBanner`) and the objective's plate and stripe
 * (`paintPlate`) stay canvas pictures. The scrim and the plate stay in the screen layer on purpose: they are semi-clear, and the pictures of the default path and of the field
 * parity pin their pixels (1/255 and 2/255). A separate GPU blend of a semi-clear picture moved the scrim to 3/255 and the plate to 2/255 (12 px), so each one is painted on
 * the canvas with the old calls.
 *
 * Like the old code, `sync` runs once for each drawn frame (the `prerender` handler of the scene), because the objective's flash counts drawn frames. A box is built
 * again only when what it shows changes: the objective when its text or its flash changes, the banner when its text changes. The fade of both is an alpha, never a build.
 */
import type { Ctx } from '../../engine/canvas';
import { Container, measure, TextObject, UI, wrap } from '../../sje';
import { W } from '../../sje/core/size';
import { FIELD_OBJ_W } from '../../ui/layout';
import type { FieldScene } from '../field';
import { applyOps, type Op } from '../uiops';
import { ViewBuilder } from '../uiview';

/** The banner's top: the scrim starts 18 px down. */
const BANNER_Y = 18;

export class FieldHud {
  private objectiveBox!: Container;
  private objectiveKey = '';
  private bannerBox!: Container;
  private bannerKey = '';
  // The objective's own state (it was fields of the scene): what it shows, wrapped, and the frames of its flash.
  private objText = '';
  private objLines: string[] = [];
  private objW = 0;
  private objFlash = 0;
  /** What `paintPlate` paints this frame (null: the objective is hidden). The text of the box is the kit part; the plate under it is canvas art. */
  private plate: { w: number; h: number; flash: boolean; alpha: number } | null = null;

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

  /** True when `syncEarly` already ran in this drawn frame. */
  private early = false;

  /** The stage below the field paints the plate before the field's own `prerender`: sync first, so the plate is not a frame late. */
  syncEarly(): void {
    this.sync();
    this.early = true;
  }

  /** The scene's `prerender` sync: skipped when `syncEarly` ran this frame (the objective's flash counts drawn frames, so a second sync would count it twice). */
  syncFrame(): void {
    if (this.early) this.early = false;
    else this.sync();
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
      this.plate = null;
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
    const alpha = s.leader.moving ? 0.55 : 0.9;
    this.plate = { w: this.objW, h, flash, alpha };
    const color = flash ? '#ffe7a0' : '#d8d6ec';
    const ops: Op[] = [
      ...this.objLines.map((line, i): Op => ({ k: 'text', x: 9, y: 6 + i * 10, s: (i === 0 ? '{y}▶{/} ' : '   ') + line, style: { color, shadow: false } })),
    ];
    // The box is built again when its text changes; a flash toggle only recolors the lines in place.
    const key = JSON.stringify(ops.map((o) => (o.k === 'text' ? { ...o, style: { shadow: false } } : o)));
    if (key !== this.objectiveKey) {
      this.objectiveKey = key;
      this.objectiveBox.removeAll(true);
      applyOps(s, this.objectiveBox, ops);
    } else for (const c of this.objectiveBox.list) if (c instanceof TextObject) c.setStyle({ color });
    this.objectiveBox.setAlpha(alpha);
  }

  /**
   * The objective's plate and amber stripe, painted on the screen canvas with the calls of the old code (the text is the box above). Returns false when the objective is
   * hidden. A battle's intro snapshot skips it (the text is not in that snapshot either), so the snapshot never shows a plate with no text on it.
   */
  paintPlate(ctx: Ctx): boolean {
    const p = this.plate;
    if (!p) return false;
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = 'rgba(10,9,19,0.78)';
    ctx.fillRect(4, 4, p.w, p.h);
    ctx.fillStyle = p.flash ? '#ffcc3d' : '#6a5a2a';
    ctx.fillRect(4, 4, 2, p.h);
    ctx.globalAlpha = 1;
    return true;
  }

  /** The area banner's name and sub line, fading in over 20 ticks and out over the last 30 of 200 (the scrim and the rule under them are painted by the scene). */
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
    const key = JSON.stringify([b.text, b.sub]);
    if (key !== this.bannerKey) {
      this.bannerKey = key;
      this.bannerBox.removeAll(true);
      const v = new ViewBuilder(s, this.bannerBox);
      v.text(W / 2, BANNER_Y + 3, b.text, { align: 'center', color: '#ffffff' });
      if (b.sub) v.text(W / 2, BANNER_Y + 16, b.sub, { align: 'center', color: UI.dim });
    }
    this.bannerBox.setAlpha(a);
  }
}
