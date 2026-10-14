/**
 * Cursor: the animated marker beside a menu row (UI kit, M8a). The old `drawCursor` and `drawMore` of `src/ui/draw.ts`, as one display object.
 *
 *  - kind `chevron`: a neon right-pointing arrow that nudges sideways on a sine (the selection cursor).
 *  - kind `more`: a down arrow that blinks (the "more text" mark of a dialog box and a card).
 *
 * x,y is the HOME place (where `drawCursor` was given x,y). `setFrame(frame)` moves it by the nudge or switches the blink; the scene gives its own
 * frame counter, as it gave one to `drawCursor`. `cursorNudge` and `moreVisible` are the plain rules, for a test.
 */
import type { DisplayHost } from '../display/gameobject';
import { type CursorParams, UI, UI_DEFAULTS } from './params';
import { TextObject } from './textobject';

export type CursorKind = 'chevron' | 'more';

/** How many pixels the chevron is nudged to the right at this frame (the old `drawCursor`). */
export function cursorNudge(frame: number, p: CursorParams = UI_DEFAULTS.cursor): number {
  return Math.round(Math.sin(frame * p.rate) * p.nudge);
}

/** Is the "more" arrow lit at this frame (the old `drawMore`)? */
export function moreVisible(frame: number, p: CursorParams = UI_DEFAULTS.cursor): boolean {
  return Math.floor(frame / p.blinkFrames) % 2 === 0;
}

export class Cursor extends TextObject {
  private readonly kind: CursorKind;
  private readonly params: CursorParams;
  private homeX: number;
  private homeY: number;
  private frameNow = 0;

  constructor(scene: DisplayHost, x: number, y: number, kind: CursorKind = 'chevron', color: string = UI.cyan, params: Partial<CursorParams> = {}) {
    super(scene, x, y, kind === 'chevron' ? '▶' : '▼', { color });
    this.kind = kind;
    this.params = { ...UI_DEFAULTS.cursor, ...params };
    this.homeX = x;
    this.homeY = y;
    this.name = kind === 'chevron' ? 'cursor' : 'more';
    this.setFrame(0);
  }

  /** Move the home place (the nudge is added to it). */
  setHome(x: number, y: number): this {
    this.homeX = x;
    this.homeY = y;
    this.setPosition(x + (this.kind === 'chevron' ? cursorNudge(this.frameNow, this.params) : 0), y);
    return this;
  }

  /** Show the cursor at this frame of the scene's own counter. */
  setFrame(frame: number): this {
    this.frameNow = frame;
    if (this.kind === 'chevron') this.setPosition(this.homeX + cursorNudge(frame, this.params), this.homeY);
    else this.setVisible(moreVisible(frame, this.params));
    return this;
  }
}
