/**
 * The JACK transition: the styled jump between the 2D game and the 3D hack (M7; docs/engine/m7-brief.md decision D5, pass lines 19 to 24).
 * "Jack in" goes from the 2D picture to the 3D grid, "jack out" goes back. Both are the same animation, run the other way.
 *
 * This file is the PURE half: the time line, the numbers, and what the cover looks like at each tick as plain data. It imports nothing (no Three, no engine, no Pixi), so
 * the start path holds it and a unit test checks it in Node. `jack.ts` draws it.
 *
 * THE PHASES. A convention from film and games: a "wipe" hides a cut. The 3D scene cannot be on screen before it exists, so the cut happens under a solid cover.
 *   out   the 2D picture gives way to the cover (about 24 ticks). The door starts to load the 3D chunk at the first tick.
 *   hold  the chunk is still on its way. The cover stays at its hold look and MOVES (never a frozen frame). A wall-clock bound (`holdBoundMs`, 10 s) ends it.
 *   swap  the cover is solid. The 3D scene is started and draws its first frame here, under the cover (the first draw pays the shader compile). It lasts until the scene
 *         has drawn, and at least `swapMinTicks`.
 *   in    the cover leaves and the 3D grid shows (about 24 ticks).
 * Jack out is `out` (3D to cover), `swap` (the scene closes) and `in` (the 2D picture shows): no hold.
 *
 * THE LEVELS. The picture is the same animation at every effects level, with fewer ingredients: `full` uses the screen effects (glitch, color split, flare), `lite` only the
 * dim, a shake and the flash, and `none` a plain fade through the void color with no effects call at all (pass line 23).
 */

/** The void color: the 3D scene's background and fog (`PALETTE.void` in look.ts), so the cover and the grid melt into each other. */
export const VOID = 0x070a22;

export type JackStyle = 'glitch' | 'dissolve' | 'collapse';
export const JACK_STYLES: readonly JackStyle[] = ['glitch', 'dissolve', 'collapse'];
export type JackLevel = 'full' | 'lite' | 'none';
export const JACK_LEVELS: readonly JackLevel[] = ['full', 'lite', 'none'];
export type Phase = 'out' | 'hold' | 'swap' | 'in' | 'done';

/** A run of ticks of one phase in which the picture may be (nearly) one color, with the reason. `to: null` means to the end of the phase. */
export interface UniformRange {
  phase: 'out' | 'swap' | 'in';
  from: number;
  to: number | null;
  reason: string;
}

/** The transition's numbers. `src/data/hacks.json` holds the defaults (`transition`); a caller (the DEV `?jack=` route, a test) may override fields. */
export interface TransitionParams {
  /** Ticks of the `out` phase. */
  outTicks: number;
  /** Ticks of the `in` phase. */
  inTicks: number;
  /** The least ticks of the `swap` phase. It lasts until the 3D scene has drawn its first frame. */
  swapMinTicks: number;
  /** The most time the `hold` phase waits for the chunk, in wall-clock milliseconds. After it the hack is `unsupported / chunk-failed` and the story goes on. */
  holdBoundMs: number;
  /** Style glitch: how much of the picture the cover hides while it holds, 0 to 1. */
  holdCover: number;
  /** Style dissolve: the share of blocks that are gone while it holds, 0 to 1. */
  dissolveHold: number;
  /** Style dissolve: the block size in game pixels. */
  block: number;
  /** Style collapse: the height of the bright line in game pixels. */
  lineHeight: number;
  /** The hold cursor toggles every this many ticks (pass line 20: at least every 8). */
  cursorPeriod: number;
}

/** Where the picture may be one color (pass line 19), per style and level: the `uniform` block of `hacks.json`. Read by the checks and the tests, not by the shipped game. */
export type UniformData = Record<JackStyle, Record<JackLevel, UniformRange[]>>;

/** What the cover looks like at one tick. Plain numbers: `jack.ts` and the styles draw from it. */
export interface CoverFrame {
  /** Opacity of the plain cover, 0 (nothing) to 1 (solid). */
  cover: number;
  /** The cover's color: the void color, or white (the flash peak of the glitch style). */
  tint: 'void' | 'white';
  /** The style's own amount from 0 to 1: how torn (glitch), how many blocks are gone (dissolve), how far the bars have closed (collapse). */
  amount: number;
  /** Which noise pattern the dissolve shows. It changes in the hold, so the blocks flicker. */
  pattern: number;
  /** Collapse: how bright the line is, 0 to 1. */
  line: number;
  /** Draw the hold element: a blinking cursor, the "JACKING IN" line and a bar that runs along the bottom. */
  holdUi: boolean;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Ease in and out: slow start, slow end. */
const smooth = (u: number): number => u * u * (3 - 2 * u);

/**
 * What the cover looks like in this phase at tick `t` of it (`t` starts at 0). `from` is how covered the picture was when the `in` phase began (1 after a swap, less when
 * the hold ended in a failure and the 2D picture comes back from where it was).
 */
export function coverAt(style: JackStyle, level: JackLevel, phase: Phase, t: number, p: TransitionParams, from = 1): CoverFrame {
  const idle: CoverFrame = { cover: 0, tint: 'void', amount: 0, pattern: 0, line: 0, holdUi: false };
  if (phase === 'done') return idle;
  const outU = clamp01((t + 1) / p.outTicks);
  const inU = clamp01((t + 1) / p.inTicks);
  // The plain fade: the level `none`, for every style. It goes through the void color, with nothing else.
  if (level === 'none') {
    switch (phase) {
      case 'out':
        return { ...idle, cover: smooth(outU) };
      case 'hold':
        return { ...idle, cover: 1, holdUi: true };
      case 'swap':
        return { ...idle, cover: 1 };
      case 'in':
        return { ...idle, cover: from * (1 - smooth(inU)) };
    }
  }
  if (style === 'glitch') {
    const white = level === 'full' || level === 'lite' ? 'white' : 'void';
    switch (phase) {
      case 'out':
        return { ...idle, cover: p.holdCover * smooth(outU), amount: outU };
      case 'hold':
        return { ...idle, cover: p.holdCover, amount: 0.35, holdUi: true };
      case 'swap':
        return { ...idle, cover: 1, tint: white, amount: 1 };
      case 'in':
        return { ...idle, cover: from * (1 - inU), tint: white, amount: 1 - inU };
    }
  }
  // The dissolve and the collapse are DEV styles until Mark picks one (decision D5): a shipped build never asks for them, and drops their look.
  return import.meta.env.DEV ? coverAtOther(style, phase, t, p, from, idle) : idle;
}

/** The look of the styles that load in DEV builds only: the pixel dissolve and the scanline collapse. */
function coverAtOther(style: JackStyle, phase: Phase, t: number, p: TransitionParams, from: number, idle: CoverFrame): CoverFrame {
  const outU = clamp01((t + 1) / p.outTicks);
  const inU = clamp01((t + 1) / p.inTicks);
  switch (style) {
    case 'dissolve':
      switch (phase) {
        case 'out':
          return { ...idle, amount: p.dissolveHold * smooth(outU) };
        case 'hold':
          return { ...idle, amount: p.dissolveHold, pattern: Math.floor(t / 4), holdUi: true };
        case 'swap':
          return { ...idle, cover: 1, amount: 1 };
        case 'in':
          return { ...idle, amount: from * (1 - inU) };
      }
      break;
    case 'collapse':
      switch (phase) {
        case 'out':
          return { ...idle, amount: smooth(outU), line: outU * outU };
        case 'hold':
          // The line pulses: a slow beat between three quarters and full.
          return { ...idle, amount: 1, line: 0.75 + 0.25 * Math.sin(t * 0.45), holdUi: true };
        case 'swap':
          return { ...idle, cover: 1, amount: 1 };
        case 'in':
          return { ...idle, amount: from * (1 - smooth(inU)), line: from * (1 - inU) };
      }
      break;
  }
  return idle;
}

/**
 * How covered the picture is at the hold look, in the unit that `coverAt`'s `from` uses for this style and level: the cover (glitch, and every style at `none`) or the
 * amount (dissolve, collapse). The way back from a failed hold starts here.
 */
export function holdLook(style: JackStyle, level: JackLevel, p: TransitionParams): number {
  const f = coverAt(style, level, 'hold', 0, p);
  return style === 'glitch' || level === 'none' ? f.cover : f.amount;
}

/** What the time line is told each tick. */
export interface TimelineInput {
  /** The hold may end: the chunk arrived (or failed). */
  holdReleased: boolean;
  /** The hold took too long (the wall-clock bound): give up and go back. */
  holdTimedOut: boolean;
  /** The swap may end: the 3D scene has drawn its first frame (or ended). */
  swapDone: boolean;
  /** How covered the picture is at the hold look, in the unit of the style's `from` (the cover, or the amount): where the way back begins. */
  holdFrom: number;
}

/**
 * The phase machine. `step` moves it by one tick. Pure: the caller gives it the facts.
 * `skipHold` is for jack out (nothing to wait for). `abort` is the way back from a hold that failed: the hold leads straight to `in`, with no swap.
 */
export class Timeline {
  phase: Phase = 'out';
  /** Ticks spent in the phase so far (0 on the tick the phase begins). */
  t = 0;
  /** How covered the picture was when `in` began (`coverAt`'s `from`). */
  inFrom = 1;
  /** True when the run ended by going back to the picture it left (a timeout or a failed load). */
  aborted = false;
  /** Ticks since the run began, across phases (a test reads it). */
  total = 0;

  constructor(
    private readonly p: TransitionParams,
    private readonly opts: { skipHold?: boolean; startAt?: 'out' | 'swap' } = {},
  ) {
    if (opts.startAt === 'swap') this.phase = 'swap';
  }

  private go(phase: Phase): void {
    this.phase = phase;
    this.t = 0;
  }

  /** The cover to draw now (for the phase and tick the machine is in). */
  frame(style: JackStyle, level: JackLevel): CoverFrame {
    return coverAt(style, level, this.phase, this.t, this.p, this.inFrom);
  }

  /** Go back to the picture the run left: straight to `in`, from `from` (the hold look). Used when the swap cannot go on (the chunk did not load). */
  abort(from: number): void {
    this.aborted = true;
    this.inFrom = from;
    this.go('in');
  }

  /** One tick. Returns true when the machine just entered a new phase. */
  step(i: TimelineInput): boolean {
    this.total++;
    const before = this.phase;
    switch (this.phase) {
      case 'out':
        this.t++;
        if (this.t >= this.p.outTicks) this.go(this.opts.skipHold ? 'swap' : 'hold');
        break;
      case 'hold':
        if (i.holdTimedOut) {
          this.aborted = true;
          this.inFrom = i.holdFrom;
          this.go('in');
        } else if (i.holdReleased) this.go('swap');
        else this.t++;
        break;
      case 'swap':
        this.t++;
        if (i.swapDone && this.t >= this.p.swapMinTicks) this.go('in');
        break;
      case 'in':
        this.t++;
        if (this.t >= this.p.inTicks) this.go('done');
        break;
      case 'done':
        break;
    }
    return this.phase !== before;
  }
}

// ---- the declared uniform ranges (pass line 19) -----------------------------------------------------------------

/** A tick of `phase` is inside one of the ranges. `swapTicks` is how long the swap lasted. */
export function inRanges(ranges: readonly UniformRange[], phase: Phase, t: number): boolean {
  return ranges.some((r) => r.phase === phase && t >= r.from && (r.to === null || t <= r.to));
}

/**
 * The problems of a style's declared uniform ranges at one level, as sentences (empty = fine). The rules of pass line 19:
 *  - a range ends at the cover peak: an `out` range ends on the last tick of `out`, an `in` range begins on the first tick of `in`, and a `swap` range is the whole swap;
 *  - a range never reaches the reveal: an `in` range leaves the last `in` tick out, so the frame one tick after it ends shows the 3D grid;
 *  - the declared ticks (the shortest swap counted) are at most 40% of the transition;
 *  - every range has a reason;
 *  - the hold is never declared (pass line 20 judges it).
 */
export function checkUniformRanges(p: TransitionParams, ranges: readonly UniformRange[]): string[] {
  const out: string[] = [];
  let declared = 0;
  for (const r of ranges) {
    const where = `${r.phase} ${r.from}..${r.to ?? 'end'}`;
    if (!r.reason.trim()) out.push(`${where}: a declared range needs a reason`);
    if ((r.phase as string) === 'hold') out.push(`${where}: the hold is judged by its own rule, never declared`);
    if (r.phase === 'out') {
      if (r.to !== p.outTicks - 1) out.push(`${where}: an out range must end on the last out tick (${p.outTicks - 1}), the cover peak`);
      declared += p.outTicks - r.from;
    } else if (r.phase === 'in') {
      if (r.from !== 0) out.push(`${where}: an in range must begin on the first in tick (0), the cover peak`);
      if (r.to === null || r.to > p.inTicks - 2) out.push(`${where}: an in range must leave the last in tick (${p.inTicks - 1}) out: the frame after it shows the 3D grid`);
      else declared += r.to + 1;
    } else {
      if (r.from !== 0 || r.to !== null) out.push(`${where}: a swap range is the whole swap`);
      declared += p.swapMinTicks;
    }
  }
  const total = p.outTicks + p.inTicks + p.swapMinTicks;
  if (declared > 0.4 * total) out.push(`the declared ticks (${declared}) are over 40% of the transition (${total})`);
  return out;
}

// ---- the choice of style ------------------------------------------------------------------------------------------

/** The style that ships until Mark picks one (decision D5, option A: the datamosh tear). */
export const DEFAULT_STYLE: JackStyle = 'glitch';

/** `?jack=glitch|dissolve|collapse|cut` in a DEV build. `cut` is no transition (the Phase 0 behavior). Anything else is the default. */
export function styleFromQuery(value: string | null): JackStyle | 'cut' | null {
  if (value === 'cut') return 'cut';
  return JACK_STYLES.find((s) => s === value) ?? null;
}
