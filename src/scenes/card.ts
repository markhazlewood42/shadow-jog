/** Centered info card (tutorial hints, notices). Confirm to dismiss. Native sje scene (M8b). */
import { sfx } from '../audio/sfx';
import { autoClose } from '../game/debug';
import { Cursor, NineSlice, TextObject, UI, wrap } from '../sje';
import { H, W } from '../sje/core/size';
import { UiScene } from './uiscene';

export class CardScene extends UiScene<void> {
  private readonly lines: number;
  // The window's resting place and size (the old render worked them out each frame; they never change).
  private readonly w: number;
  private readonly h: number;
  private readonly x: number;
  private readonly y: number;
  private win!: NineSlice;
  private body!: TextObject;
  private more!: Cursor;

  constructor(private title: string, private bodyText: string, private accent: string = UI.amber) {
    super();
    this.opaque = false;
    const w = 320;
    this.w = w;
    this.lines = wrap(bodyText, 300).length;
    this.h = 34 + this.lines * 11;
    this.x = (W - this.w) / 2;
    this.y = (H - this.h) / 2 - 10;
  }

  override create(): void {
    sfx('alert');
    const ui = this.sys.ui;
    // A light shade over whatever is behind the card (the old fillRect of rgba(7,6,13,0.5)).
    this.dim(0.5);
    // The window starts 8 px low and slides up into place over the first 8 ticks.
    this.win = new NineSlice(this, this.x, Math.round(this.y + 8), this.w, this.h, { title: this.title, accent: this.accent });
    ui.add(this.win);
    // The text and the "more" arrow wait until the window has landed.
    this.body = new TextObject(this, this.x + 10, this.y + 12, this.bodyText, { wrapWidth: 300, lineHeight: 11 }).setVisible(false);
    ui.add(this.body);
    this.more = new Cursor(this, this.x + this.w - 14, this.y + this.h - 13, 'more', this.accent).setVisible(false);
    ui.add(this.more);
  }

  protected tick(): void {
    if (autoClose(this.t, 100)) {
      this.close();
      return;
    }
    const keys = this.input.actions;
    if (this.t > 12 && (keys.justPressed('confirm') || keys.justPressed('cancel'))) {
      sfx('confirm');
      this.close();
      return;
    }
    const k = Math.min(1, this.t / 8);
    this.win.setPosition(this.x, Math.round(this.y + (1 - k) * 8));
    this.body.setVisible(k >= 1);
    if (k >= 1) this.more.setFrame(this.t);
    else this.more.setVisible(false);
  }
}
