/**
 * Jack style C, the SCANLINE COLLAPSE (decision D5, option C): the CRT power-off. DEV builds only until Mark picks a style (`jack.ts` loads this file behind
 * `import.meta.env.DEV`).
 *
 * Two void bars close from the top and the bottom until only a thin slit of the picture is left, and a bright line runs along it. In the hold the line pulses. In the swap the
 * bars are shut (a solid cover). In the `in` phase the bars open from the middle and the line fades, so the 3D horizon opens out of the line. No shader: rectangles and the
 * effects system's flare (full only). At `lite` and `none` it is the same without the glow, so this is the style that degrades least.
 */
import type { Container, Game } from '../sje';
import { Graphics, H, W } from '../sje';
import type { JackStyleDriver } from './jack';
import { type CoverFrame, type JackLevel, type Phase, type TransitionParams, VOID } from './transition';

const LINE = 0xe8fbff;

export class CollapseDriver implements JackStyleDriver {
  private top: Graphics | null = null;
  private bottom: Graphics | null = null;
  private line: Graphics | null = null;
  private lastAmount = -1;

  constructor(
    private readonly game: Game,
    private readonly params: TransitionParams,
  ) {}

  setup(root: Container): void {
    // At `none` the plain veil of `jack.ts` fades; the bars are for the other two levels.
    if (this.game.fx.level === 'none') return;
    this.top = new Graphics(this.game).setDepth(1).setVisible(false);
    this.bottom = new Graphics(this.game).setDepth(1).setVisible(false);
    this.line = new Graphics(this.game).setDepth(2).setVisible(false);
    root.add([this.top, this.bottom, this.line]);
  }

  enter(phase: Phase, level: JackLevel): void {
    // The glow of the line: the bloom flares when the line first shows, and again when it opens (full only; lite and none have no glow).
    if (level === 'full' && (phase === 'hold' || phase === 'in')) this.game.fx.flare(phase === 'hold' ? 0.5 : 0.4);
  }

  paint(frame: CoverFrame, phase: Phase, _t: number, level: JackLevel): void {
    const { top, bottom, line } = this;
    if (!top || !bottom || !line || level === 'none') return;
    const show = phase === 'out' || phase === 'hold' || phase === 'in';
    top.setVisible(show);
    bottom.setVisible(show);
    line.setVisible(show && frame.line > 0);
    if (!show) return;
    const L = this.params.lineHeight;
    const bar = Math.round((frame.amount * (H - L)) / 2);
    if (bar !== this.lastAmount) {
      this.lastAmount = bar;
      top.clear().fillStyle(VOID, 1).fillRect(0, 0, W, bar);
      bottom.clear().fillStyle(VOID, 1).fillRect(0, H - bar, W, bar);
    }
    // The line sits in the slit; its width grows with the pulse, so it is never the same two frames in a row.
    const w = Math.round(W * (0.55 + 0.45 * frame.line));
    line.clear().fillStyle(LINE, Math.min(1, frame.line)).fillRect(Math.round((W - w) / 2), Math.round((H - L) / 2), w, L);
  }

  dispose(_level: JackLevel): void {
    this.top?.destroy();
    this.bottom?.destroy();
    this.line?.destroy();
    this.top = null;
    this.bottom = null;
    this.line = null;
  }
}
