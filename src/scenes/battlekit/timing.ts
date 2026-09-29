/**
 * Timed presses: a ring closes on the target as a blow comes in. Press confirm as it closes to
 * strike harder (your hit) or brace (a hit on you). The engine applies the grade (engine.ts
 * STRIKE_MULT / BRACE_MULT); this is the window, its judgement and its picture.
 *
 * The window runs in real frames, not battle-speed frames: the beat you learn is the beat you get.
 */
import type { Timing, TimingProfile, TimingPrompt } from '../../battle/engine';
import type { Ctx } from '../../engine/canvas';

/**
 * Each profile's beat: how long the ring takes to close (at least; a slow windup runs longer),
 * how close to the hit a press is perfect, and how early or late it's still good. Quick moves
 * are a snap, heavy ones a wind-up you can read.
 */
export const WINDOWS: Record<TimingProfile, { lead: number; perfect: number; early: number; late: number; radius: number }> = {
  // Slowed after Mark's first playthrough (2026-09-29: "a bit too fast, both attacks and
  // blocks"): the ring takes about 40% longer to close and each window is a little wider.
  quick: { lead: 26, perfect: 3, early: 8, late: 4, radius: 18 },
  normal: { lead: 34, perfect: 4, early: 11, late: 6, radius: 22 },
  heavy: { lead: 44, perfect: 6, early: 15, late: 9, radius: 28 },
};
/** The normal beat (the minimum lead playback allows). */
export const RING_LEAD = WINDOWS.normal.lead;

export type TimingMode = 'on' | 'assist' | 'off';

/** How a press at `dt` frames from the hit (negative = early) grades, for a move's profile. */
export function judge(dt: number, profile: TimingProfile = 'normal'): Timing | 'early' | 'late' {
  const w = WINDOWS[profile];
  if (Math.abs(dt) <= w.perfect) return 'perfect';
  if (dt >= -w.early && dt <= w.late) return 'good';
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
    this.result = judge(now - this.impactAt, this.prompt?.profile);
    this.pressedAt = now;
    return this.result;
  }

  /** Frames still worth waiting after the hit for a late press (0 once judged). */
  lateLeft(now: number): number {
    if (!this.isOpen || this.result) return 0;
    return Math.max(0, this.impactAt + WINDOWS[this.prompt?.profile ?? 'normal'].late - now);
  }

  /** The grade the engine gets: a timely press, a press off the beat (a whiff), or no press. */
  grade(): Timing {
    if (this.result === 'perfect' || this.result === 'good') return this.result;
    return this.result ? 'whiff' : 'none';
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
  const w = WINDOWS[p.profile];
  const onBeat = Math.abs(now - win.impactAt) <= w.perfect;
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
  if (win.done || now > win.impactAt + w.late) return;
  // The mark: where the ring has to be. White while a press would be perfect.
  g.globalAlpha = onBeat ? 1 : 0.6;
  ring(g, cx, cy, 7, onBeat ? '#ffffff' : color);
  // The closing ring.
  g.globalAlpha = 0.4 + 0.6 * (1 - k);
  ring(g, cx, cy, 7 + Math.round(w.radius * k), color);
  g.globalAlpha = 1;
}

/** What the player reads when a press lands. */
export function timingWord(kind: TimingPrompt['kind'], r: Timing | 'early' | 'late'): { text: string; color: string } {
  // A press off the beat costs something, and reads like it.
  if (r === 'early' || r === 'late' || r === 'whiff' || r === 'none') return { text: r === 'late' ? 'LATE' : 'EARLY', color: '#c85a64' };
  if (kind === 'strike') return r === 'perfect' ? { text: 'PERFECT!', color: '#ffe07a' } : { text: 'GOOD', color: '#ffe07a' };
  return r === 'perfect' ? { text: 'BLOCKED!', color: '#6ff3ff' } : { text: 'BRACED', color: '#6ff3ff' };
}
