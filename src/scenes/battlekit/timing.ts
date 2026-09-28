/**
 * Timed presses: a ring closes on the target as a blow comes in. Press confirm as it closes to
 * strike harder (your hit) or brace (a hit on you). The engine applies the grade (engine.ts
 * STRIKE_MULT / BRACE_MULT); this is the window, its judgement and its picture.
 *
 * The window runs in real frames, not battle-speed frames: the beat you learn is the beat you get.
 */
import type { Timing, TimingPrompt } from '../../battle/engine';
import type { Ctx } from '../../engine/canvas';

/** Frames from the ring opening to the hit landing (at least; a slow windup runs longer). */
export const RING_LEAD = 24;
/** A press this close to the hit (either side) is perfect. */
export const PERFECT_WINDOW = 3;
/** Good: up to this early, or this late. Earlier than that is a whiff; later, the moment's gone. */
export const GOOD_EARLY = 9;
export const GOOD_LATE = 5;

export type TimingMode = 'on' | 'assist' | 'off';

/** How a press at `dt` frames from the hit (negative = early) grades. */
export function judge(dt: number): Timing | 'early' | 'late' {
  if (Math.abs(dt) <= PERFECT_WINDOW) return 'perfect';
  if (dt >= -GOOD_EARLY && dt <= GOOD_LATE) return 'good';
  return dt < 0 ? 'early' : 'late';
}

export class TimingWindow {
  /** The prompt this action offers (null: none, or timed presses are off). */
  prompt: TimingPrompt | null = null;
  /** Frame the ring opened and the frame the hit lands (-1 until the playback opens it). */
  openAt = -1;
  impactAt = -1;
  /** The judged press, once there is one (a whiff locks the window: no mashing). */
  result: Timing | 'early' | 'late' | null = null;
  /** Frame of the press, for the pop. */
  pressedAt = -1;

  arm(p: TimingPrompt | null): void {
    this.prompt = p;
    this.openAt = this.impactAt = this.pressedAt = -1;
    this.result = null;
    this.done = false;
  }

  get armed(): boolean {
    return !!this.prompt;
  }

  /** Playback: the ring starts closing now and meets the target `lead` frames from now. */
  open(now: number, lead: number): void {
    if (!this.prompt) return;
    this.openAt = now;
    this.impactAt = now + lead;
  }

  get isOpen(): boolean {
    return this.openAt >= 0;
  }

  /** A press at frame `now`. Returns the judgement, or null if there's nothing to press for. */
  press(now: number): Timing | 'early' | 'late' | null {
    if (!this.isOpen || this.result || this.done) return null;
    this.result = judge(now - this.impactAt);
    this.pressedAt = now;
    return this.result;
  }

  /** Frames still worth waiting after the hit for a late press (0 once judged). */
  lateLeft(now: number): number {
    if (!this.isOpen || this.result) return 0;
    return Math.max(0, this.impactAt + GOOD_LATE - now);
  }

  /** The grade the engine gets. Anything but a timely press counts for nothing. */
  grade(): Timing {
    return this.result === 'perfect' || this.result === 'good' ? this.result : 'none';
  }

  /** No more presses (the action is resolving); a press already made still shows its pop. */
  disarm(): void {
    this.done = true;
  }
  done = false;
}

/** Ring colours: gold for your strike, cyan for a brace. */
export const RING_COLOR = { strike: '#ffe07a', brace: '#6ff3ff' } as const;

/** A 1px pixel circle (midpoint), crisp at the battle's pixel scale. */
function circle(g: Ctx, cx: number, cy: number, r: number): void {
  let x = Math.round(r), y = 0, err = 1 - x;
  while (x >= y) {
    g.fillRect(cx + x, cy + y, 1, 1);
    g.fillRect(cx + y, cy + x, 1, 1);
    g.fillRect(cx - y, cy + x, 1, 1);
    g.fillRect(cx - x, cy + y, 1, 1);
    g.fillRect(cx - x, cy - y, 1, 1);
    g.fillRect(cx - y, cy - x, 1, 1);
    g.fillRect(cx + y, cy - x, 1, 1);
    g.fillRect(cx + x, cy - y, 1, 1);
    y++;
    if (err < 0) err += 2 * y + 1;
    else {
      x--;
      err += 2 * (y - x) + 1;
    }
  }
}

/** A ring with a dark edge outside it, so it reads over any sprite or backdrop. */
function ring(g: Ctx, cx: number, cy: number, r: number, color: string): void {
  g.fillStyle = '#07060d';
  circle(g, cx, cy, r + 1);
  g.fillStyle = color;
  circle(g, cx, cy, r);
}

/**
 * The closing ring around one target, in battle-world pixels: an outer ring shrinking onto a fixed
 * inner mark, which lights up while a press would be perfect.
 */
export function drawRing(g: Ctx, x: number, y: number, now: number, win: TimingWindow): void {
  const p = win.prompt;
  if (!p || !win.isOpen) return;
  const cx = Math.round(x), cy = Math.round(y);
  const color = RING_COLOR[p.kind];
  const lead = win.impactAt - win.openAt;
  const k = Math.max(0, Math.min(1, (win.impactAt - now) / Math.max(1, lead)));
  const onBeat = Math.abs(now - win.impactAt) <= PERFECT_WINDOW;
  if (win.result) {
    // The press: the ring snaps to the mark and pops outward.
    const t = now - win.pressedAt;
    if (t > 12) return;
    const good = win.result === 'perfect' || win.result === 'good';
    g.globalAlpha = 1 - t / 12;
    ring(g, cx, cy, 7 + Math.round(t * (good ? 1.5 : 0.5)), good ? (win.result === 'perfect' ? '#ffffff' : color) : '#8b8fa8');
    g.globalAlpha = 1;
    return;
  }
  if (win.done || now > win.impactAt + GOOD_LATE) return;
  // The mark: where the ring has to be. White while a press would be perfect.
  g.globalAlpha = onBeat ? 1 : 0.6;
  ring(g, cx, cy, 7, onBeat ? '#ffffff' : color);
  // The closing ring.
  g.globalAlpha = 0.4 + 0.6 * (1 - k);
  ring(g, cx, cy, 7 + Math.round(20 * k), color);
  g.globalAlpha = 1;
}

/** What the player reads when a press lands. */
export function timingWord(kind: TimingPrompt['kind'], r: Timing | 'early' | 'late'): { text: string; color: string } {
  if (r === 'early') return { text: 'EARLY', color: '#8b8fa8' };
  if (r === 'late') return { text: 'LATE', color: '#8b8fa8' };
  if (kind === 'strike') return r === 'perfect' ? { text: 'PERFECT!', color: '#ffe07a' } : { text: 'GOOD', color: '#ffe07a' };
  return r === 'perfect' ? { text: 'BLOCKED!', color: '#6ff3ff' } : { text: 'BRACED', color: '#6ff3ff' };
}
