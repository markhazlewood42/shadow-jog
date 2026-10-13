/**
 * The jack transition's pure half (src/hack3d/transition.ts) and its data (the `transition` block of src/data/hacks.json): the phase machine, what the cover looks
 * like at each tick, the declared uniform ranges and the rules that judge them (M7 pass lines 19 to 23 of docs/engine/m7-brief.md). The drawing is `jack.ts`, and its pictures are
 * e2e/sje-hack.spec.ts. No browser here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkTransition, checkUniform, TRANSITION } from '../src/hack3d/data';
import {
  checkUniformRanges,
  coverAt,
  DEFAULT_STYLE,
  holdLook,
  inRanges,
  JACK_LEVELS,
  JACK_STYLES,
  type JackLevel,
  type JackStyle,
  styleFromQuery,
  Timeline,
  type TimelineInput,
  type TransitionParams,
  type UniformData,
  type UniformRange,
} from '../src/hack3d/transition';

const P: TransitionParams = TRANSITION;
const raw = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'src/data/hacks.json'), 'utf8')) as { transition: TransitionParams; uniform: UniformData };
const UNIFORM = raw.uniform;
const IDLE: TimelineInput = { holdReleased: false, holdTimedOut: false, swapDone: false, holdFrom: 0.5 };

/** Run a timeline, giving it facts by tick. Returns the (phase, t) of every tick, starting with the one before the first step. */
function run(tl: Timeline, facts: (tick: number, phase: string) => Partial<TimelineInput>, maxTicks = 400): string[] {
  const seen = [`${tl.phase}:${tl.t}`];
  for (let tick = 0; tick < maxTicks && tl.phase !== 'done'; tick++) {
    tl.step({ ...IDLE, ...facts(tick, tl.phase) });
    seen.push(`${tl.phase}:${tl.t}`);
  }
  return seen;
}

describe('the transition numbers (data)', () => {
  it('the defaults come from src/data/hacks.json and pin the brief: 24 ticks out and in, a 10 s hold bound (pass line 20)', () => {
    expect(TRANSITION).toEqual(raw.transition);
    expect(P.outTicks).toBe(24);
    expect(P.inTicks).toBe(24);
    expect(P.holdBoundMs).toBe(10_000);
    // The hold cursor toggles at least every 8 ticks (pass line 20).
    expect(P.cursorPeriod).toBeLessThanOrEqual(8);
  });

  it('checkTransition accepts the file and rejects each kind of mistake', () => {
    expect(checkTransition(raw.transition)).toEqual([]);
    expect(checkUniform(raw.uniform, raw.transition)).toEqual([]);
    const bad = (over: Record<string, unknown>) => checkTransition({ ...raw.transition, ...over });
    expect(bad({ outTicks: 0 })).not.toEqual([]);
    expect(bad({ holdCover: 2 })).not.toEqual([]);
    expect(bad({ holdBoundMs: Number.NaN })).not.toEqual([]);
    expect(bad({ extra: 1 })).not.toEqual([]);
    expect(checkUniform({}, raw.transition)).not.toEqual([]);
    expect(checkUniform(null, raw.transition)).not.toEqual([]);
    expect(checkTransition(null)).not.toEqual([]);
    // A range with no reason is named with where it is.
    const noReason = { ...UNIFORM, glitch: { ...UNIFORM.glitch, full: [{ phase: 'swap', from: 0, to: null, reason: '' }] } };
    expect(checkUniform(noReason, raw.transition).join(' ')).toMatch(/glitch\.full.*reason/);
  });
});

describe('Timeline: out, hold, swap, in', () => {
  it('with the chunk already there: out for outTicks, almost no hold, a swap of at least swapMinTicks, then in for inTicks', () => {
    const seen = run(new Timeline(P), () => ({ holdReleased: true, swapDone: true }));
    const phases = (name: string) => seen.filter((s) => s.startsWith(`${name}:`)).length;
    expect(phases('out')).toBe(P.outTicks); // out:0 .. out:23
    // The hold lasts one tick at the most (the tick that finds the chunk there), the swap its minimum, the in phase its ticks.
    expect(phases('hold')).toBeLessThanOrEqual(1);
    expect(phases('swap')).toBeGreaterThanOrEqual(P.swapMinTicks);
    expect(phases('in')).toBe(P.inTicks);
    expect(seen.at(-1)).toBe('done:0');
  });

  it('the hold waits for the chunk and keeps counting ticks (the cover moves while it waits)', () => {
    const seen = run(new Timeline(P), (tick) => ({ holdReleased: tick >= 200, swapDone: true }));
    const ts = seen.filter((s) => s.startsWith('hold:')).map((s) => Number(s.split(':')[1]));
    expect(ts.length).toBeGreaterThan(150);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(new Set(ts).size).toBe(ts.length);
  });

  it('the swap lasts until the 3D scene has drawn (swapDone), and never less than swapMinTicks', () => {
    const early = run(new Timeline(P), () => ({ holdReleased: true, swapDone: true }));
    const late = run(new Timeline(P), (tick, phase) => ({ holdReleased: true, swapDone: phase === 'swap' && tick > 60 }));
    expect(late.filter((s) => s.startsWith('swap:')).length).toBeGreaterThan(early.filter((s) => s.startsWith('swap:')).length);
    expect(early.filter((s) => s.startsWith('swap:')).length).toBeGreaterThanOrEqual(P.swapMinTicks);
    // The cover never reveals before the scene has drawn: while swapDone is false the phase stays `swap`.
    const stuck = new Timeline(P);
    for (let i = 0; i < 80; i++) stuck.step({ ...IDLE, holdReleased: true, swapDone: false });
    expect(stuck.phase).toBe('swap');
  });

  it('a hold that times out goes back to the picture: no swap, an aborted run, from the hold look', () => {
    const tl = new Timeline(P);
    const seen = run(tl, (tick) => ({ holdTimedOut: tick >= 40, holdFrom: 0.77 }));
    expect(seen.some((s) => s.startsWith('swap:'))).toBe(false);
    expect(tl.aborted).toBe(true);
    expect(tl.inFrom).toBe(0.77);
    expect(seen.filter((s) => s.startsWith('in:')).length).toBe(P.inTicks);
  });

  it('jack out has no hold: out, swap, in', () => {
    const seen = run(new Timeline(P, { skipHold: true }), () => ({ swapDone: true }));
    expect(seen.some((s) => s.startsWith('hold:'))).toBe(false);
    expect(seen.filter((s) => s.startsWith('out:')).length).toBe(P.outTicks);
    expect(seen.some((s) => s.startsWith('swap:'))).toBe(true);
  });

  it('abort(from) goes straight to in', () => {
    const tl = new Timeline(P);
    tl.abort(0.4);
    expect([tl.phase, tl.aborted, tl.inFrom]).toEqual(['in', true, 0.4]);
  });
});

describe('coverAt: what the cover looks like', () => {
  const frames = (style: JackStyle, level: JackLevel, phase: 'out' | 'in', n: number) => Array.from({ length: n }, (_, t) => coverAt(style, level, phase, t, P));

  for (const style of JACK_STYLES) {
    for (const level of JACK_LEVELS) {
      it(`${style} at ${level}: out never gives back, in never goes up, the swap is solid, the hold shows its element`, () => {
        // The measure that grows with the out phase: the plain cover, or the style's amount (the bars, the blocks, the tear).
        const measure = (f: ReturnType<typeof coverAt>) => (level === 'none' || style === 'glitch' ? f.cover : f.amount);
        const out = frames(style, level, 'out', P.outTicks).map(measure);
        expect(out).toEqual([...out].sort((a, b) => a - b));
        expect(out.at(-1)).toBeGreaterThan(out[0] ?? 0);
        const inn = frames(style, level, 'in', P.inTicks).map(measure);
        expect(inn).toEqual([...inn].sort((a, b) => b - a));
        // The last tick of `in` is clean: nothing of the cover is left, so the next frame (done) is the picture itself.
        const last = coverAt(style, level, 'in', P.inTicks - 1, P);
        expect(last.cover).toBe(0);
        expect(last.amount).toBe(0);
        // The swap is a solid cover (the plain veil is opaque), the hold draws its element, and no other phase does.
        expect(coverAt(style, level, 'swap', 0, P).cover).toBe(1);
        expect(coverAt(style, level, 'hold', 3, P).holdUi).toBe(true);
        for (const phase of ['out', 'swap', 'in'] as const) expect(coverAt(style, level, phase, 0, P).holdUi).toBe(false);
        expect(coverAt(style, level, 'done', 0, P)).toMatchObject({ cover: 0, amount: 0, line: 0, holdUi: false });
      });
    }
  }

  it('at none every style is the same plain fade through the void: a cover from 0 to 1 and no amount, line or pattern (pass line 23)', () => {
    for (const style of JACK_STYLES) {
      for (const phase of ['out', 'hold', 'swap', 'in'] as const) {
        for (const t of [0, 5, 23]) {
          const f = coverAt(style, 'none', phase, t, P);
          expect([f.amount, f.line, f.pattern, f.tint]).toEqual([0, 0, 0, 'void']);
        }
      }
    }
    expect(coverAt('glitch', 'none', 'hold', 0, P).cover).toBe(1);
  });

  it('the glitch flash is white at full and lite, and the void at none', () => {
    expect(coverAt('glitch', 'full', 'swap', 0, P).tint).toBe('white');
    expect(coverAt('glitch', 'lite', 'swap', 0, P).tint).toBe('white');
    expect(coverAt('glitch', 'none', 'swap', 0, P).tint).toBe('void');
  });

  it('every hold shows its moving element, and the collapse line and the dissolve blocks change from tick to tick (pass line 20: never a frozen frame)', () => {
    for (const style of JACK_STYLES) for (const level of JACK_LEVELS) expect(coverAt(style, level, 'hold', 4, P).holdUi, `${style} ${level}`).toBe(true);
    expect(coverAt('collapse', 'full', 'hold', 3, P).line).not.toBe(coverAt('collapse', 'full', 'hold', 9, P).line);
    expect(coverAt('dissolve', 'full', 'hold', 0, P).pattern).not.toBe(coverAt('dissolve', 'full', 'hold', 8, P).pattern);
  });

  it('holdLook is where the way back starts: the cover for glitch and for none, the amount for dissolve and collapse', () => {
    expect(holdLook('glitch', 'full', P)).toBe(P.holdCover);
    expect(holdLook('dissolve', 'full', P)).toBe(P.dissolveHold);
    expect(holdLook('collapse', 'lite', P)).toBe(1);
    expect(holdLook('dissolve', 'none', P)).toBe(1);
  });
});

describe('the declared uniform ranges (pass line 19)', () => {
  it('every style and level in the file passes the rules', () => {
    for (const style of JACK_STYLES) for (const level of JACK_LEVELS) expect(checkUniformRanges(P, UNIFORM[style][level]), `${style} ${level}`).toEqual([]);
  });

  const swap: UniformRange = { phase: 'swap', from: 0, to: null, reason: 'solid' };
  const bad = (r: UniformRange[]) => checkUniformRanges(P, r);

  it('CONTROL: a range that does not end at the cover peak, one that reaches the reveal, one over 40%, one with no reason, and a declared hold all fail', () => {
    expect(bad([{ phase: 'out', from: 20, to: 21, reason: 'dark' }])).not.toEqual([]); // ends before the peak
    expect(bad([{ phase: 'in', from: 1, to: 2, reason: 'dark' }])).not.toEqual([]); // begins after the peak
    expect(bad([{ phase: 'in', from: 0, to: P.inTicks - 1, reason: 'dark' }])).not.toEqual([]); // reaches the reveal
    expect(bad([{ phase: 'out', from: 3, to: P.outTicks - 1, reason: 'dark' }])).not.toEqual([]); // 21 ticks of 50: over 40%
    expect(bad([{ ...swap, reason: ' ' }])).not.toEqual([]);
    expect(bad([{ phase: 'hold' as never, from: 0, to: 4, reason: 'still' }])).not.toEqual([]);
    expect(bad([{ phase: 'swap', from: 1, to: 3, reason: 'partial' }])).not.toEqual([]);
    // And the good ones pass, so the checker is not just rejecting everything.
    expect(bad([swap])).toEqual([]);
    expect(bad([{ phase: 'out', from: 22, to: 23, reason: 'dark' }, swap, { phase: 'in', from: 0, to: 1, reason: 'dark' }])).toEqual([]);
  });

  it('inRanges reads the ranges by phase and tick', () => {
    const r: UniformRange[] = [{ phase: 'out', from: 22, to: 23, reason: 'dark' }, swap];
    expect(inRanges(r, 'out', 21)).toBe(false);
    expect(inRanges(r, 'out', 22)).toBe(true);
    expect(inRanges(r, 'swap', 9)).toBe(true);
    expect(inRanges(r, 'in', 0)).toBe(false);
    expect(inRanges(r, 'hold', 3)).toBe(false);
  });
});

describe('the style choice', () => {
  it('until Mark picks a style at the look checkpoint, style A (the datamosh tear) ships', () => {
    expect(DEFAULT_STYLE).toBe('glitch');
  });
  it('?jack= picks a style, "cut" is no transition, anything else is no choice', () => {
    expect(styleFromQuery('dissolve')).toBe('dissolve');
    expect(styleFromQuery('collapse')).toBe('collapse');
    expect(styleFromQuery('glitch')).toBe('glitch');
    expect(styleFromQuery('cut')).toBe('cut');
    expect(styleFromQuery('nope')).toBeNull();
    expect(styleFromQuery(null)).toBeNull();
  });
});
